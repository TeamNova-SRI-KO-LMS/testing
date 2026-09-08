/**
 * Vitest configuration for the frontend unit and component layer.
 *
 * Why a second runner alongside Jest: the application's frontend is a Vite
 * project written in JSX and TypeScript, importing ESM-only packages. Vitest
 * shares Vite's transform pipeline, so those files load with no Babel
 * configuration and no `transformIgnorePatterns` archaeology. Making Jest do
 * the same job would mean maintaining a parallel build for files that live in
 * another repository. See docs/adr/ADR-T02-test-runner-selection.md.
 *
 * The backend layers stay on Jest (`config/jest.config.js`), which is the
 * better fit for Supertest and for the CommonJS application code.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The SUT resolver is CommonJS and shared with the Jest side of the harness;
// one resolver means the two runners can never disagree about where the
// application lives.
const require = createRequire(import.meta.url);
const { isSutAvailable, resolveSut } = require('../src/support/sut');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_MODULES = path.join(ROOT, 'node_modules');

// Resolved lazily and defensively: a missing application must produce the
// actionable SutNotFoundError from a test, not an unreadable config-time crash.
const frontendDir = isSutAvailable() && resolveSut().frontendDir;

/**
 * Pin React and its ecosystem to this repository's single copy.
 *
 * The application's frontend has its own `node_modules`. If a component
 * resolved React from there while `@testing-library/react` resolved it from
 * here, the two copies would not share hook state and every render would fail
 * with "Invalid hook call". Aliasing removes the possibility.
 */
const dedupedPackages = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'react-dom/test-utils',
  'react-router-dom',
  'axios',
];

const alias = Object.fromEntries(
  dedupedPackages.map((name) => [name, path.join(LOCAL_MODULES, name)]),
);

if (frontendDir) {
  // Lets a test say `require('@frontend/services/apiService')` instead of
  // reaching across the filesystem by relative path.
  alias['@frontend'] = path.join(frontendDir, 'src');
}

export default defineConfig({
  plugins: [react()],
  root: ROOT,

  resolve: {
    alias,
    dedupe: dedupedPackages,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.join(ROOT, 'config/setup/frontend.setup.js')],
    include: ['tests/unit/frontend/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['**/node_modules/**', '.sut/**', 'reports/**'],
    // The frontend layer is pure unit and component work: no network, no
    // database, nothing that legitimately takes seconds.
    testTimeout: 10000,
    clearMocks: true,
    restoreMocks: true,

    reporters: ['default', 'junit'],
    outputFile: { junit: path.join(ROOT, 'reports/junit/frontend.xml') },

    coverage: {
      provider: 'v8',
      reportsDirectory: path.join(ROOT, 'reports/coverage/frontend'),
      reporter: ['text-summary', 'lcov', 'json-summary', 'html'],
      // Coverage is measured on the APPLICATION's frontend, never on the tests.
      include: frontendDir
        ? [path.relative(ROOT, path.join(frontendDir, 'src')).replace(/\\/g, '/') + '/**']
        : [],
      exclude: ['**/*.d.ts', '**/main.jsx', '**/index.css', '**/node_modules/**'],
      all: false,
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 70,
        functions: 80,
      },
    },
  },
});
