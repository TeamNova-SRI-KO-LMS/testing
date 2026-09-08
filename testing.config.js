/**
 * Test-suite configuration for the SRI-KO LMS.
 *
 * This repository is a STANDALONE test repository (see SENG 34213 §3.1 — the
 * `tests` repository holds integration and end-to-end suites that are not
 * co-located with service code). It therefore has to locate the application
 * source — the System Under Test (SUT) — at run time.
 *
 * Resolution order (first match wins) is implemented in `src/support/sut.js`:
 *
 *   1. `SUT_PATH` environment variable                (CI and one-off overrides)
 *   2. `testing.config.local.js` in the repo root     (personal, git-ignored)
 *   3. `.sut/` inside this repository                 (created by `npm run sut:setup`)
 *   4. The `candidatePaths` listed below              (sibling checkouts)
 *
 * Nothing here is secret. Real secrets belong in `.env` (git-ignored) or in
 * GitHub Secrets — see `.env.example` and SENG 34213 §7 "Secrets Management".
 */

'use strict';

module.exports = {
  /**
   * Directories that are searched, in order, for a MERN checkout. A directory
   * qualifies when it contains a backend entry point (`Backend/server.js` or
   * `backend/server.js`). Paths are resolved relative to this repository root.
   */
  candidatePaths: [
    '.sut/SRI-KO_LMS_MERN',
    '.sut',
    '../SRI-KO_LMS_MERN',
    '../../SRI-KO_LMS_MERN',
    '../../../SRI-KO_LMS_MERN',
    '../SRI-KO_LMS_MERN_Platform',
    '../../SRI-KO_LMS_MERN_Platform',
    '../../../SRI-KO_LMS_MERN_Platform',
    '../../SRI-KO_Application_Project/app',
    '../../../SRI-KO_Application_Project/app',
    '../app',
    '../../app',
  ],

  /**
   * Candidate sub-directory names for each tier, tried in order. The project
   * uses capitalised `Backend/` and `Frontend/`; the TeamNova `app` repository
   * uses lower case. Both are supported so the suite runs against either.
   */
  backendDirNames: ['Backend', 'backend', 'server', 'api'],
  frontendDirNames: ['Frontend', 'frontend', 'client', 'web'],

  /**
   * Where `npm run sut:setup` looks for a local archive of the application when
   * no checkout is found. Relative to this repository root.
   */
  sutArchiveCandidates: [
    '../../SRI-KO_LMS_MERN.zip',
    '../../../SRI-KO_LMS_MERN.zip',
    '../SRI-KO_LMS_MERN.zip',
  ],

  /** Git remote used by `npm run sut:setup -- --clone` as a last resort. */
  sutGitRemote: process.env.SUT_GIT_REMOTE || 'https://github.com/TeamNova-SRI-KO-LMS/app.git',
  sutGitRef: process.env.SUT_GIT_REF || 'develop',

  /**
   * Environment injected into the application process/module before it is
   * loaded. `SKIP_SERVER` stops `server.js` calling `listen()` so the Express
   * app can be mounted straight into Supertest; `SKIP_DB` stops it opening its
   * own Mongo connection so the harness can point it at an ephemeral database.
   */
  sutEnv: {
    NODE_ENV: 'test',
    SKIP_SERVER: 'true',
    SKIP_DB: 'true',
    JWT_SECRET: 'seng34213-test-jwt-secret-do-not-use-in-production',
    JWT_EXPIRE: '7d',
    SESSION_SECRET: 'seng34213-test-session-secret-do-not-use-in-production',
    GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
    CORS_ORIGIN: 'http://localhost:5173',
    FRONTEND_URL: 'http://localhost:5173',
    PORT: '0',
  },

  /**
   * Coverage gates. SENG 34213 §6.4:
   *   • 80 % lines/branches for all new code
   *   • 90 % branch coverage for critical business logic
   *   • 100 % of API endpoints exercised by at least one integration test
   */
  coverage: {
    global: { lines: 80, statements: 80, branches: 70, functions: 80 },
    criticalBusinessLogic: { lines: 90, statements: 90, branches: 90, functions: 90 },
    /** Glob fragments (matched against the SUT-relative path) treated as critical. */
    criticalPaths: [
      'middleware/auth.js',
      'middleware/validation.js',
      'models/User.js',
      'models/Subscription.js',
      'models/Payment.js',
      'models/Progress.js',
      'routes/authRoutes.js',
    ],
    endpointCoverage: 100,
  },

  /**
   * Non-functional thresholds asserted by the k6 performance suite
   * (`tests/performance/`) and reported in `reports/performance-report.md`.
   */
  performance: {
    baseUrl: process.env.PERF_BASE_URL || 'http://localhost:5001',
    thresholds: {
      httpReqFailedRate: 0.01, // < 1 % of requests may fail
      httpReqDurationP95: 500, // ms
      httpReqDurationP99: 1200, // ms
      loginDurationP95: 800, // ms — bcrypt makes auth intentionally slower
    },
  },

  /** Base URLs used by the Playwright end-to-end suite. */
  e2e: {
    frontendUrl: process.env.E2E_FRONTEND_URL || 'http://localhost:5173',
    backendUrl: process.env.E2E_BACKEND_URL || 'http://localhost:5001',
  },
};
