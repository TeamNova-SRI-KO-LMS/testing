/**
 * Integration tests — model statics and instance methods that the routes
 * delegate to.
 *
 * Requirements: FR-16 (Announcements), FR-17 (Forums), FR-18 (Notifications).
 *
 * These carry the read-model logic — audience filtering, date windows,
 * pagination, engagement counters — that the routes are only thin wrappers
 * around. They run aggregation pipelines and `$or` queries, so a real database
 * is the only place their behaviour is observable.
 */

'use strict';

const { requireFromSut } = require('@support/sut');
const { testCase } = require('@support/test-case');
const { loadApp } = require('@support/app');
const {
  createStudent,
  createAdmin,
  createForum,
  createAnnouncement,
  createNotification,
} = require('@factories');

// Several of these statics populate references to models this file never
// requires directly (Course, User). Loading the application registers every
// model with Mongoose, so `populate` resolves instead of raising
// MissingSchemaError.
loadApp();

const DiscussionPost = requireFromSut('./models/DiscussionPost');
const DiscussionForum = requireFromSut('./models/DiscussionForum');
const Announcement = requireFromSut('./models/Announcement');
const Notification = requireFromSut('./models/Notification');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Create a post in a forum, authored by a fresh student. */
async function createPost(forumId, overrides = {}) {
  const { user } = await createStudent();
  return DiscussionPost.create({
    forum: forumId,
    author: user._id,
    title: overrides.title || 'How do I use the topic particle?',
    content: overrides.content || 'I keep confusing the two forms in writing.',
    ...overrides,
  });
}

describe('DiscussionPost statics', () => {
  testCase(
    {
      id: 'TC-FR-17-09',
      name: 'Posts are listed for one forum with pagination metadata',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Two forums, each containing posts',
      input: 'DiscussionPost.getPostsByForum(forumA, 1, 20)',
      expected: 'Only forum A’s posts are returned, with pagination metadata',
    },
    async () => {
      const forumA = await createForum();
      const forumB = await createForum();
      await createPost(forumA._id, { title: 'Question in forum A' });
      await createPost(forumA._id, { title: 'Second question in forum A' });
      await createPost(forumB._id, { title: 'Question in forum B' });

      const result = await DiscussionPost.getPostsByForum(forumA._id, 1, 20);

      expect(result.posts).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      for (const post of result.posts) {
        expect(String(post.forum)).toBe(String(forumA._id));
      }
    },
  );

  it('paginates a long thread list', async () => {
    const forum = await createForum();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createPost(forum._id, { title: `Question number ${i}` });
    }

    const page = await DiscussionPost.getPostsByForum(forum._id, 2, 2);

    expect(page.posts).toHaveLength(2);
    expect(page.pagination).toMatchObject({ current: 2, pages: 3, total: 5 });
  });

  it('filters a forum’s posts by pinned state', async () => {
    const forum = await createForum();
    await createPost(forum._id, { title: 'Pinned announcement post', isPinned: true });
    await createPost(forum._id, { title: 'Ordinary question post', isPinned: false });

    const pinned = await DiscussionPost.getPostsByForum(forum._id, 1, 20, { isPinned: true });

    expect(pinned.posts).toHaveLength(1);
    expect(pinned.posts[0].isPinned).toBe(true);
  });

  it('searches a forum’s posts by text', async () => {
    const forum = await createForum();
    await createPost(forum._id, { title: 'Hangul stroke order question' });
    await createPost(forum._id, { title: 'Vocabulary revision question' });

    const found = await DiscussionPost.getPostsByForum(forum._id, 1, 20, { search: 'Hangul' });

    expect(found.posts).toHaveLength(1);
  });

  it('lists posts across every forum', async () => {
    const forumA = await createForum();
    const forumB = await createForum();
    await createPost(forumA._id);
    await createPost(forumB._id);

    const all = await DiscussionPost.getAllPosts(1, 20);

    expect(all.posts).toHaveLength(2);
  });

  it('reports post statistics', async () => {
    const forum = await createForum();
    await createPost(forum._id);
    await createPost(forum._id);

    const stats = await DiscussionPost.getPostStats();

    expect(stats.total).toBe(2);
  });
});

describe('DiscussionPost engagement methods', () => {
  testCase(
    {
      id: 'TC-FR-17-10',
      name: 'A like and a dislike are mutually exclusive for one user',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A post with no reactions',
      input: 'likePost(user), then dislikePost(user) for the same user',
      expected: 'The like is replaced by the dislike; the user never counts as both',
    },
    async () => {
      // Allowing both at once would make the like and dislike counters
      // disagree with the number of people who actually reacted.
      const forum = await createForum();
      const post = await createPost(forum._id);
      const { user } = await createStudent();

      await post.likePost(user._id);
      expect(post.isLikedBy(user._id)).toBe(true);
      expect(post.isDislikedBy(user._id)).toBe(false);

      await post.dislikePost(user._id);
      expect(post.isLikedBy(user._id)).toBe(false);
      expect(post.isDislikedBy(user._id)).toBe(true);
    },
  );

  it('does not double-count a user who likes the same post twice', async () => {
    // `likePost` is idempotent rather than a toggle: liking again leaves the
    // like in place instead of removing it. Documented because the opposite —
    // a toggle — is the more common convention and an easy assumption to make.
    const forum = await createForum();
    const post = await createPost(forum._id);
    const { user } = await createStudent();

    await post.likePost(user._id);
    await post.likePost(user._id);

    expect(post.isLikedBy(user._id)).toBe(true);
    expect(post.likes).toHaveLength(1);
  });

  it('records a reply against the post', async () => {
    const forum = await createForum();
    const post = await createPost(forum._id);
    const { user } = await createStudent();

    await post.addReply(user._id, 'The topic particle marks what the sentence is about.');

    const stored = await DiscussionPost.findById(post._id);
    expect(stored.replies).toHaveLength(1);
    expect(String(stored.replies[0].author)).toBe(String(user._id));
  });

  it('increments the view counter', async () => {
    const forum = await createForum();
    const post = await createPost(forum._id);
    const before = post.viewCount;

    await post.incrementViewCount();

    expect((await DiscussionPost.findById(post._id)).viewCount).toBe(before + 1);
  });

  it('reports no reaction from a user who has not reacted', async () => {
    const forum = await createForum();
    const post = await createPost(forum._id);
    const { user } = await createStudent();

    expect(post.isLikedBy(user._id)).toBe(false);
    expect(post.isDislikedBy(user._id)).toBe(false);
  });
});

describe('DiscussionForum statics and methods', () => {
  it('lists forums filtered by category and level', async () => {
    await createForum({ category: 'grammar', level: 'beginner' });
    await createForum({ category: 'vocabulary', level: 'beginner' });

    const grammar = await DiscussionForum.getForumsByCategory('grammar');

    expect(grammar).toHaveLength(1);
    expect(grammar[0].category).toBe('grammar');
  });

  it('lists every forum with pagination', async () => {
    await createForum();
    await createForum();

    const all = await DiscussionForum.getAllForums(1, 20);

    expect(all.forums).toHaveLength(2);
    expect(all.pagination.total).toBe(2);
  });

  it('reports forum statistics', async () => {
    await createForum({ isActive: true });
    await createForum({ isActive: false });

    const stats = await DiscussionForum.getForumStats();

    expect(stats.total).toBe(2);
  });

  testCase(
    {
      id: 'TC-FR-17-11',
      name: 'Creating a post updates the forum’s counter and last-post pointer',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An empty forum',
      input: 'forum.incrementPostCount(postId, authorId)',
      expected: 'postCount becomes 1 and lastPost names the post, its author and a date',
    },
    async () => {
      // The forum index shows both values; a stale counter or pointer makes the
      // list misleading without any error appearing anywhere.
      const forum = await createForum();
      const post = await createPost(forum._id);

      await forum.incrementPostCount(post._id, post.author);

      const stored = await DiscussionForum.findById(forum._id);
      expect(stored.postCount).toBe(1);
      expect(String(stored.lastPost.post)).toBe(String(post._id));
      expect(stored.lastPost.date).toBeRecentTimestamp();
    },
  );

  it('subscribes and unsubscribes a user idempotently', async () => {
    const forum = await createForum();
    const { user } = await createStudent();

    await forum.subscribeUser(user._id);
    await forum.subscribeUser(user._id);
    expect(forum.isSubscribed(user._id)).toBe(true);
    expect(forum.subscribers.filter((id) => String(id) === String(user._id))).toHaveLength(1);

    await forum.unsubscribeUser(user._id);
    expect(forum.isSubscribed(user._id)).toBe(false);
  });

  it('increments the forum view counter', async () => {
    const forum = await createForum();

    await forum.incrementViewCount();

    expect((await DiscussionForum.findById(forum._id)).viewCount).toBe(1);
  });
});

describe('Announcement statics and methods', () => {
  testCase(
    {
      id: 'TC-FR-16-10',
      name: 'Active announcements are filtered by audience and by date window',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P1',
      preconditions:
        'Four announcements: one for everyone, one for students, one expired, one deactivated',
      input: 'Announcement.getActiveAnnouncements("students")',
      expected: 'Only the two live, student-visible announcements are returned',
    },
    async () => {
      await createAnnouncement({ title: 'For everyone', targetAudience: 'all' });
      await createAnnouncement({ title: 'For students', targetAudience: 'students' });
      await createAnnouncement({ title: 'For instructors', targetAudience: 'instructors' });
      await createAnnouncement({
        title: 'Already expired',
        startDate: new Date(Date.now() - 30 * DAY_MS),
        endDate: new Date(Date.now() - DAY_MS),
      });
      await createAnnouncement({ title: 'Withdrawn', isActive: false });

      const active = await Announcement.getActiveAnnouncements('students');

      const titles = active.map((entry) => entry.title);
      expect(titles).toContain('For everyone');
      expect(titles).toContain('For students');
      expect(titles).not.toContain('For instructors');
      expect(titles).not.toContain('Already expired');
      expect(titles).not.toContain('Withdrawn');
    },
  );

  it('lists every announcement with pagination and filters', async () => {
    await createAnnouncement({ priority: 'urgent' });
    await createAnnouncement({ priority: 'low' });

    const all = await Announcement.getAllAnnouncements(1, 20);
    expect(all.announcements).toHaveLength(2);

    const urgent = await Announcement.getAllAnnouncements(1, 20, { priority: 'urgent' });
    expect(urgent.announcements).toHaveLength(1);
  });

  it('reports announcement statistics', async () => {
    await createAnnouncement({ isActive: true });
    await createAnnouncement({ isActive: false });

    const stats = await Announcement.getAnnouncementStats();

    expect(stats.total).toBe(2);
  });

  it('records a reader once and reports the read count', async () => {
    const announcement = await createAnnouncement();
    const { user } = await createStudent();

    await announcement.markAsRead(user._id);
    await announcement.markAsRead(user._id);

    expect(announcement.isReadBy(user._id)).toBe(true);
    expect(announcement.getReadCount()).toBe(1);
  });
});

describe('Notification statics and methods', () => {
  testCase(
    {
      id: 'TC-FR-18-10',
      name: 'Active notifications respect the scheduling window and the audience',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A live notification, one scheduled for the future and one expired',
      input: 'Notification.getActiveNotifications(userId, "student")',
      expected: 'Only the live notification is returned',
    },
    async () => {
      const { user } = await createStudent();
      await createNotification({ title: 'Live now', targetAudience: 'all' });
      await createNotification({
        title: 'Scheduled for later',
        scheduledFor: new Date(Date.now() + DAY_MS),
      });
      await createNotification({
        title: 'Already expired',
        scheduledFor: new Date(Date.now() - 2 * DAY_MS),
        expiresAt: new Date(Date.now() - DAY_MS),
      });

      const active = await Notification.getActiveNotifications(user._id, 'student');

      const titles = active.map((entry) => entry.title);
      expect(titles).toContain('Live now');
      expect(titles).not.toContain('Scheduled for later');
      expect(titles).not.toContain('Already expired');
    },
  );

  it('lists every notification with pagination and filters', async () => {
    await createNotification({ type: 'exam_schedule' });
    await createNotification({ type: 'general' });

    const all = await Notification.getAllNotifications(1, 20);
    expect(all.notifications).toHaveLength(2);

    const exams = await Notification.getAllNotifications(1, 20, { type: 'exam_schedule' });
    expect(exams.notifications).toHaveLength(1);
  });

  it('reports notification statistics', async () => {
    await createNotification();
    await createNotification({ isActive: false });

    const stats = await Notification.getNotificationStats();

    expect(stats.total).toBe(2);
  });

  it('sends one notification per named recipient', async () => {
    const admin = await createAdmin();
    const first = await createStudent();
    const second = await createStudent();

    const created = await Notification.sendToUsers(
      {
        title: 'Direct message',
        message: 'Your enrolment is confirmed.',
        expiresAt: new Date(Date.now() + DAY_MS),
        createdBy: admin.user._id,
      },
      [first.user._id, second.user._id],
    );

    expect(created).toHaveLength(2);
    for (const notification of created) {
      expect(notification.targetAudience).toBe('specific_users');
      expect(notification.targetUsers).toHaveLength(1);
    }
  });

  it('records a reader and reports the read count and percentage', async () => {
    const notification = await createNotification();
    const { user } = await createStudent();

    await notification.markAsRead(user._id);
    await notification.markAsRead(user._id);

    expect(notification.isReadBy(user._id)).toBe(true);
    expect(notification.getReadCount()).toBe(1);
    expect(typeof notification.getReadPercentage()).toBe('number');
  });

  it('records a click', async () => {
    const notification = await createNotification();
    const { user } = await createStudent();

    await notification.markAsClicked(user._id);

    // The counter is aggregate rather than per-user: `markAsClicked` ignores
    // the id it is given and increments a total.
    expect((await Notification.findById(notification._id)).deliveryStats.totalClicked).toBe(1);
  });
});
