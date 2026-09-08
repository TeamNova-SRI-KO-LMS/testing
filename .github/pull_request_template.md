## What this changes

<!-- One paragraph. What behaviour of the suite is different after this PR? -->

## Related issue

Closes #

## Type

- [ ] `test` — new or updated tests
- [ ] `fix` — a defect in the harness or a test
- [ ] `feat` — new harness capability, matcher, factory or gate
- [ ] `ci` — pipeline configuration
- [ ] `docs` — documentation
- [ ] `refactor` / `chore`

## Tests added or changed

| Test case ID | Requirement | Layer | What it verifies |
| ------------ | ----------- | ----- | ---------------- |
|              |             |       |                  |

## Definition of Done

- [ ] `npm run lint` and `npm run format:check` pass
- [ ] `npm run test:all` passes
- [ ] `npm run coverage:check` passes — 80 % overall, 90 % critical
- [ ] `npm run report:endpoints` passes — 100 % of endpoints exercised
- [ ] New tests carry `testCase({...})` metadata where they map to a requirement
- [ ] Each new test was run in isolation _and_ in a full parallel run
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Any defect found is recorded in `docs/testing/DEFECT_REGISTER.md` with a
      `testCase.failing` entry

## If this touches the harness

- [ ] `npm run sut:verify` still passes
- [ ] The change works with the application checked out _outside_ this repository
      (`SUT_PATH=…`), not only with `./.sut`

## Review notes

<!-- Anything a reviewer should look at first, or a decision worth discussing. -->
