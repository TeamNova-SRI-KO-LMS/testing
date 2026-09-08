/**
 * OWASP A01 — Broken Access Control.
 *
 * SENG 34213 §8.1 requires "role-based access checks on every endpoint; tests
 * verify unauthorised access returns 403".
 *
 * Rather than hand-listing the protected endpoints — a list that goes stale the
 * first time somebody adds a route — this suite is driven by
 * `reports/endpoint-inventory.json`, which `scripts/extract-endpoints.js`
 * derives from the application source. Every endpoint the application declares
 * as admin-only is probed with no token and with a student token, so a new
 * admin route is covered the moment it is written.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { REPO_ROOT } = require('@support/sut');
const auth = require('@support/auth');

const client = api(loadApp());

const INVENTORY = path.join(REPO_ROOT, 'reports', 'endpoint-inventory.json');

/** A syntactically valid ObjectId that matches no document. */
const PROBE_ID = '507f1f77bcf86cd799439099';

/**
 * Endpoints that answer with something other than 403 for a reason already
 * recorded in docs/testing/DEFECT_REGISTER.md.
 *
 * These are NOT exempt from the security property itself — the "returns no 2xx"
 * assertion below covers every endpoint without exception. They are exempt only
 * from the *status code convention*, so one known routing defect does not mask
 * a genuine access-control regression appearing elsewhere in the table.
 */
const KNOWN_STATUS_DEVIATIONS = new Map([
  [
    'GET /api/notifications/target-users',
    {
      status: 500,
      defect: 'DEFECT-24',
      reason:
        'Shadowed by GET /api/notifications/:id, so the path is cast as an id and ' +
        'fails before the authorize() guard is reached. No data is disclosed.',
    },
  ],
]);

function loadEndpoints() {
  if (!fs.existsSync(INVENTORY)) {
    throw new Error(
      'reports/endpoint-inventory.json is missing. Run `npm run sut:endpoints` before ' +
        'the security suite — it is what makes this suite exhaustive.',
    );
  }
  return JSON.parse(fs.readFileSync(INVENTORY, 'utf8')).endpoints.filter(
    (endpoint) => !endpoint.alias && !endpoint.catchAll,
  );
}

const endpoints = loadEndpoints();
const adminEndpoints = endpoints.filter((endpoint) => endpoint.access === 'admin');
const protectedEndpoints = endpoints.filter((endpoint) => endpoint.access !== 'public');

/** Substitute a probe id for every `:param` segment. */
const concretePath = (routePath) => routePath.replace(/:[^/]+/g, PROBE_ID);

const asCase = (endpoint) => [
  `${endpoint.method} ${endpoint.path}`,
  endpoint.method.toLowerCase(),
  concretePath(endpoint.path),
];

describe('OWASP A01 — Broken Access Control', () => {
  it('has an endpoint inventory to work from', () => {
    // A silently empty inventory would make every table below vacuously pass.
    expect(endpoints.length).toBeGreaterThan(50);
    expect(adminEndpoints.length).toBeGreaterThan(20);
  });

  describe('every administrative endpoint refuses an anonymous caller', () => {
    testCase(
      {
        id: 'TC-SEC-A01-01',
        name: 'No administrative endpoint responds to an unauthenticated request',
        requirement: 'NFR-03',
        type: 'Security',
        priority: 'P1',
        preconditions: 'The endpoint inventory has been generated from the application source',
        input: 'Every admin-only endpoint called with no Authorization header',
        expected: 'Every one answers HTTP 401 and returns no application data',
      },
      async () => {
        const leaks = [];

        for (const endpoint of adminEndpoints) {
          const method = endpoint.method.toLowerCase();
          // eslint-disable-next-line no-await-in-loop
          const response = await client[method](concretePath(endpoint.path)).send({});
          if (response.status !== 401) {
            leaks.push(`${endpoint.method} ${endpoint.path} → ${response.status}`);
          }
        }

        expect(leaks).toEqual([]);
      },
      120000,
    );
  });

  describe('every administrative endpoint refuses a student', () => {
    testCase(
      {
        id: 'TC-SEC-A01-02',
        name: 'No administrative endpoint responds to a student token',
        requirement: 'NFR-03',
        type: 'Security',
        priority: 'P1',
        preconditions: 'A valid student token and the generated endpoint inventory',
        input: 'Every admin-only endpoint called with a student’s Authorization header',
        expected: 'Every one answers HTTP 403 and returns no application data',
      },
      async () => {
        // Privilege escalation is the failure this catches: a student holding a
        // perfectly valid token must not reach an administrative handler.
        const student = await auth.asStudent();
        const succeeded = [];
        const unexpectedStatus = [];

        for (const endpoint of adminEndpoints) {
          const key = `${endpoint.method} ${endpoint.path}`;
          const method = endpoint.method.toLowerCase();
          // eslint-disable-next-line no-await-in-loop
          const response = await client[method](concretePath(endpoint.path))
            .set('Authorization', student.authHeader)
            .send({});

          // The security property, asserted with no exceptions whatsoever:
          // an administrative handler must never succeed for a student.
          if (response.status >= 200 && response.status < 300) {
            succeeded.push(`${key} → ${response.status}`);
          }

          const known = KNOWN_STATUS_DEVIATIONS.get(key);
          const expectedStatus = known ? known.status : 403;
          if (response.status !== expectedStatus) {
            unexpectedStatus.push(`${key} → ${response.status} (expected ${expectedStatus})`);
          }
        }

        expect(succeeded).toEqual([]);
        expect(unexpectedStatus).toEqual([]);
      },
      120000,
    );

    it('documents every status deviation against an entry in the defect register', () => {
      // Keeps the allow-list honest: an undocumented exception cannot be added
      // quietly to make a failing security assertion pass.
      for (const [endpoint, deviation] of KNOWN_STATUS_DEVIATIONS) {
        expect(deviation.defect).toMatch(/^DEFECT-\d+$/);
        expect(deviation.reason.length).toBeGreaterThan(20);
        expect(adminEndpoints.some((e) => `${e.method} ${e.path}` === endpoint)).toBe(true);
      }
    });
  });

  describe('every protected endpoint refuses an anonymous caller', () => {
    testCase(
      {
        id: 'TC-SEC-A01-03',
        name: 'No endpoint requiring authentication responds without a token',
        requirement: 'NFR-03',
        type: 'Security',
        priority: 'P1',
        preconditions: 'The generated endpoint inventory',
        input: 'Every non-public endpoint called with no Authorization header',
        expected: 'Every one answers HTTP 401',
      },
      async () => {
        const leaks = [];

        for (const endpoint of protectedEndpoints) {
          const method = endpoint.method.toLowerCase();
          // eslint-disable-next-line no-await-in-loop
          const response = await client[method](concretePath(endpoint.path)).send({});
          if (response.status !== 401) {
            leaks.push(`${endpoint.method} ${endpoint.path} → ${response.status}`);
          }
        }

        expect(leaks).toEqual([]);
      },
      120000,
    );
  });

  describe('forged and expired credentials', () => {
    it.each(protectedEndpoints.slice(0, 25).map(asCase))(
      '%s rejects a token signed with the wrong secret',
      async (_label, method, url) => {
        const forged = auth.signTokenWithWrongSecret(PROBE_ID);

        const response = await client[method](url)
          .set('Authorization', `Bearer ${forged}`)
          .send({});

        expect(response.status).toBe(401);
      },
    );

    it.each(protectedEndpoints.slice(0, 25).map(asCase))(
      '%s rejects an expired token',
      async (_label, method, url) => {
        const expired = auth.signExpiredToken(PROBE_ID);

        const response = await client[method](url)
          .set('Authorization', `Bearer ${expired}`)
          .send({});

        expect(response.status).toBe(401);
      },
    );

    testCase(
      {
        id: 'TC-SEC-A01-04',
        name: 'A token with a tampered payload is rejected',
        requirement: 'NFR-03',
        type: 'Security',
        priority: 'P1',
        preconditions: 'A valid student token',
        input: 'The token’s payload segment is re-encoded with a different id, signature unchanged',
        expected: 'HTTP 401 — the HMAC no longer matches',
      },
      async () => {
        const student = await auth.asStudent();
        const [header, , signature] = student.token.split('.');
        const forgedPayload = Buffer.from(JSON.stringify({ id: PROBE_ID }))
          .toString('base64url')
          .replace(/=+$/, '');

        const response = await client
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${header}.${forgedPayload}.${signature}`);

        expect(response).toBeUnauthorised();
      },
    );

    testCase(
      {
        id: 'TC-SEC-A01-05',
        name: 'A token using the "none" algorithm is rejected',
        requirement: 'NFR-03',
        type: 'Security',
        priority: 'P1',
        preconditions: 'None',
        input: 'A Bearer token with header {"alg":"none"} and an empty signature',
        expected: 'HTTP 401 — unsigned tokens are never trusted',
      },
      async () => {
        // The classic JWT bypass: if the verifier honours the token's own
        // algorithm claim, an attacker signs nothing and becomes anyone.
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
          'base64url',
        );
        const payload = Buffer.from(JSON.stringify({ id: PROBE_ID })).toString('base64url');

        const response = await client
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${header}.${payload}.`);

        expect(response).toBeUnauthorised();
      },
    );
  });

  describe('horizontal access control between peers', () => {
    testCase(
      {
        id: 'TC-SEC-A01-06',
        name: 'A student cannot reach another student’s records by guessing an id',
        requirement: 'NFR-03',
        type: 'Security',
        priority: 'P1',
        preconditions: 'Two students, each with their own payment, invoice and certificate',
        input: 'The first student requests the second student’s resources by id',
        expected: 'Every request answers 403 or 404 — never 200 with the other student’s data',
      },
      async () => {
        const factories = require('@factories');
        const attacker = await auth.asStudent();
        const victim = await auth.asStudent();

        const payment = await factories.createPayment({ user: victim.user._id });
        const certificate = await factories.createCertificate({ student: victim.user._id });

        const probes = [
          ['get', `/api/users/${victim.user._id}`],
          ['get', `/api/payments/${payment._id}`],
          ['get', `/api/subscriptions/invoice/${payment._id}`],
          ['get', `/api/certificates/${certificate._id}`],
          ['post', `/api/certificates/${certificate._id}/mark-viewed`],
        ];

        for (const [method, url] of probes) {
          // eslint-disable-next-line no-await-in-loop
          const response = await client[method](url)
            .set('Authorization', attacker.authHeader)
            .send({});

          expect([403, 404]).toContain(response.status);
        }
      },
    );
  });
});
