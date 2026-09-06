/**
 * Per-file setup for the Vitest frontend layer.
 *
 * Establishes the browser globals the application's modules read at import
 * time, so a component never sees a half-built environment.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// `src/config/apiConfig.ts` reads `window.configs?.apiUrl` at module scope to
// decide between the Choreo gateway and a local backend. Declaring it here
// (undefined by default) makes the local-development branch the baseline; a
// test that wants the Choreo branch sets it explicitly and re-imports.
if (!('configs' in window)) {
  window.configs = undefined;
}

/**
 * A localStorage double.
 *
 * jsdom provides one, but the application's axios interceptor both reads and
 * clears it, and assertions are far clearer against spies than against
 * observed side effects.
 */
function createStorageMock() {
  let store = {};
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index) => Object.keys(store)[index] ?? null),
    __store: () => store,
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    value: createStorageMock(),
    writable: true,
    configurable: true,
  });

  // The axios response interceptor navigates on 401. jsdom refuses to
  // implement navigation, so `window.location` is replaced with a plain object
  // whose `href` can be asserted on.
  delete window.location;
  window.location = { href: 'http://localhost:5173/', assign: vi.fn(), replace: vi.fn() };

  // The application logs heavily at module scope; silence keeps failures legible.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
