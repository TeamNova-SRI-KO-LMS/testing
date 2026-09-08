/**
 * Integration tests — notifications.
 *
 * Endpoints: GET /api/notifications[/all|/stats|/target-users|/:id];
 *            POST /api/notifications, /:id/read, /:id/click,
 *            /send-to-users, /send-to-parents;
 *            PUT /api/notifications/:id[/pin|/toggle];
 *            DELETE /api/notifications/:id.
 *
 * Requirements: FR-18 (Notifications), FR-05 (RBAC).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createNotification, buildNotification, createStudent } = require('@factories');

const client = api(loadApp());
const Notification = requireFromSut('./models/Notification');

const MISSING_ID = '507f1f77bcf86cd799439099';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('GET /api/notifications', () => {
  testCase(
    {
      id: 'TC-FR-18-01',
      name: 'A student receives notifications addressed to everyone',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An active, unexpired notification targeted at "all"',
      input: 'GET /api/notifications with a student token',
      expected: 'HTTP 200; the notification is listed',
    },
    async () => {
      const student = await auth.asStudent();
      await createNotification({ title: 'Class Rescheduled', targetAudience: 'all' });

      const response = await client
        .get('/api/notifications')
        .set('Authorization', student.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.notifications.map((n) => n.title)).toContain('Class Rescheduled');
    },
  );

  it('hides an expired notification', async () => {
    const student = await auth.asStudent();
    await createNotification({
      title: 'Yesterday Reminder',
      scheduledFor: new Date(Date.now() - 2 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const response = await client
      .get('/api/notifications')
      .set('Authorization', student.authHeader);

    expect(response.body.notifications.map((n) => n.title)).not.toContain('Yesterday Reminder');
  });

  it('hides a notification scheduled for the future', async () => {
    const student = await auth.asStudent();
    await createNotification({
      title: 'Tomorrow Reminder',
      scheduledFor: new Date(Date.now() + DAY_MS),
    });

    const response = await client
      .get('/api/notifications')
      .set('Authorization', student.authHeader);

    expect(response.body.notifications.map((n) => n.title)).not.toContain('Tomorrow Reminder');
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/notifications');

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/notifications/all, /stats and /target-users', () => {
  it('lists every notification for an administrator', async () => {
    const admin = await auth.asAdmin();
    await createNotification();
    await createNotification({ isActive: false });

    const response = await client
      .get('/api/notifications/all')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.notifications).toHaveLength(2);
  });

  it('returns notification statistics to an administrator', async () => {
    const admin = await auth.asAdmin();
    await createNotification();

    const response = await client
      .get('/api/notifications/stats')
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  /**
   * `GET /target-users` is declared at notificationRoutes.js:508, long after
   * `GET /:id` at line 85. Express matches the parameterised route first, so
   * "target-users" is treated as a notification id, fails to cast, and the
   * endpoint answers 500 for every caller. `/all` and `/stats` are declared
   * before `/:id` and are unaffected. See DEFECT-24.
   */
  testCase.failing(
    {
      id: 'TC-FR-18-02',
      name: 'An administrator lists the users a notification can target',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Several users exist',
      input: 'GET /api/notifications/target-users',
      expected: 'HTTP 200; a list of candidate recipients with no password material',
      defect: 'DEFECT-24',
    },
    async () => {
      const admin = await auth.asAdmin();
      await createStudent();
      await createStudent();

      const response = await client
        .get('/api/notifications/target-users')
        .set('Authorization', admin.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body).not.toExposePassword();
    },
  );

  it('is currently shadowed by GET /api/notifications/:id and answers 500', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .get('/api/notifications/target-users')
      .set('Authorization', admin.authHeader);

    expect(response.status).toBe(500);
  });

  it.each(['/api/notifications/all', '/api/notifications/stats'])(
    'refuses a student on %s',
    async (path) => {
      const { authHeader } = await auth.asStudent();

      const response = await client.get(path).set('Authorization', authHeader);

      expect(response).toBeForbidden();
    },
  );
});

describe('GET /api/notifications/:id', () => {
  it('returns a single notification', async () => {
    const student = await auth.asStudent();
    const notification = await createNotification({ targetAudience: 'all' });

    const response = await client
      .get(`/api/notifications/${notification._id}`)
      .set('Authorization', student.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.notification._id).toBe(String(notification._id));
  });

  it('returns 404 for a notification that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .get(`/api/notifications/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });
});

describe('POST /api/notifications', () => {
  testCase(
    {
      id: 'TC-FR-18-03',
      name: 'An administrator creates a notification',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated administrator',
      input: 'POST /api/notifications with a title, message and expiry',
      expected: 'HTTP 201; the notification is persisted and attributed to the administrator',
    },
    async () => {
      const admin = await auth.asAdmin();

      const response = await client
        .post('/api/notifications')
        .set('Authorization', admin.authHeader)
        .send(buildNotification({ title: 'Exam Timetable Published' }));

      expect(response.status).toBe(201);

      const stored = await Notification.findOne({ title: 'Exam Timetable Published' });
      expect(stored).not.toBeNull();
      expect(String(stored.createdBy)).toBe(admin.id);
    },
  );

  it.each([
    ['no title', { title: undefined }],
    ['no message', { message: undefined }],
    ['no expiry', { expiresAt: undefined }],
  ])('rejects a notification with %s', async (_label, override) => {
    const admin = await auth.asAdmin();

    const response = await client
      .post('/api/notifications')
      .set('Authorization', admin.authHeader)
      .send(buildNotification(override));

    expect(response.status).toBe(400);
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post('/api/notifications')
      .set('Authorization', authHeader)
      .send(buildNotification());

    expect(response).toBeForbidden();
    expect(await Notification.countDocuments()).toBe(0);
  });
});

describe('PUT /api/notifications/:id, /pin, /toggle and DELETE', () => {
  testCase(
    {
      id: 'TC-FR-18-04',
      name: 'An administrator edits a notification',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A notification exists',
      input: 'PUT /api/notifications/<id> with a new title',
      expected: 'HTTP 200; the title is persisted',
    },
    async () => {
      const admin = await auth.asAdmin();
      const notification = await createNotification();

      const response = await client
        .put(`/api/notifications/${notification._id}`)
        .set('Authorization', admin.authHeader)
        .send({ title: 'Revised Exam Timetable' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await Notification.findById(notification._id)).title).toBe('Revised Exam Timetable');
    },
  );

  it('pins and unpins a notification', async () => {
    const admin = await auth.asAdmin();
    const notification = await createNotification({ isPinned: false });

    await client
      .put(`/api/notifications/${notification._id}/pin`)
      .set('Authorization', admin.authHeader);
    expect((await Notification.findById(notification._id)).isPinned).toBe(true);

    await client
      .put(`/api/notifications/${notification._id}/pin`)
      .set('Authorization', admin.authHeader);
    expect((await Notification.findById(notification._id)).isPinned).toBe(false);
  });

  it('withdraws a notification from the student feed', async () => {
    const admin = await auth.asAdmin();
    const student = await auth.asStudent();
    const notification = await createNotification({ title: 'Withdrawn Notice', isActive: true });

    await client
      .put(`/api/notifications/${notification._id}/toggle`)
      .set('Authorization', admin.authHeader);

    expect((await Notification.findById(notification._id)).isActive).toBe(false);
    const feed = await client.get('/api/notifications').set('Authorization', student.authHeader);
    expect(feed.body.notifications.map((n) => n.title)).not.toContain('Withdrawn Notice');
  });

  it('deletes a notification', async () => {
    const admin = await auth.asAdmin();
    const notification = await createNotification();

    const response = await client
      .delete(`/api/notifications/${notification._id}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(await Notification.findById(notification._id)).toBeNull();
  });

  it('returns 404 when editing a notification that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put(`/api/notifications/${MISSING_ID}`)
      .set('Authorization', admin.authHeader)
      .send({ title: 'Nothing Here' });

    expect(response).toBeNotFound();
  });

  it('returns 404 when pinning a notification that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put(`/api/notifications/${MISSING_ID}/pin`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('returns 404 when toggling a notification that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .put(`/api/notifications/${MISSING_ID}/toggle`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('returns 404 when deleting a notification that does not exist', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .delete(`/api/notifications/${MISSING_ID}`)
      .set('Authorization', admin.authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student on every administrative notification endpoint', async () => {
    const { authHeader } = await auth.asStudent();
    const notification = await createNotification();

    expect(
      await client
        .put(`/api/notifications/${notification._id}`)
        .set('Authorization', authHeader)
        .send({ title: 'Hijacked' }),
    ).toBeForbidden();
    expect(
      await client
        .put(`/api/notifications/${notification._id}/pin`)
        .set('Authorization', authHeader),
    ).toBeForbidden();
    expect(
      await client
        .put(`/api/notifications/${notification._id}/toggle`)
        .set('Authorization', authHeader),
    ).toBeForbidden();
    expect(
      await client
        .delete(`/api/notifications/${notification._id}`)
        .set('Authorization', authHeader),
    ).toBeForbidden();

    expect(await Notification.findById(notification._id)).not.toBeNull();
  });
});

describe('POST /api/notifications/:id/read and /click', () => {
  testCase(
    {
      id: 'TC-FR-18-05',
      name: 'A user marks a notification as read',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A notification the user has not read',
      input: 'POST /api/notifications/<id>/read',
      expected: 'HTTP 200; the user is recorded in readBy',
    },
    async () => {
      const student = await auth.asStudent();
      const notification = await createNotification();

      const response = await client
        .post(`/api/notifications/${notification._id}/read`)
        .set('Authorization', student.authHeader);

      expect(response).toBeSuccessfulResponse(200);
      const stored = await Notification.findById(notification._id);
      expect(stored.readBy.map((entry) => String(entry.user))).toContain(student.id);
    },
  );

  it('records a click on a notification', async () => {
    const student = await auth.asStudent();
    const notification = await createNotification();

    const response = await client
      .post(`/api/notifications/${notification._id}/click`)
      .set('Authorization', student.authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('returns 404 when reading a notification that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/notifications/${MISSING_ID}/read`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('returns 404 when clicking a notification that does not exist', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post(`/api/notifications/${MISSING_ID}/click`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated read', async () => {
    const notification = await createNotification();

    const response = await client.post(`/api/notifications/${notification._id}/read`);

    expect(response).toBeUnauthorised();
  });
});

describe('POST /api/notifications/send-to-users and /send-to-parents', () => {
  testCase(
    {
      id: 'TC-FR-18-06',
      name: 'An administrator sends a notification to selected users',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'Two students exist',
      input: 'POST /api/notifications/send-to-users naming both students',
      expected: 'HTTP 2xx; a notification targeted at those users is created',
    },
    async () => {
      const admin = await auth.asAdmin();
      const first = await createStudent();
      const second = await createStudent();

      const response = await client
        .post('/api/notifications/send-to-users')
        .set('Authorization', admin.authHeader)
        .send({
          // `createdBy` has to be supplied by the caller: the route does not
          // stamp it from the token, and the schema requires it. See DEFECT-25.
          notificationData: buildNotification({ createdBy: admin.id }),
          userIds: [String(first.user._id), String(second.user._id)],
        });

      expect(response.status).toBe(201);
      expect(response.body.message).toMatch(/sent to \d+ users/);
      expect(await Notification.countDocuments({ targetAudience: 'specific_users' })).toBe(2);
    },
  );

  testCase.failing(
    {
      id: 'TC-FR-18-08',
      name: 'send-to-users records the sending administrator without being told who they are',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An authenticated administrator and one student',
      input: 'POST /api/notifications/send-to-users with notificationData that omits createdBy',
      expected: 'HTTP 201 — the route should stamp createdBy from the authenticated caller',
      defect: 'DEFECT-25',
    },
    async () => {
      // Every other create route sets `createdBy: req.user._id`. This one
      // spreads the client payload straight into the model, so a well-formed
      // request from the admin console fails schema validation and surfaces as
      // an opaque HTTP 500.
      const admin = await auth.asAdmin();
      const { user } = await createStudent();

      const response = await client
        .post('/api/notifications/send-to-users')
        .set('Authorization', admin.authHeader)
        .send({
          notificationData: buildNotification(),
          userIds: [String(user._id)],
        });

      expect(response.status).toBe(201);
    },
  );

  it.each([
    ['no notificationData', { userIds: ['507f1f77bcf86cd799439011'] }],
    ['no userIds', { notificationData: {} }],
    ['an empty userIds array', { notificationData: {}, userIds: [] }],
    ['userIds that is not an array', { notificationData: {}, userIds: 'everyone' }],
  ])('rejects a send-to-users request with %s', async (_label, body) => {
    const admin = await auth.asAdmin();

    const response = await client
      .post('/api/notifications/send-to-users')
      .set('Authorization', admin.authHeader)
      .send(body);

    expect(response).toBeErrorResponse(400, 'Notification data and user IDs are required');
  });

  testCase(
    {
      id: 'TC-FR-18-07',
      name: 'An administrator sends a notification to the parents of selected students',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A student exists',
      input: 'POST /api/notifications/send-to-parents with notificationData and studentIds',
      expected: 'HTTP 201; a parent notification is created',
    },
    async () => {
      const admin = await auth.asAdmin();
      const { user } = await createStudent();

      const response = await client
        .post('/api/notifications/send-to-parents')
        .set('Authorization', admin.authHeader)
        .send({
          notificationData: buildNotification({
            type: 'parent_update',
            targetAudience: 'parents',
            createdBy: admin.id,
          }),
          studentIds: [String(user._id)],
        });

      expect(response.status).toBe(201);
    },
  );

  testCase.failing(
    {
      id: 'TC-FR-18-09',
      name: 'A parent notification actually reaches a parent',
      requirement: 'FR-18',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A student exists',
      input: 'POST /api/notifications/send-to-parents naming that student',
      expected: 'At least one parent notification is created',
      defect: 'DEFECT-26',
    },
    async () => {
      // `Notification.sendToParents` looks up `student.parentId`, but the User
      // schema has no such field, so the guard `if (student && student.parentId)`
      // is never satisfied. The endpoint reports success while sending nothing
      // — the whole parent-notification feature is inert.
      const admin = await auth.asAdmin();
      const { user } = await createStudent();

      await client
        .post('/api/notifications/send-to-parents')
        .set('Authorization', admin.authHeader)
        .send({
          notificationData: buildNotification({ createdBy: admin.id }),
          studentIds: [String(user._id)],
        });

      expect(
        await Notification.countDocuments({ 'parentNotification.isParentNotification': true }),
      ).toBeGreaterThan(0);
    },
  );

  it('currently reports success while sending zero parent notifications', async () => {
    // Companion to TC-FR-18-09: pins the actual behaviour.
    const admin = await auth.asAdmin();
    const { user } = await createStudent();

    const response = await client
      .post('/api/notifications/send-to-parents')
      .set('Authorization', admin.authHeader)
      .send({
        notificationData: buildNotification({ createdBy: admin.id }),
        studentIds: [String(user._id)],
      });

    expect(response.status).toBe(201);
    expect(response.body.message).toBe('Notification sent to 0 parents');
  });

  it('rejects a send-to-parents request with no student ids', async () => {
    const admin = await auth.asAdmin();

    const response = await client
      .post('/api/notifications/send-to-parents')
      .set('Authorization', admin.authHeader)
      .send({ notificationData: buildNotification() });

    expect(response).toBeErrorResponse(400, 'Notification data and student IDs are required');
  });

  it.each(['/api/notifications/send-to-users', '/api/notifications/send-to-parents'])(
    'refuses a student on %s',
    async (path) => {
      const { authHeader } = await auth.asStudent();

      const response = await client
        .post(path)
        .set('Authorization', authHeader)
        .send(buildNotification());

      expect(response).toBeForbidden();
    },
  );
});
