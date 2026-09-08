/**
 * Ephemeral MongoDB lifecycle for integration tests.
 *
 * Every integration test runs against a real MongoDB — indexes, unique
 * constraints, aggregation pipelines and Mongoose middleware all behave
 * differently against a mock, and SENG 34213 §6.3.2 requires integration tests
 * to "exercise real HTTP endpoints against a test database".
 *
 * Two backends are supported:
 *
 *   • `MONGODB_TEST_URI` set   → connect to that server (CI service container,
 *                                or a local Docker MongoDB). Nothing is
 *                                downloaded, which keeps CI fast and offline.
 *   • otherwise                → `mongodb-memory-server` boots a throw-away
 *                                in-process mongod. Zero setup for developers.
 *
 * The connection is opened on the APPLICATION's mongoose instance (see
 * `sut.js`), never on the harness's own copy.
 */

'use strict';

const { requireFromSut, assertSutDependenciesInstalled } = require('./sut');

let memoryServer = null;
let mongoose = null;
let connectedUri = null;

/** The application's mongoose instance. Lazily resolved. */
function getMongoose() {
  if (!mongoose) {
    assertSutDependenciesInstalled();
    mongoose = requireFromSut('mongoose');
  }
  return mongoose;
}

/**
 * Give each Jest worker its own database on the shared server.
 *
 * Jest runs test files in parallel worker processes. With a single database
 * they would all share one set of collections, and the `afterEach` truncation
 * in one worker would delete the fixtures another worker had just created —
 * producing failures that appear only in a full run and never in isolation.
 *
 * One mongod, N logical databases: the isolation of a private database with the
 * startup cost of a single server.
 *
 * @param {string} uri  base connection string
 * @returns {string}    the same server, with a worker-specific database name
 */
function withWorkerDatabase(uri) {
  const worker = process.env.JEST_WORKER_ID || '1';
  const parsed = new URL(uri);
  const base = (parsed.pathname.replace(/^\//, '') || 'sriko_lms_test').replace(/_w\d+$/, '');
  parsed.pathname = `/${base}_w${worker}`;
  return parsed.toString();
}

/**
 * Start a database and connect the application's mongoose to it.
 * Idempotent: calling it twice reuses the existing connection.
 *
 * @returns {Promise<string>} the connection URI
 */
async function connect() {
  const mongooseInstance = getMongoose();

  if (mongooseInstance.connection.readyState === 1) {
    return connectedUri;
  }

  let baseUri = process.env.MONGODB_TEST_URI;

  if (!baseUri) {
    // Required lazily so unit tests never pay the cost of booting mongod.

    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({
      instance: { dbName: 'sriko_lms_test' },
    });
    baseUri = memoryServer.getUri();
  }

  connectedUri = withWorkerDatabase(baseUri);

  await mongooseInstance.connect(connectedUri, {
    serverSelectionTimeoutMS: 10000,
    // Fail fast instead of buffering: a buffering timeout in a test almost
    // always means the harness and the app hold different mongoose instances,
    // and that is far easier to diagnose as an immediate error.
    bufferCommands: false,
  });

  return connectedUri;
}

/**
 * Delete every document from every collection.
 *
 * Preferred over dropping the database between tests because dropping also
 * drops the indexes Mongoose built at connect time — and several assertions in
 * this suite depend on real unique indexes (User.email, Payment.invoiceNumber,
 * Progress.student+course).
 */
async function clear() {
  const mongooseInstance = getMongoose();
  if (mongooseInstance.connection.readyState !== 1) return;

  const { collections } = mongooseInstance.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

/** Index build failures collected by the last `syncIndexes()` call. */
const indexFailures = [];

/**
 * Ask Mongoose to build every declared index and wait for it.
 *
 * Index creation is asynchronous and fire-and-forget by default, so without
 * this a "duplicate email is rejected" test can race the index and fail
 * intermittently.
 *
 * A model whose index specification MongoDB rejects is recorded rather than
 * thrown: an invalid index is an application defect, and aborting setup would
 * take down every unrelated test in the run instead of reporting it. The
 * collected failures are asserted on directly by
 * `tests/integration/persistence/schema-indexes.test.js`.
 *
 * @returns {Promise<Array<{model: string, error: string}>>} the failures
 */
async function syncIndexes() {
  const mongooseInstance = getMongoose();
  indexFailures.length = 0;

  await Promise.all(
    Object.values(mongooseInstance.models).map(async (model) => {
      try {
        await model.syncIndexes();
      } catch (error) {
        indexFailures.push({ model: model.modelName, error: error.message });
      }
    }),
  );

  return [...indexFailures];
}

/** The index build failures recorded by the most recent `syncIndexes()`. */
const getIndexFailures = () => [...indexFailures];

/** Disconnect and shut down the ephemeral server. Safe to call twice. */
async function disconnect() {
  const mongooseInstance = getMongoose();

  if (mongooseInstance.connection.readyState !== 0) {
    await mongooseInstance.connection.dropDatabase().catch(() => {});
    await mongooseInstance.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  connectedUri = null;
}

/** True when a database connection is currently open. */
function isConnected() {
  return getMongoose().connection.readyState === 1;
}

module.exports = {
  withWorkerDatabase,
  connect,
  clear,
  disconnect,
  syncIndexes,
  getIndexFailures,
  isConnected,
  getMongoose,
  get uri() {
    return connectedUri;
  },
};
