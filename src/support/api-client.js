/**
 * Supertest wrapper with endpoint-coverage recording.
 *
 * SENG 34213 §6.4 requires that *100 % of API endpoints have at least one
 * integration test*, and suggests tracking this by hand in the test register.
 * Hand-maintained checklists rot the moment someone adds a route, so this
 * harness measures it instead:
 *
 *   1. `scripts/extract-endpoints.js` parses the application's route files and
 *      `server.js` mount points into `reports/endpoint-inventory.json`.
 *   2. Every request made through this client is appended to a per-worker
 *      journal in `reports/.endpoint-hits/`.
 *   3. `scripts/check-endpoint-coverage.js` joins the two and fails the build
 *      when any endpoint was never exercised.
 *
 * Requests made with raw `supertest(app)` are invisible to this — always use
 * `api(app)` in integration tests.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const supertest = require('supertest');

const { REPO_ROOT } = require('./sut');

const HITS_DIR = path.join(REPO_ROOT, 'reports', '.endpoint-hits');
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** In-memory journal, flushed once per worker at exit. */
const hits = [];
let flushRegistered = false;

/**
 * A journal filename that is unique per test FILE, not merely per worker.
 *
 * Jest gives every test file its own module registry, so this module's
 * in-memory buffer is per-file even though several files share one worker
 * process. Keying only on the worker id would make each file overwrite the
 * previous file's journal, and all but the last would be lost.
 */
function journalName(prefix) {
  const state = typeof expect !== 'undefined' && expect.getState ? expect.getState() : null;
  const testPath = (state && state.testPath) || `unknown-${process.pid}`;
  const slug = path
    .relative(REPO_ROOT, testPath)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${prefix}-${slug}.json`;
}

function journalPath() {
  const worker = process.env.JEST_WORKER_ID || '1';
  return path.join(HITS_DIR, journalName(`w${worker}`));
}

function flush() {
  if (hits.length === 0) return;
  fs.mkdirSync(HITS_DIR, { recursive: true });
  fs.writeFileSync(journalPath(), JSON.stringify(hits, null, 0));
}

function registerFlush() {
  if (flushRegistered) return;
  flushRegistered = true;
  // Jest tears its workers down without running `exit` handlers reliably, so
  // the journal is flushed from `afterAll` in config/setup/integration.setup.js
  // — once per test file, rewriting this worker's cumulative journal. The exit
  // hook stays as a backstop for anything that runs outside Jest.
  process.on('exit', flush);
}

function record(method, url, status) {
  registerFlush();
  hits.push({
    method: method.toUpperCase(),
    // Query strings are irrelevant to route identity and would explode the
    // journal, so they are stripped before recording.
    path: String(url).split('?')[0],
    status,
    suite: expect.getState?.().testPath
      ? path.relative(REPO_ROOT, expect.getState().testPath)
      : undefined,
    test: expect.getState?.().currentTestName,
  });
}

/**
 * Wrap a Supertest agent so each verb records the endpoint it exercised.
 *
 * The returned object is API-compatible with `supertest(app)`: the value from
 * `.get(url)` is the real Supertest `Test`, so `.set()`, `.send()`,
 * `.expect()`, `.field()`, `.attach()` and `await` all behave normally.
 *
 * @param {import('express').Express} app
 * @returns {Record<string, (url: string) => import('supertest').Test>}
 */
function api(app) {
  const agent = supertest(app);
  const wrapped = {};

  for (const method of HTTP_METHODS) {
    wrapped[method] = (url) => {
      const test = agent[method](url);

      // `Test#end` is the single funnel every Supertest invocation passes
      // through — including `await test`, which calls `then` → `end`. Wrapping
      // it captures the status without changing any caller's control flow.
      const originalEnd = test.end.bind(test);
      test.end = (callback) =>
        originalEnd((err, res) => {
          record(method, url, res ? res.status : 0);
          if (callback) callback(err, res);
        });

      return test;
    };
  }

  wrapped.agent = agent;
  return wrapped;
}

/** Clear all recorded hits. Used by the harness's own tests. */
function resetHits() {
  hits.length = 0;
}

module.exports = { api, flush, resetHits, HITS_DIR, hits };
