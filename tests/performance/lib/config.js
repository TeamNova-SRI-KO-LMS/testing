/**
 * Shared configuration and helpers for the k6 performance suite.
 *
 * k6 runs its own JavaScript runtime (goja) with its own module system, so
 * nothing here can `require` from the rest of the harness. Everything the
 * scenarios need is self-contained and configured through environment
 * variables, which is also how the CI job parameterises a run.
 */

export const BASE_URL = __ENV.PERF_BASE_URL || 'http://localhost:5001';

/**
 * Non-functional targets.
 *
 * Numbers are deliberately modest: the point of a threshold is to catch a
 * regression, and a threshold nobody can meet gets disabled within a sprint.
 * They match `testing.config.js` so the JavaScript and k6 halves cannot drift.
 */
export const THRESHOLDS = {
  // Fewer than 1 % of requests may fail outright.
  http_req_failed: ['rate<0.01'],
  // 95 % of requests under 500 ms, 99 % under 1.2 s.
  http_req_duration: ['p(95)<500', 'p(99)<1200'],
  // Authentication is intentionally slower: bcrypt is doing real work.
  'http_req_duration{endpoint:login}': ['p(95)<800'],
  'http_req_duration{endpoint:catalogue}': ['p(95)<400'],
  'http_req_duration{endpoint:health}': ['p(95)<150'],
  checks: ['rate>0.99'],
};

/** A password that satisfies the application's registration policy. */
export const VALID_PASSWORD = 'TestPass123';

export function uniqueEmail(prefix) {
  return `perf.${prefix}.${__VU}.${__ITER}.${Date.now()}@sriko-test.lk`;
}

export const jsonHeaders = { 'Content-Type': 'application/json' };

export function authHeaders(token) {
  return { ...jsonHeaders, Authorization: `Bearer ${token}` };
}
