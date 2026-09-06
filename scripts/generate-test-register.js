#!/usr/bin/env node
/**
 * Render the Test Case Register required by SENG 34213 §6.3.3 and delivered as
 * §10.1 #7.
 *
 * Joins the static half of each case — declared beside the assertion with
 * `testCase({...})` — with the outcome the run actually produced, captured by
 * `src/reporters/test-register-reporter.js`. The Actual Output and Status
 * columns therefore describe a real execution rather than an intention.
 *
 *   npm run report:register
 *
 * Outputs:
 *   docs/testing/TEST_REGISTER.md   the register in the prescribed format
 *   reports/test-register.json      the same data, for the traceability matrix
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('../src/support/sut');

const META_DIR = path.join(REPO_ROOT, 'reports', '.test-cases');
const RESULTS = path.join(REPO_ROOT, 'reports', 'test-results.json');
const MARKDOWN = path.join(REPO_ROOT, 'docs', 'testing', 'TEST_REGISTER.md');
const JSON_OUT = path.join(REPO_ROOT, 'reports', 'test-register.json');

function loadDeclaredCases() {
  if (!fs.existsSync(META_DIR)) return [];

  const byId = new Map();
  for (const file of fs.readdirSync(META_DIR).filter((name) => name.endsWith('.json'))) {
    const entries = JSON.parse(fs.readFileSync(path.join(META_DIR, file), 'utf8'));
    for (const entry of entries) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

function loadResults() {
  if (!fs.existsSync(RESULTS)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  return new Map((parsed.results || []).map((entry) => [entry.id, entry]));
}

/** Escape a value for a Markdown table cell. */
const cell = (value) =>
  String(value ?? '—')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

/**
 * GitHub's heading-anchor algorithm.
 *
 * Worth reproducing exactly rather than approximating, because the index below
 * links into this same document: an anchor that is close but not identical
 * renders as a working link that scrolls nowhere. GitHub lowercases, *deletes*
 * punctuation (apostrophes included — "caller's" becomes "callers", not
 * "caller-s"), and turns each remaining whitespace character into one hyphen
 * without collapsing runs.
 */
const slug = (heading) =>
  heading
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

function statusBadge(status) {
  return { Pass: '✅ Pass', Fail: '❌ Fail', Blocked: '⏭️ Blocked' }[status] || '❔ Not run';
}

function buildRegister() {
  const declared = loadDeclaredCases();
  const results = loadResults();

  return declared
    .map((entry) => {
      const result = results.get(entry.id);
      return {
        id: entry.id,
        name: entry.name,
        requirement: entry.requirement,
        type: entry.type,
        priority: entry.priority,
        preconditions: entry.preconditions,
        input: entry.input,
        expected: entry.expected,
        file: entry.file,
        knownDefect: Boolean(entry.knownDefect),
        defect: entry.defect || null,
        // A `testCase.failing` case is reported by Jest as passing while the
        // defect it documents still exists. Calling that "Pass" in the register
        // would misrepresent the product, so it is labelled for what it is.
        status: entry.knownDefect
          ? result?.status === 'Pass'
            ? 'Known Defect'
            : 'Fixed — retire this case'
          : result?.status || 'Not run',
        actual: entry.knownDefect
          ? result?.status === 'Pass'
            ? `Behaves as recorded in ${entry.defect}`
            : 'The documented defect no longer reproduces'
          : result?.actual || 'Not executed',
        durationMs: result?.durationMs ?? null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function renderDetail(entry) {
  return [
    `### ${entry.id} — ${entry.name}`,
    '',
    '| Field | Content |',
    '| --- | --- |',
    `| Test Case ID | \`${entry.id}\` |`,
    `| Test Case Name | ${cell(entry.name)} |`,
    `| Related Requirement | ${cell(entry.requirement)} |`,
    `| Related Test File | \`${cell(entry.file)}\` |`,
    `| Type | ${cell(entry.type)} |`,
    `| Priority | ${cell(entry.priority)} |`,
    `| Preconditions | ${cell(entry.preconditions)} |`,
    `| Input | ${cell(entry.input)} |`,
    `| Expected Output | ${cell(entry.expected)} |`,
    `| Actual Output | ${cell(entry.actual)} |`,
    `| Status | ${entry.knownDefect ? `⚠️ ${entry.status} (${entry.defect})` : statusBadge(entry.status)} |`,
    '',
  ].join('\n');
}

function renderMarkdown(register) {
  const counts = register.reduce((totals, entry) => {
    totals[entry.status] = (totals[entry.status] || 0) + 1;
    return totals;
  }, {});

  const byType = register.reduce((totals, entry) => {
    totals[entry.type] = (totals[entry.type] || 0) + 1;
    return totals;
  }, {});

  const lines = [];

  lines.push('# Test Case Register');
  lines.push('');
  lines.push('<!-- Generated by scripts/generate-test-register.js — do not edit by hand. -->');
  lines.push('');
  lines.push('The register prescribed by SENG 34213 §6.3.3 and submitted as deliverable §10.1 #7.');
  lines.push('');
  lines.push(
    'Every row is generated from a `testCase({...})` declaration that sits directly ' +
      'beside the assertion it describes, and the Actual Output and Status columns are ' +
      'filled in from the most recent execution. The register cannot drift from the ' +
      'suite, because it *is* the suite.',
  );
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('| --- | --- |');
  lines.push(`| Documented test cases | ${register.length} |`);
  for (const [status, count] of Object.entries(counts).sort()) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push('');
  lines.push('| Layer | Cases |');
  lines.push('| --- | --- |');
  for (const [type, count] of Object.entries(byType).sort()) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push('');
  lines.push(
    '> **Known Defect** marks a case whose assertion states the *correct* behaviour ' +
      'while the application does not yet exhibit it. Those cases are declared with ' +
      '`testCase.failing`, so the suite breaks the moment the defect is fixed and the ' +
      'entry can be retired. Each one is described in ' +
      '[DEFECT_REGISTER.md](./DEFECT_REGISTER.md).',
  );
  lines.push('');

  lines.push('## Index');
  lines.push('');
  lines.push('| ID | Name | Requirement | Type | Priority | Status |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const entry of register) {
    lines.push(
      `| [\`${entry.id}\`](#${slug(`${entry.id} — ${entry.name}`)}) | ${cell(
        entry.name,
      )} | ${cell(entry.requirement)} | ${cell(entry.type)} | ${cell(entry.priority)} | ${
        entry.knownDefect ? `⚠️ ${entry.defect}` : statusBadge(entry.status)
      } |`,
    );
  }
  lines.push('');

  lines.push('## Detailed test cases');
  lines.push('');
  for (const entry of register) {
    lines.push(renderDetail(entry));
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const register = buildRegister();

  if (register.length === 0) {
    process.stderr.write(
      '\n✗ No documented test cases were found.\n' +
        '  Run the suite first (`npm test`), then regenerate the register.\n\n',
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(MARKDOWN), { recursive: true });
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(MARKDOWN, renderMarkdown(register));
  fs.writeFileSync(
    JSON_OUT,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), cases: register }, null, 2)}\n`,
  );

  const failed = register.filter((entry) => entry.status === 'Fail');
  const knownDefects = register.filter((entry) => entry.knownDefect);

  process.stdout.write('\nTest Case Register (SENG 34213 §6.3.3)\n');
  process.stdout.write(`  Documented cases : ${register.length}\n`);
  process.stdout.write(`  Known defects    : ${knownDefects.length}\n`);
  process.stdout.write(`  Failing          : ${failed.length}\n`);
  process.stdout.write(`  → ${path.relative(REPO_ROOT, MARKDOWN)}\n\n`);
}

if (require.main === module) main();

module.exports = { buildRegister, renderMarkdown };
