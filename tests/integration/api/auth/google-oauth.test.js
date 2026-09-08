/**
 * Integration tests — POST /api/auth/google (the verified-credential paths).
 *
 * Requirement: FR-03 (Google OAuth Authentication), NFR-03 (Security).
 *
 * `login.test.js` covers the rejection paths, which need no mocking. The
 * success paths cannot: they require a token Google itself would verify. The
 * `google-auth-library` client is therefore replaced with a double that
 * returns a controlled payload, so the application's own account-linking and
 * account-creation logic is exercised for real while the network call is not.
 *
 * The mock is installed before the application is loaded, because
 * `routes/authRoutes.js` constructs its `OAuth2Client` at module scope.
 */

'use strict';

const { requireFromSut } = require('@support/sut');

/**
 * State the stubbed Google client reads.
 *
 * The names must begin with `mock`: Jest hoists `jest.mock` factories above
 * every import, and its babel plugin only allows a factory to close over
 * variables whose names carry that prefix.
 *
 * Reassigning these per test — rather than re-mocking — keeps the module graph
 * stable, which matters because `routes/authRoutes.js` constructs its
 * `OAuth2Client` once, at module scope.
 */
let mockGooglePayload = null;
let mockVerifyShouldReject = false;

// `modulePaths` puts the application's node_modules on Jest's resolution path,
// so this intercepts exactly the module the route resolves.
jest.mock('google-auth-library', () => {
  class OAuth2Client {
    async verifyIdToken() {
      if (mockVerifyShouldReject) {
        throw new Error('Invalid token signature');
      }
      return { getPayload: () => mockGooglePayload };
    }
  }
  return { OAuth2Client };
});

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { createUser } = require('@factories');

const client = api(loadApp());
const User = requireFromSut('./models/User');

const aGooglePayload = (overrides = {}) => ({
  sub: `google-subject-${Math.random().toString(36).slice(2)}`,
  email: `google.${Math.random().toString(36).slice(2)}@sriko-test.lk`,
  name: 'Ayesha Perera',
  picture: 'https://lh3.googleusercontent.com/a/default-user',
  email_verified: true,
  ...overrides,
});

beforeEach(() => {
  mockGooglePayload = aGooglePayload();
  mockVerifyShouldReject = false;
});

describe('POST /api/auth/google — new account', () => {
  testCase(
    {
      id: 'TC-FR-03-03',
      name: 'A first-time Google user is registered with the role they choose',
      requirement: 'FR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'No account exists for the Google email address',
      input: 'POST /api/auth/google with a verified credential and role "student"',
      expected:
        'HTTP 200; a token; an account created with authProvider "google", emailVerified true and no password',
    },
    async () => {
      const response = await client
        .post('/api/auth/google')
        .send({ credential: 'a-verified-google-credential', role: 'student' });

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.message).toBe('Google login successful');
      expect(response.body.token).toBeValidJwtFor(response.body.user.id);

      const stored = await User.findById(response.body.user.id).select('+password');
      expect(stored.authProvider).toBe('google');
      expect(stored.googleId).toBe(mockGooglePayload.sub);
      // Google has already verified the address, so a second verification round
      // would be pure friction.
      expect(stored.emailVerified).toBe(true);
      // No local password exists for a Google-only account.
      expect(stored.password).toBeUndefined();
      expect(stored.avatar).toBe(mockGooglePayload.picture);
    },
  );

  testCase(
    {
      id: 'TC-FR-03-04',
      name: 'A first-time Google user must choose a role before an account is created',
      requirement: 'FR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'No account exists for the Google email address',
      input: 'POST /api/auth/google with a verified credential and no role',
      expected: 'HTTP 400 directing the user to complete registration; no account is created',
    },
    async () => {
      const response = await client
        .post('/api/auth/google')
        .send({ credential: 'a-verified-google-credential' });

      expect(response).toBeErrorResponse(400);
      expect(response.body.message).toMatch(/complete registration/i);
      expect(await User.countDocuments()).toBe(0);
    },
  );

  testCase(
    {
      id: 'TC-NFR-03-13',
      name: 'Google sign-up cannot be used to create an administrator',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'No account exists for the Google email address',
      input: 'POST /api/auth/google with a verified credential and role "admin"',
      expected: 'HTTP 400 "Invalid role. Must be student or instructor."; no account is created',
    },
    async () => {
      // The password route accepts a client-supplied `admin` role (DEFECT-11).
      // This one does not, and that difference is worth locking down: it is the
      // behaviour the registration route should be corrected to match.
      const response = await client
        .post('/api/auth/google')
        .send({ credential: 'a-verified-google-credential', role: 'admin' });

      expect(response).toBeErrorResponse(400, 'Invalid role. Must be student or instructor.');
      expect(await User.countDocuments()).toBe(0);
    },
  );

  it.each(['student', 'instructor'])('accepts the role "%s"', async (role) => {
    const response = await client
      .post('/api/auth/google')
      .send({ credential: 'a-verified-google-credential', role });

    expect(response).toBeSuccessfulResponse(200);
    expect(response.body.user.role).toBe(role);
  });

  it('rejects an unrecognised role', async () => {
    const response = await client
      .post('/api/auth/google')
      .send({ credential: 'a-verified-google-credential', role: 'superuser' });

    expect(response.status).toBe(400);
  });
});

describe('POST /api/auth/google — existing account', () => {
  testCase(
    {
      id: 'TC-FR-03-05',
      name: 'Signing in with Google links the provider to an existing local account',
      requirement: 'FR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A local account already exists with the same email address',
      input: 'POST /api/auth/google with a verified credential for that address',
      expected:
        'HTTP 200; the same account is reused and gains the googleId; no duplicate account is created',
    },
    async () => {
      // Creating a second account for an address that already exists would
      // silently split the user's enrolments and certificates in two.
      const { user } = await createUser({ name: 'Ayesha Perera' });
      mockGooglePayload = aGooglePayload({ email: user.email });

      const response = await client
        .post('/api/auth/google')
        .send({ credential: 'a-verified-google-credential' });

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.user.id).toBe(String(user._id));
      expect(await User.countDocuments()).toBe(1);

      const stored = await User.findById(user._id);
      expect(stored.googleId).toBe(mockGooglePayload.sub);
      expect(stored.authProvider).toBe('google');
    },
  );

  it('recognises a returning Google user by their googleId', async () => {
    const first = await client
      .post('/api/auth/google')
      .send({ credential: 'a-verified-google-credential', role: 'student' });

    const second = await client
      .post('/api/auth/google')
      .send({ credential: 'a-verified-google-credential' });

    expect(second).toBeSuccessfulResponse(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await User.countDocuments()).toBe(1);
  });

  it('stamps lastLogin on every Google sign-in', async () => {
    const response = await client
      .post('/api/auth/google')
      .send({ credential: 'a-verified-google-credential', role: 'student' });

    const stored = await User.findById(response.body.user.id);
    expect(stored.lastLogin).toBeRecentTimestamp();
  });

  it('does not overwrite an avatar the user has already set', async () => {
    const { user } = await createUser({ avatar: '/uploads/avatar-custom.png' });
    mockGooglePayload = aGooglePayload({ email: user.email });

    await client.post('/api/auth/google').send({ credential: 'a-verified-google-credential' });

    expect((await User.findById(user._id)).avatar).toBe('/uploads/avatar-custom.png');
  });

  testCase(
    {
      id: 'TC-FR-03-06',
      name: 'Google sign-in is refused for a deactivated account',
      requirement: 'FR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An account exists with isActive false',
      input: 'POST /api/auth/google with a verified credential for that address',
      expected: 'HTTP 401 "Account is deactivated"; no token is issued',
    },
    async () => {
      // Google verifying the identity says nothing about whether the academy
      // still permits the account to sign in.
      const { user } = await createUser({ isActive: false });
      mockGooglePayload = aGooglePayload({ email: user.email });

      const response = await client
        .post('/api/auth/google')
        .send({ credential: 'a-verified-google-credential' });

      expect(response).toBeErrorResponse(401, 'Account is deactivated');
      expect(response.body.token).toBeUndefined();
    },
  );

  it('refuses a credential Google declines to verify', async () => {
    mockVerifyShouldReject = true;

    const response = await client
      .post('/api/auth/google')
      .send({ credential: 'a-forged-credential', role: 'student' });

    expect(response.status).toBe(401);
    expect(await User.countDocuments()).toBe(0);
  });

  it('does not return password material for a Google account', async () => {
    const response = await client
      .post('/api/auth/google')
      .send({ credential: 'a-verified-google-credential', role: 'student' });

    expect(response.body).not.toExposePassword();
  });
});
