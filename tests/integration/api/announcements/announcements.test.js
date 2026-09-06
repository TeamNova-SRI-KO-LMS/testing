/**
 * Integration tests — announcements.
 *
 * Endpoints: GET /api/announcements[/all|/stats|/:id];
 *            POST /api/announcements, /:id/read;
 *            PUT /api/announcements/:id[/pin|/toggle];
 *            DELETE /api/announcements/:id.
 *
 * Requirements: FR-16 (Announcements), FR-05 (RBAC).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createAnnouncement, buildAnnouncement } = require('@factories');

const client = api(loadApp());
const Announcement = requireFromSut('./models/Announcement');

const MISSING_ID = '507f1f77bcf86cd799439099';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('GET /api/announcements', () => {
  testCase(
    {
      id: 'TC-FR-16-01',
      name: 'A student sees announcements targeted at everyone',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An active announcement targeted at "all" is inside its date window',
      input: 'GET /api/announcements with a student token',
      expected: 'HTTP 200; the announcement is listed',
    },
    async () => {
      const student = await auth.asStudent();
      await createAnnouncement({ title: 'Term Starts Monday', targetAudience: 'all' });

      const response = await client
        .get('/api/announcements')
        .set('Authorization', student.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.announcements.map((a) => a.title)).toContain('Term Starts Monday');
    },
  );

  testCase(
    {
      id: 'TC-FR-16-02',
      name: 'A student does not see announcements aimed at instructors',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An active announcement targeted at "instructors"',
      input: 'GET /api/announcements with a student token',
      expected: 'HTTP 200; the instructor-only announcement is absent',
    },
    async () => {
      const student = await auth.asStudent();
      await createAnnouncement({ title: 'Staff Meeting Notice', targetAudience: 'instructors' });

      const response = await client
        .get('/api/announcements')
        .set('Authorization', student.authHeader);

      expect(response.body.announcements.map((a) => a.title)).not.toContain('Staff Meeting Notice');
    },
  );

  it('hides an expired announcement', async () => {
    const student = await auth.asStudent();
    await createAnnouncement({
      title: 'Last Term Notice',
      startDate: new Date(Date.now() - 30 * DAY_MS),
      endDate: new Date(Date.now() - DAY_MS),
    });

    const response = await client
      .get('/api/announcements')
      .set('Authorization', student.authHeader);

    expect(response.body.announcements.map((a) => a.title)).not.toContain('Last Term Notice');
  });

  it('hides an announcement whose start date is still in the future', async () => {
    const student = await auth.asStudent();
    await createAnnouncement({
      title: 'Scheduled For Later',
      startDate: new Date(Date.now() + DAY_MS),
    });

    const response = await client
      .get('/api/announcements')
      .set('Authorization', student.authHeader);

    expect(response.body.announcements.map((a) => a.title)).not.toContain('Scheduled For Later');
  });

  it('hides a deactivated announcement', async () => {
    const student = await auth.asStudent();
    await createAnnouncement({ title: 'Withdrawn Notice', isActive: false });

    const response = await client
      .get('/api/announcements')
      .set('Authorization', student.authHeader);

    expect(response.body.announcements.map((a) => a.title)).not.toContain('Withdrawn Notice');
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/announcements');

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/announcements/all', () => {
  testCase(
    {
      id: 'TC-FR-16-03',
      name: 'An administrator lists every announcement including expired ones',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'One active and one expired announcement exist',
      input: 'GET /api/announcements/all',
      expected: 'HTTP 200; both are listed, with pagination metadata',
    },
    async () => {
      const admin = await auth.asAdmin();
      await createAnnouncement({ isActive: true });
      await createAnnouncement({ isActive: false, endDate: new Date(Date.now() - DAY_MS) });

      const response = await client
        .get('/api/announcements/all')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.announcements).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/announcements/all').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/announcements/stats', () => {
  it('returns announcement statistics to an administrator', async () => {
    const admin = await auth.asAdmin();
    await createAnnouncement();

    const response = await client
      .get('/api/announcements/stats')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/announcements/stats').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/announcements/:id', () => {
  it('returns an announcement targeted at everyone', async () => {
    const student = await auth.asStudent();
    const announcement = await createAnnouncement({ targetAudience: 'all' });

    const response = await client
      .get(`/api/announcements/${announcement._id}`)
      .set('Authorization', student.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.announcement._id).toBe(String(announcement._id));
  });

  testCase(
    {
      id: 'TC-NFR-03-09',
      name: 'A student cannot read an announcement addressed to another audience',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An announcement targeted at "admins"',
      input: 'GET /api/announcements/<id> with a student token',
      expected: 'HTTP 403 "Access denied" — the audience check is enforced per record',
    },
    async () => {
      // Filtering the list is not enough: a direct request by id must be
      // refused too, or the audience restriction is decorative (OWASP A01).
      const student = await auth.asStudent();
      const announcement = await createAnnouncement({ targetAudience: 'admins' });

      const response = await client
        .get(`/api/announcements/${announcement._id}`)
        .set('Authorization', student.authHeader);

      expect(response).toBeForbidden();
    },
  );

  it('returns 404 for an announcement that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .get(`/api/announcements/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });
});

describe('POST /api/announcements', () => {
  testCase(
    {
      id: 'TC-FR-16-04',
      name: 'An administrator publishes an announcement',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated administrator',
      input: 'POST /api/announcements with a title, content and end date',
      expected: 'HTTP 201; the announcement is persisted and attributed to the administrator',
    },
    async () => {
      const admin = await auth.asAdmin();

      const response = await client
        .post('/api/announcements')
        .set('Authorization', admin.authHeader)
        .send(buildAnnouncement({ title: 'Public Holiday Notice' }));

      expect(response.status).toBe(201);

      const stored = await Announcement.findOne({ title: 'Public Holiday Notice' });
      expect(stored).not.toBeNull();
      expect(String(stored.createdBy)).toBe(admin.id);
    },
  );

  it.each([
    ['no title', { title: undefined }],
    ['no content', { content: undefined }],
    ['no end date', { endDate: undefined }],
  ])('rejects an announcement with %s', async (_label, override) => {
    const admin = await auth.asAdmin();

    const response = await client
      .post('/api/announcements')
      .set('Authorization', admin.authHeader)
      .send(buildAnnouncement(override));

    expect(response).toBeErrorResponse(400, 'Title, content, and end date are required');
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post('/api/announcements')
      .set('Authorization', authHeader)
      .send(buildAnnouncement());

    expect(response).toBeForbidden();
    expect(await Announcement.countDocuments()).toBe(0);
  });
});

describe('PUT /api/announcements/:id', () => {
  testCase(
    {
      id: 'TC-FR-16-05',
      name: 'An administrator edits an announcement',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An announcement exists',
      input: 'PUT /api/announcements/<id> with a new title',
      expected: 'HTTP 200; the title is persisted',
    },
    async () => {
      const admin = await auth.asAdmin();
      const announcement = await createAnnouncement();

      const response = await client
        .put(`/api/announcements/${announcement._id}`)
        .set('Authorization', admin.authHeader)
        .send({ title: 'Revised Holiday Notice' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await Announcement.findById(announcement._id)).title).toBe('Revised Holiday Notice');
    },
  );

  it('returns 404 for an announcement that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put(`/api/announcements/${MISSING_ID}`)
      .set('Authorization', admin.authHeader)
      .send({ title: 'Nothing Here' });

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const announcement = await createAnnouncement({ title: 'Original Notice' });

    const response = await client
      .put(`/api/announcements/${announcement._id}`)
      .set('Authorization', authHeader)
      .send({ title: 'Hijacked Notice' });

    expect(response).toBeForbidden();
    expect((await Announcement.findById(announcement._id)).title).toBe('Original Notice');
  });
});

describe('PUT /api/announcements/:id/pin and /toggle', () => {
  testCase(
    {
      id: 'TC-FR-16-06',
      name: 'An administrator pins and unpins an announcement',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An unpinned announcement',
      input: 'PUT /api/announcements/<id>/pin twice',
      expected: 'HTTP 200 each time; isPinned flips to true and back to false',
    },
    async () => {
      const admin = await auth.asAdmin();
      const announcement = await createAnnouncement({ isPinned: false });

      await client
        .put(`/api/announcements/${announcement._id}/pin`)
        .set('Authorization', admin.authHeader);
      expect((await Announcement.findById(announcement._id)).isPinned).toBe(true);

      await client
        .put(`/api/announcements/${announcement._id}/pin`)
        .set('Authorization', admin.authHeader);
      expect((await Announcement.findById(announcement._id)).isPinned).toBe(false);
    },
  );

  testCase(
    {
      id: 'TC-FR-16-07',
      name: 'An administrator withdraws an announcement, removing it from the student feed',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An active announcement visible to students',
      input: 'PUT /api/announcements/<id>/toggle',
      expected: 'HTTP 200; isActive becomes false and the announcement leaves the student feed',
    },
    async () => {
      const admin = await auth.asAdmin();
      const student = await auth.asStudent();
      const announcement = await createAnnouncement({ title: 'Temporary Notice', isActive: true });

      await client
        .put(`/api/announcements/${announcement._id}/toggle`)
        .set('Authorization', admin.authHeader);

      expect((await Announcement.findById(announcement._id)).isActive).toBe(false);
      const feed = await client.get('/api/announcements').set('Authorization', student.authHeader);
      expect(feed.body.announcements.map((a) => a.title)).not.toContain('Temporary Notice');
    },
  );

  it('returns 404 when pinning an announcement that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put(`/api/announcements/${MISSING_ID}/pin`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('returns 404 when toggling an announcement that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put(`/api/announcements/${MISSING_ID}/toggle`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student on both endpoints', async () => {
    const { authHeader } = await auth.asStudent();
    const announcement = await createAnnouncement();

    expect(
      await client
        .put(`/api/announcements/${announcement._id}/pin`)
        .set('Authorization', authHeader),
    ).toBeForbidden();
    expect(
      await client
        .put(`/api/announcements/${announcement._id}/toggle`)
        .set('Authorization', authHeader),
    ).toBeForbidden();
  });
});

describe('POST /api/announcements/:id/read', () => {
  testCase(
    {
      id: 'TC-FR-16-08',
      name: 'A student marks an announcement as read',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An announcement the student has not read',
      input: 'POST /api/announcements/<id>/read',
      expected: 'HTTP 200; the student is recorded in readBy exactly once',
    },
    async () => {
      const student = await auth.asStudent();
      const announcement = await createAnnouncement();

      const response = await client
        .post(`/api/announcements/${announcement._id}/read`)
        .set('Authorization', student.authHeader);

      expect(response).toBeSuccessfulResponse(200);

      const stored = await Announcement.findById(announcement._id);
      expect(stored.readBy.map((entry) => String(entry.user))).toContain(student.id);
    },
  );

  it('does not record the same reader twice', async () => {
    const student = await auth.asStudent();
    const announcement = await createAnnouncement();

    await client
      .post(`/api/announcements/${announcement._id}/read`)
      .set('Authorization', student.authHeader);
    await client
      .post(`/api/announcements/${announcement._id}/read`)
      .set('Authorization', student.authHeader);

    const stored = await Announcement.findById(announcement._id);
    const readers = stored.readBy.filter((entry) => String(entry.user) === student.id);
    expect(readers).toHaveLength(1);
  });

  it('returns 404 for an announcement that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/announcements/${MISSING_ID}/read`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const announcement = await createAnnouncement();

    const response = await client.post(`/api/announcements/${announcement._id}/read`);

    expect(response).toBeUnauthorised();
  });
});

describe('DELETE /api/announcements/:id', () => {
  testCase(
    {
      id: 'TC-FR-16-09',
      name: 'An administrator deletes an announcement',
      requirement: 'FR-16',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An announcement exists',
      input: 'DELETE /api/announcements/<id>',
      expected: 'HTTP 200; the announcement no longer exists',
    },
    async () => {
      const admin = await auth.asAdmin();
      const announcement = await createAnnouncement();

      const response = await client
        .delete(`/api/announcements/${announcement._id}`)
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(await Announcement.findById(announcement._id)).toBeNull();
    },
  );

  it('returns 404 for an announcement that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .delete(`/api/announcements/${MISSING_ID}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const announcement = await createAnnouncement();

    const response = await client
      .delete(`/api/announcements/${announcement._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
    expect(await Announcement.findById(announcement._id)).not.toBeNull();
  });
});
