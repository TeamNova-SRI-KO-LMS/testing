#!/usr/bin/env node
/**
 * Provision the System Under Test into `./.sut` (git-ignored).
 *
 *   npm run sut:setup            unpack a local SRI-KO_LMS_MERN.zip archive
 *   npm run sut:setup -- --clone clone the application repository instead
 *   npm run sut:setup -- --install  also run `npm ci` inside the backend
 *
 * The suite does not need this when the application is already checked out
 * beside the test repository — see `testing.config.js` for the search order.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const config = require('../testing.config.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const SUT_DIR = path.join(REPO_ROOT, '.sut');

const argv = process.argv.slice(2);
const useClone = argv.includes('--clone');
const runInstall = argv.includes('--install');
const force = argv.includes('--force');

function log(symbol, message) {
  process.stdout.write(`${symbol} ${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n✗ ${message}\n\n`);
  process.exit(1);
}

function findBackendIn(dir) {
  for (const name of config.backendDirNames) {
    if (fs.existsSync(path.join(dir, name, 'server.js'))) return path.join(dir, name);
  }
  return null;
}

/** Depth-limited search for a directory that looks like a MERN checkout. */
function findProjectRoot(dir, depth = 0) {
  if (depth > 2) return null;
  if (findBackendIn(dir)) return dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const found = findProjectRoot(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

function ensureEmptyTarget() {
  if (fs.existsSync(SUT_DIR)) {
    if (!force && findProjectRoot(SUT_DIR)) {
      log('✓', `.sut already holds an application checkout — nothing to do.`);
      log('ℹ', 'Re-run with --force to replace it.');
      process.exit(0);
    }
    fs.rmSync(SUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(SUT_DIR, { recursive: true });
}

function unpackArchive() {
  const archive = (config.sutArchiveCandidates || [])
    .map((candidate) => path.resolve(REPO_ROOT, candidate))
    .find((candidate) => fs.existsSync(candidate));

  if (!archive) {
    fail(
      [
        'No application archive found. Looked for:',
        ...(config.sutArchiveCandidates || []).map((c) => `    ${path.resolve(REPO_ROOT, c)}`),
        '',
        '  Either place SRI-KO_LMS_MERN.zip at one of those paths, or run:',
        '    npm run sut:setup -- --clone',
      ].join('\n  '),
    );
  }

  log('→', `Unpacking ${path.basename(archive)} …`);
  ensureEmptyTarget();

  // Skip the archive's bundled node_modules and VCS metadata: they are large,
  // platform-specific, and reinstalled from the lockfile anyway.
  const result = spawnSync(
    'unzip',
    [
      '-q',
      '-o',
      archive,
      '-d',
      SUT_DIR,
      '-x',
      '*/node_modules/*',
      '__MACOSX/*',
      '*/.git/*',
      '*/dist/*',
      '*/.DS_Store',
    ],
    { stdio: 'inherit' },
  );
  // unzip exit code 1 means "completed with warnings" (e.g. skipped entries).
  if (result.status !== 0 && result.status !== 1) {
    fail(`unzip failed with exit code ${result.status}.`);
  }
}

function cloneRepository() {
  log('→', `Cloning ${config.sutGitRemote} (${config.sutGitRef}) …`);
  ensureEmptyTarget();
  execFileSync(
    'git',
    [
      'clone',
      '--depth',
      '1',
      '--branch',
      config.sutGitRef,
      config.sutGitRemote,
      path.join(SUT_DIR, 'app'),
    ],
    { stdio: 'inherit' },
  );
}

function main() {
  if (useClone) {
    cloneRepository();
  } else {
    unpackArchive();
  }

  const projectRoot = findProjectRoot(SUT_DIR);
  if (!projectRoot) {
    fail('Provisioning finished, but no Backend/server.js was found under .sut.');
  }

  const backendDir = findBackendIn(projectRoot);
  log('✓', `Application provisioned at ${path.relative(REPO_ROOT, projectRoot)}`);
  log('✓', `Backend detected at      ${path.relative(REPO_ROOT, backendDir)}`);

  const hasDependencies = fs.existsSync(path.join(backendDir, 'node_modules', 'express'));
  if (runInstall && !hasDependencies) {
    log('→', 'Installing application dependencies (npm ci) …');
    const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: backendDir,
      stdio: 'inherit',
    });
    if (install.status !== 0) {
      log('!', 'npm ci failed; falling back to npm install …');
      spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: backendDir,
        stdio: 'inherit',
      });
    }
  } else if (!hasDependencies) {
    log('!', 'Application dependencies are NOT installed. Integration tests need them:');
    log(' ', `    cd "${backendDir}" && npm ci`);
    log(' ', '    (or re-run: npm run sut:setup -- --install)');
  }

  log('✓', 'Done. Run `npm run sut:verify` to confirm the harness can load it.');
}

main();
