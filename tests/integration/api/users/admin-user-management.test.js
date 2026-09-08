/**
 * Integration tests — administrative user management through /api/users.
 *
 * Endpoints: GET /api/users, GET /api/users/:id, PUT /api/users/:id,
 *            DELETE /api/users/:id.
 *
 * Requirements: FR-19 (Admin User Management), FR-05 (RBAC),
 * OWASP A01 (Broken Access Control).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createStudent } = require('@factories');

const client = api(loadApp());
const User = requireFromSut('./models/User');

const MISSING_ID = '507f1f77bcf86cd799439099';

describe('GET /api/users', () => {
  testCase(
    {
      id: 'TC-FR-19-01',
      name: 'An administrator lists every user without any password material',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Several users exist in addition to the administrator',
      input: 'GET /api/users with an administrator token',
      expected: 'HTTP 200; all users with pagination metadata; no password field anywhere',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      await Promise.all([createStudent(), createStudent(), createStudent()]);

      const response = await client.get('/api/users').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.total).toBe(4); // three students plus the administrator
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('pages');
      expect(response.body).not.toExposePassword();
    },
  );

  testCase(
    {
      id: 'TC-FR-05-05',
      name: 'A student cannot list the user directory',
      requirement: 'FR-05',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated student and other users in the system',
      input: 'GET /api/users with a student token',
      expected: 'HTTP 403; no user data returned',
    },
    async () => {
      const { authHeader } = await auth.asStudent();
      await createStudent();

      const response = await client.get('/api/users').set('Authorization', authHeader);

      expect(response).toBeForbidden();
      expect(response.body.users).toBeUndefined();
    },
  );

  it('refuses an instructor', async () => {
    const { authHeader } = await auth.asInstructor();

    const response = await client.get('/api/users').set('Authorization', authHeader);

    expect(response).toBeForbidden();
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/users');

    expect(response).toBeUnauthorised();
  });

  it('paginates the directory', async () => {
    const { authHeader } = await auth.asAdmin();
    for (let i = 0; i < 11; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await createStudent();
    }

    const response = await client.get('/api/users?page=2&limit=5').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.users).toHaveLength(5);
    expect(response.body.page).toBe(2);
  });
});

describe('GET /api/users/:id', () => {
  testCase(
    {
      id: 'TC-FR-19-02',
      name: 'An administrator reads a single user record',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A student exists',
      input: 'GET /api/users/<id> with an administrator token',
      expected: 'HTTP 200; the user record without password material',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const { user } = await createStudent({ name: 'Ayesha Perera' });

      const response = await client.get(`/api/users/${user._id}`).set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.user.name).toBe('Ayesha Perera');
      expect(response.body).not.toExposePassword();
    },
  );

  it('returns 404 for a user that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client.get(`/api/users/${MISSING_ID}`).set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  testCase(
    {
      id: 'TC-NFR-03-05',
      name: 'A student cannot read another user’s record',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'Two students exist',
      input: 'GET /api/users/<other student id> with the first student’s token',
      expected: 'HTTP 403 — an insecure direct object reference is refused',
    },
    async () => {
      const { authHeader } = await auth.asStudent();
      const { user: other } = await createStudent();

      const response = await client.get(`/api/users/${other._id}`).set('Authorization', authHeader);

      expect(response).toBeForbidden();
    },
  );
});

describe('PUT /api/users/:id', () => {
  testCase(
    {
      id: 'TC-FR-19-03',
      name: 'An administrator changes a user’s role',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A student exists',
      input: 'PUT /api/users/<id> with role "instructor"',
      expected: 'HTTP 200; the stored role becomes "instructor"',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const { user } = await createStudent();

      const response = await client
        .put(`/api/users/${user._id}`)
        .set('Authorization', authHeader)
        .send({ role: 'instructor' });

      expect(response).toBeSuccessfulResponse(200);
      expect((await User.findById(user._id)).role).toBe('instructor');
    },
  );

  testCase(
    {
      id: 'TC-FR-19-04',
      name: 'An administrator deactivates a user, and that user can no longer log in',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An active student with known credentials',
      input: 'PUT /api/users/<id> with isActive false, then a login attempt',
      expected: 'HTTP 200 for the update; the subsequent login is refused with 401',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const { user, password } = await createStudent();

      await client
        .put(`/api/users/${user._id}`)
        .set('Authorization', authHeader)
        .send({ isActive: false });

      const login = await client.post('/api/auth/login').send({ email: user.email, password });
      expect(login).toBeErrorResponse(401, 'Account is deactivated');
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const { user } = await createStudent();

    const response = await client
      .put(`/api/users/${user._id}`)
      .set('Authorization', authHeader)
      .send({ role: 'admin' });

    expect(response).toBeForbidden();
    expect((await User.findById(user._id)).role).toBe('student');
  });

  it('returns 404 for a user that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put(`/api/users/${MISSING_ID}`)
      .set('Authorization', authHeader)
      .send({ role: 'instructor' });

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const { user } = await createStudent();

    const response = await client.put(`/api/users/${user._id}`).send({ role: 'admin' });

    expect(response).toBeUnauthorised();
  });
});

describe('DELETE /api/users/:id', () => {
  testCase(
    {
      id: 'TC-FR-19-05',
      name: 'An administrator deletes a user',
      requirement: 'FR-19',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A student exists',
      input: 'DELETE /api/users/<id> with an administrator token',
      expected: 'HTTP 200; the user no longer exists',
    },
    async () => {
      const { authHeader } = await auth.asAdmin();
      const { user } = await createStudent();

      const response = await client
        .delete(`/api/users/${user._id}`)
        .set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(await User.findById(user._id)).toBeNull();
    },
  );

  it('refuses a student', async () => {
    const { authHeader } = await auth.asStudent();
    const { user } = await createStudent();

    const response = await client.delete(`/api/users/${user._id}`).set('Authorization', authHeader);

    expect(response).toBeForbidden();
    expect(await User.findById(user._id)).not.toBeNull();
  });

  it('returns 404 for a user that does not exist', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .delete(`/api/users/${MISSING_ID}`)
      .set('Authorization', authHeader);

    expect(response).toBeNotFound();
  });

  it('refuses an unauthenticated request', async () => {
    const { user } = await createStudent();

    const response = await client.delete(`/api/users/${user._id}`);

    expect(response).toBeUnauthorised();
  });
});
