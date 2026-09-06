/**
 * Jest reporter that records the *outcome* of every documented test case.
 *
 * `src/support/test-case.js` captures the static half of the register (id,
 * requirement, preconditions, expected output). This reporter captures the half
 * that can only come from a real run — Actual Output and Status — and writes
 * `reports/test-results.json`, which `scripts/generate-test-register.js` then
 * renders into the register required by SENG 34213 §6.3.3.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Jest colours its failure messages. The escape sequence is built from a
 * character code rather than written literally, so the source file contains no
 * control character of its own.
 */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const OUTPUT = path.join(REPO_ROOT, 'reports', 'test-results.json');

/** Jest's status vocabulary → the register's Pass / Fail / Blocked. */
function toRegisterStatus(status) {
  switch (status) {
    case 'passed':
      return 'Pass';
    case 'failed':
      return 'Fail';
    case 'pending':
    case 'skipped':
    case 'todo':
    case 'disabled':
      return 'Blocked';
    default:
      return 'Blocked';
  }
}

/**
 * A one-line "actual output" for the register. On success the assertion held,
 * so the expected output is what happened; on failure the first line of the
 * assertion error is the most informative thing available.
 */
function actualOutput(testResult) {
  if (testResult.status === 'failed') {
    const raw = (testResult.failureMessages || []).join('\n');
    const firstLine = raw
      .split('\n')
      .map((line) => line.replace(ANSI_ESCAPE, '').trim())
      .find((line) => line.length > 0 && !line.startsWith('at '));
    return firstLine ? firstLine.slice(0, 300) : 'Assertion failed (see CI log)';
  }
  if (toRegisterStatus(testResult.status) === 'Blocked') {
    return 'Not executed';
  }
  return 'As expected';
}

class TestRegisterReporter {
  constructor(globalConfig, options = {}) {
    this._globalConfig = globalConfig;
    this._options = options;
    this._results = [];
  }

  onTestResult(_test, runResult) {
    for (const assertion of runResult.testResults) {
      // Only documented cases carry a `[TC-...]` prefix; everything else is a
      // plain `it()` and does not belong in the register.
      const match =
        /^\[(TC-[A-Z0-9-]+)\]\s*(.*)$/.exec(assertion.fullName.trim()) ||
        /\[(TC-[A-Z0-9-]+)\]\s*([^›]*)$/.exec(assertion.fullName.trim());
      if (!match) continue;

      this._results.push({
        id: match[1],
        title: assertion.fullName,
        suite: (assertion.ancestorTitles || []).join(' › '),
        file: path.relative(REPO_ROOT, runResult.testFilePath),
        status: toRegisterStatus(assertion.status),
        jestStatus: assertion.status,
        durationMs: assertion.duration || 0,
        actual: actualOutput(assertion),
      });
    }
  }

  onRunComplete(_contexts, aggregated) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

    // Jest invokes one reporter instance per `--selectProjects` run, so merge
    // with anything a previous run wrote instead of overwriting it. Results are
    // keyed by test-case id, and the newest run wins.
    let previous = [];
    if (fs.existsSync(OUTPUT)) {
      try {
        previous = JSON.parse(fs.readFileSync(OUTPUT, 'utf8')).results || [];
      } catch {
        previous = [];
      }
    }

    const merged = new Map();
    for (const entry of previous) merged.set(entry.id, entry);
    for (const entry of this._results) merged.set(entry.id, entry);

    fs.writeFileSync(
      OUTPUT,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          summary: {
            suites: aggregated.numTotalTestSuites,
            tests: aggregated.numTotalTests,
            passed: aggregated.numPassedTests,
            failed: aggregated.numFailedTests,
            skipped: aggregated.numPendingTests + aggregated.numTodoTests,
            documented: merged.size,
            durationMs: Date.now() - aggregated.startTime,
          },
          results: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
        },
        null,
        2,
      )}\n`,
    );
  }
}

module.exports = TestRegisterReporter;
