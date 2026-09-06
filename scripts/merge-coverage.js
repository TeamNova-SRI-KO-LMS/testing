#!/usr/bin/env node
/**
 * Merge the Jest (backend) and Vitest (frontend) lcov reports into one file.
 *
 * The pyramid runs on two runners, so coverage arrives in two reports. Sprint
 * reviews and coverage badges want one number, and a merged `lcov.info` is what
 * every coverage service consumes.
 *
 *   npm run coverage:merge
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('../src/support/sut');

const SOURCES = [
  { label: 'backend', file: path.join(REPO_ROOT, 'reports/coverage/backend/lcov.info') },
  { label: 'frontend', file: path.join(REPO_ROOT, 'reports/coverage/frontend/lcov.info') },
];
const MERGED = path.join(REPO_ROOT, 'reports/coverage/lcov.info');

function main() {
  const available = SOURCES.filter((source) => fs.existsSync(source.file));

  if (available.length === 0) {
    process.stderr.write('\n✗ No lcov reports found. Run `npm run coverage` first.\n\n');
    process.exit(1);
  }

  // lcov is a flat, record-oriented format: concatenating two reports is a
  // valid merge as long as no source file appears in both, and the backend and
  // frontend trees are disjoint by construction.
  const merged = available
    .map((source) => fs.readFileSync(source.file, 'utf8').trimEnd())
    .join('\n');

  fs.mkdirSync(path.dirname(MERGED), { recursive: true });
  fs.writeFileSync(MERGED, `${merged}\n`);

  const recordCount = (merged.match(/^SF:/gm) || []).length;

  process.stdout.write('\nMerged coverage\n');
  for (const source of available) {
    process.stdout.write(`  included : ${source.label}\n`);
  }
  for (const source of SOURCES.filter((entry) => !available.includes(entry))) {
    process.stdout.write(`  missing  : ${source.label} (not generated)\n`);
  }
  process.stdout.write(`  files    : ${recordCount}\n`);
  process.stdout.write(`  → ${path.relative(REPO_ROOT, MERGED)}\n\n`);
}

if (require.main === module) main();
