/**
 * Documented test cases — the bridge between an executable test and the
 * Test Case Register required by SENG 34213 §6.3.3 and deliverable §10.1 #7.
 *
 * A register maintained in a separate document drifts from the suite within a
 * sprint. Here the metadata lives beside the assertion it describes, and
 * `scripts/generate-test-register.js` renders the register from what actually
 * ran — including the Actual Output and Status columns, which no hand-written
 * document can fill in honestly.
 *
 *   testCase({
 *     id:            'TC-FR-01-02',
 *     name:          'Registration is rejected for a duplicate email',
 *     requirement:   'FR-01',
 *     type:          'Integration',
 *     priority:      'P1',
 *     preconditions: 'A user already exists with the target email address',
 *     input:         'POST /api/auth/register with an email already in use',
 *     expected:      'HTTP 400; success=false; message names the conflict',
 *   }, async () => {
 *     ...
 *   });
 *
 * The rendered title keeps the id as a prefix, so `jest -t TC-FR-01-02` selects
 * exactly one test and CI failure output names the case directly.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./sut');

const META_DIR = path.join(REPO_ROOT, 'reports', '.test-cases');

const TYPES = ['Unit', 'Integration', 'E2E', 'Security', 'Performance'];
const PRIORITIES = ['P1', 'P2', 'P3'];

/** Collected in-process, flushed once per worker. */
const collected = [];
const seenIds = new Set();
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

function flush() {
  if (collected.length === 0) return;
  fs.mkdirSync(META_DIR, { recursive: true });
  const worker = process.env.JEST_WORKER_ID || '1';
  fs.writeFileSync(
    path.join(META_DIR, journalName(`w${worker}`)),
    JSON.stringify(collected, null, 0),
  );
}

function registerFlush() {
  if (flushRegistered) return;
  flushRegistered = true;
  // See the note in api-client.js: the authoritative flush happens in
  // `afterAll`, because Jest workers do not reliably run `exit` handlers.
  process.on('exit', flush);
}

function validate(meta) {
  const problems = [];
  if (!/^TC-[A-Z0-9-]+$/.test(meta.id || '')) {
    problems.push(`id must look like "TC-FR-06-01", received ${JSON.stringify(meta.id)}`);
  }
  if (!meta.name) problems.push('name is required');
  if (!meta.requirement) problems.push('requirement is required (e.g. "FR-06")');
  if (!TYPES.includes(meta.type)) {
    problems.push(`type must be one of ${TYPES.join(', ')}, received ${JSON.stringify(meta.type)}`);
  }
  if (!PRIORITIES.includes(meta.priority)) {
    problems.push(`priority must be one of ${PRIORITIES.join(', ')}`);
  }
  if (!meta.preconditions) problems.push('preconditions is required');
  if (!meta.input) problems.push('input is required');
  if (!meta.expected) problems.push('expected is required');

  if (problems.length > 0) {
    throw new Error(
      `Invalid test case metadata for ${meta.id || '(no id)'}:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

function relativeTestPath() {
  const state = typeof expect !== 'undefined' && expect.getState ? expect.getState() : null;
  return state && state.testPath ? path.relative(REPO_ROOT, state.testPath) : 'unknown';
}

/**
 * Declare a documented test case. Behaves exactly like `it()`.
 *
 * @param {object} meta
 * @param {Function} fn        the test body
 * @param {number} [timeout]   forwarded to Jest
 */
function testCase(meta, fn, timeout) {
  validate(meta);
  registerFlush();

  // A `defect` field means the assertion states behaviour the application does
  // not yet exhibit, which only makes sense under `testCase.failing`. Catching
  // the mix-up here turns a puzzling red test into a one-line explanation.
  if (meta.defect) {
    throw new Error(
      `Test case "${meta.id}" carries defect "${meta.defect}" but was declared with ` +
        'testCase(). Use testCase.failing() for an assertion that documents a known ' +
        'defect, so the suite breaks when the defect is fixed.',
    );
  }

  if (seenIds.has(meta.id)) {
    throw new Error(
      `Duplicate test case id "${meta.id}". Every id in the register must be unique.`,
    );
  }
  seenIds.add(meta.id);

  const title = `[${meta.id}] ${meta.name}`;

  collected.push({
    ...meta,
    title,
    file: relativeTestPath(),
  });

  return it(title, fn, timeout);
}

/** `testCase.skip` — recorded in the register with status "Blocked". */
testCase.skip = function testCaseSkip(meta, fn, timeout) {
  validate(meta);
  registerFlush();
  const title = `[${meta.id}] ${meta.name}`;
  collected.push({ ...meta, title, file: relativeTestPath(), skipped: true });
  return it.skip(title, fn, timeout);
};

/**
 * `testCase.failing` — the test is expected to FAIL because it asserts correct
 * behaviour that the application does not yet implement. Jest reports it as a
 * pass while the defect exists and fails the build the moment the defect is
 * fixed, which is exactly the signal needed to retire the entry from
 * `docs/testing/DEFECT_REGISTER.md`.
 */
testCase.failing = function testCaseFailing(meta, fn, timeout) {
  validate(meta);
  registerFlush();
  if (!meta.defect) {
    throw new Error(
      `testCase.failing("${meta.id}") must carry a "defect" field naming the ` +
        'entry in docs/testing/DEFECT_REGISTER.md that it documents.',
    );
  }
  const title = `[${meta.id}] ${meta.name}`;
  collected.push({ ...meta, title, file: relativeTestPath(), knownDefect: true });
  return it.failing(title, fn, timeout);
};

/** Reset in-process state. Used by the harness's own tests. */
function __reset() {
  collected.length = 0;
  seenIds.clear();
}

module.exports = { testCase, flush, META_DIR, TYPES, PRIORITIES, __reset, collected };
