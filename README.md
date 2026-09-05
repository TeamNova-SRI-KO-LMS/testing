# SRI-KO LMS — Test Suite

[![CI Pipeline](https://github.com/TeamNova-SRI-KO-LMS/testing/actions/workflows/ci.yml/badge.svg)](https://github.com/TeamNova-SRI-KO-LMS/testing/actions/workflows/ci.yml)
[![E2E Tests](https://github.com/TeamNova-SRI-KO-LMS/testing/actions/workflows/e2e.yml/badge.svg)](https://github.com/TeamNova-SRI-KO-LMS/testing/actions/workflows/e2e.yml)
[![Coverage](https://img.shields.io/badge/coverage-81%25-brightgreen)](./docs/TEST_STRATEGY.md#5-automated-gates)
[![Endpoints](https://img.shields.io/badge/endpoint%20coverage-100%25-brightgreen)](./docs/TEST_STRATEGY.md#5-automated-gates)
[![Tests](https://img.shields.io/badge/tests-1158-blue)](./docs/testing/TEST_REGISTER.md)

Automated test suite for the **SRI-KO Learning Management System**, a Korean
language education platform built on the MERN stack.

Part of the TeamNova project for **SENG 34213 — System Development Project**,
Department of Software Engineering, University of Kelaniya.

---

## What this repository is

A standalone test repository (SENG 34213 §3.1) covering the full test pyramid
against the SRI-KO LMS application, which lives in its own repository. Nothing
here modifies the application; the suite locates it at run time and exercises it
as a black box wherever possible.

| Layer       | Tests       | Runner                   | What it covers                                                 |
| ----------- | ----------- | ------------------------ | -------------------------------------------------------------- |
| Unit        | ~400        | Jest                     | Models, middleware, validation chains — mocked, isolated       |
| Integration | ~640        | Jest + Supertest         | All **125 API endpoints**, real HTTP, real MongoDB             |
| Security    | ~120        | Jest                     | The OWASP Top 10 control matrix from §8.1                      |
| Frontend    | ~60         | Vitest + Testing Library | API client, interceptors, route guard, components              |
| End-to-end  | 56          | Playwright               | 3 critical flows + every public happy path, desktop and mobile |
| Performance | 4 scenarios | k6                       | Smoke, load, stress and spike against NFR-01 thresholds        |

**1,158 automated tests. 100 % API endpoint coverage. 81 % line coverage,
90 %+ on critical business logic.**

---

## Prerequisites

| Requirement | Version | Notes                                                                            |
| ----------- | ------- | -------------------------------------------------------------------------------- |
| Node.js     | ≥ 20    | `node --version`                                                                 |
| npm         | ≥ 10    | ships with Node 20                                                               |
| MongoDB     | —       | **not required** — the suite boots an in-memory server                           |
| k6          | latest  | performance layer only ([install](https://k6.io/docs/get-started/installation/)) |
| Docker      | —       | optional, if you prefer a real MongoDB over the in-memory one                    |

---

## Getting started

These steps work on a clean machine with nothing but Node installed.

```bash
# 1. Clone and install
git clone https://github.com/TeamNova-SRI-KO-LMS/testing.git
cd testing
npm install

# 2. Provision the application under test
#    Unpacks a local SRI-KO_LMS_MERN.zip into ./.sut (git-ignored)…
npm run sut:setup -- --install
#    …or clone it from GitHub instead:
npm run sut:setup -- --clone --install

# 3. Confirm the harness can load it
npm run sut:verify

# 4. Derive the endpoint inventory from the application source
npm run sut:endpoints

# 5. Run the suite
npm test
```

`npm run sut:verify` prints exactly what it found:

```
System Under Test

  ✓ Application located               /path/to/.sut/SRI-KO_LMS_MERN
      (found via candidatePaths → .sut/SRI-KO_LMS_MERN)
  ✓ Backend directory                 …/Backend
  ✓ server.js exports an Express app  exports `app`, honours SKIP_SERVER and SKIP_DB
  ✓ Dependency: mongoose              v8.24.0
  ✓ Endpoint inventory                125 testable endpoints

✓ The harness can load and exercise the application.
```

### If the application is already checked out elsewhere

Skip step 2 and point the suite at it:

```bash
SUT_PATH=/path/to/SRI-KO_LMS_MERN npm test
```

Or make it permanent without touching a committed file:

```js
// testing.config.local.js  (git-ignored)
module.exports = { sutPath: '/path/to/SRI-KO_LMS_MERN' };
```

The suite also finds a sibling checkout automatically — see `candidatePaths` in
[`testing.config.js`](./testing.config.js).

---

## Commands

### Testing

| Command                    | What it does                              |
| -------------------------- | ----------------------------------------- |
| `npm test`                 | Unit + integration (the usual local loop) |
| `npm run test:all`         | Every Jest and Vitest layer               |
| `npm run test:unit`        | Backend unit tests — fast, no database    |
| `npm run test:unit:watch`  | The same, in watch mode                   |
| `npm run test:integration` | Real HTTP against a real MongoDB          |
| `npm run test:security`    | The OWASP Top 10 suite                    |
| `npm run test:frontend`    | Vitest frontend layer                     |
| `npm run test:e2e`         | Playwright — boots the full stack         |
| `npm run test:e2e:ui`      | Playwright in interactive mode            |
| `npm run test:perf:smoke`  | k6 smoke scenario                         |
| `npm run test:perf`        | k6 smoke, load and spike                  |

### Coverage and gates

| Command                    | What it does                                |
| -------------------------- | ------------------------------------------- |
| `npm run coverage`         | Every layer, merged into one lcov           |
| `npm run coverage:check`   | The §6.4 gates: 80 % overall, 90 % critical |
| `npm run report:endpoints` | The 100 % endpoint gate                     |

### Generated deliverables

| Command                       | Produces                                           |
| ----------------------------- | -------------------------------------------------- |
| `npm run report:register`     | `docs/testing/TEST_REGISTER.md` (§6.3.3, §10.1 #7) |
| `npm run report:traceability` | `docs/testing/TRACEABILITY_MATRIX.md`              |
| `npm run report:owasp`        | `docs/security/OWASP_COMPLIANCE.md` (§10.1 #8)     |
| `npm run report:all`          | All of the above                                   |

### Quality

| Command              | What it does                        |
| -------------------- | ----------------------------------- |
| `npm run lint`       | ESLint                              |
| `npm run format`     | Prettier, writing changes           |
| `npm run audit:deps` | `npm audit --audit-level=high`      |
| `npm run verify`     | Everything, in the order CI runs it |

---

## Running against a real MongoDB

The suite boots `mongodb-memory-server` by default, which needs no setup. To use
a real server instead — a Docker container, or a shared development database:

```bash
docker run -d -p 27017:27017 --name sriko-test-mongo mongo:7
MONGODB_TEST_URI=mongodb://127.0.0.1:27017/sriko_lms_test npm run test:integration
```

Each Jest worker is given its own database on that server, so the URI is a base
rather than the final connection string.

---

## How the suite is organised

```
testing/
├── config/                  Jest, Vitest and Playwright configuration
│   └── setup/               per-project setup and global lifecycle
├── docs/
│   ├── TEST_STRATEGY.md     how and why the suite is built this way
│   ├── REQUIREMENTS_CATALOGUE.md
│   ├── adr/                 architecture decision records
│   ├── testing/             DEFECT_REGISTER + generated register and matrix
│   └── security/            generated OWASP compliance evidence
├── scripts/                 SUT provisioning, gates and report generators
├── src/
│   ├── support/             the harness: SUT resolver, app loader, database,
│   │                        auth helpers, API client, custom matchers
│   ├── factories/           test data builders
│   ├── registry/            requirement catalogue and OWASP control matrix
│   └── reporters/           the register-capturing Jest reporter
└── tests/
    ├── unit/backend/        models, middleware
    ├── unit/frontend/       services, config, components
    ├── integration/api/     one file per route group
    ├── integration/persistence/  aggregations, indexes, model statics
    ├── security/            OWASP A01 … A10
    ├── e2e/                 Playwright specs and fixtures
    └── performance/         k6 scenarios
```

---

## Writing a test

```js
const { loadApp } = require('@support/app');
const { api } = require('@support/api-client');
const { testCase } = require('@support/test-case');
const auth = require('@support/auth');
const { createCourse } = require('@factories');

const client = api(loadApp());

describe('POST /api/courses/:id/enroll', () => {
  testCase(
    {
      id: 'TC-FR-10-02',
      name: 'A student enrols in a published course',
      requirement: 'FR-10',
      type: 'Integration',
      priority: 'P1',
      preconditions: 'A published course exists and the student is not enrolled',
      input: 'POST /api/courses/<id>/enroll with the student’s token',
      expected:
        'HTTP 200; a Progress record is created; both sides of the relationship are written',
    },
    async () => {
      // Arrange
      const course = await createCourse({ isPublished: true });
      const { user, authHeader } = await auth.asStudent();

      // Act
      const response = await client
        .post(`/api/courses/${course._id}/enroll`)
        .set('Authorization', authHeader);

      // Assert
      expect(response).toBeSuccessfulResponse(200);
      expect(await Progress.findOne({ student: user._id, course: course._id })).not.toBeNull();
    },
  );
});
```

Three things that matter:

- **`api(app)`, not `supertest(app)`.** The wrapper journals each request, which
  is what feeds the endpoint-coverage gate.
- **`testCase` for anything that maps to a requirement.** The metadata generates
  the register; plain `it()` is right for supporting edge cases.
- **Factories over literals.** `createCourse({ isPublished: true })` says what
  the test cares about and stays correct when the schema changes.

Custom matchers — `toBeSuccessfulResponse`, `toBeForbidden`, `toFailValidation`,
`toExposePassword`, `toBeValidJwtFor`, `toBeBcryptHash` — are defined in
[`src/matchers`](./src/matchers/index.js) and produce failure messages that name
the actual problem rather than diffing two large objects.

---

## Known defects

The suite found **32 defects** in the application, four of them critical. They
are catalogued in [DEFECT_REGISTER.md](./docs/testing/DEFECT_REGISTER.md) with
severity, location, impact and a proposed fix.

Each has a test asserting the **correct** behaviour, declared with
`testCase.failing` — so the build breaks the moment a defect is fixed, which is
the signal to retire the entry. This is why the suite is green with 32 open
defects: it asserts that the application behaves exactly as documented, correct
or not. See [ADR-T03](./docs/adr/ADR-T03-known-defect-tests.md).

The four critical ones:

| ID        | Defect                                                               |
| --------- | -------------------------------------------------------------------- |
| DEFECT-11 | Public registration accepts a client-supplied `admin` role           |
| DEFECT-03 | A hard-coded `fallback-secret` signs tokens when JWT_SECRET is unset |
| DEFECT-05 | The JWT signing secret is logged on every authenticated request      |
| DEFECT-21 | Three user endpoints are unreachable, shadowed by `PUT /:id`         |

---

## CI/CD

`.github/workflows/ci.yml` implements the five stages §7.2 requires — Lint &
Format, Build, Unit Tests, Integration Tests, Security Scan — and runs the
coverage and endpoint gates. `e2e.yml` runs Playwright on pull requests and
nightly; `performance.yml` runs k6 weekly and on demand.

The application repository is checked out alongside this one and wired in
through `SUT_PATH`. Two repository variables control which:

| Variable         | Default                   |
| ---------------- | ------------------------- |
| `SUT_REPOSITORY` | `TeamNova-SRI-KO-LMS/app` |
| `SUT_REF`        | `develop`                 |

Add `SUT_ACCESS_TOKEN` as a secret if the application repository is private.

---

## Troubleshooting

**"Could not locate the SRI-KO LMS application source"** — run
`npm run sut:setup`, or set `SUT_PATH`. The error lists every path it tried.

**Integration tests hang, then time out** — usually the application's
dependencies are not installed. Run `npm run sut:verify`; it checks for them by
name.

**An integration test fails for no visible reason** — `SUT_VERBOSE=true` unmutes
the application's own logging, which the harness silences by default.

**`mongodb-memory-server` cannot download a binary** — use a real MongoDB
instead: `MONGODB_TEST_URI=mongodb://127.0.0.1:27017/sriko_lms_test`.

**Playwright cannot find a browser** — `npm run test:e2e:install`.

---

## Documentation

| Document                                                        | Contents                                           |
| --------------------------------------------------------------- | -------------------------------------------------- |
| [TEST_STRATEGY.md](./docs/TEST_STRATEGY.md)                     | How the suite is built, and why                    |
| [REQUIREMENTS_CATALOGUE.md](./docs/REQUIREMENTS_CATALOGUE.md)   | The FR/NFR catalogue the suite traces against      |
| [DEFECT_REGISTER.md](./docs/testing/DEFECT_REGISTER.md)         | All 32 known defects                               |
| [TEST_REGISTER.md](./docs/testing/TEST_REGISTER.md)             | Generated — every documented case with its outcome |
| [TRACEABILITY_MATRIX.md](./docs/testing/TRACEABILITY_MATRIX.md) | Generated — requirements to tests                  |
| [OWASP_COMPLIANCE.md](./docs/security/OWASP_COMPLIANCE.md)      | Generated — §8.1 evidence                          |
| [ADR-T01](./docs/adr/ADR-T01-standalone-test-repository.md)     | Why a standalone test repository                   |
| [ADR-T02](./docs/adr/ADR-T02-test-runner-selection.md)          | Why Jest _and_ Vitest                              |
| [ADR-T03](./docs/adr/ADR-T03-known-defect-tests.md)             | Why defects are failing-by-design tests            |

---

## Related repositories

| Repository                                                                | Contents                   |
| ------------------------------------------------------------------------- | -------------------------- |
| [`app`](https://github.com/TeamNova-SRI-KO-LMS/app)                       | The application under test |
| [`infrastructure`](https://github.com/TeamNova-SRI-KO-LMS/infrastructure) | Docker, deployment         |
| [`documentation`](https://github.com/TeamNova-SRI-KO-LMS/documentation)   | SRS, SDS, ADRs             |
| **`testing`**                                                             | This repository            |

---

## Licence

MIT — see [LICENSE](./LICENSE).
