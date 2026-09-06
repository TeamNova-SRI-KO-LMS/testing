# Definition of Done — Testing

The master checklist from SENG 34213 Appendix A, with the testing items made
concrete: each one names the command that proves it, so "done" is something the
pipeline can decide rather than something a reviewer has to judge.

## Every issue

- [ ] Every acceptance criterion in the issue is verified by a named test case
- [ ] Code follows the agreed style guide — `npm run lint` passes with no errors
- [ ] Unit tests written for all new logic — `npm run test:unit`
- [ ] Integration tests written for every new API endpoint — `npm run test:integration`
- [ ] Coverage on new code ≥ 80 % — `npm run coverage:check`
- [ ] Every API endpoint exercised — `npm run report:endpoints`
- [ ] No hard-coded secrets or credentials — covered by TC-SEC-A05-03
- [ ] PR raised against `develop` with the description completed in full
- [ ] At least one peer review completed; every `[blocker]` comment resolved
- [ ] CI passes: lint, build, unit, integration, security
- [ ] Feature deployed to staging and smoke-tested manually
- [ ] API documentation updated if an endpoint changed
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] The issue is linked in the commit messages (`Closes #NN`)
- [ ] The issue is moved to Done on the project board

## Every new endpoint

The endpoint gate fails the build until these are satisfied, so the list is a
description of what the pipeline already enforces.

- [ ] At least one integration test for the happy path
- [ ] A negative test for each documented error condition
- [ ] An authentication test — 401 without a token
- [ ] An authorisation test — 403 for the wrong role, if the endpoint is guarded
- [ ] A validation test for each required field
- [ ] A 404 test if the endpoint takes a resource id
- [ ] Added to the requirement catalogue if it serves a new requirement

## Every new test

- [ ] The name states the behaviour, readable by a non-programmer
- [ ] Arrange–Act–Assert is visible in the structure
- [ ] It fails for exactly one reason
- [ ] It asserts behaviour, not implementation detail
- [ ] It uses factories rather than object literals for fixtures
- [ ] It uses `api(app)` rather than raw `supertest(app)`
- [ ] It carries `testCase({...})` metadata if it maps to a requirement
- [ ] It passes in isolation _and_ in a full parallel run

## Before a sprint review

- [ ] `npm run verify` passes end to end
- [ ] `npm run report:all` regenerates the register, matrix and OWASP evidence
- [ ] The coverage report is attached to the review (§6.4)
- [ ] The defect register reflects everything found this sprint
- [ ] Any newly fixed defect has had its `testCase.failing` retired

## Before the final demonstration (§9)

- [ ] The full suite passes against the staging deployment
- [ ] `npm run test:e2e` passes with `E2E_EXTERNAL=true` against staging
- [ ] `npm run test:perf -- --scenario load` run against staging, results attached
- [ ] The requirement catalogue is reconciled with the approved SRS
- [ ] Coverage, register, traceability and OWASP documents are exported for the report
- [ ] Every remaining defect is listed under "Limitations and known defects" (§10.4)
