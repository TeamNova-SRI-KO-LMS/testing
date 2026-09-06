# Test Strategy

SRI-KO Learning Management System · SENG 34213 System Development Project

This document explains **how** the suite is built and **why** it is built that
way. The rules it implements come from SENG 34213 §6 (Testing Standards) and
§8 (Security & Code Quality).

---

## 1. Philosophy

> "In industry, code that has no tests is considered unfinished, not 'working'."
> — SENG 34213 §6.1

Three principles follow from that, and they decide every judgement call below.

**A test earns its place by the failure it would catch.** Before writing a test,
name the bug it prevents. "Covers the login route" is not a reason; "an
attacker who guesses a password gets the same message as one who guesses an
email, so the endpoint cannot be used to enumerate accounts" is. Tests written
for coverage alone are the ones that get deleted the first time they are
inconvenient.

**Test behaviour, not implementation.** Assertions describe what a caller
observes — status codes, response bodies, persisted state — not which internal
function ran. A refactor that preserves behaviour should not break a single
test. This is what makes the suite an asset during a rewrite rather than an
obstacle to one.

**A test that cannot fail is worse than no test.** It costs runtime, occupies a
line in the coverage report, and creates false confidence. Every mechanism in
this repository that could silently stop working — the endpoint inventory, the
security tables, the register — carries a guard that fails when it is empty.

---

## 2. The pyramid

Four layers, matching §6.2, plus a security layer the course requires separately
in §8.1.

| Layer           | Scope                                   | Runner                   | Count       | Speed       | Target                         |
| --------------- | --------------------------------------- | ------------------------ | ----------- | ----------- | ------------------------------ |
| **Unit**        | One function or class, isolated         | Jest                     | ~400        | < 3 s total | 80 % of code                   |
| **Integration** | Real HTTP → real Express → real MongoDB | Jest + Supertest         | ~640        | ~20 s       | 100 % of endpoints             |
| **Security**    | OWASP Top 10 controls                   | Jest + Supertest         | ~120        | ~5 s        | All 10 risks                   |
| **Frontend**    | Modules and components                  | Vitest + Testing Library | ~60         | < 1 s       | 80 % of logic modules          |
| **E2E**         | Full journeys through a browser         | Playwright               | 56          | minutes     | 3 critical flows + happy paths |
| **Performance** | Throughput and latency under load       | k6                       | 4 scenarios | minutes     | NFR-01 thresholds              |

The shape is deliberate. Unit tests are where a branch is _reachable_ — a
database error, an expired token, a boundary value — because the collaborators
are mocked. Integration tests are where a contract is _real_: they use a real
MongoDB because unique indexes, aggregation pipelines and Mongoose middleware
all behave differently against a mock, and those differences are exactly where
production bugs live.

### What goes where

| Question                                                    | Layer                  |
| ----------------------------------------------------------- | ---------------------- |
| Does this function return the right value for this input?   | Unit                   |
| Does this branch behave correctly when the database throws? | Unit (mocked)          |
| Does this endpoint return 403 to the wrong role?            | Integration            |
| Does this unique index actually prevent a duplicate?        | Integration            |
| Does this aggregation compute the right total?              | Integration            |
| Is every admin endpoint guarded?                            | Security (data-driven) |
| Can a user complete a journey through the UI?               | E2E                    |
| Does it stay fast under 50 concurrent users?                | Performance            |

---

## 3. Standards every test follows

### Arrange–Act–Assert

Required by §6.3.1, and applied consistently: set up state, perform one action,
assert the outcome. Long tests separate the three with blank lines; short ones
are obvious without them.

### Given–When–Then names

A test name is a sentence a non-programmer can read:

```
✅ 'Login is refused for a deactivated account'
✅ 'A student cannot update a course belonging to someone else'
❌ 'test login 2'
❌ 'should work'
```

The name must state the _behaviour_, so that a failure in CI is diagnosable from
the test list alone, without opening the file.

### One reason to fail

A test that asserts three unrelated things fails for three reasons, and the
failure message tells you only about the first. Related assertions about a
single outcome belong together — status, body and persisted state after one
request are one outcome. Unrelated scenarios get their own test.

### Boundaries, not midpoints

A rule with a limit gets tested one below, exactly on, and one above it. `duration`
is validated as 1–52 weeks, so the tests use 0, 1, 52 and 53. Testing "10" tells
you nothing about where the boundary actually is.

### Documented test cases

Every case that maps to a requirement is declared with `testCase({...})`, which
carries the metadata §6.3.3 prescribes — id, requirement, priority,
preconditions, input, expected output — right beside the assertion. The register
is generated from those declarations plus the actual run, so it cannot drift
from the suite. Supporting tests that fill in edge cases use plain `it()`.

---

## 4. Architecture of the harness

This is a **standalone test repository** (§3.1), so its first job is to find the
application. `src/support/sut.js` resolves it from `SUT_PATH`, a git-ignored
local config, `./.sut`, or a list of sibling paths — and every other module goes
through it. No test file contains a path to the application.

The subtle part is **module identity**. The application has its own
`node_modules`, so a naive `require('mongoose')` in a test resolves to a
different instance than the one inside the application. Two instances mean two
model registries and two connection pools: the harness would connect one while
the application queried the other, and every database call would hang on a
buffering timeout. Jest's `modulePaths` is pointed at the application's
`node_modules` so both sides resolve to one mongoose.

### Isolation

- **Per-worker databases.** Jest runs test files in parallel workers. One mongod
  serves all of them, but each worker gets its own database (`..._w1`, `..._w2`).
  Without this, one worker's `afterEach` truncation deletes another worker's
  fixtures — a failure that appears only in a full run and never in isolation.
- **Truncation between tests.** Every collection is emptied after each test, so
  order never matters. Collections are truncated rather than dropped, because
  dropping also drops the indexes several assertions depend on.
- **Ephemeral database.** `mongodb-memory-server` locally, a service container
  in CI. Nothing survives a run.

### The rate limiter

The application applies a 2000-request limit to `/api/`, and its store lives for
the lifetime of the Express app. A long integration file would eventually start
receiving 429s unrelated to what it tests — a classic source of tests that pass
alone and fail in a full run. Functional suites therefore load the application
with the limiter stubbed, and
`tests/security/rate-limiting.security.test.js` loads it _un_-stubbed to prove
the control is real. The trade-off is asserted explicitly (TC-SEC-A04-03) so it
cannot become an unexamined habit.

---

## 5. Automated gates

Four gates run in CI, and each replaces something the course would otherwise
have the team track by hand.

| Gate                                       | Requirement | Enforced by                          |
| ------------------------------------------ | ----------- | ------------------------------------ |
| Coverage ≥ 80 % overall                    | §6.4        | `scripts/check-coverage.js`          |
| Coverage ≥ 90 % on critical business logic | §6.4        | `scripts/check-coverage.js`          |
| **100 % of API endpoints exercised**       | §6.4        | `scripts/check-endpoint-coverage.js` |
| Every requirement has a test               | §4.3        | `scripts/generate-traceability.js`   |

The endpoint gate deserves a note. §6.4 suggests tracking it "manually in the
test register", which rots the first time somebody adds a route. Instead:

1. `scripts/extract-endpoints.js` parses the application's route files and
   mount points into an inventory — 125 testable endpoints today.
2. Every request made through the `api()` helper is journalled.
3. The gate joins the two and fails the build on any endpoint with zero hits.

A route added in a feature branch shows up as uncovered on that branch's first
CI run. The same inventory drives the security suite, so a new admin endpoint is
probed for access control automatically.

---

## 6. Known defects

Building this suite surfaced 32 defects in the application, recorded in
[DEFECT_REGISTER.md](./testing/DEFECT_REGISTER.md) — four of them critical,
including a public registration endpoint that accepts a client-supplied `admin`
role and three user endpoints that are unreachable because of route ordering.

Each one has a test that asserts the **correct** behaviour, declared with
`testCase.failing`. Jest reports such a test as passing while the defect
reproduces and **fails the build when it is fixed** — the signal to retire the
entry. A defect cannot be silently fixed, silently reintroduced, or silently
forgotten.

This is why the suite is green with 32 open defects: it is not asserting that
the application is correct, it is asserting that the application behaves exactly
as documented, correct or not.

---

## 7. Running it

```bash
npm run sut:setup            # provision the application into ./.sut
npm run sut:verify           # confirm the harness can load it
npm run sut:endpoints        # derive the endpoint inventory

npm run test:unit            # fast, no database
npm run test:integration     # real HTTP, real MongoDB
npm run test:security        # OWASP Top 10
npm run test:frontend        # Vitest
npm run test:e2e             # Playwright (boots the full stack)
npm run test:perf:smoke      # k6

npm run coverage             # all layers, merged
npm run coverage:check       # the §6.4 gates
npm run report:all           # register, traceability, OWASP, endpoints

npm run verify               # everything, in the order CI runs it
```

Full setup instructions are in the [README](../README.md).

---

## 8. Maintaining the suite

**When a test fails.** Assume the test is right until proven otherwise. The
first question is "what changed in the application?", not "how do I make this
green?". Deleting or skipping a failing test without understanding it removes
the only evidence that something broke.

**When adding an endpoint.** The endpoint gate fails on the next CI run until it
has an integration test. Add one; the security suite picks it up automatically.

**When adding a requirement.** Add it to `src/registry/requirements.js`. The
traceability matrix reports it as untested until a test names it.

**When fixing a defect.** Its `testCase.failing` entry starts failing. Convert
it to `testCase`, delete the companion test that pinned the old behaviour, and
remove the entry from the defect register.

**Flaky tests.** A test that fails intermittently is a defect in the test, and
it is treated as a build-blocking one — a suite that is sometimes red trains the
team to ignore red, which costs more than the flaky test ever saves. The usual
causes here are shared state between workers (solved by per-worker databases),
time dependence (solved by `jest.useFakeTimers`), and ordering assumptions
(solved by truncating between tests).
