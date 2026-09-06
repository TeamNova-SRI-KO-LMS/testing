/**
 * Integration tests — the administrative console API.
 *
 * Endpoints: /api/admin/stats, /users[/:id][/status], /courses[/:id][/status],
 *            /analytics, /analytics/export, /activities, /payment-stats,
 *            /recent-payments, /all-payments, /payments/:id/status.
 *
 * Requirements: FR-19 (Admin User Management), FR-20 (Admin Course
 * Management), FR-21 (Analytics & Reporting), FR-05 (RBAC),
 * OWASP A01 (Broken Access Control).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const {
  createStudent,
  createCourse,
  createPayment,
  createAnnouncement,
  buildUser,
  buildCourse,
  enrolStudent,
} = require('@factories');

const client = api(loadApp());
const User = requireFromSut('./models/User');
const Course = requireFromSut('./models/Course');
const Payment = requireFromSut('./models/Payment');

const MISSING_ID = '507f1f77bcf86cd799439099';

describe('GET /api/admin/stats', () => {
  testCase(
    {
      id: 'TC-FR-21-01',
      name: 'The dashboard reports user, course and revenue totals',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Two students, one published course and one completed payment of LKR 15 000',
      input: 'GET /api/admin/stats with an administrator token',
      expected: 'HTTP 200; totalUsers 3, totalCourses 1, totalRevenue 15000, activeUsers 3',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await createStudent();
      await createStudent();
      await createCourse({ isPublished: true });
      await createPayment({ amount: 15000, status: 'completed' });

      const response = await client.get('/api/admin/stats').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      // createPayment creates its own subscriber, so the user count includes it.
      expect(response.body.stats.totalUsers).toBeGreaterThanOrEqual(3);
      expect(response.body.stats.totalCourses).toBe(1);
      expect(response.body.stats.totalRevenue).toBe(15000);
      expect(response.body.stats).toHaveProperty('activeUsers');
      expect(response.body.stats).toHaveProperty('completedCourses');
    },
  );

  it('counts only completed payments as revenue', async () => {
    // Counting pending or failed payments as revenue would overstate income —
    // the single most consequential arithmetic error the dashboard can make.
    const { authHeader } = await auth.asAdmin();
    await createPayment({ amount: 15000, status: 'completed' });
    await createPayment({ amount: 99000, status: 'pending' });
    await createPayment({ amount: 77000, status: 'failed' });

    const response = await client.get('/api/admin/stats').set('Authorization', authHeader);

    expect(response.body.stats.totalRevenue).toBe(15000);
  });

  it('reports zeroes on an empty system rather than failing', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client.get('/api/admin/stats').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.stats.totalRevenue).toBe(0);
    expect(response.body.stats.totalCourses).toBe(0);
  });

  testCase(
    {
      id: 'TC-FR-05-06',
      name: 'A student cannot read the administrative statistics',
      requirement: 'FR-05',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated student',
      input: 'GET /api/admin/stats with a student token',
      expected: 'HTTP 403; no statistics returned',
    },
    async () => {
      const { authHeader } = await auth.asStudent();

      const response = await client.get('/api/admin/stats').set('Authorization', authHeader);

      expect(response).toBeForbidden();
      expect(response.body.stats).toBeUndefined();
    },
  );

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/admin/stats');

    expect(response).toBeUnauthorised();
  });
});

describe('GET /api/admin/users', () => {
  testCase(
    {
      id: 'TC-FR-19-06',
      name: 'The administrator lists users with pagination',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Several users exist',
      input: 'GET /api/admin/users?page=1&limit=10',
      expected: 'HTTP 200; the user list with pagination metadata and no password material',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await Promise.all([createStudent(), createStudent()]);

      const response = await client
        .get('/api/admin/users?page=1&limit=10')
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body).not.toExposePassword();
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/admin/users').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('POST /api/admin/users', () => {
  testCase(
    {
      id: 'TC-FR-19-07',
      name: 'An administrator provisions an instructor account',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'No user exists with the target email address',
      input: 'POST /api/admin/users with a valid payload and role "instructor"',
      expected: 'HTTP 201; the account is persisted with the requested role',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const payload = buildUser({ role: 'instructor', name: 'Nimal Silva' });

      const response = await client
        .post('/api/admin/users')
        .set('Authorization', authHeader)
        .send(payload);

      expect(response).toBeSuccessfulResponse(201);
      expect(response.body.user.role).toBe('instructor');
      expect(response.body).not.toExposePassword();

      const stored = await User.findOne({ email: payload.email.toLowerCase() });
      expect(stored).not.toBeNull();
    },
  );

  it('refuses a duplicate email address', async () => {
    const { authHeader } = await auth.asAdmin();
    const { user } = await createStudent();

    const response = await client
      .post('/api/admin/users')
      .set('Authorization', authHeader)
      .send(buildUser({ email: user.email }));

    expect(response).toBeErrorResponse(400, 'User already exists with this email');
  });

  it('applies the same validation rules as public registration', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .post('/api/admin/users')
      .set('Authorization', authHeader)
      .send(buildUser({ password: 'weak' }));

    expect(response).toFailValidation('password');
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .post('/api/admin/users')
      .set('Authorization', authHeader)
      .send(buildUser());

    expect(response).toBeForbidden();
    expect(await User.countDocuments({ role: 'instructor' })).toBe(0);
  });
});

describe('PUT /api/admin/users/:id', () => {
  testCase(
    {
      id: 'TC-FR-19-08',
      name: 'An administrator edits a user record',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A student exists',
      input: 'PUT /api/admin/users/<id> with a new name and role',
      expected: 'HTTP 200; both fields are persisted',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const { user } = await createStudent();

      const response = await client
        .put(`/api/admin/users/${user._id}`)
        .set('Authorization', authHeader)
        .send({ name: 'Renamed Learner', role: 'instructor' });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await User.findById(user._id);
      expect(stored.name).toBe('Renamed Learner');
      expect(stored.role).toBe('instructor');
    },
  );

  it('returns 404 for a user that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/admin/users/${MISSING_ID}`)
      .set('Authorization', authHeader)
      .send({ name: 'Nobody Here' });

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const { user } = await createStudent();

    const response = await client
      .put(`/api/admin/users/${user._id}`)
      .set('Authorization', authHeader)
      .send({ role: 'admin' });

    expect(response).toBeForbidden();
  });
});

describe('PUT /api/admin/users/:id/status', () => {
  testCase(
    {
      id: 'TC-FR-19-09',
      name: 'An administrator suspends and restores an account',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An active student account',
      input: 'PUT /api/admin/users/<id>/status with isActive false, then true',
      expected: 'HTTP 200 each time; the stored flag follows; login fails while suspended',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const { user, password } = await createStudent();

      const suspend = await client
        .put(`/api/admin/users/${user._id}/status`)
        .set('Authorization', authHeader)
        .send({ isActive: false });

      expect(suspend).toBeSuccessfulResponse(200);
      expect(suspend.body.message).toBe('User deactivated successfully');
      expect((await User.findById(user._id)).isActive).toBe(false);
      expect(
        await client.post('/api/auth/login').send({ email: user.email, password }),
      ).toBeUnauthorised();

      const restore = await client
        .put(`/api/admin/users/${user._id}/status`)
        .set('Authorization', authHeader)
        .send({ isActive: true });

      expect(restore.body.message).toBe('User activated successfully');
      expect(
        await client.post('/api/auth/login').send({ email: user.email, password }),
      ).toBeSuccessfulResponse(200);
    },
  );

  it('returns 404 for a user that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/admin/users/${MISSING_ID}/status`)
      .set('Authorization', authHeader)
      .send({ isActive: false });

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const { user } = await createStudent();

    const response = await client
      .put(`/api/admin/users/${user._id}/status`)
      .set('Authorization', authHeader)
      .send({ isActive: false });

    expect(response).toBeForbidden();
  });
});

describe('DELETE /api/admin/users/:id', () => {
  testCase(
    {
      id: 'TC-FR-19-10',
      name: 'An administrator deletes a user account',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A student exists',
      input: 'DELETE /api/admin/users/<id>',
      expected: 'HTTP 200; the account no longer exists',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const { user } = await createStudent();

      const response = await client
        .delete(`/api/admin/users/${user._id}`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(await User.findById(user._id)).toBeNull();
    },
  );

  it('returns 404 for a user that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .delete(`/api/admin/users/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const { user } = await createStudent();

    const response = await client
      .delete(`/api/admin/users/${user._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
    expect(await User.findById(user._id)).not.toBeNull();
  });
});

describe('GET /api/admin/courses', () => {
  testCase(
    {
      id: 'TC-FR-20-01',
      name: 'An administrator lists every course, published or not',
      requirement: 'FR-20',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'One published course and one unpublished course exist',
      input: 'GET /api/admin/courses',
      expected: 'HTTP 200; both courses are listed',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await createCourse({ isPublished: true });
      await createCourse({ isPublished: false });

      const response = await client.get('/api/admin/courses').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.courses).toHaveLength(2);
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/admin/courses').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('POST /api/admin/courses', () => {
  testCase(
    {
      id: 'TC-FR-20-02',
      name: 'An administrator creates a course on behalf of an instructor',
      requirement: 'FR-20',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An instructor account exists',
      input: 'POST /api/admin/courses with a valid payload naming that instructor',
      expected: 'HTTP 201; the course is persisted and attributed to the named instructor',
    },
    async () => {
      // Unlike POST /api/courses, which takes the owner from the token, the
      // administrative route creates a course *on behalf of* an instructor, so
      // the id is supplied in the body and must be validated.
      const { authHeader } = await auth.asAdmin();
      const instructor = await auth.asInstructor();

      const response = await client
        .post('/api/admin/courses')
        .set('Authorization', authHeader)
        .send(buildCourse({ title: 'Administered Korean Course', instructor: instructor.id }));

      expect(response).toBeSuccessfulResponse(201);

      const stored = await Course.findOne({ title: 'Administered Korean Course' });
      expect(stored).not.toBeNull();
      expect(String(stored.instructor)).toBe(instructor.id);
    },
  );

  it('rejects a missing instructor id', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .post('/api/admin/courses')
      .set('Authorization', authHeader)
      .send(buildCourse());

    expect(response).toBeErrorResponse(400, 'Valid instructor ID is required');
  });

  it('rejects a malformed instructor id', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .post('/api/admin/courses')
      .set('Authorization', authHeader)
      .send(buildCourse({ instructor: 'not-an-object-id' }));

    expect(response).toBeErrorResponse(400, 'Valid instructor ID is required');
  });

  it('rejects an instructor id that matches no user', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .post('/api/admin/courses')
      .set('Authorization', authHeader)
      .send(buildCourse({ instructor: MISSING_ID }));

    expect(response).toBeErrorResponse(400, 'Instructor not found');
  });

  it('defaults a new course to unpublished', async () => {
    const { authHeader } = await auth.asAdmin();
    const instructor = await auth.asInstructor();
    const { isPublished: _omitted, ...payload } = buildCourse({ instructor: instructor.id });

    const response = await client
      .post('/api/admin/courses')
      .set('Authorization', authHeader)
      .send(payload);

    expect(response.body.course.isPublished).toBe(false);
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const instructor = await auth.asInstructor();

    const response = await client
      .post('/api/admin/courses')
      .set('Authorization', authHeader)
      .send(buildCourse({ instructor: instructor.id }));

    expect(response).toBeForbidden();
  });
});

describe('PUT /api/admin/courses/:id', () => {
  testCase(
    {
      id: 'TC-FR-20-03',
      name: 'An administrator edits any course',
      requirement: 'FR-20',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A course exists that the administrator does not own',
      input: 'PUT /api/admin/courses/<id> with a new title',
      expected: 'HTTP 200; the title is persisted',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const course = await createCourse();

      const response = await client
        .put(`/api/admin/courses/${course._id}`)
        .set('Authorization', authHeader)
        .send({ title: 'Administratively Updated Course' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await Course.findById(course._id)).title).toBe('Administratively Updated Course');
    },
  );

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/admin/courses/${MISSING_ID}`)
      .set('Authorization', authHeader)
      .send({ title: 'Nothing Here At All' });

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const course = await createCourse();

    const response = await client
      .put(`/api/admin/courses/${course._id}`)
      .set('Authorization', authHeader)
      .send({ title: 'Student Renamed Course' });

    expect(response).toBeForbidden();
  });
});

describe('PUT /api/admin/courses/:id/status', () => {
  testCase(
    {
      id: 'TC-FR-20-04',
      name: 'An administrator publishes and unpublishes a course',
      requirement: 'FR-20',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An unpublished course exists',
      input: 'PUT /api/admin/courses/<id>/status with isPublished true, then false',
      expected:
        'HTTP 200 each time; the stored flag follows; the course appears in and disappears from the public catalogue',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const course = await createCourse({ isPublished: false });

      const publish = await client
        .put(`/api/admin/courses/${course._id}/status`)
        .set('Authorization', authHeader)
        .send({ isPublished: true });

      expect(publish).toBeSuccessfulResponse(200);
      expect(publish.body.message).toBe('Course published successfully');
      const published = await client.get('/api/courses?published=true');
      expect(published.body.courses.map((c) => c._id)).toContain(String(course._id));

      const unpublish = await client
        .put(`/api/admin/courses/${course._id}/status`)
        .set('Authorization', authHeader)
        .send({ isPublished: false });

      expect(unpublish.body.message).toBe('Course unpublished successfully');
      const afterUnpublish = await client.get('/api/courses?published=true');
      expect(afterUnpublish.body.courses.map((c) => c._id)).not.toContain(String(course._id));
    },
  );

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/admin/courses/${MISSING_ID}/status`)
      .set('Authorization', authHeader)
      .send({ isPublished: true });

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const course = await createCourse({ isPublished: false });

    const response = await client
      .put(`/api/admin/courses/${course._id}/status`)
      .set('Authorization', authHeader)
      .send({ isPublished: true });

    expect(response).toBeForbidden();
    expect((await Course.findById(course._id)).isPublished).toBe(false);
  });
});

describe('DELETE /api/admin/courses/:id', () => {
  testCase(
    {
      id: 'TC-FR-20-05',
      name: 'An administrator deletes a course',
      requirement: 'FR-20',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A course exists',
      input: 'DELETE /api/admin/courses/<id>',
      expected: 'HTTP 200; the course no longer exists',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const course = await createCourse();

      const response = await client
        .delete(`/api/admin/courses/${course._id}`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(await Course.findById(course._id)).toBeNull();
    },
  );

  it('returns 404 for a course that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .delete(`/api/admin/courses/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const course = await createCourse();

    const response = await client
      .delete(`/api/admin/courses/${course._id}`)
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/admin/analytics', () => {
  testCase(
    {
      id: 'TC-FR-21-02',
      name: 'The analytics endpoint reports over the requested period',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Users, courses, enrolments and a completed payment exist',
      input: 'GET /api/admin/analytics?period=30',
      expected: 'HTTP 200; an analytics payload',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const { user } = await createStudent();
      const course = await createCourse({ isPublished: true });
      await enrolStudent(user._id, course._id, { isCompleted: true, overallProgress: 100 });
      await createPayment({ amount: 15000, status: 'completed' });

      const response = await client
        .get('/api/admin/analytics?period=30')
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
    },
  );

  it.each(['7', '30', '90', '365'])('accepts a period of %s days', async (period) => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .get(`/api/admin/analytics?period=${period}`)
      .set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('reports on an empty system rather than failing', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client.get('/api/admin/analytics').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/admin/analytics').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/admin/analytics/export', () => {
  testCase(
    {
      id: 'TC-FR-21-03',
      name: 'The analytics export endpoint responds to an administrator',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P3',
      preconditions: 'An authenticated administrator',
      input: 'GET /api/admin/analytics/export?format=csv',
      expected: 'HTTP 200; a success envelope (the export itself is not yet implemented)',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();

      const response = await client
        .get('/api/admin/analytics/export?format=csv')
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      // Documents that this is still a placeholder, so the gap is visible in
      // the register rather than mistaken for working functionality.
      expect(response.body.message).toMatch(/coming soon/i);
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .get('/api/admin/analytics/export')
      .set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('GET /api/admin/activities', () => {
  testCase(
    {
      id: 'TC-FR-21-04',
      name: 'The activity feed merges recent records newest first',
      requirement: 'FR-21',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A recently created user and announcement exist',
      input: 'GET /api/admin/activities?limit=10',
      expected: 'HTTP 200; activities ordered by createdAt descending',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await createStudent({ name: 'Ayesha Perera' });
      await createAnnouncement();

      const response = await client
        .get('/api/admin/activities?limit=10')
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      const activities = response.body.activities || response.body.data || [];
      expect(activities.length).toBeGreaterThan(0);

      const timestamps = activities.map((activity) => new Date(activity.createdAt).getTime());
      expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
    },
  );

  it('returns an empty feed on a fresh system', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client.get('/api/admin/activities').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/admin/activities').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });
});

describe('administrative payment endpoints', () => {
  testCase(
    {
      id: 'TC-FR-14-03',
      name: 'The administrator reads payment statistics',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Completed, pending and failed payments exist',
      input: 'GET /api/admin/payment-stats',
      expected: 'HTTP 200; a statistics payload',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await createPayment({ status: 'completed', amount: 15000 });
      await createPayment({ status: 'pending', amount: 35000 });
      await createPayment({ status: 'failed', amount: 15000 });

      const response = await client
        .get('/api/admin/payment-stats')
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
    },
  );

  it('lists recent payments', async () => {
    const { authHeader } = await auth.asAdmin();
    await createPayment({ status: 'completed' });

    const response = await client
      .get('/api/admin/recent-payments')
      .set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('lists all payments', async () => {
    const { authHeader } = await auth.asAdmin();
    await createPayment();
    await createPayment();

    const response = await client.get('/api/admin/all-payments').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  testCase(
    {
      id: 'TC-FR-14-04',
      name: 'An administrator marks a pending payment as completed',
      requirement: 'FR-14',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A pending payment exists',
      input: 'PUT /api/admin/payments/<id>/status with status "completed"',
      expected: 'HTTP 200; the stored payment status becomes "completed"',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const payment = await createPayment({ status: 'pending' });

      const response = await client
        .put(`/api/admin/payments/${payment._id}/status`)
        .set('Authorization', authHeader)
        .send({ status: 'completed' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await Payment.findById(payment._id)).status).toBe('completed');
    },
  );

  it('returns 404 for a payment that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/admin/payments/${MISSING_ID}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'completed' });

    expect(response).toBeNotFound();
  });

  it.each([
    ['GET', '/api/admin/payment-stats'],
    ['GET', '/api/admin/recent-payments'],
    ['GET', '/api/admin/all-payments'],
  ])('refuses a student on %s %s', async (method, path) => {
    const { authHeader } = await auth.asStudent();

    const response = await client[method.toLowerCase()](path).set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });

  it('refuses a student on the payment status endpoint', async () => {
    const { authHeader } = await auth.asStudent();
    const payment = await createPayment({ status: 'pending' });

    const response = await client
      .put(`/api/admin/payments/${payment._id}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'completed' });

    expect(response).toBeForbidden();
    expect((await Payment.findById(payment._id)).status).toBe('pending');
  });
});
