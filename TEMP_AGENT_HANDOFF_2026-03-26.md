# Temporary Agent Handoff: Pi / Harness Progress

This file is a temporary full-context handoff for another agent.
It is intentionally detailed and can be deleted later.

## Status Update: 2026-03-26

## Status Update: 2026-03-28

Completed after the prior handoff refresh:

- Pi-native Harness session UX is now materially better in the real app:
  - the wide `Recent Pi Sessions` rail now has a real `Continue recent` action
  - the chat header now has a real `Fork session` action for the active Harness chat
  - the new session helper in `src/features/ai/lib/harness-session-actions.ts` picks the first recent native session that is not the current one
- a real race in the recent-session restore path was discovered during watched-app validation and fixed:
  - symptom:
    - opening a recent Pi-native session could create a new Harness session with the correct `sessionPath`
    - the same chat would still persist as `New Session` with `0` messages
  - root cause:
    - `ensureChatForAgent()` / `createNewChat()` could async-persist an empty chat after `handleOpenRecentPiNativeSession()` had already hydrated title/messages/runtime state
    - that late empty save clobbered the hydrated session back to blank state
  - fix:
    - the AI store now has `createSeededChat(...)`, which persists a fully hydrated chat in one pass instead of creating an empty shell and backfilling it later
    - `AIChat` now uses `createSeededChat(...)` when opening a different recent Pi-native session instead of relying on the old empty-chat creation path
  - focused regression coverage now exists in `src/features/ai/store/store.test.ts`
- watched-window proof on `:106` now exists for all three session-UX actions:
  - recent-session row open:
    - after resizing the watched Athas window to `1380x900`, clicking the top recent Pi session row restored the real transcript titled `Reply with exactly READY and nothing else.`
    - the watched SQLite mirror for chat `harness:harness:1774632982873` showed `8` messages plus the real native `sessionPath`
  - `Continue recent` button:
    - real watched click at root coordinate `1396,320` opened the next-most-recent Pi session in a fresh Harness tab
    - the watched SQLite mirror created chat `harness:session-1774633105272-odlt21:1774633105273` with `2` messages and the expected native `sessionPath`
  - `Fork session` button:
    - real watched click at root coordinate `1378,146` created a third Harness tab from the active chat
    - the watched SQLite mirror created chat `harness:session-1774633154923-bndrk9:1774633154924` with:
      - `parent_chat_id = harness:session-1774633105272-odlt21:1774633105273`
      - `root_chat_id = harness:session-1774633105272-odlt21:1774633105273`
      - `lineage_depth = 1`
- important watched-stack nuance for future sessions:
  - the right rail is hidden below the `xl` breakpoint
  - the local watched helper currently restores Athas at `1200x800`, which hides the rail
  - watched proof for the recent-session rail therefore requires resizing the live Athas window to `1380x900` first
- current proof boundary after this slice:
  - opening a recent Pi-native session from the rail is proven in the real watched app
  - `Continue recent` is proven in the real watched app
  - `Fork session` is proven in the real watched app
  - these flows now persist correct transcript/title/runtime or lineage data in the watched SQLite mirror
  - the local `.pi/` smoke extension remains untracked test scaffolding and should stay out of commits

The main WIP concern described in this handoff has now been implemented on this branch.

Completed after this handoff was written:

- native Pi slash-command + permission handling is tightened again:
  - `pi-native` prompt building now preserves slash commands as raw messages instead of prepending the Athas ACP context wrapper
  - normal non-command prompts still keep the existing context-prefixed behavior
  - the frontend native stream handler now forwards `permission_request` events to the existing Harness permission UI instead of silently dropping them
  - the native stream inactivity timer now stays alive while a permission decision is pending, so runs do not get treated as idle/completed mid-dialog
  - focused coverage now exists for:
    - raw slash-command prompt building
    - normal prompt context injection
    - native `permission_request` event forwarding
  - important root-cause sequence discovered during watched-app validation:
    - the host/native bridge permission path was already working
    - the watched app initially failed because Athas wrapped `/smoke-confirm` in the ACP context prompt, so Pi treated it like a normal chat instruction instead of a slash command
    - after fixing that, the next blocker was the missing frontend `permission_request` handler branch in `PiNativeStreamHandler`
  - local watched proof now exists on `:106` for the native permission UI:
    - typing `/smoke-confirm` in the real Harness composer shows the real slash-command suggestion
    - sending it now surfaces the inline permission row (`permission: Smoke confirm ...`) plus the composer trust strip state `Permission needed`
    - responding `deny` in the watched UI now lands end to end in the watched SQLite mirror as a real `Permission response`
  - proof boundary to keep honest:
    - watched-app `permission_request` display is proven
    - watched-app `deny` response is proven
    - host-level `approve` response is proven
    - a clean watched-app `allow` click is still flaky on the X11/VNC automation path and should not be overstated until re-proven on-screen

- native Pi restore now rehydrates the full live session snapshot instead of only `sessionId/sessionPath/workspacePath`
  - the native host now exposes `getSessionSnapshot`
  - restore/open flows now pull native runtime state, slash commands, and session mode state into Athas on restore
  - watched-window proof on `:106` now shows the native control row in the real Harness composer:
    - mode: `One at a Time`
    - model: `GPT-5.3 Codex`
    - thinking: `medium`
  - watched storage proof for the restored Harness chat now shows:
    - `runtimeState.provider = "openai-codex"`
    - `runtimeState.modelId = "gpt-5.3-codex"`
    - `runtimeState.thinkingLevel = "medium"`
    - `currentModeId = "one-at-a-time"`
    - `slashCommands.length = 335`
  - watched-window proof also still shows a fresh assistant reply (`SNAP`) after the snapshot-aware restore path
- the old AI entry points now route to Harness-first behavior
- native Harness restore was tightened again:
  - when `pi-native` Harness opens inside a real workspace with no current chat selected yet, `AIChat` now bootstraps/selects the blank Pi chat before running the existing native restore reconciliation
  - this fixes the watched-app case where Harness opened on `Pi / Chat / Idle` but stayed stuck at `New Session` because the restore effect never ran without a `currentChat`
- fresh watched-window proof on `:106` now exists on the real `/home/fsos/Developer/athas` workspace again:
  - cold watched startup restores the `athas` workspace tab locally
  - opening Harness now restores the real Pi-native session transcript with title `Reply with exactly READY and nothing else.`
  - sending a new prompt from the watched composer also works end to end again:
    - user: `Reply with exactly OK and nothing else.`
    - assistant: `OK`
  - the watched SQLite chat mirror advanced from `2` restored messages to `4` total messages during the live send
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

Additional follow-up completed after the above:

- fresh Harness scope defaults were fixed so default Harness sessions come up on `Pi` while the legacy panel scope remains `custom`
- project-loading actions were hardened so failed local folder/project loads always unwind `isFileTreeLoading` and `isSwitchingProject`
- the file-system loading fix is covered by a focused regression test in `src/features/file-system/controllers/project-loading.test.ts`
- cold-start CLI/file/folder open handling was hardened so startup path arguments are replayed through a dedicated `get_startup_open_requests` command instead of relying only on a delayed startup event
- the frontend CLI-open hook now deduplicates startup requests while allowing retry if the first attempt fails
- live Athas verification on the `:99` VNC display confirmed that launching `athas /home/fsos/Developer/athas` opens the `athas` project on cold start, and opening Harness from that project still brings up a fresh session with `Pi` selected
- VNC/Xvfb live-app verification on this machine required `WEBKIT_DISABLE_DMABUF_RENDERER=1`; without it, Athas only exposed tiny placeholder windows under WebKit on the `:99` display
- stale Pi ACP runtime state is now normalized more aggressively so historical chats do not keep synthetic `pi:<route>` session ids without a real session file
- dead Pi RPC prompt failures now surface as visible in-app errors instead of leaving Harness stuck in stop/streaming mode forever
- Harness redundancy was trimmed further:
  - empty state now shows `Open Harness` but no longer shows `New Harness Session`
  - wide Harness rail marks the default session as `Main`
  - restored idle Harness sessions now downgrade stale pending permissions and clear ghost streaming state instead of looking live forever
  - footer sparkles button hit target was enlarged slightly and spaced a bit further from settings
- watched-display validation on `:106` now visibly confirms the empty-state contract change in the real app:
  - `Open Harness` is present
  - `New Harness Session` is absent from the empty-state action list
- synthetic X11/VNC input on `:106` remains unreliable for the small footer/control targets; screenshots are trustworthy, but automated click/key injection is not yet a reliable proof path on that stack
- startup workspace restore was hardened again:
  - `MainLayout` startup restore now retries more safely instead of behaving like a fragile one-shot tied to the first partial attempt
  - persisted project sessions now tolerate a brief local-storage timing race before `restoreSession()` gives up
  - switching to the already-targeted project path no longer risks overwriting the saved Harness session with an empty session snapshot during startup retries
- watched-display validation on `:106` is now re-proven on cleaned code when Athas is launched with real `HOME=/home/fsos` plus temp XDG dirs:
  - the `athas` project restores successfully
  - the default Harness buffer restores successfully
  - the persisted `WATCHED` transcript is visible again on cold launch
- Harness transcript chrome was trimmed again:
  - generic `Session activity` cards are now hidden from the transcript
  - low-signal ACP events like mode/thinking/status/permission no longer render as a block above the composer
  - tool calls, plan updates, and explicit agent errors remain visible
- watched-display screenshot validation on `:106` now shows the restored Harness transcript without the old `Session activity` block crowding the chatbox
- Harness trust/simplicity UI was tightened again:
  - the composer now shows one compact always-visible status strip with agent, mode, and session state
  - the right rail no longer shows an always-on live-status dashboard when the active session is idle and healthy
  - session rows now use a small state dot instead of repeating `Running` / `Idle` pills on every row
  - attention-needed states remain visible in both the composer and the rail
- watched-display screenshot validation on `:106` now shows the new composer status strip in the real app (`Pi / Chat / Idle`) above the Harness controls
- Harness input capture was hardened for the watched VNC path:
  - printable keys from focused non-editor Harness controls now seed the composer instead of disappearing
  - Harness tags its active surface so the composer only steals printable keys from within the real Harness subtree
  - focused regression coverage now exists for the printable-key capture rules
- watched-display validation on `:106` now visibly shows synthetic typing landing in the real Harness composer and a visible assistant response (`READY`) after send
- Pi/Harness prompt handling was hardened again:
  - malformed persisted ACP runtime strings are now sanitized on warm restore before the frontend tries to resume/send
  - Pi RPC launch args now include `--auto medium`, so Athas no longer drops that policy flag when starting Pi
  - ACP terminal events now settle on a short frontend grace window, which prevents `prompt_complete` / `error` from finalizing the assistant placeholder before trailing Pi content chunks land
  - focused regressions now cover the two bad terminal-ordering cases:
    - `prompt_complete` before the last `content_chunk`
    - `error` before the last `content_chunk`
- Pi local runtime repair is now implemented in the Rust ACP bridge:
  - Athas repairs conflicting `~/.pi/agent` runtime files before loading Pi state
  - canonical repaired profile is now `openai-codex / gpt-5.4 / medium`
  - conflicting `droid / gpt-5.4-mini / orchestrator` local state is rewritten to that canonical profile
  - `behavior-mode-state.json` has its explicit `currentBehavior` override cleared so Pi no longer comes back pinned to `orchestrator`
- project session restore is now hardened against legacy Harness tab payloads:
  - stale file-shaped session entries like `path = "agent://harness"` are normalized back into real agent sessions on both hydrated Zustand state and raw `localStorage` reads
  - this prevents old saved project sessions from reopening the default Harness tab as a plain editor buffer named `harness`
- Harness persistence now carries runtime-backend identity as a first-class seam:
  - agent buffer paths can now encode `legacy-acp-bridge` vs `pi-native`
  - persisted project sessions now normalize old `agent://harness` payloads and new backend-aware `agent://<backend>/<sessionId>` payloads into the same agent-session shape
  - restored agent tabs, active-buffer selection, and closed-session reopen logic now preserve backend identity instead of keying only on session id
  - current runtime behavior still defaults to `legacy-acp-bridge`; this is a storage/restore seam for future `pi-native` cutover, not the cutover itself
- Harness runtime calls now flow through a dedicated frontend backend contract:
  - `src/features/ai/lib/harness-runtime.ts` resolves backend identity from the active Harness scope/buffer and centralizes prompt start, status, stop, cancel, permission response, and session-mode changes
  - `ai-chat`, `buffer-store`, `store`, and `getChatCompletionStream()` now use that runtime contract instead of calling ACP helpers directly
  - legacy ACP bridge behavior remains the default live implementation
  - `pi-native` is now an explicit unsupported runtime branch that fails loudly with `Pi native runtime is not wired into Athas yet.` instead of silently falling through the legacy ACP path
- first real `pi-native` runtime slice is now implemented:
  - Athas now depends directly on `@mariozechner/pi-coding-agent`
  - a Node-based Pi native host now lives under `src-tauri/pi-native-host/index.mjs`
  - a new Rust `PiNativeBridge` now launches that host, speaks a JSON-line request/response protocol, and forwards native Pi events back over the existing `acp-event` channel
  - new Tauri commands now exist for native Pi session start / prompt / status / cancel / stop
  - the frontend `pi-native` branch in `harness-runtime.ts` now uses a dedicated `PiNativeStreamHandler` instead of throwing immediately
  - current native coverage is intentionally narrow:
    - real session creation
    - real prompt send / response streaming
    - real status / cancel / stop
- native bootstrap/import is now wired into the Pi host:
  - `start_pi_native_session` now forwards bootstrap conversation history to the host instead of dropping it
  - the host now imports bootstrap user/assistant history into a fresh real Pi session when the session has no prior conversation entries
  - bootstrap history now lands in both places that matter:
    - the persisted Pi JSONL session file
    - the live agent message state used for the next turn
  - important nuance discovered during implementation:
    - `createAgentSession()` already seeds fresh sessions with model/thinking metadata entries
    - the correct bootstrap guard is therefore `no conversation entries yet`, not `session has zero entries`
  - local machine proof for this bootstrap slice:
    - starting the host with a bootstrap history and no prompt now creates a real session file immediately under `~/.pi/agent/sessions/...`
    - that session file now contains the imported bootstrap `user` and `assistant` messages before any new prompt turn is sent
- native Pi session enumeration is now wired through the full stack:
  - the Node host now exposes a `listSessions` request that uses `SessionManager.list(...)` against the real shared Pi session directory for the current workspace
  - the Rust `PiNativeBridge` now decodes that response into a typed `PiNativeSessionInfo` list
  - a new Tauri command now exposes those native session records to the frontend
  - `harness-runtime.ts` now has a backend-aware `listHarnessRuntimeSessions(...)` seam for `pi-native`
  - current scope is intentionally narrow:
    - enumerate real Pi-owned sessions for a workspace
    - do not invent fake restore/session-mode semantics yet
  - local machine proof for this session-list slice:
    - running `node src-tauri/pi-native-host/index.mjs` directly and sending `{"method":"listSessions", ...}` returned real Athas workspace sessions from `~/.pi/agent/sessions/--home-fsos-Developer-athas--/...`
    - the returned payload included real session paths, ids, timestamps, titles, and first-message previews
- native host startup now mirrors the older Pi workspace-resume behavior:
  - when `startSession` gets no explicit `sessionPath` and no bootstrap history, it now reuses the most recently modified real Pi session for that workspace instead of always starting fresh
  - when bootstrap history is present, that auto-resume path is skipped so imported history still lands in a new native session
  - local machine proof for this resume slice:
    - after listing Athas workspace sessions, a host-level `startSession` request with no `sessionPath` resumed the latest real session id `623a3e64-8fc2-490b-a869-e93789ee866b`
    - the emitted native runtime state pointed at the same latest JSONL path returned by `listSessions`
- frontend Harness open/restore now consumes that native session truth in a narrow way:
  - `AIChat` now reconciles an empty `pi-native` Harness Pi chat with the latest real Pi workspace session metadata on open
  - the guard is intentionally strict:
    - Harness surface only
    - `pi-native` backend only
    - Pi agent only
    - known workspace path only
    - current chat must still be empty and must not already have a `sessionPath`
  - the reconciliation currently hydrates:
    - native runtime state (`sessionId`, `sessionPath`, `workspacePath`, `source = pi-native`)
    - chat title when it is still the default `New Session`
  - important limitation:
    - before the next slice below, this only fixed native identity/restore targeting first, not full session-file-to-chat synchronization
- native Pi transcript hydration is now wired through the stack:
  - the Node host now exposes `getSessionTranscript` and parses visible `user` / `assistant` text messages from real Pi JSONL session files
  - the Rust `PiNativeBridge` and a new Tauri command now expose that transcript to the frontend
  - `harness-runtime.ts` now has a backend-aware `getHarnessRuntimeSessionTranscript(...)` seam for `pi-native`
  - empty `pi-native` Harness chats now hydrate their visible transcript from the latest reconciled native Pi session on open
  - hydration stays intentionally strict:
    - only for empty chats
    - only when the current Pi-native chat is still the same one being reconciled
    - only visible text transcript, not tool/thinking replay yet
- native Pi permission flow is now wired through the full stack:
  - the Node host now binds a real `uiContext` for extensions and translates `ctx.ui.confirm()`, `select()`, `input()`, and `editor()` into Athas `permission_request` events
  - the Rust native bridge now forwards native permission responses back to the host via a new `respondPermission` request
  - the frontend `pi-native` branch in `harness-runtime.ts` now delegates `respondToHarnessPermission(...)` to the native Tauri command instead of throwing `Pi native runtime is not wired into Athas yet.`
  - local machine proof for this permission slice:
    - a throwaway project-local Pi extension was loaded under a temp workspace
    - sending `/smoke-confirm` through `node src-tauri/pi-native-host/index.mjs` emitted a real `permission_request`
    - replying with `respondPermission` completed the prompt and emitted `prompt_complete`
  - watched-app proof is still partial:
    - the real Athas window on `:106` shows the typed `/smoke-confirm` command in Harness
    - slash-command empty-state copy was still ACP-specific before the latest uncommitted fix
    - the watched composer/send automation still did not produce a visible native permission dialog in that pass, so do not overstate live UI proof for native permission yet
- current native gaps still remaining after this slice:
  - no native session-mode / thinking / model mutation surface yet
  - no frontend-native restore/resume selection UI beyond the latest-session reconciliation yet
  - no full tool/thinking parity when restoring native transcript from Pi session files yet
  - no migration or settings/package/extension UI yet
  - packaging currently bundles the host script resource, but the implementation has only been machine-proven in the local dev/runtime environment so far
- local machine proof for the new native slice:
  - running `node src-tauri/pi-native-host/index.mjs` directly and speaking the JSON-line protocol now creates a real Pi session under `~/.pi/agent/sessions/...`
  - a smoke prompt of `Reply with exactly READY and nothing else.` returned a native `content_chunk` of `READY`, followed by `prompt_complete` and `session_complete`
  - the emitted runtime state reflected the shared Pi session path and the active model/thinking state from the real local Pi environment
- watched-display relaunch validation on `:106` with real `HOME=/home/fsos` now reflects that normalization:
  - the old lowercase plain-file `harness` tab no longer comes back after restart
  - the restored tab now comes back as a real sparkles `Harness` tab
  - a separate `Loading files...` / project-restore wrinkle is still present and should not be conflated with the legacy Harness-session normalization fix
- important validation note:
  - the earlier `forbidden path ... allow-read-dir` startup failure was caused by launching Tauri with `HOME=/tmp/...`, which changed Tauri's `$HOME/**` fs capability scope so `/home/fsos/Developer/athas` was no longer permitted
  - that specific failure was a validation-environment bug, not the underlying product bug
- Pi backend selection and native session browsing are now productized further:
  - AI Settings now exposes a `Pi Runtime -> Harness Backend` dropdown that chooses `pi-native` vs `legacy-acp-bridge` for Pi Harness entry
  - `toggleHarnessEntry`, empty-state `Open Harness`, command-palette `Open Harness`, and command-palette `New Harness Session` now respect that configured Pi backend instead of hardcoding `pi-native`
  - wide Harness now shows a real `Recent Pi Sessions` rail section sourced from shared native Pi session files
  - selecting a recent native Pi session from that rail opens a real Harness tab seeded with the chosen Pi session runtime state and visible transcript
  - watched-display proof on `:106` now shows both of those surfaces in the real app:
    - AI Settings displays the new `Pi Runtime` section with `Harness Backend`
    - wide Harness displays `Recent Pi Sessions`
    - selecting the top recent Pi session opened a second Harness tab with the restored `Reply with exactly READY and nothing else.` transcript and `READY` assistant response
- native Pi runtime parity advanced again:
  - the native host now mirrors Pi's slash-command surface for a live session:
    - built-in slash commands
    - registered extension commands
    - prompt templates
    - `skill:*` commands
  - the native host now exposes a shared session-mode surface for Athas's existing single mode selector:
    - `one-at-a-time`
    - `all`
  - native session-mode changes now update both Pi steering and follow-up queue modes together, which matches the current single-selector shape in Athas instead of inventing a second queue-mode UI
  - the native host now emits ACP-shaped events for those capabilities on the live Pi-native path:
    - `slash_commands_update`
    - `session_mode_update`
  - the frontend `PiNativeStreamHandler` now consumes those events and writes them into the existing Harness store/cache just like legacy ACP agents do
  - `harness-runtime.ts` no longer throws for Pi-native session-mode changes:
    - `changeHarnessRuntimeSessionMode(...)` now delegates to the native runtime
    - a backend-aware `listHarnessRuntimeSlashCommands(...)` seam now exists for Pi-native
  - focused native regression coverage now exists for:
    - host-side slash-command composition
    - host-side session-mode read/write
    - frontend runtime delegation for native slash-command listing and session-mode changes
- watched-display validation on `:106` for this latest slice is improved but still partial:
  - the real mapped Athas window on `:106` is present again under the `1200x800` child window, not just the `10x10` wrapper
  - a direct `Ctrl+R` send to the real child window now causes a large full-window screenshot diff, so the watched native entry path is no longer a no-op on that surface
  - exact visible proof of the slash-command dropdown and session-mode selector on the watched VNC window is still not freshly re-proven in this pass
  - do not overstate that last live-UI proof yet; the implemented code and repo verification are strong, but the watched UI still needs one cleaner native slash-command/mode demo pass

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

> Read `TEMP_AGENT_HANDOFF_2026-03-26.md` first. Then inspect the current Harness-only entry flow and the latest Harness UX trim in `chat-header.tsx`, `harness-session-rail.tsx`, `chat-messages.tsx`, and `chat-input-bar.tsx`. The old AI chat toggle conflict has already been resolved; focus on remaining Pi runtime validation or any follow-up UX polish instead of re-opening the legacy inline-panel model.

---

## Final Status Snapshot

### Strongly completed / mostly trusted

- major Harness architecture work
- Pi RPC integration
- `.pi` inheritance
- Pi extension UI handling
- synthetic Pi tool event generation
- multiple rounds of validation
- Harness-only toggle / entry contract
- Harness redundancy cleanup:
  - header reduced to title plus session actions
  - sessions-first right rail with compact live status
  - idle transcript filler removed
  - composer queue badge flattened to total queued count

### Completed but should still be sanity-checked in-app

- recent Harness redundancy cleanup on wide and narrow layouts
- Pi response completion on a fresh clean profile after cold runtime bootstrap
- watched-window Harness composer printable-key fallback on the clean `:106` session:
  - printable keys now seed the composer even when WebKit reports a window-level target
  - live proof sequence was captured in the watched window:
    - empty clean composer
    - visible typed prompt
    - visible `READY` response

### Current active problem / least trusted

- fresh-profile Pi runtime response completion still needs a clean end-to-end live re-proof after the latest startup repair
- any remaining Harness visual polish after the redundancy trim

---

## Current Status Command Snapshot

At the time this handoff was last refreshed:

- branch: `adding-pi-mono`
- latest committed native runtime slice on origin before this working tree: `e4e0acb6 Docs: refresh pi-native runtime parity handoff`
- current working tree now contains an uncommitted Pi AI-settings milestone in progress
- recent validator run succeeded with:
  - `bun test src/features/ai/lib/harness-entry-backend.test.ts src/features/layout/components/footer/editor-footer-ai-entry.test.ts src/features/command-palette/constants/view-actions.test.tsx src/features/layout/components/empty-editor-state-actions.test.ts`
  - `bun test src-tauri/pi-native-host/session-transcript.test.js src/features/ai/lib/pi-native-restore.test.ts src/features/ai/lib/harness-runtime.test.ts`
  - `bun typecheck`
  - `cargo build -p athas`
  - `cargo fmt --all --check`
  - `bun vite build`
  - `git diff --check`

### Live verification snapshot

- the watched `:106` VNC endpoint on port `5906` is currently healthy again with explicit password auth (`athas`)
- the live Athas process now runs a fresh binary that postdates the earlier stale-process problem
- the real `~/.pi/agent` files were verified on the machine after startup and now normalize immediately on app init:
  - `settings.json` has both `default_provider` and `defaultProvider` = `openai-codex`
  - `settings.json` has both `default_model` and `defaultModel` = `gpt-5.4`
  - `settings.json` has both thinking fields = `medium`
  - `reasoning-state.json` now reports `openai-codex / gpt-5.4 / medium`
  - `behavior-mode-state.json` no longer carries `currentBehavior`
- the watched `:106` display has been unstable across restarts, but the latest root capture is non-black again and the full Athas window is present
- VNC went down again once during account swapping because `x11vnc` died while `Xvfb :106` and `openbox` survived
  - corrected behavior:
    - restart only `x11vnc` on `:106`
    - keep `x11vnc` bound to `127.0.0.1:5906`
    - keep password auth at `athas`
- watched-window native restore proof now exists on the real `:106` surface:
  - seeded a clean `pi-native` Harness tab restore state into the watched profile
  - cold-launched Athas on `:106`
  - verified the restored Harness tab now hydrates from the real Pi session file instead of staying `New Session`
  - visible watched-window result:
    - title: `Reply with exactly READY and nothing else.`
    - transcript:
      - user: `Reply with exactly READY and nothing else.`
      - assistant: `READY`
  - DB proof matched the UI:
    - chat `harness:harness:1774583312206` received 2 messages
    - `acp_state.runtimeState.source = "pi-native"`
    - `sessionId = 623a3e64-8fc2-490b-a869-e93789ee866b`
    - session path points at `/home/fsos/.pi/agent/sessions/--home-fsos-Developer-athas--/2026-03-27T09-18-29-566Z_623a3e64-8fc2-490b-a869-e93789ee866b.jsonl`
- root cause of the restore bug:
  - the native restore effect in `ai-chat.tsx` was cancelling its own in-flight async work during harmless rerenders
  - `listSessions()` would complete, but effect cleanup set `cancelled = true` before transcript fetch and hydration could finish
  - the duplicate-attempt guard then blocked the rerun, leaving the chat stuck as `New Session`
- corrected behavior:
  - the effect no longer aborts the in-flight native restore attempt on rerender
  - it still prevents duplicate concurrent attempts with `nativeSessionRestoreAttemptRef`
  - the guard is cleared in `finally`, so future retries remain possible if a run actually fails
- latest native entry slice:
  - new helper `src/features/ai/lib/harness-entry-backend.ts` resolves default Harness entry backend from the default Harness scope agent
  - default open surfaces now explicitly open the default Harness session as `pi-native`:
    - footer toggle helper
    - empty-state `Open Harness`
    - command palette `View: Open Harness`
  - `View: New Harness Session` is intentionally unchanged in this slice
  - implementation avoids a bad store import cycle by resolving from scope defaults instead of pulling `useAIChatStore` into the entry helper
  - watched-window limitation remains:
    - the live Athas window on `:106` is healthy and visibly shows the native restored `READY` transcript
    - synthetic close/reopen gestures on this Xvfb/WebKit stack still refused to land reliably during this slice
    - so the new default-entry behavior is covered by code/tests/build, but not freshly re-proven by visible watched-window automation yet

### Current working-tree slice: Pi AI settings parity

- new native host helper:
  - `src-tauri/pi-native-host/pi-settings.mjs`
  - reads shared Pi defaults/auth/packages/resources/files from the real `agentDir` + project `.pi`
  - supports scoped default updates, API-key set/clear, OAuth logout, OAuth login callback bridging, and package install/remove
- new host tests:
  - `src-tauri/pi-native-host/pi-settings.test.js`
  - verifies:
    - global + project defaults snapshot
    - discovered project prompt resources
    - scoped default writes without clobbering unrelated settings
    - clearing inherited defaults removes keys instead of writing `null`
    - API-key set/clear through shared `auth.json`
- host request surface added in `src-tauri/pi-native-host/index.mjs`:
  - `getSettingsSnapshot`
  - `setDefaults`
  - `setApiKeyCredential`
  - `clearAuthCredential`
  - `loginProvider`
  - `logoutProvider`
  - `respondAuthPrompt`
  - `installPackage`
  - `removePackage`
  - plus a separate `settings_event` stream for auth prompts/progress/browser-open events
- Rust bridge/commands added:
  - `src-tauri/src/features/ai/pi_native/bridge.rs`
  - `src-tauri/src/commands/ai/pi_native.rs`
  - `src-tauri/src/main.rs`
  - settings events emit on `pi-native-settings-event`
- frontend AI settings additions:
  - `src/features/settings/lib/pi-settings.ts`
    - typed invoke wrappers and settings-event types
  - `src/features/settings/components/tabs/pi-settings-panel.tsx`
    - full Pi settings surface inside the AI tab:
      - runtime backend selector with native vs legacy health
      - global/project scope switch
      - Pi default provider/model/thinking controls
      - provider auth actions:
        - OAuth sign-in / logout
        - API-key save / clear
      - package install/remove
      - discovered resource list
      - open-real-file buttons for shared Pi files
  - `src/features/settings/components/tabs/ai-settings.tsx`
    - now mounts the dedicated Pi settings panel instead of the earlier placeholder auth + tiny runtime dropdown
  - `src/features/settings/config/search-index.ts`
    - search entries added for Pi auth/defaults/packages/advanced files

### Fresh verification for the working tree

- repo checks run successfully on this slice:
  - `bun test src-tauri/pi-native-host/pi-settings.test.js src-tauri/pi-native-host/session-runtime.test.js`
  - `bun typecheck`
  - `bun check src/features/settings/components/tabs/ai-settings.tsx src/features/settings/components/tabs/pi-settings-panel.tsx src/features/settings/lib/pi-settings.ts src/features/settings/config/search-index.ts src-tauri/pi-native-host/pi-settings.mjs src-tauri/pi-native-host/pi-settings.test.js src-tauri/pi-native-host/index.mjs src-tauri/src/features/ai/pi_native/bridge.rs src-tauri/src/commands/ai/pi_native.rs src-tauri/src/main.rs`
  - `cargo build -p athas`
  - `cargo fmt --all --check`
  - `bun vite build`
  - `git diff --check`
- real shared-state proof against this machine:
  - `bun -e 'import { getPiSettingsSnapshot } ...'` was run against:
    - `agentDir = /home/fsos/.pi/agent`
    - `cwd = /home/fsos/Developer/athas`
  - observed live snapshot:
    - effective defaults: `openai-codex / gpt-5.4 / medium`
    - package counts: `global = 1`, `project = 0`
    - discovered resources: `319`
    - stored auth present for `openai-codex` with `authStatus = oauth`
    - real-file targets surfaced:
      - `/home/fsos/.pi/agent/settings.json`
      - `/home/fsos/.pi/agent/auth.json`
      - `/home/fsos/.pi/agent/models.json` (missing on this machine)
      - `/home/fsos/Developer/athas/.pi/settings.json` (missing on this project)

### Current blocker / unproven piece

- fresh watched-window proof for the new AI settings surface is blocked by the renderer again
- `x11vnc` is healthy and `bun tauri dev` can be started on `:106`, but the display regressed to:
  - only the tiny `10x10` `athas` shell window
  - black `1-bit` root screenshots
- so the new AI-tab Pi settings UI is verified by code/tests/build and by a real shared `.pi` snapshot on this machine, but not freshly re-proven on the visible VNC surface in this turn
- the running PTY dev session used for the latest renderer check is exec session `57079`

---

If this doc is stale, prefer the current working tree plus this file together.
