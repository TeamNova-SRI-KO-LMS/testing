/**
 * Per-file setup for the `integration` and `security` projects.
 *
 * Connects the application's mongoose to the ephemeral database started in
 * global setup, and truncates every collection between tests.
 *
 * Truncating in `afterEach` rather than `beforeEach` means a failing test
 * leaves its data behind only until the next test starts — but combined with
 * `--runInBand` it guarantees each test begins from an empty database
 * regardless of what ran before it, which is what makes the suite order
 * independent (SENG 34213 §6.3.2).
 */

'use strict';

require('../../src/matchers');

const database = require('../../src/support/database');
const { config } = require('../../src/support/sut');
const { silence, unsilence } = require('../../src/support/silence');
const apiClient = require('../../src/support/api-client');
const testCaseRegistry = require('../../src/support/test-case');

Object.assign(process.env, config.sutEnv);

// Booting mongod and the first bcrypt round dominate the first test in a file.
jest.setTimeout(30000);

beforeAll(async () => {
  silence();
  await database.connect();
  await database.syncIndexes();
});

afterEach(async () => {
  await database.clear();
});

afterAll(async () => {
  await database.disconnect();

  // Persist this worker's endpoint-hit journal and documented-test-case
  // metadata. Both accumulate in memory across the files a worker runs and are
  // rewritten here, because Jest does not reliably run process exit handlers in
  // its workers — without this the endpoint-coverage gate would see no data at
  // all and report 0 %.
  apiClient.flush();
  testCaseRegistry.flush();

  unsilence();
});
