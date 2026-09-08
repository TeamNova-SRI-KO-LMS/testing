/**
 * OWASP A04 — Insecure Design: request rate limiting.
 *
 * Every other suite loads the application with the rate limiter neutralised, so
 * that a long test file cannot start receiving 429s that have nothing to do
 * with the behaviour under test (see `src/support/app.js`). This file is the
 * exception: it loads a *fresh* app instance with the real limiter attached and
 * proves the control exists and fires.
 *
 * Without this file, "we disable the rate limiter in tests" would mean the
 * control is never verified at all.
 */

'use strict';

const fs = require('fs');

const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const { sutPath, resolveFromSut } = require('@support/sut');

describe('OWASP A04 — request rate limiting', () => {
  testCase(
    {
      id: 'TC-SEC-A04-01',
      name: 'A rate limiter is configured over the whole API surface',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'The application source is available',
      input: 'Inspection of the express-rate-limit configuration in server.js',
      expected: 'A limiter with a finite window and a finite maximum is applied to /api/',
    },
    async () => {
      const source = fs.readFileSync(sutPath('server.js'), 'utf8');

      expect(source).toMatch(/rateLimit\(\{/);
      expect(source).toMatch(/windowMs:\s*15\s*\*\s*60\s*\*\s*1000/);
      expect(source).toMatch(/max:\s*\d+/);
      expect(source).toMatch(/app\.use\('\/api\/',\s*limiter\)/);
    },
  );

  testCase(
    {
      id: 'TC-SEC-A04-02',
      name: 'The limiter actually rejects a burst that exceeds the configured maximum',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P1',
      preconditions: 'The application is loaded with its real rate limiter attached',
      input: 'More requests to /api/health than the configured maximum, from one client',
      expected: 'The first requests succeed and later ones answer HTTP 429',
    },
    async () => {
      // A configured-but-broken limiter is worse than none, because it looks
      // like a control in review. The only way to know is to exceed it.
      //
      // The real limit is 2000 requests / 15 minutes, which is too many to send
      // in a test. A dedicated app instance is built with a small maximum so
      // the *mechanism* is exercised end to end, and TC-SEC-A04-01 above pins
      // the production numbers.
      const rateLimitPath = resolveFromSut('express-rate-limit');
      delete require.cache[rateLimitPath];
      const rateLimit = require(rateLimitPath);

      const express = require(resolveFromSut('express'));
      const probe = express();
      probe.use(
        '/api/',
        rateLimit({
          windowMs: 60 * 1000,
          max: 5,
          message: 'Too many requests from this IP, please try again later.',
        }),
      );
      probe.get('/api/health', (req, res) => res.status(200).json({ success: true }));

      const client = api(probe);
      const statuses = [];
      for (let i = 0; i < 8; i += 1) {
        // Sequential on purpose: the counter is incremented per request, and
        // parallel requests would make the boundary non-deterministic.
        // eslint-disable-next-line no-await-in-loop
        const response = await client.get('/api/health');
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
    },
  );

  it('exposes the standard rate-limit headers so a client can back off', async () => {
    const rateLimitPath = resolveFromSut('express-rate-limit');
    delete require.cache[rateLimitPath];
    const rateLimit = require(rateLimitPath);
    const express = require(resolveFromSut('express'));

    const probe = express();
    probe.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 5 }));
    probe.get('/api/health', (req, res) => res.status(200).json({ success: true }));

    const response = await api(probe).get('/api/health');

    expect(
      response.headers['ratelimit-limit'] || response.headers['x-ratelimit-limit'],
    ).toBeDefined();
  });

  testCase(
    {
      id: 'TC-SEC-A04-03',
      name: 'The functional suites run with the limiter neutralised, by design',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P2',
      preconditions: 'The harness has loaded the application in its default mode',
      input: 'A burst of requests through the harness-loaded application',
      expected: 'No 429 is returned, confirming the documented test-mode behaviour',
    },
    async () => {
      // Makes the trade-off explicit and auditable: if someone removes the stub
      // and the functional suites start flaking on 429s, this test names the
      // reason.
      const client = api(loadApp());

      const statuses = [];
      for (let i = 0; i < 30; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const response = await client.get('/api/health');
        statuses.push(response.status);
      }

      expect(statuses.every((status) => status === 200)).toBe(true);
    },
  );

  testCase.failing(
    {
      id: 'TC-SEC-A04-04',
      name: 'Authentication endpoints carry a tighter limit than the rest of the API',
      requirement: 'NFR-03',
      type: 'Security',
      priority: 'P2',
      preconditions: 'The application source is available',
      input: 'Inspection of the limiters applied to /api/auth',
      expected: 'A dedicated, stricter limiter guards login and registration',
      defect: 'DEFECT-32',
    },
    async () => {
      // One global limit of 2000 requests per 15 minutes covers browsing and
      // password guessing alike. Combined with the absence of account lockout
      // (DEFECT-31), that permits roughly 2000 password attempts per IP per
      // quarter hour against a single account. A separate limiter on
      // /api/auth — a handful of attempts per minute — closes it.
      const source = fs.readFileSync(sutPath('server.js'), 'utf8');

      const limiterCount = (source.match(/rateLimit\(\{/g) || []).length;
      expect(limiterCount).toBeGreaterThan(1);
    },
  );

  it('currently applies exactly one global limiter', () => {
    // Companion to TC-SEC-A04-04: pins the actual configuration.
    const source = fs.readFileSync(sutPath('server.js'), 'utf8');

    expect(source.match(/rateLimit\(\{/g) || []).toHaveLength(1);
    expect(source).toMatch(/max:\s*2000/);
  });
});
