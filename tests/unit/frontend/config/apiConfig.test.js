/**
 * Frontend unit tests — src/config/apiConfig.ts
 *
 * Requirements: NFR-02 (Availability), FR-25 (Health & Observability).
 *
 * This module decides, at import time, which backend the whole application
 * talks to. Getting it wrong does not fail loudly — every request simply goes
 * somewhere useless — so each branch is exercised explicitly.
 *
 * The base URL is computed at module scope, so `vi.resetModules()` plus a fresh
 * dynamic import is the only way to re-evaluate it under a different
 * `window.configs`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Re-import the module with `window.configs` set to a chosen value. */
async function importWith(configs) {
  vi.resetModules();
  window.configs = configs;
  return import('@frontend/config/apiConfig');
}

describe('apiConfig — base URL derivation', () => {
  beforeEach(() => {
    window.configs = undefined;
    vi.unstubAllGlobals();
  });

  it('falls back to the local backend with an /api suffix when no runtime config exists', async () => {
    const { default: apiUrl } = await importWith(undefined);

    expect(apiUrl).toBe('http://localhost:5001/api');
  });

  it('appends /api to a plain configured host', async () => {
    const { default: apiUrl } = await importWith({ apiUrl: 'https://api.sriko.lk' });

    expect(apiUrl).toBe('https://api.sriko.lk/api');
  });

  it.each([
    ['choreoapis.dev', 'https://gateway.choreoapis.dev/sriko/backend/v1/api'],
    ['choreoapps.dev', 'https://app.choreoapps.dev/sriko/api'],
    ['choreo.dev', 'https://sri-kolms-api.choreo.dev/api'],
  ])('uses a %s URL exactly as configured, without appending /api', async (_host, configured) => {
    // A Choreo gateway URL already carries the full path. Appending `/api`
    // again would produce `/api/api` and 404 every request in production while
    // local development kept working.
    const { default: apiUrl } = await importWith({ apiUrl: configured });

    expect(apiUrl).toBe(configured);
  });

  it('treats a host that merely mentions choreo as a plain host', async () => {
    const { default: apiUrl } = await importWith({ apiUrl: 'https://choreographer.example.com' });

    expect(apiUrl).toBe('https://choreographer.example.com/api');
  });

  it('falls back to local when window.configs exists but carries no apiUrl', async () => {
    const { default: apiUrl } = await importWith({ someOtherSetting: true });

    expect(apiUrl).toBe('http://localhost:5001/api');
  });
});

describe('apiConfig — testApiConnectivity', () => {
  beforeEach(() => {
    window.configs = undefined;
  });

  it('reports a healthy endpoint as reachable', async () => {
    const { testApiConnectivity } = await importWith(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await expect(testApiConnectivity('https://api.sriko.lk')).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.sriko.lk/health',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('treats a 404 as reachable, because the host answered', async () => {
    // A 404 means DNS, TLS and routing all worked and something is listening —
    // which is what this probe is actually asking.
    const { testApiConnectivity } = await importWith(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(testApiConnectivity('https://api.sriko.lk')).resolves.toBe(true);
  });

  it('reports a 500 as unreachable', async () => {
    const { testApiConnectivity } = await importWith(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(testApiConnectivity('https://api.sriko.lk')).resolves.toBe(false);
  });

  it('reports a network failure as unreachable rather than throwing', async () => {
    // This probe runs during application start-up; an unhandled rejection here
    // would leave the user staring at a blank page.
    const { testApiConnectivity } = await importWith(undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(testApiConnectivity('https://down.example.com')).resolves.toBe(false);
  });

  it('aborts the probe rather than hanging indefinitely', async () => {
    const { testApiConnectivity } = await importWith(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn((url, options) => {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve({ ok: true, status: 200 });
      }),
    );

    await testApiConnectivity('https://api.sriko.lk');

    expect(fetch).toHaveBeenCalled();
  });
});

describe('apiConfig — getWorkingApiUrl', () => {
  beforeEach(() => {
    window.configs = undefined;
  });

  it('returns the configured URL when it responds', async () => {
    const { getWorkingApiUrl } = await importWith({ apiUrl: 'https://api.sriko.lk' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await expect(getWorkingApiUrl()).resolves.toBe('https://api.sriko.lk/api');
    // The first candidate answered, so no further probing should happen.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('falls through to the next candidate when the first is unreachable', async () => {
    const { getWorkingApiUrl } = await importWith({ apiUrl: 'https://api.sriko.lk' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValue({ ok: true, status: 200 }),
    );

    const resolved = await getWorkingApiUrl();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(resolved).toBeTruthy();
  });

  it('returns the default when nothing responds, so the caller still has a URL', async () => {
    // Returning undefined would turn every later request into a request to
    // "undefined/auth/login" — a much harder failure to diagnose.
    const { getWorkingApiUrl } = await importWith({ apiUrl: 'https://api.sriko.lk' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(getWorkingApiUrl()).resolves.toBe('https://api.sriko.lk/api');
  });
});
