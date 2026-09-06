/**
 * The requirement catalogue this test suite traces against.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  IMPORTANT — read before using these identifiers in the final report.
 *
 *  SENG 34213 §4.3 requires every ticket and test to reference an SRS
 *  requirement ("Never implement without traceable design"). The SRS and SDS
 *  live in the `documentation` repository, which is currently empty, so this
 *  catalogue was derived *from the implementation* — by reading every route,
 *  model and middleware in the application and naming the capability each one
 *  provides.
 *
 *  That makes it a faithful description of what the system does, but it is not
 *  the same thing as the requirements the client agreed to. Before submission
 *  the team must reconcile the two:
 *
 *    1. Open the approved SRS and map each FR-xx / NFR-xx below onto its real
 *       SRS number.
 *    2. Renumber here — every `requirement` field in the suite refers to these
 *       ids, and `npm run report:traceability` fails loudly on an unknown one,
 *       so nothing can drift silently.
 *    3. Add any SRS requirement that has no entry here. It will appear
 *       immediately in the matrix as untested, which is exactly the signal the
 *       final report needs.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `endpoints` accepts `*` as a wildcard and is matched against
 * "METHOD /path" strings from the endpoint inventory.
 */

'use strict';

module.exports = [
  // ── Authentication and identity ────────────────────────────────────────────
  {
    id: 'FR-01',
    title: 'User Registration',
    description:
      'A visitor can create an account with a name, an email address and a password that ' +
      'meets the complexity policy. Email addresses are unique and case-insensitive; the ' +
      'password is stored only as a bcrypt hash.',
    endpoints: ['POST /api/auth/register', 'POST /api/admin/users'],
  },
  {
    id: 'FR-02',
    title: 'Authentication',
    description:
      'A registered user exchanges their credentials for a JSON Web Token. Deactivated ' +
      'accounts are refused, and failure messages do not reveal whether an account exists.',
    endpoints: ['POST /api/auth/login', 'POST /api/auth/admin-login'],
  },
  {
    id: 'FR-03',
    title: 'Google OAuth Authentication',
    description:
      'A user can sign in with a Google account. The ID token is verified against Google ' +
      'before any account is created or linked.',
    endpoints: ['POST /api/auth/google'],
  },
  {
    id: 'FR-04',
    title: 'Session and Token Management',
    description:
      'Every protected endpoint requires a valid, unexpired token belonging to an active ' +
      'account. The current user can read their own identity and sign out.',
    endpoints: ['GET /api/auth/me', 'POST /api/auth/logout'],
  },
  {
    id: 'FR-05',
    title: 'Role-Based Access Control',
    description:
      'Every endpoint enforces the roles it declares. Students, instructors and ' +
      'administrators see only what their role permits, and an instructor may act only on ' +
      'their own courses.',
    endpoints: ['GET /api/admin/*', 'PUT /api/admin/*', 'POST /api/admin/*', 'DELETE /api/admin/*'],
  },

  // ── Profile and account ────────────────────────────────────────────────────
  {
    id: 'FR-06',
    title: 'User Profile Management',
    description:
      'A user maintains their own profile, notification preferences and privacy settings. ' +
      'A profile update can never change the account’s role or email address.',
    endpoints: [
      'GET /api/users/profile',
      'PUT /api/users/profile',
      'PUT /api/users/notifications',
      'PUT /api/users/privacy',
      'PUT /api/users/last-login',
    ],
  },
  {
    id: 'FR-07',
    title: 'Password Management',
    description:
      'A signed-in user changes their password by supplying the current one. Reset tokens ' +
      'are single-use, expire after ten minutes and are stored only as a hash.',
    endpoints: ['PUT /api/users/password'],
  },

  // ── Courses and learning ───────────────────────────────────────────────────
  {
    id: 'FR-08',
    title: 'Course Catalogue and Search',
    description:
      'Anyone can browse, filter, search and paginate the published course catalogue and ' +
      'open a course detail page, without signing in.',
    endpoints: ['GET /api/courses', 'GET /api/courses/:id'],
  },
  {
    id: 'FR-09',
    title: 'Course Authoring',
    description:
      'An instructor creates, updates and deletes their own courses, including the weekly ' +
      'curriculum and its lessons. An administrator may act on any course.',
    endpoints: ['POST /api/courses', 'PUT /api/courses/:id', 'DELETE /api/courses/:id'],
  },
  {
    id: 'FR-10',
    title: 'Course Enrolment',
    description:
      'A student enrols in a published course and may un-enrol. Enrolment creates a ' +
      'progress record and is reflected on both the course roster and the student’s ' +
      'account. A student cannot enrol twice.',
    endpoints: [
      'POST /api/courses/:id/enroll',
      'DELETE /api/courses/:id/enroll',
      'GET /api/courses/my-courses',
    ],
  },
  {
    id: 'FR-11',
    title: 'Learning Progress and Completion',
    description:
      'Progress is tracked per enrolment as a percentage of lessons completed. Marking a ' +
      'course complete stamps a completion date, which drives certificate eligibility and ' +
      'the analytics dashboard.',
    endpoints: ['POST /api/courses/:id/complete', 'GET /api/users/dashboard'],
  },
  {
    id: 'FR-12',
    title: 'Course Reviews and Ratings',
    description:
      'A user reviews a course once, with a rating of one to five and an optional comment. ' +
      'The course average is recalculated on every change.',
    endpoints: ['POST /api/courses/:id/reviews'],
  },

  // ── Commerce ───────────────────────────────────────────────────────────────
  {
    id: 'FR-13',
    title: 'Subscription Plan Management',
    description:
      'Three plans — starter, pro and premium — with monthly and yearly billing. A user ' +
      'holds one active subscription, may upgrade but not downgrade through the upgrade ' +
      'endpoint, and may cancel. Usage is reported against the plan limits.',
    endpoints: [
      'GET /api/subscriptions/plans',
      'GET /api/subscriptions/current',
      'POST /api/subscriptions/create',
      'PUT /api/subscriptions/upgrade',
      'PUT /api/subscriptions/cancel',
      'GET /api/subscriptions/usage',
    ],
  },
  {
    id: 'FR-14',
    title: 'Payment Processing and Invoicing',
    description:
      'Payments are recorded against a subscription, completed or failed with a gateway ' +
      'reference, and refundable once completed. Every payment receives a unique invoice ' +
      'number, and a customer can read only their own payments and invoices.',
    endpoints: [
      'POST /api/payments/create',
      'PUT /api/payments/:id/complete',
      'PUT /api/payments/:id/fail',
      'POST /api/payments/:id/refund',
      'GET /api/payments/*',
      'GET /api/subscriptions/payments',
      'GET /api/subscriptions/invoice/:id',
      'PUT /api/admin/payments/:id/status',
    ],
  },
  {
    id: 'FR-15',
    title: 'Certificate Issuance and Delivery',
    description:
      'An administrator issues a certificate to a student who has completed a course. ' +
      'Certificate numbers are unique and sequential per year. A student sees only their ' +
      'own certificates and the first viewing is recorded.',
    endpoints: [
      'GET /api/certificates*',
      'POST /api/certificates',
      'POST /api/certificates/:id/send',
      'POST /api/certificates/:id/mark-viewed',
      'PUT /api/certificates/:id/status',
      'DELETE /api/certificates/:id',
    ],
  },

  // ── Communication ──────────────────────────────────────────────────────────
  {
    id: 'FR-16',
    title: 'Announcements',
    description:
      'An administrator publishes announcements targeted at an audience and a date window. ' +
      'Users see only announcements addressed to them, and can mark one as read.',
    endpoints: [
      'GET /api/announcements*',
      'POST /api/announcements*',
      'PUT /api/announcements/*',
      'DELETE /api/announcements/:id',
    ],
  },
  {
    id: 'FR-17',
    title: 'Discussion Forums',
    description:
      'An administrator manages forums by category and level. Users read forums, subscribe ' +
      'to them and post. A locked or inactive forum accepts no new posts.',
    endpoints: [
      'GET /api/forums*',
      'POST /api/forums*',
      'PUT /api/forums/*',
      'DELETE /api/forums/:id',
    ],
  },
  {
    id: 'FR-18',
    title: 'Notifications',
    description:
      'An administrator sends notifications to an audience, to named users, or to the ' +
      'parents of named students. Users see notifications addressed to them within their ' +
      'scheduling window and can mark them read or clicked.',
    endpoints: [
      'GET /api/notifications*',
      'POST /api/notifications*',
      'PUT /api/notifications/*',
      'DELETE /api/notifications/:id',
    ],
  },

  // ── Administration ─────────────────────────────────────────────────────────
  {
    id: 'FR-19',
    title: 'Administrative User Management',
    description:
      'An administrator lists, creates, edits, suspends and deletes user accounts. A ' +
      'suspended account can no longer sign in.',
    endpoints: [
      'GET /api/users',
      'GET /api/users/:id',
      'PUT /api/users/:id',
      'DELETE /api/users/:id',
      'GET /api/admin/users',
      'POST /api/admin/users',
      'PUT /api/admin/users/:id',
      'PUT /api/admin/users/:id/status',
      'DELETE /api/admin/users/:id',
    ],
  },
  {
    id: 'FR-20',
    title: 'Administrative Course Management',
    description:
      'An administrator lists every course, creates one on behalf of an instructor, edits ' +
      'any course, and publishes or withdraws it from the public catalogue.',
    endpoints: [
      'GET /api/admin/courses',
      'POST /api/admin/courses',
      'PUT /api/admin/courses/:id',
      'PUT /api/admin/courses/:id/status',
      'DELETE /api/admin/courses/:id',
    ],
  },
  {
    id: 'FR-21',
    title: 'Analytics and Reporting',
    description:
      'The administrative dashboard reports user, course and revenue totals, a rolling ' +
      'analytics period, and a recent-activity feed. Only completed payments count as ' +
      'revenue.',
    endpoints: [
      'GET /api/admin/stats',
      'GET /api/admin/analytics',
      'GET /api/admin/analytics/export',
      'GET /api/admin/activities',
      'GET /api/admin/payment-stats',
      'GET /api/admin/recent-payments',
      'GET /api/admin/all-payments',
    ],
  },
  {
    id: 'FR-22',
    title: 'System Settings',
    description:
      'A single settings document holds site configuration. An administrator reads and ' +
      'updates it whole or by section, resets it to defaults, and exports or imports it.',
    endpoints: [
      'GET /api/admin/settings*',
      'PUT /api/admin/settings*',
      'POST /api/admin/settings/*',
    ],
  },
  {
    id: 'FR-23',
    title: 'Enquiry Submission (Join Us)',
    description:
      'A prospective student submits an enquiry without an account. Administrators triage ' +
      'the queue through a status workflow of pending, contacted, enrolled and rejected.',
    endpoints: [
      'POST /api/join-us/submit',
      'GET /api/join-us/*',
      'PUT /api/join-us/*',
      'DELETE /api/join-us/*',
    ],
  },
  {
    id: 'FR-24',
    title: 'File Upload',
    description:
      'Users upload an avatar image and administrators upload certificate documents. Only ' +
      'permitted file types are accepted, sizes are capped, and stored filenames are ' +
      'generated rather than taken from the client.',
    endpoints: ['POST /api/users/avatar'],
  },
  {
    id: 'FR-25',
    title: 'Health and Observability',
    description:
      'The service exposes unauthenticated health endpoints reporting its own and the ' +
      'database’s status, answers unknown routes with a JSON 404, and works behind the ' +
      'Choreo deployment prefix.',
    endpoints: ['GET /health', 'GET /api/health', 'GET /api/test'],
  },

  // ── Non-functional ─────────────────────────────────────────────────────────
  {
    id: 'NFR-01',
    title: 'Performance',
    description:
      '95 % of requests complete within 500 ms and 99 % within 1200 ms under the expected ' +
      'load of 50 concurrent users; fewer than 1 % of requests fail. Verified by the k6 ' +
      'suite in tests/performance.',
    endpoints: [],
  },
  {
    id: 'NFR-02',
    title: 'Availability and Data Integrity',
    description:
      'The service recovers from a lost database connection, and database constraints — ' +
      'unique email, unique enrolment, unique invoice and certificate numbers — hold even ' +
      'when application-level checks race.',
    endpoints: [],
  },
  {
    id: 'NFR-03',
    title: 'Security',
    description:
      'The system addresses the OWASP Top 10 as set out in SENG 34213 §8.1: access control ' +
      'on every endpoint, hashed credentials, validated input, security headers, dependency ' +
      'scanning, and audit logging free of secrets.',
    endpoints: [],
  },
  {
    id: 'NFR-04',
    title: 'Input Validation',
    description:
      'Every write endpoint validates its input before it reaches the database, and reports ' +
      'every offending field in a single response rather than one at a time.',
    endpoints: [],
  },
  {
    id: 'NFR-05',
    title: 'Usability and Responsiveness',
    description:
      'The interface is usable on a phone-sized viewport: no page scrolls horizontally, and ' +
      'primary actions stay within the viewport. Verified by the Playwright suite.',
    endpoints: [],
  },
];
