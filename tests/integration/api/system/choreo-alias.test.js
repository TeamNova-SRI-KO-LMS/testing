/**
 * Integration tests — the Choreo deployment aliases.
 *
 * The application is deployed behind a Choreo gateway that prefixes every path
 * with `/choreo-apis/sri-ko-lms-platform/backend/v1`. `server.js` handles this
 * two ways: a rewrite middleware that strips the prefix, and a second mount of
 * the admin router underneath it.
 *
 * These aliases resolve to handlers already covered elsewhere, so
 * `scripts/check-endpoint-coverage.js` excludes them from the 100 % gate. This
 * file covers the mechanism itself, which is the part that can actually break:
 * if the prefix handling regresses, every request in production 404s while
 * every other test in this suite still passes.
 *
 * Requirements: FR-25 (Health & Observability), NFR-02 (Availability).
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const auth = require('@support/auth');

const client = api(loadApp());
const PREFIX = '/choreo-apis/sri-ko-lms-platform/backend/v1';

describe('Choreo deployment prefix', () => {
  testCase(
    {
      id: 'TC-NFR-02-01',
      name: 'The Choreo-prefixed health probe answers like the direct one',
      requirement: 'NFR-02',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'None',
      input: `GET ${PREFIX}/api/health`,
      expected: 'HTTP 200; the same success envelope as GET /api/health',
    },
    async () => {
      const direct = await client.get('/api/health');
      const prefixed = await client.get(`${PREFIX}/api/health`);

      expect(prefixed.status).toBe(direct.status);
      expect(prefixed.body.success).toBe(true);
    },
  );

  it('answers the prefixed platform health probe', async () => {
    const response = await client.get(`${PREFIX}/health`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OK');
  });

  it('answers the prefixed routing smoke endpoint through the standard handler', async () => {
    // The rewrite middleware runs before routing, so the prefix is already
    // gone by the time Express matches. The request lands on the ordinary
    // `/api/test` handler, which is the desired outcome — but it also means the
    // dedicated `app.get('/choreo-apis/.../api/test')` route below it can never
    // run. See DEFECT-27: four such routes in server.js are dead code.
    const response = await client.get(`${PREFIX}/api/test`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.choreo).toBeUndefined();
  });

  it('returns 404 for the prefixed admin smoke endpoint, which has no standard equivalent', async () => {
    // `/choreo-apis/.../api/admin/test` is rewritten to `/api/admin/test`, and
    // adminRoutes declares no `/test` route — so the Choreo-specific handler
    // that would have answered it is unreachable. Same root cause as above.
    const response = await client.get(`${PREFIX}/api/admin/test`);

    expect(response.status).toBe(404);
  });

  testCase(
    {
      id: 'TC-NFR-02-02',
      name: 'The admin router is reachable through the Choreo prefix with the same guards',
      requirement: 'NFR-02',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'An administrator and a student account exist',
      input: `GET ${PREFIX}/api/admin/stats as each role`,
      expected: 'HTTP 200 for the administrator; HTTP 403 for the student',
    },
    async () => {
      // The second mount must not become an authorisation bypass: the aliased
      // path has to enforce exactly the same role checks (OWASP A01).
      const admin = await auth.asAdmin();
      const student = await auth.asStudent();

      const asAdmin = await client
        .get(`${PREFIX}/api/admin/stats`)
        .set('Authorization', admin.authHeader);
      expect(asAdmin).toBeSuccessfulResponse(200);

      const asStudent = await client
        .get(`${PREFIX}/api/admin/stats`)
        .set('Authorization', student.authHeader);
      expect(asStudent).toBeForbidden();
    },
  );

  it('refuses an unauthenticated request through the prefix', async () => {
    const response = await client.get(`${PREFIX}/api/admin/stats`);

    expect(response).toBeUnauthorised();
  });

  it('returns 404 for an unknown path under the prefix', async () => {
    const response = await client.get(`${PREFIX}/api/nowhere`);

    expect(response.status).toBe(404);
  });
});
