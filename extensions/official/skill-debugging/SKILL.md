---
name: systematic-debugging
description: Trace failures to their real boundary before proposing a focused fix.
---

# Systematic Debugging

Find the cause before changing behavior.

## Process

1. Restate the observed failure with its exact inputs, environment, and expected result.
2. Reproduce it with the smallest reliable command or interaction available.
3. Trace data and state across the relevant lifecycle boundaries.
4. Add temporary observations only where they distinguish competing explanations.
5. Identify the first point where actual behavior diverges from the contract.
6. Fix that boundary with the smallest coherent change.
7. Add a regression test that fails for the original cause and passes for the fix.
8. Re-run focused checks and separate unrelated baseline failures.

Do not paper over the symptom with delays, broad fallbacks, or duplicated state unless the underlying contract requires them.
