# ADR-T02 — Jest for the backend, Vitest for the frontend

- **Status:** Accepted
- **Date:** Sprint 5, Week 1
- **Deciders:** TeamNova
- **Context:** SENG 34213 §6.2 (Test Pyramid), §6.4 (Coverage)

## Context

The application is a MERN stack: a CommonJS Express backend and a Vite +
JSX/TSX frontend. One runner for both would be simpler to explain and to
configure — the question is whether it is achievable without more configuration
than it saves.

**Jest for both.** Jest is the obvious backend choice: Supertest integrates
directly, `jest.mock` is what the unit layer needs, and the application is
CommonJS. Extending it to the frontend means a Babel pipeline for JSX and TSX,
`transformIgnorePatterns` maintenance for the ESM-only packages the frontend
imports, and a module mapper for the CSS and asset imports Vite handles
natively — all for files that live in _another repository_ and are built by a
toolchain we do not control.

**Vitest for both.** Vitest handles the frontend with no configuration at all,
since it reuses Vite's transform pipeline. Its Jest-compatible API covers most
of the backend too. But `jest.mock` hoisting semantics differ in ways that
matter for mocking application modules by absolute path, and the ecosystem
around Supertest and `jest-junit` is Jest-shaped.

## Decision

Both, each where it fits:

- **Jest** — backend unit, integration and security layers (`config/jest.config.js`)
- **Vitest** — frontend unit and component layers (`config/vitest.config.mjs`)

They share the SUT resolver, so the two runners can never disagree about where
the application is.

## Consequences

**Good.** Each layer uses the tool its ecosystem expects. The frontend config is
30 lines instead of a Babel pipeline that would need updating whenever the
application's frontend adds a dependency. Supertest, `jest-junit` and the custom
register reporter all work as documented.

**Bad.** Two runners, two configurations, two coverage reports, and a new team
member has to learn which command runs what. Coverage arrives split.

**Mitigation.** `npm test` runs the backend layers and `npm run test:all` runs
everything, so the common cases are one command. `scripts/merge-coverage.js`
concatenates the two lcov reports into one — valid because the backend and
frontend trees are disjoint — and `scripts/check-coverage.js` applies the §6.4
gates across both.

## Coverage provider

Jest's `coverageProvider` is set to `babel` rather than the faster `v8`. The v8
provider reports only files inside `rootDir`, and the application source is
outside it by design (ADR-T01). Babel instrumentation follows the files
wherever they are, at the cost of a slower run.
