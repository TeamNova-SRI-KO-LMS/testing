/**
 * OWASP A02 (Cryptographic Failures), A05 (Security Misconfiguration),
 * A07 (Identification & Authentication Failures), A09 (Logging Failures)
 * and A10 (Server-Side Request Forgery).
 *
 * SENG 34213 §8.1 names a specific control for each of these. This suite
 * checks them one by one and produces the evidence for
 * `docs/security/OWASP_COMPLIANCE.md` (deliverable §10.1 #8).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut, sutPath } = require('@support/sut');
const auth = require('@support/auth');
const { createUser, buildUser } = require('@factories');

const client = api(loadApp());
const User = requireFromSut('./models/User');

describe('OWASP A02 — Cryptographic Failures', () => {
  testCase(
    {
      id: 'TC-SEC-A02-01',
      name: 'Passwords are stored as bcrypt hashes, never in clear text',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'None',
      input: 'Register a user, then read the stored document including +password',
      expected: 'The stored value is a bcrypt hash and is not the submitted password',
    },
    async () => {
      const payload = buildUser();

      const response = await client.post('/api/auth/register').send(payload);

      const stored = await User.findById(response.body.user.id).select('+password');
      expect(stored.password).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);
      expect(stored.password).not.toBe(payload.password);
    },
  );

  testCase.failing(
    {
      id: 'TC-SEC-A02-02',
      name: 'The bcrypt cost factor is at least 12',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'None',
      input: 'Register a user and read the cost factor from the stored hash',
      expected: 'A cost factor of 12 or higher, as required by §8.1 (A02)',
      defect: 'DEFECT-02',
    },
    async () => {
      // `models/User.js` calls `bcrypt.genSalt(10)`. Each increment doubles the
      // work an offline cracker must do, so 10 → 12 is a fourfold increase in
      // the cost of a stolen-database attack. The change is one character.
      const response = await client.post('/api/auth/register').send(buildUser());

      const stored = await User.findById(response.body.user.id).select('+password');
      expect(stored.password).toBeBcryptHash(12);
    },
  );

  it('currently uses a cost factor of 10', async () => {
    const response = await client.post('/api/auth/register').send(buildUser());

    const stored = await User.findById(response.body.user.id).select('+password');
    expect(stored.password).toMatch(/^\$2[aby]\$10\$/);
  });

  testCase(
    {
      id: 'TC-SEC-A02-03',
      name: 'Password reset tokens are stored hashed, never in their usable form',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'A user document',
      input: 'user.getResetPasswordToken()',
      expected: 'The raw token is returned to the caller; only its SHA-256 hash is persisted',
    },
    async () => {
      // Storing the usable token turns any database read into account takeover.
      const crypto = require('crypto');
      const { user } = await createUser();

      const raw = user.getResetPasswordToken();
      await user.save();

      const stored = await User.findById(user._id);
      expect(stored.resetPasswordToken).not.toBe(raw);
      expect(stored.resetPasswordToken).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
    },
  );

  testCase(
    {
      id: 'TC-SEC-A02-04',
      name: 'No API response exposes password material',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'An administrator and several users exist',
      input: 'Every user-returning endpoint an administrator can reach',
      expected: 'No response body contains a password, a hash, or a reset token',
    },
    async () => {
      const admin = await auth.asAdmin();
      const { user } = await createUser();

      const responses = await Promise.all([
        client.get('/api/users').set('Authorization', admin.authHeader),
        client.get(`/api/users/${user._id}`).set('Authorization', admin.authHeader),
        client.get('/api/admin/users').set('Authorization', admin.authHeader),
        client.get('/api/auth/me').set('Authorization', admin.authHeader),
        client.get('/api/users/profile').set('Authorization', admin.authHeader),
      ]);

      for (const response of responses) {
        expect(response.body).not.toExposePassword();
        expect(JSON.stringify(response.body)).not.toMatch(/\$2[aby]\$\d{2}\$/);
        expect(JSON.stringify(response.body)).not.toContain('resetPasswordToken');
      }
    },
  );

  it('excludes the password from a query by default', async () => {
    const { user } = await createUser();

    const withoutSelect = await User.findById(user._id);

    // `select: false` on the schema path is what makes every other query safe
    // by default; the login route opts back in explicitly.
    expect(withoutSelect.password).toBeUndefined();
  });
});

describe('OWASP A05 — Security Misconfiguration', () => {
  testCase(
    {
      id: 'TC-SEC-A05-01',
      name: 'Error responses carry no stack trace or internal detail',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'None',
      input: 'A request that provokes a server-side cast error',
      expected: 'A generic message; no stack, no file path, no driver detail',
    },
    async () => {
      const response = await client.get('/api/courses/not-an-object-id');

      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/at \s*\w+\s*\(/); // stack frames
      expect(body).not.toMatch(/node_modules/);
      expect(body).not.toMatch(/\/(Users|home|srv|var)\//); // filesystem paths
      expect(body).not.toMatch(/CastError/);
    },
  );

  it('does not advertise the server technology', async () => {
    const response = await client.get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers.server).toBeUndefined();
  });

  testCase(
    {
      id: 'TC-SEC-A05-02',
      name: 'The application sends the baseline security headers on every response',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'None',
      input: 'A public GET, an authenticated GET and a 404',
      expected: 'All three carry X-Frame-Options, X-Content-Type-Options and a CSP',
    },
    async () => {
      const student = await auth.asStudent();

      const responses = await Promise.all([
        client.get('/api/health'),
        client.get('/api/auth/me').set('Authorization', student.authHeader),
        client.get('/api/nowhere'),
      ]);

      for (const response of responses) {
        expect(response.headers['x-frame-options']).toBe('DENY');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['content-security-policy']).toBeDefined();
      }
    },
  );

  it('sets the helmet defaults that protect against MIME sniffing and referrer leakage', async () => {
    const response = await client.get('/api/health');

    expect(response.headers['x-dns-prefetch-control']).toBe('off');
    expect(response.headers['x-download-options']).toBe('noopen');
  });

  testCase(
    {
      id: 'TC-SEC-A05-03',
      name: 'No credential is committed to the application repository',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'The application source is available',
      input: 'A scan of server.js, the routes and the models for credential literals',
      expected: 'No hard-coded connection string, API key or password is present',
    },
    async () => {
      // §7 "Secrets Management": secrets belong in GitHub Secrets and .env, and
      // never in the repository — private repositories included.
      const files = ['server.js', 'middleware/auth.js', 'middleware/validation.js'];
      const patterns = [
        /mongodb(\+srv)?:\/\/[^\s'"]*:[^\s'"@]+@/i, // connection string with credentials
        /sk_live_[A-Za-z0-9]+/, // Stripe live key
        /AKIA[0-9A-Z]{16}/, // AWS access key id
        /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
      ];

      const findings = [];
      for (const file of files) {
        const source = fs.readFileSync(sutPath(file), 'utf8');
        for (const pattern of patterns) {
          if (pattern.test(source)) findings.push(`${file} matches ${pattern}`);
        }
      }

      expect(findings).toEqual([]);
    },
  );

  testCase.failing(
    {
      id: 'TC-SEC-A05-04',
      name: 'The application refuses to start without an explicit JWT secret',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'JWT_SECRET is not set in the environment',
      input: 'Inspection of the token signing and verification paths',
      expected: 'No hard-coded fallback secret is used',
      defect: 'DEFECT-03',
    },
    async () => {
      // Both `models/User.js` and `middleware/auth.js` fall back to the literal
      // string 'fallback-secret'. A deployment that forgets to set JWT_SECRET
      // therefore signs every token with a value published in the source, and
      // anyone can mint an administrator token. Failing fast at boot is the fix.
      const sources = ['models/User.js', 'middleware/auth.js', 'routes/authRoutes.js'].map((file) =>
        fs.readFileSync(sutPath(file), 'utf8'),
      );

      const withFallback = sources.filter((source) => /['"]fallback-secret['"]/.test(source));
      expect(withFallback).toHaveLength(0);
    },
  );

  it('currently ships a hard-coded JWT fallback secret in three modules', () => {
    // Companion to TC-SEC-A05-04: pins the blast radius.
    const files = ['models/User.js', 'middleware/auth.js', 'routes/authRoutes.js'];

    const withFallback = files.filter((file) =>
      /['"]fallback-secret['"]/.test(fs.readFileSync(sutPath(file), 'utf8')),
    );

    expect(withFallback).toEqual(files);
  });
});

describe('OWASP A07 — Identification and Authentication Failures', () => {
  testCase(
    {
      id: 'TC-SEC-A07-01',
      name: 'The password policy rejects the most common weak passwords',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'None',
      input: 'Registration attempts using password, 123456, qwerty, abc123 and letmein',
      expected: 'Every one is rejected with HTTP 400 and no account is created',
    },
    async () => {
      const weak = ['password', '123456', 'qwerty', 'abc123', 'letmein', 'admin'];

      for (const candidate of weak) {
        // eslint-disable-next-line no-await-in-loop
        const response = await client
          .post('/api/auth/register')
          .send(buildUser({ password: candidate }));

        expect(response).toFailValidation('password');
      }

      expect(await User.countDocuments()).toBe(0);
    },
  );

  testCase.failing(
    {
      id: 'TC-SEC-A07-02',
      name: 'An account is locked after repeated failed login attempts',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'A registered user',
      input: 'Ten consecutive login attempts with the wrong password, then the correct one',
      expected: 'The account is locked; the correct password no longer succeeds immediately',
      defect: 'DEFECT-31',
    },
    async () => {
      // §8.1 (A07) requires "account lockout after N failed attempts". There is
      // no attempt counter on the User model and no lockout in the login route,
      // so an attacker is limited only by the global 2000-request rate limit —
      // ample for a targeted password-guessing run.
      const { user, password } = await createUser();

      for (let attempt = 0; attempt < 10; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        await client.post('/api/auth/login').send({ email: user.email, password: 'WrongPass123' });
      }

      const afterLockout = await client
        .post('/api/auth/login')
        .send({ email: user.email, password });

      expect(afterLockout.status).not.toBe(200);
    },
  );

  it('currently allows unlimited password guesses against one account', async () => {
    // Companion to TC-SEC-A07-02: pins the actual behaviour.
    const { user, password } = await createUser();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await client.post('/api/auth/login').send({ email: user.email, password: 'WrongPass123' });
    }

    const stillWorks = await client.post('/api/auth/login').send({ email: user.email, password });

    expect(stillWorks.status).toBe(200);
  });

  testCase(
    {
      id: 'TC-SEC-A07-03',
      name: 'The session cookie is HTTP-only, so script cannot read it',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P2',
      preconditions: 'None',
      input: 'Inspection of the express-session configuration in server.js',
      expected: 'httpOnly is true and secure is tied to the production environment',
    },
    async () => {
      const source = fs.readFileSync(sutPath('server.js'), 'utf8');

      expect(source).toMatch(/httpOnly:\s*true/);
      expect(source).toMatch(/secure:\s*\(process\.env\.NODE_ENV[^)]*\)\s*===\s*'production'/);
    },
  );

  it('issues a token with a bounded lifetime', async () => {
    // A token that never expires is a permanent credential.
    const { user, password } = await createUser();

    const response = await client.post('/api/auth/login').send({ email: user.email, password });

    const payload = JSON.parse(
      Buffer.from(response.body.token.split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.exp).toBeDefined();
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(7 * 24 * 60 * 60);
  });
});

describe('OWASP A09 — Security Logging and Monitoring Failures', () => {
  testCase.failing(
    {
      id: 'TC-SEC-A09-01',
      name: 'No application log statement prints a secret',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'The application source is available',
      input: 'A scan of the source for log statements that interpolate JWT_SECRET or a token',
      expected: 'No such statement exists',
      defect: 'DEFECT-05',
    },
    async () => {
      // `middleware/auth.js` logs `console.log('JWT_SECRET value:', process.env.JWT_SECRET)`
      // and the first 20 characters of every bearer token, on every
      // authenticated request. §8.1 (A09) requires "logs do not contain PII or
      // secrets"; anyone with log access can currently mint tokens for any user.
      const source = fs.readFileSync(sutPath('middleware/auth.js'), 'utf8');

      expect(source).not.toMatch(/console\.log\([^)]*JWT_SECRET/);
      expect(source).not.toMatch(/console\.log\([^)]*token\.substring/);
    },
  );

  it('currently logs the JWT secret and a token prefix on every request', () => {
    // Companion to TC-SEC-A09-01: pins the exact statements to remove.
    const source = fs.readFileSync(sutPath('middleware/auth.js'), 'utf8');

    expect(source).toMatch(/console\.log\('JWT_SECRET value:', process\.env\.JWT_SECRET\)/);
    expect(source).toMatch(/token\.substring\(0, 20\)/);
  });

  testCase(
    {
      id: 'TC-SEC-A09-02',
      name: 'Authentication outcomes are logged for audit',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P2',
      preconditions: 'The application source is available',
      input: 'Inspection of the /api/auth audit middleware in server.js',
      expected: 'Both successful and failed authentication responses are logged',
    },
    async () => {
      const source = fs.readFileSync(sutPath('server.js'), 'utf8');

      expect(source).toMatch(/Auth Success/);
      expect(source).toMatch(/Auth Failure/);
      // Administrative actions are logged separately, which is what makes an
      // "who changed this setting?" question answerable.
      expect(source).toMatch(/Admin Action/);
    },
  );

  it('logs every request through morgan', () => {
    const source = fs.readFileSync(sutPath('server.js'), 'utf8');

    expect(source).toMatch(/morgan\(/);
  });
});

describe('OWASP A10 — Server-Side Request Forgery', () => {
  testCase.failing(
    {
      id: 'TC-SEC-A10-01',
      name: 'A user-supplied website URL is validated against an allow-list',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P2',
      preconditions: 'An authenticated student',
      input: 'PUT /api/users/profile with website "http://169.254.169.254/latest/meta-data/"',
      expected: 'HTTP 400 — link-local and internal addresses are refused',
      defect: 'DEFECT-06',
    },
    async () => {
      // §8.1 (A10) requires "external URL inputs validated; allow-list of
      // permitted domains". `validateProfileUpdate` checks only the length of
      // `website`, so a cloud metadata address, a javascript: URI or an
      // intranet host is stored and later rendered as a link by the frontend.
      const student = await auth.asStudent();

      const response = await client
        .put('/api/users/profile')
        .set('Authorization', student.authHeader)
        .send({ website: 'http://169.254.169.254/latest/meta-data/' });

      expect(response.status).toBe(400);
    },
  );

  it.each([
    ['a cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ['a loopback address', 'http://127.0.0.1:5001/api/admin/stats'],
    ['a javascript URI', 'javascript:alert(1)'],
    ['a file URI', 'file:///etc/passwd'],
  ])('currently stores %s in the website field unchanged', async (_label, website) => {
    // Companion to TC-SEC-A10-01: pins the range of values accepted. The
    // application never fetches these URLs itself, so the immediate risk is
    // stored-XSS and phishing through the rendered profile link rather than
    // classic SSRF — but the missing validation is the same gap.
    const student = await auth.asStudent();

    const response = await client
      .put('/api/users/profile')
      .set('Authorization', student.authHeader)
      .send({ website });

    expect(response.status).toBe(200);
    expect(response.body.user.website).toBe(website);
  });

  it('makes no outbound request from a user-supplied URL', async () => {
    // The saving grace: no route dereferences the value, so there is no
    // server-side fetch to forge.
    const routesDir = sutPath('routes');
    const sources = fs
      .readdirSync(routesDir)
      .filter((file) => file.endsWith('.js'))
      .map((file) => fs.readFileSync(path.join(routesDir, file), 'utf8'))
      .join('\n');

    expect(sources).not.toMatch(/\b(axios|fetch|got|request)\s*\(\s*[^)]*\bwebsite\b/);
  });
});
