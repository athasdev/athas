use std::path::PathBuf;

use gpui::{Context, Window, prelude::*};
use palette::{
    CommandEntry, CommandPaletteDelegate, Picker, QuickOpenDelegate, QuickOpenItem, QuickOpenSession, QuickOpenTab,
    ThemePickerDelegate, shortcut_text,
};
use settings_ui::SettingsView;
use ui::IconName;
use workspace::{SessionId, SidebarView};

use crate::*;

impl Workbench {
    /// Whether Settings > Features leaves a tool on (`isAvailable` of the sidebar views).
    pub(crate) fn tool_available(&self, view: SidebarView, cx: &gpui::App) -> bool {
        let Some(features) = cx.try_global::<settings::SettingsStore>().map(|_| &settings::get(cx).core_features) else { return true };
        match view {
            SidebarView::Git => features.git,
            SidebarView::GitHub => features.github,
            _ => true,
        }
    }

    pub(crate) fn show_sidebar_view(&mut self, view: SidebarView, window: &mut Window, cx: &mut Context<Self>) {
        if !self.tool_available(view, cx) {
            return;
        }
        self.leave_extension_view();
        if Self::is_narrow(window) {
            self.sidebar_overlay_open = true;
        }
        self.update_state(cx, |state| {
            state.layout.sidebar_view = view;
            state.layout.sidebar_visible = true;
        });
    }

    /// How the palette words a command that reads the window's state right now (`palette` of
    /// the original's toggles): "View: Hide Sidebar" while it shows.
    fn palette_text(&self, id: &str, cx: &gpui::App) -> Option<(String, String)> {
        let layout = &self.state.layout;
        let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx));
        let pick = |on: bool, shown: (&str, &str), hidden: (&str, &str)| {
            let (label, description) = if on { shown } else { hidden };
            Some((label.to_string(), description.to_string()))
        };
        match id {
            "workbench.toggleSidebar" => pick(layout.sidebar_visible, ("View: Hide Sidebar", "Hide the sidebar panel"), ("View: Show Sidebar", "Show the sidebar panel")),
            "workbench.toggleBottomPane" => pick(layout.bottom_pane_visible, ("View: Hide Bottom Pane", "Hide the bottom pane"), ("View: Show Bottom Pane", "Show the bottom pane")),
            "view.toggleTerminal" => {
                let shown = layout.bottom_pane_visible && layout.bottom_tab == workspace::BottomTab::Terminal;
                Some((if shown { "View: Hide Terminal" } else { "View: Show Terminal" }.into(), "Toggle integrated terminal panel".into()))
            }
            "editor.toggleWordWrap" => pick(settings?.word_wrap, ("Editor: Disable Word Wrap", "Disable line wrapping in editor"), ("Editor: Enable Word Wrap", "Wrap lines that exceed viewport width")),
            "editor.toggleLineNumbers" => pick(settings?.line_numbers, ("Editor: Hide Line Numbers", "Hide line numbers in editor"), ("Editor: Show Line Numbers", "Show line numbers in editor")),
            "view.toggleNativeMenuBar" => pick(settings?.native_menu_bar, ("View: Disable Native Menu Bar", "Use custom menu bar"), ("View: Enable Native Menu Bar", "Use native operating system menu bar")),
            _ => None,
        }
    }

    /// Whether the palette leaves a command out right now (the original commands' `when`).
    fn palette_hides(&self, id: &str, cx: &gpui::App) -> bool {
        let settings = settings::get(cx);
        let front_file = || match self.state.focused_tabs().and_then(|tabs| tabs.active_item()) {
            Some(workspace::TabItem::File { path }) => Some(path.clone()),
            _ => None,
        };
        match id {
            "markdown.togglePreview" => !front_file().is_some_and(|path| {
                let extension = std::path::Path::new(&path).extension().and_then(|extension| extension.to_str()).unwrap_or_default().to_ascii_lowercase();
                matches!(extension.as_str(), "md" | "markdown" | "rmd")
            }),
            "view.toggleNativeMenuBar" => !cfg!(target_family = "wasm"),
            "view.toggleCompactMenuBar" => matches!(self.platform, crate::Platform::Mac),
            "file.close" => self.state.focused_tabs().and_then(|tabs| tabs.active_item()).is_none(),
            "workbench.showOutline" => front_file().is_none(),
            "window.newTerminalWindow" => !settings.core_features.terminal,
            "docker.open" => !settings.core_features.docker,
            id if id.starts_with("vim.enter") => !settings.vim_mode,
            _ => false,
        }
    }

    pub fn command_palette(&mut self, _: &CommandPalette, window: &mut Window, cx: &mut Context<Self>) {
        // Commands the palette's order names come first, so when several ids run one action the
        // listed one is the id kept.
        let mut ids = cx.default_global::<keymap::CommandRegistry>().ids().to_vec();
        ids.sort_by_key(|id| palette::COMMAND_ORDER.iter().position(|ordered| ordered == id).unwrap_or(usize::MAX));
        ids.retain(|id| !self.palette_hides(id, cx));
        let shortcuts = cx
            .try_global::<keymap::ActiveKeymap>()
            .map(|active| keymap::shortcuts_by_command(&active.bindings))
            .unwrap_or_default();
        let mut seen: Vec<Box<dyn gpui::Action>> = Vec::new();
        let mut entries: Vec<CommandEntry> = ids
            .into_iter()
            .filter_map(|id| {
                let action = cx.global::<keymap::CommandRegistry>().action(&id)?;
                // Several command ids can run one action; list it once, unless the palette's
                // order names each (Show Bottom Pane and Show Terminal both open the pane). An
                // action listed twice takes only its own id's shortcut.
                let ordered = palette::COMMAND_ORDER.contains(&id.as_str());
                let shared = seen.iter().any(|other| other.partial_eq(action.as_ref()));
                if shared && !ordered {
                    return None;
                }
                if !shared {
                    seen.push(action.boxed_clone());
                }
                let shared = shared
                    || (ordered
                        && palette::COMMAND_ORDER.iter().filter(|other| **other != id).any(|other| {
                            cx.global::<keymap::CommandRegistry>().action(other).is_some_and(|other| other.partial_eq(action.as_ref()))
                        }));
                let (mut label, category, mut description, icon) = match keymap::command_info(cx, &id) {
                    Some(info) => (
                        info.title.clone(),
                        info.category.clone(),
                        info.description.clone().unwrap_or_default(),
                        info.icon.as_deref().and_then(IconName::from_name).unwrap_or(IconName::Bolt),
                    ),
                    None => {
                        let (label, category, description, icon) = extra_command_info(&id)?;
                        (label.into(), category.into(), description.into(), icon)
                    }
                };
                if let Some((palette_label, palette_description)) = keymap::palette_text(cx, &id).or_else(|| self.palette_text(&id, cx)) {
                    label = palette_label;
                    description = palette_description;
                } else if let Some(palette_label) = palette::palette_label(&id) {
                    label = palette_label.into();
                }
                let label = palette::with_category(&label, &category);
                let shortcut = shortcuts
                    .get(&id)
                    .map(|key| keymap::display_key(key).into())
                    .or_else(|| if shared { None } else { shortcut_text(action.as_ref(), window, cx) });
                Some(CommandEntry {
                    id: id.into(),
                    label: label.into(),
                    category: category.into(),
                    description: description.into(),
                    icon,
                    action,
                    shortcut,
                })
            })
            .collect();
        entries.extend(crate::extension_contributions::palette_entries(cx));
        let settings = settings_ui::palette_setting_entries();
        let delegate = CommandPaletteDelegate::new(entries, cx).with_settings(settings);
        let picker = cx.new(|cx| Picker::new(delegate, window, cx));
        self.open_modal(picker, window, cx);
    }

    pub fn quick_open(&mut self, _: &QuickOpen, window: &mut Window, cx: &mut Context<Self>) {
        let roots: Vec<PathBuf> = self.state.active_project().map(|project| project.roots().into_iter().map(PathBuf::from).collect()).unwrap_or_default();
        let sessions = self
            .state
            .sessions
            .iter()
            .filter(|session| session.archived_at.is_none())
            .map(|session| QuickOpenSession {
                id: session.id.0.clone(),
                title: session.title.clone(),
                project: session.project.as_ref().and_then(|id| self.state.project(id)).map(|project| project.name.clone()),
            })
            .collect();
        let tabs = self.quick_open_tabs();
        let current_agent = self.state.focused_session().map(|session| session.agent.clone());
        let agents = if cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).core_features.ai_chat) {
            agent_ui::agent_registry::new_chat_agents(cx)
                .into_iter()
                .map(|(id, name, description)| palette::QuickOpenAgent { current: current_agent.as_deref() == Some(id.as_str()), id, name, description })
                .collect()
        } else {
            Vec::new()
        };
        let weak = cx.weak_entity();
        let delegate = QuickOpenDelegate::new(roots, sessions, cx, move |item, window, cx| {
            weak.update(cx, |this, cx| match item {
                QuickOpenItem::File(path) => {
                    let path = path.to_string_lossy().into_owned();
                    this.update_state(cx, |state| state.open_file(&path));
                }
                QuickOpenItem::Session(id) => this.open_session(SessionId(id), window, cx),
                QuickOpenItem::Symbol { path, line, column } | QuickOpenItem::Text { path, line, column } => this.open_file_at(path, Some(line), Some(column), cx),
                QuickOpenItem::Tab { group, index } => this.update_state(cx, |state| {
                    state.focus_group(group);
                    state.activate_tab(index);
                }),
                QuickOpenItem::NewSession => window.dispatch_action(Box::new(NewSession), cx),
                QuickOpenItem::NewAgentSession(agent) => {
                    let project = this.state.active_project.clone();
                    let mut id = None;
                    this.update_state(cx, |state| id = Some(state.new_session(project, &agent)));
                    if let Some(id) = id {
                        this.open_session(id, window, cx);
                    }
                }
                QuickOpenItem::GitChange { repo, path, staged } => {
                    let target = if staged { git_diff::DiffTarget::Staged { path } } else { git_diff::DiffTarget::Working { path } };
                    git_diff::open_diff(cx, Some(&repo), &target);
                }
                QuickOpenItem::Branch { repo, name, current } => {
                    if !current {
                        switch_branch(repo, name, cx);
                    }
                }
                QuickOpenItem::Commit { repo, hash, message } => {
                    let short: String = hash.chars().take(7).collect();
                    git_diff::open_commit(cx, Some(&repo), &hash, Some(&format!("{short} {message}")));
                }
                QuickOpenItem::PullRequest { number, title } => this.update_state(cx, |state| state.open_resource("github-pr", &number.to_string(), &title)),
                QuickOpenItem::Issue { number, title } => this.update_state(cx, |state| state.open_resource("github-issue", &number.to_string(), &title)),
            })
            .ok();
        })
        .with_tabs(tabs)
        .with_agents(agents);
        let delegate = match self.state.active_project().map(|project| PathBuf::from(&project.path)) {
            Some(root) => {
                let github_root = root.clone();
                delegate
                    .with_git(move |cx| {
                        let discover = git_discovery(&root);
                        cx.background_spawn(async move { load_quick_open_git(&discover(&root)?) })
                    })
                    .with_github(move |cx| github_panel::quick_open::load(github_root, cx))
            }
            None => delegate,
        };
        let delegate = match self.active_editor().and_then(|editor| {
            let editor = editor.read(cx);
            Some((editor.path().to_path_buf(), editor.request_document_symbols()?))
        }) {
            Some((path, request)) => delegate.with_file_symbols(move |cx| {
                cx.spawn(async move |_| {
                    let Ok(Some(response)) = request.await else { return Vec::new() };
                    let mut symbols = Vec::new();
                    flatten_symbols(outline_panel::symbols_from_response(response), None, &path, &mut symbols);
                    symbols
                })
            }),
            None => delegate,
        };
        let picker = cx.new(|cx| Picker::new(delegate, window, cx));
        self.open_modal(picker, window, cx);
    }

    /// The open tabs of the groups in front, for quick open's Tabs section.
    fn quick_open_tabs(&self) -> Vec<QuickOpenTab> {
        let Some(panes) = self.state.focused_panes() else { return Vec::new() };
        let root = self.state.active_project().map(|project| PathBuf::from(&project.path));
        let mut tabs = Vec::new();
        for group in &panes.groups {
            for (index, item) in group.tabs.tabs.iter().enumerate() {
                let (title, icon) = self.tab_label(item);
                let description = match item {
                    workspace::TabItem::File { path } => {
                        let parent = std::path::Path::new(path).parent().map(PathBuf::from).unwrap_or_default();
                        root.as_deref()
                            .and_then(|root| parent.strip_prefix(root).ok())
                            .map_or_else(|| parent.to_string_lossy().into_owned(), |relative| relative.to_string_lossy().into_owned())
                    }
                    workspace::TabItem::Session { .. } => "Agent".to_string(),
                    workspace::TabItem::Resource { kind, .. } => match kind.as_str() {
                        "browser" => "Browser",
                        "database" => "Database",
                        "git-diff" => "Diff",
                        "github-issue" => "Issue",
                        "github-run" => "Workflow run",
                        "github-pr" | "pull-request" => "Pull request",
                        _ => "",
                    }
                    .to_string(),
                    _ => String::new(),
                };
                tabs.push(QuickOpenTab {
                    group: group.id,
                    index,
                    title,
                    description,
                    icon,
                    dirty: self.dirty_tabs.contains(&centre_views::view_key(group.id, item)),
                    pinned: group.tabs.is_pinned(index),
                    active: group.id == panes.active && group.tabs.active == Some(index),
                    path: match item {
                        workspace::TabItem::File { path } => Some(PathBuf::from(path)),
                        _ => None,
                    },
                });
            }
        }
        tabs
    }

    pub fn open_settings(&mut self, _: &OpenSettings, window: &mut Window, cx: &mut Context<Self>) {
        self.open_settings_page(None, window, cx);
    }

    /// Opens Settings on a page: `general`, `appearance`, `keyboard`, …
    pub fn open_settings_page(&mut self, page: Option<&'static str>, window: &mut Window, cx: &mut Context<Self>) {
        if crate::detached::open_settings_window(page, |_, _, _| {}, cx) {
            return;
        }
        let view = cx.new(|cx| SettingsView::new(page, window, cx));
        self.open_modal(view, window, cx);
    }

    /// Opens Settings on a page, in its own window when there can be one, and runs `then` on it.
    pub fn open_settings_with(
        &mut self,
        page: Option<&'static str>,
        then: impl FnOnce(&mut SettingsView, &mut Window, &mut Context<SettingsView>) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let then = std::rc::Rc::new(std::cell::RefCell::new(Some(then)));
        let in_window = then.clone();
        let opened = crate::detached::open_settings_window(
            page,
            move |view, window, cx| {
                if let Some(then) = in_window.borrow_mut().take() {
                    then(view, window, cx);
                }
            },
            cx,
        );
        if opened {
            return;
        }
        let view = self.open_settings_view(page, window, cx);
        if let Some(then) = then.borrow_mut().take() {
            view.update(cx, |view, cx| then(view, window, cx));
        }
    }

    /// Opens Settings on a page and hands back its view.
    pub fn open_settings_view(&mut self, page: Option<&'static str>, window: &mut Window, cx: &mut Context<Self>) -> gpui::Entity<SettingsView> {
        let view = cx.new(|cx| SettingsView::new(page, window, cx));
        self.open_modal(view.clone(), window, cx);
        view
    }

    /// Opens Settings on a page by its id, searching for `query` when given.
    pub fn open_settings_at(&mut self, page: Option<&str>, query: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let page = page.and_then(settings_ui::known_page);
        let query = query.filter(|query| !query.is_empty()).map(str::to_string);
        let window_query = query.clone();
        if crate::detached::open_settings_window(
            page,
            move |view, window, cx| {
                if let Some(query) = window_query {
                    view.set_query(&query, window, cx);
                }
            },
            cx,
        ) {
            return;
        }
        let query = query.as_deref();
        let view = cx.new(|cx| SettingsView::new(page, window, cx));
        if let Some(query) = query.filter(|query| !query.is_empty()) {
            view.update(cx, |view, cx| view.set_query(query, window, cx));
        }
        self.open_modal(view, window, cx);
    }

    pub fn select_icon_theme(&mut self, _: &SelectIconTheme, window: &mut Window, cx: &mut Context<Self>) {
        let delegate = extensions_ui::IconThemePickerDelegate::new(cx);
        let picker = cx.new(|cx| Picker::new(delegate, window, cx));
        self.open_modal(picker, window, cx);
    }

    pub fn select_theme(&mut self, _: &SelectTheme, window: &mut Window, cx: &mut Context<Self>) {
        let themes = theme::registry(cx).themes().to_vec();
        let workbench = cx.weak_entity();
        let delegate = ThemePickerDelegate::new(themes, cx, |theme, _, cx| {
            let id = theme.id.clone();
            settings::update(cx, |settings| {
                settings.theme = id;
                settings.sync_system_theme = false;
            });
        })
        .on_import(|path, cx| match extensions::import_theme_file(&path, cx) {
            Ok(themes) => {
                let theme = themes.first()?.clone();
                let message = if themes.len() == 1 { format!("Imported {}", theme.name) } else { format!("Imported {} theme variants", themes.len()) };
                notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, message, None, None);
                let id = theme.id.clone();
                settings::update(cx, |settings| {
                    settings.theme = id;
                    settings.sync_system_theme = false;
                });
                Some(theme)
            }
            Err(error) => {
                let details = (!error.details.is_empty()).then(|| error.details.iter().take(4).cloned().collect::<Vec<_>>().join("\n").into());
                notifications::error(cx, error.message, details);
                None
            }
        })
        .on_open_settings(move |window, cx| {
            workbench.update(cx, |workbench, cx| workbench.open_settings_at(Some("appearance"), None, window, cx)).ok();
        })
        // The theme list is a page of the command palette: its back button returns to the commands.
        .on_back(|window, cx| window.dispatch_action(Box::new(crate::CommandPalette), cx));
        let picker = cx.new(|cx| Picker::new(delegate, window, cx));
        self.open_modal(picker, window, cx);
    }
}

/// How to find the repository of a project folder, local or remote.
fn git_discovery(root: &std::path::Path) -> git_panel::Discover {
    crate::remote_projects::git_discovery(root).unwrap_or_else(|| std::sync::Arc::new(git_panel::discover_repository))
}

/// Changed files, branches and the last 50 commits (`useGitSection`).
fn load_quick_open_git(repo: &std::sync::Arc<dyn git_panel::GitRepository>) -> Option<palette::QuickOpenGit> {
    let status = repo.status().ok();
    Some(palette::QuickOpenGit {
        repo: repo.root().to_path_buf(),
        current_branch: status.as_ref().map(|status| status.branch.clone()).filter(|branch| !branch.is_empty()),
        changes: status
            .map(|status| status.files)
            .unwrap_or_default()
            .into_iter()
            .map(|file| palette::QuickOpenGitChange {
                status: match file.status {
                    git_panel::FileStatus::Modified => "M",
                    git_panel::FileStatus::Added => "A",
                    git_panel::FileStatus::Deleted => "D",
                    git_panel::FileStatus::Untracked => "U",
                    git_panel::FileStatus::Renamed => "R",
                },
                path: file.path,
                staged: file.staged,
            })
            .collect(),
        branches: repo.branches().unwrap_or_default(),
        commits: repo
            .log(0, 50)
            .unwrap_or_default()
            .into_iter()
            .map(|commit| palette::QuickOpenCommit { hash: commit.hash, message: commit.summary, author: commit.author, date: commit.date })
            .collect(),
    })
}

/// Switches branch; when changes are in the way, offers to stash them first (`switchBranch`).
fn switch_branch(repo: PathBuf, branch: String, cx: &mut gpui::App) {
    let discover = git_discovery(&repo);
    let checkout = cx.background_spawn({
        let (repo, branch) = (repo.clone(), branch.clone());
        let discover = discover.clone();
        async move { discover(&repo).ok_or_else(|| anyhow::anyhow!("Not a Git repository"))?.checkout(&branch) }
    });
    cx.spawn(async move |cx| {
        let result = checkout.await;
        cx.update(|cx| match result {
            Ok(git_panel::Checkout::Switched) => {
                notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, format!("Switched to {branch}"), None, None);
            }
            Ok(git_panel::Checkout::Blocked(message)) => {
                let action = notifications::NotificationAction::new("Stash Changes", move |_, cx| {
                    let (repo, branch, discover) = (repo.clone(), branch.clone(), discover.clone());
                    let stash = cx.background_spawn({
                        let branch = branch.clone();
                        async move {
                            let git = discover(&repo).ok_or_else(|| anyhow::anyhow!("Not a Git repository"))?;
                            git.stash(Some(&format!("Switching to {branch}")), None)?;
                            git.checkout(&branch)
                        }
                    });
                    cx.spawn(async move |cx| {
                        let result = stash.await;
                        cx.update(|cx| match result {
                            Ok(git_panel::Checkout::Switched) => {
                                notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, "Changes stashed and branch switched", None, None);
                            }
                            Ok(git_panel::Checkout::Blocked(_)) => {
                                notifications::error(cx, "Failed to switch branch after stashing", None);
                            }
                            Err(_) => {
                                notifications::error(cx, "Failed to stash changes", None);
                            }
                        });
                    })
                    .detach();
                });
                notifications::notify_with(
                    cx,
                    notifications::NotificationKind::Warning,
                    notifications::NotificationCategory::Athas,
                    message,
                    None,
                    None,
                    notifications::ToastOptions { action: Some(action), sticky: true, ..Default::default() },
                );
            }
            Err(error) => {
                notifications::error(cx, error.to_string(), None);
            }
        });
    })
    .detach();
}

/// The outline's tree as quick open's flat list, each symbol naming its parent.
fn flatten_symbols(symbols: Vec<outline_panel::Symbol>, container: Option<&str>, path: &std::path::Path, out: &mut Vec<lsp_client::WorkspaceSymbol>) {
    for symbol in symbols {
        out.push(lsp_client::WorkspaceSymbol {
            name: symbol.name.clone(),
            kind: symbol.kind,
            container_name: container.map(str::to_string),
            path: path.to_path_buf(),
            line: symbol.selection.line,
            character: symbol.selection.character,
        });
        flatten_symbols(symbol.children, Some(&symbol.name), path, out);
    }
}
