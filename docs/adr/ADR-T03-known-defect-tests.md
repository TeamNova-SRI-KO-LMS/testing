# ADR-T03 — Recording known defects as failing-by-design tests

- **Status:** Accepted
- **Date:** Sprint 5, Week 2
- **Deciders:** TeamNova
- **Context:** SENG 34213 §6.1 (Testing Philosophy), §10.4 (Limitations and
  known defects)

## Context

Writing the suite surfaced 32 defects in the application, four of them critical.
Fixing them is the application team's work and belongs to its own tickets; the
question is what the _test suite_ should do about them in the meantime.

**Assert the current, incorrect behaviour.** The suite stays green and documents
what the system does. But it silently blesses the bug: a reader sees a passing
test named "registration accepts an admin role" and concludes that is intended.
Worse, when somebody fixes it, the test fails and looks like a regression.

**Skip the test with a comment.** Honest, but a skipped test runs nothing. It
does not notice when the defect is fixed, and it does not notice when a _second_
defect appears in the same area.

**Leave the test failing.** Maximally honest and completely impractical: a
permanently red pipeline trains the team to ignore red, which costs far more
than the visibility gains.

**Assert the correct behaviour with `it.failing`.** Jest reports the test as
passing while the assertion fails, and fails the build the moment the assertion
starts passing.

## Decision

`testCase.failing({ ..., defect: 'DEFECT-nn' }, fn)` for every known defect,
paired with:

- a plain `it(...)` that pins the _current_ behaviour, so the impact described
  in the register is evidence-backed rather than asserted;
- an entry in [DEFECT_REGISTER.md](../testing/DEFECT_REGISTER.md) with severity,
  location, impact and a proposed fix.

`testCase` rejects a `defect` field without `.failing`, and `testCase.failing`
requires one — so a defect cannot be recorded in one place and not the other.

## Consequences

**Good.** A defect cannot be silently fixed (the build breaks), silently
reintroduced (the companion test breaks), or silently forgotten (it appears in
the register, the traceability matrix and the OWASP evidence). §10.4 asks the
final report for "Limitations and known defects"; that section is generated.

**Bad.** A reader who does not know the convention sees a green suite and 32
open defects and may find that contradictory. The register's opening paragraph
and the test register's summary both explain it.

**Also bad.** `it.failing` requires Jest 29.6 or later, which pins a floor on
the runner version.

## Note on the OWASP evidence

The same mechanism keeps `docs/security/OWASP_COMPLIANCE.md` honest. Each
control cites test case ids, and the generator checks every citation against the
register that the run produced. A control whose evidence has been renamed or
deleted is reported as unevidenced rather than passing quietly — which is the
failure mode that makes most compliance documents worthless.
