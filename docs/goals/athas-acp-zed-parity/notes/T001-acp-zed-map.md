# T001 Scout Receipt: ACP Zed Map

## Result

Mapped.

## Summary

Athas has a functional ACP client bridge with process lifecycle, initialize/auth/session bootstrap, prompt/cancel, session list/load/resume, file and terminal client capabilities, permission UI, events, and frontend stream handling. Zed's reference is materially deeper in behavioral turn semantics and test coverage: it models ACP as an `AcpThread`, guards prompt turns, cancels/replaces in-flight turns, marks pending tools cancelled, buffers terminal output before terminal creation, tracks usage/cost, and has extensive authorization/cancellation tests. Highest-leverage first tranche should harden Athas core protocol behavior, not broaden providers.

## Evidence Paths

Board:

- `/Users/sw/Code/athas/docs/goals/athas-acp-zed-parity/goal.md`
- `/Users/sw/Code/athas/docs/goals/athas-acp-zed-parity/state.yaml`

Athas core:

- `/Users/sw/Code/athas/crates/ai/src/acp/bridge.rs`
- `/Users/sw/Code/athas/crates/ai/src/acp/bridge_init.rs`
- `/Users/sw/Code/athas/crates/ai/src/acp/bridge_prompt.rs`
- `/Users/sw/Code/athas/crates/ai/src/acp/client.rs`
- `/Users/sw/Code/athas/crates/ai/src/acp/types.rs`
- `/Users/sw/Code/athas/crates/ai/src/acp/terminal_state.rs`
- `/Users/sw/Code/athas/crates/ai/src/acp/config.rs`
- `/Users/sw/Code/athas/src-tauri/src/commands/ai/acp.rs`

Athas frontend:

- `/Users/sw/Code/athas/src/features/ai/services/acp-stream-handler.ts`
- `/Users/sw/Code/athas/src/features/ai/components/chat/ai-chat.tsx`
- `/Users/sw/Code/athas/src/features/ai/types/acp.ts`
- `/Users/sw/Code/athas/src/features/ai/tests/acp-activity-groups.test.ts`
- `/Users/sw/Code/athas/src/features/ai/tests/session-config-option-classifier.test.ts`
- `/Users/sw/Code/athas/src/features/ai/tests/acp-session-info.test.ts`

Zed reference:

- `/Users/sw/Code/zed/crates/acp_thread/src/connection.rs`
- `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`
- `/Users/sw/Code/zed/crates/agent/src/thread.rs`
- `/Users/sw/Code/zed/crates/agent/src/tests/mod.rs`
- `/Users/sw/Code/zed/crates/agent/src/tests/test_tools.rs`
- `/Users/sw/Code/zed/docs/src/ai/external-agents.md`
- `/Users/sw/Code/zed/crates/project/src/agent_registry_store.rs`
- `/Users/sw/Code/zed/crates/migrator/src/migrations/m_2026_02_25/settings.rs`

## Athas ACP Implementation Map

Lifecycle:

- Tauri commands expose start/stop/send/status/respond/mode/config/list/cancel in `src-tauri/src/commands/ai/acp.rs`.
- `AcpAgentBridge` dispatches commands to a dedicated worker thread and emits status in `crates/ai/src/acp/bridge.rs`.
- Worker stops existing agent before initialize and tracks process/connection/session/client in `crates/ai/src/acp/bridge.rs`.
- Process death emits error/status and clears state in `crates/ai/src/acp/bridge.rs`.
- Stop optionally calls `session/close` when advertised, aborts IO, stops child tree, and clears state in `crates/ai/src/acp/bridge.rs`.

Session bootstrap:

- Initialize creates `ClientSideConnection`, sends `InitializeRequest` with fs read/write, terminal, and Athas ext-method metadata in `crates/ai/src/acp/bridge_init.rs`.
- `AuthRequired` retry exists for session load/resume/new in `crates/ai/src/acp/bridge_init.rs`.
- Requested session tries `session/load`, then `session/resume` only when resume capability exists, then `session/new` fallback on `MethodNotFound`/`ResourceNotFound` in `crates/ai/src/acp/bridge_init.rs`.
- Initial modes/config options are emitted as frontend events in `crates/ai/src/acp/bridge_init.rs`.

Streaming and events:

- Client maps `UserMessageChunk`, `AgentMessageChunk`, `AgentThoughtChunk`, `ToolCall`, `ToolCallUpdate`, modes, config, session info, commands, and plan to `AcpEvent` in `crates/ai/src/acp/client.rs`.
- Frontend `AcpStreamHandler` listens to `acp-event` and routes chunks/tools/permission/status/modes/config/plan/prompt_complete/ui_action in `src/features/ai/services/acp-stream-handler.ts`.
- Chat component keeps global ACP state in sync and appends visible plan/error/status events in `src/features/ai/components/chat/ai-chat.tsx`.

Cancellation:

- Backend sends ACP cancel notification in `crates/ai/src/acp/bridge.rs`.
- Frontend force-stops active handler before invoking cancel, then completes UI locally in `src/features/ai/services/acp-stream-handler.ts`.
- Chat stop cancels prompt and responds to queued permissions as cancelled in `src/features/ai/components/chat/ai-chat.tsx`.

Tools and client capabilities:

- Permission request emits options and waits up to 300s for response in `crates/ai/src/acp/client.rs`.
- `read_text_file`/`write_text_file` are direct filesystem operations with simple error mapping in `crates/ai/src/acp/client.rs`.
- Terminal create/output/release/wait/kill are implemented over Athas terminal manager in `crates/ai/src/acp/client.rs`.
- Terminal output buffer/truncation is isolated in `crates/ai/src/acp/terminal_state.rs`; tests exist only for buffer truncation, not full ACP ordering.

Provider handoff:

- Agent registry is dynamic/manifest-driven; installed detection and managed wrappers live in `crates/ai/src/acp/config.rs`.
- Codex has special direct `codex-acp` or `npx @zed-industries/codex-acp` detection in `crates/ai/src/acp/config.rs`.
- Athas has catalog install/uninstall wrappers in `src-tauri/src/commands/ai/acp.rs`.

Test health:

- Athas visible ACP-related tests are mostly frontend utility tests and `terminal_state` unit tests.
- Scout found no Rust ACP bridge/client behavioral tests for prompt/cancel/session/tool ordering.

## Zed ACP Implementation Map

Lifecycle and abstraction:

- Zed centers ACP behind `AgentConnection`: new/load/resume/close/session_history/auth/prompt/retry/cancel/modes/config/list/model selector in `/Users/sw/Code/zed/crates/acp_thread/src/connection.rs`.
- `AcpThread` handles session updates into thread events and UI state in `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`.

Turn model:

- `AcpThread::send` optimistically inserts user message, checkpoints git state, and calls `connection.prompt` with a `UserMessageId` in `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`.
- `run_turn` cancels any previous turn, tracks `turn_id`, only clears same turn, flushes streaming text, handles `MaxTokens`/`Cancelled`/`Refusal` in `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`.
- Cancelled responses mark pending tools cancelled and skip completed-plan snapshot in `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`.

File and terminal tools:

- Zed file reads use project buffers, resource-not-found/invalid-params handling, shared snapshots, and agent location in `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`.
- Zed writes diff against buffer snapshot, update action log, format on save, and save buffer in `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`.
- Zed terminal creation shells command with env/PAGER handling and terminal entities in `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`.

Authorization:

- Built-in tool permissions support allow/deny once/always, path/url/terminal patterns, and pipeline pattern dropdowns in `/Users/sw/Code/zed/crates/agent/src/thread.rs`.
- Authorization loop watches settings so always allow/deny resolves sibling pending prompts in `/Users/sw/Code/zed/crates/agent/src/thread.rs`.
- Third-party/MCP authorization is separated in `/Users/sw/Code/zed/crates/agent/src/thread.rs`.

Provider breadth:

- Docs list Gemini CLI, Claude Agent, Codex, GitHub Copilot, registry/custom agents, and MCP forwarding in `/Users/sw/Code/zed/docs/src/ai/external-agents.md`.
- Registry migration maps `gemini`, `claude-acp`, and `codex-acp` in `/Users/sw/Code/zed/crates/migrator/src/migrations/m_2026_02_25/settings.rs`.

Test health:

- Zed has direct ACP tests for terminal buffering, cancellation, pending tools, usage/cost, and authorization in `crates/acp_thread/src/acp_thread.rs` and `crates/agent/src/tests/mod.rs`.

## Behavioral Parity Matrix

- Lifecycle: Athas has process spawn/init/status/stop/close. Zed has stronger trait separation and turn/thread state. Gap is not an architecture rewrite; harden Athas state transitions around stop/crash/cancel.
- Sessions: Athas supports new/load/resume/list/close capability checks. Zed exposes load/resume/close/list/history through trait plus UI thread. Gap: Athas lacks behavioral tests for load-to-resume fallback and `ResourceNotFound`/`MethodNotFound`/`AuthRequired` branches.
- Streaming: Athas forwards chunks/tools/plans/modes/config/session info. Zed additionally flushes buffered streaming text at turn completion and suppresses duplicate echoed user chunks. Gap: Athas should test event ordering and duplicate user echo behavior.
- Cancellation: Athas sends cancel but frontend marks complete immediately. Zed cancels previous in-flight turn before new send, returns cancelled stop, marks pending tools cancelled, and tests multiple terminal/subagent cases. This is the top protocol behavior gap.
- Tools: Athas maps tool start/update/complete and terminal/file callbacks. Zed has richer buffer-aware file operations, terminal output ordering/buffering, and permission-state propagation. First tranche should target terminal/tool lifecycle semantics, not the full Zed buffer model.
- Errors: Athas maps many backend failures to string errors and synthetic "Tool call failed"; unknown stop reasons become `EndTurn`. Zed distinguishes `MaxTokens`, `Refusal`, `Cancelled`, `ResourceNotFound`, `InvalidParams`, and error events. Gap: preserve stop/error semantics rather than collapse.
- Provider handoff: Athas has dynamic catalog plus Codex adapter fallback. Zed has registry/provider breadth and MCP forwarding. This is provider breadth, not first-tranche protocol hardening, unless a core flow is blocked by a missing adapter.
- Tests: Athas lacks ACP bridge/client behavioral harness; Zed's tests are the main reference. First tranche should add focused Rust or TypeScript tests around one selected behavior.

## Ranked Gap Candidates

1. Cancellation semantics and pending tool finalization
   - Type: protocol behavior
   - Risk: medium
   - Zed evidence: `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`, `/Users/sw/Code/zed/crates/agent/src/tests/mod.rs`
   - Athas evidence: `/Users/sw/Code/athas/crates/ai/src/acp/bridge.rs`, `/Users/sw/Code/athas/src/features/ai/services/acp-stream-handler.ts`, `/Users/sw/Code/athas/src/features/ai/components/chat/ai-chat.tsx`
   - Likely files: `crates/ai/src/acp/bridge.rs`, `crates/ai/src/acp/bridge_prompt.rs`, `crates/ai/src/acp/client.rs`, `src/features/ai/services/acp-stream-handler.ts`, `src/features/ai/types/acp.ts`
   - Verification options: `bun typecheck`, `bunx vp test run src/features/ai/tests`, `cargo test -p athas-ai acp`, focused fake ACP adapter/unit harness if available or added.

2. Missing ACP behavioral test harness for session load/resume/auth fallbacks
   - Type: protocol behavior
   - Risk: low-medium
   - Zed evidence: `/Users/sw/Code/zed/crates/acp_thread/src/connection.rs`
   - Athas evidence: `/Users/sw/Code/athas/crates/ai/src/acp/bridge_init.rs`
   - Likely files: `crates/ai/src/acp/bridge_init.rs`, `crates/ai/src/acp/bridge_commands.rs` only if needed for test seams.
   - Verification options: `cargo test -p athas-ai acp::bridge_init`, `bun check:rust`.

3. Tool update ordering and unknown/succeeded-after-cancel handling
   - Type: protocol behavior
   - Risk: medium
   - Zed evidence: `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`
   - Athas evidence: `/Users/sw/Code/athas/crates/ai/src/acp/client.rs`, `/Users/sw/Code/athas/src/features/ai/lib/tool-call-state.ts`
   - Likely files: `crates/ai/src/acp/client.rs`, `src/features/ai/lib/tool-call-state.ts`, `src/features/ai/services/acp-stream-handler.ts`
   - Verification options: frontend unit test for tool-call-state; Rust unit test for client event mapping if fake `AppHandle` is practical.

4. UsageUpdate/token-cost events unsupported
   - Type: protocol behavior
   - Risk: low
   - Zed evidence: `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`
   - Athas evidence: no `UsageUpdate`/`TokenUsage` hits under `/Users/sw/Code/athas/crates/ai` or `src/features/ai` except unrelated provider usage.
   - Likely files: `crates/ai/src/acp/types.rs`, `crates/ai/src/acp/client.rs`, `src/features/ai/types/acp.ts`, `src/features/ai/services/acp-stream-handler.ts`
   - Verification options: typecheck plus unit event mapping test.

5. Provider breadth and registry/MCP forwarding
   - Type: provider breadth
   - Risk: high for first tranche
   - Zed evidence: `/Users/sw/Code/zed/docs/src/ai/external-agents.md`
   - Athas evidence: `/Users/sw/Code/athas/crates/ai/src/acp/config.rs`, `/Users/sw/Code/athas/src-tauri/src/commands/ai/acp.rs`
   - Recommendation: defer unless Judge decides a missing provider blocks cancellation/session/tool protocol proof.

## Candidate Worker Slices

W1:

- Objective: Add focused cancellation behavior proof and patch Athas so cancelled ACP turns do not leave stale running/tool state.
- Candidate files: `crates/ai/src/acp/bridge.rs`, `crates/ai/src/acp/bridge_prompt.rs`, `crates/ai/src/acp/client.rs`, `src/features/ai/services/acp-stream-handler.ts`, `src/features/ai/types/acp.ts`, focused tests under `crates/ai/src/acp` or `src/features/ai/tests`.
- Candidate verification: `bun typecheck`, `bunx vp test run src/features/ai/tests`, `cargo test -p athas-ai acp`.
- Stop if: requires provider expansion or no fake/stub path can prove behavior locally.

W2:

- Objective: Add `bridge_init` session bootstrap tests for load/resume/new `AuthRequired`/`MethodNotFound`/`ResourceNotFound` decisions.
- Candidate files: `crates/ai/src/acp/bridge_init.rs`, `crates/ai/src/acp/bridge_commands.rs` only if needed for test seams.
- Candidate verification: `cargo test -p athas-ai acp::bridge_init`, `bun check:rust`.
- Stop if: needs live external ACP adapters instead of local stubs.

W3:

- Objective: Map ACP `UsageUpdate` into Athas events/types and add event-routing test, without UI polish beyond state availability.
- Candidate files: `crates/ai/src/acp/types.rs`, `crates/ai/src/acp/client.rs`, `src/features/ai/types/acp.ts`, `src/features/ai/services/acp-stream-handler.ts`, `src/features/ai/tests/*`.
- Candidate verification: `bun typecheck`, `bunx vp test run src/features/ai/tests`, `cargo test -p athas-ai acp`.
- Stop if: requires broad analytics/cost UI design.

## Commands Run By Scout

- `rg ACP/acp` across Athas board/src/crates/src-tauri.
- `sed`/`nl` reads of Athas ACP bridge/init/prompt/client/types/config/frontend files.
- `rg ACP/acp` across `/Users/sw/Code/zed`.
- `sed`/`nl` reads of Zed `acp_thread`, `connection`, agent thread, docs, tests.
- `jq '.scripts' package.json`.
- `git status --short`.

## Health Signals

- Athas repo had untracked `docs/` in `git status`; Scout did not edit or stage anything.
- No dependency installs, builds, tests, or destructive commands were run.
- Athas validation scripts available: `bun typecheck`, `bun check`, `bun check:rust`, `bunx vp test run`.

## Ambiguity Requiring Judge

- Whether first Worker should patch behavior immediately or first add a fake ACP harness. Scout recommends W1 only if Judge permits adding the minimal harness/test surface needed to prove cancellation locally.
- Whether `UsageUpdate` belongs in the first tranche. It is a clear Zed parity gap but lower leverage than cancellation/session/tool correctness.
- Whether provider breadth matters for this tranche. Evidence says defer broad provider expansion; only Codex adapter parity appears locally relevant today.
