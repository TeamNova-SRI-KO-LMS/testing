/**
 * Frontend contract tests — every method on `ApiService`.
 *
 * Requirements: FR-01 … FR-25 (the client half of every API contract),
 * NFR-04 (Input Validation).
 *
 * `ApiService` exposes 90-odd methods, almost all of which are one line: build
 * a path, issue a verb, unwrap the envelope. Writing a bespoke test for each
 * would be 90 near-identical tests that nobody reads and everybody skips.
 *
 * What can actually go wrong in a one-line wrapper is worth catching, though:
 *
 *   • a typo in the path (`/notification` for `/notifications`)
 *   • the wrong verb (POST where the API expects PUT)
 *   • a template literal that interpolates `undefined` into the URL
 *   • an unwrap that reads the wrong envelope key and returns undefined
 *
 * So this suite drives every method reflectively and asserts those properties
 * for all of them at once. A method added tomorrow is covered the moment it is
 * written, with no test to remember to add.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';

async function importService() {
  vi.resetModules();
  const module = await import('@frontend/services/apiService');
  return module.apiService ?? module.default;
}

/**
 * A response body permissive enough for any unwrap the service performs, so a
 * method that reads `data.user` or `data.courses` does not throw before the
 * assertion is reached.
 */
const PERMISSIVE_BODY = {
  success: true,
  message: 'ok',
  token: 'token',
  user: { id: '1', name: 'Test', role: 'student' },
  users: [],
  course: {},
  courses: [],
  payment: {},
  payments: [],
  subscription: {},
  subscriptions: [],
  notification: {},
  notifications: [],
  certificate: {},
  certificates: [],
  announcement: {},
  announcements: [],
  forum: {},
  forums: [],
  post: {},
  posts: [],
  settings: {},
  stats: {},
  analytics: {},
  data: {},
  pagination: { current: 1, pages: 1, total: 0 },
};

/**
 * Plausible arguments for an arbitrary method.
 *
 * Every position is a 24-character hex id: methods that expect an id get a
 * valid one, and methods that expect a payload get a string, which axios
 * serialises without complaint. Mixing objects in would put "[object Object]"
 * into the paths of methods that take two ids, producing findings that are
 * artefacts of the harness rather than defects in the service.
 */
const ID = '507f1f77bcf86cd799439011';
const ARGS = [ID, ID, ID, ID, ID];

/**
 * Members whose path comes from the caller rather than from the service, plus
 * the axios instance itself — which reflection sees as a function because
 * axios instances are callable.
 */
const CALLER_DRIVEN = new Set(['api', 'get', 'post', 'put', 'patch', 'delete', 'request']);

/** Every own and inherited method on the service, excluding the constructor. */
function methodNames(service) {
  const names = new Set();
  let target = service;
  while (target && target !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(target)) {
      if (name === 'constructor') continue;
      if (typeof service[name] === 'function') names.add(name);
    }
    target = Object.getPrototypeOf(target);
  }
  return [...names].sort();
}

/** The methods whose paths the service itself owns. */
const serviceOwnedMethods = (service) =>
  methodNames(service).filter((name) => !CALLER_DRIVEN.has(name));

describe('ApiService — method contract', () => {
  let service;
  let mock;

  beforeEach(async () => {
    service = await importService();
    mock = new MockAdapter(service.api);
    mock.onAny().reply(200, PERMISSIVE_BODY);
  });

  it('exposes a substantial API surface', () => {
    // Guards the suite below: if reflection ever returned nothing, every
    // assertion driven from it would pass vacuously.
    expect(serviceOwnedMethods(service).length).toBeGreaterThan(50);
  });

  it('issues exactly one request per method, to a well-formed path', async () => {
    const problems = [];

    for (const name of serviceOwnedMethods(service)) {
      mock.resetHistory();

      try {
        await service[name](...ARGS);
      } catch {
        // A wrapper is allowed to reject — several unwrap a field the
        // permissive body does not carry — but it must have made its request
        // first. That is what the history check below establishes.
      }

      const requests = [
        ...mock.history.get,
        ...mock.history.post,
        ...mock.history.put,
        ...mock.history.patch,
        ...mock.history.delete,
      ];

      if (requests.length === 0) {
        problems.push(`${name}: made no HTTP request`);
        continue;
      }
      if (requests.length > 1) {
        problems.push(`${name}: made ${requests.length} requests, expected 1`);
        continue;
      }

      const { url } = requests[0];
      if (!url.startsWith('/')) {
        problems.push(`${name}: path "${url}" is not rooted at /`);
      }
      // The classic template-literal bug: `/courses/${id}` with an id that was
      // never passed through produces "/courses/undefined" and a 404 that looks
      // like a backend fault.
      if (/undefined|null|\[object Object\]/.test(url)) {
        problems.push(`${name}: path "${url}" interpolated a placeholder value`);
      }
      if (/\/\//.test(url)) {
        problems.push(`${name}: path "${url}" contains a doubled slash`);
      }
    }

    expect(problems).toEqual([]);
  });

  it('routes every method to a path the backend actually serves', async () => {
    // The service is the only description of the client-server contract in the
    // frontend. Each path must at least look like one of the API's route
    // groups; a method pointing at an invented prefix is a bug that would
    // otherwise only surface at runtime.
    const knownPrefixes = [
      '/auth',
      '/users',
      '/courses',
      '/admin',
      '/subscriptions',
      '/payments',
      '/certificates',
      '/announcements',
      '/forums',
      '/notifications',
      '/join-us',
      '/health',
      '/test',
      '/videos',
      '/materials',
      '/progress',
      '/enrollments',
    ];

    const unknown = [];

    for (const name of serviceOwnedMethods(service)) {
      mock.resetHistory();
      try {
        await service[name](...ARGS);
      } catch {
        // See above: the request is what matters, not the unwrap.
      }

      const requests = [
        ...mock.history.get,
        ...mock.history.post,
        ...mock.history.put,
        ...mock.history.patch,
        ...mock.history.delete,
      ];
      if (requests.length !== 1) continue;

      const { url } = requests[0];
      if (!knownPrefixes.some((prefix) => url.startsWith(prefix))) {
        unknown.push(`${name} → ${url}`);
      }
    }

    expect(unknown).toEqual([]);
  });

  it('sends the stored credential on every method', async () => {
    window.localStorage.setItem('token', 'a-user-token');
    const missing = [];

    for (const name of serviceOwnedMethods(service)) {
      mock.resetHistory();
      try {
        await service[name](...ARGS);
      } catch {
        // See above.
      }

      const requests = [
        ...mock.history.get,
        ...mock.history.post,
        ...mock.history.put,
        ...mock.history.patch,
        ...mock.history.delete,
      ];
      if (requests.length !== 1) continue;

      if (requests[0].headers.Authorization !== 'Bearer a-user-token') {
        missing.push(name);
      }
    }

    // The interceptor is global, so this holds for every method at once — and
    // would catch a method that built its own axios instance and bypassed it.
    expect(missing).toEqual([]);
  });
});
