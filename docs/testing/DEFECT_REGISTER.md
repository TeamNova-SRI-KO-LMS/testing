# Defect Register

Defects found in the SRI-KO LMS application while building this test suite.

Every entry has a test that asserts the **correct** behaviour and is declared
with `testCase.failing`. Jest reports such a test as passing while the defect
still reproduces, and **fails the build the moment the defect is fixed** — which
is the signal to remove the entry from this register. Nothing here can therefore
go stale: a defect that is quietly fixed breaks the pipeline, and a defect that
is quietly reintroduced breaks it too.

Most entries also carry a companion `it(...)` that pins the _current_ behaviour,
so the impact described below is evidence-backed rather than asserted.

## Summary

| Severity    | Count | Meaning                                                                  |
| ----------- | ----- | ------------------------------------------------------------------------ |
| 🔴 Critical | 4     | Exploitable, or corrupts data that cannot be reconstructed               |
| 🟠 High     | 9     | A feature does not work, or a required security control is absent        |
| 🟡 Medium   | 12    | Incorrect behaviour with a workaround, or a control weaker than required |
| 🔵 Low      | 7     | Correctness or maintenance issue with limited user impact                |

| ID                      | Severity    | Area           | Summary                                                              |
| ----------------------- | ----------- | -------------- | -------------------------------------------------------------------- |
| [DEFECT-01](#defect-01) | 🟡 Medium   | Input filter   | The global filter rejects ordinary English in query strings          |
| [DEFECT-02](#defect-02) | 🟠 High     | Cryptography   | bcrypt cost factor is 10; §8.1 requires ≥ 12                         |
| [DEFECT-03](#defect-03) | 🔴 Critical | Cryptography   | A hard-coded `fallback-secret` signs tokens when JWT_SECRET is unset |
| [DEFECT-04](#defect-04) | 🟡 Medium   | Access control | `checkCourseAccess` lets a non-owning instructor through             |
| [DEFECT-05](#defect-05) | 🔴 Critical | Logging        | The JWT signing secret is logged on every authenticated request      |
| [DEFECT-06](#defect-06) | 🟡 Medium   | Validation     | The profile `website` field is never validated as a URL              |
| [DEFECT-07](#defect-07) | 🔵 Low      | Billing        | A payment completed after creation never receives a receipt number   |
| [DEFECT-08](#defect-08) | 🟠 High     | Billing        | Invoice numbers use a 4-digit random suffix and collide              |
| [DEFECT-09](#defect-09) | 🟡 Medium   | Uploads        | File type is trusted from the client-supplied MIME type              |
| [DEFECT-10](#defect-10) | 🔵 Low      | Uploads        | An oversized avatar is told the wrong size limit                     |
| [DEFECT-11](#defect-11) | 🔴 Critical | Access control | Public registration accepts a client-supplied `admin` role           |
| [DEFECT-12](#defect-12) | 🔵 Low      | Data integrity | `Settings` declares an index with an empty key specification         |
| [DEFECT-13](#defect-13) | 🟡 Medium   | Logging        | Validation errors echo the submitted password back to the client     |
| [DEFECT-14](#defect-14) | 🟠 High     | Session        | Logout does not invalidate the token server-side                     |
| [DEFECT-15](#defect-15) | 🟡 Medium   | Authentication | Password login against a Google-only account returns HTTP 500        |
| [DEFECT-16](#defect-16) | 🟡 Medium   | Search         | The catalogue search interpolates the raw term into `$regex`         |
| [DEFECT-17](#defect-17) | 🔵 Low      | Error handling | A malformed ObjectId returns 500 instead of 400                      |
| [DEFECT-18](#defect-18) | 🟡 Medium   | Data integrity | Deleting a course orphans its enrolment records                      |
| [DEFECT-19](#defect-19) | 🟠 High     | Reviews        | Anyone may review a course without enrolling in it                   |
| [DEFECT-20](#defect-20) | 🟠 High     | Passwords      | Changing a password does not apply the registration policy           |
| [DEFECT-21](#defect-21) | 🔴 Critical | Routing        | Three user endpoints are unreachable, shadowed by `PUT /:id`         |
| [DEFECT-22](#defect-22) | 🟠 High     | Billing        | A refund is never compared against the amount collected              |
| [DEFECT-23](#defect-23) | 🟠 High     | Validation     | The payment routes declare validators that are never enforced        |
| [DEFECT-24](#defect-24) | 🟠 High     | Routing        | `GET /notifications/target-users` is shadowed by `GET /:id`          |
| [DEFECT-25](#defect-25) | 🟡 Medium   | Notifications  | `send-to-users` does not stamp `createdBy` and fails with 500        |
| [DEFECT-26](#defect-26) | 🟡 Medium   | Notifications  | Parent notifications are inert — `User` has no `parentId`            |
| [DEFECT-27](#defect-27) | 🔵 Low      | Routing        | Four Choreo-specific routes in `server.js` are dead code             |
| [DEFECT-28](#defect-28) | 🟡 Medium   | Analytics      | `getMonthlyRevenue` drops payments made on 31 December               |
| [DEFECT-29](#defect-29) | 🟠 High     | Certificates   | Concurrent issuance collides on the certificate number               |
| [DEFECT-30](#defect-30) | 🟡 Medium   | Input filter   | The global filter never inspects request bodies                      |
| [DEFECT-31](#defect-31) | 🟠 High     | Authentication | No account lockout after repeated failed logins                      |
| [DEFECT-32](#defect-32) | 🟡 Medium   | Rate limiting  | One global limit covers browsing and password guessing alike         |

---

## Critical

### DEFECT-11

**Public registration accepts a client-supplied `admin` role.**
🔴 Critical · OWASP A01 · `routes/authRoutes.js:44` · TC-NFR-03-01

`POST /api/auth/register` destructures `role` from the request body and passes
it straight to `User.create`. The endpoint is unauthenticated, so anyone who can
reach the application can create an administrator and then read every user
record, every payment and every enquiry.

The Google sign-up path in the same file already gets this right — it rejects
any role other than `student` or `instructor` (TC-NFR-03-13). The password path
should match it.

**Fix.** Ignore `role` from the body and always create a student; provision
instructors and administrators through `POST /api/admin/users`, which is already
guarded.

---

### DEFECT-03

**A hard-coded `fallback-secret` signs tokens when JWT_SECRET is unset.**
🔴 Critical · OWASP A05 · `models/User.js:161`, `middleware/auth.js:31`,
`routes/authRoutes.js:19` · TC-SEC-A05-04

All three modules read `process.env.JWT_SECRET || 'fallback-secret'`. A
deployment that forgets one environment variable signs every token with a value
published in the source, and anyone who has read the repository can mint a token
for any user, including an administrator. Nothing in the application warns that
this has happened.

**Fix.** Read the secret once at start-up and exit with a clear message if it is
missing. Failing to boot is far safer than booting insecurely.

---

### DEFECT-05

**The JWT signing secret is logged on every authenticated request.**
🔴 Critical · OWASP A09 · `middleware/auth.js:26-28` · TC-SEC-A09-01

```js
console.log('JWT_SECRET available:', !!process.env.JWT_SECRET);
console.log('JWT_SECRET value:', process.env.JWT_SECRET);
console.log('Token received:', `${token.substring(0, 20)}...`);
```

§8.1 (A09) requires that "logs do not contain PII or secrets". Anyone with
access to the logs — a hosting dashboard, a log aggregator, a screenshot in a
support ticket — can forge tokens for any user.

**Fix.** Delete all three lines. The audit trail that matters is already in
`server.js`, and it records outcomes rather than credentials.

---

### DEFECT-21

**Three user endpoints are unreachable, shadowed by `PUT /:id`.**
🔴 Critical · `routes/userRoutes.js:610` vs `:668`, `:694`, `:720` ·
TC-FR-06-04, TC-FR-06-05, TC-FR-06-06

`PUT /api/users/:id` is declared with `authorize('admin')` at line 610, before
`/notifications` (668), `/privacy` (694) and `/last-login` (720). Express matches
the parameterised route first, so:

- a student receives **403** from the admin guard;
- an administrator reaches the handler, which calls
  `User.findByIdAndUpdate('notifications')`, fails to cast, and returns **500**.

All three endpoints are therefore broken for every caller. Notification
preferences and privacy settings cannot be changed by anyone.

**Fix.** Move the three literal routes above `/:id`. Express matches in
declaration order, so specific paths must always precede parameterised ones —
the same class of bug as DEFECT-24.

---

## High

### DEFECT-02

**bcrypt cost factor is 10; §8.1 requires at least 12.**
🟠 High · OWASP A02 · `models/User.js:130` · TC-SEC-A02-02, TC-NFR-03-U01

`bcrypt.genSalt(10)`. Each increment doubles the work an offline attacker must
do per guess, so 10 → 12 is a fourfold increase in the cost of cracking a stolen
database.

**Fix.** `bcrypt.genSalt(12)`. Existing hashes keep working — bcrypt stores the
cost in the hash — and can be upgraded transparently on next login.

---

### DEFECT-08

**Invoice numbers use a 4-digit random suffix and collide.**
🟠 High · `models/Payment.js:generateInvoiceNumber` · TC-FR-14-U07

The suffix is `Math.floor(Math.random() * 10000)`, giving 10 000 possibilities
per month. By the birthday bound a collision becomes likely after roughly 120
invoices in one month, and `invoiceNumber` carries a unique index — so the save
fails for a customer who has already been charged.

**Fix.** Derive the suffix from a monotonic counter, or from the payment's own
ObjectId, both of which are collision-free by construction.

---

### DEFECT-14

**Logout does not invalidate the token server-side.**
🟠 High · OWASP A07 · `routes/authRoutes.js:356` · TC-FR-04-04

`POST /api/auth/logout` returns a success message and nothing else. A token
captured before logout — from a shared computer, a proxy log, or browser
storage — stays valid for its full seven-day lifetime.

**Fix.** Keep a token version on the user document and include it in the JWT
payload; bump it on logout and on password change, and compare it in `protect`.
A revocation list in Redis achieves the same thing if one is available.

---

### DEFECT-19

**Anyone may review a course without enrolling in it.**
🟠 High · `routes/courseRoutes.js:411` · TC-FR-12-03

`POST /api/courses/:id/reviews` checks only that the caller has not already
reviewed the course. Any authenticated account — including one created seconds
earlier — can post a rating, and those ratings order the public catalogue.

**Fix.** Require a `Progress` record for the caller and the course before
accepting a review, mirroring the check in `checkCourseAccess`.

---

### DEFECT-20

**Changing a password does not apply the registration policy.**
🟠 High · OWASP A07 · `routes/userRoutes.js:534` · TC-FR-07-03

Registration requires an uppercase letter, a lowercase letter and a digit.
`PUT /api/users/password` checks length only, so a user can register with a
compliant password and immediately change it to `aaaaaa`.

**Fix.** Reuse the `validateUserRegistration` password rule on this route.

---

### DEFECT-22

**A refund is never compared against the amount collected.**
🟠 High · `routes/paymentRoutes.js:207`, `models/Payment.js:processRefund` ·
TC-FR-14-11

`processRefund(amount)` writes the client-supplied figure straight to
`refundAmount`. A refund larger than the original payment is accepted, and the
revenue reports go negative.

**Fix.** Reject any refund where `amount > this.amount - this.refundAmount`.

---

### DEFECT-23

**The payment routes declare validators that are never enforced.**
🟠 High · OWASP A04 · `routes/paymentRoutes.js:88`, `:163`, `:207` ·
TC-NFR-04-01

`/:id/complete`, `/:id/fail` and `/:id/refund` each declare express-validator
chains, but only `/create` calls `validationResult`. The chains run and record
their errors; nothing reads them. A refund is therefore recorded with no audit
reason at all.

**Fix.** Add `handleValidationErrors` after the chains, as every other route in
the application does.

---

### DEFECT-24

**`GET /notifications/target-users` is shadowed by `GET /:id`.**
🟠 High · `routes/notificationRoutes.js:85` vs `:508` · TC-FR-18-02

`GET /:id` is declared at line 85; `/target-users` at line 508. The literal path
is cast as a notification id, fails, and the endpoint answers **500** for every
caller. The administrative console cannot list notification recipients.

`/all` and `/stats` are declared before `/:id` and are unaffected — which is
exactly why the ordering rule matters.

**Fix.** Move `/target-users` above `/:id`. Same root cause as DEFECT-21.

---

### DEFECT-29

**Concurrent certificate issuance collides on the certificate number.**
🟠 High · `models/Certificate.js:pre('save')` · TC-FR-15-16

The generator reads the highest existing number, adds one, and writes — a
read-modify-write race. Two concurrent requests read the same value and collide
on the unique index, so an administrator issuing a batch sees some certificates
fail.

**Fix.** Use an atomic `findOneAndUpdate` on a counter document with
`$inc`, or accept a non-sequential but unique identifier.

---

### DEFECT-31

**No account lockout after repeated failed logins.**
🟠 High · OWASP A07 · `routes/authRoutes.js:79` · TC-SEC-A07-02

§8.1 (A07) requires "account lockout after N failed attempts". There is no
attempt counter on the `User` model and no lockout in the login route. Combined
with the single global rate limit (DEFECT-32), an attacker gets roughly 2000
password attempts per IP per quarter hour against one account.

**Fix.** Record `failedLoginAttempts` and `lockedUntil` on the user; refuse
authentication while locked, and reset the counter on a successful login.

---

## Medium

### DEFECT-01

**The global filter rejects ordinary English in query strings.**
🟡 Medium · `server.js:104` · TC-SEC-A03-06

The pattern includes `\bOR\b` and `\bAND\b` with the `i` flag, plus `;`, `--`
and `/*`. A search for `grammar and vocabulary`, `beginner or intermediate`, or
anything hyphenated is answered with "Invalid input detected".

Mongoose already parameterises every query, so the filter adds no protection
against the injection it is named for while breaking legitimate input.

**Fix.** Remove the filter. Rely on express-validator plus schema casting, and
add an operator-stripping middleware if `$`-prefixed keys are a concern.

---

### DEFECT-30

**The global filter never inspects request bodies.**
🟡 Medium · `server.js:101` vs `:155` · injection suite

The filter is mounted at line 101; `express.json()` at line 155. `req.body` is
still `undefined` when the filter runs, so the guard a reviewer would credit for
body-level injection defence does not exist. Only query strings are inspected —
which is where DEFECT-01 bites.

**Fix.** Same as DEFECT-01: remove the filter rather than repair it. Moving it
after the body parser would immediately break every course description
containing the word "and".

---

### DEFECT-04

**`checkCourseAccess` lets a non-owning instructor through.**
🟡 Medium · OWASP A01 · `middleware/auth.js:checkCourseAccess`

The enrolment branch is guarded by `req.user.role === 'student'`, so an
instructor who does not own the course falls through to `next()` with no check
at all. The route handlers for update and delete perform their own ownership
check, which limits the impact today — but a future route relying on this
middleware alone would be unguarded.

**Fix.** Make the default deny: check ownership for instructors explicitly, and
fall through only for administrators.

---

### DEFECT-06

**The profile `website` field is never validated as a URL.**
🟡 Medium · OWASP A10 · `middleware/validation.js:validateProfileUpdate` ·
TC-SEC-A10-01

Only length is checked. `javascript:alert(1)`, `file:///etc/passwd` and
`http://169.254.169.254/latest/meta-data/` are all stored and later rendered as
a link by the frontend. No route dereferences the value, so classic SSRF is not
reachable; the live risk is stored-XSS and phishing.

**Fix.** Validate with `isURL({ protocols: ['http', 'https'], require_protocol: true })`
and reject private and link-local hosts.

---

### DEFECT-09

**File type is trusted from the client-supplied MIME type.**
🟡 Medium · OWASP A04 · `middleware/upload.js:fileFilter`

`file.mimetype` comes from the upload request, not from the file. A payload sent
as `image/png` is accepted whatever it actually contains.

**Fix.** Verify the magic bytes (`file-type`), and re-encode accepted images
with `sharp` — which is already a dependency.

---

### DEFECT-13

**Validation errors echo the submitted password back to the client.**
🟡 Medium · OWASP A09 · `middleware/validation.js:handleValidationErrors` ·
TC-NFR-03-02

express-validator includes the offending value in each error object, so a
rejected password travels back in the response and on into browser consoles,
proxy logs and error-tracking systems.

**Fix.** Strip `value` from any error whose `path` names a password field before
serialising the response.

---

### DEFECT-15

**Password login against a Google-only account returns HTTP 500.**
🟡 Medium · `routes/authRoutes.js:79` · TC-FR-02-05

A Google account has no local password, so `matchPassword` hands `undefined` to
`bcrypt.compare`, which throws. The user sees a server error instead of being
told to sign in with Google.

**Fix.** Check `user.password` before comparing, and return 401 with a message
directing the user to their provider.

---

### DEFECT-16

**The catalogue search interpolates the raw term into `$regex`.**
🟡 Medium · OWASP A03 · `routes/courseRoutes.js:40` · TC-NFR-03-04

The caller controls the pattern. `.*` returns the whole catalogue including
unpublished courses; a catastrophic pattern such as `(a+)+$` is a
denial-of-service primitive.

**Fix.** Escape the term before building the expression, or use a MongoDB text
index.

---

### DEFECT-18

**Deleting a course orphans its enrolment records.**
🟡 Medium · `routes/courseRoutes.js:234` · TC-FR-09-04

Only the course document is deleted. `Progress` records and `User.enrolledCourses`
entries keep pointing at an id that no longer resolves, and the student dashboard
renders empty cards for them.

**Fix.** Delete the course's `Progress` records and `$pull` the id from every
user's `enrolledCourses` in the same operation.

---

### DEFECT-25

**`send-to-users` does not stamp `createdBy` and fails with 500.**
🟡 Medium · `routes/notificationRoutes.js:448` · TC-FR-18-08

The route spreads the client's `notificationData` straight into the model.
`createdBy` is required by the schema and is not supplied, so a well-formed
request from the admin console fails validation and surfaces as an opaque 500.

**Fix.** Set `createdBy: req.user._id` before calling `Notification.sendToUsers`,
as every other create route does.

---

### DEFECT-26

**Parent notifications are inert — `User` has no `parentId`.**
🟡 Medium · `models/Notification.js:sendToParents` · TC-FR-18-09

The static looks up `student.parentId`, but the `User` schema declares no such
field. The guard is never satisfied, so the endpoint reports
`"Notification sent to 0 parents"` and sends nothing. The whole
parent-notification feature is non-functional.

**Fix.** Add the parent relationship to the `User` schema, or remove the feature
until it is designed.

---

### DEFECT-28

**`getMonthlyRevenue` drops payments made on 31 December.**
🟡 Medium · `models/Payment.js:getMonthlyRevenue` · TC-FR-21-09

The range is built as `new Date(year, 11, 31)` — midnight at the _start_ of the
31st — so anything paid during that day falls outside the annual report.

**Fix.** Use `new Date(year + 1, 0, 1)` as an exclusive upper bound.

---

### DEFECT-32

**One global limit covers browsing and password guessing alike.**
🟡 Medium · OWASP A04 · `server.js:72` · TC-SEC-A04-04

A single limiter allows 2000 requests per 15 minutes across the whole API. That
is reasonable for catalogue browsing and far too generous for authentication.

**Fix.** Add a second, much stricter limiter on `/api/auth` — a handful of
attempts per minute per IP.

---

## Low

### DEFECT-07

**A payment completed after creation never receives a receipt number.**
🔵 Low · `models/Payment.js:pre('save')` · payment model suite

The receipt hook is guarded by `this.isNew`, so it fires only when a payment is
_created_ already completed. The normal flow — create pending, complete later —
never produces a receipt number.

**Fix.** Move the receipt generation into `markCompleted`.

---

### DEFECT-10

**An oversized avatar is told the wrong size limit.**
🔵 Low · `middleware/upload.js:handleUploadError`

Avatars are capped at 5 MB and certificates at 10 MB, but the shared error
handler reports "Maximum size is 10MB." for both.

**Fix.** Pass the applicable limit into the handler, or give each upload path
its own message.

---

### DEFECT-12

**`Settings` declares an index with an empty key specification.**
🔵 Low · `models/Settings.js:201` · TC-NFR-02-03

`settingsSchema.index({}, { unique: true })` — presumably intended to enforce a
singleton settings document. MongoDB rejects an index with no keys, Mongoose
logs the failure and continues, so the constraint has never existed in any
environment.

**Fix.** Use a partial unique index on a constant discriminator field, or
enforce the singleton in the route, which already does `findOne()` and creates
on miss.

---

### DEFECT-17

**A malformed ObjectId returns 500 instead of 400.**
🔵 Low · every `findById` route · catalogue suite

`GET /api/courses/not-an-object-id` produces a Mongoose `CastError` caught by
the generic handler and reported as a server error. It is a client mistake and
should be a 400.

**Fix.** Add an id-validation middleware, or branch on `error.name === 'CastError'`
in the error handler.

---

### DEFECT-27

**Four Choreo-specific routes in `server.js` are dead code.**
🔵 Low · `server.js:355`, `:368`, `:415`, `:425` · choreo-alias suite

A rewrite middleware strips the `/choreo-apis/...` prefix before routing, so the
handlers registered on the prefixed paths can never match. Three of them
duplicate a route that already exists; the fourth, `/api/admin/test`, has no
equivalent and answers 404.

**Fix.** Delete the four handlers. The rewrite already does the job.

---

## How to work with this register

**Fixing a defect.** Apply the fix in the application, then run the suite. The
`testCase.failing` entry for that defect will now _fail_, with the message
"Failing test passed even though it was supposed to fail". Change
`testCase.failing` to `testCase`, delete the companion test that pinned the old
behaviour, and remove the entry from this file.

**Deferring a defect.** Leave the entry in place. It is recorded, tested, and
visible in the test register and the OWASP evidence — which is a far better
position than an undocumented defect, and is what §10.4 asks the final report's
"Limitations and known defects" section to contain.

**Adding a defect.** Write the test that asserts the correct behaviour with
`testCase.failing` and a `defect` field, add a companion test pinning the
current behaviour, and add an entry here. The `testCase` helper refuses a
`defect` field without `.failing`, so the two cannot drift apart.
