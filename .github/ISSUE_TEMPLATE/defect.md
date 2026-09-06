---
name: Application defect
about: A defect in the SRI-KO LMS application found by the test suite
title: '[DEFECT-nn] '
labels: 'bug'
---

## Summary

<!-- One sentence: what is wrong. -->

## Severity

- [ ] 🔴 Critical — exploitable, or corrupts data that cannot be reconstructed
- [ ] 🟠 High — a feature does not work, or a required security control is absent
- [ ] 🟡 Medium — incorrect behaviour with a workaround
- [ ] 🔵 Low — limited user impact

## Location

- File: `…`
- Line:
- OWASP category (if applicable):

## Evidence

- Failing-by-design test case: `TC-…`
- Companion test pinning current behaviour: `…`
- Defect register entry: `DEFECT-nn`

## Reproduction

```bash
npm run test:integration -- -t "TC-…"
```

## Current behaviour

<!-- What happens today, with the observed status code or output. -->

## Expected behaviour

<!-- What should happen, and which requirement or §8.1 control says so. -->

## Impact

<!-- Who is affected and how. Be concrete. -->

## Proposed fix

<!-- The smallest change that resolves it. -->

## Definition of Done

- [ ] The fix is applied in the application repository
- [ ] The `testCase.failing` entry now fails, and is converted to `testCase`
- [ ] The companion test pinning the old behaviour is deleted
- [ ] The entry is removed from `docs/testing/DEFECT_REGISTER.md`
- [ ] `npm run report:owasp` regenerates with the control status updated
