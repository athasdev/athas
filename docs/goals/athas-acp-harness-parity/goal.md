# Athas ACP Harness Parity

## Objective

Bring Athas's ACP harness posture up toward Zed's by studying Zed's local ACP harness/test patterns, then extending Athas's existing ACP foundation with comparable behavioral and provider/adaptor harness coverage.

## Original Request

Match the amount of ACP harness that Zed has for Athas as well. Look at how Zed does it and do the same for Athas. Athas's foundation is already good; keep going from there.

## Intake Summary

- Input shape: `specific`
- Audience: Athas maintainers and contributors working on ACP reliability.
- Authority: `approved`
- Proof type: `test`
- Completion proof: Zed's ACP harness/test posture is mapped, Athas gains the first highest-value comparable harness slices, and local verification proves those Athas harnesses run.
- Likely misfire: Counting tests or cloning Zed structure mechanically without creating reusable, reliable Athas ACP coverage.
- Blind spots considered: Harness parity could mean raw test count, protocol behavior coverage, fake-agent infrastructure, provider/adaptor compatibility, real adapter smoke, or developer tooling; real provider smoke can become auth-heavy or network-flaky.
- Existing plan facts: Use `/Users/sw/Code/zed` as the reference source; do not treat Athas as sparse or broken; extend Athas's existing foundation; optimize for behavioral ACP harness coverage plus provider compatibility harness; include real adapter smoke where practical but avoid auth-heavy or flaky provider runs.

## Goal Kind

`specific`

## Current Tranche

Map how Zed structures ACP harnesses and tests, identify the closest Athas extension points, implement successive safe harness slices for core ACP behavior and provider/adaptor compatibility, verify them locally, and audit whether the first harness parity tranche is complete.

## Non-Negotiable Constraints

- Treat `/Users/sw/Code/zed` as the local reference implementation for ACP harness/test posture.
- Cross-reference Zed before choosing Athas harness work.
- Preserve and extend Athas's existing ACP foundation; do not rewrite working architecture just to mimic Zed names.
- Optimize for reliable harness infrastructure, not raw test count.
- Cover both behavioral ACP flows and provider/adaptor compatibility where practical.
- Prefer deterministic local harnesses. If real adapter smoke needs auth, secrets, network, or brittle local state, record the blocker and use a simulated/fake harness path instead.
- Do not add broad provider expansion unless Zed evidence shows it is required for harness parity.
- Follow Athas repo rules: use Bun for repo scripts, keep changes scoped, and run relevant checks.

## Stop Rule

Stop only when a final audit proves the full original outcome for this tranche is complete.

Do not stop after mapping Zed, picking a harness design, or adding one partial test if safe harness work remains. Continue through verified implementation slices until the first harness parity tranche has concrete Athas tests/harnesses and an audit receipt.

Do not stop because real provider smoke needs auth, credentials, production access, network state, or policy decisions. Mark that exact smoke task blocked with a receipt, then continue with deterministic local harness work that advances the same parity goal.

## Canonical Board

Machine truth lives at:

`docs/goals/athas-acp-harness-parity/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/athas-acp-harness-parity/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Run the bundled GoalBuddy update checker when available and mention a newer version without blocking.
4. Re-check the intake: original request, input shape, authority, proof, blind spots, existing plan facts, and likely misfire.
5. Work only on the active board task.
6. Assign Scout, Judge, Worker, or PM according to the task.
7. Write a compact task receipt.
8. Update the board.
9. If Judge selected a safe Worker task with `allowed_files`, `verify`, and `stop_if`, activate it and continue unless blocked.
10. Treat a slice audit as a checkpoint, not completion, unless it explicitly proves the full original outcome is complete.
11. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.
