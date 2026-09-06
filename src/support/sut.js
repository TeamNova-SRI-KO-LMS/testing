/**
 * System Under Test (SUT) resolver.
 *
 * The test suite lives in its own repository, so it must locate the SRI-KO LMS
 * application source before it can require a single model or mount the Express
 * app. Everything that needs application code goes through this module — no
 * test file ever hard-codes a path to the application.
 *
 * The other job this module does is *module identity*. The application has its
 * own `node_modules`, so a naive `require('mongoose')` inside a test resolves
 * to a DIFFERENT mongoose instance than `require('mongoose')` inside the
 * application. Two instances mean two model registries and two connection
 * pools: the harness would connect one instance while the application queried
 * the other, and every integration test would hang on a buffering timeout.
 *
 * `requireFromSut()` resolves modules through the application's own resolution
 * paths — but still hands them to the *caller's* `require`. Under Jest that is
 * Jest's require, so application modules stay inside Jest's module registry:
 * `jest.mock()` works on them, and each test file gets a clean app instance.
 * Resolving with `{ paths: [backendDir] }` is what keeps both sides on one
 * mongoose. This is the single most important detail in the whole harness.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

let cached = null;

/** Load the committed config plus the optional git-ignored local override. */
function loadConfig() {
  const base = require(path.join(REPO_ROOT, 'testing.config.js'));
  const localPath = path.join(REPO_ROOT, 'testing.config.local.js');
  if (fs.existsSync(localPath)) {
    return { ...base, ...require(localPath) };
  }
  return base;
}

const config = loadConfig();

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Find the backend directory inside a project root, or null when the root does
 * not look like a MERN checkout. A directory qualifies only if it holds a
 * `server.js` — the presence of a `Backend/` folder alone is not enough.
 */
function findBackendDir(projectRoot) {
  for (const name of config.backendDirNames) {
    const dir = path.join(projectRoot, name);
    if (isFile(path.join(dir, 'server.js'))) return dir;
  }
  // A root that *is* the backend (e.g. SUT_PATH pointed straight at Backend/).
  if (isFile(path.join(projectRoot, 'server.js'))) return projectRoot;
  return null;
}

function findFrontendDir(projectRoot) {
  for (const name of config.frontendDirNames) {
    const dir = path.join(projectRoot, name);
    if (isFile(path.join(dir, 'package.json')) && isDirectory(path.join(dir, 'src'))) {
      return dir;
    }
  }
  return null;
}

/** Ordered list of {source, path} candidates, most explicit first. */
function candidateRoots() {
  const candidates = [];

  if (process.env.SUT_PATH) {
    candidates.push({
      source: 'SUT_PATH environment variable',
      dir: path.resolve(process.env.SUT_PATH),
    });
  }
  if (config.sutPath) {
    candidates.push({
      source: 'testing.config.local.js (sutPath)',
      dir: path.resolve(REPO_ROOT, config.sutPath),
    });
  }
  for (const candidate of config.candidatePaths || []) {
    candidates.push({
      source: `candidatePaths → ${candidate}`,
      dir: path.resolve(REPO_ROOT, candidate),
    });
  }
  return candidates;
}

class SutNotFoundError extends Error {
  constructor(tried) {
    super(
      [
        '',
        '  Could not locate the SRI-KO LMS application source (the System Under Test).',
        '',
        '  This is a standalone test repository, so it needs the application checked',
        '  out somewhere it can reach. Fix it in any one of these ways:',
        '',
        '    1. npm run sut:setup            (unpacks the local SRI-KO_LMS_MERN.zip into ./.sut)',
        '    2. npm run sut:setup -- --clone (clones the application repository into ./.sut)',
        '    3. SUT_PATH=/path/to/SRI-KO_LMS_MERN npm test',
        '    4. Create testing.config.local.js exporting { sutPath: "/path/to/checkout" }',
        '',
        '  A directory qualifies when it contains Backend/server.js (or backend/server.js).',
        '',
        '  Locations tried:',
        ...tried.map((entry) => `    ✗ ${entry.dir}\n        via ${entry.source}`),
        '',
      ].join('\n'),
    );
    this.name = 'SutNotFoundError';
    this.tried = tried;
  }
}

/**
 * Resolve the System Under Test. Cached, so the filesystem walk happens once
 * per worker process.
 *
 * @returns {{root:string, backendDir:string, frontendDir:string|null,
 *            source:string, nodeModulesDir:string}}
 */
function resolveSut() {
  if (cached) return cached;

  const tried = [];
  for (const candidate of candidateRoots()) {
    if (!isDirectory(candidate.dir)) {
      tried.push(candidate);
      continue;
    }
    const backendDir = findBackendDir(candidate.dir);
    if (!backendDir) {
      tried.push(candidate);
      continue;
    }

    const root = backendDir === candidate.dir ? path.dirname(candidate.dir) : candidate.dir;

    cached = {
      root,
      backendDir,
      frontendDir: findFrontendDir(root),
      source: candidate.source,
      /** The application's own `node_modules`, fed to Jest via `modulePaths`. */
      nodeModulesDir: path.join(backendDir, 'node_modules'),
    };
    return cached;
  }

  throw new SutNotFoundError(tried);
}

/** True when the application source can be found, without throwing. */
function isSutAvailable() {
  try {
    resolveSut();
    return true;
  } catch {
    return false;
  }
}

/** Absolute path to a file inside the backend, e.g. sutPath('models/User.js'). */
function sutPath(...segments) {
  return path.join(resolveSut().backendDir, ...segments);
}

/** Absolute path to a file inside the frontend. Throws when absent. */
function frontendPath(...segments) {
  const { frontendDir } = resolveSut();
  if (!frontendDir) {
    throw new Error(
      'The System Under Test has no frontend directory. Frontend tests require ' +
        'a checkout containing Frontend/src (or frontend/src).',
    );
  }
  return path.join(frontendDir, ...segments);
}

/**
 * Resolve a module the way the application would, without loading it.
 *
 * Relative requests ('./models/User') resolve against the backend directory;
 * bare requests ('mongoose') resolve against the backend's `node_modules`.
 */
function resolveFromSut(request) {
  const { backendDir } = resolveSut();
  if (request.startsWith('.') || path.isAbsolute(request)) {
    return require.resolve(path.resolve(backendDir, request));
  }
  return require.resolve(request, { paths: [backendDir] });
}

/**
 * Require a module *as the application would*.
 *
 * Use this for every application module and for every third-party package the
 * application also uses (`mongoose` above all), so the harness and the
 * application share one instance. The module is loaded with the caller's
 * `require`, so under Jest it lands in Jest's registry and stays mockable.
 *
 * @example
 *   const mongoose = requireFromSut('mongoose');       // the app's mongoose
 *   const User     = requireFromSut('./models/User');  // the app's model
 */
function requireFromSut(request) {
  return require(resolveFromSut(request));
}

/**
 * Confirm the application's dependencies are installed. Integration tests need
 * mongoose, express and friends resolvable from the backend directory.
 */
function assertSutDependenciesInstalled() {
  const { backendDir } = resolveSut();
  const required = ['express', 'mongoose', 'jsonwebtoken', 'bcryptjs'];
  const missing = required.filter((pkg) => {
    try {
      resolveFromSut(pkg);
      return false;
    } catch {
      return true;
    }
  });

  if (missing.length > 0) {
    throw new Error(
      [
        '',
        `  The application at ${backendDir} is missing dependencies: ${missing.join(', ')}`,
        '',
        '  Install them before running integration tests:',
        '',
        `    cd "${backendDir}" && npm ci`,
        '',
        '  (`npm run sut:verify` checks this for you.)',
        '',
      ].join('\n'),
    );
  }
}

/** Reset the cache — used by the resolver's own unit tests. */
function __resetCache() {
  cached = null;
}

module.exports = {
  REPO_ROOT,
  config,
  resolveSut,
  isSutAvailable,
  sutPath,
  frontendPath,
  resolveFromSut,
  requireFromSut,
  assertSutDependenciesInstalled,
  SutNotFoundError,
  __resetCache,
};
