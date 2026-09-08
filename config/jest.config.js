/**
 * Jest configuration for the backend test pyramid.
 *
 * Three projects, matching SENG 34213 §6.2:
 *
 *   unit         isolated functions and classes, no I/O, no database
 *   integration  real HTTP against the real Express app and a real MongoDB
 *   security     OWASP Top 10 control verification (§8.1)
 *
 * The frontend layer runs under Vitest (`config/vitest.config.js`) because the
 * application's frontend is a Vite + JSX/TSX project; see
 * docs/adr/ADR-T02-test-runner-selection.md.
 *
 * The critical setting is `modulePaths`. The application lives in a different
 * repository with its own `node_modules`, and both the harness and the
 * application must end up with the SAME mongoose instance — otherwise the
 * harness connects one instance while the application queries another, and
 * every database call hangs. Adding the application's `node_modules` to Jest's
 * resolution roots makes `require('mongoose')` mean one thing on both sides.
 */

'use strict';

const path = require('path');

const { isSutAvailable, resolveSut } = require('../src/support/sut');

const ROOT = path.resolve(__dirname, '..');

/**
 * Jest loads this file before any test runs, so a missing application must not
 * throw here — that would produce an unreadable config-time stack trace instead
 * of the actionable message in `SutNotFoundError`. Tests surface it instead.
 */
const sutModulePaths = isSutAvailable() ? [resolveSut().nodeModulesDir] : [];

/** Settings shared by every project. */
const common = {
  rootDir: ROOT,
  modulePaths: sutModulePaths,
  moduleNameMapper: {
    '^@support/(.*)$': '<rootDir>/src/support/$1',
    '^@factories$': '<rootDir>/src/factories/index.js',
    '^@factories/(.*)$': '<rootDir>/src/factories/$1',
    '^@fixtures/(.*)$': '<rootDir>/src/fixtures/$1',
  },
  // The application is plain CommonJS, so the transform does no syntax work —
  // but it must exist for Babel to insert coverage counters into application
  // files. `babel-plugin-istanbul` is applied by Jest itself when --coverage is
  // set; without a transform entry those files would be loaded verbatim and
  // report as uncovered.
  transform: {
    '\\.[jt]sx?$': ['babel-jest', { configFile: false, babelrc: false }],
  },
  // Per-project timeouts are set with `jest.setTimeout()` in the setup files,
  // because `testTimeout` is not honoured inside a `projects` entry.
  clearMocks: true,
  restoreMocks: true,
  resetModules: false,
  testEnvironment: 'node',
  // The application's own uploads/, test-scripts/ and node_modules must never
  // be scanned for tests.
  testPathIgnorePatterns: ['/node_modules/', '/.sut/', '/reports/'],
  modulePathIgnorePatterns: ['<rootDir>/.sut/.*/package.json'],
};

module.exports = {
  rootDir: ROOT,

  projects: [
    {
      ...common,
      displayName: { name: 'unit', color: 'blue' },
      testMatch: ['<rootDir>/tests/unit/backend/**/*.test.js'],
      setupFilesAfterEnv: ['<rootDir>/config/setup/unit.setup.js'],
    },
    {
      ...common,
      displayName: { name: 'integration', color: 'magenta' },
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      globalSetup: '<rootDir>/config/setup/global.setup.js',
      globalTeardown: '<rootDir>/config/setup/global.teardown.js',
      setupFilesAfterEnv: ['<rootDir>/config/setup/integration.setup.js'],
    },
    {
      ...common,
      displayName: { name: 'security', color: 'red' },
      testMatch: ['<rootDir>/tests/security/**/*.test.js'],
      globalSetup: '<rootDir>/config/setup/global.setup.js',
      globalTeardown: '<rootDir>/config/setup/global.teardown.js',
      setupFilesAfterEnv: ['<rootDir>/config/setup/integration.setup.js'],
    },
  ],

  // ---------------------------------------------------------------------
  // Coverage — measured on the APPLICATION's source, not on the test code.
  //
  // `collectCoverageFrom` globs are resolved relative to `rootDir`, so the
  // absolute backend path has to be expressed as a relative one. With the
  // default layout the application sits in `.sut/`, giving a clean
  // `.sut/<project>/Backend/...` pattern; an application checked out elsewhere
  // produces a `../`-prefixed pattern, which micromatch handles as long as the
  // two trees share an ancestor.
  // ---------------------------------------------------------------------
  collectCoverageFrom: isSutAvailable()
    ? (() => {
        const backend = path.relative(ROOT, resolveSut().backendDir).replace(/\\/g, '/');
        return [
          `${backend}/models/**/*.js`,
          `${backend}/middleware/**/*.js`,
          `${backend}/routes/**/*.js`,
          `${backend}/server.js`,
          `!${backend}/**/node_modules/**`,
          `!${backend}/test-scripts/**`,
          `!${backend}/docs/**`,
        ];
      })()
    : [],
  coverageDirectory: '<rootDir>/reports/coverage/backend',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'html', 'cobertura'],
  // Babel instrumentation rather than v8: the application source lives outside
  // `rootDir`, and the v8 provider reports only files inside it.
  coverageProvider: 'babel',

  // §6.4 — 80 % of new code. Enforced here as a hard gate and again, per file
  // and per critical module, by `scripts/check-coverage.js`.
  coverageThreshold: {
    global: {
      lines: 80,
      statements: 80,
      branches: 70,
      functions: 80,
    },
  },

  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '<rootDir>/reports/junit',
        outputName: 'backend.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
      },
    ],
    '<rootDir>/src/reporters/test-register-reporter.js',
  ],

  verbose: false,
  errorOnDeprecated: true,
};
