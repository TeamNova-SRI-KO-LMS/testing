/**
 * Loads the SRI-KO LMS Express application into the test process.
 *
 * `server.js` is written to be testable: it exports the Express `app` and
 * honours two environment flags —
 *
 *   SKIP_SERVER=true  do not call `listen()`, so Supertest can bind its own
 *                     ephemeral port per request
 *   SKIP_DB=true      do not open its own Mongo connection, so the harness
 *                     decides which database the application talks to
 *
 * Everything else this module does is about making the application's runtime
 * environment *deterministic*, because several behaviours branch on it: CORS
 * origins, cookie `secure`, static-asset serving, and whether error responses
 * leak `error.message`.
 */

'use strict';

const { requireFromSut, resolveFromSut, sutPath, config } = require('./sut');

let cachedApp = null;

/**
 * Replace the application's rate limiter with a pass-through.
 *
 * The application applies a global 2000-request / 15-minute limit to `/api/`.
 * The limiter's memory store lives for the lifetime of the Express app, so a
 * long integration file would eventually start receiving 429s that have
 * nothing to do with the behaviour under test — a classic source of tests that
 * pass alone and fail in a full run.
 *
 * Functional suites therefore load the app with the limiter neutralised, and
 * `tests/security/rate-limiting.security.test.js` loads it *un*-neutralised to
 * prove the control is real (OWASP A04/A07 evidence). The stub is installed in
 * `require.cache` before `server.js` is loaded, so the application picks it up
 * without any modification to application code.
 *
 * @returns {boolean} whether the stub was installed
 */
function stubRateLimiter() {
  let modulePath;
  try {
    modulePath = resolveFromSut('express-rate-limit');
  } catch {
    return false; // Application does not use a rate limiter — nothing to do.
  }

  const passthrough = () => (req, res, next) => next();
  passthrough.default = passthrough;
  passthrough.rateLimit = passthrough;
  passthrough.MemoryStore = class MemoryStore {};
  passthrough.__isTestStub = true;

  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: passthrough,
    children: [],
    paths: [],
  };
  return true;
}

/** Silence the application's very chatty console during test runs. */
function muteApplicationLogging() {
  if (process.env.SUT_VERBOSE === 'true') return () => {};

  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
  };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};

  return () => {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
  };
}

/**
 * Load and return the application's Express instance.
 *
 * @param {object}  [options]
 * @param {boolean} [options.rateLimit=false] keep the real rate limiter
 * @param {object}  [options.env]             extra environment overrides
 * @param {boolean} [options.fresh=false]     bypass the per-file cache
 * @returns {import('express').Express}
 */
function loadApp(options = {}) {
  const { rateLimit = false, env = {}, fresh = false } = options;

  if (cachedApp && !fresh && Object.keys(env).length === 0) {
    return cachedApp;
  }

  // Applied before `server.js` is required: it reads most of these at module
  // scope. `dotenv` never overwrites variables that are already set, so these
  // win over the application's own config.*.env files.
  Object.assign(process.env, config.sutEnv, env);

  if (!rateLimit && process.env.RATE_LIMIT_IN_TESTS !== 'true') {
    stubRateLimiter();
  }

  const restoreLogging = muteApplicationLogging();
  let app;
  try {
    app = requireFromSut('./server.js');
  } finally {
    restoreLogging();
  }

  if (typeof app !== 'function') {
    throw new Error(
      `Expected ${sutPath('server.js')} to export an Express app, got ${typeof app}. ` +
        'The application must end with `module.exports = app;`.',
    );
  }

  if (!fresh && Object.keys(env).length === 0) {
    cachedApp = app;
  }
  return app;
}

/** Forget the cached app so the next `loadApp()` rebuilds it. */
function resetApp() {
  cachedApp = null;
}

module.exports = { loadApp, resetApp, stubRateLimiter };
