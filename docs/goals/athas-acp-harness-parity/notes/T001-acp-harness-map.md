# T001 Scout Receipt: ACP Harness Map

## Result

Read-only Scout mapped.

## Summary

Zed's ACP harness posture is not just more tests; it has reusable fake ACP transports plus GPUI behavioral tests that exercise production connection/thread paths. Athas already has a solid ACP foundation with frontend stream-handler regression tests, Rust bootstrap decision tests, terminal-state tests, registry/catalog seams, and Tauri command surfaces. The closest parity move is to add a deterministic Athas fake ACP connection/client harness around `crates/ai/src/acp/*`, then use it for behavior slices before any provider expansion.

## Zed ACP Harness/Test Map

Behavior harness:

- `/Users/sw/Code/zed/crates/acp_thread/src/acp_thread.rs`: GPUI behavioral ACP thread tests using `FakeAgentConnection::new()` and in-thread session updates.
- Representative tests:
  - `test_terminal_output_buffered_before_created_renders`
  - `test_terminal_output_and_exit_buffered_before_created`
  - `test_terminal_kill_allows_wait_for_exit_to_complete`
  - `test_push_user_content_block`
  - `test_thinking_concatenation`
  - `test_ignore_echoed_user_message_chunks_during_active_turn`
  - `test_edits_concurrently_to_user`
  - `test_reading_from_line`
  - `test_reading_empty_file`
  - `test_reading_non_existing_file`
  - `test_succeeding_canceled_toolcall`
  - `test_no_pending_edits_if_tool_calls_are_completed`
  - `test_tool_result_refusal`
  - `test_user_prompt_refusal_emits_event`
  - `test_refusal`
  - `test_tool_call_not_found_creates_failed_entry`
  - `test_follow_up_message_during_generation_does_not_clear_turn`
  - `test_send_returns_cancelled_response_and_marks_tools_as_cancelled`
  - `test_running_turn_cleared_when_send_task_dropped`
  - `test_session_info_update_replaces_provisional_title_and_emits_event`
  - `test_usage_update_populates_token_usage_and_cost`
  - `test_usage_update_without_cost_preserves_existing_cost`
  - `test_response_usage_does_not_clobber_session_usage`
  - `test_clearing_token_usage_also_clears_cost`

Fake ACP transport/provider harness:

- `/Users/sw/Code/zed/crates/agent_servers/src/acp.rs`: `FakeAcpAgentServer`, `FakeAcpConnectionHarness`, `FakeAcpAgentConnection`, `build_fake_acp_connection`, `connect_fake_acp_connection`.
- Harness uses `agent_client_protocol::Channel::duplex()`, wires production `connect_client_future` handlers, responds to initialize/auth/new/prompt/load/close/cancel, tracks load/close counts, supports simulated server exit and forced prompt failure.
- Tests:
  - `test_loaded_sessions_keep_state_until_last_close`
  - `test_load_session_replays_notifications_sent_before_response`
  - `test_close_session_during_in_flight_load`
  - `test_close_during_load_preserves_other_concurrent_loader`

Permissions/tools/provider harness:

- `/Users/sw/Code/zed/crates/agent/src/tests/mod.rs`: fake model/provider and fake terminal environment tests for tools, streaming tools, cancellation, auth/permission behavior, MCP tool compatibility, retry/error handling.
- Key tests:
  - `test_basic_tool_calls`
  - `test_streaming_tool_calls`
  - `test_tool_authorization`
  - `test_tool_hallucination`
  - `test_cancellation`
  - `test_terminal_tool_cancellation_captures_output`
  - `test_cancellation_aware_tool_responds_to_cancellation`
  - `test_in_progress_send_canceled_by_next_send`
  - `test_retry_cancelled_promptly_on_new_send`
  - `test_tool_updates_to_completion`
  - `test_send_retry_finishes_tool_calls_on_error`
  - `test_streaming_tool_completes_when_llm_stream_ends_without_final_input`
  - `test_streaming_tool_error_breaks_stream_loop_immediately`
  - `test_streaming_tool_error_waits_for_prior_tools_to_complete`
- Permission option tests include:
  - `test_permission_options_terminal_with_pattern`
  - `test_permission_options_edit_file_with_path_pattern`
  - `test_permission_options_fetch_with_domain_pattern`
  - `test_permission_options_terminal_pipeline_produces_dropdown_with_patterns`
- `/Users/sw/Code/zed/crates/agent/src/tool_permissions.rs` has a focused permission-rule matrix for allow/deny/path/url/terminal patterns and rule resolution.

Reference commands:

- `cargo test -p acp_thread test_usage_update_populates_token_usage_and_cost`
- `cargo test -p acp_thread test_send_returns_cancelled_response_and_marks_tools_as_cancelled`
- `cargo test -p agent_servers test_load_session_replays_notifications_sent_before_response`
- `cargo test -p agent test_cancellation`
- `cargo test -p agent test_permission_options_terminal_with_pattern`

## Athas Current ACP Harness/Test Map

Frontend behavior tests:

- `/Users/sw/Code/athas/src/features/ai/tests/acp-cancellation.test.ts`
  - `finalizes active tools before sending backend cancellation`
  - `ignores late events after a cancelled turn is force-stopped`
- `/Users/sw/Code/athas/src/features/ai/tests/acp-activity-groups.test.ts`
  - `groups running, recent, and error activity without duplicate signatures`
- `/Users/sw/Code/athas/src/features/ai/tests/acp-session-info.test.ts`
  - `returns trimmed title updates`
  - `ignores empty or unchanged titles`
- `/Users/sw/Code/athas/src/features/ai/tests/session-config-option-classifier.test.ts`
  - `prefers ACP semantic categories over label heuristics`
  - `falls back to text classification when category is missing or custom`

Rust behavior tests:

- `/Users/sw/Code/athas/crates/ai/src/acp/bridge_init.rs`
  - `loaded_session_bootstrap_preserves_requested_session_id`
  - `method_not_found_load_uses_resume_only_when_supported`
  - `missing_or_unsupported_load_falls_back_to_new_session`
  - `missing_or_unsupported_resume_falls_back_to_new_session`
  - `auth_required_errors_are_retriable_before_session_fallbacks`
  - `new_session_bootstrap_uses_agent_created_session_id`
- `/Users/sw/Code/athas/crates/ai/src/acp/terminal_state.rs`
  - `append_output_truncates_from_beginning`
  - `append_output_preserves_utf8_boundaries_when_truncating`
  - `exit_status_preserves_none_exit_code_for_signal_termination`

Registry/adapter tests:

- `/Users/sw/Code/athas/crates/ai/src/acp/config.rs`
  - `managed_wrapper_path_prefers_expected_wrapper_name`
  - `check_dir_for_binary_returns_none_for_missing_binary`
- Implementation seams: `AgentRegistry::replace_agents`, `detect_installed`, `detect_codex_adapter`, `managed_wrapper_path`, `find_binary`.

Extension points:

- `/Users/sw/Code/athas/crates/ai/src/acp/client.rs`: `AthasAcpClient` maps ACP session notifications, permission requests, file callbacks, terminal callbacks, and extension methods into `AcpEvent`.
- `/Users/sw/Code/athas/crates/ai/src/acp/bridge.rs`: `AcpWorker` owns connection/session/process lifecycle and exposes send/cancel/list/stop/mode/config operations.
- `/Users/sw/Code/athas/crates/ai/src/acp/bridge_init.rs`: bootstrap path for initialize/auth/session load/resume/new and initial mode/config event emission.
- `/Users/sw/Code/athas/crates/ai/src/acp/bridge_prompt.rs`: prompt send, auth retry, timeout, and prompt_complete emission.
- `/Users/sw/Code/athas/src/features/ai/services/acp-stream-handler.ts`: frontend event-order/cancellation/session/status/tool/permission handler and current easiest deterministic test seam.
- `/Users/sw/Code/athas/src-tauri/src/commands/ai/acp.rs`: Tauri command shell plus marketplace catalog conversion and `refresh_registered_agents`.

Current verification options:

- `bunx vp test run src/features/ai/tests/acp-cancellation.test.ts src/features/ai/tests/acp-activity-groups.test.ts src/features/ai/tests/acp-session-info.test.ts src/features/ai/tests/session-config-option-classifier.test.ts`
- `cargo test -p athas-ai acp::bridge_init::tests`
- `cargo test -p athas-ai acp::terminal_state::tests`
- `cargo test -p athas-ai acp::config::tests`
- `bun typecheck`
- `bun check:rust`

## Harness Parity Matrix

- Sessions: Zed is strong with fake ACP transport covering load/close ref counts, in-flight load, notifications before response, concurrent loaders, and session info title updates. Athas is medium: bootstrap decision tests and frontend title/session-info tests exist, but no fake ACP transport proves production connection event ordering.
- Cancellation: Zed is strong with cancelled prompt responses, pending tool cancellation, running-turn cleanup, new send canceling previous send, and terminal/subagent/tool cancellation. Athas is medium with frontend cancellation tests but no Rust bridge fake transport proof.
- Streaming: Zed is strong with echoed user chunk suppression, thinking concatenation, streaming tool parsing/completion/error loops, and buffered text flushing. Athas is low-medium: stream handler routes chunks/tools, but deterministic ordering tests are thin.
- Tools: Zed is strong across tool start/update/complete/failure/not-found, file reads/writes, concurrent edits, terminal buffering/kill/output. Athas is medium: event mapping and terminal buffer tests exist, but no client-level fake app/terminal manager harness for ACP callbacks.
- Permissions: Zed is strong across permission options and allow/deny rule matrices. Athas is low-medium: permission requests are emitted and queue cancellation exists, but no focused protocol response matrix.
- Errors: Zed is strong on startup-exited load errors, auth/internal mapping, refusal, hallucinated tools, retry failure, and dropped send cleanup. Athas is medium with startup/auth/session fallback tests and stream handler formatting.
- Usage: Zed is strong with `UsageUpdate` token usage/cost tests. Athas appears absent for ACP usage event/type mapping.
- Provider/adaptor compatibility: Zed is strong with fake ACP AgentServer and fake model/provider/terminal/MCP harnesses. Athas is low-medium with registry/catalog seams and Codex adapter fallback, but no fake adapter executable/transport smoke.

## Ranked Athas Harness Gaps

1. No Rust fake ACP connection harness equivalent to Zed's `FakeAcpConnectionHarness`.
   - Highest leverage because it can prove sessions, cancellation, streaming, tools, permissions, errors, and usage locally through production-ish bridge/client paths.
   - Target files: `crates/ai/src/acp/bridge_init.rs`, `crates/ai/src/acp/client.rs`, `crates/ai/src/acp/bridge_prompt.rs`, `crates/ai/src/acp/bridge.rs`, possible `crates/ai/src/acp/test_harness.rs`.

2. No ACP usage/token-cost mapping or tests.
   - Clear Zed parity gap with narrow blast radius; currently no Athas event/type exists for usage.
   - Target files: `crates/ai/src/acp/types.rs`, `crates/ai/src/acp/client.rs`, `src/features/ai/types/acp.ts`, `src/features/ai/services/acp-stream-handler.ts`.

3. Client-level permission mapping/cancel/timeout harness is missing.
   - Athas has UI queue behavior but not the protocol response matrix for selected/cancelled/auto-reject/fallback options.
   - Target files: `crates/ai/src/acp/client.rs`, `src/features/ai/services/acp-stream-handler.ts`, `src/features/ai/components/chat/ai-chat.tsx`.

4. Streaming/event ordering tests are thin.
   - Zed proves duplicate user echo suppression, thinking concatenation, and late turn isolation.
   - Target files: `src/features/ai/services/acp-stream-handler.ts`, `src/features/ai/tests`, `crates/ai/src/acp/client.rs`.

5. Provider/adaptor compatibility smoke is config-only.
   - Athas detects Codex adapter and marketplace agents, but lacks local fake adapter/fixture validation of initialize/session/prompt/cancel without auth/network.
   - Target files: `crates/ai/src/acp/config.rs`, `src-tauri/src/commands/ai/acp.rs`, possible test fixture under `crates/ai/src/acp` or tests.

6. Terminal/file ACP callback harness is only partial.
   - Terminal buffer unit tests exist, but full create/output/wait/kill/release and read/write file callbacks through `AthasAcpClient` are not covered.
   - Target files: `crates/ai/src/acp/client.rs`, `crates/ai/src/acp/terminal_state.rs`.

## Candidate Worker Slices

W1:

- Objective: Add the minimal reusable Athas fake ACP harness for `athas-ai` without changing product behavior.
- Allowed files: `crates/ai/src/acp/client.rs`, `crates/ai/src/acp/bridge_init.rs`, `crates/ai/src/acp/bridge_prompt.rs`, `crates/ai/src/acp/bridge.rs`, `crates/ai/src/acp/mod.rs`, optional new test-only file `crates/ai/src/acp/test_harness.rs`.
- Verification: `cargo test -p athas-ai acp`, `bun check:rust`.
- Stop if: requires live ACP provider/auth/network/secrets; broad provider expansion; bridge rewrite instead of narrow test seam.

W2:

- Objective: Use fake harness to prove session notification ordering and load/resume/new behavior through production-ish paths.
- Allowed files: `crates/ai/src/acp/bridge_init.rs`, `crates/ai/src/acp/client.rs`, `crates/ai/src/acp/test_harness.rs`.
- Verification: `cargo test -p athas-ai acp::bridge_init`, `cargo test -p athas-ai acp::client`.
- Stop if: needs external adapter process or new dependencies.

W3:

- Objective: Add ACP `UsageUpdate` mapping and deterministic tests.
- Allowed files: `crates/ai/src/acp/types.rs`, `crates/ai/src/acp/client.rs`, `src/features/ai/types/acp.ts`, `src/features/ai/services/acp-stream-handler.ts`, `src/features/ai/tests/*usage*.test.ts`.
- Verification: `cargo test -p athas-ai acp`, `bunx vp test run src/features/ai/tests`, `bun typecheck`.
- Stop if: usage semantics require UI design beyond exposing routed state/event, or protocol crate lacks `UsageUpdate`.

W4:

- Objective: Add permission protocol harness for selected/cancelled/auto-reject/fallback responses.
- Allowed files: `crates/ai/src/acp/client.rs`, `src/features/ai/services/acp-stream-handler.ts`, `src/features/ai/tests/acp-permissions.test.ts`.
- Verification: `cargo test -p athas-ai acp::client`, `bunx vp test run src/features/ai/tests/acp-cancellation.test.ts src/features/ai/tests/acp-permissions.test.ts`.
- Stop if: requires changing product permission policy instead of harnessing current behavior, or long real-time timeout.

W5:

- Objective: Add local fake adapter/provider compatibility smoke without real provider auth.
- Allowed files: `crates/ai/src/acp/config.rs`, `src-tauri/src/commands/ai/acp.rs`, optional test fixture under `crates/ai/src/acp/tests` or src-tauri tests.
- Verification: `cargo test -p athas-ai acp::config`, `bun check:rust`.
- Stop if: requires real Codex/Claude/Gemini login or expands provider catalog instead of proving adapter compatibility.

## Ambiguity Requiring Judge

- Whether first tranche should prioritize reusable harness infrastructure (W1) or immediately add visible usage event slice (W3). Scout recommends W1 for leverage, W3 for fastest narrow parity.
- Whether Athas should add a Rust test-only fake app/terminal manager seam now, or keep first harness frontend-only. Zed evidence favors Rust/in-process fake transport.
- Whether provider/adaptor compatibility means fake local adapter smoke only, or real Codex/Claude/Gemini smoke. Evidence and charter favor fake/local deterministic smoke and avoiding auth-heavy real providers.
- Whether `UsageUpdate` is available in Athas's pinned `agent_client_protocol` version; current Athas code has no usage mapping hits, but Worker should confirm dependency API before editing.
