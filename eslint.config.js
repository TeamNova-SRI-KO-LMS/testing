/**
 * ESLint configuration — SENG 34213 §5.2 requires a committed linter
 * configuration at the repository root from Sprint 5, Week 1.
 *
 * Test code is production code: it is read far more often than it is written,
 * and a test that is hard to read is a test nobody trusts. The rules below
 * target the mistakes that specifically make a *test suite* unreliable —
 * focused tests left in a commit, assertions that can never fail, forgotten
 * awaits — rather than restating a general style guide.
 *
 * Formatting is Prettier's job (`.prettierrc`); ESLint here is about
 * correctness and consistency.
 */

'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const jest = require('eslint-plugin-jest');
const react = require('eslint-plugin-react');

/**
 * The suite wraps `it()` in `testCase()` so each assertion carries its register
 * metadata (see src/support/test-case.js). eslint-plugin-jest has to be told
 * about the wrapper, or every documented case looks like an `expect` outside a
 * test block.
 */
const TEST_BLOCK_WRAPPERS = ['testCase', 'testCase.failing', 'testCase.skip'];

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.sut/**', // the application under test is linted by its own repository
      'reports/**',
      'coverage/**',
      'docs/**',
    ],
  },

  js.configs.recommended,

  // ── Harness, scripts and configuration (CommonJS, Node) ───────────────────
  {
    files: [
      'src/**/*.js',
      'scripts/**/*.js',
      'config/**/*.js',
      'testing.config.js',
      'eslint.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'no-console': 'off', // the scripts are command-line tools; printing is the point
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'multi-line'],
      'no-return-await': 'error',
      'require-await': 'error',
      'no-throw-literal': 'error',
    },
  },

  // ── Jest test suites ──────────────────────────────────────────────────────
  {
    files: ['tests/unit/backend/**/*.js', 'tests/integration/**/*.js', 'tests/security/**/*.js'],
    plugins: { jest },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      ...jest.configs.recommended.rules,

      // A `.only` reaching the default branch silently disables the rest of the
      // suite while the pipeline still reports green — the single most
      // dangerous mistake a test author can make.
      'jest/no-focused-tests': 'error',
      // A disabled test is a coverage claim that is not true. Warn rather than
      // error so a deliberate, commented skip is possible mid-investigation.
      'jest/no-disabled-tests': 'warn',
      // An `expect` outside a test body never runs.
      'jest/no-standalone-expect': ['error', { additionalTestBlockFunctions: TEST_BLOCK_WRAPPERS }],
      // `expect(await x)` inside a loop without await is a silent pass.
      'jest/valid-expect': 'error',
      'jest/valid-expect-in-promise': 'error',
      'jest/no-conditional-expect': 'error',
      // Every test must assert something; a test with no expectation passes
      // whatever the application does.
      'jest/expect-expect': [
        'error',
        {
          assertFunctionNames: ['expect', 'expect.*'],
          additionalTestBlockFunctions: TEST_BLOCK_WRAPPERS,
        },
      ],
      'jest/no-identical-title': 'error',
      'jest/prefer-to-be': 'warn',
      'jest/prefer-to-have-length': 'warn',
      'jest/require-top-level-describe': 'off', // per-endpoint files read better flat

      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error', // a test that prints is a test that was being debugged
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-await-in-loop': 'warn', // sequential setup is often deliberate; flag, do not forbid
    },
  },

  // ── The Vitest setup file and config (ESM) ────────────────────────────────
  {
    files: ['config/setup/frontend.setup.js', 'config/vitest.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, vi: 'readonly', ...globals.jest },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // ── Vitest frontend suites (ESM, JSX, browser globals) ────────────────────
  {
    files: ['tests/unit/frontend/**/*.{js,jsx}'],
    plugins: { react },
    settings: { react: { version: '18.3' } },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, vi: 'readonly', ...globals.jest },
    },
    rules: {
      // Without these, every component and router import in a .jsx test reads
      // as unused: core ESLint does not know that JSX references a binding.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── Playwright end-to-end suites ──────────────────────────────────────────
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // ── k6 performance scenarios (ESM, k6 runtime globals) ────────────────────
  {
    files: ['tests/performance/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Injected by the k6 runtime rather than by Node.
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
