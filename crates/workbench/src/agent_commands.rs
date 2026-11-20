//! The `ai.*` commands the workbench answers (`ai-command-actions.ts`): the session in front's
//! dock, browser and terminal, moving it to a window of its own, the ACP inspector, allowed
//! commands, and sending the selection to Claude Code. Commands that act on a session reach its
//! view here when the focus is elsewhere in the window.

use std::path::PathBuf;

use agent_ui::{
    SessionView,
    session_commands::{CycleAgentMode, ImportAgentSession, LogOutOfAgent, OpenAgentCliInTerminal, OpenChatTranscript, RestartAgent, ShowSessionChanges, ToggleFollowAgent},
};
use gpui::{Context, Div, Entity, Stateful, actions, prelude::*};
use workspace::SessionId;

use crate::Workbench;

actions!(
    agent,
    [
        OpenAgentInNewWindow,
        ToggleSessionDetails,
        ShowSessionBrowser,
        ShowSessionTerminal,
        ManageAllowedCommands,
        OpenAcpInspector,
        SendSelectionToClaudeCode,
        AddSelectionToChat,
        AddSelectionToNewChat,
        GenerateTerminalName,
    ]
);

/// An editor selection waiting for its session's view: path, 1-based first and last line, text.
pub(crate) type PendingSelection = (PathBuf, usize, usize, String);

pub(crate) fn register(cx: &mut gpui::App) {
    keymap::register(cx, "ai.openAgentInNewWindow", OpenAgentInNewWindow);
    keymap::register(cx, "ai.toggleSessionDetails", ToggleSessionDetails);
    keymap::register(cx, "ai.showSessionBrowser", ShowSessionBrowser);
    keymap::register(cx, "ai.showSessionTerminal", ShowSessionTerminal);
    keymap::register(cx, "ai.manageAllowedCommands", ManageAllowedCommands);
    keymap::register(cx, "ai.openAcpInspector", OpenAcpInspector);
    keymap::register(cx, "ai.sendSelectionToClaudeCode", SendSelectionToClaudeCode);
    keymap::register(cx, "editor.addSelectionToChat", AddSelectionToChat);
    keymap::register(cx, "editor.addSelectionToNewChat", AddSelectionToNewChat);
    keymap::register(cx, "terminal.generateName", GenerateTerminalName);
    terminal_view::set_name_generator(std::rc::Rc::new(agent_ui::title::generate_terminal_name), cx);
}

const NO_SESSION: &str = "Open an agent session first.";

impl Workbench {
    /// The view of the session in front, once it is open.
    fn front_session_view(&self) -> Option<Entity<SessionView>> {
        let id = &self.state.focused_session()?.id.0;
        self.centre_views.get(&format!("session:{id}"))?.session.clone()
    }

    fn with_session_view(&self, cx: &mut Context<Self>, run: impl FnOnce(&mut SessionView, &mut Context<SessionView>)) {
        match self.front_session_view() {
            Some(view) => view.update(cx, run),
            None => {
                notifications::info(cx, NO_SESSION);
            }
        }
    }

    /// Moves the session in front to a window of its own; it reopens there from its saved
    /// transcript.
    fn open_agent_in_new_window(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.state.focused_session().cloned() else {
            notifications::info(cx, "Open an agent tab first.");
            return;
        };
        let path = session.workspace_path.clone().or_else(|| session.project.as_ref().and_then(|id| self.state.project(id)).map(|project| project.path.clone()));
        let id = session.id.clone();
        self.update_state(cx, |state| state.delete_session(&id));
        self.open_new_window(
            false,
            Some(Box::new(move |workbench, _, cx| {
                let mut session = session;
                if let Some(path) = path {
                    workbench.open_project_path(PathBuf::from(path), cx);
                    session.project = workbench.state.active_project().map(|project| project.id.clone());
                }
                let id: SessionId = session.id.clone();
                workbench.update_state(cx, |state| {
                    state.insert_session(session);
                    state.open_session(&id);
                });
            })),
            cx,
        );
    }

    /// The editor's selection as agent context: lines, 1-based, and the text.
    fn editor_selection(&self, cx: &Context<Self>) -> Option<PendingSelection> {
        let editor = self.active_editor()?;
        let editor = editor.read(cx);
        let (start, end, text) = editor.selection_points();
        (!text.trim().is_empty()).then(|| (editor.path().to_path_buf(), start.0 + 1, end.0 + 1, text))
    }

    /// Cmd-L: the selection goes to the current session's composer, or a new session's when
    /// there is none (`add-selection-to-agent-chat.ts`).
    fn add_selection_to_chat(&mut self, new: bool, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let selection = self.editor_selection(cx);
        let current = if new {
            None
        } else {
            self.state
                .sessions
                .iter()
                .filter(|session| session.archived_at.is_none() && self.centre_views.contains_key(&format!("session:{}", session.id.0)))
                .max_by_key(|session| session.last_activity_at)
                .map(|session| session.id.clone())
        };
        match current {
            Some(id) => {
                self.update_state(cx, |state| state.open_session(&id));
                if let (Some((path, start, end, text)), Some(view)) = (selection, self.centre_views.get(&format!("session:{}", id.0)).and_then(|view| view.session.clone())) {
                    view.update(cx, |view, cx| view.add_selection(path, start, end, text, window, cx));
                }
            }
            None => {
                let project = self.state.active_project.clone();
                let mut created = None;
                self.update_state(cx, |state| created = Some(state.new_session(project, crate::DEFAULT_AGENT)));
                if let (Some(id), Some(selection)) = (created, selection) {
                    self.pending_selections.insert(id.0, selection);
                }
            }
        }
    }

    /// `terminal.generateName`: names the terminal in front with the AI connection.
    fn generate_terminal_name(&mut self, cx: &mut Context<Self>) {
        let Some(terminal) = self.terminal.as_ref().map(|(terminal, _)| terminal.clone()) else {
            notifications::info(cx, "Select a terminal first.");
            return;
        };
        let Some((title, directory)) = terminal.read(cx).active_title(cx) else {
            notifications::info(cx, "Select a terminal first.");
            return;
        };
        notifications::info(cx, "Generating terminal name…");
        let task = agent_ui::title::generate_terminal_name(title.clone(), directory, cx);
        cx.spawn(async move |_, cx| {
            let result = task.await;
            cx.update(|cx| match result {
                Ok(name) => {
                    let unchanged = terminal.read(cx).active_title(cx).is_some_and(|(current, _)| current == title);
                    if unchanged {
                        terminal.update(cx, |terminal, cx| terminal.rename_active(name, cx));
                        notifications::info(cx, "Terminal name generated");
                    } else {
                        notifications::info(cx, "Terminal changed; generated name was not applied");
                    }
                }
                Err(error) => {
                    notifications::error(cx, "Could not generate terminal name", Some(error.into()));
                }
            });
        })
        .detach();
    }

    /// Opens an agent's own session as a new session of the active project; the agent replays it.
    pub(crate) fn import_outside_session(&mut self, session: agent_ui::outside_sessions::OutsideSession, cx: &mut Context<Self>) {
        agent_ui::outside_sessions::forget_sidebar_session(&session.session_id, cx);
        let project = self.state.active_project.clone();
        let mut created = None;
        self.update_state(cx, |state| {
            let id = state.new_session(project, &session.agent);
            state.rename_session(&id, &session.title);
            created = Some(id);
        });
        if let Some(id) = created {
            let updated_ms = session.updated_ms();
            self.pending_imports.insert(id.0, (session.session_id, updated_ms));
        }
    }

    /// Shows or puts away the side column of boxes beside the session.
    fn toggle_session_details(&mut self, cx: &mut Context<Self>) {
        if self.state.focused_session().is_none() {
            notifications::info(cx, NO_SESSION);
            return;
        }
        agent_ui::toggle_session_side_panel(cx);
    }
}

/// Attaches the handlers to the workbench's root.
pub(crate) fn handlers(root: Stateful<Div>, cx: &mut Context<Workbench>) -> Stateful<Div> {
    root.on_action(cx.listener(|this, _: &OpenChatTranscript, _, cx| this.with_session_view(cx, |view, cx| view.open_chat_transcript(cx))))
        .on_action(cx.listener(|this, _: &ToggleFollowAgent, _, cx| this.with_session_view(cx, |view, cx| view.toggle_follow_agent(cx))))
        .on_action(cx.listener(|this, _: &CycleAgentMode, _, cx| this.with_session_view(cx, |view, cx| view.cycle_mode(cx))))
        .on_action(cx.listener(|this, _: &LogOutOfAgent, _, cx| this.with_session_view(cx, |view, cx| view.log_out_of_agent(cx))))
        .on_action(cx.listener(|this, _: &RestartAgent, _, cx| this.with_session_view(cx, |view, cx| view.restart_agent(cx))))
        .on_action(cx.listener(|this, _: &OpenAgentCliInTerminal, _, cx| this.with_session_view(cx, |view, cx| view.open_agent_cli(cx))))
        .on_action(cx.listener(|this, _: &ShowSessionChanges, window, cx| this.toggle_session_pane(crate::dock::SessionPane::Changes, window, cx)))
        .on_action(cx.listener(|this, _: &ImportAgentSession, _, cx| this.import_agent_session(cx)))
        .on_action(cx.listener(|this, _: &OpenAgentInNewWindow, _, cx| this.open_agent_in_new_window(cx)))
        .on_action(cx.listener(|this, _: &ToggleSessionDetails, _, cx| this.toggle_session_details(cx)))
        .on_action(cx.listener(|this, _: &ShowSessionBrowser, window, cx| this.toggle_session_pane(crate::dock::SessionPane::Browser, window, cx)))
        .on_action(cx.listener(|this, _: &ShowSessionTerminal, window, cx| this.toggle_session_pane(crate::dock::SessionPane::Terminal, window, cx)))
        .on_action(cx.listener(|this, _: &OpenAcpInspector, _, cx| {
            this.update_state(cx, |state| state.open_resource(agent_ui::acp_inspector::RESOURCE_KIND, "", "ACP Inspector"))
        }))
        .on_action(cx.listener(|_, _: &ManageAllowedCommands, _, cx| workbench_api::open_settings(cx, Some("ai"), Some("Allowed Commands"))))
        .on_action(cx.listener(|this, _: &AddSelectionToChat, window, cx| this.add_selection_to_chat(false, window, cx)))
        .on_action(cx.listener(|this, _: &GenerateTerminalName, _, cx| this.generate_terminal_name(cx)))
        .on_action(cx.listener(|this, _: &AddSelectionToNewChat, window, cx| this.add_selection_to_chat(true, window, cx)))
        .on_action(cx.listener(|_, _: &SendSelectionToClaudeCode, _, cx| {
            if let Err(error) = claude_ide::send_selection(cx) {
                notifications::info(cx, error);
            }
        }))
}

impl Workbench {
    /// AI: Import Agent Session (`importAgentSession`): History with the sessions of the agent in
    /// front, when it keeps its own (`selectBrowseSessionsAgentId`); all agents otherwise.
    pub(crate) fn import_agent_session(&mut self, cx: &mut Context<Self>) {
        let agent = self
            .state
            .focused_session()
            .map(|session| session.agent.clone())
            .filter(|agent| agent_ui::outside_sessions::LISTING_AGENTS.contains(&agent.as_str()));
        let key = crate::centre_views::tab_key(&workspace::TabItem::Resource { kind: "history".into(), id: String::new(), title: "History".into() });
        let open = self.centre_views.iter().find(|(view_key, _)| view_key.ends_with(&key)).and_then(|(_, view)| view.view.clone().downcast::<agent_ui::HistoryView>().ok());
        match open {
            Some(view) => view.update(cx, |view, cx| view.set_agent(agent, cx)),
            None => self.pending_history_agent = Some(agent),
        }
        self.update_state(cx, |state| state.open_resource("history", "", "History"));
    }
}
