/**
 * Performance scenario — smoke.
 *
 * Requirements: NFR-01 (Performance), FR-25 (Health & Observability).
 *
 * One virtual user, one pass through the read-only public surface. This is not
 * a load test: it is the gate that says "the system is up and correct enough
 * to be worth load testing", and it is cheap enough to run on every push.
 *
 *   npm run test:perf:smoke
 */

import { sleep } from 'k6';

import { THRESHOLDS } from '../lib/config.js';
import { browseCatalogue, healthCheck, readPlans } from '../lib/helpers.js';

export const options = {
  vus: 1,
  iterations: 10,
  thresholds: THRESHOLDS,
  tags: { scenario: 'smoke' },
};

export default function smoke() {
  healthCheck();
  browseCatalogue();
  readPlans();
  sleep(0.5);
}
