# Temporary Agent Handoff: Pi / Harness Progress

This file is a temporary full-context handoff for another agent.
It is intentionally detailed and can be deleted later.

## Status Update: 2026-03-26

The main WIP concern described in this handoff has now been implemented on this branch.

Completed after this handoff was written:

- the old AI entry points now route to Harness-first behavior
- `Cmd+R` / `Ctrl+R`, footer entry, menu copy, and command-palette copy now use Harness semantics
- opening from a non-Harness surface targets the default Harness tab
- toggling from a focused Harness tab closes that active Harness tab
- the inline / overlay AI panel layout path was removed from the live UI
- Harness styling was flattened toward a more pi-mono utilitarian presentation
- ACP auto-complete behavior was hardened to wait for real response activity before concluding a run

Validation completed after this handoff was written:

- frontend/unit test suite passed
- `bun typecheck` passed
- `bun check` passed
- Athas was launched locally and verified through real UI screenshots:
  - non-Harness empty state showed `Open Harness`
  - `Ctrl+R` opened Harness as a tabbed workspace surface
  - `Ctrl+R` from the focused Harness tab closed it cleanly back to the non-Harness view

This file remains useful as historical context for the larger Pi / Harness effort, but the toggle / entry-surface problem described below should be treated as resolved by the newer commits on this branch.

## Repository / Branch Context

- Repo: `athas`
- Working branch: `adding-pi-mono`
- Latest committed baseline on this branch:
  - `b1f2a478 Add Harness session state and Pi runtime parity`
- Default remote branch:
  - `origin/master`

## Why This Exists

This branch has a large amount of Pi / Harness work already completed across multiple iterations, plus some newer uncommitted UI and toggle behavior work that is not fully trusted by the user yet.

The goal of this handoff is to give another agent enough context to:

1. Understand what has already been built
2. Avoid redoing finished work
3. Know what has been verified versus what is still suspicious
4. Continue from the current WIP state safely

---

## High-Level Summary

The work on this branch has gone through two major tracks:

1. **Harness evolution**
   - Multi-session Harness tabs
   - Per-chat ACP state
   - tool timeline / activity rendering
   - lineage, branching, summaries, compaction
   - persistent session continuity

2. **Pi parity / Pi runtime integration**
   - Real `pi-coding-agent` RPC integration
   - `.pi` runtime state inheritance
   - richer Pi UI request handling
   - Pi tool event synthesis from thought blocks
   - runtime launch args from persisted Pi state

In addition, recent uncommitted work has focused on:

- making the Harness UI more T3-chat-like, then toning it back down to something more minimal
- changing the existing footer AI chat button to behave as the entry point / toggle for Harness
- trying to centralize that behavior through `toggleAIChatVisible()`

That last area is where the current instability / confusion is.

---

## What Has Already Been Built

## Phase 1: Harness foundation and scope separation

Implemented:

- `ChatScopeId` type system and scope helpers
- generic scoped chat store rather than simple panel-only / harness-only split
- store state shape based on `chatScopes: Record<string, ChatScopeState>`
- most chat actions updated to take `scopeId`
- hooks and UI components refactored to use scoped chat state
- ACP session management and persistence updated for scoped chat sessions

Result:

- panel chat and Harness sessions became separable and scalable

---

## Phase 2: Multi-session Harness and lifecycle hardening

Implemented:

- multi-session Harness UI
- frontend ACP session isolation
- Rust-side per-route ACP workers
- Harness session persistence
- lifecycle hardening
- UX polish around session state

Result:

- Harness can operate as a session-oriented workspace rather than a single ephemeral chat

---

## Phase 3: Lineage, branching, summaries, and compaction

Implemented:

- steering and follow-up message queues
- durable chat lineage with fork / resume behavior
- lineage IDs and branch-aware state
- non-destructive compaction
- effective context building from summaries + recent messages
- visible summaries
- lineage-aware branch summaries
- threshold and overflow auto-compaction
- ACP `max_tokens` detection
- collapsible branch tree
- checkpoint-level fork / trim controls
- lineage breadcrumbs in headers
- ACP backend bootstrap

Then added:

- advanced compaction policy enum with migration from legacy behavior
- ACP mode continuity using per-chat `acpState`
- per-chat `acpActivity` persistence
- transcript-native ACP rendering
- plan cards
- tool history cards
- synchronized Harness rail summaries

Validation at that time:

- frontend tests passed
- Rust tests passed
- previously reported counts included `118` frontend tests and `50+` Rust tests at later milestones

---

## Phase 4: Pi parity research and parity direction

User asked whether Athas had fully integrated pi-mono.

Conclusion reached:

- Athas had **Pi-inspired Harness behavior**, but not full pi-mono parity
- User then asked to target something much closer to pi-mono (`~99%` intent)

Direction chosen:

- treat pi-mono main branch as source of truth for parity direction
- aim for parity in workflows / runtime / behavior, while keeping Athas styling where possible

Roadmap that was approved:

- parity audit
- promote Pi to first-class runtime
- `.pi` inheritance
- workflow parity
- hooks / tooling / runtime parity
- validation harness

---

## Phase 5: Richer tool continuity for ACP / transcript

Implemented:

- Rust `AcpEvent::ToolComplete` extended with:
  - `output`
  - `locations`
- frontend `ChatAcpEvent` extended with structured tool metadata
- tool completion persistence improved
- transcript activity switched from simple status text to richer tool cards
- store / hooks / timeline wiring updated
- tests added for tool metadata persistence

Result:

- tool executions became materially more inspectable in transcript state

---

## Phase 6: safer transient retry behavior

Implemented:

- `chat-stream-retry.ts`
- retry classification helpers:
  - `getStreamErrorInfo()`
  - `shouldAutoRetryStreamError()`
  - `formatStreamErrorBlock()`
- automatic retries for recoverable failures
- conservative retry policy:
  - max 2 attempts
  - no retry after tool activity started
  - no retry if permissions were pending
- retry status / recovery events in chat activity
- reset partial assistant output before retry
- regression tests for retry classification

Result:

- streaming became more resilient without retrying dangerous mid-tool states

---

## Phase 7: real Pi RPC integration

Implemented backend Pi runtime support:

- `PiRpcSession`
- stdin/stdout JSON-RPC handling
- bootstrap prompt formatting
- Pi stop reason mapping
- extension UI request handling
- Pi event mapping into Athas `AcpEvent`
- stdout listener parsing Pi JSON lines and emitting events
- JSON-RPC `send_command()`
- command discovery / slash command fetching
- permission response path for Pi confirm dialogs
- `pi_session` added to `AcpWorker`
- worker initialization branch for Pi agents using the RPC path

Frontend / registry work:

- Pi added to agent registry with `--mode rpc`
- Pi surfaced in frontend agent selection and labels
- ACP session ID persistence adjusted for Pi placeholder behavior
- backend permission response handling for Pi confirm dialogs

Validation milestone:

- tests passed after integration

Result:

- Athas stopped being merely “Pi-inspired” and gained real Pi runtime support

---

## Phase 8: `.pi` local state inheritance

Implemented runtime state discovery and persistence:

- `AcpRuntimeState` backend + frontend
- fields including:
  - `agent_id`
  - `source`
  - `session_id`
  - `session_path`
  - `workspace_path`
  - `provider`
  - `model_id`
  - `thinking_level`
  - `behavior`
- `runtime_state_update` event type
- `ChatAcpState.runtimeState`

Bridge helpers added:

- `pi_agent_root()`
- `resolve_workspace_path()`
- `read_json_file()`
- `read_json_string()`
- `pi_session_dir_name()`
- `read_pi_workspace_session()`
- `find_pi_workspace_session()`
- `load_pi_session_mode_state()`
- `load_pi_runtime_state()`

Flow changes:

- Pi session construction accepts workspace path and initial session ID
- current session ID tracked internally
- runtime state update emitted after agent end
- Pi startup loads runtime + mode state and emits initial updates
- frontend stream handler normalizes Pi session IDs and caches runtime state for resume

Result:

- Athas can inherit real local Pi runtime/session context from `.pi` state on disk

---

## Phase 9: richer Pi extension UI requests

Implemented:

- `PermissionRequest` expanded with:
  - `title`
  - `placeholder`
  - `default_value`
  - `options`
- `PermissionResponse` expanded with optional `value`
- Pi UI request handling for:
  - `confirm`
  - `input`
  - `select`
- parser helper for Pi option shapes
- frontend permission UI for:
  - text input requests
  - select dropdown requests

Also:

- some Pi UI requests like `setTitle`, `setWidget`, `set_editor_text` were logged rather than blocking execution

Result:

- Pi’s richer UI workflows became usable inside Athas instead of only simple confirms

---

## Phase 10: Pi prompt payload bug fix

While trying to verify Pi in-app, a real bug was found:

- Athas sent Pi prompt payloads using `"prompt"`
- Pi RPC expected `"message"`

Implemented:

- helper to build the correct Pi prompt command
- updated prompt send path
- regression test

Verification:

- in-app prompt was re-run and succeeded
- screenshot evidence showed Pi replying correctly

Result:

- a concrete broken Pi prompt path was fixed and validated

---

## Phase 11: Pi runtime launch args from persisted state

Implemented:

- `build_pi_launch_args()`
- launch args now include persisted runtime state where available:
  - `--session`
  - `--provider`
  - `--model`
  - `--thinking`

Result:

- Pi launches in Athas became more aligned with previously persisted `.pi` runtime context

---

## Phase 12: synthetic Pi tool events from thought blocks

Problem discovered:

- Pi sometimes encodes tool usage inside `thinking_delta` text like:
  - `[Read] {...}`
  - `[tool-result] ok`
- instead of emitting structured tool start / end events

Implemented:

- `parse_pi_thought_tool_events()`
- `emit_pi_thought_tool_events()`
- parsed thought-tool event struct
- synthetic `tool_start` / `tool_complete` emission from thinking content
- synthetic tool counter for IDs
- event handler integration
- tests for parsing `Read` / `Bash` markers and success/error conditions

Direct verification done:

- local Pi RPC test confirmed tool parsing and synthetic event generation
- expected assistant reply validated

Result:

- Pi tool activity now appears much more like structured tool execution rather than raw thought text

---

## Manual / In-App Verification Already Performed

Previously completed:

- Launched Athas under Xvfb
- Opened Harness
- Selected Pi agent
- Submitted test prompts
- Captured screenshots for evidence
- Verified one concrete prompt failure and later verified the fix

Also performed:

- direct local Pi RPC testing outside the app to isolate provider/model issues
- discovered default provider limit issue on one model path
- tested alternate models successfully

Important nuance:

- some things were proven end-to-end for specific paths
- not every single Pi workflow has been proven comprehensively in-app

---

## Current Uncommitted Work (Very Important)

There is a large uncommitted WIP layer on top of commit `b1f2a478`.

### Current modified files

- `src/features/ai/components/chat/ai-chat.tsx`
- `src/features/ai/components/chat/chat-header.tsx`
- `src/features/ai/components/chat/chat-messages.tsx`
- `src/features/ai/components/chat/harness-session-rail.tsx`
- `src/features/ai/components/input/chat-input-bar.tsx`
- `src/features/command-palette/components/command-palette.tsx`
- `src/features/command-palette/constants/view-actions.test.tsx`
- `src/features/command-palette/constants/view-actions.tsx`
- `src/features/layout/components/footer/editor-footer.tsx`
- `src/features/settings/store.ts`
- `src/utils/acp-handler.ts`
- new: `src/features/layout/components/footer/editor-footer-ai-entry.ts`
- new: `src/features/layout/components/footer/editor-footer-ai-entry.test.ts`

### Current diff summary

- 11 modified files
- 2 new files
- roughly `570 insertions` / `432 deletions` in currently reported diffstat

---

## What The Recent WIP Was Trying To Do

### 1. Harness UI restyling

Recent edits changed:

- Harness header layout
- transcript activity cards
- right rail presentation
- chat input bar / composer
- overall message area width and spacing

Sequence:

1. It was made much more “T3 chat”-like
2. User said it became too much
3. It was then toned back down to a more minimal look

Current status:

- the toned-down version exists in the working tree
- validation passed for these code changes
- user feedback suggests the UX direction is still not fully settled

### 2. Footer AI chat button / toggle behavior

User wanted the **existing AI chat button** to be used as the entry point.

This evolved through multiple attempts:

#### Attempt A

- Footer sparkles button opened Harness directly
- Did **not** use the shared `toggleAIChatVisible()` path

User rejected that direction because the shared toggle path was not being used.

#### Attempt B

- tried to make the footer control behave more like a real Harness toggle
- attempted close/open semantics around active Harness tab

User still said it was wrong / weird.

#### Attempt C (current latest)

- `toggleAIChatVisible()` was changed so it now dynamically imports:
  - buffer store
  - `toggleHarnessFromAiChatToggle()`
- the footer button now simply calls `useSettingsStore.getState().toggleAIChatVisible()`
- the shared toggle now attempts to:
  - open Harness when closed
  - close active Harness tab when open
- command palette labels were updated to reflect Harness open/close state instead of legacy inline AI chat state

This is the latest intent, but the user explicitly said:

- “it’s not working”
- “it’s weird”
- “fix it”

So this area should be treated as **not trustworthy yet**, even though tests currently pass.

---

## Current Toggle Design in the WIP

### Helper

File:

- `src/features/layout/components/footer/editor-footer-ai-entry.ts`

Current helper function:

- `toggleHarnessFromAiChatToggle(activeBuffer, openAgentBuffer, closeBuffer, forceValue?)`

Behavior:

- if asked to close and active buffer is Harness -> close that buffer
- if asked to close and no Harness buffer active -> no-op
- if asked to open -> `openAgentBuffer()`

### Store behavior

File:

- `src/features/settings/store.ts`

Current WIP behavior:

- `toggleAIChatVisible()` no longer behaves like a normal inline panel visibility toggle
- it forces persisted `isAIChatVisible` state to `false`
- then dynamically imports buffer/toggle helper modules
- then performs Harness open/close logic through the helper

This means:

- the old `isAIChatVisible` name is now semantically misleading in this WIP
- any code assuming it still means “show panel AI chat” may now be conceptually wrong

### Command palette

Files:

- `src/features/command-palette/constants/view-actions.tsx`
- `src/features/command-palette/components/command-palette.tsx`

Current WIP:

- the toggle action label switched from AI chat semantics to Harness semantics
- the label is based on whether the active buffer is a Harness buffer

---

## Validation Status of the Recent WIP

Latest verified command set for the toggle-related WIP:

- `bun typecheck`
- `bun test`
- `bun check`

Latest observed results:

- `121 pass`
- `0 fail`
- lint/check clean on targeted files

Important warning:

- these are **code-level validations**
- they do **not** prove the UX behavior is correct
- the user still reported that the behavior is weird / not working

So the next agent should not confuse “tests pass” with “feature is acceptable”.

---

## Likely Root Problem Area

The system still contains two conceptual models that are being partially merged:

1. **Legacy inline AI chat visibility**
   - driven by `settings.isAIChatVisible`
   - used by `main-layout.tsx` to show inline/overlay panel chat

2. **Harness as tab/workspace**
   - driven by active buffer state (`isAgent`, `agentSessionId`)
   - not fundamentally a visibility flag

The current WIP tries to repurpose the old AI-chat toggle into Harness control without fully removing the old inline-AI-chat semantics everywhere.

That likely creates confusing behavior and naming drift.

---

## Recommended Next Steps For Another Agent

## Option 1: Clean conversion (recommended)

Treat the old AI chat toggle as a Harness toggle everywhere and stop pretending `isAIChatVisible` still means inline AI chat.

Likely steps:

1. Audit every callsite of `toggleAIChatVisible()`
2. Decide whether inline panel AI chat still exists as a supported product surface
3. If not:
   - remove or deprecate inline/overlay AI chat rendering from `main-layout.tsx`
   - replace visibility-based semantics with explicit Harness open/close helpers
4. Rename behavior/helpers to match Harness reality
5. Re-verify in-app manually

## Option 2: Keep both concepts but separate them clearly

If inline AI chat must still exist:

1. restore `toggleAIChatVisible()` to its original true meaning
2. create a distinct Harness toggle / open/close action
3. wire the footer button to the Harness-specific action
4. leave inline chat behavior for legacy commands if needed

This is conceptually cleaner if both surfaces must coexist.

---

## Practical Debug Targets

If another agent continues from current WIP, inspect these first:

1. `src/features/settings/store.ts`
   - current toggle implementation
   - cooldown behavior
   - whether the async import + action dispatch flow is sane

2. `src/features/layout/components/main-layout.tsx`
   - remaining inline/overlay AI chat rendering
   - whether `isAIChatVisible` still causes unrelated panel behavior

3. `src/features/layout/components/footer/editor-footer.tsx`
   - footer sparkles button

4. `src/features/command-palette/constants/view-actions.tsx`
   - toggling labels / descriptions

5. `src/features/editor/stores/buffer-store.ts`
   - `openAgentBuffer`
   - `closeBuffer`
   - assumptions about active Harness buffer lifecycle

6. `src/utils/acp-handler.ts`
   - already modified earlier in this branch for Pi/ACP activity behavior
   - should not be casually reverted without understanding transcript/runtime implications

---

## Current User Preferences / Intent

The user has consistently expressed these preferences:

- wants Athas to be very close to pi-mono behavior-wise
- does **not** want “just inspired by”
- wants real Pi support, not superficial parity
- wants proof via real usage / UI, not only claims
- wanted the Harness UI to look cleaner, but not overly styled
- specifically wants the **existing AI chat button** to be the relevant entry / toggle surface
- is okay with a temporary handoff doc in the repo root and plans to delete it later

Also important:

- the user has pushed back repeatedly when something “technically works” but does not match the intended interaction model
- for this user, behavior fidelity matters more than simply passing tests

---

## Suggested Starting Prompt For The Next Agent

Use something like this:

> Read `TEMP_AGENT_HANDOFF_2026-03-26.md` first. Then inspect the current uncommitted WIP around `toggleAIChatVisible()`, footer AI chat entry, `main-layout.tsx`, and Harness buffer open/close semantics. The user says the current AI chat button / Harness toggle behavior is weird and not working. Do not assume the latest WIP is correct just because tests pass. First diagnose the conceptual conflict between legacy inline AI chat visibility and Harness tab semantics, then propose the cleanest fix.

---

## Final Status Snapshot

### Strongly completed / mostly trusted

- major Harness architecture work
- Pi RPC integration
- `.pi` inheritance
- Pi extension UI handling
- synthetic Pi tool event generation
- multiple rounds of validation

### Completed but should still be sanity-checked in-app

- recent minimal Harness UI restyling

### Current active problem / least trusted

- AI chat button / toggle behavior
- relationship between `toggleAIChatVisible()` and Harness open/close semantics

---

## Current Status Command Snapshot

At the time this handoff was prepared:

- branch: `adding-pi-mono`
- latest commit: `b1f2a478 Add Harness session state and Pi runtime parity`
- working tree includes modified / uncommitted files listed above
- recent validator run succeeded with:
  - `bun typecheck`
  - `bun test`
  - `bun check`

---

If this doc is stale, prefer the current working tree plus this file together.
