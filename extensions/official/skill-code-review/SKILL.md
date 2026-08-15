---
name: code-review
description: Review code changes for correctness, regressions, and missing validation.
---

# Code Review

Review the requested change as a maintainer responsible for the affected system.

## Process

1. Read the surrounding implementation, tests, and public contracts before judging the diff.
2. Identify the intended behavior and trace every changed path that can affect it.
3. Look for correctness failures, regressions, unsafe assumptions, lifecycle leaks, and missing error handling.
4. Verify that tests exercise product behavior instead of implementation details.
5. Distinguish new issues from unrelated baseline problems.

## Findings

Report only actionable findings. For each finding:

- State the concrete failure or risk.
- Explain the conditions that trigger it.
- Point to the smallest relevant code range.
- Describe the user or system impact.

Order findings by severity. If no actionable problems remain, say so directly and mention any residual validation gaps.
