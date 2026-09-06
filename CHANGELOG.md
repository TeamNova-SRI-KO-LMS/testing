# Changelog

All notable changes to the SRI-KO LMS test suite are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this repository uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
as required by SENG 34213 §3.3. Sprint milestones: Sprint 5 ships v0.1.0,
Sprint 6 v0.2.0, Sprint 7 v0.3.0, Sprint 8 v1.0.0.

## [Unreleased]

## [0.1.0] — Sprint 5

### Added

- **Test harness.** A standalone test repository that locates the application
  through `SUT_PATH`, auto-discovery or `npm run sut:setup`, mounts its Express
  app in-process for Supertest, and runs every layer against an ephemeral
  MongoDB.
- **Unit layer** (Jest) — 400+ cases over the models, middleware and validation
  chains, with the application's dependencies mocked so each branch is reachable
  in isolation.
- **Integration layer** (Jest + Supertest + MongoDB) — 600+ cases covering all
  125 API endpoints through real HTTP against a real database.
- **Security layer** (Jest) — the OWASP Top 10 control matrix from §8.1, driven
  from the generated endpoint inventory so every admin route is probed
  automatically.
- **Frontend layer** (Vitest + Testing Library) — the API client, its
  interceptors, the route guard, and a reflective contract test over all 93
  service methods.
- **End-to-end layer** (Playwright) — the three critical flows plus every public
  happy path, on desktop and mobile viewports.
- **Performance layer** (k6) — smoke, load, stress and spike scenarios with
  NFR-01 thresholds.
- **Automated quality gates** — 80 % coverage overall, 90 % on critical business
  logic, and 100 % API endpoint coverage, each enforced in CI.
- **Generated deliverables** — the test case register (§6.3.3), the requirements
  traceability matrix, the OWASP compliance evidence (§10.1 #8) and the coverage
  summary, all derived from executed tests rather than maintained by hand.
- **CI/CD pipeline** — the five stages required by §7.2, plus scheduled E2E and
  performance workflows.
- **Defect register** — 32 defects found in the application while building the
  suite, each with a failing-by-design test that will break the build when the
  defect is fixed.

[Unreleased]: https://github.com/TeamNova-SRI-KO-LMS/testing/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/TeamNova-SRI-KO-LMS/testing/releases/tag/v0.1.0
