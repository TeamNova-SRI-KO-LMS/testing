/**
 * Authentication helpers for integration and security tests.
 *
 * Tokens are minted with the application's own `jsonwebtoken` and the same
 * `{ id }` payload shape the application uses, so a test token is
 * indistinguishable from one issued by `POST /api/auth/login`. Minting directly
 * rather than logging in over HTTP keeps setup fast (bcrypt at cost 10 is
 * ~80 ms per login) and keeps a failure in the login endpoint from cascading
 * into every other suite.
 *
 * `loginAs()` is provided for the cases where exercising the real login flow IS
 * the point.
 */

'use strict';

const { requireFromSut, config } = require('./sut');
const factories = require('../factories');

/** The secret the application signs with, mirroring its own fallback chain. */
function jwtSecret() {
  return process.env.JWT_SECRET || config.sutEnv.JWT_SECRET || 'fallback-secret';
}

/**
 * Sign a token for a user id.
 *
 * @param {string|object} userId
 * @param {object} [options] `expiresIn`, `secret`, or a replacement `payload`
 */
function signToken(userId, options = {}) {
  const jwt = requireFromSut('jsonwebtoken');
  const payload = options.payload || { id: String(userId) };
  return jwt.sign(payload, options.secret || jwtSecret(), {
    expiresIn: options.expiresIn || '7d',
  });
}

/** A token that expired one hour ago — for negative auth tests. */
function signExpiredToken(userId) {
  const jwt = requireFromSut('jsonwebtoken');
  const issuedAt = Math.floor(Date.now() / 1000) - 7200;
  return jwt.sign({ id: String(userId), iat: issuedAt, exp: issuedAt + 3600 }, jwtSecret());
}

/** A structurally valid token signed with the wrong key — forgery test. */
function signTokenWithWrongSecret(userId) {
  return signToken(userId, { secret: 'an-attacker-controlled-secret' });
}

/** `Authorization` header value for a token. */
const bearer = (token) => `Bearer ${token}`;

/**
 * Create a persisted user and return it together with a ready-to-use token
 * and Authorization header.
 *
 * @returns {Promise<{user: object, token: string, password: string,
 *                    authHeader: string, id: string}>}
 */
async function createAuthenticatedUser(overrides = {}) {
  const { user, password } = await factories.createUser(overrides);
  const token = signToken(user._id);
  return {
    user,
    password,
    token,
    authHeader: bearer(token),
    id: String(user._id),
  };
}

const asStudent = (overrides = {}) => createAuthenticatedUser({ role: 'student', ...overrides });
const asInstructor = (overrides = {}) =>
  createAuthenticatedUser({ role: 'instructor', ...overrides });
const asAdmin = (overrides = {}) => createAuthenticatedUser({ role: 'admin', ...overrides });

/**
 * Log in over the real HTTP endpoint and return the issued token.
 * Use when the login round-trip itself is under test.
 */
async function loginAs(apiClient, email, password) {
  const response = await apiClient.post('/api/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(
      `loginAs(${email}) expected HTTP 200 but received ${response.status}: ` +
        JSON.stringify(response.body),
    );
  }
  return {
    token: response.body.token,
    authHeader: bearer(response.body.token),
    body: response.body,
  };
}

module.exports = {
  jwtSecret,
  signToken,
  signExpiredToken,
  signTokenWithWrongSecret,
  bearer,
  createAuthenticatedUser,
  asStudent,
  asInstructor,
  asAdmin,
  loginAs,
};
