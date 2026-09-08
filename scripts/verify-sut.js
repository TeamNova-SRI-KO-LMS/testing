#!/usr/bin/env node
/**
 * Confirm the harness can find, load and talk to the application.
 *
 * Run this first whenever something is wrong: it distinguishes "the
 * application is not where the harness expects" from "a test is failing",
 * which are very different problems with very similar symptoms.
 *
 *   npm run sut:verify
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  resolveSut,
  isSutAvailable,
  sutPath,
  resolveFromSut,
  REPO_ROOT,
} = require('../src/support/sut');

const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail });
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message });
  }
}

function main() {
  if (!isSutAvailable()) {
    try {
      resolveSut();
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
  }

  const sut = resolveSut();

  check('Application located', () => `${sut.root}\n      (found via ${sut.source})`);
  check('Backend directory', () => sut.backendDir);
  check(
    'Frontend directory',
    () => sut.frontendDir || 'not present — frontend tests will be skipped',
  );
  check('server.js exports an Express app', () => {
    const source = fs.readFileSync(sutPath('server.js'), 'utf8');
    if (!/module\.exports\s*=\s*app/.test(source)) {
      throw new Error('server.js does not end with `module.exports = app`');
    }
    if (!/SKIP_SERVER/.test(source)) {
      throw new Error('server.js does not honour SKIP_SERVER; Supertest cannot mount it');
    }
    if (!/SKIP_DB/.test(source)) {
      throw new Error('server.js does not honour SKIP_DB; the harness cannot control the database');
    }
    return 'exports `app`, honours SKIP_SERVER and SKIP_DB';
  });

  for (const dependency of [
    'express',
    'mongoose',
    'jsonwebtoken',
    'bcryptjs',
    'express-validator',
  ]) {
    check(`Dependency: ${dependency}`, () => {
      const resolved = resolveFromSut(dependency);
      const pkg = path.join(
        resolved.split(`node_modules/${dependency}`)[0],
        'node_modules',
        dependency,
        'package.json',
      );
      const version = fs.existsSync(pkg) ? JSON.parse(fs.readFileSync(pkg, 'utf8')).version : '?';
      return `v${version}`;
    });
  }

  check('Models directory', () => {
    const models = fs.readdirSync(sutPath('models')).filter((file) => file.endsWith('.js'));
    if (models.length === 0) throw new Error('no models found');
    return `${models.length} models`;
  });

  check('Routes directory', () => {
    const routes = fs.readdirSync(sutPath('routes')).filter((file) => file.endsWith('.js'));
    if (routes.length === 0) throw new Error('no route modules found');
    return `${routes.length} route modules`;
  });

  check('Endpoint inventory', () => {
    const inventory = path.join(REPO_ROOT, 'reports', 'endpoint-inventory.json');
    if (!fs.existsSync(inventory)) {
      throw new Error('not generated yet — run `npm run sut:endpoints`');
    }
    const parsed = JSON.parse(fs.readFileSync(inventory, 'utf8'));
    return `${parsed.summary.testable} testable endpoints`;
  });

  const width = Math.max(...checks.map((entry) => entry.name.length));
  process.stdout.write('\nSystem Under Test\n\n');
  for (const entry of checks) {
    process.stdout.write(
      `  ${entry.ok ? '✓' : '✗'} ${entry.name.padEnd(width)}  ${entry.detail}\n`,
    );
  }
  process.stdout.write('\n');

  const failures = checks.filter((entry) => !entry.ok);
  if (failures.length > 0) {
    process.stderr.write(
      `✗ ${failures.length} check(s) failed. Integration tests will not run until they pass.\n\n`,
    );
    process.exit(1);
  }

  process.stdout.write('✓ The harness can load and exercise the application.\n\n');
}

if (require.main === module) main();
