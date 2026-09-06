# Requirements Catalogue

The functional and non-functional requirements this test suite traces against.

> **⚠️ Reconcile these identifiers with the approved SRS before submission.**
>
> SENG 34213 §4.3 requires every test to reference an SRS requirement
> ("Never implement without traceable design"). The SRS and SDS live in the
> `documentation` repository, which is currently empty, so this catalogue was
> derived **from the implementation** — by reading every route, model and
> middleware in the application and naming the capability each one provides.
>
> It is a faithful description of what the system does. It is not the same
> thing as the requirements the client agreed to. To reconcile them:
>
> 1. Map each identifier below onto its real SRS number.
> 2. Renumber in `src/registry/requirements.js`. Every `requirement` field in
>    the suite refers to these ids, and `npm run report:traceability` fails on
>    an unknown one — so nothing can drift silently.
> 3. Add any SRS requirement with no entry here. It appears immediately in the
>    matrix as untested, which is exactly the signal the final report needs.

Source of truth: [`src/registry/requirements.js`](../src/registry/requirements.js).
Coverage per requirement: [TRACEABILITY_MATRIX.md](./testing/TRACEABILITY_MATRIX.md).

## Index

| ID       | Title                             | Endpoints |
| -------- | --------------------------------- | --------- |
| `FR-01`  | User Registration                 | 2         |
| `FR-02`  | Authentication                    | 2         |
| `FR-03`  | Google OAuth Authentication       | 1         |
| `FR-04`  | Session and Token Management      | 2         |
| `FR-05`  | Role-Based Access Control         | 4         |
| `FR-06`  | User Profile Management           | 5         |
| `FR-07`  | Password Management               | 1         |
| `FR-08`  | Course Catalogue and Search       | 2         |
| `FR-09`  | Course Authoring                  | 3         |
| `FR-10`  | Course Enrolment                  | 3         |
| `FR-11`  | Learning Progress and Completion  | 2         |
| `FR-12`  | Course Reviews and Ratings        | 1         |
| `FR-13`  | Subscription Plan Management      | 6         |
| `FR-14`  | Payment Processing and Invoicing  | 8         |
| `FR-15`  | Certificate Issuance and Delivery | 6         |
| `FR-16`  | Announcements                     | 4         |
| `FR-17`  | Discussion Forums                 | 4         |
| `FR-18`  | Notifications                     | 4         |
| `FR-19`  | Administrative User Management    | 9         |
| `FR-20`  | Administrative Course Management  | 5         |
| `FR-21`  | Analytics and Reporting           | 7         |
| `FR-22`  | System Settings                   | 3         |
| `FR-23`  | Enquiry Submission (Join Us)      | 4         |
| `FR-24`  | File Upload                       | 1         |
| `FR-25`  | Health and Observability          | 3         |
| `NFR-01` | Performance                       | —         |
| `NFR-02` | Availability and Data Integrity   | —         |
| `NFR-03` | Security                          | —         |
| `NFR-04` | Input Validation                  | —         |
| `NFR-05` | Usability and Responsiveness      | —         |

## Functional requirements

### FR-01 — User Registration

A visitor can create an account with a name, an email address and a password that meets the complexity policy. Email addresses are unique and case-insensitive; the password is stored only as a bcrypt hash.

**Implemented by:**

- `POST /api/auth/register`
- `POST /api/admin/users`

### FR-02 — Authentication

A registered user exchanges their credentials for a JSON Web Token. Deactivated accounts are refused, and failure messages do not reveal whether an account exists.

**Implemented by:**

- `POST /api/auth/login`
- `POST /api/auth/admin-login`

### FR-03 — Google OAuth Authentication

A user can sign in with a Google account. The ID token is verified against Google before any account is created or linked.

**Implemented by:**

- `POST /api/auth/google`

### FR-04 — Session and Token Management

Every protected endpoint requires a valid, unexpired token belonging to an active account. The current user can read their own identity and sign out.

**Implemented by:**

- `GET /api/auth/me`
- `POST /api/auth/logout`

### FR-05 — Role-Based Access Control

Every endpoint enforces the roles it declares. Students, instructors and administrators see only what their role permits, and an instructor may act only on their own courses.

**Implemented by:**

- `GET /api/admin/*`
- `PUT /api/admin/*`
- `POST /api/admin/*`
- `DELETE /api/admin/*`

### FR-06 — User Profile Management

A user maintains their own profile, notification preferences and privacy settings. A profile update can never change the account’s role or email address.

**Implemented by:**

- `GET /api/users/profile`
- `PUT /api/users/profile`
- `PUT /api/users/notifications`
- `PUT /api/users/privacy`
- `PUT /api/users/last-login`

### FR-07 — Password Management

A signed-in user changes their password by supplying the current one. Reset tokens are single-use, expire after ten minutes and are stored only as a hash.

**Implemented by:**

- `PUT /api/users/password`

### FR-08 — Course Catalogue and Search

Anyone can browse, filter, search and paginate the published course catalogue and open a course detail page, without signing in.

**Implemented by:**

- `GET /api/courses`
- `GET /api/courses/:id`

### FR-09 — Course Authoring

An instructor creates, updates and deletes their own courses, including the weekly curriculum and its lessons. An administrator may act on any course.

**Implemented by:**

- `POST /api/courses`
- `PUT /api/courses/:id`
- `DELETE /api/courses/:id`

### FR-10 — Course Enrolment

A student enrols in a published course and may un-enrol. Enrolment creates a progress record and is reflected on both the course roster and the student’s account. A student cannot enrol twice.

**Implemented by:**

- `POST /api/courses/:id/enroll`
- `DELETE /api/courses/:id/enroll`
- `GET /api/courses/my-courses`

### FR-11 — Learning Progress and Completion

Progress is tracked per enrolment as a percentage of lessons completed. Marking a course complete stamps a completion date, which drives certificate eligibility and the analytics dashboard.

**Implemented by:**

- `POST /api/courses/:id/complete`
- `GET /api/users/dashboard`

### FR-12 — Course Reviews and Ratings

A user reviews a course once, with a rating of one to five and an optional comment. The course average is recalculated on every change.

**Implemented by:**

- `POST /api/courses/:id/reviews`

### FR-13 — Subscription Plan Management

Three plans — starter, pro and premium — with monthly and yearly billing. A user holds one active subscription, may upgrade but not downgrade through the upgrade endpoint, and may cancel. Usage is reported against the plan limits.

**Implemented by:**

- `GET /api/subscriptions/plans`
- `GET /api/subscriptions/current`
- `POST /api/subscriptions/create`
- `PUT /api/subscriptions/upgrade`
- `PUT /api/subscriptions/cancel`
- `GET /api/subscriptions/usage`

### FR-14 — Payment Processing and Invoicing

Payments are recorded against a subscription, completed or failed with a gateway reference, and refundable once completed. Every payment receives a unique invoice number, and a customer can read only their own payments and invoices.

**Implemented by:**

- `POST /api/payments/create`
- `PUT /api/payments/:id/complete`
- `PUT /api/payments/:id/fail`
- `POST /api/payments/:id/refund`
- `GET /api/payments/*`
- `GET /api/subscriptions/payments`
- `GET /api/subscriptions/invoice/:id`
- `PUT /api/admin/payments/:id/status`

### FR-15 — Certificate Issuance and Delivery

An administrator issues a certificate to a student who has completed a course. Certificate numbers are unique and sequential per year. A student sees only their own certificates and the first viewing is recorded.

**Implemented by:**

- `GET /api/certificates*`
- `POST /api/certificates`
- `POST /api/certificates/:id/send`
- `POST /api/certificates/:id/mark-viewed`
- `PUT /api/certificates/:id/status`
- `DELETE /api/certificates/:id`

### FR-16 — Announcements

An administrator publishes announcements targeted at an audience and a date window. Users see only announcements addressed to them, and can mark one as read.

**Implemented by:**

- `GET /api/announcements*`
- `POST /api/announcements*`
- `PUT /api/announcements/*`
- `DELETE /api/announcements/:id`

### FR-17 — Discussion Forums

An administrator manages forums by category and level. Users read forums, subscribe to them and post. A locked or inactive forum accepts no new posts.

**Implemented by:**

- `GET /api/forums*`
- `POST /api/forums*`
- `PUT /api/forums/*`
- `DELETE /api/forums/:id`

### FR-18 — Notifications

An administrator sends notifications to an audience, to named users, or to the parents of named students. Users see notifications addressed to them within their scheduling window and can mark them read or clicked.

**Implemented by:**

- `GET /api/notifications*`
- `POST /api/notifications*`
- `PUT /api/notifications/*`
- `DELETE /api/notifications/:id`

### FR-19 — Administrative User Management

An administrator lists, creates, edits, suspends and deletes user accounts. A suspended account can no longer sign in.

**Implemented by:**

- `GET /api/users`
- `GET /api/users/:id`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PUT /api/admin/users/:id`
- `PUT /api/admin/users/:id/status`
- `DELETE /api/admin/users/:id`

### FR-20 — Administrative Course Management

An administrator lists every course, creates one on behalf of an instructor, edits any course, and publishes or withdraws it from the public catalogue.

**Implemented by:**

- `GET /api/admin/courses`
- `POST /api/admin/courses`
- `PUT /api/admin/courses/:id`
- `PUT /api/admin/courses/:id/status`
- `DELETE /api/admin/courses/:id`

### FR-21 — Analytics and Reporting

The administrative dashboard reports user, course and revenue totals, a rolling analytics period, and a recent-activity feed. Only completed payments count as revenue.

**Implemented by:**

- `GET /api/admin/stats`
- `GET /api/admin/analytics`
- `GET /api/admin/analytics/export`
- `GET /api/admin/activities`
- `GET /api/admin/payment-stats`
- `GET /api/admin/recent-payments`
- `GET /api/admin/all-payments`

### FR-22 — System Settings

A single settings document holds site configuration. An administrator reads and updates it whole or by section, resets it to defaults, and exports or imports it.

**Implemented by:**

- `GET /api/admin/settings*`
- `PUT /api/admin/settings*`
- `POST /api/admin/settings/*`

### FR-23 — Enquiry Submission (Join Us)

A prospective student submits an enquiry without an account. Administrators triage the queue through a status workflow of pending, contacted, enrolled and rejected.

**Implemented by:**

- `POST /api/join-us/submit`
- `GET /api/join-us/*`
- `PUT /api/join-us/*`
- `DELETE /api/join-us/*`

### FR-24 — File Upload

Users upload an avatar image and administrators upload certificate documents. Only permitted file types are accepted, sizes are capped, and stored filenames are generated rather than taken from the client.

**Implemented by:**

- `POST /api/users/avatar`

### FR-25 — Health and Observability

The service exposes unauthenticated health endpoints reporting its own and the database’s status, answers unknown routes with a JSON 404, and works behind the Choreo deployment prefix.

**Implemented by:**

- `GET /health`
- `GET /api/health`
- `GET /api/test`

## Non-functional requirements

### NFR-01 — Performance

95 % of requests complete within 500 ms and 99 % within 1200 ms under the expected load of 50 concurrent users; fewer than 1 % of requests fail. Verified by the k6 suite in tests/performance.

### NFR-02 — Availability and Data Integrity

The service recovers from a lost database connection, and database constraints — unique email, unique enrolment, unique invoice and certificate numbers — hold even when application-level checks race.

### NFR-03 — Security

The system addresses the OWASP Top 10 as set out in SENG 34213 §8.1: access control on every endpoint, hashed credentials, validated input, security headers, dependency scanning, and audit logging free of secrets.

### NFR-04 — Input Validation

Every write endpoint validates its input before it reaches the database, and reports every offending field in a single response rather than one at a time.

### NFR-05 — Usability and Responsiveness

The interface is usable on a phone-sized viewport: no page scrolls horizontally, and primary actions stay within the viewport. Verified by the Playwright suite.
