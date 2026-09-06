/**
 * Jest globalTeardown: stop the ephemeral MongoDB started in global setup.
 * A no-op when an external `MONGODB_TEST_URI` was supplied.
 */

'use strict';

module.exports = async function globalTeardown() {
  const server = globalThis.__SRIKO_MONGO_SERVER__;
  if (server) {
    await server.stop();
    delete globalThis.__SRIKO_MONGO_SERVER__;
  }
};
