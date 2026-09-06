/**
 * Integration tests — POST /api/auth/login, POST /api/auth/admin-login,
 * GET /api/auth/me, POST /api/auth/logout.
 *
 * Requirements: FR-02 (Authentication), FR-04 (Session & Token Management),
 * FR-05 (Role-Based Access Control), NFR-03 (Security).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createUser, createStudent, createAdmin, buildUser, VALID_PASSWORD } = require('@factories');

const client = api(loadApp());
const User = requireFromSut('./models/User');

describe('POST /api/auth/login', () => {
  describe('happy path', () => {
    testCase(
      {
        id: 'TC-FR-02-01',
        name: 'A registered user logs in and receives an access token',
        requirement: 'FR-02',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'An active user exists with a known email and password',
        input: 'POST /api/auth/login with the correct email and password',
        expected: 'HTTP 200; success=true; a JWT for that user; the user summary; no password',
      },
      async () => {
        // Arrange
        const { user, password } = await createUser({ name: 'Ayesha Perera' });

        // Act
        const response = await client.post('/api/auth/login').send({ email: user.email, password });

        // Assert
        expect(response).toBeSuccessfulResponse(200);
        expect(response.body.message).toBe('Login successful');
        expect(response.body.token).toBeValidJwtFor(user._id);
        expect(response.body.user).toMatchObject({
          id: String(user._id),
          email: user.email,
          role: 'student',
        });
        expect(response.body).not.toExposePassword();
      },
    );

    it('accepts the email in any letter case', async () => {
      const { user, password } = await createUser();

      const response = await client
        .post('/api/auth/login')
        .send({ email: user.email.toUpperCase(), password });

      expect(response).toBeSuccessfulResponse(200);
    });

    it('issues a token that is accepted by a protected endpoint', async () => {
      // The token is only useful if `protect` accepts it, so the round trip is
      // what actually proves login works.
      const { user, password } = await createUser();
      const login = await client.post('/api/auth/login').send({ email: user.email, password });

      const me = await client
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.token}`);

      expect(me).toBeSuccessfulResponse(200);
      expect(me.body.user.id).toBe(String(user._id));
    });

    it.each(['student', 'instructor', 'admin'])('logs in a %s', async (role) => {
      const { user, password } = await createUser({ role });

      const response = await client.post('/api/auth/login').send({ email: user.email, password });

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.user.role).toBe(role);
    });
  });

  describe('error handling', () => {
    testCase(
      {
        id: 'TC-FR-02-02',
        name: 'Login is refused for an unknown email address',
        requirement: 'FR-02',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'No user exists with the submitted email address',
        input: 'POST /api/auth/login with an unregistered email',
        expected: 'HTTP 401 "Invalid email or password"; no token issued',
      },
      async () => {
        const response = await client
          .post('/api/auth/login')
          .send({ email: 'nobody@sriko-test.lk', password: VALID_PASSWORD });

        expect(response).toBeErrorResponse(401, 'Invalid email or password');
        expect(response.body.token).toBeUndefined();
      },
    );

    testCase(
      {
        id: 'TC-FR-02-03',
        name: 'Login is refused for a wrong password',
        requirement: 'FR-02',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'An active user exists',
        input: 'POST /api/auth/login with the correct email and an incorrect password',
        expected: 'HTTP 401 "Invalid email or password"; no token issued',
      },
      async () => {
        const { user } = await createUser();

        const response = await client
          .post('/api/auth/login')
          .send({ email: user.email, password: 'WrongPass123' });

        expect(response).toBeErrorResponse(401, 'Invalid email or password');
        expect(response.body.token).toBeUndefined();
      },
    );

    testCase(
      {
        id: 'TC-NFR-03-03',
        name: 'The failure message does not reveal whether the account exists',
        requirement: 'NFR-03',
        type: 'Integration',
        priority: 'P2',
        preconditions: 'One registered user and one unregistered email address',
        input: 'A login with a wrong password and a login with an unknown email',
        expected: 'Both return HTTP 401 with an identical message body',
      },
      async () => {
        // Distinguishable responses turn the login endpoint into an account
        // enumeration oracle (OWASP A07).
        const { user } = await createUser();

        const wrongPassword = await client
          .post('/api/auth/login')
          .send({ email: user.email, password: 'WrongPass123' });
        const unknownEmail = await client
          .post('/api/auth/login')
          .send({ email: 'nobody@sriko-test.lk', password: 'WrongPass123' });

        expect(wrongPassword.status).toBe(unknownEmail.status);
        expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
      },
    );

    testCase(
      {
        id: 'TC-FR-02-04',
        name: 'Login is refused for a deactivated account',
        requirement: 'FR-02',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'A user exists with isActive = false',
        input: 'POST /api/auth/login with that user’s correct credentials',
        expected: 'HTTP 401 "Account is deactivated"; no token issued',
      },
      async () => {
        const { user, password } = await createUser({ isActive: false });

        const response = await client.post('/api/auth/login').send({ email: user.email, password });

        expect(response).toBeErrorResponse(401, 'Account is deactivated');
        expect(response.body.token).toBeUndefined();
      },
    );

    it.each([
      ['a missing email', { password: VALID_PASSWORD }, 'email'],
      ['a malformed email', { email: 'not-an-email', password: VALID_PASSWORD }, 'email'],
      ['a missing password', { email: 'someone@sriko-test.lk' }, 'password'],
      ['an empty password', { email: 'someone@sriko-test.lk', password: '' }, 'password'],
    ])('rejects %s with HTTP 400', async (_label, body, field) => {
      const response = await client.post('/api/auth/login').send(body);

      expect(response).toFailValidation(field);
    });

    testCase.failing(
      {
        id: 'TC-FR-02-05',
        name: 'Password login against a Google-only account is refused, not an error',
        requirement: 'FR-02',
        type: 'Integration',
        priority: 'P2',
        preconditions: 'A user exists with authProvider "google" and no local password',
        input: 'POST /api/auth/login with that email and any password',
        expected: 'HTTP 401 "Invalid email or password"',
        defect: 'DEFECT-15',
      },
      async () => {
        // `matchPassword` hands `undefined` to bcrypt.compare, which throws;
        // the catch turns it into HTTP 500. A user who signed up with Google
        // and then tries the password form sees a server error instead of being
        // told to use Google. The route should check `user.password` first.
        const user = await User.create({
          ...buildUser({ password: undefined }),
          googleId: 'google-oauth-subject-1',
          authProvider: 'google',
        });

        const response = await client
          .post('/api/auth/login')
          .send({ email: user.email, password: VALID_PASSWORD });

        expect(response.status).toBe(401);
      },
    );

    it('currently returns HTTP 500 for a Google-only account', async () => {
      // Companion to TC-FR-02-05: pins the actual behaviour.
      const user = await User.create({
        ...buildUser({ password: undefined }),
        googleId: 'google-oauth-subject-2',
        authProvider: 'google',
      });

      const response = await client
        .post('/api/auth/login')
        .send({ email: user.email, password: VALID_PASSWORD });

      expect(response.status).toBe(500);
    });
  });
});

describe('POST /api/auth/admin-login', () => {
  testCase(
    {
      id: 'TC-FR-05-01',
      name: 'An administrator signs in through the admin login endpoint',
      requirement: 'FR-05',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A user exists with the admin role',
      input: 'POST /api/auth/admin-login with the administrator’s credentials',
      expected: 'HTTP 200; a token; role "admin"; lastLogin updated on the stored user',
    },
    async () => {
      const { user, password } = await createAdmin();

      const response = await client
        .post('/api/auth/admin-login')
        .send({ email: user.email, password });

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.message).toBe('Admin login successful');
      expect(response.body.user.role).toBe('admin');
      expect(response.body.token).toBeValidJwtFor(user._id);

      const stored = await User.findById(user._id);
      expect(stored.lastLogin).toBeRecentTimestamp();
    },
  );

  testCase(
    {
      id: 'TC-FR-05-02',
      name: 'A non-administrator is refused at the admin login endpoint',
      requirement: 'FR-05',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A student account exists with valid credentials',
      input: 'POST /api/auth/admin-login with the student’s correct credentials',
      expected: 'HTTP 403 "Access denied. Admin privileges required."; no token issued',
    },
    async () => {
      const { user, password } = await createStudent();

      const response = await client
        .post('/api/auth/admin-login')
        .send({ email: user.email, password });

      expect(response).toBeForbidden();
      expect(response.body.message).toBe('Access denied. Admin privileges required.');
      expect(response.body.token).toBeUndefined();
    },
  );

  it('refuses an instructor', async () => {
    const { user, password } = await createUser({ role: 'instructor' });

    const response = await client
      .post('/api/auth/admin-login')
      .send({ email: user.email, password });

    expect(response).toBeForbidden();
  });

  it('returns 401 for an unknown email', async () => {
    const response = await client
      .post('/api/auth/admin-login')
      .send({ email: 'nobody@sriko-test.lk', password: VALID_PASSWORD });

    expect(response).toBeErrorResponse(401, 'Invalid credentials');
  });

  it('returns 401 for an administrator with the wrong password', async () => {
    const { user } = await createAdmin();

    const response = await client
      .post('/api/auth/admin-login')
      .send({ email: user.email, password: 'WrongPass123' });

    expect(response).toBeErrorResponse(401, 'Invalid credentials');
  });

  it('rejects a malformed email with HTTP 400', async () => {
    const response = await client
      .post('/api/auth/admin-login')
      .send({ email: 'bad', password: VALID_PASSWORD });

    expect(response).toFailValidation('email');
  });

  it('does not re-hash the password when stamping lastLogin', async () => {
    // The handler calls `user.save()` after loading the document with
    // `+password`; if the pre-save hook mistook the loaded hash for a new
    // password it would double-hash it and lock the administrator out.
    const { user, password } = await createAdmin();

    await client.post('/api/auth/admin-login').send({ email: user.email, password });
    const second = await client.post('/api/auth/admin-login').send({ email: user.email, password });

    expect(second).toBeSuccessfulResponse(200);
  });
});

describe('GET /api/auth/me', () => {
  testCase(
    {
      id: 'TC-FR-04-01',
      name: 'An authenticated user retrieves their own profile',
      requirement: 'FR-04',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A user holds a valid access token',
      input: 'GET /api/auth/me with header "Authorization: Bearer <token>"',
      expected: 'HTTP 200; the caller’s own profile; no password material',
    },
    async () => {
      const { user, authHeader } = await auth.asStudent({ name: 'Ayesha Perera' });

      const response = await client.get('/api/auth/me').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.user).toMatchObject({
        id: String(user._id),
        name: 'Ayesha Perera',
        email: user.email,
        role: 'student',
      });
      expect(response.body).not.toExposePassword();
    },
  );

  testCase(
    {
      id: 'TC-FR-04-02',
      name: 'An unauthenticated request for the profile is refused',
      requirement: 'FR-04',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'None',
      input: 'GET /api/auth/me with no Authorization header',
      expected: 'HTTP 401 "Not authorized to access this route"',
    },
    async () => {
      const response = await client.get('/api/auth/me');

      expect(response).toBeUnauthorised();
      expect(response.body.message).toBe('Not authorized to access this route');
    },
  );

  it.each([
    ['a forged token', () => auth.signTokenWithWrongSecret('507f1f77bcf86cd799439011')],
    ['an expired token', () => auth.signExpiredToken('507f1f77bcf86cd799439011')],
    ['a malformed token', () => 'not-a-jwt'],
  ])('refuses %s with HTTP 401', async (_label, makeToken) => {
    const response = await client.get('/api/auth/me').set('Authorization', `Bearer ${makeToken()}`);

    expect(response).toBeUnauthorised();
  });

  it('refuses a valid token whose user has since been deleted', async () => {
    const { user, authHeader } = await auth.asStudent();
    await User.findByIdAndDelete(user._id);

    const response = await client.get('/api/auth/me').set('Authorization', authHeader);

    expect(response).toBeUnauthorised();
  });

  it('refuses a valid token whose account has since been deactivated', async () => {
    const { user, authHeader } = await auth.asStudent();
    await User.findByIdAndUpdate(user._id, { isActive: false });

    const response = await client.get('/api/auth/me').set('Authorization', authHeader);

    expect(response).toBeUnauthorised();
    expect(response.body.message).toBe('Account is deactivated');
  });

  it('returns the profile fields the settings page depends on', async () => {
    const { authHeader } = await auth.asStudent();

    const response = await client.get('/api/auth/me').set('Authorization', authHeader);

    expect(response.body.user).toHaveProperty('notifications');
    expect(response.body.user).toHaveProperty('privacy');
    expect(response.body.user).toHaveProperty('enrolledCourses');
    expect(response.body.user).toHaveProperty('createdAt');
  });
});

describe('POST /api/auth/logout', () => {
  testCase(
    {
      id: 'TC-FR-04-03',
      name: 'An authenticated user logs out',
      requirement: 'FR-04',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A user holds a valid access token',
      input: 'POST /api/auth/logout with a valid Authorization header',
      expected: 'HTTP 200 "Logged out successfully"',
    },
    async () => {
      const { authHeader } = await auth.asStudent();

      const response = await client.post('/api/auth/logout').set('Authorization', authHeader);

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.message).toBe('Logged out successfully');
    },
  );

  it('refuses an unauthenticated logout', async () => {
    const response = await client.post('/api/auth/logout');

    expect(response).toBeUnauthorised();
  });

  testCase.failing(
    {
      id: 'TC-FR-04-04',
      name: 'A token stops working after the user logs out',
      requirement: 'FR-04',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'A user holds a valid access token and calls logout',
      input: 'POST /api/auth/logout, then GET /api/auth/me with the same token',
      expected: 'The second request is refused with HTTP 401',
      defect: 'DEFECT-14',
    },
    async () => {
      // Logout is client-side only: the server keeps no deny-list, so a token
      // captured before logout stays valid for its full 7-day lifetime. A
      // token version or revocation list would close this.
      const { authHeader } = await auth.asStudent();
      await client.post('/api/auth/logout').set('Authorization', authHeader);

      const afterLogout = await client.get('/api/auth/me').set('Authorization', authHeader);

      expect(afterLogout).toBeUnauthorised();
    },
  );
});

describe('POST /api/auth/google', () => {
  testCase(
    {
      id: 'TC-FR-03-01',
      name: 'Google sign-in is refused when no credential is supplied',
      requirement: 'FR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'None',
      input: 'POST /api/auth/google with an empty body',
      expected: 'HTTP 400 "Google credential token is required"',
    },
    async () => {
      const response = await client.post('/api/auth/google').send({});

      expect(response).toBeErrorResponse(400, 'Google credential token is required');
    },
  );

  testCase(
    {
      id: 'TC-FR-03-02',
      name: 'Google sign-in is refused for a credential Google does not verify',
      requirement: 'FR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'None',
      input: 'POST /api/auth/google with a forged credential string',
      expected: 'HTTP 401; no user created',
    },
    async () => {
      // A self-signed ID token must never be accepted: verification against
      // Google is the only thing standing between the attacker and any account.
      const response = await client
        .post('/api/auth/google')
        .send({ credential: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.forged' });

      expect(response.status).toBe(401);
      expect(await User.countDocuments()).toBe(0);
    },
  );

  it('refuses a credential that is not a JWT at all', async () => {
    const response = await client.post('/api/auth/google').send({ credential: 'garbage' });

    expect(response.status).toBe(401);
  });
});
