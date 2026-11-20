use std::path::{Path, PathBuf};

use agent_ui::{SessionInfo, SessionView, SessionViewEvent};
use database_view::DatabaseView;
use docker_view::DockerView;
use editor::{Editor, EditorEvent};
use gpui::{AnyView, Context, FocusHandle, Focusable, Subscription, Window, prelude::*};
use search_panel::{SearchEvent, SearchView};
use viewer::FileViewer;
use workspace::{SessionId, TabItem, now_ms};

use crate::Workbench;

/// What an editor-area terminal tab starts with.
pub(crate) enum PendingTerminal {
    Moved(terminal_view::MovedTerminal),
    Command { command: String, cwd: Option<PathBuf> },
    In(Option<PathBuf>),
}

/// The view behind a centre tab.
pub(crate) struct CentreView {
    pub view: AnyView,
    pub focus: Option<FocusHandle>,
    /// The editor behind a file tab, to move its cursor to a line.
    pub editor: Option<gpui::Entity<Editor>>,
    /// The agent session behind a session tab, for its dock.
    pub session: Option<gpui::Entity<SessionView>>,
    _subscription: Option<Subscription>,
}

/// Which view a tab shows; tabs with the same key share one view.
pub(crate) fn tab_key(item: &TabItem) -> String {
    match item {
        TabItem::Session { id } => format!("session:{}", id.0),
        TabItem::File { path } => format!("file:{path}"),
        TabItem::ProjectDashboard { id } => format!("dashboard:{}", id.0),
        TabItem::Welcome => "welcome".into(),
        TabItem::Resource { kind, id, .. } => format!("{kind}:{id}"),
    }
}

/// The view a tab in a group shows. A session has one view wherever its tab is; files and tools
/// get a view per group, so a split shows the same file twice.
pub(crate) fn view_key(group: u64, item: &TabItem) -> String {
    match item {
        TabItem::Session { .. } => tab_key(item),
        _ => format!("g{group}:{}", tab_key(item)),
    }
}

impl Workbench {
    /// Opens a terminal as an editor tab (`openTerminalBuffer`) in the group in front.
    pub(crate) fn open_terminal_tab(&mut self, pending: PendingTerminal, title: &str, cx: &mut Context<Self>) -> String {
        self.next_terminal_tab += 1;
        let id = format!("{}-{}", now_ms(), self.next_terminal_tab);
        self.pending_terminals.insert(id.clone(), pending);
        self.update_state(cx, |state| state.open_resource("terminal", &id, title));
        id
    }

    /// Opens a file among the tabs in front, moving to a line when given.
    /// The same file open in another split group has its own editor: it takes this one's text
    /// (and, after a save, its saved state) so the copies stay one document.
    fn mirror_to_copies(&mut self, source: &gpui::Entity<Editor>, saved: bool, cx: &mut Context<Self>) {
        let path = source.read(cx).path().to_path_buf();
        let copies: Vec<gpui::Entity<Editor>> = self
            .centre_views
            .values()
            .filter_map(|view| view.editor.clone())
            .filter(|other| other.entity_id() != source.entity_id() && other.read(cx).path() == path)
            .collect();
        if copies.is_empty() {
            return;
        }
        // A copy that just loaded from disk takes the open one's unsaved edits, never the reverse.
        if !saved && !source.read(cx).has_edits()
            && let Some(edited) = copies.iter().find(|copy| copy.read(cx).is_dirty())
        {
            let text = edited.read(cx).text();
            source.update(cx, |source, cx| source.mirror_text(&text, false, cx));
            return;
        }
        let (text, saved) = {
            let source = source.read(cx);
            (source.text(), saved || !source.is_dirty())
        };
        for copy in copies {
            copy.update(cx, |copy, cx| copy.mirror_text(&text, saved, cx));
        }
    }

    pub(crate) fn open_file_at(&mut self, path: PathBuf, line: Option<u32>, column: Option<u32>, cx: &mut Context<Self>) {
        palette::track_file_access(&path, cx);
        let path = path.to_string_lossy().into_owned();
        if let Some(line) = line {
            if let Some(here) = self.current_location(cx) {
                self.jump_list.push(here);
            }
            self.pending_lines.insert(path.clone(), (line, column));
        }
        self.update_state(cx, |state| state.open_file(&path));
    }

    /// The group showing `session` as its tab in front, when it is the focused group.
    pub(crate) fn visible_session_group(&self, session: &SessionId) -> Option<u64> {
        let panes = self.state.focused_panes()?;
        let group = panes.group(panes.active)?;
        matches!(group.tabs.active_item(), Some(TabItem::Session { id }) if id == session).then_some(panes.active)
    }

    /// The group a followed file opens in (`pickAgentFollowPaneId`): never the session's own or
    /// a locked one; a group already showing the file, else the most recently used one. `None`
    /// means splitting one off the session.
    pub(crate) fn follow_target_group(&self, session_group: u64, path: &str) -> Option<u64> {
        let panes = self.state.focused_panes()?;
        let candidates: Vec<&workspace::PaneGroup> = panes.groups.iter().filter(|group| group.id != session_group && !group.locked).collect();
        let file = TabItem::File { path: path.to_string() };
        if let Some(showing) = candidates.iter().find(|group| group.tabs.tabs.contains(&file)) {
            return Some(showing.id);
        }
        self.group_history
            .iter()
            .find(|id| candidates.iter().any(|group| group.id == **id))
            .copied()
            .or_else(|| candidates.first().map(|group| group.id))
    }

    /// Input in a group other than the followed session's ends following
    /// (`interruptsAgentFollow`); typing in the session or using the sidebars keeps it on.
    pub(crate) fn interrupt_follow(&mut self, group: u64, cx: &mut Context<Self>) {
        let Some(panes) = self.state.focused_panes() else { return };
        let sessions: Vec<(u64, SessionId)> = panes
            .groups
            .iter()
            .filter_map(|pane| match pane.tabs.active_item() {
                Some(TabItem::Session { id }) if pane.id != group => Some((pane.id, id.clone())),
                _ => None,
            })
            .collect();
        for (_, id) in sessions {
            if let Some(view) = self.centre_views.get(&tab_key(&TabItem::Session { id })).and_then(|view| view.session.clone()) {
                view.update(cx, |view, cx| view.stop_following(cx));
            }
        }
    }

    /// Tells views outside the workbench which projects are open.
    pub(crate) fn publish_projects(&self, cx: &mut Context<Self>) {
        let projects = workbench_api::Projects {
            active: self.state.active_project().map(|project| project.path.clone()),
            open: self.state.projects.iter().map(|project| project.path.clone()).collect(),
        };
        workbench_api::set_projects(cx, projects);
        let mut tabs: Vec<workbench_api::OpenTab> = Vec::new();
        let front = self.state.focused_panes().and_then(|panes| panes.active_set().active_item());
        // Only the layout on screen: other projects' and sessions' layouts are not open tabs.
        let visible: Vec<(u64, &TabItem)> =
            self.state.focused_panes().map(|panes| panes.groups.iter().flat_map(|group| group.tabs.tabs.iter().map(move |tab| (group.id, tab))).collect()).unwrap_or_default();
        for (group, item) in visible {
            let active = front == Some(item);
            let tab = match item {
                TabItem::File { path } => {
                    let key = view_key(group, item);
                    let language = self.centre_views.get(&key).and_then(|view| view.editor.as_ref()).map_or_else(|| editor::language_name_for_path(Path::new(path)), |editor| editor.read(cx).language_name())
                        .to_string();
                    workbench_api::OpenTab { title: self.tab_label(item).0, path: Some(PathBuf::from(path)), kind: None, id: None, active, dirty: self.dirty_tabs.contains(&key), language: Some(language) }
                }
                TabItem::Resource { kind, id, title } => {
                    workbench_api::OpenTab { title: title.clone(), path: None, kind: Some(kind.clone()), id: Some(id.clone()), active, dirty: false, language: None }
                }
                _ => continue,
            };
            if active {
                tabs.retain(|other| other.path != tab.path || other.kind != tab.kind || other.id != tab.id);
            } else if tabs.iter().any(|other| other.path == tab.path && other.kind == tab.kind && other.id == tab.id) {
                continue;
            }
            tabs.push(tab);
        }
        workbench_api::set_open_tabs(cx, tabs);
    }

    /// Takes what views inside the workbench asked to open.
    pub(crate) fn handle_open_requests(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // Requests go to the window in front.
        if crate::windows::front_window(cx).is_some_and(|front| front != window.window_handle().window_id()) {
            return;
        }
        for request in workbench_api::take(cx) {
            match request {
                workbench_api::OpenRequest::File { path, line, column } => self.open_file_at(path, line, column, cx),
                workbench_api::OpenRequest::FileSelection { path, range } => {
                    self.pending_file_selections.insert(path.to_string_lossy().into_owned(), range);
                    self.open_file_at(path, None, None, cx);
                }
                workbench_api::OpenRequest::Resource { kind, id, .. } if kind == ui::WORKTREE_KIND => self.open_project_path(PathBuf::from(id), cx),
                workbench_api::OpenRequest::Resource { kind, id, title } => {
                    self.update_state(cx, |state| state.open_resource(&kind, &id, &title))
                }
                workbench_api::OpenRequest::RenameResource { kind, id, title } => {
                    self.update_state(cx, |state| state.rename_resource(&kind, &id, &title))
                }
                workbench_api::OpenRequest::Session { id } => self.open_session(SessionId(id), window, cx),
                workbench_api::OpenRequest::Settings { page, query } => self.open_settings_at(page.as_deref(), query.as_deref(), window, cx),
                workbench_api::OpenRequest::Terminal { command, cwd } => self.open_terminal(Some(command), cwd, false, window, cx),
                workbench_api::OpenRequest::Project { path } => self.open_project_path(PathBuf::from(path), cx),
                workbench_api::OpenRequest::ProjectInNewWindow { path } => self.open_folder_in_new_window(PathBuf::from(path), cx),
                workbench_api::OpenRequest::RemoteConnection { id } => self.open_remote_connection(&id, None, window, cx),
                workbench_api::OpenRequest::AddRemoteConnection => self.show_remote_form(window, cx),
                workbench_api::OpenRequest::CloudRunSession { run_id } => self.open_cloud_run_session(&run_id, window, cx),
                workbench_api::OpenRequest::SessionLink { session, url } => self.route_session_link(&session, &url, window, cx),
                workbench_api::OpenRequest::ClearChatHistory => self.update_state(cx, |state| state.clear_sessions()),
                workbench_api::OpenRequest::ProviderApiKey { provider } => {
                    let dialog = cx.new(|cx| agent_ui::provider_key_dialog::ProviderKeyDialog::new(provider.as_deref(), window, cx));
                    self.open_modal(dialog, window, cx);
                }
                workbench_api::OpenRequest::ImportRecentProjects(projects) => {
                    let imports = projects
                        .into_iter()
                        .map(|project| workspace::RecentImport {
                            path: project.path,
                            source_id: Some(project.source_id),
                            source_name: Some(project.source_name),
                        })
                        .collect();
                    self.update_state(cx, |state| {
                        state.import_recent_projects(imports);
                    });
                }
            }
        }
    }

    /// Lets go of the dock tools (its shell, browser page, changes) of a session whose last tab
    /// closed, unless it is out in its own window (the session panel's cleanup when its tab goes,
    /// `session-panel-resources.ts`). The pane choice is kept while the session exists.
    fn release_closed_session_tools(&mut self, cx: &gpui::App) {
        if self.session_panes.is_empty() {
            return;
        }
        let shown = shown_sessions(&self.state);
        let existing: std::collections::HashSet<&str> = self.state.sessions.iter().map(|session| session.id.0.as_str()).collect();
        let keep = |id: &String| shown.contains(id) || crate::detached::session_is_detached(id, cx);
        for (id, panes) in self.session_panes.iter_mut() {
            if panes.holds_tools() && !keep(id) {
                panes.release_tools();
            }
        }
        self.session_panes.retain(|id, _| existing.contains(id.as_str()));
    }

    /// Creates the view of the tab in front, and drops the views no tab shows any more. Agent
    /// sessions keep their view while the session exists, so a running agent keeps running.
    /// A file tab that moved to another split group (drag, Close Split, Move to group) keeps
    /// its editor: the view and its unsaved mark go to the new group's key instead of the editor
    /// being dropped with its edits and the file read again from disk.
    fn rehome_file_views(&mut self, open: &std::collections::HashSet<String>) {
        let orphans: Vec<String> = self.centre_views.keys().filter(|key| !open.contains(*key) && key.starts_with('g') && self.centre_views[*key].editor.is_some()).cloned().collect();
        for old in orphans {
            let Some((_, rest)) = old.split_once(':') else { continue };
            let target = open.iter().find(|key| key.starts_with('g') && key.split_once(':').is_some_and(|(_, other)| other == rest) && !self.centre_views.contains_key(*key)).cloned();
            if let Some(new) = target
                && let Some(view) = self.centre_views.remove(&old)
            {
                self.centre_views.insert(new.clone(), view);
                if self.dirty_tabs.remove(&old) {
                    self.dirty_tabs.insert(new);
                }
            }
        }
    }

    pub(crate) fn sync_centre_views(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let open: std::collections::HashSet<String> =
            self.state.all_group_tabs().map(|(group, item)| view_key(group, item)).collect();
        let sessions: std::collections::HashSet<String> =
            self.state.sessions.iter().map(|session| format!("session:{}", session.id.0)).collect();
        self.capture_editor_views(cx);
        self.rehome_file_views(&open);
        self.centre_views.retain(|key, _| open.contains(key) || sessions.contains(key));
        let live: std::collections::HashSet<gpui::EntityId> = self.centre_views.values().filter_map(|view| view.editor.as_ref().map(|editor| editor.entity_id())).collect();
        self.lsp_subscriptions.retain(|(editor, _)| live.contains(editor));
        self.dirty_tabs.retain(|key| open.contains(key));
        self.release_closed_session_tools(cx);

        let bottom_shown = self.state.layout.bottom_pane_visible && self.state.layout.bottom_tab == workspace::BottomTab::Buffers;
        let groups: Vec<workspace::PaneGroup> = self
            .state
            .centre_panes()
            .into_iter()
            .chain(bottom_shown.then_some(&self.state.bottom))
            .flat_map(|panes| panes.groups.iter().cloned())
            .collect();
        let focused_group = self.state.focused_panes().map(|panes| panes.active);
        // A session shown in its own window has a stand-in here, and its view again once back.
        for group in &groups {
            if let Some(item @ TabItem::Session { id }) = group.tabs.active_item() {
                let key = view_key(group.id, item);
                let detached = crate::detached::session_is_detached(&id.0, cx);
                let stand_in = self.centre_views.get(&key).map(|view| view.view.clone().downcast::<crate::detached::DetachedSessionPlaceholder>().is_ok());
                if stand_in.is_some_and(|stand_in| stand_in != detached) {
                    self.centre_views.remove(&key);
                }
            }
        }
        // A file asked for at a line: once its editor exists, move there.
        for group in &groups {
            if let Some(TabItem::File { path }) = group.tabs.active_item()
                && let Some((line, column)) = self.pending_lines.get(path).copied()
                && let Some(editor) = self.centre_views.get(&view_key(group.id, &TabItem::File { path: path.clone() })).and_then(|view| view.editor.clone())
            {
                self.pending_lines.remove(path);
                editor.update(cx, |editor, cx| editor.go_to_line(line as usize, column.map(|column| column as usize), cx));
            }
            if let Some(TabItem::File { path }) = group.tabs.active_item()
                && self.pending_file_selections.contains_key(path)
                && let Some(editor) = self.centre_views.get(&view_key(group.id, &TabItem::File { path: path.clone() })).and_then(|view| view.editor.clone())
                && let Some(range) = self.pending_file_selections.remove(path)
            {
                editor.update(cx, |editor, cx| editor.select_text_range(range, cx));
            }
        }
        for group in &groups {
            let Some(item) = group.tabs.active_item().cloned() else { continue };
            let key = view_key(group.id, &item);
            if self.centre_views.contains_key(&key) {
                continue;
            }
            if let Some(view) = self.build_centre_view(&item, &key, window, cx) {
                if let TabItem::File { path } = &item
                    && !self.pending_lines.contains_key(path)
                    && !self.pending_file_selections.contains_key(path)
                    && let Some(editor) = &view.editor
                    && let Some(saved) = self.state.editor_views.get(path).copied()
                {
                    editor.update(cx, |editor, cx| editor.restore_view_state(saved.cursor, saved.scroll, cx));
                }
                if Some(group.id) == focused_group
                    && let Some(focus) = &view.focus
                {
                    window.focus(focus, cx);
                }
                self.centre_views.insert(key, view);
            }
        }
    }

    /// Records where each open file's caret and scroll are, so the file reopens there.
    pub(crate) fn capture_editor_views(&mut self, cx: &gpui::App) {
        for view in self.centre_views.values() {
            let Some(editor) = &view.editor else { continue };
            let editor = editor.read(cx);
            if editor.is_untitled() {
                continue;
            }
            if let Some((cursor, scroll)) = editor.view_state() {
                let path = editor.path().to_string_lossy().into_owned();
                self.state.remember_editor_view(&path, cursor, scroll);
            }
        }
    }

    /// A new session set to run in the cloud, with the agent in front when it can run there
    /// (`ai.openCloudAgents`, `openNewCloudAgentChat`).
    pub(crate) fn start_cloud_session(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let agent = self
            .state
            .focused_session()
            .map(|session| session.agent.clone())
            .filter(|agent| agent_ui::cloud::session::cloud_agent(agent).is_some())
            .unwrap_or_else(|| crate::DEFAULT_AGENT.to_string());
        let project = self.state.active_project.clone();
        let mut id = None;
        self.update_state(cx, |state| id = Some(state.new_session(project, &agent)));
        let Some(id) = id else { return };
        let Some(view) = self.ensure_session_view(&id, window, cx) else { return };
        view.update(cx, |session, cx| session.start_in_cloud(cx));
        self.open_session(id, window, cx);
    }

    /// A cloud run started elsewhere, as a session: the open one following it, or a new one in
    /// the project whose repository it ran on (`openCloudRunSession`).
    pub(crate) fn open_cloud_run_session(&mut self, run_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let existing = self.state.sessions.iter().map(|session| session.id.clone()).find(|id| {
            self.centre_views
                .get(&tab_key(&TabItem::Session { id: id.clone() }))
                .and_then(|view| view.session.as_ref())
                .is_some_and(|view| view.read(cx).follows_cloud_run(run_id))
        });
        let run = agent_ui::cloud::session::take_pending_run(run_id, cx);
        if let Some(id) = existing {
            self.open_session(id, window, cx);
            return;
        }
        let Some(run) = run else { return };
        let project = self
            .state
            .projects
            .iter()
            .find(|project| {
                agent_ui::chat_link::project_repository(std::path::Path::new(&project.path)).is_some_and(|(owner, name)| format!("{owner}/{name}").eq_ignore_ascii_case(&run.repo))
            })
            .map(|project| project.id.clone());
        let agent = agent_ui::cloud::session::session_agent(&run.agent);
        let mut id = None;
        self.update_state(cx, |state| id = Some(state.new_session(project, agent)));
        let Some(id) = id else { return };
        let Some(view) = self.ensure_session_view(&id, window, cx) else { return };
        view.update(cx, |session, cx| session.adopt_cloud_run(run, cx));
        self.open_session(id, window, cx);
    }

    /// Follows the pull requests of sessions with no view open, every minute, so the sidebar
    /// shows them opened and merged (`use-session-pull-request.ts`).
    pub(crate) fn watch_closed_pull_requests(cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(std::time::Duration::from_secs(60)).await;
                let Ok(poll) = this.update(cx, |this, cx| {
                    let sessions = this
                        .state
                        .sessions
                        .iter()
                        .filter(|session| session.archived_at.is_none())
                        .filter(|session| !this.centre_views.get(&tab_key(&TabItem::Session { id: session.id.clone() })).is_some_and(|view| view.session.is_some()))
                        .filter_map(|session| {
                            Some(agent_ui::pull_request::ClosedSession {
                                id: session.id.0.clone(),
                                repo: PathBuf::from(session.workspace_path.clone()?),
                                branch: session.branch.clone(),
                                status: session.status,
                            })
                        })
                        .collect();
                    agent_ui::pull_request::poll_closed_sessions(sessions, cx)
                }) else {
                    return;
                };
                let Some(poll) = poll else { continue };
                let changed = poll.await;
                if changed.is_empty() {
                    continue;
                }
                let alive = this.update(cx, |this, cx| {
                    this.update_state(cx, |state| {
                        for (id, status) in changed {
                            state.set_session_status(&SessionId(id), status);
                        }
                    });
                });
                if alive.is_err() {
                    return;
                }
            }
        })
        .detach();
    }

    /// The view of a session, made now if it has not been in front yet.
    pub(crate) fn ensure_session_view(&mut self, id: &SessionId, window: &mut Window, cx: &mut Context<Self>) -> Option<gpui::Entity<SessionView>> {
        let item = TabItem::Session { id: id.clone() };
        let key = tab_key(&item);
        if let Some(session) = self.centre_views.get(&key).and_then(|view| view.session.clone()) {
            return Some(session);
        }
        let view = self.build_centre_view(&item, &key, window, cx)?;
        let session = view.session.clone();
        self.centre_views.insert(key, view);
        session
    }

    /// Attaches a skill to the session in front, or the project's latest one, and shows it.
    pub(crate) fn use_skill(&mut self, skill: &agent_ui::skills::Skill, window: &mut Window, cx: &mut Context<Self>) {
        let session = self.state.focused_session().map(|session| session.id.clone()).or_else(|| {
            let project = self.state.active_project.clone();
            self.state
                .sessions
                .iter()
                .filter(|session| session.archived_at.is_none() && session.project == project)
                .max_by_key(|session| session.last_activity_at)
                .map(|session| session.id.clone())
        });
        let Some(id) = session else {
            notifications::info(cx, "Start an agent session to use a skill");
            return;
        };
        let Some(view) = self.ensure_session_view(&id, window, cx) else { return };
        view.update(cx, |session, cx| session.attach_skill(skill, cx));
        self.open_session(id, window, cx);
        window.focus(&view.focus_handle(cx), cx);
    }

    /// A continuous agent is due: start a session of its agent in its project, in the background,
    /// and send it the goal.
    pub(crate) fn launch_continuous(&mut self, event: &agent_ui::cloud::ContinuousEvent, window: &mut Window, cx: &mut Context<Self>) {
        let agent_ui::cloud::ContinuousEvent::Launch { task, prompt } = event;
        let path = task.workspace_path.to_string_lossy().into_owned();
        let project = self.state.projects.iter().find(|project| std::path::Path::new(&project.path) == task.workspace_path).map(|project| project.id.clone());
        let Some(project) = project else {
            agent_ui::cloud::ContinuousAgents::global(cx).update(cx, |agents, cx| agents.pause(&task.id, &format!("{path} is not open"), cx));
            return;
        };
        let (focus, active) = (self.state.focus.clone(), self.state.active_project.clone());
        let mut id = None;
        self.update_state(cx, |state| {
            let session = state.new_session(Some(project), &task.agent_id);
            state.rename_session(&session, &task.name);
            state.focus = focus;
            state.active_project = active;
            id = Some(session);
        });
        let Some(id) = id else { return };
        let Some(view) = self.ensure_session_view(&id, window, cx) else { return };
        view.update(cx, |session, cx| session.send(prompt.clone(), cx));
        agent_ui::cloud::ContinuousAgents::global(cx).update(cx, |agents, cx| agents.attach_session(&task.id, &id.0, cx));
    }

    fn build_centre_view(&mut self, item: &TabItem, key: &str, window: &mut Window, cx: &mut Context<Self>) -> Option<CentreView> {
        let project_root = self.state.active_project().map(|project| PathBuf::from(&project.path));
        let key = key.to_string();
        let view = match item {
            TabItem::File { path } => {
                let path = PathBuf::from(path);
                let backend = crate::remote_projects::file_backend(&path);
                if backend.is_none() && database_view::is_database_file(&path) {
                    let connection = Some(path.to_string_lossy().into_owned());
                    let database = cx.new(|cx| DatabaseView::new(connection, window, cx));
                    CentreView { focus: Some(database.focus_handle(cx)), view: database.into(), _subscription: None, editor: None, session: None }
                } else if viewer::can_view(&path) && backend.is_none() {
                    let viewer = cx.new(|cx| FileViewer::open(path, window, cx));
                    CentreView { focus: Some(viewer.focus_handle(cx)), view: viewer.into(), _subscription: None, editor: None, session: None }
                } else if backend.is_none()
                    && !editor::is_snapshot(&path)
                    && let Some(command) = editor::external_editor_command(settings::get(cx), &path, project_root.as_deref())
                {
                    // `externalEditor`: the file opens in a terminal tab running that editor, which
                    // closes when the editor exits.
                    let file = path.to_string_lossy().into_owned();
                    let title = path.file_name().map_or_else(|| file.clone(), |name| name.to_string_lossy().into_owned());
                    let command = if cfg!(windows) { command } else { format!("exec {command}") };
                    cx.defer_in(window, move |this, _, cx| {
                        this.update_state(cx, |state| state.close_file(&file));
                        this.open_terminal_tab(PendingTerminal::Command { command, cwd: project_root }, &title, cx);
                    });
                    return None;
                } else {
                    let saved_path = path.clone();
                    let root = project_root.clone();
                    if let Some(root) = root.clone() {
                        dap::BreakpointStore::global(cx).update(cx, |store, cx| store.load_project(&root, cx));
                    }
                    let editor = cx.new(|cx| {
                        let mut editor = match backend {
                            Some(backend) => Editor::open_with(path, backend, window, cx),
                            None => Editor::open(path, window, cx),
                        };
                        editor.set_project_root(root, cx);
                        editor
                    });
                    extensions_ui::prompt_install_for_path(&saved_path, cx);
                    let lsp_subscription = cx.subscribe_in(&editor, window, |this, _, event: &editor::LspEvent, window, cx| match event {
                        editor::LspEvent::OpenLocation { path, line, column } => {
                            this.open_file_at(path.clone(), Some(*line as u32), Some(*column as u32), cx)
                        }
                        editor::LspEvent::References { title, locations } => {
                            let references = this.ensure_references(window, cx);
                            references.update(cx, |view, cx| view.set_references(title.clone(), locations.clone(), cx));
                            this.update_state(cx, |state| state.open_resource("references", "", "References"));
                        }
                        editor::LspEvent::FindingReferences { title } => {
                            let references = this.ensure_references(window, cx);
                            references.update(cx, |view, cx| view.set_finding(title.clone(), cx));
                            this.update_state(cx, |state| state.open_resource("references", "", "References"));
                        }
                        #[allow(unreachable_patterns)]
                        _ => {}
                    });
                    self.lsp_subscriptions.push((editor.entity_id(), lsp_subscription));
                    // Every edit bumps `workbench_api::BufferEdits`, so views that follow the file
                    // (an attached tab) hear of it without polling.
                    let seen = std::cell::Cell::new(None::<usize>);
                    let editor_id = editor.entity_id();
                    self.lsp_subscriptions.push((editor_id, cx.observe(&editor, move |this, editor, cx| {
                        let (version, path) = {
                            let editor = editor.read(cx);
                            (editor.buffer_version(), editor.path().to_path_buf())
                        };
                        if seen.replace(Some(version)).is_some_and(|before| before != version) {
                            workbench_api::BufferEdits::changed(&path, cx);
                            this.mirror_to_copies(&editor, false, cx);
                        }
                    })));
                    let subscription = cx.subscribe(&editor, move |this, editor, event: &EditorEvent, cx| {
                        // The view's key now: a tab moved to another split group keeps its editor
                        // under that group's key (`rehome_file_views`).
                        let key = this
                            .centre_views
                            .iter()
                            .find(|(_, view)| view.editor.as_ref().is_some_and(|known| known.entity_id() == editor.entity_id()))
                            .map(|(key, _)| key.clone())
                            .unwrap_or_else(|| key.clone());
                        match event {
                            EditorEvent::DirtyChanged(true) => {
                                this.dirty_tabs.insert(key.clone());
                                this.publish_projects(cx);
                            }
                            EditorEvent::DirtyChanged(false) => {
                                this.dirty_tabs.remove(&key);
                                this.publish_projects(cx);
                            }
                            EditorEvent::Saved => {
                                this.dirty_tabs.remove(&key);
                                this.mirror_to_copies(&editor, true, cx);
                                this.publish_projects(cx);
                                this.record_local_history(&saved_path, cx);
                            }
                            EditorEvent::PathChanged { old, new } => {
                                this.dirty_tabs.remove(&key);
                                let (old, new) = (old.to_string_lossy().to_string(), new.to_string_lossy().to_string());
                                this.update_state(cx, |state| state.rename_file(&old, &new));
                            }
                            EditorEvent::CloseRequested { force } => {
                                if *force || !this.dirty_tabs.contains(&key) {
                                    this.dirty_tabs.remove(&key);
                                    // Only this view's tab (vim `:q`): copies of the file in other
                                    // groups or projects may hold edits of their own.
                                    let tab = this
                                        .state
                                        .all_group_tabs()
                                        .find(|(group, item)| view_key(*group, item) == key)
                                        .map(|(group, item)| (group, item.clone()));
                                    match tab {
                                        Some((group, item)) => this.update_state(cx, |state| {
                                            state.focus_group(group);
                                            if let Some(index) = state.focused_tabs().and_then(|tabs| tabs.tabs.iter().position(|tab| *tab == item)) {
                                                state.close_tab(index);
                                            }
                                        }),
                                        None => {
                                            let path = saved_path.to_string_lossy().to_string();
                                            this.update_state(cx, |state| state.close_file(&path));
                                        }
                                    }
                                }
                            }
                            #[allow(unreachable_patterns)]
                            _ => {}
                        }
                        cx.notify();
                    });
                    CentreView { focus: Some(editor.focus_handle(cx)), editor: Some(editor.clone()), view: editor.into(), _subscription: Some(subscription), session: None }
                }
            }
            TabItem::Session { id } if crate::detached::session_is_detached(&id.0, cx) => {
                let workbench = cx.weak_entity();
                let id = id.clone();
                let placeholder = cx.new(|cx| crate::detached::DetachedSessionPlaceholder::new(id, workbench, cx));
                CentreView { focus: None, editor: None, view: placeholder.into(), _subscription: None, session: None }
            }
            TabItem::Session { id } => {
                let session = self.state.session(id)?.clone();
                let cwd = session
                    .project
                    .as_ref()
                    .and_then(|project| self.state.project(project))
                    .map(|project| PathBuf::from(&project.path))
                    .or_else(|| session.workspace_path.as_ref().map(PathBuf::from));
                let folders: Vec<PathBuf> = session
                    .project
                    .as_ref()
                    .and_then(|project| self.state.project(project))
                    .filter(|project| !project.is_remote())
                    .map(|project| project.folders.iter().map(PathBuf::from).collect())
                    .unwrap_or_default();
                let info = SessionInfo { id: id.0.clone(), title: session.title.clone(), agent: session.agent.clone(), cwd };
                let view = cx.new(|cx| SessionView::new(info, window, cx));
                view.update(cx, |view, _| view.set_workspace_folders(folders));
                // The session's time (second field) waits on agent_ui taking it for replayed prompts.
                if let Some((agent_session, _)) = self.pending_imports.remove(&id.0) {
                    view.update(cx, |view, cx| view.import_agent_session(agent_session, cx));
                }
                if let Some((path, start, end, text)) = self.pending_selections.remove(&id.0) {
                    view.update(cx, |view, cx| view.add_selection(path, start, end, text, window, cx));
                }
                let session_id: SessionId = id.clone();
                let subscription = cx.subscribe_in(&view, window, move |this, _, event: &SessionViewEvent, window, cx| {
                    let id = session_id.clone();
                    match event {
                        SessionViewEvent::DevServer { url, open } => this.session_dev_server(&id.0, url.clone(), *open, window, cx),
                        SessionViewEvent::DevServerStopped(url) => this.session_dev_server_stopped(&id.0, url, cx),
                        SessionViewEvent::OpenBrowser(url) => browser_view::open_browser_tab(url.as_deref(), cx),
                        SessionViewEvent::TitleChanged(title) => {
                            let title = title.clone();
                            this.update_state(cx, |state| state.rename_session(&id, &title));
                        }
                        SessionViewEvent::StatusChanged(status) => {
                            let status = *status;
                            this.update_state(cx, |state| state.set_session_status(&id, status));
                        }
                        SessionViewEvent::Activity => {
                            this.update_state(cx, |state| state.touch_session(&id, now_ms()));
                        }
                        SessionViewEvent::OpenFile(path) => {
                            let path = path.to_string_lossy().into_owned();
                            this.update_state(cx, |state| state.open_file(&path));
                        }
                        SessionViewEvent::FollowAgent { path, line } => {
                            // Only while the session is the tab in front (`canFollowAgent`).
                            let Some(session_group) = this.visible_session_group(&id) else { return };
                            let path = path.to_string_lossy().into_owned();
                            let target = this.follow_target_group(session_group, &path);
                            if let Some(line) = line {
                                this.pending_lines.insert(path.clone(), (*line, None));
                            }
                            // Beside the session, in another pane (split off when there is none);
                            // the session keeps its pane and the keys.
                            this.update_state(cx, |state| {
                                let Some(target) = target.or_else(|| state.split_pane(workspace::SplitAxis::Horizontal)) else { return };
                                state.focus_group(target);
                                state.open_file(&path);
                                state.focus_group(session_group);
                            });
                        }
                    }
                });
                CentreView { focus: Some(view.focus_handle(cx)), session: Some(view.clone()), view: view.into(), _subscription: Some(subscription), editor: None }
            }
            TabItem::Resource { kind, id, .. } => match kind.as_str() {
                "search" => {
                    let roots = self.state.active_project().map(|project| project.roots().into_iter().map(PathBuf::from).collect()).unwrap_or_default();
                    let query = (!id.is_empty() && id != "project").then(|| id.clone());
                    let search = cx.new(|cx| SearchView::new(roots, query, window, cx));
                    if let Some(include) = self.pending_search_include.take() {
                        search.update(cx, |search, cx| search.set_include(include, cx));
                    }
                    let subscription = cx.subscribe(&search, |this, _, event: &SearchEvent, cx| match event {
                        SearchEvent::OpenFile { path, line, column } => this.open_file_at(path.clone(), *line, *column, cx),
                    });
                    CentreView { focus: Some(search.focus_handle(cx)), view: search.into(), _subscription: Some(subscription), editor: None, session: None }
                }
                "database" => {
                    let connection = (!id.is_empty()).then(|| id.clone());
                    let database = cx.new(|cx| DatabaseView::new(connection, window, cx));
                    CentreView { focus: Some(database.focus_handle(cx)), view: database.into(), _subscription: None, editor: None, session: None }
                }
                "problems" => {
                    let view = self.ensure_diagnostics(window, cx)?;
                    CentreView { focus: Some(view.focus_handle(cx)), view: view.into(), _subscription: None, editor: None, session: None }
                }
                "references" => {
                    let view = self.ensure_references(window, cx);
                    CentreView { focus: Some(view.focus_handle(cx)), view: view.into(), _subscription: None, editor: None, session: None }
                }
                "outline" => {
                    let view = self.ensure_outline(window, cx);
                    CentreView { focus: Some(view.focus_handle(cx)), view: view.into(), _subscription: None, editor: None, session: None }
                }
                "history" => {
                    let project = self.state.active_project().filter(|project| !project.is_remote()).map(|project| PathBuf::from(&project.path));
                    let view = cx.new(|cx| {
                        let mut view = agent_ui::HistoryView::new(window, cx);
                        view.set_project(project, cx);
                        view
                    });
                    if let Some(agent) = self.pending_history_agent.take() {
                        view.update(cx, |view, cx| view.set_agent(agent, cx));
                    }
                    let subscription = cx.subscribe_in(&view, window, |this, _, event: &agent_ui::HistoryEvent, window, cx| match event {
                        agent_ui::HistoryEvent::OpenSession(id) => this.open_session(SessionId(id.clone()), window, cx),
                        agent_ui::HistoryEvent::ImportSession(session) => this.import_outside_session(session.clone(), cx),
                    });
                    CentreView { focus: Some(view.focus_handle(cx)), view: view.into(), _subscription: Some(subscription), editor: None, session: None }
                }
                "team" => {
                    let view = cx.new(collaboration::TeamView::new);
                    let subscription = cx.subscribe(&view, |this, _, event: &collaboration::TeamViewEvent, cx| match event {
                        collaboration::TeamViewEvent::OpenSession { share_id, title } => {
                            this.update_state(cx, |state| state.open_resource("team-session", share_id, title))
                        }
                    });
                    CentreView { focus: Some(view.focus_handle(cx)), view: view.into(), _subscription: Some(subscription), editor: None, session: None }
                }
                "team-session" => {
                    let (share_id, title) = (id.clone(), match item {
                        TabItem::Resource { title, .. } => title.clone(),
                        _ => String::new(),
                    });
                    let send = self.pending_team_send.take();
                    let view = cx.new(|cx| collaboration::TeamSessionView::new(share_id, title, send, window, cx));
                    let subscription = cx.subscribe(&view, |this, _, event: &collaboration::TeamSessionEvent, cx| match event {
                        collaboration::TeamSessionEvent::Continue(_) => this.start_session(this.state.active_project.clone(), cx),
                    });
                    CentreView { focus: Some(view.focus_handle(cx)), view: view.into(), _subscription: Some(subscription), editor: None, session: None }
                }
                "terminal" => {
                    let (moved, command, cwd, started) = match self.pending_terminals.remove(id) {
                        Some(PendingTerminal::Moved(moved)) => {
                            let started = moved.started_with();
                            (Some(moved), None, project_root.clone(), Some(started))
                        }
                        Some(PendingTerminal::Command { command, cwd }) => {
                            let cwd = cwd.or(project_root.clone());
                            (None, Some(command.clone()), cwd.clone(), Some((cwd, Some(command))))
                        }
                        Some(PendingTerminal::In(cwd)) => {
                            let cwd = cwd.or(project_root.clone());
                            (None, None, cwd.clone(), Some((cwd, None)))
                        }
                        None => match self.state.terminal_tab(id) {
                            Some(saved) => (None, saved.command.clone(), saved.cwd.clone().map(PathBuf::from).or(project_root.clone()), None),
                            None => (None, None, project_root.clone(), None),
                        },
                    };
                    if let Some((cwd, command)) = started {
                        let cwd = cwd.map(|cwd| cwd.to_string_lossy().into_owned());
                        self.state.remember_terminal_tab(id, workspace::TerminalTab { cwd, command });
                        self.save();
                    }
                    let terminal = cx.new(|cx| terminal_view::TerminalPanel::buffer(cwd, Some(crate::remote_projects::terminal_starter()), moved, command, window, cx));
                    let tab_id = id.clone();
                    let subscription = cx.subscribe(&terminal, move |this, _, event: &terminal_view::TerminalPanelEvent, cx| match event {
                        terminal_view::TerminalPanelEvent::Hide => this.update_state(cx, |state| state.close_resource("terminal", &tab_id)),
                        terminal_view::TerminalPanelEvent::TitleChanged(title) if !title.is_empty() => {
                            this.update_state(cx, |state| state.rename_resource("terminal", &tab_id, title))
                        }
                        _ => {}
                    });
                    CentreView { focus: Some(terminal.focus_handle(cx)), view: terminal.into(), _subscription: Some(subscription), editor: None, session: None }
                }
                "debugger" => {
                    let debugger = self.ensure_debugger(window, cx)?;
                    CentreView { focus: Some(debugger.focus_handle(cx)), view: debugger.into(), _subscription: None, editor: None, session: None }
                }
                "extensions" => {
                    let view = cx.new(|cx| {
                        let mut view = extensions_ui::ExtensionsView::new(window, cx);
                        if !id.is_empty() {
                            view.open_extension(id, cx);
                        }
                        view
                    });
                    let tab_id = id.clone();
                    let subscription = cx.subscribe_in(&view, window, move |this, _, event: &extensions_ui::ExtensionsViewEvent, window, cx| match event {
                        extensions_ui::ExtensionsViewEvent::TitleChanged(title) => {
                            let title = title.to_string();
                            let id = tab_id.clone();
                            this.update_state(cx, |state| state.open_resource("extensions", &id, &title));
                        }
                        extensions_ui::ExtensionsViewEvent::SelectTheme => this.select_theme(&crate::SelectTheme, window, cx),
                        extensions_ui::ExtensionsViewEvent::SelectIconTheme => this.select_icon_theme(&crate::SelectIconTheme, window, cx),
                        #[allow(unreachable_patterns)]
                        _ => {}
                    });
                    CentreView { focus: Some(view.focus_handle(cx)), view: view.into(), _subscription: Some(subscription), editor: None, session: None }
                }
                "docker" => {
                    let docker = cx.new(|cx| DockerView::new(project_root, window, cx));
                    let subscription = cx.subscribe_in(&docker, window, |this, _, event: &docker_view::DockerViewEvent, window, cx| match event {
                        docker_view::DockerViewEvent::RunInTerminal { command, cwd, .. } => this.open_terminal(Some(command.clone()), cwd.clone(), false, window, cx),
                        docker_view::DockerViewEvent::OpenFile(path) => this.open_file_at(path.clone(), None, None, cx),
                        docker_view::DockerViewEvent::DebugSession { name, command } => {
                            if let Some(debugger) = this.ensure_debugger(window, cx) {
                                debugger.update(cx, |debugger, cx| debugger.start_command_session(name.clone(), command.clone(), cx));
                                this.show_debugger_pane(false, window, cx);
                            }
                        }
                    });
                    CentreView { focus: Some(docker.focus_handle(cx)), view: docker.into(), _subscription: Some(subscription), editor: None, session: None }
                }
                agent_ui::skills::RESOURCE_KIND => {
                    // `<project>` or `<project>\u{1f}<skill id>` (`workbench_api::open_skill`).
                    let (project, skill) = match id.split_once(workbench_api::SKILL_ID_SEPARATOR) {
                        Some((project, skill)) => (project, Some(skill)),
                        None => (id.as_str(), None),
                    };
                    let project = (!project.is_empty()).then(|| PathBuf::from(project));
                    let roots = agent_ui::skills::SkillRoots::new(project.clone());
                    let view = cx.new(|cx| agent_ui::skills::SkillsView::new(project, window, cx));
                    if let Some(skill) = skill {
                        let saved = settings::get(cx).ai_skills.clone();
                        let found = agent_ui::skills::load(&saved, &roots, &agent_ui::skills::extension_skills(cx)).into_iter().find(|candidate| candidate.id == skill);
                        if let Some(found) = found {
                            view.update(cx, |view, cx| view.edit(Some(&found), window, cx));
                        }
                    }
                    let subscription = cx.subscribe_in(&view, window, |this, _, event: &agent_ui::skills::SkillsEvent, window, cx| match event {
                        agent_ui::skills::SkillsEvent::Use(skill) => this.use_skill(skill, window, cx),
                    });
                    CentreView { focus: Some(view.focus_handle(cx)), view: view.into(), _subscription: Some(subscription), editor: None, session: None }
                }
                kind if browser_view::RESOURCE_KINDS.contains(&kind) => {
                    let (view, focus) = browser_view::open_resource_with_focus(kind, id, project_root, window, cx)?;
                    CentreView { focus: Some(focus), view, _subscription: None, editor: None, session: None }
                }
                kind if agent_ui::RESOURCE_KINDS.contains(&kind) => {
                    let (view, focus) = agent_ui::open_resource_with_focus(kind, id, window, cx)?;
                    CentreView { focus: Some(focus), view, _subscription: None, editor: None, session: None }
                }
                kind if claude_ide::RESOURCE_KINDS.contains(&kind) => {
                    let (view, focus) = claude_ide::open_resource_with_focus(kind, id, window, cx)?;
                    CentreView { focus: Some(focus), view, _subscription: None, editor: None, session: None }
                }
                kind if git_diff::RESOURCE_KINDS.contains(&kind) => {
                    let (view, focus) = git_diff::open_resource_with_focus(kind, id, project_root?, window, cx)?;
                    CentreView { focus: Some(focus), view, _subscription: None, editor: None, session: None }
                }
                kind if github_panel::RESOURCE_KINDS.contains(&kind) => {
                    let view = github_panel::open_resource(kind, id, project_root?, window, cx)?;
                    CentreView { focus: None, view, _subscription: None, editor: None, session: None }
                }
                _ => return None,
            },
            TabItem::ProjectDashboard { .. } | TabItem::Welcome => return None,
        };
        Some(view)
    }
}

/// Sessions a tab shows, or that are in front: their dock tools stay.
fn shown_sessions(state: &workspace::WorkspaceState) -> std::collections::HashSet<String> {
    let mut shown: std::collections::HashSet<String> = state
        .all_group_tabs()
        .filter_map(|(_, item)| match item {
            TabItem::Session { id } => Some(id.0.clone()),
            _ => None,
        })
        .collect();
    if let Some(session) = state.focused_session() {
        shown.insert(session.id.0.clone());
    }
    shown
}

#[cfg(test)]
mod release_tests {
    use super::shown_sessions;
    use crate::dock::{SessionPane, SessionPanes};

    #[test]
    fn closing_a_session_tab_releases_its_tools() {
        let mut state = workspace::WorkspaceState::default();
        let first = state.new_session(None, "claude-code");
        let second = state.new_session(None, "claude-code");
        state.open_session(&first);
        assert!(shown_sessions(&state).contains(&first.0));
        let index = state.focused_tabs().and_then(|tabs| tabs.tabs.iter().position(|item| matches!(item, workspace::TabItem::Session { id } if *id == first))).expect("session tab");
        state.close_tab(index);
        let shown = shown_sessions(&state);
        assert!(!shown.contains(&first.0), "a closed session's tools are released");
        assert!(shown.contains(&second.0), "switching away keeps a session's tools");
    }

    #[test]
    fn released_panes_keep_the_open_tool() {
        let mut panes = SessionPanes::default();
        panes.active = SessionPane::Terminal;
        panes.server = Some("http://localhost:5173".into());
        panes.release_tools();
        assert!(!panes.holds_tools());
        assert_eq!(panes.active, SessionPane::Terminal);
        assert_eq!(panes.server.as_deref(), Some("http://localhost:5173"));
    }
}
