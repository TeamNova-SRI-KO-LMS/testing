/**
 * Performance scenario — expected load.
 *
 * Requirements: NFR-01 (Performance), FR-08 (Catalogue), FR-02 (Authentication).
 *
 * Models an ordinary teaching day: a cohort browsing the catalogue with a
 * steady trickle of sign-ins. Ramps to 50 concurrent users, holds, then ramps
 * down so the recovery behaviour is visible too.
 *
 * This is the run that produces the numbers for the performance report
 * (deliverable §10.1 #9).
 *
 *   npm run test:perf:load
 */

import { sleep } from 'k6';

import { THRESHOLDS } from '../lib/config.js';
import { browseCatalogue, login, readPlans, readProfile, registerUser } from '../lib/helpers.js';

export const options = {
  stages: [
    { duration: '30s', target: 10 }, // warm up
    { duration: '1m', target: 50 }, // ramp to the expected peak
    { duration: '2m', target: 50 }, // hold — where the real numbers come from
    { duration: '30s', target: 0 }, // ramp down and observe recovery
  ],
  thresholds: THRESHOLDS,
  tags: { scenario: 'load' },
};

/**
 * A realistic mix rather than a single endpoint hammered flat.
 *
 * Roughly 70 % of a session is anonymous browsing and 30 % involves
 * authentication, which is what the access logs of an LMS look like. Hammering
 * one endpoint produces a number that no user experience corresponds to.
 */
export default function underLoad() {
  browseCatalogue();
  sleep(1);

  if (__ITER % 10 < 3) {
    const user = registerUser('student');
    if (user) {
      const token = login(user.email);
      if (token) readProfile(token);
    }
  } else {
    readPlans();
  }

  sleep(Math.random() * 2 + 1); // 1–3 s of think time between actions
}
