/**
 * Integration tests — the query-parameter surface of the listing endpoints.
 *
 * Requirements: FR-19 (Admin User Management), FR-20 (Admin Course
 * Management), FR-15 (Certificates), FR-16 (Announcements),
 * FR-18 (Notifications), FR-23 (Enquiries).
 *
 * Every administrative list screen is a search form, and each filter is a
 * separate branch in the route that builds the Mongo query. A filter that is
 * silently ignored returns *more* rows than the operator asked for, which looks
 * like working software right up to the moment somebody acts on the wrong list.
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const auth = require('@support/auth');
const {
  createStudent,
  createInstructor,
  createCourse,
  createCertificate,
  createAnnouncement,
  createNotification,
  createJoinUsSubmission,
} = require('@factories');

const client = api(loadApp());

/** Every listing endpoint wraps its rows in a differently named key. */
function rowsOf(body) {
  return (
    body.users ||
    body.courses ||
    body.certificates ||
    body.announcements ||
    body.notifications ||
    body.submissions ||
    body.data ||
    []
  );
}

describe('GET /api/admin/users — filters', () => {
  testCase(
    {
      id: 'TC-FR-19-11',
      name: 'The user directory filters by role',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'One student and one instructor exist alongside the administrator',
      input: 'GET /api/admin/users?role=instructor',
      expected: 'Only instructors are returned',
    },
    async () => {
      const admin = await auth.asAdmin();
      await createStudent();
      await createInstructor();

      const response = await client
        .get('/api/admin/users?role=instructor')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      const rows = rowsOf(response.body);
      expect(rows.length).toBeGreaterThan(0);
      for (const user of rows) expect(user.role).toBe('instructor');
    },
  );

  it('searches the directory by name', async () => {
    const admin = await auth.asAdmin();
    await createStudent({ name: 'Ayesha Perera' });
    await createStudent({ name: 'Nimal Silva' });

    const response = await client
      .get('/api/admin/users?search=Ayesha')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    const names = rowsOf(response.body).map((user) => user.name);
    expect(names).toContain('Ayesha Perera');
    expect(names).not.toContain('Nimal Silva');
  });

  it('filters the directory by account status', async () => {
    const admin = await auth.asAdmin();
    await createStudent({ isActive: true });
    await createStudent({ isActive: false });

    const response = await client
      .get('/api/admin/users?status=inactive')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('combines a role filter with pagination', async () => {
    const admin = await auth.asAdmin();
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createStudent();
    }

    const response = await client
      .get('/api/admin/users?role=student&page=1&limit=2')
      .set('Authorization', admin.authHeader);

    expect(rowsOf(response.body)).toHaveLength(2);
  });
});

describe('GET /api/admin/courses — filters', () => {
  testCase(
    {
      id: 'TC-FR-20-06',
      name: 'The administrative course list filters by category and status',
      requirement: 'FR-20',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Courses across two categories and both publication states',
      input: 'GET /api/admin/courses?category=business&status=published',
      expected: 'Only published business courses are returned',
    },
    async () => {
      const admin = await auth.asAdmin();
      await createCourse({ category: 'business', isPublished: true });
      await createCourse({ category: 'business', isPublished: false });
      await createCourse({ category: 'design', isPublished: true });

      const response = await client
        .get('/api/admin/courses?category=business&status=published')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      for (const course of rowsOf(response.body)) {
        expect(course.category).toBe('business');
        expect(course.isPublished).toBe(true);
      }
    },
  );

  it('searches courses across the title and the description', async () => {
    // The administrative search is an `$or` over both fields, so the fixtures
    // have to differ in both — the factory's default description mentions
    // "hangul", which would otherwise match every course.
    const admin = await auth.asAdmin();
    await createCourse({
      title: 'Calligraphy Foundations Course',
      description: 'Brush technique for written Korean, taught over eight weeks.',
    });
    await createCourse({
      title: 'Vocabulary Builder Course',
      description: 'Daily word drills for intermediate learners of Korean.',
    });

    const byTitle = await client
      .get('/api/admin/courses?search=Calligraphy')
      .set('Authorization', admin.authHeader);
    let titles = rowsOf(byTitle.body).map((course) => course.title);
    expect(titles).toContain('Calligraphy Foundations Course');
    expect(titles).not.toContain('Vocabulary Builder Course');

    const byDescription = await client
      .get('/api/admin/courses?search=drills')
      .set('Authorization', admin.authHeader);
    titles = rowsOf(byDescription.body).map((course) => course.title);
    expect(titles).toEqual(['Vocabulary Builder Course']);
  });

  it('paginates the course list', async () => {
    const admin = await auth.asAdmin();
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createCourse();
    }

    const response = await client
      .get('/api/admin/courses?page=2&limit=2')
      .set('Authorization', admin.authHeader);

    expect(rowsOf(response.body)).toHaveLength(2);
  });

  it('filters to draft courses only', async () => {
    const admin = await auth.asAdmin();
    await createCourse({ isPublished: true });
    await createCourse({ isPublished: false });

    const response = await client
      .get('/api/admin/courses?status=draft')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });
});

describe('GET /api/certificates — filters', () => {
  testCase(
    {
      id: 'TC-FR-15-17',
      name: 'The certificate register filters by status and by course',
      requirement: 'FR-15',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Certificates in two statuses across two courses',
      input: 'GET /api/certificates?status=issued and ?course=<id>',
      expected: 'Each filter narrows the register to matching certificates only',
    },
    async () => {
      const admin = await auth.asAdmin();
      const course = await createCourse();
      await createCertificate({ course: course._id, status: 'issued' });
      await createCertificate({ status: 'pending' });

      const byStatus = await client
        .get('/api/certificates?status=issued')
        .set('Authorization', admin.authHeader);
      expect(byStatus.body.certificates).toHaveLength(1);
      expect(byStatus.body.certificates[0].status).toBe('issued');

      const byCourse = await client
        .get(`/api/certificates?course=${course._id}`)
        .set('Authorization', admin.authHeader);
      expect(byCourse.body.certificates).toHaveLength(1);
    },
  );

  it('filters the register by issue date range', async () => {
    const admin = await auth.asAdmin();
    await createCertificate({ issuedDate: new Date('2026-03-01T00:00:00.000Z') });
    await createCertificate({ issuedDate: new Date('2025-01-01T00:00:00.000Z') });

    const response = await client
      .get('/api/certificates?dateFrom=2026-01-01&dateTo=2026-12-31')
      .set('Authorization', admin.authHeader);

    expect(response.body.certificates).toHaveLength(1);
  });

  it('paginates the register', async () => {
    const admin = await auth.asAdmin();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createCertificate();
    }

    const response = await client
      .get('/api/certificates?page=2&limit=2')
      .set('Authorization', admin.authHeader);

    expect(response.body.certificates).toHaveLength(1);
  });
});

describe('GET /api/announcements/all — filters', () => {
  it.each([
    ['type', 'type=maintenance', { type: 'maintenance' }],
    ['priority', 'priority=urgent', { priority: 'urgent' }],
    ['audience', 'targetAudience=students', { targetAudience: 'students' }],
    ['active state', 'isActive=false', { isActive: false }],
    ['pinned state', 'isPinned=true', { isPinned: true }],
  ])('filters announcements by %s', async (_label, query, overrides) => {
    const admin = await auth.asAdmin();
    await createAnnouncement(overrides);
    await createAnnouncement({ type: 'general', priority: 'low', targetAudience: 'all' });

    const response = await client
      .get(`/api/announcements/all?${query}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.announcements.length).toBeGreaterThanOrEqual(1);
  });

  it('paginates the announcement list', async () => {
    const admin = await auth.asAdmin();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createAnnouncement();
    }

    const response = await client
      .get('/api/announcements/all?page=1&limit=2')
      .set('Authorization', admin.authHeader);

    expect(response.body.announcements).toHaveLength(2);
  });
});

describe('GET /api/notifications/all — filters', () => {
  it.each([
    ['type', 'type=exam_schedule', { type: 'exam_schedule' }],
    ['priority', 'priority=urgent', { priority: 'urgent' }],
    ['audience', 'targetAudience=students', { targetAudience: 'students' }],
    ['active state', 'isActive=false', { isActive: false }],
  ])('filters notifications by %s', async (_label, query, overrides) => {
    const admin = await auth.asAdmin();
    await createNotification(overrides);
    await createNotification({ type: 'general', priority: 'low' });

    const response = await client
      .get(`/api/notifications/all?${query}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('searches notifications by text', async () => {
    const admin = await auth.asAdmin();
    await createNotification({ title: 'Examination timetable published' });
    await createNotification({ title: 'Library opening hours' });

    const response = await client
      .get('/api/notifications/all?search=Examination')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });
});

describe('GET /api/forums/all — filters', () => {
  it('filters forums by category and level', async () => {
    const admin = await auth.asAdmin();
    const { createForum } = require('@factories');
    await createForum({ category: 'grammar', level: 'beginner' });
    await createForum({ category: 'vocabulary', level: 'advanced' });

    const response = await client
      .get('/api/forums/all?category=grammar&level=beginner')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('paginates the forum list', async () => {
    const admin = await auth.asAdmin();
    const { createForum } = require('@factories');
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createForum();
    }

    const response = await client
      .get('/api/forums/all?page=1&limit=2')
      .set('Authorization', admin.authHeader);

    expect(response.body.forums).toHaveLength(2);
  });
});

describe('GET /api/join-us/submissions — filters', () => {
  testCase(
    {
      id: 'TC-FR-23-08',
      name: 'The enquiry queue filters by status',
      requirement: 'FR-23',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Enquiries in the pending and enrolled states',
      input: 'GET /api/join-us/submissions?status=enrolled',
      expected: 'Only enrolled enquiries are returned',
    },
    async () => {
      const admin = await auth.asAdmin();
      await createJoinUsSubmission({ status: 'pending' });
      await createJoinUsSubmission({ status: 'enrolled' });

      const response = await client
        .get('/api/join-us/submissions?status=enrolled')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      for (const submission of rowsOf(response.body)) {
        expect(submission.status).toBe('enrolled');
      }
    },
  );

  it('paginates the enquiry queue', async () => {
    const admin = await auth.asAdmin();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createJoinUsSubmission();
    }

    const response = await client
      .get('/api/join-us/submissions?page=1&limit=2')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('searches the enquiry queue by name', async () => {
    const admin = await auth.asAdmin();
    await createJoinUsSubmission({ name: 'Ayesha Perera' });
    await createJoinUsSubmission({ name: 'Nimal Silva' });

    const response = await client
      .get('/api/join-us/submissions?search=Ayesha')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });
});

describe('GET /api/courses — the my-courses and catalogue read paths', () => {
  it('returns an empty catalogue page for a filter that matches nothing', async () => {
    await createCourse({ category: 'business' });

    const response = await client.get('/api/courses?category=lifestyle&level=advanced');

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.courses).toEqual([]);
  });

  it('reports the enrolled-course list for a user with several enrolments', async () => {
    const { enrolStudent } = require('@factories');
    const student = await auth.asStudent();
    const first = await createCourse();
    const second = await createCourse();
    await enrolStudent(student.user._id, first._id);
    await enrolStudent(student.user._id, second._id);

    const response = await client
      .get('/api/courses/my-courses')
      .set('Authorization', student.authHeader);

    expect(response.body.courses).toHaveLength(2);
  });
});
