/**
 * Suppress the application's runtime logging during test runs.
 *
 * `server.js` logs every request twice and morgan writes a combined-format
 * access line for each one, which buries real assertion failures under
 * thousands of lines. Two different channels have to be handled:
 *
 *   • `console.*`            — Jest buffers these and prints them per test
 *   • `process.stdout.write` — morgan bypasses `console` entirely
 *
 * The stdout filter is deliberately narrow: it drops only lines that match an
 * HTTP access-log or the application's emoji-prefixed diagnostics, so Jest's
 * own reporter output is never swallowed.
 *
 * Set `SUT_VERBOSE=true` to see everything — the first thing to try when an
 * integration test fails for a reason the assertion does not explain.
 */

'use strict';

/** morgan 'combined': `::1 - - [date] "GET /path HTTP/1.1" 200 123 "-" "-"` */
const ACCESS_LOG = /^\S+ - \S* \[[^\]]+\] "(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) [^"]*" \d{3}/;

/** The application prefixes its diagnostics with emoji. */
const APPLICATION_DIAGNOSTIC =
  /^[\s]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2705}\u{274C}\u{26A0}]/u;

let restore = null;

/** Start suppressing. Idempotent; returns the restore function. */
function silence() {
  if (restore) return restore;
  if (process.env.SUT_VERBOSE === 'true') {
    restore = () => {};
    return restore;
  }

  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    debug: console.debug,
    // The application logs caught errors on paths the tests deliberately
    // provoke. Real failures reach the developer through Jest's reporter, not
    // through the application's own console.error.
    error: console.error,
  };
  const originalWrite = process.stdout.write.bind(process.stdout);

  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};
  console.error = () => {};

  process.stdout.write = (chunk, encoding, callback) => {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    if (ACCESS_LOG.test(text) || APPLICATION_DIAGNOSTIC.test(text)) {
      if (typeof encoding === 'function') encoding();
      else if (typeof callback === 'function') callback();
      return true;
    }
    return originalWrite(chunk, encoding, callback);
  };

  restore = () => {
    Object.assign(console, originalConsole);
    process.stdout.write = originalWrite;
    restore = null;
  };
  return restore;
}

/** Stop suppressing, if active. */
function unsilence() {
  if (restore) restore();
}

/** Run `fn` with logging suppressed, restoring afterwards even on throw. */
async function withSilence(fn) {
  const stop = silence();
  try {
    return await fn();
  } finally {
    stop();
  }
}

module.exports = { silence, unsilence, withSilence };
