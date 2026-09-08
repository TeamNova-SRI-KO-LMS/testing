/**
 * Integration tests — system endpoints and application-wide middleware.
 *
 * Endpoints: GET /health, GET /api/health, GET /api/test,
 *            the Choreo deployment aliases, and the catch-all 404 handler.
 *
 * Requirements: FR-25 (Health & Observability), NFR-02 (Availability),
 * NFR-03 (Security).
 *
 * These endpoints are what the deployment platform polls to decide whether the
 * service is alive, so a regression here takes the whole product down even when
 * every feature works.
 */

'use strict';

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const database = require('@support/database');

const client = api(loadApp());

describe('GET /health', () => {
  testCase(
    {
      id: 'TC-FR-25-01',
      name: 'The platform health probe reports OK without authentication',
      requirement: 'FR-25',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The service is running and connected to a database',
      input: 'GET /health with no Authorization header',
      expected: 'HTTP 200; status "OK"; a version, a timestamp and the database state',
    },
    async () => {
      const response = await client.get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('OK');
      expect(response.body.version).toBeDefined();
      expect(response.body.timestamp).toBeRecentTimestamp();
      expect(response.body.database.status).toBe('Connected');
    },
  );

  testCase(
    {
      id: 'TC-NFR-03-11',
      name: 'The health probe does not disclose the database connection string',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'MONGODB_URI is configured',
      input: 'GET /health',
      expected: 'The response reports only whether the URI is configured, never its value',
    },
    async () => {
      // A health endpoint is unauthenticated by design; anything it prints is
      // public. Echoing the URI would publish the database credentials
      // (OWASP A05 / A09).
      const response = await client.get('/health');

      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/mongodb(\+srv)?:\/\//);
      expect(body).not.toContain(database.uri);
      expect(response.body.database.uri).toMatch(/^(Configured|Not configured)$/);
    },
  );

  it('does not disclose the JWT or session secret', async () => {
    const response = await client.get('/health');

    const body = JSON.stringify(response.body);
    expect(body).not.toContain(process.env.JWT_SECRET);
    expect(body).not.toContain(process.env.SESSION_SECRET);
  });
});

describe('GET /api/health', () => {
  testCase(
    {
      id: 'TC-FR-25-02',
      name: 'The API health endpoint reports the database and feature status',
      requirement: 'FR-25',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'The service is connected to a database',
      input: 'GET /api/health',
      expected: 'HTTP 200; success=true; mongodb "Connected"; the feature availability map',
    },
    async () => {
      const response = await client.get('/api/health');

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.mongodb).toBe('Connected');
      expect(response.body.features).toMatchObject({
        subscriptions: 'Available',
        payments: 'Available',
        courseManagement: 'Available',
        userManagement: 'Available',
      });
    },
  );

  it('is reachable without authentication', async () => {
    // A probe that needs a token is useless to an orchestrator.
    const response = await client.get('/api/health');

    expect(response.status).toBe(200);
  });
});

describe('GET /api/test', () => {
  testCase(
    {
      id: 'TC-FR-25-03',
      name: 'The routing smoke endpoint confirms the API is mounted',
      requirement: 'FR-25',
      type: 'Integration',
      priority: 'P3',
      preconditions: 'None',
      input: 'GET /api/test',
      expected: 'HTTP 200; success=true; the path and method are echoed back',
    },
    async () => {
      const response = await client.get('/api/test');

      expect(response).toBeSuccessfulResponse(200);
      expect(response.body.path).toBe('/api/test');
      expect(response.body.method).toBe('GET');
    },
  );
});

describe('unknown routes', () => {
  testCase(
    {
      id: 'TC-FR-25-04',
      name: 'An unknown route returns a JSON 404 rather than an HTML error page',
      requirement: 'FR-25',
      type: 'Integration',
      priority: 'P2',
      preconditions: 'None',
      input: 'GET /api/this-route-does-not-exist',
      expected: 'HTTP 404; success=false; message "Route not found"; content type JSON',
    },
    async () => {
      // The frontend parses every error as JSON; an HTML fallback would surface
      // as an unhelpful parse error in the browser.
      const response = await client.get('/api/this-route-does-not-exist');

      expect(response).toBeErrorResponse(404, 'Route not found');
      expect(response.headers['content-type']).toMatch(/application\/json/);
    },
  );

  it.each(['post', 'put', 'delete'])('returns 404 for an unknown %s route', async (method) => {
    const response = await client[method]('/api/nowhere');

    expect(response.status).toBe(404);
  });

  it('returns 404 rather than 500 for an unknown top-level path', async () => {
    const response = await client.get('/definitely-not-a-route');

    expect(response.status).toBe(404);
  });
});

describe('security headers', () => {
  testCase(
    {
      id: 'TC-NFR-03-12',
      name: 'Every response carries the baseline security headers',
      requirement: 'NFR-03',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'None',
      input: 'GET /api/health',
      expected:
        'X-Frame-Options DENY, X-Content-Type-Options nosniff, a Content-Security-Policy, and no X-Powered-By',
    },
    async () => {
      const response = await client.get('/api/health');

      // OWASP A05 (Security Misconfiguration).
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toBeDefined();
      // Advertising the server technology only helps an attacker choose an exploit.
      expect(response.headers['x-powered-by']).toBeUndefined();
    },
  );

  it('applies the headers to error responses too', async () => {
    const response = await client.get('/api/nowhere');

    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
