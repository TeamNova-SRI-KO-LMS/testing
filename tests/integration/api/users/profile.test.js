/**
 * Integration tests — the user's own account.
 *
 * Endpoints: GET /api/users/profile, PUT /api/users/profile,
 *            GET /api/users/dashboard, PUT /api/users/password,
 *            PUT /api/users/notifications, PUT /api/users/privacy,
 *            PUT /api/users/last-login, POST /api/users/avatar.
 *
 * Requirements: FR-06 (Profile Management), FR-07 (Password Management),
 * FR-11 (Progress), FR-24 (File Upload).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createCourse, enrolStudent, VALID_PASSWORD } = require('@factories');

const client = api(loadApp());
const User = requireFromSut('./models/User');

describe('GET /api/users/profile', () => {
  testCase(
    {
      id: 'TC-FR-06-01',
      name: 'A user retrieves their own profile',
      requirement: 'FR-06',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user with a populated profile',
      input: 'GET /api/users/profile',
      expected: 'HTTP 200; the caller’s profile including preferences; no password material',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent({
        name: 'Ayesha Perera',
        bio: 'Learning Korean since 2024',
        location: 'Colombo',
      });

      const response = await client.get('/api/users/profile').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.user).toMatchObject({
        id: String(user._id),
        name: 'Ayesha Perera',
        bio: 'Learning Korean since 2024',
        location: 'Colombo',
      });
      expect(response.body).not.toExposePassword();
    },
  );

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/users/profile');

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/users/profile', () => {
  testCase(
    {
      id: 'TC-FR-06-02',
      name: 'A user updates their own profile fields',
      requirement: 'FR-06',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user',
      input: 'PUT /api/users/profile with a new name, bio, location and social links',
      expected: 'HTTP 200; every supplied field is persisted',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent();

      const response = await client
        .put('/api/users/profile')
        .set('Authorization', authHeader)
        .send({
          name: 'Ayesha Perera',
          bio: 'Studying for TOPIK level 4',
          location: 'Kandy',
          socialLinks: { github: 'https://github.com/example' },
        });

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.message).toBe('Profile updated successfully');

      const stored = await User.findById(user._id);
      expect(stored.name).toBe('Ayesha Perera');
      expect(stored.bio).toBe('Studying for TOPIK level 4');
      expect(stored.location).toBe('Kandy');
      expect(stored.socialLinks.github).toBe('https://github.com/example');
    },
  );

  testCase(
    {
      id: 'TC-FR-06-03',
      name: 'A profile update cannot change the caller’s role or email',
      requirement: 'FR-06',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated student',
      input: 'PUT /api/users/profile with role "admin" and a different email address',
      expected: 'HTTP 200; the stored role stays "student" and the email is unchanged',
    },
    async () => {
      // The handler builds an explicit allow-list of updatable fields; without
      // it, a student could promote themselves (OWASP A01).
      const { user, authHeader } = await auth.asStudent();
      const originalEmail = user.email;

      const response = await client
        .put('/api/users/profile')
        .set('Authorization', authHeader)
        .send({ name: 'Ayesha Perera', role: 'admin', email: 'attacker@sriko-test.lk' });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await User.findById(user._id);
      expect(stored.role).toBe('student');
      expect(stored.email).toBe(originalEmail);
    },
  );

  it('leaves fields absent from the request untouched', async () => {
    const { user, authHeader } = await auth.asStudent({ bio: 'Original biography' });

    await client
      .put('/api/users/profile')
      .set('Authorization', authHeader)
      .send({ name: 'Renamed Only' });

    const stored = await User.findById(user._id);
    expect(stored.name).toBe('Renamed Only');
    expect(stored.bio).toBe('Original biography');
  });

  it.each([
    ['a one-character name', { name: 'A' }, 'name'],
    ['a 501-character bio', { bio: 'x'.repeat(501) }, 'bio'],
    ['a 101-character location', { location: 'x'.repeat(101) }, 'location'],
    ['a 21-character phone number', { phone: 'x'.repeat(21) }, 'phone'],
  ])('rejects %s with HTTP 400', async (_label, body, field) => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .put('/api/users/profile')
      .set('Authorization', authHeader)
      .send(body);

    expect(response).toFailValidation(field);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.put('/api/users/profile').send({ name: 'Anonymous User' });

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/users/password', () => {
  testCase(
    {
      id: 'TC-FR-07-01',
      name: 'A user changes their password and can log in with the new one',
      requirement: 'FR-07',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user who knows their current password',
      input: 'PUT /api/users/password with the correct current password and a new one',
      expected: 'HTTP 200; login succeeds with the new password and fails with the old one',
    },
    async () => {
      const { user, password, authHeader } = await auth.asStudent();

      const response = await client
        .put('/api/users/password')
        .set('Authorization', authHeader)
        .send({ currentPassword: password, newPassword: 'BrandNew123' });

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.message).toBe('Password updated successfully');

      // The round trip is what proves the new hash was written correctly — a
      // double-hashed value would store fine and fail only at the next login.
      const withNew = await client
        .post('/api/auth/login')
        .send({ email: user.email, password: 'BrandNew123' });
      expect(withNew).toBeSuccessfulResponse(200);

      const withOld = await client.post('/api/auth/login').send({ email: user.email, password });
      expect(withOld).toBeUnauthorised();
    },
  );

  testCase(
    {
      id: 'TC-FR-07-02',
      name: 'A password change is refused when the current password is wrong',
      requirement: 'FR-07',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user',
      input: 'PUT /api/users/password with an incorrect current password',
      expected: 'HTTP 400 "Current password is incorrect"; the old password still works',
    },
    async () => {
      // Without this check, a stolen token would be enough to take over the
      // account permanently (OWASP A07).
      const { user, password, authHeader } = await auth.asStudent();

      const response = await client
        .put('/api/users/password')
        .set('Authorization', authHeader)
        .send({ currentPassword: 'NotTheRight1', newPassword: 'BrandNew123' });

      expect(response).toBeErrorResponse(400, 'Current password is incorrect');

      const login = await client.post('/api/auth/login').send({ email: user.email, password });
      expect(login).toBeSuccessfulResponse(200);
    },
  );

  it.each([
    ['no current password', { newPassword: 'BrandNew123' }],
    ['no new password', { currentPassword: VALID_PASSWORD }],
    ['an empty body', {}],
  ])('rejects a request with %s', async (_label, body) => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .put('/api/users/password')
      .set('Authorization', authHeader)
      .send(body);

    expect(response).toBeErrorResponse(400, 'Current password and new password are required');
  });

  it('rejects a new password shorter than six characters', async () => {
    const { password, authHeader } = await auth.asStudent();

    const response = await client
      .put('/api/users/password')
      .set('Authorization', authHeader)
      .send({ currentPassword: password, newPassword: 'Ab1' });

    expect(response).toBeErrorResponse(400, 'New password must be at least 6 characters long');
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client
      .put('/api/users/password')
      .send({ currentPassword: 'x', newPassword: 'BrandNew123' });

    expect(response).toBeUnauthorised();
  });

  testCase.failing(
    {
      id: 'TC-FR-07-03',
      name: 'A password change enforces the same policy as registration',
      requirement: 'FR-07',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An authenticated user',
      input: 'PUT /api/users/password with the new password "aaaaaa"',
      expected: 'HTTP 400 — the password lacks an uppercase letter and a digit',
      defect: 'DEFECT-20',
    },
    async () => {
      // Registration requires upper, lower and a digit; the change-password
      // route checks length only, so a user can downgrade to a weak password
      // immediately after signing up.
      const { password, authHeader } = await auth.asStudent();

      const response = await client
        .put('/api/users/password')
        .set('Authorization', authHeader)
        .send({ currentPassword: password, newPassword: 'aaaaaa' });

      expect(response.status).toBe(400);
    },
  );
});

describe('GET /api/users/dashboard', () => {
  testCase(
    {
      id: 'TC-FR-11-04',
      name: 'The dashboard reports the caller’s enrolments and progress',
      requirement: 'FR-11',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The student is enrolled in two courses, one of them completed',
      input: 'GET /api/users/dashboard',
      expected: 'HTTP 200; a data payload describing the caller’s own enrolments',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent();
      const first = await createCourse();
      const second = await createCourse();
      await enrolStudent(user._id, first._id, { isCompleted: true, overallProgress: 100 });
      await enrolStudent(user._id, second._id, { overallProgress: 40 });

      const response = await client.get('/api/users/dashboard').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.data).toBeDefined();
    },
  );

  it('returns a dashboard for a user with no enrolments', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/users/dashboard').set('Authorization', authHeader);

    expect(response).toBeSuccessfulResponse(200);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.get('/api/users/dashboard');

    expect(response).toBeUnauthorised();
  });
});

/**
 * The next three endpoints are shadowed by `PUT /api/users/:id`, which is
 * declared earlier in the router (userRoutes.js:610) and carries
 * `authorize('admin')`. Express matches the parameterised route first, so:
 *
 *   • a student receives 403 from the admin guard
 *   • an administrator reaches the handler, which then calls
 *     `User.findByIdAndUpdate('notifications')` and fails to cast → 500
 *
 * All three are therefore unreachable for every caller. Moving the literal
 * routes above `/:id` fixes all of them. See DEFECT-21.
 */
describe('PUT /api/users/notifications', () => {
  testCase.failing(
    {
      id: 'TC-FR-06-04',
      name: 'A user updates their notification preferences',
      requirement: 'FR-06',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user with default preferences',
      input: 'PUT /api/users/notifications turning email notifications off and marketing on',
      expected: 'HTTP 200; both preferences are persisted',
      defect: 'DEFECT-21',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent();

      const response = await client
        .put('/api/users/notifications')
        .set('Authorization', authHeader)
        .send({ notifications: { emailNotifications: false, marketingEmails: true } });

      expect(response).toBeSuccessfulResponse(200);

      const stored = await User.findById(user._id);
      expect(stored.notifications.emailNotifications).toBe(false);
      expect(stored.notifications.marketingEmails).toBe(true);
    },
  );

  it('is currently shadowed by PUT /api/users/:id and returns 403 to a student', async () => {
    const { user, authHeader } = await auth.asStudent();

    const response = await client
      .put('/api/users/notifications')
      .set('Authorization', authHeader)
      .send({ notifications: { emailNotifications: false } });

    expect(response).toBeForbidden();
    // The preference is unchanged, confirming the handler never ran.
    expect((await User.findById(user._id)).notifications.emailNotifications).toBe(true);
  });

  it('is currently shadowed by PUT /api/users/:id and returns 500 to an administrator', async () => {
    const { authHeader } = await auth.asAdmin();

    const response = await client
      .put('/api/users/notifications')
      .set('Authorization', authHeader)
      .send({ notifications: { emailNotifications: false } });

    expect(response.status).toBe(500);
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client
      .put('/api/users/notifications')
      .send({ notifications: { emailNotifications: false } });

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/users/privacy', () => {
  testCase.failing(
    {
      id: 'TC-FR-06-05',
      name: 'A user updates their privacy settings',
      requirement: 'FR-06',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user with default privacy settings',
      input: 'PUT /api/users/privacy setting profileVisibility to "private"',
      expected: 'HTTP 200; the setting is persisted',
      defect: 'DEFECT-21',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent();

      const response = await client
        .put('/api/users/privacy')
        .set('Authorization', authHeader)
        .send({ privacy: { profileVisibility: 'private', showEmail: false } });

      expect(response).toBeSuccessfulResponse(200);
      expect((await User.findById(user._id)).privacy.profileVisibility).toBe('private');
    },
  );

  it('is currently shadowed by PUT /api/users/:id and returns 403 to a student', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client
      .put('/api/users/privacy')
      .set('Authorization', authHeader)
      .send({ privacy: { profileVisibility: 'private' } });

    expect(response).toBeForbidden();
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client
      .put('/api/users/privacy')
      .send({ privacy: { profileVisibility: 'private' } });

    expect(response).toBeUnauthorised();
  });
});

describe('PUT /api/users/last-login', () => {
  testCase.failing(
    {
      id: 'TC-FR-06-06',
      name: 'A user records their most recent login time',
      requirement: 'FR-06',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An authenticated user whose lastLogin is unset',
      input: 'PUT /api/users/last-login',
      expected: 'HTTP 200; lastLogin is stamped with the current time',
      defect: 'DEFECT-21',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent();

      const response = await client.put('/api/users/last-login').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect((await User.findById(user._id)).lastLogin).toBeRecentTimestamp();
    },
  );

  it('is currently shadowed by PUT /api/users/:id and leaves lastLogin unset', async () => {
    const { user, authHeader } = await auth.asStudent();

    const response = await client.put('/api/users/last-login').set('Authorization', authHeader);

    expect(response).toBeForbidden();
    expect((await User.findById(user._id)).lastLogin).toBeUndefined();
  });

  it('refuses an unauthenticated request', async () => {
    const response = await client.put('/api/users/last-login');

    expect(response).toBeUnauthorised();
  });
});

describe('POST /api/users/avatar', () => {
  testCase(
    {
      id: 'TC-FR-24-01',
      name: 'An avatar upload with no file attached is rejected',
      requirement: 'FR-24',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'An authenticated user',
      input: 'POST /api/users/avatar with no multipart file part',
      expected: 'HTTP 400 "No file uploaded"',
    },
    async () => {
      const { authHeader } = await auth.asStudent();

      const response = await client.post('/api/users/avatar').set('Authorization', authHeader);

      expect(response).toBeErrorResponse(400, 'No file uploaded');
    },
  );

  testCase(
    {
      id: 'TC-FR-24-02',
      name: 'A PNG avatar is accepted and linked to the user',
      requirement: 'FR-24',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user with no avatar',
      input: 'POST /api/users/avatar with a small PNG on the "avatar" field',
      expected: 'HTTP 200; the returned URL is stored on the user under /uploads/',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent();
      // Smallest valid PNG: an 8-bit greyscale 1×1 pixel.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGMAAQAABQAB' +
          'oIJXOQAAAABJRU5ErkJggg==',
        'base64',
      );

      const response = await client
        .post('/api/users/avatar')
        .set('Authorization', authHeader)
        .attach('avatar', png, { filename: 'avatar.png', contentType: 'image/png' });

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.avatar).toMatch(/^\/uploads\/avatar-\d+-\d+\.png$/);
      expect((await User.findById(user._id)).avatar).toBe(response.body.avatar);
    },
  );

  testCase(
    {
      id: 'TC-FR-24-03',
      name: 'A non-image avatar upload is rejected',
      requirement: 'FR-24',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An authenticated user',
      input: 'POST /api/users/avatar with a text/html file on the "avatar" field',
      expected: 'HTTP 400 "Only image files are allowed!"; the user keeps no avatar',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent();

      const response = await client
        .post('/api/users/avatar')
        .set('Authorization', authHeader)
        .attach('avatar', Buffer.from('<script>alert(1)</script>'), {
          filename: 'payload.html',
          contentType: 'text/html',
        });

      expect(response).toBeErrorResponse(400, 'Only image files are allowed!');
      expect((await User.findById(user._id)).avatar).toBe('');
    },
  );

  it('refuses an unauthenticated request', async () => {
    const response = await client.post('/api/users/avatar');

    expect(response).toBeUnauthorised();
  });
});
