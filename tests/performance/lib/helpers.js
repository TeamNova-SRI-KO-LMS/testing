/**
 * Request helpers shared by the k6 scenarios.
 *
 * Every request is tagged with an `endpoint` label so the thresholds in
 * `config.js` can hold different endpoints to different standards — a login
 * that takes 700 ms is fine, a catalogue page that takes 700 ms is not.
 */

import http from 'k6/http';
import { check } from 'k6';

import { BASE_URL, VALID_PASSWORD, jsonHeaders, uniqueEmail } from './config.js';

/** Register a user and return their token, or null if registration failed. */
export function registerUser(role = 'student') {
  const payload = JSON.stringify({
    name: `Perf User ${__VU}-${__ITER}`,
    email: uniqueEmail(role),
    password: VALID_PASSWORD,
    role,
  });

  const response = http.post(`${BASE_URL}/api/auth/register`, payload, {
    headers: jsonHeaders,
    tags: { endpoint: 'register' },
  });

  const ok = check(response, {
    'registration returns 201': (r) => r.status === 201,
    'registration returns a token': (r) => Boolean(r.json('token')),
  });

  return ok ? { token: response.json('token'), email: JSON.parse(payload).email } : null;
}

/** Log in and return the issued token, or null. */
export function login(email, password = VALID_PASSWORD) {
  const response = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email, password }), {
    headers: jsonHeaders,
    tags: { endpoint: 'login' },
  });

  const ok = check(response, {
    'login returns 200': (r) => r.status === 200,
    'login returns a token': (r) => Boolean(r.json('token')),
  });

  return ok ? response.json('token') : null;
}

export function browseCatalogue() {
  const response = http.get(`${BASE_URL}/api/courses?page=1&limit=10`, {
    tags: { endpoint: 'catalogue' },
  });

  check(response, {
    'catalogue returns 200': (r) => r.status === 200,
    'catalogue returns an array of courses': (r) => Array.isArray(r.json('courses')),
  });

  return response;
}

export function readPlans() {
  const response = http.get(`${BASE_URL}/api/subscriptions/plans`, {
    tags: { endpoint: 'plans' },
  });

  check(response, { 'plans return 200': (r) => r.status === 200 });
  return response;
}

export function healthCheck() {
  const response = http.get(`${BASE_URL}/api/health`, { tags: { endpoint: 'health' } });

  check(response, {
    'health returns 200': (r) => r.status === 200,
    'health reports the database as connected': (r) => r.json('mongodb') === 'Connected',
  });

  return response;
}

export function readProfile(token) {
  const response = http.get(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { endpoint: 'profile' },
  });

  check(response, { 'profile returns 200': (r) => r.status === 200 });
  return response;
}
