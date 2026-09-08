/**
 * Playwright configuration for the end-to-end layer.
 *
 * SENG 34213 §6.2 requires E2E coverage of "all happy paths; top 3 critical
 * flows" exercised through the real UI against the real backend.
 *
 * Unlike the Jest layers, which mount the Express app in-process, these tests
 * drive a browser against a running stack. Playwright's `webServer` blocks
 * start both halves and wait for them to answer before the first test runs, so
 * `npm run test:e2e` works from a clean checkout with no manual steps.
 *
 * Set `E2E_BASE_URL` (and skip the servers with `E2E_EXTERNAL=true`) to run the
 * same specs against the deployed staging environment — which is what §9.1
 * requires for the final demonstration.
 */

'use strict';

const path = require('path');

const { defineConfig, devices } = require('@playwright/test');

const { isSutAvailable, resolveSut, config: testingConfig } = require('../src/support/sut');

const ROOT = path.resolve(__dirname, '..');
const sut = isSutAvailable() ? resolveSut() : null;

const FRONTEND_URL = process.env.E2E_FRONTEND_URL || testingConfig.e2e.frontendUrl;
const BACKEND_URL = process.env.E2E_BACKEND_URL || testingConfig.e2e.backendUrl;

/** True when the stack is already running (staging, or a developer's terminals). */
const useExternalStack = process.env.E2E_EXTERNAL === 'true';

const backendPort = new URL(BACKEND_URL).port || '5001';
const frontendPort = new URL(FRONTEND_URL).port || '5173';

/**
 * Boot the application ourselves unless it is already running.
 *
 * The backend gets `MONGODB_URI` from the environment: E2E needs a persistent
 * database that survives across browser navigations, so the in-memory server
 * used by the integration layer is not appropriate here. CI supplies a service
 * container; locally, `npm run test:e2e` uses whatever MONGODB_URI is set, and
 * falls back to a local mongod.
 */
const webServer =
  useExternalStack || !sut
    ? undefined
    : [
        {
          command: 'npm run start',
          cwd: sut.backendDir,
          port: Number(backendPort),
          reuseExistingServer: !process.env.CI,
          timeout: 120000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            NODE_ENV: 'test',
            PORT: backendPort,
            MONGODB_URI: process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27017/sriko_lms_e2e',
            JWT_SECRET: 'seng34213-e2e-jwt-secret',
            JWT_EXPIRE: '7d',
            SESSION_SECRET: 'seng34213-e2e-session-secret',
            CORS_ORIGIN: FRONTEND_URL,
            FRONTEND_URL,
          },
        },
        {
          // `vite preview` serves the production build, which is what the panel
          // will actually see — a dev-server-only pass would miss build errors.
          command: 'npm run build && npm run preview -- --port ' + frontendPort + ' --strictPort',
          cwd: sut.frontendDir,
          port: Number(frontendPort),
          reuseExistingServer: !process.env.CI,
          timeout: 180000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: { VITE_API_URL: `${BACKEND_URL}/api` },
        },
      ];

module.exports = defineConfig({
  testDir: path.join(ROOT, 'tests/e2e/specs'),
  outputDir: path.join(ROOT, 'reports/e2e/artifacts'),

  // A browser test that needs more than 60 s is stuck, not slow.
  timeout: 60000,
  expect: { timeout: 10000 },

  // A flaky E2E suite is worse than none: it trains the team to ignore red.
  // One retry in CI absorbs genuine infrastructure noise; a test that needs
  // more than that is reported as flaky and must be fixed.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,

  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ROOT, 'reports/e2e/html'), open: 'never' }],
    ['junit', { outputFile: path.join(ROOT, 'reports/junit/e2e.xml') }],
    ['json', { outputFile: path.join(ROOT, 'reports/e2e/results.json') }],
  ],

  use: {
    baseURL: FRONTEND_URL,
    // Evidence for triage, kept only for failures so the artifact stays small.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The product is used on phones as much as on laptops; a layout that
      // hides the primary action on a narrow viewport is a real defect.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testMatch: /.*(responsive|critical).*\.spec\.js/,
    },
  ],

  webServer,
});
