---
name: Test coverage
about: A gap in test coverage for an existing feature
title: '[TEST] '
labels: 'epic:testing'
---

## User story

As a **[role]**, I want **[behaviour]** to be verified so that **[risk avoided]**.

## Background

- SRS reference: FR-
- Application code: `routes/…` / `models/…`
- Current coverage: <!-- from reports/coverage-summary.md -->

## Test cases to add

Each becomes a `testCase({...})` declaration.

### TC-FR-nn-mm — <name>

- **Type:** Unit / Integration / Security / E2E
- **Priority:** P1 / P2 / P3
- **Preconditions:**
- **Input:**
- **Expected output:**

## Acceptance criteria

### AC1 — Happy path

**Given** …
**When** …
**Then** …

### AC2 — Error handling

**Given** …
**When** …
**Then** … (HTTP status and error body)

### AC3 — Edge case

**Given** …
**When** …
**Then** …

## Definition of Done

- [ ] Every test case above is implemented and passing
- [ ] `npm run coverage:check` passes
- [ ] `npm run report:endpoints` passes
- [ ] The register and traceability matrix regenerate cleanly
- [ ] PR raised against `develop`; one peer review completed

## Estimate

Estimated: __ hours
