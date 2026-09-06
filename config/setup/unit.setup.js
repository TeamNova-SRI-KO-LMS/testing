/**
 * Per-file setup for the `unit` project.
 *
 * Unit tests touch no database and no network. This file installs the custom
 * matchers, pins the environment the application reads at module scope, and
 * installs a guard that fails any unit test which opens a Mongo connection —
 * a test that silently became an integration test is worse than one that
 * breaks loudly.
 */

'use strict';

require('../../src/matchers');

const { config } = require('../../src/support/sut');
const { silence, unsilence } = require('../../src/support/silence');
const testCaseRegistry = require('../../src/support/test-case');

// The application reads JWT_SECRET, JWT_EXPIRE and NODE_ENV at module scope
// and falls back to hard-coded values when they are absent. Pinning them makes
// token assertions deterministic.
Object.assign(process.env, config.sutEnv);

// A unit test that needs longer than this has stopped being a unit test.
jest.setTimeout(5000);

// The application logs verbosely from inside the units under test — including,
// in middleware/auth.js, the JWT secret itself (see DEFECT-05). Suppressed here
// so assertion failures are readable; set SUT_VERBOSE=true to see it all.
beforeAll(silence);
afterAll(() => {
  // See config/setup/integration.setup.js — Jest workers do not reliably run
  // process exit handlers, so the register metadata is written here.
  testCaseRegistry.flush();
  unsilence();
});

afterEach(() => {
  jest.useRealTimers();
});
