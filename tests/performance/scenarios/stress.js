/**
 * Performance scenario — stress.
 *
 * Requirements: NFR-01 (Performance), NFR-02 (Availability).
 *
 * Pushes past the expected peak until something gives, to find where the
 * breaking point is *before* a real cohort finds it. Failure here is
 * informative, not a build failure: the thresholds are relaxed deliberately.
 *
 *   npm run test:perf:stress
 */

import { sleep } from 'k6';

import { BASE_URL } from '../lib/config.js';
import { browseCatalogue, healthCheck } from '../lib/helpers.js';

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '2m', target: 150 },
    { duration: '2m', target: 300 },
    { duration: '1m', target: 0 },
  ],
  // Relaxed on purpose: the question is "where does it break and how", not
  // "does it stay under 500 ms at 300 concurrent users".
  thresholds: {
    http_req_failed: ['rate<0.15'],
    http_req_duration: ['p(95)<5000'],
  },
  tags: { scenario: 'stress' },
};

export function setup() {
  // Refuse to stress a system that is already unhealthy — the results would be
  // meaningless and the report misleading.
  const health = healthCheck();
  if (health.status !== 200) {
    throw new Error(
      `The system under test is not healthy at ${BASE_URL}; aborting the stress run.`,
    );
  }
}

export default function stress() {
  browseCatalogue();
  sleep(0.5);
}
