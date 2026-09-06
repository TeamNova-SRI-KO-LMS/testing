/**
 * Integration tests — POST /api/auth/register
 *
 * Requirement: FR-01 (User Registration).
 *
 * Real HTTP against the real Express app and a real MongoDB, per §6.3.2.
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const { buildUser } = require('@factories');

const client = api(loadApp());
const User = requireFromSut('./models/User');

describe('POST /api/auth/register', () => {
  describe('happy path', () => {
    testCase(
      {
        id: 'TC-FR-01-01',
        name: 'A new student is registered and receives an access token',
        requirement: 'FR-01',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'No user exists with the target email address',
        input: 'POST /api/auth/register with a valid name, email and password',
        expected:
          'HTTP 201; success=true; a JWT for the new user; the user summary; the user is persisted',
      },
      async () => {
        // Arrange
        const payload = buildUser({ name: 'Ayesha Perera' });

        // Act
        const response = await client.post('/api/auth/register').send(payload);

        // Assert
        expect(response).toBeSuccessfulResponse(201);
        expect(response.body.message).toBe('User registered successfully');
        expect(response.body.user).toMatchObject({
          name: 'Ayesha Perera',
          email: payload.email.toLowerCase(),
          role: 'student',
        });
        expect(response.body.token).toBeValidJwtFor(response.body.user.id);

        const persisted = await User.findById(response.body.user.id);
        expect(persisted).not.toBeNull();
        expect(persisted.isActive).toBe(true);
      },
    );

    testCase(
      {
        id: 'TC-FR-01-02',
        name: 'The registration response never contains password material',
        requirement: 'FR-01',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'None',
        input: 'POST /api/auth/register with a valid payload',
        expected: 'No password or hash appears anywhere in the response body',
      },
      async () => {
        const payload = buildUser();

        const response = await client.post('/api/auth/register').send(payload);

        expect(response.body).not.toExposePassword();
        expect(JSON.stringify(response.body)).not.toContain(payload.password);
      },
    );

    testCase(
      {
        id: 'TC-FR-01-03',
        name: 'The password is stored only as a bcrypt hash',
        requirement: 'FR-01',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'None',
        input: 'POST /api/auth/register, then read the stored user with +password',
        expected: 'The stored value is a bcrypt hash, not the submitted plain text',
      },
      async () => {
        const payload = buildUser();

        const response = await client.post('/api/auth/register').send(payload);

        const stored = await User.findById(response.body.user.id).select('+password');
        expect(stored.password).not.toBe(payload.password);
        expect(stored.password).toMatch(/^\$2[aby]\$\d{2}\$/);
      },
    );

    it('registers an instructor when the role is supplied', async () => {
      const response = await client
        .post('/api/auth/register')
        .send(buildUser({ role: 'instructor' }));

      expect(response).toBeSuccessfulResponse(201);
      expect(response.body.user.role).toBe('instructor');
    });

    it('defaults an omitted role to student', async () => {
      const { role: _omitted, ...payload } = buildUser();

      const response = await client.post('/api/auth/register').send(payload);

      expect(response.body.user.role).toBe('student');
    });

    it('normalises the email to lower case before storing it', async () => {
      const payload = buildUser({ email: 'MiXeD.Case@SriKo.LK' });

      const response = await client.post('/api/auth/register').send(payload);

      expect(response.body.user.email).toBe('mixed.case@sriko.lk');
    });

    it('starts a new account with no enrolled courses', async () => {
      const response = await client.post('/api/auth/register').send(buildUser());

      const stored = await User.findById(response.body.user.id);
      expect(stored.enrolledCourses).toHaveLength(0);
      expect(stored.emailVerified).toBe(false);
    });
  });

  describe('error handling', () => {
    testCase(
      {
        id: 'TC-FR-01-04',
        name: 'Registration is rejected when the email is already in use',
        requirement: 'FR-01',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'A user already exists with the target email address',
        input: 'POST /api/auth/register with an email that is already registered',
        expected:
          'HTTP 400; success=false; "User with this email already exists"; no second user created',
      },
      async () => {
        const payload = buildUser();
        await client.post('/api/auth/register').send(payload);

        const response = await client.post('/api/auth/register').send({
          ...buildUser(),
          email: payload.email,
        });

        expect(response).toBeErrorResponse(400, 'User with this email already exists');
        expect(await User.countDocuments({ email: payload.email.toLowerCase() })).toBe(1);
      },
    );

    testCase(
      {
        id: 'TC-FR-01-05',
        name: 'Registration is rejected when the password does not meet the policy',
        requirement: 'FR-01',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'None',
        input: 'POST /api/auth/register with the password "weakpass" (no uppercase, no digit)',
        expected: 'HTTP 400; errors[] names "password"; no user created',
      },
      async () => {
        const response = await client
          .post('/api/auth/register')
          .send(buildUser({ password: 'weakpass' }));

        expect(response).toFailValidation('password');
        expect(await User.countDocuments()).toBe(0);
      },
    );

    it.each([
      ['a missing name', { name: undefined }, 'name'],
      ['a one-character name', { name: 'A' }, 'name'],
      ['a 51-character name', { name: 'a'.repeat(51) }, 'name'],
      ['a malformed email', { email: 'not-an-email' }, 'email'],
      ['a missing email', { email: undefined }, 'email'],
      ['a five-character password', { password: 'Ab1cd' }, 'password'],
      ['an invalid role', { role: 'superuser' }, 'role'],
    ])('rejects %s with HTTP 400', async (_label, override, field) => {
      const response = await client.post('/api/auth/register').send(buildUser(override));

      expect(response).toFailValidation(field);
    });

    it('rejects an entirely empty body', async () => {
      const response = await client.post('/api/auth/register').send({});

      expect(response).toFailValidation();
      expect(response.body.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('reports every invalid field in a single response', async () => {
      const response = await client.post('/api/auth/register').send({
        name: 'A',
        email: 'bad',
        password: 'x',
      });

      const fields = response.body.errors.map((error) => error.path);
      expect(fields).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    });

    testCase.failing(
      {
        id: 'TC-NFR-03-02',
        name: 'A validation error does not echo the submitted password back to the client',
        requirement: 'NFR-03',
        type: 'Integration',
        priority: 'P2',
        preconditions: 'None',
        input: 'POST /api/auth/register with a policy-violating password',
        expected: 'The error body names the field but does not contain the submitted value',
        defect: 'DEFECT-13',
      },
      async () => {
        // OWASP A09. express-validator puts the offending value in each error
        // object, so the rejected password travels back in the response and on
        // into browser consoles, proxy logs and error-tracking systems.
        // `handleValidationErrors` should strip `value` for password fields.
        const response = await client
          .post('/api/auth/register')
          .send(buildUser({ password: 'weakpassword' }));

        expect(JSON.stringify(response.body)).not.toContain('weakpassword');
      },
    );

    it('currently returns the rejected password inside the errors array', async () => {
      // Companion to TC-NFR-03-02: pins the actual behaviour.
      const response = await client
        .post('/api/auth/register')
        .send(buildUser({ password: 'weakpassword' }));

      expect(response.body.errors[0].value).toBe('weakpassword');
    });
  });

  describe('privilege escalation', () => {
    testCase.failing(
      {
        id: 'TC-NFR-03-01',
        name: 'Self-registration permits an unauthenticated caller to claim the admin role',
        requirement: 'NFR-03',
        type: 'Integration',
        priority: 'P1',
        preconditions: 'None',
        input: 'POST /api/auth/register with role "admin" and no authentication',
        expected: 'The account SHOULD be created as a student, or the request refused',
        defect: 'DEFECT-11',
      },
      async () => {
        // OWASP A01 (Broken Access Control). The role field is accepted from an
        // anonymous request body and passed straight to User.create, so anyone
        // who can reach the public registration endpoint can mint an
        // administrator. This states the required behaviour; `testCase.failing`
        // records that it does not hold and will break once it is fixed.
        const response = await client.post('/api/auth/register').send(buildUser({ role: 'admin' }));

        expect(response.body.user?.role).not.toBe('admin');
      },
    );

    it('currently grants the admin role that an anonymous caller asks for', async () => {
      // The companion to TC-NFR-03-01: pins the actual behaviour so the defect
      // register stays accurate and the regression is unambiguous.
      const response = await client.post('/api/auth/register').send(buildUser({ role: 'admin' }));

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('admin');
    });
  });
});
