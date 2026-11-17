//! An agent session in the centre (`features/ai`): the transcript, tool calls, permission
//! requests, plans and the composer, talking to the agent over ACP (`crates/ai/src/acp`).
//!
//! The transcript model and tail-following list follow the shape of Zed's `acp_thread` and
//! `agent_ui` crates (GPL-3.0); the composer adapts GPUI's input example.
//!
//! Besides sessions: agent edit review and checkpoints (`review`), inline edit (`inline_edit`),
//! the Settings > AI page (`ai_settings`), installable ACP agents (`agent_registry`), skills
//! (`skills`), cloud and continuous agents (`cloud`), agent questions (`elicitation`), what the
//! built-in agent may always do (`allowlist`) and `!` commands from the composer (`user_command`).
//!
//! # Integrating (crates/workbench, crates/settings_ui, crates/editor)
//!
//! - Start-up: call [`init`] once after `keymap` is set up (it registers `ai.keepAgentHunk`,
//!   `ai.rejectAgentHunk`, `ai.keepAllAgentChanges`, `ai.rejectAllAgentChanges`,
//!   `ai.reviewAgentChanges`, the session commands in `session_commands` and binds the review's
//!   keys). Session commands act on the focused `SessionView`; the workbench answers them when no
//!   session is in front.
//! - Centre views: for a `TabItem::Resource` whose kind is in [`RESOURCE_KINDS`], use
//!   [`open_resource_with_focus`] (as `git_diff` is used). Kinds and ids:
//!   - `agent-review`: id = session id. "Review changes" in a session, and
//!     `ai.reviewAgentChanges` there, open it through `workbench_api::open_resource`.
//!   - `skills`: id = the project root (or empty). Its `SkillsEvent::Use(skill)` should reach the
//!     active `SessionView` as `session.attach_skill(&skill, cx)` (subscribe when opening it, or
//!     open `SkillsView` directly to subscribe).
//!   - `cloud-runs`: id = the project root (or empty) whose continuous agents it lists.
//!   - `cloud-run`: id = cloud run id.
//!   - `acp-inspector`: id empty; the JSON-RPC traffic of the ACP agents that ran (`acp::traffic`).
//!   Commands to open them: "Agent: Review Changes" (`agent-review`, the active session),
//!   "Agent: Skills" (`skills`), "Agent: Cloud Agents" (`cloud-runs`).
//! - Continuous agents: keep `cloud::ContinuousAgents::global(cx)` told about the open projects
//!   (`set_open_projects`), subscribe to `ContinuousEvent::Launch { task, prompt }`, start a
//!   session of `task.agent_id` in `task.workspace_path`, `send` it `prompt`, then call
//!   `attach_session(&task.id, &session_id)`.
//! - Settings > AI: mount [`AiSettingsView`] (see `ai_settings`).
//! - Editor: inline accept/reject lenses from `review::hunks_for_path` / `review::apply`, Cmd-K
//!   with `inline_edit::InlineEditPrompt` (see those modules).

pub mod acp;
mod add_context;
pub mod acp_inspector;
pub mod agent_registry;
pub mod agent_shortcuts;
pub mod ai_settings;
pub mod allowlist;
pub mod assistant_markdown;
pub mod attention;
pub mod attachment_groups;
pub mod builtin;
pub mod chat_link;
mod chat_preferences;
pub mod cloud;
pub mod codex;
mod compaction;
pub mod connectivity;
pub mod completion_context;
mod composer;
pub mod composer_modes;
pub mod composer_notice;
pub mod context_budget;
pub mod context_refs;
pub mod dev_servers;
pub mod diff;
mod edit_capture;
mod dock_view;
pub mod elicitation;
pub mod extension_hooks;
mod follow_ups;
pub mod history;
pub mod hosted_usage;
mod history_view;
pub mod inline_edit;
pub mod intelligence;
pub mod intelligence_sync;
mod locale_format;
pub mod markdown;
pub mod mcp_install_link;
mod message_search;
pub mod model_vendor;
pub mod native_notification;
pub mod outside_sessions;
pub mod overview;
pub mod plan_block;
mod mentions;
pub mod permission_preview;
pub mod persistence;
pub mod project_suggestions;
pub mod provider_key_dialog;
pub mod pull_request;
mod render;
pub mod review;
mod selection;
pub mod session_commands;
pub mod shell_command;
mod session_input;
mod session_view;
pub mod skills;
pub mod stop_notice;
pub mod summary;
pub mod tab_completion;
pub mod team_context;
pub mod thread;
pub mod tool_diff;
pub mod tool_groups;
pub mod tool_summary;
pub mod tool_locations;
pub mod turn_error;
pub mod title;
pub mod user_command;
pub mod voice;

use std::path::PathBuf;

use gpui::{AnyView, App, AppContext as _, Focusable as _, Window};

pub use ai_settings::AiSettingsView;
pub use dock_view::{SessionDockView, reveal_box as reveal_session_box, side_panel_shown as session_side_panel_shown, toggle_side_panel as toggle_session_side_panel};
pub use review::ReviewView;
pub use history_view::{HistoryEvent, HistoryView};
pub use session_view::SessionView;
use workspace::SessionStatus;

/// What the workbench knows about the session a view shows.
#[derive(Clone, Debug)]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    /// The agent's id, such as `claude-code`.
    pub agent: String,
    /// The project folder the agent works in; `None` for a chat of no project.
    pub cwd: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum SessionViewEvent {
    /// The session got a title (the agent's, or from the first prompt).
    TitleChanged(String),
    StatusChanged(SessionStatus),
    /// Something happened in the session: a message arrived or was sent.
    Activity,
    /// Open a file the agent touched, in the session's tabs.
    OpenFile(PathBuf),
    /// The session follows its agent: show this file, at a 1-based line, beside the session
    /// without taking the focus.
    FollowAgent { path: PathBuf, line: Option<u32> },
    /// A dev server the session's commands started answers at `url`; `open` for the session's
    /// first, when its browser should open on it.
    DevServer { url: String, open: bool },
    /// The dev server at this address stopped answering.
    DevServerStopped(String),
    /// Open a page (a dev server the session runs, or a blank one) in a browser tab.
    OpenBrowser(Option<String>),
}

/// Registers the AI commands with the command palette and binds the AI views' keys. Call once at
/// start-up, after `keymap` is set up.
pub fn init(cx: &mut App) {
    keymap::register(cx, "ai.keepAgentHunk", review::KeepAgentHunk);
    keymap::register(cx, "ai.rejectAgentHunk", review::RejectAgentHunk);
    keymap::register(cx, "ai.keepAllAgentChanges", review::KeepAllAgentChanges);
    keymap::register(cx, "ai.rejectAllAgentChanges", review::RejectAllAgentChanges);
    keymap::register(cx, "ai.reviewAgentChanges", review::ReviewAgentChanges);
    session_commands::register(cx);
    ui::bind_keys_once(cx, "agent_ui", review::view::bind_keys);
    ui::bind_keys_once(cx, "agent_ui_message_search", message_search::bind_keys);
    ui::bind_keys_once(cx, "agent_ui_selection", selection::bind_keys);
    keymap::register(cx, "ai.searchMessages", message_search::SearchMessages);
    dev_servers::track_typing(cx);
    tool_groups::mark_app_started();
    intelligence_sync::init(cx);
    intelligence::publish_connection_gate(cx);
    native_notification::init(cx);
}

/// The centre views this crate opens by `(kind, id)`, as `workspace::TabItem::Resource` names
/// them.
pub const RESOURCE_KINDS: &[&str] = &[review::RESOURCE_KIND, skills::RESOURCE_KIND, cloud::RUNS_KIND, cloud::RUN_KIND, acp_inspector::RESOURCE_KIND, tool_diff::RESOURCE_KIND];

/// The view for a resource tab of one of [`RESOURCE_KINDS`], with the handle to focus.
pub fn open_resource_with_focus(kind: &str, id: &str, window: &mut Window, cx: &mut App) -> Option<(AnyView, gpui::FocusHandle)> {
    match kind {
        review::RESOURCE_KIND => {
            let view = cx.new(|cx| ReviewView::for_session(id.to_string(), cx));
            let focus = view.focus_handle(cx);
            Some((view.into(), focus))
        }
        skills::RESOURCE_KIND => {
            // `"<project>\u{1f}<skill id>"` opens on that skill's editor (`workbench_api::open_skill`).
            let (project, skill) = match id.split_once(workbench_api::SKILL_ID_SEPARATOR) {
                Some((project, skill)) => (project, Some(skill.to_string())),
                None => (id, None),
            };
            let project = (!project.is_empty()).then(|| PathBuf::from(project));
            let view = cx.new(|cx| {
                let mut view = skills::SkillsView::new(project, window, cx);
                if let Some(skill) = skill.filter(|skill| !skill.is_empty()) {
                    view.edit_skill(skill, cx);
                }
                view
            });
            let focus = view.focus_handle(cx);
            Some((view.into(), focus))
        }
        cloud::RUNS_KIND => {
            let project = (!id.is_empty()).then(|| PathBuf::from(id));
            let view = cx.new(|cx| cloud::CloudAgentsView::new(project, cx));
            let focus = view.focus_handle(cx);
            Some((view.into(), focus))
        }
        cloud::RUN_KIND => {
            let view = cx.new(|cx| cloud::CloudRunView::new(id.to_string(), cx));
            let focus = view.focus_handle(cx);
            Some((view.into(), focus))
        }
        acp_inspector::RESOURCE_KIND => {
            let view = cx.new(|cx| acp_inspector::AcpInspectorView::new(window, cx));
            let focus = view.focus_handle(cx);
            Some((view.into(), focus))
        }
        tool_diff::RESOURCE_KIND => {
            let view = cx.new(|cx| tool_diff::ToolDiffView::new(id, cx));
            let focus = view.focus_handle(cx);
            Some((view.into(), focus))
        }
        _ => None,
    }
}

/// The view for a resource tab of one of [`RESOURCE_KINDS`].
pub fn open_resource(kind: &str, id: &str, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    open_resource_with_focus(kind, id, window, cx).map(|(view, _)| view)
}
