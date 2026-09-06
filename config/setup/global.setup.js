/**
 * Jest globalSetup for database-backed projects.
 *
 * Runs once, in the Jest parent process, before any worker starts. It boots a
 * single MongoDB instance and publishes its URI through `MONGODB_TEST_URI` so
 * every worker connects to the same server instead of each paying the ~1 s cost
 * of booting its own.
 *
 * When `MONGODB_TEST_URI` is already set — a CI service container, or a local
 * Docker MongoDB — nothing is downloaded or started, and the variable is left
 * exactly as provided.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

module.exports = async function globalSetup() {
  // Clear the previous run's journals so endpoint coverage and the test
  // register always describe the run that just happened.
  for (const dir of ['.endpoint-hits', '.test-cases']) {
    fs.rmSync(path.join(REPO_ROOT, 'reports', dir), { recursive: true, force: true });
  }

  if (process.env.MONGODB_TEST_URI) {
    process.stdout.write(`\n  ℹ Using external test database: ${process.env.MONGODB_TEST_URI}\n`);
    return;
  }

  const { MongoMemoryServer } = require('mongodb-memory-server');
  const server = await MongoMemoryServer.create({ instance: { dbName: 'sriko_lms_test' } });

  process.env.MONGODB_TEST_URI = server.getUri();
  // Stashed on globalThis so globalTeardown — a different module instance —
  // can stop the same server.
  globalThis.__SRIKO_MONGO_SERVER__ = server;
};
