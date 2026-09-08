/**
 * OWASP A03 — Injection, and the application's global input filter.
 *
 * SENG 34213 §8.1 requires "parameterised queries or ORM used throughout; input
 * validated and sanitised".
 *
 * MongoDB is not SQL, so the injection that matters here is *operator*
 * injection: a JSON body such as `{"email": {"$ne": null}}` turns a lookup into
 * a match-anything query. Mongoose casts against the schema, which blocks most
 * of it — these tests prove that, rather than assuming it.
 *
 * `server.js` also installs a global regular-expression filter that is *meant*
 * to cover every body and query string. The final block establishes what it
 * actually does: nothing at all for bodies, and a wide net of false positives
 * for query strings.
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { requireFromSut } = require('@support/sut');
const auth = require('@support/auth');
const { createUser, createCourse, buildUser, VALID_PASSWORD } = require('@factories');

const client = api(loadApp());
const User = requireFromSut('./models/User');

describe('OWASP A03 — NoSQL operator injection', () => {
  testCase(
    {
      id: 'TC-SEC-A03-01',
      name: 'An operator object in the login email does not authenticate anyone',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'A registered user exists',
      input: 'POST /api/auth/login with email {"$ne": null} and password {"$ne": null}',
      expected: 'No token is issued; the response is not a 200 success',
    },
    async () => {
      // The classic MongoDB authentication bypass. `findOne({ email: {$ne:null} })`
      // would return the first user in the collection, and a matching operator
      // in the password position would skip the bcrypt comparison entirely.
      await createUser();

      const response = await client
        .post('/api/auth/login')
        .send({ email: { $ne: null }, password: { $ne: null } });

      expect(response.body.token).toBeUndefined();
      expect(response.status).not.toBe(200);
    },
  );

  it.each([
    ['$gt', { $gt: '' }],
    ['$ne', { $ne: null }],
    ['$regex', { $regex: '.*' }],
    ['$exists', { $exists: true }],
    ['$in', { $in: ['a@b.lk', 'c@d.lk'] }],
  ])('rejects a login whose email is an %s operator object', async (_label, payload) => {
    await createUser();

    const response = await client
      .post('/api/auth/login')
      .send({ email: payload, password: VALID_PASSWORD });

    expect(response.body.token).toBeUndefined();
    expect(response.status).not.toBe(200);
  });

  testCase(
    {
      id: 'TC-SEC-A03-02',
      name: 'An operator object in a path parameter does not match any document',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'A course exists',
      input: 'GET /api/courses/%7B%22%24ne%22%3Anull%7D — an encoded operator object as the id',
      expected: 'No course is returned',
    },
    async () => {
      await createCourse();

      const response = await client.get(`/api/courses/${encodeURIComponent('{"$ne":null}')}`);

      expect(response.status).not.toBe(200);
      expect(response.body.course).toBeUndefined();
    },
  );

  testCase(
    {
      id: 'TC-SEC-A03-03',
      name: 'Registration cannot inject fields the schema does not declare',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'None',
      input: 'POST /api/auth/register with extra properties including __proto__ and isAdmin',
      expected: 'HTTP 201; the stored document contains none of the injected fields',
    },
    async () => {
      // Mongoose's strict mode drops unknown paths; without it, a client could
      // set fields the application never intended to expose.
      const payload = {
        ...buildUser(),
        isAdmin: true,
        __proto__: { polluted: true },
        emailVerified: true,
        enrolledCourses: ['507f1f77bcf86cd799439011'],
      };

      const response = await client.post('/api/auth/register').send(payload);

      expect(response.status).toBe(201);
      const stored = await User.findById(response.body.user.id).lean();
      expect(stored.isAdmin).toBeUndefined();
      expect(stored.polluted).toBeUndefined();
      expect({}.polluted).toBeUndefined();
    },
  );

  it('does not let a nested operator reach the course search query', async () => {
    await createCourse({ title: 'Findable Korean Course' });

    const response = await client.get('/api/courses').query({ 'search[$ne]': '' });

    // Whatever happens, it must not be a 500 that reveals a driver stack trace.
    expect(response.status).not.toBeGreaterThanOrEqual(500);
  });
});

describe('OWASP A03 — cross-site scripting payloads are stored inertly', () => {
  testCase(
    {
      id: 'TC-SEC-A03-04',
      name: 'A script payload in a profile field is stored and returned as plain text',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P2',
      preconditions: 'An authenticated student',
      input: 'PUT /api/users/profile with a <script> tag in the bio',
      expected:
        'The value round-trips as JSON text with a JSON content type; it is never rendered as HTML by the API',
    },
    async () => {
      // The API is a JSON service, so it is not the XSS sink — the frontend is.
      // What matters here is that the value is not silently transformed into
      // something that *looks* safe, which would hide the risk from reviewers.
      const student = await auth.asStudent();
      const payload = '<script>alert(document.cookie)</script>';

      const response = await client
        .put('/api/users/profile')
        .set('Authorization', student.authHeader)
        .send({ bio: payload });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body.user.bio).toBe(payload);
    },
  );

  it('sets a Content-Security-Policy that forbids remote scripts', async () => {
    const response = await client.get('/api/health');

    const csp = response.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
  });
});

describe('the global input filter in server.js', () => {
  /**
   * `server.js` installs a regular-expression filter over `req.body` and
   * `req.query` at line 101 and rejects anything matching
   *
   *   /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|OR|AND)\b)|(;|--|\/\*|\*\/)/i
   *
   * Two separate problems follow, and the tests below establish both with
   * evidence rather than by reading the code:
   *
   *   DEFECT-30  The filter is mounted BEFORE `express.json()` (line 155), so
   *              `req.body` is still undefined when it runs. Request bodies are
   *              never inspected at all — the control a reviewer would credit
   *              for injection defence does not exist.
   *
   *   DEFECT-01  Query strings ARE inspected, and the pattern matches the
   *              English words "or" and "and", any hyphenated phrase, and any
   *              semicolon. A large share of legitimate search terms is
   *              rejected with "Invalid input detected".
   *
   * Mongoose already parameterises every query, so the recommended fix is to
   * remove the filter and rely on express-validator plus schema casting —
   * adding an operator-stripping middleware if `$`-prefixed keys are a concern.
   */

  describe('request bodies (DEFECT-30 — the filter never runs)', () => {
    it('accepts a body containing SQL punctuation that the pattern would match', async () => {
      const response = await client
        .post('/api/auth/login')
        .send({ email: "admin'--@sriko.lk", password: VALID_PASSWORD });

      // 401 from the credential check, not 400 from the filter: the filter
      // never saw the body.
      expect(response.status).toBe(401);
      expect(response.body.message).not.toBe('Invalid input detected');
    });

    it.each([
      ['the word "and"', 'Grammar and vocabulary for beginners over ten weeks.'],
      ['the word "or"', 'Choose the morning or the evening class for this course.'],
      ['a double hyphen', 'A ten-week course -- with a break in the middle of it.'],
      ['a semicolon', 'Week one: hangul; week two: greetings and numbers.'],
      ['a DROP keyword', 'We DROP the lowest quiz score at the end of term.'],
    ])('accepts a course description containing %s', async (_label, description) => {
      // The silver lining of DEFECT-30: because bodies are unfiltered, ordinary
      // prose survives. Fixing the ordering without also fixing the pattern
      // would immediately break all five of these.
      const instructor = await auth.asInstructor();

      const response = await client
        .post('/api/courses')
        .set('Authorization', instructor.authHeader)
        .send({
          title: 'Korean Language Course',
          description,
          category: 'other',
          level: 'beginner',
          duration: 10,
          price: 5000,
        });

      expect(response.status).toBe(201);
    });

    it('leaves body defence entirely to express-validator and the schema', async () => {
      // With the filter inert, validation is the only thing between the client
      // and the database — which is exactly why the validation suite is
      // treated as critical business logic at 90 % coverage.
      const response = await client
        .post('/api/auth/register')
        .send({ ...buildUser(), email: 'not-an-email' });

      expect(response).toFailValidation('email');
    });
  });

  describe('query strings (DEFECT-01 — the filter runs and over-matches)', () => {
    testCase(
      {
        id: 'TC-SEC-A03-05',
        name: 'A query string containing SQL keywords is rejected',
        requirement: 'NFR-03',
        type: 'Security',
        priority: 'P2',
        preconditions: 'None',
        input: 'GET /api/courses?search=drop table',
        expected: 'HTTP 400 "Invalid input detected"',
      },
      async () => {
        const response = await client.get('/api/courses?search=drop%20table');

        expect(response).toBeErrorResponse(400, 'Invalid input detected');
      },
    );

    testCase.failing(
      {
        id: 'TC-SEC-A03-06',
        name: 'A legitimate search term is not rejected as an attack',
        requirement: 'NFR-03',
        type: 'Security',
        priority: 'P1',
        preconditions: 'None',
        input: 'GET /api/courses?search=grammar and vocabulary',
        expected: 'HTTP 200 — the word "and" is not an attack',
        defect: 'DEFECT-01',
      },
      async () => {
        const response = await client.get('/api/courses?search=grammar%20and%20vocabulary');

        expect(response.status).toBe(200);
      },
    );

    it.each([
      ['the word "and"', 'grammar and vocabulary'],
      ['the word "or"', 'beginner or intermediate'],
      ['a hyphenated phrase', 'ten--week'],
      ['a semicolon', 'hangul; greetings'],
      ['the word "update"', 'syllabus update'],
    ])('currently rejects a search for %s', async (_label, term) => {
      // Companion to TC-SEC-A03-06: pins the breadth of the false-positive so
      // the impact recorded in the defect register is evidence-backed.
      const response = await client.get(`/api/courses?search=${encodeURIComponent(term)}`);

      expect(response).toBeErrorResponse(400, 'Invalid input detected');
    });

    it('accepts a search term that trips none of the patterns', async () => {
      await createCourse({ title: 'Hangul Foundations' });

      const response = await client.get('/api/courses?search=hangul');

      expect(response.status).toBe(200);
      expect(response.body.courses).toHaveLength(1);
    });
  });
});
