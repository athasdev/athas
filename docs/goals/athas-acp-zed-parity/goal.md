# Athas ACP Zed Parity

## Objective

Harden Athas Agent Client Protocol behavior against Zed as the local reference implementation, then complete successive safe verified patches until the first behavioral parity tranche is proven.

## Original Request

Make sure Athas ACP is on par with Zed by studying the local Zed repo at `/Users/sw/Code/zed`, hardening Athas ACP, and adding providers or harnesses only where they are needed to patch weak angles.

## Intake Summary

- Input shape: `specific`
- Audience: Athas users and maintainers who need reliable ACP behavior.
- Authority: `approved`
- Proof type: `test`
- Completion proof: Zed-referenced ACP behavior gaps are mapped, the highest-leverage Athas ACP gaps are patched, and verification proves the selected core flows now behave correctly in Athas.
- Likely misfire: Producing a comparison document or broad provider wishlist without making and verifying concrete Athas ACP improvements.
- Blind spots considered: Whether "on par with Zed" means protocol correctness, provider breadth, UX polish, or harness maturity; whether provider expansion should be delayed until core behavior is hardened; whether proof should be behavioral rather than just architectural.
- Existing plan facts: Use `/Users/sw/Code/zed` as the source to study and understand; Athas already has a good foundation; patch the bad angles; avoid broad provider expansion in the first tranche unless parity-critical evidence requires it.

## Goal Kind

`specific`

## Current Tranche

Discover Zed's ACP behavior and Athas's current ACP implementation, identify the highest-leverage behavioral gaps, choose small safe implementation slices, patch Athas, verify with behavioral parity evidence, audit each slice, and continue until the first ACP hardening tranche is complete.

## Non-Negotiable Constraints

- Treat `/Users/sw/Code/zed` as the local reference implementation for ACP behavior.
- Cross-reference Zed before changing Athas ACP behavior.
- Preserve Athas's existing foundation; do not rewrite or bulldoze working ACP architecture without evidence.
- Do not broaden into provider expansion by default.
- Add or modify provider support only when Scout/Judge evidence shows it is required for a parity-critical ACP flow.
- Prefer behavioral proof over architecture notes.
- Keep implementation slices small, reviewable, and locally verifiable.
- Follow Athas repo rules: use Bun for repo scripts, update relevant specs when code changes, and run relevant checks before handoff.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if a safe Worker task can be activated.

Do not stop after a single verified Worker slice when the broader ACP parity tranche still has safe local follow-up slices. After each slice audit, advance the board to the next highest-leverage safe Worker task and continue.

Do not stop because a slice needs owner input, credentials, production access, destructive operations, or policy decisions. Mark that exact slice blocked with a receipt, create the smallest safe follow-up or workaround task, and continue all local, non-destructive work that can still move the goal toward the full outcome.

## Canonical Board

Machine truth lives at:

`docs/goals/athas-acp-zed-parity/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/athas-acp-zed-parity/goal.md.
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
10. If a problem, suggestion, or follow-up should become a repo artifact, create an approved issue/PR or ask the operator whether to create one.
11. Treat a slice audit as a checkpoint, not completion, unless it explicitly proves the full original outcome is complete.
12. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.

Issue and PR handoffs are supporting artifacts. `state.yaml` remains authoritative, and every external artifact decision must be recorded in a task receipt.
