/**
 * Performance scenario — spike.
 *
 * Requirements: NFR-01 (Performance), NFR-02 (Availability).
 *
 * Models enrolment day: near-zero traffic, then 200 users arrive within
 * seconds. What matters is not only whether the system survives the spike but
 * whether it *recovers* — the tail of this run is as informative as the peak.
 *
 *   npm run test:perf:spike
 */

import { sleep } from 'k6';

import { browseCatalogue, healthCheck } from '../lib/helpers.js';

export const options = {
  stages: [
    { duration: '20s', target: 5 }, // quiet
    { duration: '10s', target: 200 }, // the spike
    { duration: '40s', target: 200 }, // sustained
    { duration: '20s', target: 5 }, // back to quiet
    { duration: '30s', target: 5 }, // recovery window
  ],
  thresholds: {
    http_req_failed: ['rate<0.20'],
    // The recovery window carries the real requirement: once the spike passes,
    // response times must return to normal rather than staying degraded.
    'http_req_duration{endpoint:health}': ['p(95)<2000'],
  },
  tags: { scenario: 'spike' },
};

export default function spike() {
  healthCheck();
  browseCatalogue();
  sleep(0.3);
}
