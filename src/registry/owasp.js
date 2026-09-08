/**
 * The OWASP Top 10 control matrix from SENG 34213 §8.1.
 *
 * Each entry names the mitigation the course requires, the test cases that
 * provide evidence for it, and — where the control is absent or incomplete —
 * the defect that records the gap. `scripts/generate-owasp-report.js` joins
 * this against the executed test register to produce deliverable §10.1 #8.
 *
 * `cases` lists test-case ids. They are checked against the register when the
 * report is generated, so a renamed or deleted case is reported rather than
 * silently dropping its evidence.
 */

'use strict';

module.exports = [
  {
    id: 'A01',
    name: 'Broken Access Control',
    requirement:
      'Role-based access checks on every endpoint; tests verify unauthorised access returns 403.',
    implementation:
      '`middleware/auth.js` provides `protect` (valid token, live and active account) and ' +
      '`authorize(...roles)`. Every non-public route composes them. Resource-scoped ' +
      'lookups (payments, invoices, certificates) filter by the caller’s own id.',
    cases: [
      'TC-SEC-A01-01',
      'TC-SEC-A01-02',
      'TC-SEC-A01-03',
      'TC-SEC-A01-04',
      'TC-SEC-A01-05',
      'TC-SEC-A01-06',
      'TC-FR-05-U01',
      'TC-FR-05-U02',
      'TC-FR-05-02',
      'TC-FR-05-04',
      'TC-NFR-03-05',
      'TC-NFR-03-06',
      'TC-NFR-03-08',
      'TC-NFR-03-09',
    ],
    status: 'Partial',
    defects: ['DEFECT-11'],
    notes:
      'Every one of the 82 admin-only endpoints is probed anonymously and with a student ' +
      'token on every CI run, driven from the generated endpoint inventory so a new route ' +
      'is covered automatically. The open gap is self-registration: the public ' +
      'registration endpoint accepts a client-supplied `role`, so anyone can create an ' +
      'administrator (DEFECT-11).',
  },
  {
    id: 'A02',
    name: 'Cryptographic Failures',
    requirement:
      'Passwords hashed with bcrypt (cost factor ≥ 12); tokens stored as hashes; TLS enforced.',
    implementation:
      'Passwords are hashed by a `pre("save")` hook and the field is `select: false`. Reset ' +
      'tokens are returned raw to the caller and stored only as a SHA-256 hash. ' +
      'Strict-Transport-Security is set in production.',
    cases: [
      'TC-SEC-A02-01',
      'TC-SEC-A02-02',
      'TC-SEC-A02-03',
      'TC-SEC-A02-04',
      'TC-FR-01-U04',
      'TC-FR-01-U05',
      'TC-FR-07-U02',
      'TC-FR-01-03',
      'TC-NFR-03-U01',
    ],
    status: 'Partial',
    defects: ['DEFECT-02'],
    notes:
      'Hashing, storage and non-disclosure are all verified. The cost factor is 10, not the ' +
      '12 the course requires (DEFECT-02) — a one-character change in `models/User.js`.',
  },
  {
    id: 'A03',
    name: 'Injection',
    requirement: 'Parameterised queries or ORM used throughout; input validated and sanitised.',
    implementation:
      'Mongoose casts every query against its schema, and `strict` mode drops unknown ' +
      'paths. express-validator guards each write endpoint. A global regular-expression ' +
      'filter is also installed in `server.js`.',
    cases: [
      'TC-SEC-A03-01',
      'TC-SEC-A03-02',
      'TC-SEC-A03-03',
      'TC-SEC-A03-04',
      'TC-SEC-A03-05',
      'TC-SEC-A03-06',
      'TC-NFR-04-U01',
      'TC-NFR-04-U02',
    ],
    status: 'Partial',
    defects: ['DEFECT-01', 'DEFECT-16', 'DEFECT-30'],
    notes:
      'Operator-injection attempts against login, path parameters and the registration body ' +
      'are all rejected — the ORM is doing the work. The global filter, however, is mounted ' +
      'before `express.json()` and never inspects a request body at all (DEFECT-30), while ' +
      'on query strings it rejects ordinary words such as "and" and "or" (DEFECT-01). The ' +
      'course search interpolates the raw term into `$regex` (DEFECT-16).',
  },
  {
    id: 'A04',
    name: 'Insecure Design',
    requirement: 'Threat model documented in the SDS Security section; design reviewed against it.',
    implementation:
      'Rate limiting over the whole API surface, upload type and size restrictions, ' +
      'business-rule guards (no duplicate enrolment, no double completion, no refund of an ' +
      'uncollected payment) enforced in both the application and the database.',
    cases: [
      'TC-SEC-A04-01',
      'TC-SEC-A04-02',
      'TC-SEC-A04-03',
      'TC-SEC-A04-04',
      'TC-FR-10-03',
      'TC-FR-11-02',
      'TC-FR-14-07',
      'TC-FR-14-10',
      'TC-FR-24-U01',
      'TC-FR-24-U05',
    ],
    status: 'Partial',
    defects: ['DEFECT-22', 'DEFECT-32'],
    notes:
      'The rate limiter is proven to fire, and the business-rule guards hold. Two design ' +
      'gaps remain: a refund is never compared against the original amount (DEFECT-22), and ' +
      'a single global limit covers browsing and password guessing alike (DEFECT-32). The ' +
      'threat model itself belongs in the SDS and is outside this repository.',
  },
  {
    id: 'A05',
    name: 'Security Misconfiguration',
    requirement:
      'Default credentials removed; error messages do not leak stack traces in production.',
    implementation:
      'helmet plus explicit X-Frame-Options, X-Content-Type-Options and a Content-Security- ' +
      'Policy; X-Powered-By removed; a generic error handler that discloses `error.message` ' +
      'only outside production; CORS restricted to configured origins.',
    cases: [
      'TC-SEC-A05-01',
      'TC-SEC-A05-02',
      'TC-SEC-A05-03',
      'TC-SEC-A05-04',
      'TC-NFR-03-11',
      'TC-NFR-03-12',
    ],
    status: 'Partial',
    defects: ['DEFECT-03'],
    notes:
      'Headers, error hygiene and the absence of committed credentials are all verified, ' +
      'including that the unauthenticated health endpoint never echoes the database URI. ' +
      'The open gap is the hard-coded `fallback-secret` used for JWT signing whenever ' +
      'JWT_SECRET is unset (DEFECT-03) — a deployment that forgets one variable is ' +
      'trivially forgeable.',
  },
  {
    id: 'A06',
    name: 'Vulnerable and Outdated Components',
    requirement: 'Dependency scan in the CI pipeline; no high or critical vulnerabilities.',
    implementation:
      '`npm audit --audit-level=high` runs on every push in `.github/workflows/ci.yml`, ' +
      'against both the test repository and the application. Dependabot is configured in ' +
      'the application repository.',
    cases: [],
    status: 'Automated in CI',
    defects: [],
    notes:
      'Enforced by the pipeline rather than by a test case: the check is about the ' +
      'dependency tree at a point in time, and the audit job fails the build on a high or ' +
      'critical advisory. The current result is attached to each CI run.',
  },
  {
    id: 'A07',
    name: 'Identification and Authentication Failures',
    requirement:
      'Account lockout after N failed attempts; secure session management; MFA optional.',
    implementation:
      'A password complexity policy at registration, bcrypt verification, deactivated-account ' +
      'refusal, bounded token lifetime, and an HTTP-only session cookie that is `secure` in ' +
      'production.',
    cases: [
      'TC-SEC-A07-01',
      'TC-SEC-A07-02',
      'TC-SEC-A07-03',
      'TC-FR-02-02',
      'TC-FR-02-03',
      'TC-FR-02-04',
      'TC-NFR-03-03',
      'TC-FR-07-02',
    ],
    status: 'Partial',
    defects: ['DEFECT-31', 'DEFECT-14', 'DEFECT-20'],
    notes:
      'Weak passwords are rejected, credentials are verified correctly, and the failure ' +
      'message is identical for an unknown account and a wrong password, so the endpoint ' +
      'cannot be used to enumerate users. Three gaps: no account lockout (DEFECT-31), ' +
      'logout does not invalidate the token server-side (DEFECT-14), and the ' +
      'change-password endpoint does not apply the registration policy (DEFECT-20).',
  },
  {
    id: 'A08',
    name: 'Software and Data Integrity Failures',
    requirement: 'Package lock files committed; the pipeline verifies integrity.',
    implementation:
      '`package-lock.json` is committed in both repositories and CI installs with `npm ci`, ' +
      'which refuses to proceed if the lockfile and manifest disagree.',
    cases: [],
    status: 'Automated in CI',
    defects: [],
    notes:
      'Enforced by the pipeline. `npm ci` verifies the integrity hash of every package ' +
      'against the lockfile, so a tampered or drifted dependency fails the build before any ' +
      'test runs.',
  },
  {
    id: 'A09',
    name: 'Security Logging and Monitoring Failures',
    requirement:
      'All auth events, errors and data access logged; logs do not contain PII or secrets.',
    implementation:
      'morgan logs every request; `server.js` adds explicit audit lines for authentication ' +
      'successes and failures and for every administrative action, naming the acting user.',
    cases: ['TC-SEC-A09-01', 'TC-SEC-A09-02', 'TC-NFR-03-02'],
    status: 'Partial',
    defects: ['DEFECT-05', 'DEFECT-13'],
    notes:
      'The audit trail itself is present and covers the events the course requires. The ' +
      'content is the problem: `middleware/auth.js` prints the JWT signing secret and a ' +
      'token prefix on every authenticated request (DEFECT-05), and validation errors echo ' +
      'the submitted password back to the client (DEFECT-13). Both are one-line removals.',
  },
  {
    id: 'A10',
    name: 'Server-Side Request Forgery',
    requirement: 'External URL inputs validated; allow-list of permitted domains.',
    implementation:
      'The only user-supplied URL is the profile `website` field. No route dereferences it, ' +
      'so there is no server-side fetch to forge.',
    cases: ['TC-SEC-A10-01'],
    status: 'Partial',
    defects: ['DEFECT-06'],
    notes:
      'Verified that no route makes an outbound request from a user-supplied URL, which ' +
      'means classic SSRF is not reachable. The field is nonetheless unvalidated beyond its ' +
      'length (DEFECT-06): `javascript:`, `file://` and link-local addresses are all stored ' +
      'and later rendered as a link, so the live risk is stored-XSS and phishing rather ' +
      'than SSRF.',
  },
];
