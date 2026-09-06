#!/usr/bin/env node
/**
 * Render the requirements traceability matrix.
 *
 * SENG 34213 §4.3 says "Never implement without traceable design", and §10.4
 * asks the final report to cross-reference the degree of objectives met against
 * the SRS. This matrix is the join: every requirement in
 * `docs/REQUIREMENTS_CATALOGUE.md`, the test cases that cover it, and the
 * endpoints it owns.
 *
 *   npm run report:traceability
 *
 * Outputs `docs/testing/TRACEABILITY_MATRIX.md` and fails when a requirement
 * has no test at all — an untraceable requirement is indistinguishable from an
 * unimplemented one.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('../src/support/sut');
const requirements = require('../src/registry/requirements');

const REGISTER = path.join(REPO_ROOT, 'reports', 'test-register.json');
const ENDPOINTS = path.join(REPO_ROOT, 'reports', 'endpoint-coverage.json');
const MARKDOWN = path.join(REPO_ROOT, 'docs', 'testing', 'TRACEABILITY_MATRIX.md');
const JSON_OUT = path.join(REPO_ROOT, 'reports', 'traceability.json');

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const cell = (value) =>
  String(value ?? '—')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

/**
 * Read the E2E and performance layers, which are not driven by Jest and so
 * never reach the test register.
 *
 * Each spec and scenario declares the requirements it covers on a
 * `Requirements:` line in its header docblock. Parsing that keeps those layers
 * inside the matrix without a second, hand-maintained list that would rot.
 */
function scanNonJestLayers() {
  const cases = [];

  const sources = [
    {
      dir: path.join(REPO_ROOT, 'tests/e2e/specs'),
      type: 'E2E',
      idPattern: /'(TC-E2E-[A-Z0-9-]+)/g,
    },
    {
      dir: path.join(REPO_ROOT, 'tests/performance/scenarios'),
      type: 'Performance',
      idPattern: null,
    },
  ];

  for (const source of sources) {
    if (!fs.existsSync(source.dir)) continue;

    for (const file of fs.readdirSync(source.dir).filter((name) => name.endsWith('.js'))) {
      const full = path.join(source.dir, file);
      const text = fs.readFileSync(full, 'utf8');

      // `Requirements: FR-01 (Registration), NFR-05 (Usability).` — possibly
      // wrapped across two comment lines.
      const header = text.slice(0, text.indexOf('*/') + 2);
      const declaration = /\*\s*Requirements?:([\s\S]*?)\.\s*\n/.exec(header);
      if (!declaration) continue;

      const requirementIds = [...declaration[1].matchAll(/\b((?:FR|NFR)-\d{2})\b/g)].map(
        (match) => match[1],
      );
      if (requirementIds.length === 0) continue;

      const ids = source.idPattern
        ? [...new Set([...text.matchAll(source.idPattern)].map((match) => match[1]))]
        : [`TC-PERF-${path.basename(file, '.js').toUpperCase()}`];

      for (const requirement of requirementIds) {
        for (const id of ids) {
          cases.push({
            id,
            name:
              source.type === 'Performance'
                ? `${path.basename(file, '.js')} scenario`
                : `${path.basename(file, '.spec.js')} — browser flow`,
            requirement,
            type: source.type,
            priority: 'P1',
            status: 'Not run in this report',
            knownDefect: false,
            file: path.relative(REPO_ROOT, full),
          });
        }
      }
    }
  }

  return cases;
}

function build() {
  const register = [...loadJson(REGISTER, { cases: [] }).cases, ...scanNonJestLayers()];
  const endpointCoverage = loadJson(ENDPOINTS, { endpoints: [] }).endpoints;

  const casesByRequirement = new Map();
  for (const entry of register) {
    if (!casesByRequirement.has(entry.requirement)) {
      casesByRequirement.set(entry.requirement, []);
    }
    casesByRequirement.get(entry.requirement).push(entry);
  }

  const rows = requirements.map((requirement) => {
    const cases = casesByRequirement.get(requirement.id) || [];
    const endpoints = endpointCoverage.filter((endpoint) =>
      (requirement.endpoints || []).some((pattern) =>
        new RegExp(`^${pattern.replace(/\*/g, '.*')}$`).test(`${endpoint.method} ${endpoint.path}`),
      ),
    );

    const byLayer = cases.reduce((totals, entry) => {
      totals[entry.type] = (totals[entry.type] || 0) + 1;
      return totals;
    }, {});

    return {
      ...requirement,
      cases,
      caseCount: cases.length,
      byLayer,
      knownDefects: cases.filter((entry) => entry.knownDefect).map((entry) => entry.defect),
      failing: cases.filter((entry) => entry.status === 'Fail').length,
      endpointCount: endpoints.length,
      endpointsCovered: endpoints.filter((endpoint) => endpoint.hits > 0).length,
    };
  });

  // A requirement in the catalogue that no case names is an untested
  // requirement; a case naming a requirement the catalogue does not list is a
  // typo. Both are reported.
  const known = new Set(requirements.map((requirement) => requirement.id));
  const orphanRequirements = [...casesByRequirement.keys()].filter((id) => !known.has(id));

  return { rows, orphanRequirements, totalCases: register.length };
}

function renderMarkdown({ rows, orphanRequirements, totalCases }) {
  const covered = rows.filter((row) => row.caseCount > 0);
  const uncovered = rows.filter((row) => row.caseCount === 0);
  const percentage = rows.length === 0 ? 0 : Math.round((covered.length / rows.length) * 1000) / 10;

  const lines = [];

  lines.push('# Requirements Traceability Matrix');
  lines.push('');
  lines.push('<!-- Generated by scripts/generate-traceability.js — do not edit by hand. -->');
  lines.push('');
  lines.push(
    'Each requirement in [REQUIREMENTS_CATALOGUE.md](../REQUIREMENTS_CATALOGUE.md) mapped ' +
      'to the test cases that verify it and the endpoints that implement it.',
  );
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Requirements catalogued | ${rows.length} |`);
  lines.push(`| Requirements with at least one test | ${covered.length} |`);
  lines.push(`| Requirements with no test | ${uncovered.length} |`);
  lines.push(`| **Requirement coverage** | **${percentage}%** |`);
  lines.push(`| Documented test cases | ${totalCases} |`);
  lines.push('');

  if (uncovered.length > 0) {
    lines.push('### Requirements with no test coverage');
    lines.push('');
    for (const row of uncovered) {
      lines.push(`- **${row.id}** — ${row.title}`);
    }
    lines.push('');
  }

  if (orphanRequirements.length > 0) {
    lines.push('### Test cases naming a requirement that is not catalogued');
    lines.push('');
    lines.push(
      'Usually a typo in a `testCase({ requirement })` field, or a requirement that ' +
        'needs adding to the catalogue.',
    );
    lines.push('');
    for (const id of orphanRequirements) {
      lines.push(`- \`${id}\``);
    }
    lines.push('');
  }

  lines.push('## Matrix');
  lines.push('');
  lines.push(
    '| Requirement | Title | Unit | Integration | Security | E2E | Perf | Total | Endpoints | Known defects |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const defects = row.knownDefects.length > 0 ? row.knownDefects.join(', ') : '—';
    lines.push(
      `| \`${row.id}\` | ${cell(row.title)} | ${row.byLayer.Unit || 0} | ${
        row.byLayer.Integration || 0
      } | ${row.byLayer.Security || 0} | ${row.byLayer.E2E || 0} | ${
        row.byLayer.Performance || 0
      } | ${row.caseCount} | ${
        row.endpointCount > 0 ? `${row.endpointsCovered}/${row.endpointCount}` : '—'
      } | ${cell(defects)} |`,
    );
  }
  lines.push('');

  lines.push('## Requirement detail');
  lines.push('');
  for (const row of rows) {
    lines.push(`### ${row.id} — ${row.title}`);
    lines.push('');
    lines.push(row.description);
    lines.push('');

    if (row.endpoints && row.endpoints.length > 0) {
      lines.push('**Implemented by:**');
      lines.push('');
      for (const pattern of row.endpoints) {
        lines.push(`- \`${pattern}\``);
      }
      lines.push('');
    }

    if (row.cases.length === 0) {
      lines.push('**Verified by:** _no test cases yet_');
      lines.push('');
      continue;
    }

    lines.push('**Verified by:**');
    lines.push('');
    lines.push('| Test case | Layer | Priority | Status |');
    lines.push('| --- | --- | --- | --- |');
    for (const entry of row.cases.sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(
        `| \`${entry.id}\` ${cell(entry.name)} | ${cell(entry.type)} | ${cell(entry.priority)} | ${
          entry.knownDefect ? `⚠️ ${entry.defect}` : entry.status
        } |`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const matrix = build();

  fs.mkdirSync(path.dirname(MARKDOWN), { recursive: true });
  fs.writeFileSync(MARKDOWN, renderMarkdown(matrix));
  fs.writeFileSync(
    JSON_OUT,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), ...matrix }, null, 2)}\n`,
  );

  const uncovered = matrix.rows.filter((row) => row.caseCount === 0);

  process.stdout.write('\nRequirements traceability\n');
  process.stdout.write(`  Requirements : ${matrix.rows.length}\n`);
  process.stdout.write(`  Covered      : ${matrix.rows.length - uncovered.length}\n`);
  process.stdout.write(`  → ${path.relative(REPO_ROOT, MARKDOWN)}\n\n`);

  if (uncovered.length > 0) {
    process.stderr.write(`✗ ${uncovered.length} requirement(s) have no test case:\n\n`);
    for (const row of uncovered) {
      process.stderr.write(`    ${row.id}  ${row.title}\n`);
    }
    process.stderr.write('\n');
    process.exit(1);
  }

  if (matrix.orphanRequirements.length > 0) {
    process.stderr.write(
      `✗ Test cases reference requirements that are not catalogued: ${matrix.orphanRequirements.join(', ')}\n\n`,
    );
    process.exit(1);
  }

  process.stdout.write('✓ Every catalogued requirement is covered by at least one test case.\n\n');
}

if (require.main === module) main();

module.exports = { build, renderMarkdown };
