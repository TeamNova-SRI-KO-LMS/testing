# ADR-T01 — A standalone test repository, wired to the application at run time

- **Status:** Accepted
- **Date:** Sprint 5, Week 1
- **Deciders:** TeamNova
- **Context:** SENG 34213 §3.1 (Code Repository Structure), §1.3 (Design Changes)

## Context

The course prescribes a `tests` repository in the GitHub Organisation holding
"integration and end-to-end test suites (if not co-located with service code)".
Our application already exists in its own repository with no test infrastructure
at all, so the suite has to live somewhere and reach across.

Three options were considered.

**Co-locate the tests inside the application repository.** Conventional for a
Node project, and the tests would import the application directly with no
plumbing. But it contradicts the repository structure the course prescribes, it
mixes test dependencies into the application's manifest, and it makes the test
suite invisible as a deliverable in its own right.

**Vendor a copy of the application into the test repository.** Self-contained
and reproducible. It also goes stale the first time somebody merges to the
application's `develop`, and it duplicates a codebase — the tests would pass
against a snapshot nobody is deploying.

**A standalone repository that locates the application at run time.** Matches
the prescribed structure, keeps one source of truth for the application, and
lets the suite be versioned, reviewed and graded on its own.

## Decision

A standalone `testing` repository. The application is located at run time by
`src/support/sut.js`, in this order:

1. the `SUT_PATH` environment variable — how CI wires it;
2. `testing.config.local.js` — a developer's personal, git-ignored override;
3. `./.sut/` — provisioned by `npm run sut:setup`;
4. a list of sibling paths in `testing.config.js`.

A directory qualifies only when it contains `Backend/server.js`, so a wrong
guess fails immediately rather than half-working.

## Consequences

**Good.** The suite is reviewable and gradeable on its own. It can be pointed at
any branch of the application by changing one variable, which is how CI tests a
feature branch. It works against either of the team's two application
repositories without modification.

**Bad.** There is plumbing that a co-located suite would not need — roughly 200
lines in `sut.js`, plus a `sut:verify` command whose only job is to tell a
developer _why_ the application could not be found. CI must check out two
repositories. A developer who clones this repository alone cannot run the
integration tests until they run `npm run sut:setup`.

**Mitigation.** `npm run sut:verify` reports exactly which paths were tried and
what was found at each, and the `SutNotFoundError` message lists the four ways
to fix it. Distinguishing "the application is not where the harness expects"
from "a test is failing" is the whole point.

## The module-identity problem

The consequence that was not obvious up front, recorded here because it is the
one that would waste a day if rediscovered.

The application has its own `node_modules`. A naive `require('mongoose')` in a
test therefore resolves to a _different_ mongoose instance than the one inside
the application — two model registries, two connection pools. The harness would
connect one instance while the application queried the other, and every database
call would hang on a buffering timeout with no useful error.

Jest's `modulePaths` is pointed at the application's `node_modules`, so both
sides resolve to one instance. `bufferCommands: false` is set on the connection
so that if this ever regresses, it surfaces as an immediate, named error rather
than a timeout.
