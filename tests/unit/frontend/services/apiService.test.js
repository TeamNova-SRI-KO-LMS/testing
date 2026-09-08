/**
 * Frontend unit tests — src/services/apiService.ts
 *
 * Requirements: FR-02 (Authentication), FR-04 (Session Management),
 * NFR-03 (Security).
 *
 * The two axios interceptors are the interesting part: one decides which token
 * every request carries, the other decides what happens when the server says
 * the session is over. Both are cross-cutting — a mistake in either affects
 * every screen in the application at once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';

/**
 * Fresh module graph per test: `ApiService` builds its axios instance — and
 * installs both interceptors — once, in its constructor.
 */
async function importService() {
  vi.resetModules();
  const module = await import('@frontend/services/apiService');
  return module.apiService ?? module.default;
}

/**
 * The axios instance the service wraps.
 *
 * It is declared `private` in TypeScript, which is a compile-time convention
 * only — esbuild strips the annotation and leaves an ordinary own property. A
 * mock adapter has to be attached to that exact instance, because the
 * interceptors under test are registered on it rather than on the axios global.
 */
function axiosInstanceOf(service) {
  const instance = service.api;
  if (typeof instance !== 'function' || typeof instance.get !== 'function') {
    throw new Error(
      'Could not reach the axios instance behind ApiService. The field was renamed ' +
        'from `api`, or the service no longer wraps a private instance.',
    );
  }
  return instance;
}

describe('apiService — request interceptor', () => {
  let service;
  let mock;

  beforeEach(async () => {
    service = await importService();
    mock = new MockAdapter(axiosInstanceOf(service));
  });

  it('sends no Authorization header when no token is stored', async () => {
    mock.onGet('/courses').reply((config) => {
      expect(config.headers.Authorization).toBeUndefined();
      return [200, { success: true }];
    });

    await service.get('/courses');

    expect(mock.history.get).toHaveLength(1);
  });

  it('attaches the stored user token as a bearer credential', async () => {
    window.localStorage.setItem('token', 'user-token-abc');
    mock.onGet('/courses').reply(200, { success: true });

    await service.get('/courses');

    expect(mock.history.get[0].headers.Authorization).toBe('Bearer user-token-abc');
  });

  it('prefers the admin token when both are stored', async () => {
    // An administrator browsing the admin console has both keys set. Sending
    // the student token would make every administrative call fail with 403.
    window.localStorage.setItem('token', 'user-token-abc');
    window.localStorage.setItem('adminToken', 'admin-token-xyz');
    mock.onGet('/admin/stats').reply(200, { success: true });

    await service.get('/admin/stats');

    expect(mock.history.get[0].headers.Authorization).toBe('Bearer admin-token-xyz');
  });

  it('sends the admin token when only it is stored', async () => {
    window.localStorage.setItem('adminToken', 'admin-token-xyz');
    mock.onGet('/admin/stats').reply(200, { success: true });

    await service.get('/admin/stats');

    expect(mock.history.get[0].headers.Authorization).toBe('Bearer admin-token-xyz');
  });
});

describe('apiService — response interceptor', () => {
  let service;
  let mock;

  beforeEach(async () => {
    service = await importService();
    mock = new MockAdapter(axiosInstanceOf(service));
  });

  it('clears the stored session and redirects to login on a 401', async () => {
    // Leaving a rejected token in storage would make every subsequent request
    // fail the same way, trapping the user in a broken session.
    window.localStorage.setItem('token', 'expired-token');
    window.localStorage.setItem('user', '{"name":"Ayesha"}');
    mock.onGet('/auth/me').reply(401, { success: false, message: 'Token is not valid' });

    await expect(service.get('/auth/me')).rejects.toBeDefined();

    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('user')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  it('leaves the session alone on a 403', async () => {
    // 403 means "signed in, but not permitted" — logging the user out would be
    // the wrong response to a permissions problem.
    window.localStorage.setItem('token', 'valid-token');
    mock.onGet('/admin/stats').reply(403, { success: false });

    await expect(service.get('/admin/stats')).rejects.toBeDefined();

    expect(window.localStorage.getItem('token')).toBe('valid-token');
  });

  it.each([400, 404, 409, 422, 500, 503])(
    'leaves the session alone on an HTTP %s',
    async (status) => {
      window.localStorage.setItem('token', 'valid-token');
      mock.onGet('/courses').reply(status, { success: false });

      await expect(service.get('/courses')).rejects.toBeDefined();

      expect(window.localStorage.getItem('token')).toBe('valid-token');
    },
  );

  it('rejects rather than resolving on a network failure', async () => {
    mock.onGet('/courses').networkError();

    await expect(service.get('/courses')).rejects.toBeDefined();
  });

  it('passes a successful response through untouched', async () => {
    mock.onGet('/courses').reply(200, { success: true, courses: [] });

    const response = await service.get('/courses');

    expect(response.data).toEqual({ success: true, courses: [] });
  });
});

describe('apiService — authentication methods', () => {
  let service;
  let mock;

  beforeEach(async () => {
    service = await importService();
    mock = new MockAdapter(axiosInstanceOf(service));
  });

  it('posts credentials to /auth/login and returns the envelope', async () => {
    mock.onPost('/auth/login').reply(200, {
      success: true,
      token: 'issued-token',
      user: { id: '1', name: 'Ayesha Perera', role: 'student' },
    });

    const result = await service.login({ email: 'ayesha@sriko.lk', password: 'TestPass123' });

    expect(mock.history.post[0].url).toBe('/auth/login');
    expect(JSON.parse(mock.history.post[0].data)).toEqual({
      email: 'ayesha@sriko.lk',
      password: 'TestPass123',
    });
    expect(result.token).toBe('issued-token');
  });

  it('propagates a failed login instead of swallowing it', async () => {
    // The login screen needs the rejection to show "invalid credentials";
    // a swallowed error would leave the form spinning.
    mock.onPost('/auth/login').reply(401, { success: false, message: 'Invalid email or password' });

    await expect(
      service.login({ email: 'ayesha@sriko.lk', password: 'wrong' }),
    ).rejects.toBeDefined();
  });

  it('posts the registration payload to /auth/register', async () => {
    mock.onPost('/auth/register').reply(201, { success: true, token: 't', user: { id: '1' } });

    await service.register({
      name: 'Ayesha Perera',
      email: 'ayesha@sriko.lk',
      password: 'TestPass123',
    });

    expect(mock.history.post[0].url).toBe('/auth/register');
  });

  it('unwraps the user object from the /auth/me envelope', async () => {
    mock.onGet('/auth/me').reply(200, { success: true, user: { id: '1', name: 'Ayesha Perera' } });

    const user = await service.getCurrentUser();

    expect(user).toEqual({ id: '1', name: 'Ayesha Perera' });
  });
});

describe('apiService — generic HTTP helpers', () => {
  let service;
  let mock;

  beforeEach(async () => {
    service = await importService();
    mock = new MockAdapter(axiosInstanceOf(service));
  });

  it.each([
    ['get', 'onGet'],
    ['delete', 'onDelete'],
  ])('%s issues the matching request', async (method, matcher) => {
    mock[matcher]('/resource').reply(200, { success: true });

    const response = await service[method]('/resource');

    expect(response.status).toBe(200);
  });

  it.each([
    ['post', 'onPost', 'post'],
    ['put', 'onPut', 'put'],
  ])('%s sends the supplied body', async (method, matcher, historyKey) => {
    mock[matcher]('/resource').reply(200, { success: true });

    await service[method]('/resource', { field: 'value' });

    expect(JSON.parse(mock.history[historyKey][0].data)).toEqual({ field: 'value' });
  });
});
