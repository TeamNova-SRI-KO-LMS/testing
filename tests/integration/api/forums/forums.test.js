/**
 * Integration tests — discussion forums.
 *
 * Endpoints: GET /api/forums[/all|/stats|/:id|/:id/posts];
 *            POST /api/forums, /:id/posts, /:id/subscribe, /:id/unsubscribe;
 *            PUT /api/forums/:id[/pin|/toggle]; DELETE /api/forums/:id.
 *
 * Requirements: FR-17 (Discussion Forums), FR-05 (RBAC).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createForum, buildForum } = require('@factories');

const client = api(loadApp());
const DiscussionForum = requireFromSut('./models/DiscussionForum');
const DiscussionPost = requireFromSut('./models/DiscussionPost');

const MISSING_ID = '507f1f77bcf86cd799439099';

describe('GET /api/forums', () => {
  testCase(
    {
      id: 'TC-FR-17-01',
      name: 'An authenticated user lists the active forums',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Two active forums exist',
      input: 'GET /api/forums with a student token',
      expected: 'HTTP 200; both forums are listed',
    },
    async () => {
      const student = await auth.asStudent();
      await createForum({ title: 'Grammar Questions Forum' });
      await createForum({ title: 'Vocabulary Practice Forum' });

      const response = await client.get('/api/forums').set('Authorization', student.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.forums).toHaveLength(2);
    },
  );

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/forums');

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/forums/all and /stats', () => {
  it('lists every forum for an administrator', async () => {
    const admin = await auth.asAdmin();
    await createForum({ isActive: true });
    await createForum({ isActive: false });

    const response = await client.get('/api/forums/all').set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.forums).toHaveLength(2);
  });

  it('returns forum statistics to an administrator', async () => {
    const admin = await auth.asAdmin();
    await createForum();

    const response = await client.get('/api/forums/stats').set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it.each(['/api/forums/all', '/api/forums/stats'])('refuses a student on %s', async (path) => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get(path).set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/forums/:id', () => {
  testCase(
    {
      id: 'TC-FR-17-02',
      name: 'A user opens a single forum',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A forum exists',
      input: 'GET /api/forums/<id>',
      expected: 'HTTP 200; the forum record',
    },
    async () => {
      const student = await auth.asStudent();
      const forum = await createForum({ title: 'Pronunciation Clinic Forum' });

      const response = await client
        .get(`/api/forums/${forum._id}`)
        .set('Authorization', student.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.forum.title).toBe('Pronunciation Clinic Forum');
    },
  );

  it('returns 404 for a forum that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get(`/api/forums/${MISSING_ID}`).set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });
});

describe('POST /api/forums', () => {
  testCase(
    {
      id: 'TC-FR-17-03',
      name: 'An administrator creates a forum',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated administrator',
      input: 'POST /api/forums with a title and description',
      expected: 'HTTP 201; the forum is persisted and attributed to the administrator',
    },
    async () => {
      const admin = await auth.asAdmin();

      const response = await client
        .post('/api/forums')
        .set('Authorization', admin.authHeader)
        .send(buildForum({ title: 'Hangul Beginners Forum' }));

      expect(response.status).toBe(201);

      const stored = await DiscussionForum.findOne({ title: 'Hangul Beginners Forum' });
      expect(stored).not.toBeNull();
      expect(String(stored.createdBy)).toBe(admin.id);
    },
  );

  it.each([
    ['no title', { title: undefined }],
    ['no description', { description: undefined }],
  ])('rejects a forum with %s', async (_label, override) => {
    const admin = await auth.asAdmin();

    const response = await client
      .post('/api/forums')
      .set('Authorization', admin.authHeader)
      .send(buildForum(override));

    expect(response).toBeErrorResponse(400, 'Title and description are required');
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post('/api/forums')
      .set('Authorization', authHeader)
      .send(buildForum());

    expect(response).toBeForbidden();
    expect(await DiscussionForum.countDocuments()).toBe(0);
  });
});

describe('PUT /api/forums/:id, /pin, /toggle and DELETE', () => {
  testCase(
    {
      id: 'TC-FR-17-04',
      name: 'An administrator edits a forum',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A forum exists',
      input: 'PUT /api/forums/<id> with a new title',
      expected: 'HTTP 200; the title is persisted',
    },
    async () => {
      const admin = await auth.asAdmin();
      const forum = await createForum();

      const response = await client
        .put(`/api/forums/${forum._id}`)
        .set('Authorization', admin.authHeader)
        .send({ title: 'Renamed Grammar Forum' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await DiscussionForum.findById(forum._id)).title).toBe('Renamed Grammar Forum');
    },
  );

  it('pins and unpins a forum', async () => {
    const admin = await auth.asAdmin();
    const forum = await createForum({ isPinned: false });

    await client.put(`/api/forums/${forum._id}/pin`).set('Authorization', admin.authHeader);
    expect((await DiscussionForum.findById(forum._id)).isPinned).toBe(true);

    await client.put(`/api/forums/${forum._id}/pin`).set('Authorization', admin.authHeader);
    expect((await DiscussionForum.findById(forum._id)).isPinned).toBe(false);
  });

  it('deactivates a forum', async () => {
    const admin = await auth.asAdmin();
    const forum = await createForum({ isActive: true });

    await client.put(`/api/forums/${forum._id}/toggle`).set('Authorization', admin.authHeader);

    expect((await DiscussionForum.findById(forum._id)).isActive).toBe(false);
  });

  it('deletes a forum', async () => {
    const admin = await auth.asAdmin();
    const forum = await createForum();

    const response = await client
      .delete(`/api/forums/${forum._id}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(await DiscussionForum.findById(forum._id)).toBeNull();
  });

  it.each([
    ['PUT', '/pin'],
    ['PUT', '/toggle'],
  ])('returns 404 on %s <id>%s for a forum that does not exist', async (method, suffix) => {
    const admin = await auth.asAdmin();

    const response = await client[method.toLowerCase()](`/api/forums/${MISSING_ID}${suffix}`).set(
      'Authorization',
      admin.authHeader,
    );

    expect(response).toBeNotFound();
  });

  it('returns 404 when updating a forum that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put(`/api/forums/${MISSING_ID}`)
      .set('Authorization', admin.authHeader)
      .send({ title: 'Nothing Here' });

    expect(response).toBeNotFound();
  });

  it('returns 404 when deleting a forum that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .delete(`/api/forums/${MISSING_ID}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student on every administrative forum endpoint', async () => {
    const { authHeader } = await auth.asStudent();
    const forum = await createForum();

    expect(
      await client
        .put(`/api/forums/${forum._id}`)
        .set('Authorization', authHeader)
        .send({ title: 'Hijacked Forum' }),
    ).toBeForbidden();
    expect(
      await client.put(`/api/forums/${forum._id}/pin`).set('Authorization', authHeader),
    ).toBeForbidden();
    expect(
      await client.put(`/api/forums/${forum._id}/toggle`).set('Authorization', authHeader),
    ).toBeForbidden();
    expect(
      await client.delete(`/api/forums/${forum._id}`).set('Authorization', authHeader),
    ).toBeForbidden();

    expect(await DiscussionForum.findById(forum._id)).not.toBeNull();
  });
});

describe('forum subscriptions', () => {
  testCase(
    {
      id: 'TC-FR-17-05',
      name: 'A user subscribes to a forum and then unsubscribes',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A forum the user is not subscribed to',
      input: 'POST /api/forums/<id>/subscribe, then POST /api/forums/<id>/unsubscribe',
      expected: 'HTTP 200 each time; the user is added to and then removed from subscribers',
    },
    async () => {
      const student = await auth.asStudent();
      const forum = await createForum();

      const subscribe = await client
        .post(`/api/forums/${forum._id}/subscribe`)
        .set('Authorization', student.authHeader);

      expect(subscribe).toBeSuccessfulResponse(200);
      const subscribed = await DiscussionForum.findById(forum._id);
      expect(subscribed.subscribers.map(String)).toContain(student.id);

      const unsubscribe = await client
        .post(`/api/forums/${forum._id}/unsubscribe`)
        .set('Authorization', student.authHeader);

      expect(unsubscribe).toBeSuccessfulResponse(200);
      const unsubscribed = await DiscussionForum.findById(forum._id);
      expect(unsubscribed.subscribers.map(String)).not.toContain(student.id);
    },
  );

  it('returns 404 when subscribing to a forum that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/forums/${MISSING_ID}/subscribe`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('returns 404 when unsubscribing from a forum that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/forums/${MISSING_ID}/unsubscribe`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated subscribe', async () => {
    const forum = await createForum();

    const response = await client.post(`/api/forums/${forum._id}/subscribe`);

    expect(response).toBeUnauthorised();
  });
});

describe('forum posts', () => {
  testCase(
    {
      id: 'TC-FR-17-06',
      name: 'A user posts in a forum and the post count is maintained',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An active, unlocked forum with no posts',
      input: 'POST /api/forums/<id>/posts with a title and content',
      expected: 'HTTP 201; the post is persisted; the forum postCount becomes 1',
    },
    async () => {
      const student = await auth.asStudent();
      const forum = await createForum({ isActive: true, isLocked: false });

      const response = await client
        .post(`/api/forums/${forum._id}/posts`)
        .set('Authorization', student.authHeader)
        .send({
          title: 'How do I use the topic particle?',
          content: 'I keep confusing 은 and 는.',
        });

      expect(response.status).toBe(201);

      const post = await DiscussionPost.findOne({ forum: forum._id });
      expect(post).not.toBeNull();
      expect(String(post.author)).toBe(student.id);

      // A stale counter makes the forum index misleading, so it is maintained
      // alongside the post itself.
      expect((await DiscussionForum.findById(forum._id)).postCount).toBe(1);
    },
  );

  testCase(
    {
      id: 'TC-FR-17-07',
      name: 'A locked forum accepts no new posts',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A forum with isLocked true',
      input: 'POST /api/forums/<id>/posts',
      expected: 'HTTP 400 "Forum is locked"; no post is created',
    },
    async () => {
      const student = await auth.asStudent();
      const forum = await createForum({ isLocked: true });

      const response = await client
        .post(`/api/forums/${forum._id}/posts`)
        .set('Authorization', student.authHeader)
        .send({ title: 'A locked forum post', content: 'This should not be accepted.' });

      expect(response).toBeErrorResponse(400, 'Forum is locked');
      expect(await DiscussionPost.countDocuments()).toBe(0);
    },
  );

  it('rejects a post in a deactivated forum', async () => {
    const student = await auth.asStudent();
    const forum = await createForum({ isActive: false });

    const response = await client
      .post(`/api/forums/${forum._id}/posts`)
      .set('Authorization', student.authHeader)
      .send({ title: 'An inactive forum post', content: 'This should not be accepted.' });

    expect(response).toBeErrorResponse(400, 'Forum is not active');
  });

  it.each([
    ['no title', { content: 'Only content here.' }],
    ['no content', { title: 'Only a title here' }],
    ['an empty body', {}],
  ])('rejects a post with %s', async (_label, body) => {
    const student = await auth.asStudent();
    const forum = await createForum();

    const response = await client
      .post(`/api/forums/${forum._id}/posts`)
      .set('Authorization', student.authHeader)
      .send(body);

    expect(response).toBeErrorResponse(400, 'Title and content are required');
  });

  it('returns 404 when posting to a forum that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/forums/${MISSING_ID}/posts`)
      .set('Authorization', authHeader)
      .send({ title: 'Post to nowhere', content: 'There is no such forum.' });

    expect(response).toBeNotFound();
  });

  testCase(
    {
      id: 'TC-FR-17-08',
      name: 'A forum’s posts are listed with pagination',
      requirement: 'FR-17',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A forum containing one post',
      input: 'GET /api/forums/<id>/posts',
      expected: 'HTTP 200; the post is listed with pagination metadata',
    },
    async () => {
      const student = await auth.asStudent();
      const forum = await createForum();
      await client
        .post(`/api/forums/${forum._id}/posts`)
        .set('Authorization', student.authHeader)
        .send({ title: 'A question about verbs', content: 'When do I use the polite form?' });

      const response = await client
        .get(`/api/forums/${forum._id}/posts`)
        .set('Authorization', student.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.posts).toHaveLength(1);
      expect(response.body.pagination).toBeDefined();
    },
  );

  it('returns an empty list for a forum with no posts', async () => {
    const student = await auth.asStudent();
    const forum = await createForum();

    const response = await client
      .get(`/api/forums/${forum._id}/posts`)
      .set('Authorization', student.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.posts).toEqual([]);
  });

  it('refuses an unauthenticated request for posts', async () => {
    const forum = await createForum();

    const response = await client.get(`/api/forums/${forum._id}/posts`);

    expect(response).toBeUnauthorised();
  });
});
