//! The Athas workbench: one window with the activity bar, the sidebar of projects and sessions,
//! the centre (a session, or a project's classic view) and the dock of session tools.

mod activity_bar;
mod agent_hooks;
mod centre;
mod centre_views;
mod claude_ide_hooks;
#[cfg(not(target_family = "wasm"))]
mod collaboration_hooks;
mod close_guard;
mod command_surface;
mod commands;
mod detached;
mod extension_contributions;
mod menus;
mod agent_commands;
mod more_commands;
mod project_dashboard;
mod navigation;
mod dock;
#[cfg(not(target_family = "wasm"))]
// The session browser's controls wait for the browser tab to take the session's servers.
#[allow(dead_code)]
mod session_browser;
mod folder_picker;
mod git_commands;
mod project_icon;
mod project_picker;
mod remote_projects;
mod sidebar;
mod title;
mod web_chrome;
mod window_menu;
mod windows;

pub use close_guard::CloseIntent;
pub use detached::{
    DetachedContent, DetachedSession, DetachedWindow, NewExtensionsWindow, NewSettingsWindow, NewTerminalWindow, open_detached,
    recall_session, session_is_detached, set_detached_opener,
};
#[cfg(target_family = "wasm")]
pub use remote_projects::{WebBackend, set_web_backend};
pub use project_picker::ProjectPickerStep;
pub use web_chrome::{BranchList, OpenGithubRepository, RepositoryEntry, RepositoryGate, WebChrome, set_web_chrome};
pub use windows::{
    MergeAllWindows, MoveTabToNewWindow, NewWindow, NewWindowRequest, NewWindowTab, ShowAllWindowTabs,
    ShowNextWindowTab, ShowPreviousWindowTab, TABBING_IDENTIFIER, WindowLabel, WindowSetup, WindowTab,
    front_window, open_window, set_window_opener, strip_shown, window_tabs,
};

use std::{cell::Cell, collections::HashMap, path::PathBuf, rc::Rc};

use file_tree::{FileTree, FileTreeEvent};
use git_panel::{GitPanel, GitPanelEvent};
use gpui::{
    Anchor, AnyView, App, Bounds, ClipboardItem, Context, DismissEvent, Entity, EventEmitter,
    FocusHandle, Focusable, MouseButton, MouseMoveEvent, PathPromptOptions, Pixels,
    Point, SharedString, Subscription, Window, WindowAppearance, actions, div, point, prelude::*, px,
};
use terminal_view::{TerminalPanel, TerminalPanelEvent};
use theme::{ActiveTheme, Appearance};
use ui::{MenuEntry, MenuItem, OpenMenu, metrics, typography};
use workspace::{ProjectId, SessionId, SidebarView, StateStore, TabItem, WorkspaceState};

actions!(
    workbench,
    [
        ToggleSidebar,
        ToggleTerminal,
        NewSession,
        OpenProject,
        OpenRemote,
        CloseTab,
        ShowGlobalSearch,
        QuickOpen,
        CommandPalette,
        OpenSettings,
        SelectTheme,
        ShowAgents,
        ShowFiles,
        ShowSourceControl,
        ShowGitHub,
        ToggleMaximize,
        CloseProject,
        NewChat,
        NextTab,
        PreviousTab,
        ToggleDock,
        MinimizeWindow,
        ZoomWindow,
        ToggleFullscreen,
        OpenDatabase,
        NewDatabaseConnection,
        OpenDocker,
        OpenDocs,
        OpenChangelog,
        ReportBug,
        RequestFeature,
        ShowNotifications,
        ClearNotifications,
        ShowRunActions,
        ReopenClosedTab,
        CloseAllTabs,
        ShowLocalHistory,
        SplitRight,
        SplitDown,
        ShowExtensions,
        SelectIconTheme,
        ShowDebugger,
        DebugStart,
        DebugStop,
        DebugRestart,
        ToggleBreakpoint,
        SaveAll,
        ShowProblems,
        ShowOutline,
        ShowSessionHistory,
        NewAthasAgentSession,
        SendFeedback,
        ToggleAccountMenu,
        ShowSkills,
        ShowCloudAgents,
        NewCloudSession,
        Quit,
        ShowProjectPicker,
        NewProject,
        CloseWindow,
        SwitchToTab1,
        SwitchToTab2,
        SwitchToTab3,
        SwitchToTab4,
        SwitchToTab5,
        SwitchToTab6,
        SwitchToTab7,
        SwitchToTab8,
        SwitchToTab9,
    ]
);

/// The agent new sessions start with until agents are configurable.
pub const DEFAULT_AGENT: &str = "claude-code";

/// The Athas command each workbench action implements, by the web workbench's command id, so
/// default bindings, presets and user bindings apply to them.
const COMMANDS: fn(&mut App) = |cx| {
    keymap::register(cx, "workbench.newTab", NewSession);
    keymap::register(cx, "workbench.agentLauncher", NewSession);
    keymap::register(cx, "agent.newChat", NewChat);
    keymap::register(cx, "ai.showAgentSessions", ShowAgents);
    keymap::register(cx, "workbench.toggleSidebar", ToggleSidebar);
    keymap::register(cx, "workbench.toggleTerminal", ToggleTerminal);
    keymap::register(cx, "view.toggleTerminal", ToggleTerminal);
    keymap::register(cx, "workbench.toggleTerminalAlt", ToggleTerminal);
    keymap::register(cx, "ai.toggleSessionPanel", ToggleDock);
    keymap::register(cx, "workbench.showFileExplorer", ShowFiles);
    keymap::register(cx, "view.showFiles", ShowFiles);
    keymap::register(cx, "workbench.showSourceControl", ShowSourceControl);
    keymap::register(cx, "view.showGit", ShowSourceControl);
    keymap::register(cx, "workbench.showGitHub", ShowGitHub);
    keymap::register(cx, "workbench.togglePaneMaximize", ToggleMaximize);
    keymap::register(cx, "workbench.commandPalette", CommandPalette);
    keymap::register(cx, "file.quickOpen", QuickOpen);
    keymap::register(cx, "workbench.showGlobalSearch", ShowGlobalSearch);
    keymap::register(cx, "file.openFolder", OpenProject);
    keymap::register(cx, "file.open", ShowProjectPicker);
    keymap::register(cx, "workbench.closeWindow", CloseWindow);
    keymap::register(cx, "workbench.newWindow", NewWindow);
    keymap::register(cx, "workbench.switchToTab1", SwitchToTab1);
    keymap::register(cx, "workbench.switchToTab2", SwitchToTab2);
    keymap::register(cx, "workbench.switchToTab3", SwitchToTab3);
    keymap::register(cx, "workbench.switchToTab4", SwitchToTab4);
    keymap::register(cx, "workbench.switchToTab5", SwitchToTab5);
    keymap::register(cx, "workbench.switchToTab6", SwitchToTab6);
    keymap::register(cx, "workbench.switchToTab7", SwitchToTab7);
    keymap::register(cx, "workbench.switchToTab8", SwitchToTab8);
    keymap::register(cx, "workbench.switchToTab9", SwitchToTab9);
    keymap::register(cx, "remote.connect", OpenRemote);
    keymap::register(cx, "project.close", CloseProject);
    keymap::register(cx, "file.close", CloseTab);
    keymap::register(cx, "file.reopenClosed", ReopenClosedTab);
    keymap::register(cx, "file.closeAll", CloseAllTabs);
    keymap::register(cx, "file.localHistory", ShowLocalHistory);
    keymap::register(cx, "workbench.toggleDiagnostics", ShowProblems);
    keymap::register(cx, "workbench.showOutline", ShowOutline);
    keymap::register(cx, "ai.searchHistory", ShowSessionHistory);
    keymap::register(cx, "workbench.hostedAgent", NewAthasAgentSession);
    keymap::register(cx, "help.sendProductFeedback", SendFeedback);
    keymap::register(cx, "workbench.showDebugger", ShowDebugger);
    keymap::register(cx, "view.showRunAndDebug", ShowDebugger);
    keymap::register(cx, "debug.start", DebugStart);
    keymap::register(cx, "debug.stop", DebugStop);
    keymap::register(cx, "debug.restart", DebugRestart);
    keymap::register(cx, "debug.toggleBreakpoint", ToggleBreakpoint);
    keymap::register(cx, "file.saveAll", SaveAll);
    keymap::register(cx, "view.showIntegrations", ShowExtensions);
    keymap::register(cx, "ai.openCustomize", ShowExtensions);
    keymap::register(cx, "preferences.iconTheme", SelectIconTheme);
    keymap::register(cx, "workbench.splitEditorRight", SplitRight);
    keymap::register(cx, "workbench.splitEditorDown", SplitDown);
    keymap::register(cx, "workbench.nextTab", NextTab);
    keymap::register(cx, "workbench.nextTabCtrlTab", NextTab);
    keymap::register(cx, "workbench.nextTabAlt", NextTab);
    keymap::register(cx, "workbench.previousTab", PreviousTab);
    keymap::register(cx, "workbench.previousTabCtrlTab", PreviousTab);
    keymap::register(cx, "workbench.previousTabAlt", PreviousTab);
    keymap::register(cx, "workbench.openSettings", OpenSettings);
    keymap::register(cx, "workbench.showThemeSelector", SelectTheme);
    keymap::register(cx, "preferences.colorTheme", SelectTheme);
    keymap::register(cx, "window.minimize", MinimizeWindow);
    keymap::register(cx, "window.minimize.mac", MinimizeWindow);
    keymap::register(cx, "window.maximize", ZoomWindow);
    keymap::register(cx, "window.toggleMaximize", ZoomWindow);
    keymap::register(cx, "window.toggleFullscreen", ToggleFullscreen);
    keymap::register(cx, "window.toggleFullscreenMac", ToggleFullscreen);
    keymap::register(cx, "workbench.showProjectSearch", ShowGlobalSearch);
    keymap::register(cx, "workbench.openGlobalSearchInTab", ShowGlobalSearch);
    keymap::register(cx, "database.connect", OpenDatabase);
    keymap::register(cx, "database.newConnection", NewDatabaseConnection);
    keymap::register(cx, "docker.open", OpenDocker);
    keymap::register(cx, "window.quit", Quit);
    detached::register(cx);
    keymap::register(cx, "workbench.showNotifications", ShowNotifications);
    keymap::register(cx, "run.showActions", ShowRunActions);
    keymap::register(cx, "notifications.clear", ClearNotifications);
    keymap::register(cx, "help.documentation", OpenDocs);
    keymap::register(cx, "help.changelog", OpenChangelog);
    keymap::register(cx, "help.reportBug", ReportBug);
    keymap::register(cx, "ai.reviewPendingAgentChanges", agent_ui::review::ReviewAgentChanges);
    keymap::register(cx, "ai.openSkills", ShowSkills);
    keymap::register(cx, "ai.openCloudAgents", NewCloudSession);
    keymap::register(cx, "ai.openContinuousAgents", ShowCloudAgents);
    keymap::register(cx, "editor.inlineEdit", editor::InlineEdit);
};

/// Titles for commands of this build that the web workbench does not have.
pub(crate) fn extra_command_info(id: &str) -> Option<(&'static str, &'static str, &'static str, ui::IconName)> {
    match id {
        "agent.newChat" => Some(("New Chat", "Agent", "Start a chat outside any project", ui::IconName::ChatBubbleText)),
        "workbench.togglePaneMaximize" => Some(("Toggle Maximized Pane", "View", "Give the editor area the whole window", ui::IconName::ArrowsOut)),
        "remote.connect" => Some(("Open Remote…", "File", "Open a folder on a server over SSH", ui::IconName::Remote)),
        "project.close" => Some(("Close Project", "File", "Close the project in front", ui::IconName::X)),
        "workbench.closeWindow" => Some(("Close Window", "Workbench", "Close this window", ui::IconName::X)),
        "cli.uninstallTerminalCommand" => Some(("CLI: Uninstall Terminal Command", "CLI", "Remove the athas command from your PATH", ui::IconName::TerminalWindow)),
        "app.checkForUpdates" => Some(("Check for Updates", "Application", "Look for a newer Athas", ui::IconName::Download)),
        "app.downloadUpdate" => Some(("Download Update", "Application", "Download the update a check found", ui::IconName::Download)),
        "app.viewReleaseNotes" => Some(("View Release Notes", "Application", "What changed in the latest release", ui::IconName::Megaphone)),
        "ai.searchHistory" => Some(("Search Session History", "Agent", "Find a past agent session", ui::IconName::History)),
        "run.showActions" => Some(("Run Script or Task", "Run", "Run one of the project's scripts in a terminal", ui::IconName::Play)),
        "notifications.clear" => Some(("Clear Notifications", "View", "Forget every notification", ui::IconName::Trash)),
        "help.documentation" => Some(("Documentation", "Help", "Open the Athas documentation", ui::IconName::BookOpen)),
        "help.changelog" => Some(("Changelog", "Help", "What changed in each release", ui::IconName::Megaphone)),
        "help.reportBug" => Some(("Report a Bug", "Help", "Open a bug report on GitHub", ui::IconName::Bug)),
        _ => None,
    }
}

/// Where browser tabs report their frames.
fn browser_frame_tracker() -> Option<impl IntoElement> {
    Some(browser_view::frame_tracker())
}

/// Registers the workbench's commands and binds the keys the settings ask for.
pub fn init(cx: &mut App) {
    cx.set_global(onboarding::AppearanceChoices(settings_ui::theme_choices));
    agent_ui::init(cx);
    browser_view::init(cx);
    #[cfg(not(target_arch = "wasm32"))]
    wsl::init(cx);
    #[cfg(not(target_family = "wasm"))]
    crate::remote_projects::register_remote_search();
    terminal_view::init(cx);
    editor::init(cx);
    agent_hooks::init(cx);
    extension_contributions::init(cx);
    claude_ide_hooks::init(cx);
    COMMANDS(cx);
    more_commands::register(cx);
    agent_commands::register(cx);
    git_commands::register(cx);
    git_diff::avatar::set_account_lookup(cx, |cx| {
        let store = account::AccountStore::global(cx)?;
        let user = store.read(cx).user()?.clone();
        Some(git_diff::avatar::AuthorAccount { email: user.email, avatar_url: user.avatar_url, github_username: user.github_username })
    });
    editor::set_author_avatar_lookup(cx, git_diff::avatar::author_avatar);
    remote_projects::init(cx);
    lsp_client::init(cx);
    palette::init(cx);
    file_tree::on_watched_changes(cx, |root, changes, cx| {
        palette::index_files_changed(root, &changes.paths, changes.rescan, cx);
        search_panel::index_files_changed(root, &changes.paths, changes.rescan, cx);
    });
    cx.on_action(|_: &Quit, cx| cx.quit());
    menus::init(cx);
    reload_keymap(cx);
    // The keybinding editor rewrote `keymap.json`: bind the keys again.
    cx.observe_global::<keymap::UserKeymapRevision>(reload_keymap).detach();
}

/// Binds every key again: the shared controls' keys, then the commands' keys in effect for the
/// keybinding preset and the user's own bindings.
pub fn reload_keymap(cx: &mut App) {
    cx.clear_key_bindings();
    ui::init(cx);
    palette::init(cx);
    ui::rebind_all(cx);
    let preset = cx
        .try_global::<settings::SettingsStore>()
        .map(|_| settings::get(cx).keybinding_preset.clone())
        .unwrap_or_else(|| "none".into());
    #[cfg(not(target_family = "wasm"))]
    let user = keymap::load_user_bindings(keymap::user_bindings_path().as_ref());
    #[cfg(target_family = "wasm")]
    let user = Vec::new();
    keymap::bind(cx, &preset, &user);
}

/// Applies the theme the settings ask for: the light or dark one of the system's appearance
/// while syncing with the system, otherwise the chosen theme.
pub fn apply_theme(appearance: Appearance, cx: &mut App) {
    sync_glass(cx);
    let settings = settings::get(cx);
    let id = if settings.sync_system_theme {
        match appearance {
            Appearance::Dark => settings.auto_theme_dark.clone(),
            Appearance::Light => settings.auto_theme_light.clone(),
        }
    } else {
        settings.theme.clone()
    };
    let accent = settings.system_accent_color && cfg!(target_os = "macos");
    // The accent follows the picked theme's appearance, so it is built for that one.
    let target = theme::registry(cx).get(&id).map_or(appearance, |theme| theme.appearance);
    // Includes the themes installed extensions contribute.
    extensions::init_theme(cx, Some(&id), target, accent);
}

/// Window transparency as the settings and the system ask for it (`syncEffectiveWindowTransparency`):
/// the Glass setting, unless the system reduces transparency, on macOS and Windows.
pub fn sync_glass(cx: &mut App) -> bool {
    let requested = cx.try_global::<settings::SettingsStore>().is_some_and(|_| settings::get(cx).window_transparency);
    let platform = matches!(Platform::current(), Platform::Mac | Platform::Windows);
    let on = requested && platform && !theme::accessibility(cx).reduce_transparency;
    theme::set_glass(cx, on)
}

/// The window's material: the desktop blurred through it with glass on, else opaque.
pub fn background_appearance(cx: &App) -> gpui::WindowBackgroundAppearance {
    if theme::glass(cx) { gpui::WindowBackgroundAppearance::Blurred } else { gpui::WindowBackgroundAppearance::Opaque }
}

/// `uiFontFamily` and `uiFontSize` for views that read `typography::ui`.
pub fn apply_ui_typography(cx: &mut App) {
    let Some(settings) = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx)) else { return };
    let family = settings.ui_font_family.trim();
    let ui = typography::UiTypography {
        family: if family.is_empty() { typography::UI_FONT.into() } else { SharedString::from(family.to_string()) },
        size: settings.ui_font_size.clamp(10., 24.) as f32,
    };
    typography::set_ui(cx, ui);
}

/// Follows the window's light or dark appearance with the Athas theme.
pub fn appearance_of(appearance: WindowAppearance) -> Appearance {
    match appearance {
        WindowAppearance::Dark | WindowAppearance::VibrantDark => Appearance::Dark,
        WindowAppearance::Light | WindowAppearance::VibrantLight => Appearance::Light,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Mac,
    Windows,
    Linux,
    Web,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_family = "wasm") {
            Platform::Web
        } else if cfg!(target_os = "macos") {
            Platform::Mac
        } else if cfg!(target_os = "windows") {
            Platform::Windows
        } else {
            Platform::Linux
        }
    }

    /// The window controls share the top row of panes (the macOS traffic lights).
    pub fn has_traffic_lights(self) -> bool {
        self == Platform::Mac
    }

    pub fn shortcut(self, mac: &'static str, other: &'static str) -> &'static str {
        if matches!(self, Platform::Mac | Platform::Web) { mac } else { other }
    }
}

const INBOX_MIN_WIDTH: f32 = 260.;
const INBOX_MAX_WIDTH: f32 = 560.;

#[derive(Clone, Copy, PartialEq)]
enum Drag {
    Sidebar { start_x: Pixels, start_width: f32 },
    Inbox { start_x: Pixels, start_width: f32 },
    BottomPane { start_y: Pixels, start_height: f32 },
    Split { split: u64, horizontal: bool, start: Pixels, start_ratio: f32 },
}

pub struct Workbench {
    state: WorkspaceState,
    store: Option<Rc<dyn StateStore>>,
    focus_handle: FocusHandle,
    /// Held by the sidebar while it, or a view in it, has focus: its active row then reads
    /// `selected-emphasized` (`group-focus-within/sidebar-panel`).
    pub(crate) sidebar_focus: FocusHandle,
    platform: Platform,
    open_menu: Option<OpenMenu>,
    drag: Option<Drag>,
    should_move_window: bool,
    /// Whether the sidebar floats over the centre (narrow windows).
    sidebar_overlay_open: bool,
    /// The project overview lists every session, not only the newest few.
    pub(crate) dashboard_all_sessions: bool,
    /// Where the floating title controls end, so a header under them makes room.
    title_leading_end: Rc<Cell<Pixels>>,
    centre_maximized: bool,
    /// Switch between the light and dark theme with the system.
    pub follow_system_appearance: bool,
    file_tree: Option<(Entity<FileTree>, Subscription)>,
    /// The Git panel, its events and the observer that publishes its repository
    /// (`workbench_api::git_repository`).
    git_panel: Option<(Entity<GitPanel>, [Subscription; 2])>,
    terminal: Option<(Entity<TerminalPanel>, Subscription)>,
    /// Terminals of the other open projects, kept running while another project is in front.
    parked_terminals: HashMap<Option<PathBuf>, (Entity<TerminalPanel>, Subscription)>,
    /// A floating view over the workbench: a picker or Settings.
    modal: Option<(AnyView, Subscription)>,
    /// UI extensions' sidebar views and dialogs on screen.
    extension_contributions: extension_contributions::ExtensionContributions,
    github_panel: Option<(Entity<github_panel::GitHubPanel>, Subscription)>,
    /// The views behind centre tabs, by tab key, kept while a tab shows them.
    centre_views: std::collections::HashMap<String, centre_views::CentreView>,
    /// Tabs whose view holds unsaved changes.
    dirty_tabs: std::collections::HashSet<String>,
    /// Toasts with a timer running to put them away.
    timed_toasts: std::collections::HashSet<SharedString>,
    /// The editor and terminal zoom last drawn, and the badge a change shows for a moment
    /// (`ZoomIndicator`).
    zoom_seen: (f32, f32),
    zoom_badge: Option<(SharedString, gpui::Task<()>)>,
    /// Whether this version's What's New is unread, read once and cleared when it is shown.
    whats_new_unread: Option<bool>,
    /// The first-run welcome, shown in the centre until it is finished.
    onboarding: Option<(Entity<onboarding::OnboardingView>, Subscription)>,
    /// Each split's length along its axis, measured as it lays out, for resizing by ratio.
    split_sizes: Rc<std::cell::RefCell<std::collections::HashMap<u64, Pixels>>>,
    /// Focus of each split handle, so it takes arrow keys after a click or Tab.
    split_focus: std::cell::RefCell<HashMap<u64, FocusHandle>>,
    /// Lines to move to once a file's editor opens, by path: (line, column), 1-based.
    pending_lines: std::collections::HashMap<String, (u32, Option<u32>)>,
    /// Byte ranges to select in files once their editors exist (Claude Code's `openFile`).
    pending_file_selections: std::collections::HashMap<String, std::ops::Range<usize>>,
    /// Pane groups by when they were last focused, most recent first (followed files open there).
    group_history: Vec<u64>,
    /// The include filter Find in Folder hands the search view it opens.
    pending_search_include: Option<String>,
    debugger: Option<(Entity<debugger_ui::DebuggerView>, Subscription)>,
    diagnostics: Option<(Entity<diagnostics_panel::DiagnosticsPanel>, Subscription)>,
    references: Option<(Entity<diagnostics_panel::ReferencesView>, Subscription)>,
    _references_full_screen: Option<Subscription>,
    outline: Option<(Entity<outline_panel::OutlinePanel>, Subscription)>,
    /// The bar above each file tab's editor, by view key.
    pub(crate) breadcrumbs: std::collections::HashMap<String, Entity<outline_panel::breadcrumbs::Breadcrumbs>>,
    /// The editor actions at the end of that bar, made as the bar first draws.
    pub(crate) editor_status: Rc<std::cell::RefCell<std::collections::HashMap<String, Entity<editor::EditorStatusActions>>>>,
    /// Tab autocomplete's status item, at the end of each breadcrumb bar.
    pub(crate) completion_status: Entity<agent_ui::tab_completion::CompletionStatusItem>,
    /// Editors' language-server events, kept while the editors live.
    /// Per editor (by entity), dropped with its view in `sync_centre_views`.
    lsp_subscriptions: Vec<(gpui::EntityId, Subscription)>,
    pub(crate) session_panes: std::collections::HashMap<String, crate::dock::SessionPanes>,
    pub(crate) pending_selections: std::collections::HashMap<String, crate::agent_commands::PendingSelection>,
    /// Outside sessions to take over once their view exists: the agent's session id and when the
    /// agent last touched it (Unix ms, 0 when unknown).
    pub(crate) pending_imports: std::collections::HashMap<String, (String, u64)>,
    account_menu: Option<(Entity<account::AccountMenu>, Vec<Subscription>)>,
    /// The Inbox beside the sidebar, while it is open (the bell in the activity bar).
    pub(crate) inbox: Option<(Entity<notifications::InboxPanel>, Subscription)>,
    /// What the next team session tab opens to do: a review or a hand-off.
    pending_team_send: Option<collaboration::SendTo>,
    /// The agent History shows when it opens next (AI: Import Agent Session).
    pub(crate) pending_history_agent: Option<Option<String>>,
    /// Terminals on their way into an editor tab, by the tab's id: one dragged out of the bottom
    /// pane, or the command a new one runs.
    pending_terminals: HashMap<String, centre_views::PendingTerminal>,
    next_terminal_tab: u64,
    /// The project folders continuous agents were last told are open.
    continuous_projects: Vec<PathBuf>,
    /// A close or quit waiting on answers about agents and unsaved files.
    close_guard: close_guard::CloseGuard,
    /// Tabs (or a project) waiting to close until their unsaved files are answered for.
    pending_tab_close: Option<close_guard::PendingTabClose>,
    folder_picker_requested: bool,
    /// What this window last told the other windows of its tab group it shows.
    window_label: Option<WindowLabel>,
    /// What the window last told the OS: unsaved changes, and the file in front.
    document_state: Option<(bool, Option<PathBuf>)>,
    window_tabs_preview: Option<Vec<WindowTab>>,
    /// Each tab strip's scroll, and the tab it last brought into view.
    tab_scrolls: std::cell::RefCell<std::collections::HashMap<u64, (gpui::ScrollHandle, Option<usize>)>>,
    /// The editor group that fills the centre on its own (`togglePaneFullscreen`).
    fullscreen_group: Option<u64>,
    /// The group a dragged tab is over, and where in it it would land.
    tab_drop_zone: Option<(u64, workspace::DropZone)>,
    /// The bottom pane fills the workbench (the terminal's full screen button).
    bottom_full_screen: bool,
    jump_list: navigation::JumpList,
    /// Help > Onboarding asked for the welcome over the centre, tabs or not.
    onboarding_reopened: bool,
    /// Reads the git status the Files tool colors its rows with.
    tree_git_status: Option<(PathBuf, gpui::Task<()>)>,
    /// The session whose sidebar row is being renamed, and its field.
    pub(crate) session_rename: Option<(SessionId, Entity<ui::TextInput>, Subscription, std::time::Instant)>,
    /// Project session lists showing past their first few, by project id.
    pub(crate) expanded_session_lists: std::collections::HashSet<String>,
}

impl Focusable for Workbench {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Workbench {
    /// Shows a tab of the Source Control panel by its name (`tags`, `branches`, ...), for
    /// headless snapshots.
    pub fn open_git_tab(&mut self, name: &str, cx: &mut Context<Self>) {
        if let Some((git, _)) = &self.git_panel {
            git.update(cx, |git, cx| git.open_tab(name, cx));
        }
    }

    pub fn new(store: Option<Rc<dyn StateStore>>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let state = store
            .as_ref()
            .and_then(|store| store.load())
            .and_then(|json| match WorkspaceState::from_json(&json) {
                Ok(state) => Some(state),
                Err(error) => {
                    eprintln!("workspace: could not restore state: {error:#}");
                    None
                }
            })
            .unwrap_or_default();
        let (state, repaired) = repair_session_titles(state);
        let this = Self::with_state(state, store, window, cx);
        if repaired {
            this.save();
        }
        this
    }

    pub fn with_state(
        state: WorkspaceState,
        store: Option<Rc<dyn StateStore>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus_handle = cx.focus_handle();
        window.focus(&focus_handle, cx);
        let weak = cx.weak_entity();
        #[cfg(not(target_family = "wasm"))]
        collaboration_hooks::init(weak.clone(), cx);
        window.on_window_should_close(cx, move |window, cx| {
            weak.update(cx, |this, cx| this.should_close_window(window, cx)).unwrap_or(true)
        });
        // Another window of the tab group may have changed while this one was behind it.
        windows::set_front_window(window.window_handle().window_id(), cx);
        windows::set_toast_window(window.window_handle().window_id(), cx);
        window.set_background_appearance(background_appearance(cx));
        cx.observe_window_activation(window, |this, window, cx| {
            if window.is_window_active() {
                if theme::refresh_accessibility(cx) {
                    let appearance = if this.follow_system_appearance { appearance_of(window.appearance()) } else { cx.theme().appearance };
                    apply_theme(appearance, cx);
                    cx.defer(|cx| {
                        let appearance = background_appearance(cx);
                        for handle in cx.windows() {
                            handle.update(cx, |_, window, _| window.set_background_appearance(appearance)).ok();
                        }
                        cx.refresh_windows();
                    });
                }
                windows::set_front_window(window.window_handle().window_id(), cx);
                windows::set_toast_window(window.window_handle().window_id(), cx);
                #[cfg(not(target_family = "wasm"))]
                collaboration_hooks::init(cx.weak_entity(), cx);
            }
            cx.notify();
        })
        .detach();
        cx.observe_window_appearance(window, |this, window, cx| {
            if !this.follow_system_appearance {
                return;
            }
            apply_theme(appearance_of(window.appearance()), cx);
            cx.refresh_windows();
        })
        .detach();
        let window_id = window.window_handle().window_id();
        let workbench = cx.weak_entity();
        cx.intercept_keystrokes(move |event, window, cx| {
            if window.window_handle().window_id() != window_id {
                return;
            }
            let modifiers = &event.keystroke.modifiers;
            let primary = if cfg!(target_os = "macos") { modifiers.platform && !modifiers.control } else { modifiers.control && !modifiers.platform };
            if !primary || !modifiers.alt || modifiers.shift {
                return;
            }
            let direction = match event.keystroke.key.as_str() {
                "left" => workspace::Direction::Left,
                "right" => workspace::Direction::Right,
                "up" => workspace::Direction::Up,
                "down" => workspace::Direction::Down,
                _ => return,
            };
            // Terminals keep these keys for their own split panes.
            if event.context_stack.iter().any(|context| context.contains("Terminal")) {
                return;
            }
            if workbench.update(cx, |this, cx| this.focus_adjacent_group(direction, window, cx)).unwrap_or(false) {
                cx.stop_propagation();
            }
        })
        .detach();
        cx.observe_global_in::<workbench_api::OpenRequests>(window, |this, window, cx| {
            this.handle_open_requests(window, cx);
        })
        .detach();
        cx.observe_global::<notifications::Notifications>(|this, cx| {
            this.time_toasts(cx);
            cx.notify();
        })
        .detach();
        cx.observe_global_in::<settings::SettingsStore>(window, |this, window, cx| {
            let appearance = if this.follow_system_appearance {
                appearance_of(window.appearance())
            } else {
                cx.theme().appearance
            };
            let before = cx.theme().id.clone();
            let glass_before = theme::glass(cx);
            apply_theme(appearance, cx);
            window.set_background_appearance(background_appearance(cx));
            apply_ui_typography(cx);
            if !this.tool_available(this.state.layout.sidebar_view, cx) {
                this.state.layout.sidebar_view = SidebarView::Files;
                this.save();
            }
            let preset = settings::get(cx).keybinding_preset.clone();
            if cx.try_global::<keymap::ActiveKeymap>().is_some_and(|active| active.preset != preset) {
                reload_keymap(cx);
            }
            if cx.theme().id != before || theme::glass(cx) != glass_before {
                cx.refresh_windows();
            }
            cx.notify();
        })
        .detach();
        apply_ui_typography(cx);
        let continuous = agent_ui::cloud::ContinuousAgents::global(cx);
        cx.subscribe_in(&continuous, window, |this, _, event: &agent_ui::cloud::ContinuousEvent, window, cx| this.launch_continuous(event, window, cx))
            .detach();
        Self::watch_closed_pull_requests(cx);
        agent_ui::cloud::sidebar::watch(cx);
        Self::watch_hosted_browser_runs(cx);
        let mut this = Self {
            state,
            store,
            focus_handle,
            sidebar_focus: cx.focus_handle(),
            platform: Platform::current(),
            open_menu: None,
            drag: None,
            should_move_window: false,
            sidebar_overlay_open: false,
            dashboard_all_sessions: false,
            title_leading_end: Rc::new(Cell::new(px(0.))),
            centre_maximized: false,
            follow_system_appearance: true,
            file_tree: None,
            git_panel: None,
            terminal: None,
            parked_terminals: HashMap::new(),
            modal: None,
            extension_contributions: Default::default(),
            github_panel: None,
            centre_views: Default::default(),
            dirty_tabs: Default::default(),
            timed_toasts: Default::default(),
            zoom_seen: (editor::zoom_level(cx), terminal_view::terminal_zoom(cx)),
            zoom_badge: None,
            whats_new_unread: None,
            onboarding: None,
            split_sizes: Default::default(),
            split_focus: Default::default(),
            pending_lines: Default::default(),
            pending_file_selections: Default::default(),
            group_history: Vec::new(),
            pending_search_include: None,
            debugger: None,
            diagnostics: None,
            references: None,
            outline: None,
            breadcrumbs: Default::default(),
            editor_status: Default::default(),
            completion_status: cx.new(agent_ui::tab_completion::CompletionStatusItem::new),
            lsp_subscriptions: Vec::new(),
            session_panes: Default::default(),
            pending_selections: Default::default(),
            pending_imports: Default::default(),
            account_menu: None,
            inbox: None,
            pending_team_send: None,
            pending_history_agent: None,
            pending_terminals: HashMap::new(),
            next_terminal_tab: 0,
            continuous_projects: Vec::new(),
            close_guard: Default::default(),
            pending_tab_close: None,
            folder_picker_requested: false,
            window_label: None,
            document_state: None,
            window_tabs_preview: None,
            tab_scrolls: Default::default(),
            fullscreen_group: None,
            _references_full_screen: None,
            tab_drop_zone: None,
            bottom_full_screen: false,
            jump_list: Default::default(),
            onboarding_reopened: false,
            tree_git_status: None,
            session_rename: None,
            expanded_session_lists: Default::default(),
        };
        this.sync_continuous_projects(cx);
        this.publish_projects(cx);
        this.observe_ui_extensions(window, cx);
        this
    }

    pub fn state(&self) -> &WorkspaceState {
        &self.state
    }

    /// Draws the window chrome of another platform, for previews.
    pub fn set_platform(&mut self, platform: Platform) {
        self.platform = platform;
    }

    /// The editor of the file tab in front.
    pub fn active_file_editor(&self) -> Option<Entity<editor::Editor>> {
        self.active_editor()
    }

    /// The Files tool's tree, once the sidebar has shown it.
    pub fn file_tree(&self) -> Option<Entity<FileTree>> {
        self.file_tree.as_ref().map(|(tree, _)| tree.clone())
    }

    /// Select project icon, for a project.
    pub fn show_project_icon_picker(&mut self, id: &ProjectId, window: &mut Window, cx: &mut Context<Self>) {
        let Some(project) = self.state.project(id).cloned() else { return };
        let workbench = cx.weak_entity();
        let picker = cx.new(|cx| project_icon::ProjectIconPicker::new(workbench, project.id.clone(), project.path.clone(), project.custom_icon.clone(), window, cx));
        self.open_modal(picker, window, cx);
    }

    /// Changes the workspace, saves it and redraws.
    fn update_state(&mut self, cx: &mut Context<Self>, change: impl FnOnce(&mut WorkspaceState)) {
        self.capture_editor_views(cx);
        let front = self.state.focused_tabs().map(|tabs| (tabs.active, tabs.tabs.len()));
        change(&mut self.state);
        if let Some(active) = self.state.focused_panes().map(|panes| panes.active) {
            self.group_history.retain(|group| *group != active);
            self.group_history.insert(0, active);
            self.group_history.truncate(32);
        }
        // A tab that opens or comes to the front covers the welcome.
        if self.state.focused_tabs().map(|tabs| (tabs.active, tabs.tabs.len())) != front {
            self.onboarding_reopened = false;
        }
        let max_tabs = settings::get(cx).max_open_tabs.max(0.) as usize;
        let dirty = &self.dirty_tabs;
        let open: Vec<(u64, TabItem)> = self.state.all_group_tabs().map(|(group, tab)| (group, tab.clone())).collect();
        self.state.limit_tabs(max_tabs, |tab| {
            open.iter().any(|(group, open)| open == tab && dirty.contains(&centre_views::view_key(*group, tab)))
        });
        self.save();
        self.sync_continuous_projects(cx);
        self.publish_projects(cx);
        cx.notify();
    }

    /// Continuous agents run only in open local projects.
    fn sync_continuous_projects(&mut self, cx: &mut Context<Self>) {
        if cfg!(target_family = "wasm") {
            return;
        }
        let projects: Vec<PathBuf> = self.state.projects.iter().filter(|project| !project.is_remote()).map(|project| PathBuf::from(&project.path)).collect();
        if projects == self.continuous_projects {
            return;
        }
        self.continuous_projects = projects.clone();
        agent_ui::cloud::ContinuousAgents::global(cx).update(cx, |agents, cx| agents.set_open_projects(projects, cx));
    }

    /// The editor of the file tab in front.
    /// The view of the tab in front of the focused group, once it has been drawn.
    pub fn active_centre_view(&self) -> Option<gpui::AnyView> {
        let panes = self.state.focused_panes()?;
        let group = panes.group(panes.active)?;
        let item = group.tabs.active_item()?;
        Some(self.centre_views.get(&centre_views::view_key(group.id, item))?.view.clone())
    }

    fn active_editor(&self) -> Option<Entity<editor::Editor>> {
        let panes = self.state.focused_panes()?;
        let group = panes.group(panes.active)?;
        let item = group.tabs.active_item()?;
        self.centre_views.get(&centre_views::view_key(group.id, item))?.editor.clone()
    }

    /// The project root tools of no particular project open in, or empty.
    fn active_root(&self) -> String {
        self.state.active_project().filter(|project| !project.is_remote()).map(|project| project.path.clone()).unwrap_or_default()
    }

    fn review_agent_changes(&mut self, _: &agent_ui::review::ReviewAgentChanges, _: &mut Window, cx: &mut Context<Self>) {
        let Some(session) = self.state.focused_session() else {
            notifications::info(cx, "Open an agent session to review its changes");
            return;
        };
        let (id, title) = (session.id.0.clone(), format!("Review: {}", session.title));
        self.update_state(cx, |state| state.open_resource(agent_ui::review::RESOURCE_KIND, &id, &title));
    }

    fn resolve_all_agent_changes(&mut self, keep: bool, cx: &mut Context<Self>) {
        let Some(session) = self.state.focused_session().map(|session| session.id.0.clone()) else { return };
        let action = if keep { agent_ui::review::ReviewAction::KeepAll } else { agent_ui::review::ReviewAction::RejectAll };
        agent_ui::review::apply(session, action, cx).detach();
    }

    fn resolve_agent_hunk(&mut self, keep: bool, cx: &mut Context<Self>) {
        if let Some(editor) = self.active_editor() {
            editor.update(cx, |editor, cx| editor.resolve_agent_hunk_at_caret(keep, cx));
        }
    }

    /// Writes the workspace to its store now.
    /// Keeps closed projects' tabs in `file`, which every window shares.
    pub fn share_closed_project_tabs(&mut self, file: PathBuf) {
        self.state.share_closed_project_tabs(file);
    }

    pub fn save(&self) {
        let Some(store) = &self.store else { return };
        match self.state.to_json() {
            Ok(json) => {
                if let Err(error) = store.save(&json) {
                    eprintln!("workspace: could not save state: {error:#}");
                }
            }
            Err(error) => eprintln!("workspace: could not encode state: {error:#}"),
        }
    }

    fn is_narrow(window: &Window) -> bool {
        window.viewport_size().width < metrics::NARROW_WINDOW
    }

    /// Creates the tool views the layout shows, for the project in front, and drops the ones of
    /// a project that left.
    fn sync_tool_views(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let root = self.state.active_project().map(|project| PathBuf::from(&project.path));
        let view = self.state.layout.sidebar_view;

        let stale_tree = self.file_tree.as_ref().is_some_and(|(tree, _)| Some(tree.read(cx).root()) != root.as_deref());
        if stale_tree || root.is_none() {
            self.file_tree = None;
        }
        if self.file_tree.is_none() && view == SidebarView::Files && let Some(root) = root.clone() {
            let tree = cx.new(|cx| match remote_projects::file_tree_fs(&root) {
                Some(fs) => FileTree::with_fs(root, fs, cx),
                None => FileTree::new(root, window, cx),
            });
            let subscription = cx.subscribe_in(&tree, window, |this, _, event: &FileTreeEvent, window, cx| match event {
                FileTreeEvent::OpenFiles(paths) => {
                    this.update_state(cx, |state| {
                        for path in paths {
                            state.open_file(&path.to_string_lossy());
                        }
                    });
                }
                FileTreeEvent::OpenTerminal(dir) => {
                    this.update_state(cx, |state| state.show_bottom_tab(workspace::BottomTab::Terminal));
                    let terminal = this.ensure_terminal(window, cx);
                    terminal.update(cx, |terminal, cx| terminal.open_in(Some(dir.clone()), window, cx));
                }
                FileTreeEvent::FindInFolder(dir) => this.find_in_folder(dir, cx),
                FileTreeEvent::ShowLocalHistory(path) => this.show_local_history_for(path.clone(), window, cx),
                FileTreeEvent::OpenFile(path) => {
                    let path = path.to_string_lossy().into_owned();
                    this.update_state(cx, |state| state.open_file(&path));
                }
                FileTreeEvent::Moved { from, to } => {
                    let (from, to) = (from.to_string_lossy().into_owned(), to.to_string_lossy().into_owned());
                    this.update_state(cx, |state| state.relocate_paths(&from, &to));
                }
                FileTreeEvent::Deleted(paths) => {
                    this.update_state(cx, |state| {
                        for path in paths {
                            state.close_paths_under(&path.to_string_lossy());
                        }
                    });
                }
                FileTreeEvent::Confirm(dialog) => this.open_modal(dialog.clone(), window, cx),
                FileTreeEvent::ShowProperties(dialog) => this.open_modal(dialog.clone(), window, cx),
                FileTreeEvent::AddFolderToWorkspace => this.add_folder_to_workspace(window, cx),
                FileTreeEvent::RemoveFolderFromWorkspace(path) => {
                    let Some(id) = this.state.active_project().map(|project| project.id.clone()) else { return };
                    let folder = path.to_string_lossy().into_owned();
                    this.update_state(cx, |state| {
                        state.remove_project_folder(&id, &folder);
                    });
                }
            });
            self.file_tree = Some((tree, subscription));
        }

        // The tree follows the file in front.
        if let Some((tree, _)) = &self.file_tree {
            let folders: Vec<PathBuf> = self.state.active_project().map(|project| project.folders.iter().map(PathBuf::from).collect()).unwrap_or_default();
            tree.update(cx, |tree, cx| tree.set_extra_roots(folders, cx));
            let active = match self.state.focused_tabs().and_then(|tabs| tabs.active_item()) {
                Some(workspace::TabItem::File { path }) => Some(PathBuf::from(path)),
                _ => None,
            };
            tree.update(cx, |tree, cx| tree.set_active_file(active, cx));
        }
        self.sync_tree_git_status(cx);

        // Problems' "Only Current File" follows the editor in front; a tab that is no editor
        // clears it, except Problems itself, which keeps the file it was opened over.
        if let Some((diagnostics, _)) = &self.diagnostics {
            let problems_in_front = matches!(
                self.state.focused_tabs().and_then(|tabs| tabs.active_item()),
                Some(workspace::TabItem::Resource { kind, .. }) if kind == "problems"
            );
            if !problems_in_front {
                let active = self.active_editor().map(|editor| editor.read(cx).path().to_path_buf());
                diagnostics.update(cx, |view, cx| view.set_active_file(active, cx));
            }
        }

        let stale_github = self.github_panel.as_ref().is_some_and(|(github, _)| Some(github.read(cx).root()) != root.as_deref());
        if stale_github || root.is_none() {
            self.github_panel = None;
        }
        if self.github_panel.is_none() && view == SidebarView::GitHub && let Some(root) = root.clone() {
            let github = cx.new(|cx| github_panel::GitHubPanel::new(root, window, cx));
            let subscription = cx.subscribe(&github, |this, _, event: &github_panel::GitHubEvent, cx| match event {
                github_panel::GitHubEvent::OpenResource { kind, id, title } => {
                    this.update_state(cx, |state| state.open_resource(kind, id, title));
                }
                github_panel::GitHubEvent::OpenFile(path) => {
                    let path = path.to_string_lossy().into_owned();
                    this.update_state(cx, |state| state.open_file(&path));
                }
                github_panel::GitHubEvent::OpenInNewWindow { kind, id, title } => this.open_resource_in_detached_window(kind, id, title, cx),
            });
            self.github_panel = Some((github, subscription));
        }

        self.sync_centre_views(window, cx);
        if settings::get(cx).show_outline {
            self.ensure_outline(window, cx);
        }
        self.sync_outline(cx);
        self.sync_breadcrumbs(cx);
        if let Some((references, _)) = &self.references {
            let full = self.fullscreen_group.is_some();
            references.update(cx, |view, cx| view.set_full_screen(full, cx));
        }

        if self.onboarding.is_none() && !onboarding::is_completed(cx) && self.state.focused_tabs().is_none_or(|tabs| tabs.tabs.is_empty()) {
            self.ensure_onboarding(cx);
        }

        // Without a project the panel is given no folder and says "No repository selected".
        let git_root = root.clone().unwrap_or_default();
        let stale_git = self.git_panel.as_ref().is_some_and(|(git, _)| git.read(cx).root() != git_root.as_path());
        if stale_git || (root.is_none() && view != SidebarView::Git) {
            self.git_panel = None;
            workbench_api::set_git_repository(cx, None);
        }
        let auto_fetch = settings::get(cx).git_auto_fetch_interval > 0.;
        if self.git_panel.is_none() && (view == SidebarView::Git || (auto_fetch && root.is_some())) {
            let git = cx.new(|cx| match root.as_deref().and_then(remote_projects::git_discovery) {
                Some(discover) => GitPanel::with_discovery(git_root, discover, window, cx),
                None => GitPanel::new(git_root, window, cx),
            });
            let subscription = cx.subscribe(&git, |this, _, event: &GitPanelEvent, cx| match event {
                GitPanelEvent::OpenFile(path) => {
                    let path = path.to_string_lossy().into_owned();
                    this.update_state(cx, |state| state.open_file(&path));
                }
            });
            // The selected repository, for views that follow it (`context-references.ts`).
            let observer = cx.observe(&git, |_, git, cx| {
                let root = git.read(cx).repo_root();
                workbench_api::set_git_repository(cx, root);
            });
            self.git_panel = Some((git, [subscription, observer]));
        }

        // Each project keeps its own terminals: the ones of the project that left wait for it.
        if let Some(current) = self.terminal.as_ref().map(|(terminal, _)| terminal.read(cx).working_directory())
            && current != root
            && let Some((terminal, subscription)) = self.terminal.take()
        {
            terminal.update(cx, |terminal, cx| terminal.set_presentation(false, false, cx));
            self.parked_terminals.insert(current, (terminal, subscription));
            self.terminal = self.parked_terminals.remove(&root);
        }
        let open: Vec<Option<PathBuf>> = self.state.projects.iter().map(|project| Some(PathBuf::from(&project.path))).collect();
        self.parked_terminals.retain(|folder, _| folder.is_none() || open.contains(folder));
        let bottom_tab = self.state.layout.bottom_tab;
        if self.state.layout.bottom_pane_visible && bottom_tab == workspace::BottomTab::Buffers && self.state.bottom.is_empty() {
            self.state.layout.bottom_pane_visible = false;
            self.state.layout.bottom_tab = workspace::BottomTab::Terminal;
        }
        if self.state.bottom_focused && !(self.state.layout.bottom_pane_visible && bottom_tab == workspace::BottomTab::Buffers) {
            self.state.bottom_focused = false;
        }
        if self.state.layout.bottom_pane_visible && bottom_tab == workspace::BottomTab::Debugger && self.debugger.is_none() && self.ensure_debugger(window, cx).is_none() {
            self.state.layout.bottom_tab = workspace::BottomTab::Terminal;
        }
        if self.state.layout.bottom_pane_visible && self.state.layout.bottom_tab == workspace::BottomTab::Terminal && self.terminal.is_none() {
            self.ensure_terminal(window, cx);
        }
        if !self.state.layout.bottom_pane_visible {
            self.bottom_full_screen = false;
        }
        if let Some((terminal, _)) = &self.terminal {
            let (shown, full) = (self.state.layout.bottom_pane_visible, self.bottom_full_screen);
            terminal.update(cx, |terminal, cx| terminal.set_presentation(shown, full, cx));
        }
    }

    /// Keeps the Files tool's git colors current: the status of the project's repository, read
    /// every few seconds off the UI thread while the tree is open (local projects).
    fn sync_tree_git_status(&mut self, cx: &mut Context<Self>) {
        let Some((tree, _)) = &self.file_tree else {
            self.tree_git_status = None;
            return;
        };
        let root = tree.read(cx).root().to_path_buf();
        if self.tree_git_status.as_ref().is_some_and(|(polled, _)| *polled == root) {
            return;
        }
        if remote_projects::git_discovery(&root).is_some() {
            self.tree_git_status = None;
            return;
        }
        let tree = tree.downgrade();
        let polled = root.clone();
        let task = cx.spawn(async move |_, cx| {
            loop {
                let Ok(wanted) = tree.read_with(cx, |tree, _| tree.wants_git_status()) else { break };
                if wanted {
                    let root = root.clone();
                    let status = cx
                        .background_spawn(async move {
                            let repo = git_panel::discover_repository(&root)?;
                            let status = repo.status().ok()?;
                            let files = status
                                .files
                                .into_iter()
                                .map(|file| file_tree::GitFileStatus {
                                    path: file.path,
                                    kind: match file.status {
                                        git_panel::FileStatus::Modified => file_tree::GitStatusKind::Modified,
                                        git_panel::FileStatus::Added => file_tree::GitStatusKind::Added,
                                        git_panel::FileStatus::Deleted => file_tree::GitStatusKind::Deleted,
                                        git_panel::FileStatus::Renamed => file_tree::GitStatusKind::Renamed,
                                        git_panel::FileStatus::Untracked => file_tree::GitStatusKind::Untracked,
                                    },
                                    staged: file.staged,
                                })
                                .collect();
                            Some((repo.root().to_path_buf(), files))
                        })
                        .await;
                    if tree.update(cx, |tree, cx| tree.set_git_status(status, cx)).is_err() {
                        break;
                    }
                }
                cx.background_executor().timer(std::time::Duration::from_secs(4)).await;
            }
        });
        self.tree_git_status = Some((polled, task));
    }

    fn ensure_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<TerminalPanel> {
        if let Some((terminal, _)) = &self.terminal {
            return terminal.clone();
        }
        let root = self.state.active_project().map(|project| PathBuf::from(&project.path));
        let sessions = self.store.is_some().then(|| terminal_view::sessions_location(cx)).flatten();
        let terminal = cx.new(|cx| TerminalPanel::with_sessions(root, Some(remote_projects::terminal_starter()), sessions, window, cx));
        let subscription = cx.subscribe(&terminal, |this, panel, event: &TerminalPanelEvent, cx| match event {
            _ if this.terminal.as_ref().is_none_or(|(terminal, _)| *terminal != panel) => {}
            TerminalPanelEvent::TitleChanged(_) | TerminalPanelEvent::CommandFinished(_) => {}
            TerminalPanelEvent::Hide => {
                this.bottom_full_screen = false;
                this.update_state(cx, |state| state.layout.bottom_pane_visible = false)
            }
            TerminalPanelEvent::ToggleFullScreen => this.toggle_bottom_full_screen(cx),
        });
        self.terminal = Some((terminal.clone(), subscription));
        terminal
    }

    /// A terminal the `athas` command or a link asked for, running `command` in `cwd` when given.
    /// A command from a link runs only once the user agrees.
    pub fn open_terminal(&mut self, command: Option<String>, cwd: Option<PathBuf>, confirm: bool, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(command) = command.filter(|command| !command.is_empty()) {
            if confirm {
                let mut lines = vec!["Open a terminal and run this command?".to_string(), String::new(), command.clone()];
                if let Some(cwd) = &cwd {
                    lines.extend([String::new(), format!("Working directory: {}", cwd.display())]);
                }
                let weak = cx.weak_entity();
                let dialog = ui::AlertDialog::confirm(
                    "Run Terminal Command",
                    lines.join("\n"),
                    ui::ConfirmOptions { confirm_label: "Run Command".into(), ..Default::default() },
                    move |window, cx| {
                        weak.update(cx, |this, cx| this.open_terminal(Some(command.clone()), cwd.clone(), false, window, cx)).ok();
                    },
                    cx,
                );
                self.open_modal(dialog, window, cx);
                return;
            }
            self.update_state(cx, |state| state.show_bottom_tab(workspace::BottomTab::Terminal));
            let terminal = self.ensure_terminal(window, cx);
            terminal.update(cx, |terminal, cx| terminal.run_command(&command, cwd, window, cx));
            return;
        }
        self.update_state(cx, |state| state.show_bottom_tab(workspace::BottomTab::Terminal));
        let terminal = self.ensure_terminal(window, cx);
        window.focus(&terminal.focus_handle(cx), cx);
    }

    /// The run menu: the project's scripts and tasks, run in a new terminal.
    pub fn show_run_actions(&mut self, _: &ShowRunActions, window: &mut Window, cx: &mut Context<Self>) {
        let Some(root) = self.state.active_project().map(|project| PathBuf::from(&project.path)) else {
            notifications::info(cx, "Open a project to run its scripts");
            return;
        };
        let weak = cx.weak_entity();
        let workspace_path = Some(root.to_string_lossy().into_owned());
        let lens_editor = self.active_editor().filter(|editor| !editor.read(cx).is_untitled());
        let lenses = lens_editor
            .as_ref()
            .map(|editor| {
                let editor = editor.read(cx);
                run_actions::lens_actions(editor.path(), &editor.runnable_lenses())
            })
            .unwrap_or_default();
        let lens_target = lens_editor.map(|editor| editor.downgrade());
        let delegate = run_actions::RunActionsDelegate::new(root, cx, move |action, window, cx| {
            if let (Some(index), Some(editor)) = (action.lens, lens_target.as_ref()) {
                editor.update(cx, |editor, cx| editor.run_runnable_lens(index, window, cx)).ok();
                return;
            }
            let command = action.command.clone();
            let cwd = action.working_directory.clone();
            weak.update(cx, |this, cx| {
                this.update_state(cx, |state| state.show_bottom_tab(workspace::BottomTab::Terminal));
                let terminal = this.ensure_terminal(window, cx);
                terminal.update(cx, |terminal, cx| terminal.run_command(&command, Some(cwd), window, cx));
            })
            .ok();
        })
        .on_manage({
            let weak = cx.weak_entity();
            move |request, window, cx| {
                let workspace_path = workspace_path.clone();
                weak.update(cx, |this, cx| this.manage_run_action(request, workspace_path, window, cx)).ok();
            }
        })
        .with_lenses(lenses);
        let picker = cx.new(|cx| palette::Picker::new(delegate, window, cx));
        self.open_modal(picker, window, cx);
    }

    /// The rail's Run dropdown: the same actions as the run menu, grouped by source.
    pub fn show_run_dropdown(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(root) = self.state.active_project().map(|project| PathBuf::from(&project.path)) else {
            notifications::info(cx, "Open a project to run its scripts");
            return;
        };
        let weak = cx.weak_entity();
        let workspace_path = Some(root.to_string_lossy().into_owned());
        let lens_editor = self.active_editor().filter(|editor| !editor.read(cx).is_untitled());
        let lenses = lens_editor
            .as_ref()
            .map(|editor| {
                let editor = editor.read(cx);
                run_actions::lens_actions(editor.path(), &editor.runnable_lenses())
            })
            .unwrap_or_default();
        let lens_target = lens_editor.map(|editor| editor.downgrade());
        let actions = run_actions::with_lens_group(run_actions::discover(&root, &run_actions::load_custom_actions()), &lenses);

        let mut entries: Vec<MenuEntry> = Vec::new();
        let mut group: Option<String> = None;
        for action in actions {
            if group.as_deref() != Some(action.source_label.as_str()) {
                if group.is_some() {
                    entries.push(MenuEntry::Separator);
                }
                entries.push(MenuEntry::Label(action.source_label.clone().into()));
                group = Some(action.source_label.clone());
            }
            let weak = weak.clone();
            let lens_target = lens_target.clone();
            let item = MenuItem::new(action.name.clone()).icon(ui::IconName::Play).tooltip(action.command.clone()).on_select(move |window, cx| {
                if let (Some(index), Some(editor)) = (action.lens, lens_target.as_ref()) {
                    editor.update(cx, |editor, cx| editor.run_runnable_lens(index, window, cx)).ok();
                    return;
                }
                let command = action.command.clone();
                let cwd = action.working_directory.clone();
                weak.update(cx, |this, cx| {
                    this.update_state(cx, |state| state.show_bottom_tab(workspace::BottomTab::Terminal));
                    let terminal = this.ensure_terminal(window, cx);
                    terminal.update(cx, |terminal, cx| terminal.run_command(&command, Some(cwd), window, cx));
                })
                .ok();
            });
            entries.push(item.into());
        }
        if entries.is_empty() {
            entries.push(MenuEntry::Text("No scripts or tasks found in this project".into()));
        }
        entries.push(MenuEntry::Separator);
        let manage = |label: &'static str, icon: ui::IconName, request: fn() -> run_actions::ManageRequest| {
            let weak = weak.clone();
            let workspace_path = workspace_path.clone();
            MenuItem::new(label)
                .icon(icon)
                .on_select(move |window, cx| {
                    let workspace_path = workspace_path.clone();
                    weak.update(cx, |this, cx| this.manage_run_action(request(), workspace_path, window, cx)).ok();
                })
                .into()
        };
        entries.push(manage("New action…", ui::IconName::Plus, || run_actions::ManageRequest::New));
        entries.push(manage("Manage workspace…", ui::IconName::Gear, || run_actions::ManageRequest::Workspace));
        if self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == "run-actions") {
            self.open_menu = None;
            cx.notify();
            return;
        }
        // The original's 288px dropdown with a search field, opening beside the rail from the
        // button rather than wherever the pointer was.
        let x = metrics::WORKBENCH_GAP + metrics::RAIL_CONTROL + px(6.);
        let y = if position.y > px(0.) { position.y + px(12.) } else { window.viewport_size().height - px(48.) };
        self.open_menu = Some(
            OpenMenu::sized("run-actions", entries, ui::MenuSize::Wide, point(x, y), Anchor::BottomLeft, window, cx, |this: &mut Self, _| this.open_menu = None)
                .searchable("Search actions", "No actions match", cx),
        );
        cx.notify();
    }

    /// New action…, Edit action… and Delete action… from the run menu.
    pub fn manage_run_action(&mut self, request: run_actions::ManageRequest, workspace_path: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        match request {
            run_actions::ManageRequest::New | run_actions::ManageRequest::Edit(_) => {
                let existing = match request {
                    run_actions::ManageRequest::Edit(action) => Some(action),
                    _ => None,
                };
                let dialog = cx.new(|cx| run_actions::RunActionDialog::new(existing, workspace_path, |_, _| {}, window, cx));
                self.open_modal(dialog, window, cx);
            }
            run_actions::ManageRequest::Workspace => window.dispatch_action(Box::new(settings_ui::ManageWorkspaces), cx),
            run_actions::ManageRequest::Delete(action) => {
                let dialog = ui::AlertDialog::confirm(
                    "Delete run action",
                    format!("Delete the run action \u{201c}{}\u{201d}?", action.name),
                    ui::ConfirmOptions { confirm_label: "Delete".into(), destructive: true, ..Default::default() },
                    move |_, cx| {
                        if let Err(error) = run_actions::delete_custom_action(&action.id) {
                            notifications::error(cx, "Failed to delete run action", Some(format!("{error:#}").into()));
                        }
                    },
                    cx,
                );
                self.open_modal(dialog, window, cx);
            }
        }
    }

    // Commands.

    fn toggle_sidebar(&mut self, _: &ToggleSidebar, window: &mut Window, cx: &mut Context<Self>) {
        if Self::is_narrow(window) {
            self.sidebar_overlay_open = !self.sidebar_overlay_open;
            cx.notify();
        } else {
            self.update_state(cx, |state| state.layout.sidebar_visible = !state.layout.sidebar_visible);
        }
    }

    /// Picks what the sidebar shows; picking the view that already shows puts the sidebar away.
    fn toggle_sidebar_view(&mut self, view: SidebarView, window: &mut Window, cx: &mut Context<Self>) {
        if self.leave_extension_view() {
            self.show_sidebar_view(view, window, cx);
            return;
        }
        let narrow = Self::is_narrow(window);
        let shown = if narrow { self.sidebar_overlay_open } else { self.state.layout.sidebar_visible };
        if shown && self.state.layout.sidebar_view == view {
            if narrow {
                self.sidebar_overlay_open = false;
            }
            self.update_state(cx, |state| {
                if !narrow {
                    state.layout.sidebar_visible = false;
                }
            });
        } else {
            if narrow {
                self.sidebar_overlay_open = true;
            }
            self.update_state(cx, |state| {
                state.layout.sidebar_view = view;
                if !narrow {
                    state.layout.sidebar_visible = true;
                }
            });
        }
    }

    fn toggle_terminal(&mut self, _: &ToggleTerminal, window: &mut Window, cx: &mut Context<Self>) {
        self.update_state(cx, |state| {
            let shown = state.layout.bottom_pane_visible && state.layout.bottom_tab == workspace::BottomTab::Terminal;
            state.layout.bottom_pane_visible = !shown;
            state.layout.bottom_tab = workspace::BottomTab::Terminal;
        });
        if self.state.layout.bottom_pane_visible {
            // A pane that opens takes the keyboard; the panel passes it to the terminal in front.
            if let Some((terminal, _)) = &self.terminal {
                window.focus(&terminal.focus_handle(cx), cx);
            }
        } else {
            window.focus(&self.focus_handle, cx);
        }
    }

    fn new_session(&mut self, _: &NewSession, _: &mut Window, cx: &mut Context<Self>) {
        self.start_session(self.state.active_project.clone(), cx);
    }

    fn start_session(&mut self, project: Option<ProjectId>, cx: &mut Context<Self>) {
        self.centre_maximized = false;
        self.update_state(cx, |state| {
            state.new_session(project, DEFAULT_AGENT);
        });
    }

    fn open_project(&mut self, _: &OpenProject, _: &mut Window, cx: &mut Context<Self>) {
        self.prompt_open_project(cx);
    }

    fn prompt_open_project(&mut self, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Open".into()),
        });
        cx.spawn(async move |this, cx| {
            match paths.await {
                Ok(Ok(Some(paths))) => {
                    let Some(path) = paths.into_iter().next() else { return };
                    this.update(cx, |this, cx| {
                        let open_here = this.state.projects.iter().any(|project| std::path::Path::new(&project.path) == path);
                        if this.opens_folders_elsewhere(cx) && !open_here {
                            this.open_folder_in_new_window(path, cx);
                        } else {
                            this.open_project_path(path, cx);
                        }
                    })
                    .ok();
                }
                Ok(Err(error)) if cfg!(target_os = "linux") => {
                    eprintln!("Native folder dialog failed, using the Athas folder picker: {error:#}");
                    this.update(cx, |this, cx| this.show_folder_picker(cx)).ok();
                }
                _ => {}
            }
        })
        .detach();
    }

    /// Athas's own folder picker, where the system's dialog cannot open; it opens on the next frame,
    /// which has the window.
    pub(crate) fn show_folder_picker(&mut self, cx: &mut Context<Self>) {
        self.folder_picker_requested = true;
        cx.notify();
    }

    pub fn open_folder_picker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.folder_picker_requested = false;
        let open = cx.weak_entity();
        let picker = cx.new(|cx| {
            folder_picker::FolderPicker::new(
                None,
                move |path, _, cx| {
                    open.update(cx, |this, cx| this.open_project_path(path, cx)).ok();
                },
                window,
                cx,
            )
        });
        self.open_modal(picker, window, cx);
    }

    /// Opens what was dropped on the window: folders as projects, files in the editor.
    fn open_dropped_paths(&mut self, paths: &[PathBuf], cx: &mut Context<Self>) {
        let paths = paths.to_vec();
        let kinds = cx.background_spawn(async move { paths.into_iter().map(|path| (path.is_dir(), path.exists(), path)).collect::<Vec<_>>() });
        cx.spawn(async move |this, cx| {
            let kinds = kinds.await;
            this.update(cx, |this, cx| {
                let mut opened = 0;
                for (is_dir, exists, path) in kinds {
                    if !exists {
                        eprintln!("Failed to open dropped path: {}", path.display());
                    } else if is_dir {
                        this.open_project_path(path, cx);
                        opened += 1;
                    } else {
                        this.open_file_at(path, None, None, cx);
                        opened += 1;
                    }
                }
                if opened == 0 {
                    notifications::notify(
                        cx,
                        notifications::NotificationKind::Warning,
                        notifications::NotificationCategory::Athas,
                        "No supported dropped files or folders could be opened.",
                        None,
                        None,
                    );
                }
            })
            .ok();
        })
        .detach();
    }

    pub fn open_project_path(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let path = path.to_string_lossy().into_owned();
        if !remote_projects::is_remote_or_wsl(&path) {
            self.update_state(cx, |state| {
                state.open_project(&path);
            });
            return;
        }
        // The connection's name comes from its saved settings on disk.
        let name = cx.background_spawn({
            let path = path.clone();
            async move { remote_projects::display_name(&path) }
        });
        cx.spawn(async move |this, cx| {
            let name = name.await;
            this.update(cx, |this, cx| {
                this.update_state(cx, |state| {
                    let id = state.open_project(&path);
                    let Some(name) = name else { return };
                    if let Some(project) = state.projects.iter_mut().find(|project| project.id == id) {
                        project.name = name.clone();
                    }
                    if let Some(recent) = state.recent_projects.iter_mut().find(|recent| recent.path == id.0) {
                        recent.name = name;
                    }
                });
            })
            .ok();
        })
        .detach();
    }

    fn open_remote(&mut self, _: &OpenRemote, window: &mut Window, cx: &mut Context<Self>) {
        self.show_remote_connections(window, cx);
    }

    pub fn show_remote_connections(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            let view = cx.new(|cx| remote::ConnectionsView::new(window, cx));
            cx.subscribe(&view, |this, _, event: &remote::ConnectionsEvent, cx| match event {
                remote::ConnectionsEvent::OpenProject(path) => this.open_project_path(PathBuf::from(path), cx),
            })
            .detach();
            self.open_modal(view, window, cx);
        }
        #[cfg(target_family = "wasm")]
        {
            let _ = window;
            notifications::info(cx, "Remote projects need the desktop app");
        }
    }

    fn activate_project(&mut self, id: ProjectId, cx: &mut Context<Self>) {
        self.update_state(cx, |state| {
            state.activate_project(&id);
            state.show_project_view();
        });
    }

    fn open_session(&mut self, id: SessionId, window: &mut Window, cx: &mut Context<Self>) {
        if Self::is_narrow(window) {
            self.sidebar_overlay_open = false;
        }
        self.update_state(cx, |state| state.open_session(&id));
    }

    fn close_tab(&mut self, _: &CloseTab, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(index) = self.state.focused_tabs().and_then(|tabs| tabs.active) {
            self.close_tabs_guarded(move |state| state.close_tab(index), window, cx);
        }
    }

    fn show_global_search(&mut self, _: &ShowGlobalSearch, _: &mut Window, cx: &mut Context<Self>) {
        // Search puts away a menu or picker over the workbench, such as Run Actions; Quick Open,
        // the palette, the project picker and the database dialog replace it as modals.
        self.modal = None;
        self.open_menu = None;
        self.update_state(cx, |state| state.open_resource("search", "project", "Search"));
    }

    /// Floats a view over the workbench until it emits `DismissEvent`.
    pub fn open_modal<V>(&mut self, view: Entity<V>, window: &mut Window, cx: &mut Context<Self>)
    where
        V: Render + EventEmitter<DismissEvent> + Focusable,
    {
        self.open_menu = None;
        // A blocking modal (the palette, quick open, a dialog) takes over from the account menu.
        self.account_menu = None;
        let subscription = cx.subscribe_in(&view, window, |this, view, _: &DismissEvent, window, cx| {
            // A dialog that hands over to another must not close the one it opened.
            if this.modal.as_ref().is_some_and(|(modal, _)| modal.entity_id() != view.entity_id()) {
                return;
            }
            this.modal = None;
            window.focus(&this.focus_handle, cx);
            cx.notify();
        });
        window.focus(&view.focus_handle(cx), cx);
        self.modal = Some((view.into(), subscription));
        cx.notify();
    }

    /// Switch to Tab 1–9: the tab at that place in the group in front.
    /// Cmd-1…9: the terminal's own tabs while a terminal has focus (`terminal:activate-tab`),
    /// else the focused group's tabs.
    fn switch_to_tab(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let focused_terminal = self
            .terminal
            .iter()
            .map(|(terminal, _)| terminal.clone())
            .chain(self.session_panes.values().filter_map(|panes| panes.terminal_panel()))
            .find(|terminal| terminal.focus_handle(cx).contains_focused(window, cx));
        if let Some(terminal) = focused_terminal {
            terminal.update(cx, |terminal, cx| terminal.activate_index(index, window, cx));
            return;
        }
        if self.state.focused_tabs().is_some_and(|tabs| index < tabs.tabs.len()) {
            self.update_state(cx, |state| state.activate_tab(index));
            self.focus_front_tab(window, cx);
        }
    }

    /// Puts focus in the view of the tab now in front, or the workbench when it has none yet.
    /// The view that had focus may no longer be drawn, and keys pressed with focus on a view
    /// that is gone reach no handler at all.
    pub(crate) fn focus_front_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let handle = (!self.state.bottom_focused)
            .then(|| {
                let group = self.state.centre_panes()?.active;
                let item = self.state.focused_tabs()?.active_item()?;
                self.centre_views.get(&crate::centre_views::view_key(group, item))?.focus.clone()
            })
            .flatten()
            .unwrap_or_else(|| self.focus_handle.clone());
        window.focus(&handle, cx);
    }

    fn cycle_tab(&mut self, step: isize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(tabs) = self.state.focused_tabs() else { return };
        let count = tabs.tabs.len() as isize;
        if count == 0 {
            return;
        }
        let current = tabs.active.unwrap_or(0) as isize;
        let next = (current + step).rem_euclid(count) as usize;
        self.update_state(cx, |state| state.activate_tab(next));
        self.focus_front_tab(window, cx);
    }

    /// Puts each new toast away after a while.
    fn time_toasts(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<SharedString> = cx
            .try_global::<notifications::Notifications>()
            .map(|store| store.toasts().filter(|toast| !toast.sticky).map(|toast| toast.id.clone()).collect())
            .unwrap_or_default();
        self.timed_toasts.retain(|id| ids.contains(id));
        for id in ids {
            if !self.timed_toasts.insert(id.clone()) {
                continue;
            }
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(std::time::Duration::from_millis(notifications::TOAST_MS)).await;
                this.update(cx, |_, cx| {
                    if cx.try_global::<notifications::Notifications>().and_then(|store| store.get(&id)).is_some_and(|toast| !toast.sticky) {
                        notifications::dismiss_toast(cx, &id);
                    }
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
    }

    /// The bell: opens the Inbox beside the sidebar, or closes it.
    fn show_notifications(&mut self, _: &ShowNotifications, window: &mut Window, cx: &mut Context<Self>) {
        if self.inbox.is_some() {
            self.close_inbox(window, cx);
            return;
        }
        let panel = cx.new(notifications::InboxPanel::new);
        let subscription = cx.subscribe_in(&panel, window, |this, _, _: &gpui::DismissEvent, window, cx| this.close_inbox(window, cx));
        window.focus(&panel.focus_handle(cx), cx);
        self.inbox = Some((panel, subscription));
        cx.notify();
    }

    pub(crate) fn close_inbox(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some((panel, _)) = self.inbox.take()
            && panel.focus_handle(cx).contains_focused(window, cx)
        {
            window.focus(&self.focus_handle, cx);
        }
        cx.notify();
    }

    /// The Inbox as a column beside the sidebar, with a resize edge as the sidebar has.
    fn render_inbox_column(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let (panel, _) = self.inbox.as_ref()?;
        let resizing = matches!(self.drag, Some(Drag::Inbox { .. }));
        let line = if resizing { cx.theme().colors.primary } else { cx.theme().colors.border_strong };
        Some(
            div()
                .relative()
                .flex()
                .flex_col()
                .flex_none()
                .h_full()
                .w(px(self.state.layout.inbox_width.clamp(INBOX_MIN_WIDTH, INBOX_MAX_WIDTH)))
                .pr(metrics::WORKBENCH_GAP)
                .child(panel.clone())
                .child(
                    div()
                        .id("inbox-resize")
                        .absolute()
                        .top_0()
                        .bottom_0()
                        .right_0()
                        .w(metrics::WORKBENCH_GAP)
                        .flex()
                        .justify_center()
                        .cursor_col_resize()
                        .group("inbox-resize")
                        .child(div().w(px(1.)).h_full().when(resizing, |this| this.bg(line)).group_hover("inbox-resize", move |style| style.bg(line)))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, event: &gpui::MouseDownEvent, _, cx| {
                                this.drag = Some(Drag::Inbox { start_x: event.position.x, start_width: this.state.layout.inbox_width });
                                cx.stop_propagation();
                                cx.notify();
                            }),
                        )
                        .on_click(cx.listener(|this, event: &gpui::ClickEvent, _, cx| {
                            if event.click_count() == 2 {
                                this.update_state(cx, |state| state.layout.inbox_width = f32::from(notifications::INBOX_WIDTH));
                            }
                        })),
                ),
        )
    }

    /// In a narrow window the Inbox floats over the centre, as the sidebar does.
    fn render_inbox_overlay(&self, narrow: bool, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        if !narrow {
            return None;
        }
        let (panel, _) = self.inbox.as_ref()?;
        Some(
            div()
                .absolute()
                .inset_0()
                .child(div().id("inbox-backdrop").absolute().inset_0().on_click(cx.listener(|this, _, window, cx| this.close_inbox(window, cx))))
                .child(
                    div()
                        .absolute()
                        .top(metrics::WORKBENCH_GAP + metrics::PANE_HEADER)
                        .bottom(metrics::WORKBENCH_GAP)
                        .left(metrics::WORKBENCH_GAP + metrics::RAIL_CONTROL)
                        .w(notifications::INBOX_WIDTH)
                        .flex()
                        .flex_col()
                        .rounded(metrics::ISLAND_RADIUS)
                        .shadow(cx.theme().shadows.popover.clone())
                        .occlude()
                        .child(panel.clone()),
                ),
        )
    }

    /// "Editor: 110%" at the top right for a moment after a zoom level changes.
    fn render_zoom_badge(&mut self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let levels = (editor::zoom_level(cx), terminal_view::terminal_zoom(cx));
        if levels != self.zoom_seen {
            let (label, level) = if levels.0 != self.zoom_seen.0 { ("Editor", levels.0) } else { ("Terminal", levels.1) };
            self.zoom_seen = levels;
            let hide = cx.spawn(async move |this, cx| {
                cx.background_executor().timer(std::time::Duration::from_millis(1500)).await;
                this.update(cx, |this, cx| {
                    this.zoom_badge = None;
                    cx.notify();
                })
                .ok();
            });
            self.zoom_badge = Some((format!("{label}: {}%", (level * 100.).round()).into(), hide));
        }
        let (text, _) = self.zoom_badge.as_ref()?;
        let theme = cx.theme();
        Some(
            gpui::deferred(
                div()
                    .absolute()
                    .top(px(16.))
                    .right(px(16.))
                    .px(px(8.))
                    .py(px(4.))
                    .rounded(metrics::RADIUS_MD)
                    .bg(theme.colors.overlay)
                    .shadow(theme.shadows.popover.clone())
                    .text_size(typography::TEXT_SM)
                    .text_color(theme.colors.foreground)
                    .child(text.clone()),
            )
            .with_priority(3),
        )
    }

    /// Keeps a snapshot of a file the editor just saved, off the UI thread.
    pub(crate) fn record_local_history(&self, path: &std::path::Path, cx: &mut Context<Self>) {
        let Some(history) = local_history::LocalHistory::default_location() else { return };
        let path = path.to_path_buf();
        cx.background_spawn(async move {
            if let Err(error) = history.record(&path, "save", None) {
                eprintln!("local history: {error:#}");
            }
        })
        .detach();
    }

    fn show_local_history(&mut self, _: &ShowLocalHistory, window: &mut Window, cx: &mut Context<Self>) {
        let Some(workspace::TabItem::File { path }) = self.state.focused_tabs().and_then(|tabs| tabs.active_item()).cloned() else {
            notifications::notify(cx, notifications::NotificationKind::Warning, notifications::NotificationCategory::Athas, "Open a local file first.", None, None);
            return;
        };
        self.show_local_history_for(PathBuf::from(path), window, cx);
    }

    /// Project search limited to `dir` (the file tree's Find in Folder): its include filter is
    /// `dir/**` relative to the project, or cleared outside it.
    /// Add Folder to Workspace (`addFolderToWorkspace`): a local folder listed beside the
    /// project's, searched and watched with it; without a project it opens as one.
    pub(crate) fn add_folder_to_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(gpui::PathPromptOptions { files: false, directories: true, multiple: false, prompt: Some("Add".into()) });
        cx.spawn_in(window, async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            this.update_in(cx, |this, _, cx| {
                let folder = path.to_string_lossy().into_owned();
                let Some(project) = this.state.active_project().cloned() else {
                    this.update_state(cx, |state| {
                        state.open_project(&folder);
                    });
                    return;
                };
                if remote_projects::is_remote_or_wsl(&project.path) || remote_projects::is_remote_or_wsl(&folder) {
                    notifications::notify(cx, notifications::NotificationKind::Warning, notifications::NotificationCategory::Athas, "Add Folder to Workspace is only available for local folders.", None, None);
                    return;
                }
                let mut added = false;
                this.update_state(cx, |state| added = state.add_project_folder(&project.id, &folder));
                if !added {
                    notifications::info(cx, "Folder is already in this workspace.");
                }
            })
            .ok();
        })
        .detach();
    }

    fn find_in_folder(&mut self, dir: &std::path::Path, cx: &mut Context<Self>) {
        let root = self.state.active_project().map(|project| PathBuf::from(&project.path));
        let include = root
            .as_deref()
            .and_then(|root| dir.strip_prefix(root).ok())
            .filter(|relative| !relative.as_os_str().is_empty())
            .map(|relative| format!("{}/**", relative.to_string_lossy()))
            .unwrap_or_default();
        let open_search = self.centre_views.values().find_map(|view| view.view.clone().downcast::<search_panel::SearchView>().ok());
        match open_search {
            Some(search) => search.update(cx, |search, cx| search.set_include(include, cx)),
            None => self.pending_search_include = Some(include),
        }
        self.update_state(cx, |state| state.open_resource("search", "project", "Search"));
    }

    fn show_local_history_for(&mut self, path: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
        // Remote and virtual files keep no local history.
        if path.to_string_lossy().contains("://") {
            notifications::notify(cx, notifications::NotificationKind::Warning, notifications::NotificationCategory::Athas, "Select a local file first.", None, None);
            return;
        }
        let Some(history) = local_history::LocalHistory::default_location() else { return };
        let workbench = cx.weak_entity();
        let (open, prompt, current) = (workbench.clone(), workbench.clone(), workbench.clone());
        let file = path.clone();
        let delegate = local_history::LocalHistoryDelegate::new(path, std::rc::Rc::new(history), |path, _, cx| {
            notifications::info(cx, format!("Restored an earlier version of {}", path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()));
        })
        .on_open(move |snapshot, _, cx| {
            let path = editor::register_snapshot(&snapshot.id, &snapshot.title, &snapshot.file, snapshot.text);
            open.update(cx, |this, cx| this.open_file_at(path, None, None, cx)).ok();
        })
        .on_current_text(move |file, cx| {
            let workbench = current.upgrade()?;
            let workbench = workbench.read(cx);
            workbench.centre_views.values().filter_map(|view| view.editor.as_ref()).find(|editor| editor.read(cx).path() == file).map(|editor| editor.read(cx).text())
        })
        .on_diff(|request, _, cx| {
            let target = git_diff::DiffTarget::Files {
                title: request.title,
                path: request.file.to_string_lossy().into_owned(),
                old: request.old.to_string_lossy().into_owned(),
                new: request.new.to_string_lossy().into_owned(),
            };
            git_diff::open_diff(cx, None, &target);
        })
        .on_prompt(move |title, message, value, apply, window, cx| {
            let file = file.clone();
            prompt
                .update(cx, |this, cx| {
                    let reopen = cx.weak_entity();
                    let dialog = cx.new(|cx| {
                        ui::PromptDialog::new(
                            title,
                            message,
                            value,
                            move |answer, window, cx| {
                                apply(answer.to_string(), window, cx);
                                let file = file.clone();
                                reopen.update(cx, |this, cx| this.show_local_history_for(file, window, cx)).ok();
                            },
                            window,
                            cx,
                        )
                        .placeholder("Optional name", cx)
                    });
                    this.open_modal(dialog, window, cx);
                })
                .ok();
        });
        let picker = cx.new(|cx| palette::Picker::new(delegate, window, cx));
        self.open_modal(picker, window, cx);
    }

    pub(crate) fn ensure_diagnostics(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<Entity<diagnostics_panel::DiagnosticsPanel>> {
        let root = self.state.active_project().map(|project| PathBuf::from(&project.path));
        let active_file = self.active_editor().map(|editor| editor.read(cx).path().to_path_buf());
        if let Some((view, _)) = &self.diagnostics {
            view.update(cx, |view, cx| {
                view.set_project_root(root, cx);
                if active_file.is_some() {
                    view.set_active_file(active_file, cx);
                }
            });
            return Some(view.clone());
        }
        let view = cx.new(|cx| {
            let mut view = diagnostics_panel::DiagnosticsPanel::new(root, window, cx);
            view.set_active_file(active_file, cx);
            view
        });
        let subscription = cx.subscribe_in(&view, window, |this, _, event: &diagnostics_panel::PanelEvent, _, cx| match event {
            diagnostics_panel::PanelEvent::OpenLocation { path, line, column } => {
                this.open_file_at(path.clone(), Some(*line as u32), Some(*column as u32), cx)
            }
        });
        self.diagnostics = Some((view.clone(), subscription));
        Some(view)
    }

    pub(crate) fn ensure_references(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<diagnostics_panel::ReferencesView> {
        if let Some((view, _)) = &self.references {
            return view.clone();
        }
        let root = self.state.active_project().map(|project| PathBuf::from(&project.path));
        let view = cx.new(|cx| diagnostics_panel::ReferencesView::new(root, cx));
        let subscription = cx.subscribe_in(&view, window, |this, _, event: &diagnostics_panel::PanelEvent, _, cx| match event {
            diagnostics_panel::PanelEvent::OpenLocation { path, line, column } => {
                this.open_file_at(path.clone(), Some(*line as u32), Some(*column as u32), cx)
            }
        });
        // The header's Fullscreen button fills the centre with the group in front, as
        // `workbench.toggleActivePaneFullscreen` does for an editor.
        let full_screen = cx.subscribe(&view, |this, view, event: &diagnostics_panel::ReferencesEvent, cx| match event {
            diagnostics_panel::ReferencesEvent::ToggleFullScreen => {
                let active = this.state.focused_panes().map(|panes| panes.active);
                this.fullscreen_group = if this.fullscreen_group.is_some() { None } else { active };
                this.centre_maximized = this.fullscreen_group.is_some();
                let full = this.fullscreen_group.is_some();
                view.update(cx, |view, cx| view.set_full_screen(full, cx));
                cx.notify();
            }
        });
        self._references_full_screen = Some(full_screen);
        self.references = Some((view.clone(), subscription));
        view
    }

    pub(crate) fn ensure_outline(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<outline_panel::OutlinePanel> {
        if let Some((view, _)) = &self.outline {
            return view.clone();
        }
        let view = cx.new(|cx| outline_panel::OutlinePanel::new(window, cx));
        let subscription = cx.subscribe(&view, |this, _, event: &outline_panel::OutlineEvent, cx| match event {
            outline_panel::OutlineEvent::OpenLocation { path, .. } => {
                let path = path.to_string_lossy().into_owned();
                this.update_state(cx, |state| state.open_file(&path));
            }
        });
        self.outline = Some((view.clone(), subscription));
        view
    }

    /// `coreFeatures.breadcrumbs`: a bar above every file tab's editor.
    fn sync_breadcrumbs(&mut self, cx: &mut Context<Self>) {
        {
            let centre_views = &self.centre_views;
            self.editor_status.borrow_mut().retain(|key, status| {
                centre_views
                    .get(key)
                    .and_then(|view| view.editor.as_ref())
                    .is_some_and(|editor| status.read(cx).editor().upgrade().is_some_and(|status_editor| status_editor.entity_id() == editor.entity_id()))
            });
        }
        if !settings::get(cx).core_features.breadcrumbs {
            self.breadcrumbs.clear();
            return;
        }
        let root = Some(self.active_root()).filter(|root| !root.is_empty()).map(PathBuf::from);
        let centre_views = &self.centre_views;
        self.breadcrumbs.retain(|key, crumbs| {
            centre_views.get(key).and_then(|view| view.editor.as_ref()).is_some_and(|editor| crumbs.read(cx).editor().entity_id() == editor.entity_id())
        });
        for (key, view) in centre_views {
            let Some(editor) = view.editor.clone() else { continue };
            match self.breadcrumbs.get(key) {
                Some(crumbs) => crumbs.update(cx, |crumbs, _| crumbs.set_root(root.clone())),
                None => {
                    let crumbs = cx.new(|cx| outline_panel::breadcrumbs::Breadcrumbs::new(editor, root.clone(), cx));
                    self.breadcrumbs.insert(key.clone(), crumbs);
                }
            }
        }
    }

    /// The editor of the file most recently in front, for the outline.
    fn sync_outline(&mut self, cx: &mut Context<Self>) {
        let Some((outline, _)) = &self.outline else { return };
        let Some(panes) = self.state.focused_panes() else { return };
        let editor_of = |group: &workspace::PaneGroup| match group.tabs.active_item() {
            Some(item @ workspace::TabItem::File { .. }) => self.centre_views.get(&centre_views::view_key(group.id, item)).and_then(|view| view.editor.clone()),
            _ => None,
        };
        let editor = panes
            .groups
            .iter()
            .find(|group| group.id == panes.active)
            .and_then(editor_of)
            .or_else(|| panes.groups.iter().find_map(editor_of));
        if let Some(editor) = editor {
            outline.update(cx, |outline, cx| outline.set_editor(Some(editor), cx));
        }
    }

    fn share_session(&mut self, _: &collaboration::ShareSession, window: &mut Window, cx: &mut Context<Self>) {
        let Some(session) = self.state.focused_session().cloned() else {
            notifications::info(cx, "Open a session to share it");
            return;
        };
        let Some(draft) = agent_ui::persistence::sessions_dir()
            .and_then(|dir| collaboration::sharing::agent_draft_from_disk(&dir, &session.id.0, &session.title))
        else {
            notifications::info(cx, "This session has nothing to share yet");
            return;
        };
        let dialog = cx.new(|cx| collaboration::ShareDialog::new(draft, window, cx));
        self.open_modal(dialog, window, cx);
    }

    /// Shares the file in front, or its selected code, to the web (`shareEditor`).
    fn share_editor(&mut self, selection_only: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(editor) = self.active_editor() else { return };
        let draft = {
            let editor = editor.read(cx);
            let path = editor.path().to_string_lossy().into_owned();
            let title = editor.path().file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
            let ((start, _), _, selected) = editor.selection_points();
            if selection_only && selected.is_empty() {
                return;
            }
            let selection = selection_only.then_some((start, selected));
            collaboration::sharing::editor_draft(&path, &title, editor.language_name(), editor.text(), selection)
        };
        let dialog = cx.new(|cx| collaboration::ShareDialog::new(draft, window, cx));
        self.open_modal(dialog, window, cx);
    }

    /// Opens the session in front as a team share, ready to hand off or ask for a review.
    fn send_session_to_team(&mut self, send: collaboration::SendTo, cx: &mut Context<Self>) {
        let Some(session) = self.state.focused_session().cloned() else { return };
        self.pending_team_send = Some(send);
        let (id, title) = (session.id.0.clone(), session.title.clone());
        self.update_state(cx, |state| state.open_resource("team-session", &id, &title));
    }

    /// The account menu, floating from the avatar at the foot of the activity bar.
    fn toggle_account_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(chrome) = web_chrome::web_chrome(cx) {
            self.toggle_web_account_menu(&chrome, window, cx);
            return;
        }
        if self.account_menu.take().is_some() {
            cx.notify();
            return;
        }
        let menu = cx.new(|cx| account::AccountMenu::new(window, cx));
        let dismiss = cx.subscribe_in(&menu, window, |this, _, _: &DismissEvent, window, cx| {
            this.account_menu = None;
            window.focus(&this.focus_handle, cx);
            cx.notify();
        });
        let events = cx.subscribe_in(&menu, window, |this, _, event: &account::AccountMenuEvent, window, cx| {
            this.account_menu = None;
            match event {
                account::AccountMenuEvent::OpenSettings(page) => this.open_settings_page(*page, window, cx),
                account::AccountMenuEvent::OpenTeam => this.update_state(cx, |state| state.open_resource("team", "", "Team")),
            }
            cx.notify();
        });
        window.focus(&menu.focus_handle(cx), cx);
        self.account_menu = Some((menu, vec![dismiss, events]));
        cx.notify();
    }

    /// The Run and Debug view of the project in front, made when first needed.
    pub(crate) fn ensure_debugger(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<Entity<debugger_ui::DebuggerView>> {
        let root = PathBuf::from(&self.state.active_project()?.path);
        if let Some((debugger, _)) = &self.debugger {
            return Some(debugger.clone());
        }
        let debugger = cx.new(|cx| debugger_ui::DebuggerView::new(root, window, cx));
        // The custom debug command and an adapter's `runInTerminal` run in a terminal tab.
        debugger.update(cx, |debugger, _| {
            debugger.set_run_in_terminal(Some(Rc::new(|request: dap::RunInTerminal, cx: &mut App| {
                workbench_api::run_in_terminal(cx, run_in_terminal_command(&request), request.cwd.clone());
                Ok(None)
            })))
        });
        let subscription = cx.subscribe_in(&debugger, window, |this, _, event: &debugger_ui::DebuggerViewEvent, window, cx| match event {
            debugger_ui::DebuggerViewEvent::OpenLocation { path, line } => this.open_file_at(path.clone(), Some(*line), None, cx),
            debugger_ui::DebuggerViewEvent::ShowPicker(picker) => this.open_modal(picker.clone(), window, cx),
        });
        self.debugger = Some((debugger.clone(), subscription));
        Some(debugger)
    }

    /// Run and Debug in the bottom pane (`openDebuggerPane`); `toggle` puts it away when it shows.
    pub(crate) fn show_debugger_pane(&mut self, toggle: bool, window: &mut Window, cx: &mut Context<Self>) {
        if toggle && self.state.layout.bottom_pane_visible && self.state.layout.bottom_tab == workspace::BottomTab::Debugger {
            self.bottom_full_screen = false;
            self.update_state(cx, |state| state.layout.bottom_pane_visible = false);
            window.focus(&self.focus_handle, cx);
            return;
        }
        let Some(debugger) = self.ensure_debugger(window, cx) else {
            notifications::info(cx, "Open a project to debug it");
            return;
        };
        self.update_state(cx, |state| state.show_bottom_tab(workspace::BottomTab::Debugger));
        window.focus(&debugger.focus_handle(cx), cx);
    }

    /// Moves a centre tab into the bottom pane's groups and shows them.
    pub(crate) fn move_tab_to_bottom(&mut self, group: u64, index: usize, _: &mut Window, cx: &mut Context<Self>) {
        self.tab_drop_zone = None;
        self.update_state(cx, |state| {
            if state.move_tab_to_bottom(group, index) {
                state.show_bottom_tab(workspace::BottomTab::Buffers);
            }
        });
    }

    /// Toggles a breakpoint on the line the cursor is on in the file in front.
    fn toggle_breakpoint(&mut self, _: &ToggleBreakpoint, _: &mut Window, cx: &mut Context<Self>) {
        let Some(panes) = self.state.focused_panes() else { return };
        let Some(group) = panes.group(panes.active) else { return };
        let Some(workspace::TabItem::File { path }) = group.tabs.active_item() else { return };
        let key = centre_views::view_key(group.id, &workspace::TabItem::File { path: path.clone() });
        let Some(editor) = self.centre_views.get(&key).and_then(|view| view.editor.clone()) else { return };
        // The editor counts lines from 1, breakpoints from 0.
        let row = editor.read(cx).cursor_position().0.saturating_sub(1);
        let path = PathBuf::from(path);
        let store = dap::BreakpointStore::global(cx);
        store.update(cx, |store, cx| {
            store.toggle(&path, row as u32, cx);
        });
    }

    fn save_all(&mut self, _: &SaveAll, _: &mut Window, cx: &mut Context<Self>) {
        let editors: Vec<_> = self.centre_views.values().filter_map(|view| view.editor.clone()).collect();
        for editor in editors {
            editor.update(cx, |editor, cx| editor.save_if_dirty(cx));
        }
    }

    pub fn has_modal(&self) -> bool {
        self.modal.is_some()
    }

    // Menus.

    fn show_menu(
        &mut self,
        key: &str,
        entries: Vec<MenuEntry>,
        position: Point<Pixels>,
        anchor: Anchor,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == key) {
            self.open_menu = None;
            cx.notify();
            return;
        }
        self.open_menu = Some(OpenMenu::new(
            key.to_string(),
            entries,
            position,
            anchor,
            window,
            cx,
            |this: &mut Self, _| this.open_menu = None,
        ));
        cx.notify();
    }

    fn menu_is_open(&self, key: &str) -> bool {
        self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == key)
    }

    /// Open project…, then folders opened before that are not open now.
    fn add_project_entries(&self, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let weak = cx.weak_entity();
        let mut entries: Vec<MenuEntry> = vec![
            MenuItem::new("Open project…")
                .icon(ui::IconName::FolderOpen)
                .shortcut(self.platform.shortcut("⌘O", "Ctrl+O"))
                .on_select({
                    let weak = weak.clone();
                    move |_, cx| {
                        weak.update(cx, |this, cx| this.prompt_open_project(cx)).ok();
                    }
                })
                .into(),
            MenuItem::new("Open remote…")
                .icon(ui::IconName::Remote)
                .on_select({
                    let weak = weak.clone();
                    move |window, cx| {
                        weak.update(cx, |this, cx| this.show_remote_connections(window, cx)).ok();
                    }
                })
                .into(),
        ];
        let recent: Vec<_> = self
            .state
            .recent_projects
            .iter()
            .filter(|recent| !self.state.projects.iter().any(|project| project.path == recent.path))
            .take(8)
            .cloned()
            .collect();
        if !recent.is_empty() {
            entries.push(MenuEntry::Separator);
            entries.push(MenuEntry::Label("Recent".into()));
            for recent in recent {
                let weak = weak.clone();
                entries.push(
                    MenuItem::new(recent.name.clone())
                        .icon(ui::IconName::Folder)
                        .on_select(move |_, cx| {
                            let path = PathBuf::from(&recent.path);
                            weak.update(cx, |this, cx| this.open_project_path(path, cx)).ok();
                        })
                        .into(),
                );
            }
        }
        entries
    }

    fn project_menu_entries(&self, id: &ProjectId, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let weak = cx.weak_entity();
        let Some(project) = self.state.project(id).cloned() else { return Vec::new() };
        let path = project.path.clone();
        let mut entries: Vec<MenuEntry> = vec![
            MenuItem::new("Open dashboard")
                .icon(ui::IconName::Folder)
                .on_select({
                    let weak = weak.clone();
                    let id = id.clone();
                    move |_, cx| {
                        weak.update(cx, |this, cx| this.update_state(cx, |state| state.open_project_dashboard(&id))).ok();
                    }
                })
                .into(),
            MenuItem::new("Show project files")
                .icon(ui::IconName::SidebarRight)
                .on_select({
                    let weak = weak.clone();
                    let id = id.clone();
                    move |window, cx| {
                        weak.update(cx, |this, cx| {
                            this.activate_project(id.clone(), cx);
                            this.toggle_sidebar_view(SidebarView::Files, window, cx);
                        })
                        .ok();
                    }
                })
                .into(),
            MenuItem::new("New session")
                .icon(ui::IconName::Plus)
                .on_select({
                    let weak = weak.clone();
                    let id = id.clone();
                    move |_, cx| {
                        weak.update(cx, |this, cx| this.start_session(Some(id.clone()), cx)).ok();
                    }
                })
                .into(),
        ];
        if !project.is_remote() {
            let tool = |label: &'static str, icon: ui::IconName, kind: &'static str, title: &'static str| -> MenuEntry {
                let weak = weak.clone();
                let id = id.clone();
                let path = path.clone();
                MenuItem::new(label)
                    .icon(icon)
                    .on_select(move |_, cx| {
                        weak.update(cx, |this, cx| {
                            this.activate_project(id.clone(), cx);
                            this.update_state(cx, |state| state.open_resource(kind, &path, title));
                        })
                        .ok();
                    })
                    .into()
            };
            entries.push(tool("Skills", ui::IconName::BookOpen, agent_ui::skills::RESOURCE_KIND, "Skills"));
            entries.push(tool("Cloud agents", ui::IconName::Cloud, agent_ui::cloud::RUNS_KIND, "Cloud Agents"));
        }
        entries.push(MenuEntry::Separator);
        if !project.is_remote() && self.platform != Platform::Web {
            let path = path.clone();
            entries.push(
                MenuItem::new(match self.platform {
                    Platform::Mac => "Reveal in Finder",
                    Platform::Windows => "Reveal in File Explorer",
                    _ => "Reveal in file manager",
                })
                .icon(ui::IconName::FolderOpen)
                .on_select(move |_, cx| {
                    if let Err(error) = file_tree::reveal(std::path::Path::new(&path), cx) {
                        notifications::info(cx, error);
                    }
                })
                .into(),
            );
        }
        entries.push(
            MenuItem::new("Copy path")
                .icon(ui::IconName::Copy)
                .on_select({
                    let path = path.clone();
                    move |_, cx| cx.write_to_clipboard(ClipboardItem::new_string(path.clone()))
                })
                .into(),
        );
        if !project.is_remote() {
            let id = id.clone();
            let weak = weak.clone();
            entries.push(
                MenuItem::new("Select project icon…")
                    .icon(ui::IconName::Image)
                    .on_select(move |window, cx| {
                        weak.update(cx, |this, cx| this.show_project_icon_picker(&id, window, cx)).ok();
                    })
                    .into(),
            );
        }
        entries.push(MenuEntry::Separator);
        entries.push(
            MenuItem::new("Close project")
                .icon(ui::IconName::X)
                .on_select({
                    let weak = weak.clone();
                    let id = id.clone();
                    move |window, cx| {
                        let id = id.clone();
                        weak.update(cx, |this, cx| this.close_tabs_guarded(move |state| state.close_project(&id), window, cx)).ok();
                    }
                })
                .into(),
        );
        entries.push(
            MenuItem::new("Remove from Athas")
                .icon(ui::IconName::Trash)
                .destructive()
                .on_select({
                    let id = id.clone();
                    move |window, cx| {
                        let id = id.clone();
                        weak.update(cx, |this, cx| this.close_tabs_guarded(move |state| state.remove_project(&id), window, cx)).ok();
                    }
                })
                .into(),
        );
        entries
    }

    /// A session's actions (`SessionSidebarRow`): its More actions menu (`context` false) holds
    /// Open in New Window, Pin, Rename, Archive and Delete; the right-click menu leads with Open,
    /// and while the session is in another window only Open and Open in New Window work.
    fn session_menu_entries(&self, id: &SessionId, context: bool, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let weak = cx.weak_entity();
        let Some(session) = self.state.session(id) else { return Vec::new() };
        let pinned = session.pinned;
        let archived = session.archived_at.is_some();
        let title = session.title.clone();
        let elsewhere = context && crate::detached::session_is_detached(&id.0, cx);
        let item = |label: &'static str, icon: ui::IconName, change: fn(&mut WorkspaceState, &SessionId)| {
            let weak = weak.clone();
            let id = id.clone();
            MenuItem::new(label).icon(icon).disabled(elsewhere).on_select(move |_, cx| {
                weak.update(cx, |this, cx| this.update_state(cx, |state| change(state, &id))).ok();
            })
        };
        let new_window = {
            let weak = weak.clone();
            let id = id.clone();
            MenuItem::new("Open in New Window").icon(ui::IconName::WindowExpand).on_select(move |_, cx| {
                weak.update(cx, |this, cx| this.move_session_to_new_window(&id, cx)).ok();
            })
        };
        let rename = {
            let weak = weak.clone();
            let id = id.clone();
            MenuItem::new("Rename").icon(ui::IconName::PencilLine).disabled(elsewhere).on_select(move |window, cx| {
                weak.update(cx, |this, cx| this.start_session_rename(&id, window, cx)).ok();
            })
        };
        let delete = {
            let weak = weak.clone();
            let id = id.clone();
            MenuItem::new("Delete")
                .icon(ui::IconName::Trash)
                .disabled(elsewhere)
                .on_select(move |window, cx| {
                    let id = id.clone();
                    let title = title.clone();
                    weak.update(cx, |this, cx| this.confirm_delete_session(id, title, window, cx)).ok();
                })
                .destructive()
        };
        let mut entries: Vec<MenuEntry> = Vec::new();
        if context {
            entries.push(item("Open", ui::IconName::ChatBubbleText, |state, id| state.open_session(id)).disabled(false).into());
        }
        entries.push(new_window.into());
        entries.push(if pinned {
            item("Unpin", ui::IconName::PinSlash, |state, id| state.set_session_pinned(id, false)).into()
        } else {
            item("Pin", ui::IconName::Pin, |state, id| state.set_session_pinned(id, true)).into()
        });
        entries.push(rename.into());
        entries.push(if archived {
            item("Restore", ui::IconName::ArrowCounterClockwise, |state, id| state.archive_session(id, false)).into()
        } else {
            item("Archive", ui::IconName::Archive, |state, id| state.archive_session(id, true)).into()
        });
        entries.push(MenuEntry::Separator);
        entries.push(delete.into());
        entries
    }

    /// Asks before deleting a session (`confirmDeleteChat`).
    fn confirm_delete_session(&mut self, id: SessionId, title: String, window: &mut Window, cx: &mut Context<Self>) {
        let weak = cx.weak_entity();
        let dialog = ui::AlertDialog::confirm(
            "Delete Session",
            format!("Delete \u{201c}{title}\u{201d}? This cannot be undone."),
            ui::ConfirmOptions { confirm_label: "Delete".into(), destructive: true, ..Default::default() },
            move |_, cx| {
                let id = id.clone();
                weak.update(cx, |this, cx| {
                    let key = crate::centre_views::tab_key(&TabItem::Session { id: id.clone() });
                    if let Some(session) = this.centre_views.get(&key).and_then(|view| view.session.clone()) {
                        session.update(cx, |session, cx| session.close_agent_session(cx));
                    }
                    agent_ui::review::Store::global().forget(&id.0);
                    this.update_state(cx, |state| state.delete_session(&id));
                })
                .ok();
            },
            cx,
        );
        self.open_modal(dialog, window, cx);
    }

    // Window chrome.

    /// Makes an element a place to drag the window from, as the title rows are.
    fn drag_region<E: InteractiveElement + StatefulInteractiveElement>(&self, element: E, cx: &mut Context<Self>) -> E {
        element
            .window_control_area(gpui::WindowControlArea::Drag)
            .on_mouse_down(MouseButton::Left, cx.listener(|this, _, _, _| this.should_move_window = true))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _, _, _| this.should_move_window = false))
            .on_mouse_move(cx.listener(|this, _: &MouseMoveEvent, window, cx| {
                if this.should_move_window {
                    this.should_move_window = false;
                    // A tab being dragged (started by the tab, which sees the move first) is not a window drag.
                    if !cx.has_active_drag() {
                        window.start_window_move();
                    }
                }
            }))
            .on_click(|event, window, _| {
                if event.click_count() == 2 && cfg!(target_os = "macos") {
                    window.titlebar_double_click();
                }
            })
    }

    fn on_drag_move(&mut self, event: &MouseMoveEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(drag) = self.drag else { return };
        if !event.dragging() {
            self.drag = None;
            self.save();
            cx.notify();
            return;
        }
        let viewport = window.viewport_size();
        match drag {
            Drag::Sidebar { start_x, start_width } => {
                let max = f32::from(viewport.width - metrics::MIN_CENTRE_WIDTH - metrics::RAIL_CONTROL).max(200.);
                let width = (start_width + f32::from(event.position.x - start_x))
                    .clamp(f32::from(metrics::SIDEBAR_MIN_WIDTH), max);
                self.state.layout.sidebar_width = width;
            }
            Drag::Inbox { start_x, start_width } => {
                let sidebar = if self.state.layout.sidebar_visible { self.state.layout.sidebar_width } else { 0. };
                let max = f32::from(viewport.width - metrics::MIN_CENTRE_WIDTH - metrics::RAIL_CONTROL - px(sidebar)).max(INBOX_MIN_WIDTH);
                let width = (start_width + f32::from(event.position.x - start_x)).clamp(INBOX_MIN_WIDTH, max.min(INBOX_MAX_WIDTH));
                self.state.layout.inbox_width = width;
            }
            Drag::Split { split, horizontal, start, start_ratio } => {
                let size = self.split_sizes.borrow().get(&split).copied().unwrap_or(px(0.));
                if size > px(0.) {
                    let position = if horizontal { event.position.x } else { event.position.y };
                    let ratio = start_ratio + f32::from(position - start) / f32::from(size);
                    self.state.set_split_ratio(split, ratio);
                }
            }
            Drag::BottomPane { start_y, start_height } => {
                let max = f32::from(viewport.height * 0.8);
                let height = (start_height - f32::from(event.position.y - start_y)).clamp(120., max);
                self.state.layout.bottom_pane_height = height;
            }
        }
        cx.notify();
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.folder_picker_requested {
            self.open_folder_picker(window, cx);
        }
        self.sync_tool_views(window, cx);
        self.sync_window_label(window, cx);
        self.sync_document_state(window);
        self.publish_editor_index(window, cx);
        let theme = cx.theme().clone();
        let narrow = Self::is_narrow(window);
        // A full-screen editor group takes the whole workbench, sidebars included.
        let pane_fullscreen = self
            .fullscreen_group
            .is_some_and(|group| self.state.centre_panes().is_some_and(|panes| panes.group(group).is_some()));
        let sidebar_column = self.state.layout.sidebar_visible && !narrow && !pane_fullscreen;
        let window_tabs = self.window_tabs(window, cx);
        // With window tabs, the traffic lights sit in the tab row above the workbench.
        let traffic_lights = self.platform.has_traffic_lights() && !window.is_fullscreen() && window_tabs.is_empty();
        let dragging = self.drag.is_some();

        // A narrow window gives the window controls a title row of their own, since the activity
        // bar stays beside the centre and they would straddle the two.
        let title_row = narrow.then(|| {
            self.drag_region(div().id("title-row").h(metrics::PANE_HEADER).w_full().flex_none(), cx)
        });
        let body = div()
            .relative()
            .flex()
            .flex_row()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .p(metrics::WORKBENCH_GAP)
            .when(narrow, |this| this.pt_0())
            .when(sidebar_column || (narrow && !pane_fullscreen), |this| this.child(self.render_activity_bar(window, cx)))
            .when(sidebar_column, |this| this.child(self.render_sidebar_column(window, cx)))
            .when(!narrow && !pane_fullscreen, |this| this.children(self.render_inbox_column(cx)))
            .child(self.render_centre(sidebar_column || (narrow && !pane_fullscreen), traffic_lights, window, cx));

        let window_tab_row = (!window_tabs.is_empty()).then(|| self.render_window_tabs(window_tabs, window, cx));
        let content = div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .children(title_row)
            .child(body)
            .children(self.render_sidebar_overlay(narrow, window, cx))
            .children(self.render_inbox_overlay(narrow, cx))
            .child(self.render_title_leading(sidebar_column, traffic_lights, window, cx))
            .children(self.render_window_controls(window, cx));

        let root = div()
            .id("workbench")
            .group("workbench")
            .key_context("Workbench")
            .track_focus(&self.focus_handle)
            .map(|this| more_commands::handlers(this, cx))
            .map(|this| agent_commands::handlers(this, cx))
            .map(|this| git_commands::handlers(this, self.state.active_project().map(|project| std::path::Path::new(&project.path)), cx))
            .on_action(cx.listener(Self::toggle_sidebar))
            .on_action(cx.listener(Self::toggle_terminal))
            .on_action(cx.listener(Self::new_session))
            .on_action(cx.listener(Self::open_project))
            .on_action(cx.listener(Self::open_remote))
            .on_action(cx.listener(|this, _: &ShowProjectPicker, window, cx| this.show_project_picker(ProjectPickerStep::Picker, window, cx)))
            .on_action(cx.listener(|this, _: &NewProject, window, cx| this.show_project_picker(ProjectPickerStep::NewProject, window, cx)))
            .on_action(cx.listener(|this, _: &CloseWindow, window, cx| this.request_close(CloseIntent::Close, window, cx)))
            .on_action(cx.listener(|this, _: &Quit, window, cx| {
                close_guard::start_quit(window, cx);
                this.request_close(CloseIntent::Quit, window, cx)
            }))
            .on_action(cx.listener(|this, _: &SwitchToTab1, window, cx| this.switch_to_tab(0, window, cx)))
            .on_action(cx.listener(|this, _: &SwitchToTab2, window, cx| this.switch_to_tab(1, window, cx)))
            .on_action(cx.listener(|this, _: &SwitchToTab3, window, cx| this.switch_to_tab(2, window, cx)))
            .on_action(cx.listener(|this, _: &SwitchToTab4, window, cx| this.switch_to_tab(3, window, cx)))
            .on_action(cx.listener(|this, _: &SwitchToTab5, window, cx| this.switch_to_tab(4, window, cx)))
            .on_action(cx.listener(|this, _: &SwitchToTab6, window, cx| this.switch_to_tab(5, window, cx)))
            .on_action(cx.listener(|this, _: &SwitchToTab7, window, cx| this.switch_to_tab(6, window, cx)))
            .on_action(cx.listener(|this, _: &SwitchToTab8, window, cx| this.switch_to_tab(7, window, cx)))
            .on_action(cx.listener(|this, _: &SwitchToTab9, window, cx| this.switch_to_tab(8, window, cx)))
            .on_drop(cx.listener(|this, paths: &gpui::ExternalPaths, _, cx| this.open_dropped_paths(paths.paths(), cx)))
            .on_action(cx.listener(Self::close_tab))
            .on_action(cx.listener(Self::show_global_search))
            .on_action(cx.listener(Self::quick_open))
            .on_action(cx.listener(Self::command_palette))
            .on_action(cx.listener(Self::open_settings))
            .on_action(cx.listener(Self::new_terminal_window))
            .on_action(cx.listener(Self::new_settings_window))
            .on_action(cx.listener(Self::new_extensions_window))
            .on_action(cx.listener(Self::select_theme))
            .on_action(cx.listener(|this, _: &ShowAgents, window, cx| this.show_sidebar_view(SidebarView::Agents, window, cx)))
            .on_action(cx.listener(|this, _: &ShowFiles, window, cx| this.show_sidebar_view(SidebarView::Files, window, cx)))
            .on_action(cx.listener(|this, _: &ShowSourceControl, window, cx| this.show_sidebar_view(SidebarView::Git, window, cx)))
            .on_action(cx.listener(|this, _: &ShowGitHub, window, cx| this.show_sidebar_view(SidebarView::GitHub, window, cx)))
            .on_action(cx.listener(|this, _: &ToggleMaximize, _, cx| {
                this.centre_maximized = !this.centre_maximized;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &CloseProject, window, cx| {
                if let Some(id) = this.state.active_project.clone() {
                    this.close_tabs_guarded(move |state| state.close_project(&id), window, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &NewChat, _, cx| this.start_session(None, cx)))
            .on_action(cx.listener(|this, _: &NextTab, window, cx| this.cycle_tab(1, window, cx)))
            .on_action(cx.listener(|this, _: &PreviousTab, window, cx| this.cycle_tab(-1, window, cx)))
            .on_action(cx.listener(|_, _: &ToggleDock, _, cx| agent_ui::toggle_session_side_panel(cx)))
            .on_action(|_: &MinimizeWindow, window, _| window.minimize_window())
            .on_action(|_: &ZoomWindow, window, _| window.zoom_window())
            .on_action(|_: &ToggleFullscreen, window, _| window.toggle_fullscreen())
            .on_action(cx.listener(Self::show_notifications))
            .on_action(cx.listener(Self::show_run_actions))
            .on_action(cx.listener(Self::show_local_history))
            .on_action(cx.listener(|this, _: &ShowProblems, _, cx| {
                this.update_state(cx, |state| state.open_resource("problems", "", "Diagnostics"))
            }))
            .on_action(cx.listener(|this, _: &ShowOutline, _, cx| {
                this.update_state(cx, |state| state.open_resource("outline", "", "Outline"))
            }))
            .on_action(cx.listener(|this, _: &ShowSessionHistory, _, cx| {
                this.update_state(cx, |state| state.open_resource("history", "", "History"))
            }))
            .on_action(cx.listener(|this, _: &ShowSkills, _, cx| {
                let root = this.active_root();
                this.update_state(cx, |state| state.open_resource(agent_ui::skills::RESOURCE_KIND, &root, "Skills"))
            }))
            .on_action(cx.listener(|this, _: &ShowCloudAgents, _, cx| {
                let root = this.active_root();
                this.update_state(cx, |state| state.open_resource(agent_ui::cloud::RUNS_KIND, &root, "Cloud Agents"))
            }))
            .on_action(cx.listener(Self::review_agent_changes))
            .on_action(cx.listener(|this, _: &agent_ui::review::KeepAllAgentChanges, _, cx| this.resolve_all_agent_changes(true, cx)))
            .on_action(cx.listener(|this, _: &agent_ui::review::RejectAllAgentChanges, _, cx| this.resolve_all_agent_changes(false, cx)))
            .on_action(cx.listener(|this, _: &agent_ui::review::KeepAgentHunk, _, cx| this.resolve_agent_hunk(true, cx)))
            .on_action(cx.listener(|this, _: &agent_ui::review::RejectAgentHunk, _, cx| this.resolve_agent_hunk(false, cx)))
            .on_action(cx.listener(|this, _: &NewCloudSession, window, cx| this.start_cloud_session(window, cx)))
            .on_action(cx.listener(|this, _: &NewAthasAgentSession, _, cx| {
                let project = this.state.active_project.clone();
                this.centre_maximized = false;
                this.update_state(cx, |state| {
                    state.new_session(project, agent_ui::builtin::AGENT_ID);
                });
            }))
            .on_action(cx.listener(|this, _: &SendFeedback, window, cx| {
                let dialog = cx.new(|cx| account::FeedbackDialog::new(env!("CARGO_PKG_VERSION"), window, cx));
                this.open_modal(dialog, window, cx);
            }))
            .on_action(cx.listener(|this, _: &collaboration::OpenTeam, _, cx| {
                this.update_state(cx, |state| state.open_resource("team", "", "Team"))
            }))
            .on_action(cx.listener(Self::share_session))
            .on_action(cx.listener(|this, _: &collaboration::ShareBuffer, window, cx| this.share_editor(false, window, cx)))
            .on_action(cx.listener(|this, _: &collaboration::ShareSelection, window, cx| this.share_editor(true, window, cx)))
            .on_action(cx.listener(|this, _: &collaboration::HandOffSession, _, cx| this.send_session_to_team(collaboration::SendTo::HandOff, cx)))
            .on_action(cx.listener(|this, _: &collaboration::RequestReview, _, cx| this.send_session_to_team(collaboration::SendTo::Review, cx)))
            .on_action(cx.listener(|this, _: &ToggleAccountMenu, window, cx| this.toggle_account_menu(window, cx)))
            .on_action(cx.listener(Self::open_github_repository))
            .on_action(cx.listener(|this, _: &ShowDebugger, window, cx| this.show_debugger_pane(true, window, cx)))
            .on_action(cx.listener(|this, _: &DebugStart, window, cx| {
                if let Some(debugger) = this.ensure_debugger(window, cx) {
                    debugger.update(cx, |debugger, cx| debugger.start(window, cx));
                    this.show_debugger_pane(false, window, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &DebugStop, _, cx| {
                if let Some((debugger, _)) = &this.debugger {
                    debugger.update(cx, |debugger, cx| debugger.stop(cx));
                }
            }))
            .on_action(cx.listener(|this, _: &DebugRestart, window, cx| {
                if let Some((debugger, _)) = &this.debugger {
                    debugger.update(cx, |debugger, cx| debugger.restart(window, cx));
                }
            }))
            .on_action(cx.listener(Self::toggle_breakpoint))
            .on_action(cx.listener(Self::save_all))
            .on_action(cx.listener(|this, _: &ShowExtensions, _, cx| {
                this.update_state(cx, |state| state.open_resource("extensions", "", "Integrations"))
            }))
            .on_action(cx.listener(Self::select_icon_theme))
            .on_action(cx.listener(|this, _: &SplitRight, _, cx| {
                this.update_state(cx, |state| {
                    state.split_pane(workspace::SplitAxis::Horizontal);
                })
            }))
            .on_action(cx.listener(|this, _: &SplitDown, _, cx| {
                this.update_state(cx, |state| {
                    state.split_pane(workspace::SplitAxis::Vertical);
                })
            }))
            .on_action(cx.listener(|this, _: &ReopenClosedTab, _, cx| {
                this.update_state(cx, |state| {
                    state.reopen_closed_tab();
                })
            }))
            .on_action(cx.listener(|this, _: &CloseAllTabs, window, cx| this.close_tabs_guarded(|state| state.close_all_tabs(), window, cx)))
            .on_action(cx.listener(|_, _: &ClearNotifications, _, cx| {
                notifications::clear(cx);
                cx.notify();
            }))
            // Database and Docker open as command palette pages (`database-command`, `docker-command`).
            .on_action(cx.listener(|this, _: &OpenDatabase, window, cx| {
                let root = this.state.active_project().filter(|project| !project.is_remote()).map(|project| PathBuf::from(&project.path));
                let picker = database_view::connections_picker(root.as_deref(), window, cx);
                this.open_modal(picker, window, cx);
            }))
            .on_action(cx.listener(|this, _: &NewDatabaseConnection, _, cx| {
                this.update_state(cx, |state| state.open_resource("database", database_view::NEW_CONNECTION_ID, "New Connection"))
            }))
            .on_action(cx.listener(|this, _: &OpenDocker, window, cx| {
                let root = this.state.active_project().filter(|project| !project.is_remote()).map(|project| PathBuf::from(&project.path));
                let picker = docker_view::docker_picker(root, window, cx);
                this.open_modal(picker, window, cx);
            }))
            .on_mouse_move(cx.listener(Self::on_drag_move))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    if this.drag.take().is_some() {
                        this.save();
                        cx.notify();
                    }
                }),
            )
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(theme.colors.window)
            .font_family(typography::ui(cx).family)
            .text_size(typography::ui(cx).base())
            .text_color(theme.colors.foreground)
            .when(dragging, |this| this.cursor_col_resize())
            .children(window_tab_row)
            .child(content)
            .children(self.account_menu.as_ref().map(|(menu, _)| {
                gpui::deferred(
                    gpui::anchored()
                        .position(gpui::point(metrics::WORKBENCH_GAP + metrics::RAIL_CONTROL + px(4.), window.viewport_size().height - px(12.)))
                        .anchor(Anchor::BottomLeft)
                        .snap_to_window_with_margin(px(8.))
                        .child(menu.clone()),
                )
                .with_priority(1)
            }))
            .child(self.render_drop_overlay(cx))
            .children(self.render_resize_border(window))
            .children(browser_frame_tracker())
            .children(toast_stack(window, true, cx))
            .children(self.render_zoom_badge(cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
            .children(self.modal.as_ref().map(|(view, _)| {
                let viewport = window.viewport_size();
                // Settings is a dialog, centred like every `AppDialog`; pickers sit a tenth down.
                let centred = view.clone().downcast::<settings_ui::SettingsView>().is_ok() || view.clone().downcast::<account::FeedbackDialog>().is_ok();
                gpui::deferred(
                    div()
                        .id("modal-layer")
                        .absolute()
                        .inset_0()
                        .bg(theme.colors.scrim)
                        .flex()
                        .justify_center()
                        .map(|this| if centred { this.items_center() } else { this.items_start().pt(viewport.height * 0.1) })
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, _, window, cx| {
                                this.modal = None;
                                window.focus(&this.focus_handle, cx);
                                cx.notify();
                            }),
                        )
                        .child(ui::occluder())
                        .child(view.clone()),
                )
                .with_priority(2)
            }));
        self.window_tab_actions(root, cx)
    }
}

/// Drops what a closed window told the other windows of its tab group.
pub fn forget_window(window: gpui::WindowId, cx: &mut App) {
    Workbench::forget_window_label(window, cx);
}

pub(crate) fn bounds_right(bounds: Bounds<Pixels>) -> Pixels {
    bounds.origin.x + bounds.size.width
}


/// A workspace with projects and sessions in it, for previews and screenshots.
pub fn demo_state() -> WorkspaceState {
    use workspace::{Session, SessionStatus, now_ms};
    let mut state = WorkspaceState::default();
    let www = state.open_project("/Users/me/Documents/Git/athasdev/www");
    let athas = state.open_project("/Users/me/Documents/Git/athasdev/athas");
    let now = now_ms();
    let session = |id: &str, title: &str, minutes: u64, project: Option<&ProjectId>, status: SessionStatus| Session {
        id: SessionId(id.to_string()),
        title: title.to_string(),
        project: project.cloned(),
        workspace_path: None,
        agent: DEFAULT_AGENT.to_string(),
        created_at: now - minutes * 60_000 - 600_000,
        last_activity_at: now - minutes * 60_000,
        message_count: 4,
        pinned: false,
        archived_at: None,
        status,
        unread: false,
        branch: Some("main".to_string()),
    };
    state.insert_session(session("s1", "Fix terminal resize on Windows", 3, Some(&athas), SessionStatus::Running));
    state.insert_session(Session { unread: true, ..session("s2", "Add GPUI shell skeleton", 40, Some(&athas), SessionStatus::ReviewReady) });
    state.insert_session(session("s3", "Refactor dock layout store", 300, Some(&athas), SessionStatus::PrOpen));
    state.insert_session(Session { pinned: true, ..session("s4", "Release checklist", 1000, Some(&athas), SessionStatus::Idle) });
    state.insert_session(session("s5", "Explain ACP bridge", 2000, None, SessionStatus::Idle));
    state.insert_session(session("s6", "Pricing page copy", 90, Some(&www), SessionStatus::Merged));
    state.activate_project(&athas);
    state
}

/// The shell line for a debuggee started in a terminal: its environment changes, then its
/// arguments, each quoted for a POSIX shell.
fn run_in_terminal_command(request: &dap::RunInTerminal) -> String {
    fn quote(arg: &str) -> String {
        if !arg.is_empty() && arg.chars().all(|c| c.is_ascii_alphanumeric() || "-_./=:@%+,".contains(c)) {
            arg.to_string()
        } else {
            format!("'{}'", arg.replace('\'', "'\\''"))
        }
    }
    let mut parts: Vec<String> = Vec::new();
    if !request.env.is_empty() {
        parts.push("env".into());
        for (key, value) in &request.env {
            match value {
                Some(value) => parts.push(quote(&format!("{key}={value}"))),
                None => {
                    parts.push("-u".into());
                    parts.push(quote(key));
                }
            }
        }
    }
    parts.extend(request.args.iter().map(|arg| quote(arg)));
    parts.join(" ")
}

#[cfg(test)]
mod run_in_terminal_tests {
    #[test]
    fn quotes_arguments_and_environment() {
        let request = dap::RunInTerminal {
            title: None,
            cwd: None,
            args: vec!["node".into(), "app.js".into(), "it's here".into()],
            env: vec![("PORT".into(), Some("3000".into())), ("DEBUG".into(), None)],
        };
        assert_eq!(super::run_in_terminal_command(&request), "env PORT=3000 -u DEBUG node app.js 'it'\\''s here'");
    }
}

/// The toasts, bottom right, in the window that shows them: the one last brought to the front,
/// workbench or detached, as each of the original's windows has its own toaster.
pub(crate) fn toast_stack(window: &Window, workbench: bool, cx: &mut App) -> Option<gpui::AnyElement> {
    if !windows::shows_toasts(window.window_handle().window_id(), workbench, cx) {
        return None;
    }
    let store = cx.try_global::<notifications::Notifications>()?;
    let toasts: Vec<notifications::Notification> = store.toasts().cloned().collect();
    if toasts.is_empty() {
        return None;
    }
    let elements: Vec<gpui::AnyElement> = toasts
        .iter()
        .map(|toast| {
            let id = toast.id.clone();
            notifications::render_toast(
                toast,
                move |window, cx| {
                    notifications::close_toast(cx, &id);
                    window.refresh();
                },
                cx,
            )
        })
        .collect();
    Some(div().absolute().bottom(px(24.)).right(px(24.)).flex().flex_col().gap(px(14.)).children(elements).child(ui::occluder()).into_any_element())
}

/// Sessions titled with Athas's context preamble (an agent named them by the first prompt as
/// sent) take their title from the saved transcript instead.
fn repair_session_titles(mut state: WorkspaceState) -> (WorkspaceState, bool) {
    let broken: Vec<usize> = state.sessions.iter().enumerate().filter(|(_, session)| agent_ui::title::needs_repair(&session.title)).map(|(index, _)| index).collect();
    if broken.is_empty() {
        return (state, false);
    }
    let dir = agent_ui::persistence::sessions_dir();
    for index in broken {
        let session = &mut state.sessions[index];
        let transcript = dir.as_deref().and_then(|dir| agent_ui::persistence::load(dir, &session.id.0));
        session.title = transcript.map(|transcript| agent_ui::history::transcript_title(&transcript)).unwrap_or_else(|| "Untitled session".into());
    }
    (state, true)
}
