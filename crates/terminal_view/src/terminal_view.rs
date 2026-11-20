//! The terminal in the bottom pane: tabs of shells, split groups of them, profiles and the
//! terminal commands (`features/terminal` and `crates/terminal` in Athas).

mod colors;
mod element;
mod find;
#[cfg(not(target_family = "wasm"))]
mod flatpak;
mod keys;
mod layout;
mod links;
mod mouse;
mod profiles;
mod pty;
mod session;
mod shell;
mod terminal;
mod view;

use ui::TooltipExt as _;
use std::{
    cell::RefCell,
    collections::HashMap,
    path::{Path, PathBuf},
    rc::Rc,
    sync::OnceLock,
};

use anyhow::Result;
use futures::channel::mpsc::UnboundedReceiver;

use gpui::{
    Anchor, App, Bounds, Context, DismissEvent, DragMoveEvent, Entity, EventEmitter, FocusHandle, Focusable, Global,
    IntoElement, KeyBinding, KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent, Pixels, Point, Render,
    SharedString, Subscription, Window, actions, canvas, deferred, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{
    AlertDialog, Button, ButtonSize, ConfirmOptions, DropdownMenu, EmptyState, IconName, InputAppearance, MenuEntry,
    MenuItem, OpenMenu, Tab, TextInput, TextInputEvent, metrics, pane_actions, pane_header, typography,
};

pub use crate::{
    profiles::{Shell, TerminalProfile, all_profiles, available_shells},
    pty::{ExitStatus, Pty, PtyIo, PtySize},
    session::TerminalSessions,
};
use crate::{
    layout::{Layouts, MIN_PANE_SIZE, PaneNode, Placement, SplitAxis, flatten},
    profiles::{ResolvedLaunch, SYSTEM_DEFAULT_PROFILE_ID},
    session::{PersistedPane, PersistedSession, PersistedTerminal},
    terminal::{TermOptions, Terminal, TerminalEvent},
    view::{TerminalView, TerminalViewEvent},
};

actions!(
    terminal,
    [
        NewTerminal,
        CloseTerminal,
        FindInTerminal,
        SplitTerminalRight,
        SplitTerminalDown,
        PreviousCommand,
        NextCommand,
        UnsplitTerminal,
        FocusNextPane,
        FocusPreviousPane,
        ClearTerminal,
        SelectAllInTerminal,
        CopyLastCommandOutput,
        ZoomIn,
        ZoomOut,
        ResetZoom,
        IncreaseFontSize,
        DecreaseFontSize,
        ResetFontSize,
    ]
);

/// Commands that ran at least this long notify when they finish out of sight.
const LONG_COMMAND: std::time::Duration = std::time::Duration::from_secs(10);

/// `formatTerminalCommandDuration`: `4s`, `2m 05s`, `1h 03m`.
fn format_duration(duration: std::time::Duration) -> String {
    let total = (duration.as_millis() as f64 / 1000.).round().max(1.) as u64;
    let (hours, minutes, seconds) = (total / 3600, (total % 3600) / 60, total % 60);
    if hours > 0 {
        format!("{hours}h {minutes:02}m")
    } else if minutes > 0 {
        format!("{minutes}m {seconds:02}s")
    } else {
        format!("{seconds}s")
    }
}

fn describe_command_completion(name: &str, code: Option<i32>, duration: std::time::Duration) -> (String, String, notifications::NotificationKind) {
    let duration = format_duration(duration);
    match code {
        Some(code) if code != 0 => (
            format!("Command failed in {name}"),
            format!("Exit code {code} after {duration}"),
            notifications::NotificationKind::Error,
        ),
        _ => (format!("Command finished in {name}"), format!("Completed in {duration}"), notifications::NotificationKind::Success),
    }
}

/// The terminal zoom steps (`ZOOM_LEVELS` in `zoom.store.ts`).
const ZOOM_LEVELS: [f32; 11] = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

#[derive(Default)]
struct Registered;

impl Global for Registered {}

/// The terminal's zoom level, apart from the workbench's.
struct TerminalZoom(f32);

impl Global for TerminalZoom {}

pub fn terminal_zoom(cx: &App) -> f32 {
    cx.try_global::<TerminalZoom>().map_or(1., |zoom| zoom.0)
}

/// Variables every new local shell gets unless it sets them itself, such as the ones that point
/// `claude` at Athas's IDE server.
struct ExtraEnv(Rc<dyn Fn(&App) -> Vec<(String, String)>>);

impl Global for ExtraEnv {}

pub fn set_extra_env(provider: impl Fn(&App) -> Vec<(String, String)> + 'static, cx: &mut App) {
    cx.set_global(ExtraEnv(Rc::new(provider)));
}

fn extra_env(cx: &App) -> Vec<(String, String)> {
    cx.try_global::<ExtraEnv>().map(|extra| (extra.0)(cx)).unwrap_or_default()
}

/// The settings in use, or the defaults where no settings were loaded (tests, snapshots).
pub(crate) fn terminal_settings(cx: &App) -> &settings::Settings {
    static DEFAULTS: OnceLock<settings::Settings> = OnceLock::new();
    if cx.has_global::<settings::SettingsStore>() { settings::get(cx) } else { DEFAULTS.get_or_init(settings::Settings::default) }
}

/// Registers the terminal commands and binds the keys the terminal takes over while it has focus.
/// The workbench calls it at startup; a panel calls it too, and the first call rebinds the keys.
pub fn init(cx: &mut App) {
    if cx.has_global::<Registered>() {
        return;
    }
    cx.set_global(Registered);
    keymap::register(cx, "terminal.new", NewTerminal);
    keymap::register(cx, "terminal.close", CloseTerminal);
    keymap::register(cx, "terminal.find", FindInTerminal);
    keymap::register(cx, "terminal.split", SplitTerminalRight);
    keymap::register(cx, "terminal.splitDown", SplitTerminalDown);
    keymap::register(cx, "terminal.previousCommand", PreviousCommand);
    keymap::register(cx, "terminal.nextCommand", NextCommand);
    keymap::register(cx, "terminal.unsplit", UnsplitTerminal);
    keymap::register(cx, "terminal.focusNextPane", FocusNextPane);
    keymap::register(cx, "terminal.focusPreviousPane", FocusPreviousPane);
    keymap::register(cx, "terminal.clear", ClearTerminal);
    keymap::register(cx, "terminal.selectAll", SelectAllInTerminal);
    keymap::register(cx, "terminal.copyLastCommandOutput", CopyLastCommandOutput);
    keymap::register(cx, "terminal.zoomIn", ZoomIn);
    keymap::register(cx, "terminal.zoomOut", ZoomOut);
    keymap::register(cx, "terminal.resetZoom", ResetZoom);
    ui::bind_keys_once(cx, "terminal_view", bind_keys);
    if cx.has_global::<keymap::ActiveKeymap>() {
        keymap::user_bindings_changed(cx);
    }
}

/// Cmd/Ctrl with +, - and 0 change the terminal font size while a terminal has focus, ahead of
/// the workbench zoom (`handleZoom` in `terminal.tsx`).
fn bind_keys(cx: &mut App) {
    let context = Some("Terminal");
    let bindings = vec![
        KeyBinding::new("cmd-=", IncreaseFontSize, context),
        KeyBinding::new("cmd-+", IncreaseFontSize, context),
        KeyBinding::new("cmd--", DecreaseFontSize, context),
        KeyBinding::new("cmd-0", ResetFontSize, context),
        KeyBinding::new("ctrl-=", IncreaseFontSize, context),
        KeyBinding::new("ctrl-+", IncreaseFontSize, context),
        KeyBinding::new("ctrl--", DecreaseFontSize, context),
        KeyBinding::new("ctrl-0", ResetFontSize, context),
    ];
    cx.bind_keys(bindings);
}

/// How a terminal for a folder starts when the user's shell on the local PTY cannot serve it.
pub enum TerminalStart {
    /// Another backend's process, such as a shell on a remote server. It starts off the UI
    /// thread, since starting it may connect to the server.
    Pty { name: String, spawn: Box<dyn FnOnce(PtySize, PtyIo) -> Result<Box<dyn Pty>> + Send> },
    /// A program on the local PTY instead of the user's shell (`wsl.exe …`).
    Program { program: String, args: Vec<String> },
}

/// Where terminals are kept across launches; only the desktop app sets it, so snapshots and
/// tests never read or write the user's file.
struct SessionsLocation(TerminalSessions);

impl Global for SessionsLocation {}

pub fn set_sessions_location(sessions: TerminalSessions, cx: &mut App) {
    cx.set_global(SessionsLocation(sessions));
}

pub fn sessions_location(cx: &App) -> Option<TerminalSessions> {
    cx.try_global::<SessionsLocation>().map(|location| location.0.clone())
}

/// Opens a terminal in a window of its own started in a folder ("New Terminal Window Here"); the
/// workbench installs it.
struct WindowOpener(Rc<dyn Fn(Option<PathBuf>, &mut App)>);

impl Global for WindowOpener {}

pub fn set_window_opener(opener: impl Fn(Option<PathBuf>, &mut App) + 'static, cx: &mut App) {
    cx.set_global(WindowOpener(Rc::new(opener)));
}

/// Names a terminal from its title and folder with the AI settings' model ("Generate Terminal
/// Name"); the workbench installs it.
pub type NameGenerator = Rc<dyn Fn(String, Option<PathBuf>, &mut App) -> gpui::Task<Result<String, String>>>;

struct NameGeneratorHook(NameGenerator);

impl Global for NameGeneratorHook {}

pub fn set_name_generator(generator: NameGenerator, cx: &mut App) {
    cx.set_global(NameGeneratorHook(generator));
}

/// Picks how a terminal for a folder starts; `None` runs the user's shell in it.
pub type TerminalStarter = Rc<dyn Fn(&Path) -> Option<TerminalStart>>;

#[derive(Clone, Debug, PartialEq)]
pub enum TerminalPanelEvent {
    /// The pane's close button, or the last terminal closed: hide the bottom pane.
    Hide,
    /// The full screen button: the bottom pane takes the whole workbench, or gives it back.
    ToggleFullScreen,
    /// The terminal of an editor-area panel has a new title.
    TitleChanged(String),
    /// A command finished in one of the panel's terminals, with its exit code.
    CommandFinished(Option<i32>),
}

/// A running terminal taken out of a panel, to go on in another (an editor tab).
pub struct MovedTerminal {
    view: Entity<TerminalView>,
    pinned: bool,
    launch: Launch,
}

impl MovedTerminal {
    /// The folder and command it started with.
    pub fn started_with(&self) -> (Option<PathBuf>, Option<String>) {
        (self.launch.cwd.clone(), self.launch.initial_command.clone())
    }
}

impl DraggedTerminalTab {
    /// Takes the dragged terminal out of the panel it was in, still running.
    pub fn take(&self, window: &mut Window, cx: &mut App) -> Option<MovedTerminal> {
        self.panel.upgrade()?.update(cx, |panel, cx| panel.take_terminal(self.id, window, cx))
    }
}

/// What started a terminal, so Duplicate and Split start the same thing.
#[derive(Clone, Debug, Default)]
struct Launch {
    program: Option<String>,
    /// Arguments for `program`, such as `wsl.exe`'s distribution and folder.
    args: Vec<String>,
    cwd: Option<PathBuf>,
    env: Vec<(String, String)>,
    initial_command: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LastCommand {
    Succeeded,
    Failed,
}

/// A terminal that did not start, and what it was asked to start, so Retry starts it again.
struct FailedStart {
    id: usize,
    name: SharedString,
    error: SharedString,
    launch: Launch,
    split: Option<(usize, SplitAxis, Placement)>,
}

struct TerminalTab {
    id: usize,
    view: Entity<TerminalView>,
    pinned: bool,
    launch: Launch,
    /// How the last command ended while the terminal was out of sight.
    last_command: Option<LastCommand>,
    _subscription: Subscription,
}

/// The tab's leading slot (`TerminalTabBarItem`): live progress first, then how the last command
/// ended out of sight, then the terminal icon.
fn leading_indicator(id: usize, progress: Option<terminal::TerminalProgress>, last_command: Option<LastCommand>, show_icons: bool, colors: &theme::ThemeColors) -> Option<gpui::AnyElement> {
    let slot = || div().flex().flex_none().items_center().justify_center().size(px(12.));
    if let Some(progress) = progress {
        let indicator = match progress.state {
            2 => ui::Icon::new(IconName::WarningCircle).size(ui::IconSize::XSmall).color(colors.destructive).into_any_element(),
            3 => ui::Spinner::new(("terminal-progress", id)).label("Working").compact().into_any_element(),
            4 => ui::Icon::new(IconName::Pause).size(ui::IconSize::XSmall).color(colors.warning).into_any_element(),
            _ => ui::ProgressCircle::new(progress.value as f32).size(px(12.)).into_any_element(),
        };
        return Some(slot().child(indicator).into_any_element());
    }
    if let Some(last) = last_command {
        let color = if last == LastCommand::Failed { colors.destructive } else { colors.success };
        return Some(slot().child(div().size(px(6.)).rounded_full().bg(color)).into_any_element());
    }
    show_icons.then(|| slot().child(ui::Icon::new(IconName::TerminalWindow).size(ui::IconSize::XSmall).color(colors.subtle_foreground)).into_any_element())
}

/// A terminal tab being dragged, to reorder the tabs or to split a pane with it.
#[derive(Clone)]
pub struct DraggedTerminalTab {
    id: usize,
    pub title: SharedString,
    panel: gpui::WeakEntity<TerminalPanel>,
}

struct DraggedTabPreview(SharedString);

impl Render for DraggedTabPreview {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().child(Tab::new("terminal-tab-drag", self.0.clone()).icon(IconName::Terminal).active(true)).text_color(cx.theme().colors.foreground)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DropZone {
    Left,
    Right,
    Top,
    Bottom,
}

impl DropZone {
    /// `getPaneDropZoneFromRect`; the middle of a pane is no zone.
    fn at(position: Point<Pixels>, bounds: Bounds<Pixels>) -> Option<Self> {
        let x = f32::from(position.x - bounds.origin.x) / f32::from(bounds.size.width).max(1.);
        let y = f32::from(position.y - bounds.origin.y) / f32::from(bounds.size.height).max(1.);
        let threshold = 0.25;
        if x < threshold && x < y && x < 1. - y {
            Some(DropZone::Left)
        } else if x > 1. - threshold && 1. - x < y && 1. - x < 1. - y {
            Some(DropZone::Right)
        } else if y < threshold {
            Some(DropZone::Top)
        } else if y > 1. - threshold {
            Some(DropZone::Bottom)
        } else {
            None
        }
    }

    /// `getTerminalSplitDropOptions`.
    fn split(self) -> (SplitAxis, Placement) {
        match self {
            DropZone::Left => (SplitAxis::Horizontal, Placement::Before),
            DropZone::Right => (SplitAxis::Horizontal, Placement::After),
            DropZone::Top => (SplitAxis::Vertical, Placement::Before),
            DropZone::Bottom => (SplitAxis::Vertical, Placement::After),
        }
    }
}

/// A divider between two panes being dragged.
#[derive(Clone, Copy)]
struct SplitDrag {
    split: usize,
    index: usize,
    horizontal: bool,
    start: Pixels,
    sizes: [f32; 2],
}

/// The snapshot demo's progress (`ATHAS_TERMINAL_DEMO`).
struct Demo {
    terminal: usize,
    input: String,
    typed: bool,
    find: Option<String>,
    link: bool,
}

struct Renaming {
    id: usize,
    input: Entity<TextInput>,
    _subscription: Subscription,
}

struct Confirmation {
    dialog: Entity<AlertDialog>,
    _subscription: Subscription,
}

/// Everything inside the bottom pane's island: the header with the terminal tabs and actions, then
/// the terminal in front, or its split group.
pub struct TerminalPanel {
    cwd: Option<PathBuf>,
    starter: Option<TerminalStarter>,
    /// Terminals whose process is still starting off the UI thread.
    starting: usize,
    focus_handle: FocusHandle,
    /// The tab strip, focused by clicking the tab in front: F2 renames, arrows switch, Delete
    /// closes and Shift+F10 opens the menu (`handleKeyDown` in `terminal-tab-bar.tsx`).
    tabs_focus: FocusHandle,
    tab_bounds: Rc<RefCell<HashMap<usize, Bounds<Pixels>>>>,
    tabs: Vec<TerminalTab>,
    active: Option<usize>,
    layouts: Layouts,
    next_id: usize,
    /// A terminal whose shell failed to start: a tab of its own that says why, with Retry
    /// (`initializationError` in `terminal.tsx`), until it is retried or closed.
    failed: Option<FailedStart>,
    /// The failed terminal's tab is the one in front.
    failed_active: bool,
    menu: Option<OpenMenu>,
    new_menu: Entity<DropdownMenu>,
    shells: Rc<RefCell<Option<Vec<Shell>>>>,
    renaming: Option<Renaming>,
    confirmation: Option<Confirmation>,
    split_sizes: Rc<RefCell<HashMap<usize, Pixels>>>,
    split_drag: Option<SplitDrag>,
    drop_target: Option<(usize, DropZone)>,
    demo: Option<Demo>,
    /// Whether the bottom pane is on screen, so a command finishing out of sight can say so.
    shown: bool,
    /// One terminal shown as an editor tab (`terminal-tab.tsx`): no header, and its title and
    /// exit are told to the workbench.
    buffer: bool,
    full_screen: bool,
    /// Where this panel's terminals are kept for the project, and what was written last.
    sessions: Option<TerminalSessions>,
    saved: Option<PersistedSession>,
    _focus_subscription: Subscription,
    _save_subscription: Option<Subscription>,
}

impl EventEmitter<TerminalPanelEvent> for TerminalPanel {}

impl Focusable for TerminalPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl TerminalPanel {
    pub fn new(cwd: Option<PathBuf>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_starter(cwd, None, window, cx)
    }

    /// A panel whose terminals `starter` starts where the local shell cannot serve the folder.
    pub fn with_starter(cwd: Option<PathBuf>, starter: Option<TerminalStarter>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_sessions(cwd, starter, None, window, cx)
    }

    /// A panel that brings back the project's terminals from `sessions` and keeps them there as
    /// they change.
    pub fn with_sessions(cwd: Option<PathBuf>, starter: Option<TerminalStarter>, sessions: Option<TerminalSessions>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut panel = Self::empty(cwd, starter, sessions, window, cx);
        let restored = panel.saved_session().is_some_and(|saved| panel.restore(saved, window, cx));
        if !restored {
            panel.new_terminal(None, window, cx);
        }
        panel.run_demo(window, cx);
        if panel.sessions.is_some() {
            panel._save_subscription = Some(cx.observe_self(|this, cx| this.save_session(cx)));
        }
        panel
    }

    /// A terminal as an editor tab: `moved` when one came from the bottom pane, else a new shell
    /// in `cwd` (running `command` when given).
    pub fn buffer(cwd: Option<PathBuf>, starter: Option<TerminalStarter>, moved: Option<MovedTerminal>, command: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut panel = Self::empty(cwd, starter, None, window, cx);
        panel.buffer = true;
        match (moved, command) {
            (Some(moved), _) => panel.adopt(moved, window, cx),
            (None, Some(command)) => panel.run_command(&command, None, window, cx),
            (None, None) => panel.new_terminal(None, window, cx),
        }
        panel
    }

    /// The title of the terminal in front.
    pub fn title(&self, cx: &App) -> Option<String> {
        self.active_view().map(|view| view.read(cx).title().to_string())
    }

    fn empty(cwd: Option<PathBuf>, starter: Option<TerminalStarter>, sessions: Option<TerminalSessions>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        init(cx);
        let focus_handle = cx.focus_handle();
        // Focus given to the pane goes on to the terminal in front; a pane shown again after its
        // last terminal closed starts a new one.
        let focus_subscription = cx.on_focus(&focus_handle, window, |this: &mut Self, window, cx| {
            match this.active_view() {
                Some(view) => window.focus(&view.focus_handle(cx), cx),
                None if this.starting == 0 && this.failed.is_none() => this.new_terminal(None, window, cx),
                None => {}
            }
        });
        let shells: Rc<RefCell<Option<Vec<Shell>>>> = Rc::default();
        let new_menu = Self::build_new_menu(cx.weak_entity(), shells.clone(), cx);
        let panel = Self {
            cwd,
            starter,
            starting: 0,
            focus_handle,
            tabs_focus: cx.focus_handle(),
            tab_bounds: Rc::default(),
            tabs: Vec::new(),
            active: None,
            layouts: Layouts::default(),
            next_id: 0,
            failed: None,
            failed_active: false,
            menu: None,
            new_menu,
            shells,
            renaming: None,
            confirmation: None,
            split_sizes: Rc::default(),
            split_drag: None,
            drop_target: None,
            demo: None,
            shown: true,
            buffer: false,
            full_screen: false,
            sessions,
            saved: None,
            _focus_subscription: focus_subscription,
            _save_subscription: None,
        };
        panel.load_shells(cx);
        panel
    }

    /// Takes terminal `id` out, still running, as closing it would otherwise.
    pub fn take_terminal(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) -> Option<MovedTerminal> {
        let tab = self.remove_tab(id, window, cx)?;
        Some(MovedTerminal { view: tab.view, pinned: tab.pinned, launch: tab.launch })
    }

    /// Takes the terminal in front out, still running (moving a session's terminal into an editor tab).
    pub fn take_active_terminal(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<MovedTerminal> {
        let id = self.active?;
        self.take_terminal(id, window, cx)
    }

    /// Takes in a running terminal from another panel, in front.
    pub fn adopt(&mut self, moved: MovedTerminal, window: &mut Window, cx: &mut Context<Self>) {
        let MovedTerminal { view, pinned, launch } = moved;
        let root = self.cwd.clone();
        view.update(cx, |view, _| view.set_root(root));
        let id = self.next_id;
        self.next_id += 1;
        let subscription = cx.subscribe_in(&view, window, move |this, _, event: &TerminalViewEvent, window, cx| this.handle_view_event(id, event, window, cx));
        self.tabs.push(TerminalTab { id, view, pinned, launch, last_command: None, _subscription: subscription });
        self.activate(id, window, cx);
        if self.buffer {
            let title = self.title(cx).unwrap_or_default();
            cx.emit(TerminalPanelEvent::TitleChanged(title));
        }
    }

    fn session_key(&self) -> Option<String> {
        self.cwd.as_ref().map(|cwd| cwd.to_string_lossy().into_owned())
    }

    fn saved_session(&self) -> Option<PersistedSession> {
        self.sessions.as_ref()?.load(&self.session_key()?)
    }

    /// What would be kept now: the terminals in tab order and the split groups between them.
    fn persisted_session(&self, cx: &App) -> PersistedSession {
        let ids: Vec<usize> = self.tabs.iter().map(|tab| tab.id).collect();
        let index_of = |id: usize| ids.iter().position(|other| *other == id);
        PersistedSession {
            terminals: self
                .tabs
                .iter()
                .map(|tab| PersistedTerminal {
                    name: tab.view.read(cx).terminal.custom_name.clone().filter(|name| !name.trim().is_empty()),
                    current_directory: tab.launch.cwd.clone().or_else(|| self.cwd.clone()),
                    is_pinned: tab.pinned,
                    shell: tab.launch.program.clone(),
                })
                .collect(),
            layouts: self.layouts.trees.iter().filter_map(|tree| PersistedPane::from_node(tree, &index_of)).collect(),
            active: self.active.and_then(index_of),
        }
    }

    fn save_session(&mut self, cx: &mut Context<Self>) {
        let (Some(sessions), Some(key)) = (self.sessions.clone(), self.session_key()) else { return };
        if self.starting > 0 {
            return;
        }
        let session = self.persisted_session(cx);
        if self.saved.as_ref() == Some(&session) {
            return;
        }
        sessions.save(&key, &session);
        self.saved = Some(session);
    }

    /// Starts a shell for each kept terminal, in its folder, with its name, pin and split group.
    /// A terminal whose start goes off the UI thread (a remote one) comes back without its group.
    fn restore(&mut self, saved: PersistedSession, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let mut ids = Vec::new();
        for terminal in &saved.terminals {
            let launch = Launch { program: terminal.shell.clone(), cwd: terminal.current_directory.clone(), ..Launch::default() };
            let id = self.start_terminal(launch, None, window, cx);
            if let Some(id) = id
                && let Some(index) = self.index_of(id)
            {
                self.tabs[index].pinned = terminal.is_pinned;
                if let Some(name) = terminal.name.clone() {
                    self.tabs[index].view.update(cx, |view, cx| view.set_custom_name(Some(name), cx));
                }
            }
            ids.push(id);
        }
        if ids.iter().all(Option::is_some) {
            let ids: Vec<usize> = ids.iter().flatten().copied().collect();
            for layout in &saved.layouts {
                if let Some(tree) = layout.to_node(&ids) {
                    self.layouts.insert_tree(tree);
                }
            }
            if let Some(active) = saved.active.and_then(|index| ids.get(index).copied()) {
                self.activate(active, window, cx);
            }
        }
        self.starting > 0 || !self.tabs.is_empty()
    }

    /// Runs `command` in a new terminal started in `cwd` (the project when `None`), as a run
    /// action does: the shell starts, then the command is typed into it.
    pub fn run_command(&mut self, command: &str, cwd: Option<PathBuf>, window: &mut Window, cx: &mut Context<Self>) {
        let launch = Launch { cwd: cwd.or_else(|| self.cwd.clone()), initial_command: Some(command.to_string()), ..Launch::default() };
        self.start_terminal(launch, None, window, cx);
    }

    /// Opens a new terminal started in `cwd` (the project when `None`).
    pub fn open_in(&mut self, cwd: Option<PathBuf>, window: &mut Window, cx: &mut Context<Self>) {
        let launch = Launch { cwd: cwd.or_else(|| self.cwd.clone()), ..Launch::default() };
        self.start_terminal(launch, None, window, cx);
    }

    /// The folder new terminals start in, which names the project they are kept for.
    pub fn working_directory(&self) -> Option<PathBuf> {
        self.cwd.clone()
    }

    /// The folder new terminals start in: the active project.
    pub fn set_working_directory(&mut self, cwd: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.cwd == cwd {
            return;
        }
        self.cwd = cwd.clone();
        for tab in &self.tabs {
            tab.view.update(cx, |view, _| view.set_root(cwd.clone()));
        }
    }

    fn load_shells(&self, cx: &mut Context<Self>) {
        let shells = self.shells.clone();
        let task = cx.background_spawn(async move { available_shells() });
        cx.spawn(async move |_, _| {
            let found = task.await;
            *shells.borrow_mut() = Some(found);
        })
        .detach();
    }

    fn build_new_menu(panel: gpui::WeakEntity<Self>, shells: Rc<RefCell<Option<Vec<Shell>>>>, cx: &mut Context<Self>) -> Entity<DropdownMenu> {
        let shortcut = command_shortcut("terminal.new", cx);
        cx.new(move |_| {
            let shortcut = shortcut.clone();
            DropdownMenu::new(
                move |open, _, _| {
                    Button::icon("terminal-new", IconName::Plus)
                        .size(ButtonSize::Small)
                        .active(open)
                        .tooltip("New Terminal")
                        .when_some(shortcut.clone(), |button, shortcut| button.shortcut(shortcut))
                        .into_any_element()
                },
                move |_, cx| {
                    let shells = shells.borrow().clone().unwrap_or_default();
                    let custom = profiles::custom_profiles(terminal_settings(cx));
                    all_profiles(&shells, &custom)
                        .into_iter()
                        .map(|profile| {
                            let panel = panel.clone();
                            let id = profile.id.clone();
                            MenuItem::new(profile.name)
                                .on_select(move |window, cx| {
                                    panel.update(cx, |panel, cx| panel.new_terminal(Some(&id), window, cx)).ok();
                                })
                                .into()
                        })
                        .collect()
                },
            )
        })
    }

    /// `ATHAS_TERMINAL_DEMO=split,find:QUERY,link,progress,pinned` sets up splits, the find
    /// popover, a link tooltip, an OSC 9;4 progress report and a pinned second terminal for
    /// headless snapshots.
    fn run_demo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(demo) = std::env::var("ATHAS_TERMINAL_DEMO") else { return };
        let parts: Vec<String> = demo.split(',').map(|part| part.trim().to_string()).collect();
        let mut input = "printf 'Compiling athas v0.1.0\\nerror: see src/main.rs:12:5 and https://athas.dev/docs\\n'\r".to_string();
        if parts.iter().any(|part| part == "progress") {
            input.insert_str(0, "printf '\\033]9;4;1;60\\007'; ");
        }
        let first = self.active;
        if parts.iter().any(|part| part == "pinned") {
            self.new_terminal(None, window, cx);
            if let Some(second) = self.active {
                self.toggle_pin(second, cx);
                if let Some(tab) = self.tab(second) {
                    tab.view.clone().update(cx, |view, cx| view.set_custom_name(Some("server".into()), cx));
                }
            }
            if let Some(first) = first {
                self.activate(first, window, cx);
            }
        }
        if parts.iter().any(|part| part == "split")
            && let Some(first) = first
        {
            self.split(SplitAxis::Horizontal, Some(first), window, cx);
            if let Some(second) = self.active {
                self.split(SplitAxis::Vertical, Some(second), window, cx);
            }
            self.activate(first, window, cx);
        }
        let find = parts.iter().find_map(|part| part.strip_prefix("find:").map(str::to_string));
        let link = parts.iter().any(|part| part == "link");
        self.demo = first.map(|terminal| Demo { terminal, input, typed: false, find, link });
    }

    /// Steps the snapshot demo as the first terminal's shell reports in: its prompt types the
    /// command, the command finishing opens the find popover and the link tooltip.
    fn step_demo(&mut self, id: usize, event: &TerminalViewEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.tab(id).map(|tab| tab.view.clone()) else { return };
        let Some(demo) = self.demo.as_mut().filter(|demo| demo.terminal == id) else { return };
        match event {
            TerminalViewEvent::PromptShown if !demo.typed => {
                demo.typed = true;
                let input = demo.input.clone();
                view.update(cx, |view, _| view.terminal.input(input.into_bytes()));
            }
            TerminalViewEvent::CommandFinished(_) if demo.typed => {
                let Some(demo) = self.demo.take() else { return };
                view.update(cx, |view, cx| {
                    if let Some(query) = &demo.find {
                        view.open_find_with(query, window, cx);
                    }
                    if demo.link {
                        view.hover_first_link(cx);
                    }
                });
            }
            _ => {}
        }
    }

    /// The terminal in front: its title and the folder it started in.
    pub fn active_title(&self, cx: &App) -> Option<(String, Option<PathBuf>)> {
        let tab = self.tab(self.active?)?;
        Some((tab.view.read(cx).title().to_string(), tab.launch.cwd.clone().or_else(|| self.cwd.clone())))
    }

    /// Names the terminal in front, as Rename does.
    pub fn rename_active(&mut self, name: String, cx: &mut Context<Self>) {
        if let Some(view) = self.active_view() {
            view.update(cx, |view, cx| view.set_custom_name(Some(name), cx));
            cx.notify();
        }
    }

    fn active_view(&self) -> Option<Entity<TerminalView>> {
        let active = self.active?;
        self.tab(active).map(|tab| tab.view.clone())
    }

    fn tab(&self, id: usize) -> Option<&TerminalTab> {
        self.tabs.iter().find(|tab| tab.id == id)
    }

    fn index_of(&self, id: usize) -> Option<usize> {
        self.tabs.iter().position(|tab| tab.id == id)
    }

    /// The tabs as the header shows them: pinned first.
    fn sorted_ids(&self) -> Vec<usize> {
        let mut tabs: Vec<&TerminalTab> = self.tabs.iter().collect();
        tabs.sort_by_key(|tab| !tab.pinned);
        tabs.iter().map(|tab| tab.id).collect()
    }

    /// `handleNewTerminal`: a terminal from `profile` (the default profile when `None`).
    fn new_terminal(&mut self, profile: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let settings = terminal_settings(cx);
        let shells = self.shells.borrow().clone().unwrap_or_default();
        let custom = profiles::custom_profiles(settings);
        let ResolvedLaunch { program, args, working_directory, initial_command, env, name, profile_id } = profiles::resolve_launch(
            self.cwd.as_deref(),
            profile,
            &settings.terminal_default_profile_id,
            &settings.terminal_default_shell_id,
            &shells,
            &custom,
        );
        let custom_name = profile_id.as_deref().filter(|id| *id != SYSTEM_DEFAULT_PROFILE_ID).map(|_| name).filter(|name| !name.trim().is_empty());
        let launch = Launch { program, args, cwd: working_directory, env, initial_command };
        let id = self.start_terminal(launch, None, window, cx);
        if let (Some(name), Some(id)) = (custom_name, id)
            && let Some(tab) = self.tab(id)
        {
            tab.view.update(cx, |view, cx| view.set_custom_name(Some(name), cx));
        }
    }

    /// Starts a terminal for `launch`, beside `split` when given. Returns its id once it exists
    /// (a remote terminal arrives later).
    fn start_terminal(&mut self, launch: Launch, split: Option<(usize, SplitAxis, Placement)>, window: &mut Window, cx: &mut Context<Self>) -> Option<usize> {
        let settings = terminal_settings(cx);
        let options = TermOptions::from_settings(settings);
        let integration = settings.terminal_shell_integration;
        let cwd = launch.cwd.clone().or_else(|| self.cwd.clone());
        let start = cwd.as_deref().zip(self.starter.as_ref()).and_then(|(cwd, starter)| starter(cwd));
        match start {
            Some(TerminalStart::Pty { name, spawn }) => {
                let folder = cwd.unwrap_or_default();
                let task = cx.background_spawn(async move { Terminal::spawn_configured(name, folder, options, spawn) });
                self.starting += 1;
                cx.notify();
                cx.spawn_in(window, async move |this, cx| {
                    let spawned = task.await;
                    this.update_in(cx, |this, window, cx| {
                        this.starting -= 1;
                        this.add_terminal(spawned, launch, split, window, cx);
                    })
                    .ok();
                })
                .detach();
                None
            }
            Some(TerminalStart::Program { program, args }) => {
                let command = shell::program_command(program, args);
                let spawned = Terminal::spawn_command(&command, options);
                self.add_terminal(spawned, launch, split, window, cx)
            }
            None => {
                let mut command = shell::shell_command(launch.program.clone(), cwd.as_deref(), integration);
                command.args.splice(0..0, launch.args.iter().cloned());
                for (key, value) in extra_env(cx) {
                    command.set_env(&key, value);
                }
                for (key, value) in &launch.env {
                    command.set_env(key, value.clone());
                }
                let spawned = Terminal::spawn_command(&command, options);
                self.add_terminal(spawned, launch, split, window, cx)
            }
        }
    }

    fn add_terminal(
        &mut self,
        spawned: Result<(Terminal, UnboundedReceiver<TerminalEvent>)>,
        launch: Launch,
        split: Option<(usize, SplitAxis, Placement)>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<usize> {
        let (mut terminal, events) = match spawned {
            Ok(spawned) => spawned,
            Err(error) => {
                let id = self.next_id;
                self.next_id += 1;
                let name = shell::launch_name(launch.program.as_deref()).into();
                self.failed = Some(FailedStart { id, name, error: format!("{error:#}").into(), launch, split });
                self.failed_active = true;
                cx.notify();
                return None;
            }
        };
        if let Some(command) = launch.initial_command.as_deref() {
            terminal.initial_command = Some(command.to_string());
            terminal.input(format!("{}\r", command.replace('\n', "\r")).into_bytes());
        }
        let root = self.cwd.clone();
        let view = cx.new(|cx| TerminalView::new(terminal, events, root, window, cx));
        let id = self.next_id;
        self.next_id += 1;
        let subscription = cx.subscribe_in(&view, window, move |this, _, event: &TerminalViewEvent, window, cx| {
            this.step_demo(id, event, window, cx);
            this.handle_view_event(id, event, window, cx);
        });
        self.tabs.push(TerminalTab { id, view, pinned: false, launch, last_command: None, _subscription: subscription });
        if let Some((target, axis, placement)) = split
            && self.tab(target).is_some()
        {
            self.layouts.split(target, id, axis, placement);
        }
        self.activate(id, window, cx);
        Some(id)
    }

    /// Retry on "Terminal failed to start": starts the same thing again in its place.
    fn retry_failed_start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(failed) = self.failed.take() else { return };
        self.failed_active = false;
        cx.notify();
        self.start_terminal(failed.launch, failed.split, window, cx);
    }

    /// Closing the failed terminal's tab: the one before it comes forward, and the pane hides
    /// when it was the last.
    fn close_failed_start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.failed = None;
        self.failed_active = false;
        match self.active {
            Some(active) => self.activate(active, window, cx),
            None if self.starting == 0 => cx.emit(TerminalPanelEvent::Hide),
            None => {}
        }
        cx.notify();
    }

    /// The failed terminal's content: the original's error `EmptyState` with Retry.
    fn render_failed_start(&self, error: SharedString, cx: &mut Context<Self>) -> impl IntoElement {
        EmptyState::new("Terminal failed to start")
            .icon(IconName::WarningCircle)
            .message(error)
            .action(
                Button::new("terminal-retry", "Retry")
                    .size(ButtonSize::Small)
                    .on_click(cx.listener(|this, _, window, cx| this.retry_failed_start(window, cx))),
            )
    }

    /// The failed terminal's tab, after the others; its close button drops it.
    fn render_failed_tab(&self, failed: &FailedStart, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let id = failed.id;
        div().id(("terminal-tab-slot", id)).flex_none().anchored_tooltip({ let tip: SharedString = (format!("{} — {}", failed.name, failed.error)).into(); move || ui::Tooltip::new(tip.clone()) }).child(
            Tab::new(("terminal-tab", id), failed.name.clone())
                .leading(ui::Icon::new(IconName::WarningCircle).size(ui::IconSize::XSmall).color(colors.destructive))
                .active(self.failed_active)
                .on_click(cx.listener(|this, _, _, cx| {
                    this.failed_active = true;
                    cx.notify();
                }))
                .on_close(cx.listener(|this, _, window, cx| this.close_failed_start(window, cx))),
        )
    }

    fn handle_view_event(&mut self, id: usize, event: &TerminalViewEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            TerminalViewEvent::TitleChanged => {
                if self.buffer && self.active == Some(id) {
                    let title = self.title(cx).unwrap_or_default();
                    cx.emit(TerminalPanelEvent::TitleChanged(title));
                }
                cx.notify()
            }
            TerminalViewEvent::Exited => self.close_terminal(id, window, cx),
            TerminalViewEvent::CloseRequested => self.request_close(vec![id], window, cx),
            TerminalViewEvent::Focused => {
                if self.active != Some(id) {
                    self.active = Some(id);
                    self.clear_last_command(id);
                    cx.notify();
                }
            }
            TerminalViewEvent::CommandFinished(code) => self.command_finished(id, *code, cx),
            TerminalViewEvent::PromptShown => {}
        }
    }

    /// The workbench says whether the bottom pane is shown, and whether it fills the workbench.
    pub fn set_presentation(&mut self, shown: bool, full_screen: bool, cx: &mut Context<Self>) {
        if (self.shown, self.full_screen) != (shown, full_screen) {
            self.shown = shown;
            self.full_screen = full_screen;
            cx.notify();
        }
    }

    /// A command finishing in a terminal out of sight marks its tab, and a long one notifies
    /// (`terminal-command-notifications.ts`).
    fn command_finished(&mut self, id: usize, code: Option<i32>, cx: &mut Context<Self>) {
        let visible = self.shown && self.active.is_some_and(|active| self.layouts.members(active).contains(&id));
        cx.emit(TerminalPanelEvent::CommandFinished(code));
        self.notify_command_finished(id, code, visible, cx);
        if visible {
            return;
        }
        if let Some(index) = self.index_of(id) {
            self.tabs[index].last_command = Some(if code.is_none_or(|code| code == 0) { LastCommand::Succeeded } else { LastCommand::Failed });
            cx.notify();
        }
    }

    fn notify_command_finished(&mut self, id: usize, code: Option<i32>, visible: bool, cx: &mut Context<Self>) {
        let Some(tab) = self.tab(id) else { return };
        let view = tab.view.read(cx);
        let Some(duration) = view.terminal.last_command_duration else { return };
        let focused = cx.active_window().is_some();
        if !terminal_settings(cx).terminal_command_notifications || duration < LONG_COMMAND || (focused && visible) {
            return;
        }
        let name = view.title().to_string();
        let (message, description, kind) = describe_command_completion(&name, code, duration);
        notifications::notify(
            cx,
            kind,
            notifications::NotificationCategory::Athas,
            message.clone(),
            Some(description.clone().into()),
            Some(format!("terminal-command:{id}").into()),
        );
        if !focused {
            notifications::send_os_notification(cx, &message, &description);
        }
    }

    fn clear_last_command(&mut self, id: usize) {
        let members = self.layouts.members(id);
        for tab in self.tabs.iter_mut().filter(|tab| members.contains(&tab.id)) {
            tab.last_command = None;
        }
    }

    /// Brings forward the tab at `index` (0-based) in the order the strip shows them, pinned
    /// first (Cmd-1…9 while the terminal has focus); `false` when there is no such tab.
    pub fn activate_index(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let Some(id) = self.sorted_ids().get(index).copied() else { return false };
        self.activate(id, window, cx);
        true
    }

    fn activate(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        if self.tab(id).is_none() {
            return;
        }
        self.active = Some(id);
        self.failed_active = false;
        self.clear_last_command(id);
        if let Some(view) = self.active_view() {
            window.focus(&view.focus_handle(cx), cx);
        }
        cx.notify();
    }

    /// Closing a terminal drops its view, which hangs up its shell. The next one in front is a
    /// pane of the same split, else the neighbouring tab; with none left the pane hides.
    fn close_terminal(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.remove_tab(id, window, cx);
    }

    fn remove_tab(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) -> Option<TerminalTab> {
        let index = self.index_of(id)?;
        let siblings = self.layouts.members(id);
        let removed = self.tabs.remove(index);
        self.layouts.remove(id);
        if self.renaming.as_ref().is_some_and(|renaming| renaming.id == id) {
            self.renaming = None;
        }
        if self.active == Some(id) {
            let position = siblings.iter().position(|sibling| *sibling == id).unwrap_or(0);
            let sibling = position.checked_sub(1).and_then(|before| siblings.get(before)).or(siblings.get(position + 1)).copied();
            self.active = match sibling.filter(|sibling| self.tab(*sibling).is_some()) {
                Some(sibling) => Some(sibling),
                None => self.tabs.get(index.min(self.tabs.len().saturating_sub(1))).map(|tab| tab.id),
            };
            if let Some(active) = self.active {
                self.activate(active, window, cx);
            }
        }
        if self.tabs.is_empty() && self.starting == 0 && self.failed.is_none() {
            cx.emit(TerminalPanelEvent::Hide);
        }
        if self.tabs.is_empty() && self.failed.is_some() {
            self.failed_active = true;
        }
        cx.notify();
        Some(removed)
    }

    /// Closes `ids`, asking first when a command is still running in any of them
    /// (`terminalConfirmCloseRunning`).
    fn request_close(&mut self, ids: Vec<usize>, window: &mut Window, cx: &mut Context<Self>) {
        if ids.is_empty() {
            return;
        }
        let running = ids.iter().filter(|id| self.tab(**id).is_some_and(|tab| tab.view.read(cx).terminal.command_running)).count();
        if running == 0 || !terminal_settings(cx).terminal_confirm_close_running {
            for id in ids {
                self.close_terminal(id, window, cx);
            }
            return;
        }
        let (title, message) = if running == 1 {
            ("Close Terminal?".to_string(), "A command is still running in this terminal. Closing it will stop the command.".to_string())
        } else {
            ("Close Terminals?".to_string(), format!("Commands are still running in {running} terminals. Closing them will stop the commands."))
        };
        let panel = cx.weak_entity();
        let dialog = AlertDialog::confirm(
            title,
            message,
            ConfirmOptions { confirm_label: "Close".into(), cancel_label: "Cancel".into(), destructive: true },
            move |window, cx| {
                let ids = ids.clone();
                panel
                    .update(cx, |panel, cx| {
                        for id in ids {
                            panel.close_terminal(id, window, cx);
                        }
                    })
                    .ok();
            },
            cx,
        );
        let subscription = cx.subscribe_in(&dialog, window, |this, _, _: &DismissEvent, window, cx| {
            this.confirmation = None;
            if let Some(view) = this.active_view() {
                window.focus(&view.focus_handle(cx), cx);
            }
            cx.notify();
        });
        window.focus(&dialog.focus_handle(cx), cx);
        self.confirmation = Some(Confirmation { dialog, _subscription: subscription });
        cx.notify();
    }

    /// Pinned terminals stay when others are closed in bulk.
    fn close_unpinned(&mut self, ids: Vec<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let ids = ids.into_iter().filter(|id| self.tab(*id).is_some_and(|tab| !tab.pinned)).collect();
        self.request_close(ids, window, cx);
    }

    fn close_others(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        let ids = self.tabs.iter().map(|tab| tab.id).filter(|other| *other != id).collect();
        self.close_unpinned(ids, window, cx);
    }

    fn close_all(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ids = self.tabs.iter().map(|tab| tab.id).collect();
        self.close_unpinned(ids, window, cx);
    }

    fn close_to_the_right(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(index) = self.index_of(id) else { return };
        let ids = self.tabs[index + 1..].iter().map(|tab| tab.id).collect();
        self.close_unpinned(ids, window, cx);
    }

    /// `handleSplitView`: a terminal like `target` (the active one) beside it.
    fn split(&mut self, axis: SplitAxis, target: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(target) = target.or(self.active) else { return };
        let Some(tab) = self.tab(target) else { return };
        let launch = Launch { initial_command: None, ..tab.launch.clone() };
        self.start_terminal(launch, Some((target, axis, Placement::After)), window, cx);
    }

    fn unsplit(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.layouts.remove(id);
        self.activate(id, window, cx);
    }

    fn duplicate(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(tab) = self.tab(id) else { return };
        let cwd = tab.view.read(cx).terminal.cwd.clone();
        let launch = Launch { cwd: Some(cwd), initial_command: None, env: Vec::new(), ..tab.launch.clone() };
        self.start_terminal(launch, None, window, cx);
    }

    fn toggle_pin(&mut self, id: usize, cx: &mut Context<Self>) {
        if let Some(index) = self.index_of(id) {
            self.tabs[index].pinned = !self.tabs[index].pinned;
            cx.notify();
        }
    }

    fn focus_pane(&mut self, offset: isize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(active) = self.active else { return };
        if let Some(target) = self.layouts.adjacent(active, offset) {
            self.activate(target, window, cx);
        }
    }

    fn switch_tab(&mut self, offset: isize, window: &mut Window, cx: &mut Context<Self>) {
        let ids = self.sorted_ids();
        if ids.len() < 2 {
            return;
        }
        let Some(index) = self.active.and_then(|active| ids.iter().position(|id| *id == active)) else { return };
        let count = ids.len() as isize;
        let next = ids[((index as isize + offset + count) % count) as usize];
        self.activate(next, window, cx);
    }

    fn start_rename(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(tab) = self.tab(id) else { return };
        let title = tab.view.read(cx).title().to_string();
        self.menu = None;
        self.activate(id, window, cx);
        let input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx).placeholder("Terminal name").appearance(InputAppearance::Bare);
            input.set_text(title, cx);
            input.select_all_text(cx);
            input
        });
        let subscription = cx.subscribe_in(&input, window, move |this, input, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed | TextInputEvent::Blurred => {
                let name = input.read(cx).text().trim().to_string();
                this.finish_rename((!name.is_empty()).then_some(name), window, cx);
            }
            TextInputEvent::Cancelled => this.finish_rename(None, window, cx),
            _ => {}
        });
        window.focus(&input.focus_handle(cx), cx);
        self.renaming = Some(Renaming { id, input, _subscription: subscription });
        cx.notify();
    }

    fn finish_rename(&mut self, name: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(renaming) = self.renaming.take() else { return };
        if let (Some(name), Some(tab)) = (name, self.tab(renaming.id)) {
            tab.view.update(cx, |view, cx| view.set_custom_name(Some(name), cx));
        }
        if let Some(view) = self.active_view() {
            window.focus(&view.focus_handle(cx), cx);
        }
        cx.notify();
    }

    /// `openTerminalWindow` with the terminal's folder.
    fn open_window_here(&mut self, id: usize, cx: &mut Context<Self>) {
        let Some(tab) = self.tab(id) else { return };
        let cwd = Some(tab.view.read(cx).terminal.cwd.clone()).filter(|cwd| !cwd.as_os_str().is_empty()).or_else(|| tab.launch.cwd.clone()).or_else(|| self.cwd.clone());
        let Some(opener) = cx.try_global::<WindowOpener>().map(|opener| opener.0.clone()) else { return };
        opener(cwd, cx);
    }

    /// `renameTerminalWithIntelligence`: names the terminal from its title and folder, unless it
    /// was renamed or closed while the model answered.
    fn generate_name(&mut self, id: usize, cx: &mut Context<Self>) {
        let Some(tab) = self.tab(id) else { return };
        let Some(generator) = cx.try_global::<NameGeneratorHook>().map(|hook| hook.0.clone()) else { return };
        let (title, custom, cwd) = {
            let view = tab.view.read(cx);
            (view.title().to_string(), view.terminal.custom_name.clone(), view.terminal.cwd.clone())
        };
        let toast = Some(SharedString::from(format!("terminal-name:{id}")));
        notifications::notify(cx, notifications::NotificationKind::Info, notifications::NotificationCategory::Athas, "Generating terminal name…", None, toast.clone());
        let task = generator(title.clone(), Some(cwd), cx);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                let unchanged = this.tab(id).is_some_and(|tab| {
                    let view = tab.view.read(cx);
                    view.title() == title && view.terminal.custom_name == custom
                });
                let (kind, message, description) = match result {
                    Ok(name) if unchanged => {
                        if let Some(tab) = this.tab(id) {
                            tab.view.clone().update(cx, |view, cx| view.set_custom_name(Some(name), cx));
                        }
                        cx.notify();
                        (notifications::NotificationKind::Success, "Terminal name generated".to_string(), None)
                    }
                    Ok(_) => (notifications::NotificationKind::Info, "Terminal changed; generated name was not applied".to_string(), None),
                    Err(error) => (notifications::NotificationKind::Error, "Could not generate terminal name".to_string(), Some(error.into())),
                };
                notifications::notify(cx, kind, notifications::NotificationCategory::Athas, message, description, toast);
            })
            .ok();
        })
        .detach();
    }

    /// `exportTerminalOutput`: the scrollback to a text file the user picks.
    fn export_output(&mut self, id: usize, cx: &mut Context<Self>) {
        let Some(tab) = self.tab(id) else { return };
        let (content, name) = {
            let view = tab.view.read(cx);
            (view.terminal.export_text(), view.title().to_string())
        };
        if content.is_empty() {
            notifications::notify(cx, notifications::NotificationKind::Info, notifications::NotificationCategory::Athas, "No terminal output to export", None, Some("terminal-export".into()));
            return;
        }
        let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
        let file_name = format!("{}_{}.txt", if safe.is_empty() { "terminal".to_string() } else { safe }, today());
        let directory = self.cwd.clone().or_else(dirs_home).unwrap_or_else(|| PathBuf::from("/"));
        let picked = cx.prompt_for_new_path(&directory, Some(&file_name));
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(path))) = picked.await else { return };
            let result = std::fs::write(&path, content);
            cx.update(|cx| {
                let id = Some("terminal-export".into());
                match result {
                    Ok(()) => notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, "Terminal output exported", Some(path.to_string_lossy().into_owned().into()), id),
                    Err(error) => notifications::notify(cx, notifications::NotificationKind::Error, notifications::NotificationCategory::Athas, "Failed to export terminal output", Some(error.to_string().into()), id),
                };
            });
        })
        .detach();
    }

    fn with_active_view(&mut self, cx: &mut Context<Self>, action: impl FnOnce(&mut TerminalView, &mut Context<TerminalView>)) {
        if let Some(view) = self.active_view() {
            view.update(cx, action);
        }
    }

    fn set_zoom(&mut self, change: impl FnOnce(f32) -> f32, cx: &mut Context<Self>) {
        let zoom = change(terminal_zoom(cx));
        cx.set_global(TerminalZoom(zoom));
        cx.refresh_windows();
    }

    fn change_font_size(&mut self, change: impl FnOnce(f64) -> f64 + 'static, cx: &mut Context<Self>) {
        if cx.has_global::<settings::SettingsStore>() {
            settings::update(cx, |settings| settings.terminal_font_size = change(settings.terminal_font_size));
        }
        for tab in &self.tabs {
            tab.view.update(cx, |_, cx| cx.notify());
        }
    }

    fn register_actions(&self, element: gpui::Div, cx: &mut Context<Self>) -> gpui::Div {
        element
            .on_action(cx.listener(|this, _: &NewTerminal, window, cx| this.new_terminal(None, window, cx)))
            .on_action(cx.listener(|this, _: &CloseTerminal, window, cx| {
                if let Some(active) = this.active {
                    this.request_close(vec![active], window, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &FindInTerminal, window, cx| {
                if let Some(view) = this.active_view() {
                    view.update(cx, |view, cx| view.open_find(window, cx));
                }
            }))
            .on_action(cx.listener(|this, _: &SplitTerminalRight, window, cx| this.split(SplitAxis::Horizontal, None, window, cx)))
            .on_action(cx.listener(|this, _: &SplitTerminalDown, window, cx| this.split(SplitAxis::Vertical, None, window, cx)))
            .on_action(cx.listener(|this, _: &PreviousCommand, _, cx| this.with_active_view(cx, |view, cx| view.navigate_command(-1, cx))))
            .on_action(cx.listener(|this, _: &NextCommand, _, cx| this.with_active_view(cx, |view, cx| view.navigate_command(1, cx))))
            .on_action(cx.listener(|this, _: &UnsplitTerminal, window, cx| {
                if let Some(active) = this.active {
                    this.unsplit(active, window, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &FocusNextPane, window, cx| this.focus_pane(1, window, cx)))
            .on_action(cx.listener(|this, _: &FocusPreviousPane, window, cx| this.focus_pane(-1, window, cx)))
            .on_action(cx.listener(|this, _: &ClearTerminal, _, cx| this.with_active_view(cx, |view, cx| view.clear(cx))))
            .on_action(cx.listener(|this, _: &SelectAllInTerminal, _, cx| this.with_active_view(cx, |view, cx| view.select_all(cx))))
            .on_action(cx.listener(|this, _: &CopyLastCommandOutput, _, cx| this.with_active_view(cx, |view, cx| view.copy_last_command_output(cx))))
            .on_action(cx.listener(|this, _: &ZoomIn, _, cx| {
                this.set_zoom(|zoom| ZOOM_LEVELS.iter().copied().find(|level| *level > zoom + 0.001).unwrap_or(zoom.max(ZOOM_LEVELS[ZOOM_LEVELS.len() - 1])), cx)
            }))
            .on_action(cx.listener(|this, _: &ZoomOut, _, cx| {
                this.set_zoom(|zoom| ZOOM_LEVELS.iter().rev().copied().find(|level| *level < zoom - 0.001).unwrap_or(ZOOM_LEVELS[0]), cx)
            }))
            .on_action(cx.listener(|this, _: &ResetZoom, _, cx| this.set_zoom(|_| 1., cx)))
            .on_action(cx.listener(|this, _: &IncreaseFontSize, _, cx| this.change_font_size(|size| (size + 2.).clamp(8., 32.), cx)))
            .on_action(cx.listener(|this, _: &DecreaseFontSize, _, cx| this.change_font_size(|size| (size - 2.).clamp(8., 32.), cx)))
            .on_action(cx.listener(|this, _: &ResetFontSize, _, cx| this.change_font_size(|_| 14., cx)))
    }

    fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let modifiers = &event.keystroke.modifiers;
        if !modifiers.control || modifiers.alt || modifiers.shift || modifiers.platform || self.tabs.len() < 2 {
            return;
        }
        let offset = match event.keystroke.key.as_str() {
            "pagedown" => 1,
            "pageup" => -1,
            _ => return,
        };
        self.switch_tab(offset, window, cx);
        cx.stop_propagation();
    }

    fn tabs_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(active) = self.active else { return };
        let modifiers = &event.keystroke.modifiers;
        if modifiers.control || modifiers.alt || modifiers.platform || self.renaming.is_some() {
            return;
        }
        let ids = self.sorted_ids();
        let Some(index) = ids.iter().position(|id| *id == active) else { return };
        let pinned = self.tab(active).is_some_and(|tab| tab.pinned);
        let last = ids.len() - 1;
        let select = |index: usize| ids.get(index).copied();
        let next = match (event.keystroke.key.as_str(), modifiers.shift) {
            ("f2", false) => {
                self.start_rename(active, window, cx);
                None
            }
            ("f10", true) => {
                let position = self.tab_bounds.borrow().get(&active).map(|bounds| gpui::point(bounds.left() + px(8.), bounds.bottom() + px(4.))).unwrap_or_default();
                self.deploy_tab_menu(active, position, window, cx);
                None
            }
            ("left" | "up", false) => select(if index == 0 { last } else { index - 1 }),
            ("right" | "down", false) => select(if index == last { 0 } else { index + 1 }),
            ("home", false) => select(0),
            ("end", false) => select(last),
            ("enter" | "space", false) => {
                self.activate(active, window, cx);
                None
            }
            ("delete" | "backspace", false) if !pinned => {
                self.request_close(vec![active], window, cx);
                None
            }
            _ => return,
        };
        if let Some(next) = next.filter(|next| *next != active) {
            self.active = Some(next);
            self.clear_last_command(next);
            cx.notify();
        }
        cx.stop_propagation();
    }

    fn deploy_tab_menu(&mut self, id: usize, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(tab) = self.tab(id) else { return };
        let pinned = tab.pinned;
        let split = self.layouts.is_split(id);
        let this = cx.weak_entity();
        let item = |label: &'static str, icon: Option<IconName>, action: fn(&mut Self, usize, &mut Window, &mut Context<Self>)| {
            let this = this.clone();
            let item = MenuItem::new(label).on_select(move |window, cx| {
                this.update(cx, |panel, cx| action(panel, id, window, cx)).ok();
            });
            match icon {
                Some(icon) => item.icon(icon),
                None => item,
            }
        };
        let mut entries: Vec<MenuEntry> = vec![
            item(if pinned { "Unpin Terminal" } else { "Pin Terminal" }, Some(if pinned { IconName::PinSlash } else { IconName::Pin }), |panel, id, _, cx| {
                panel.toggle_pin(id, cx)
            })
            .into(),
            MenuEntry::Separator,
            item("Split Right", Some(IconName::Columns), |panel, id, window, cx| panel.split(SplitAxis::Horizontal, Some(id), window, cx)).into(),
            item("Split Down", Some(IconName::Rows), |panel, id, window, cx| panel.split(SplitAxis::Vertical, Some(id), window, cx)).into(),
        ];
        if split {
            entries.push(item("Unsplit", Some(IconName::TerminalWindow), Self::unsplit).into());
        }
        entries.push(MenuEntry::Separator);
        if cx.has_global::<WindowOpener>() {
            entries.push(item("New Terminal Window Here", Some(IconName::TerminalWindow), |panel, id, _, cx| panel.open_window_here(id, cx)).into());
        }
        entries.extend([
            item("Duplicate Terminal", Some(IconName::Copy), Self::duplicate).into(),
            item("Clear Terminal", Some(IconName::ArrowCounterClockwise), |panel, id, _, cx| {
                if let Some(tab) = panel.tab(id) {
                    tab.view.clone().update(cx, |view, cx| view.clear(cx));
                }
            })
            .into(),
            item("Rename Terminal", Some(IconName::Pen), Self::start_rename).into(),
        ]);
        if cx.has_global::<NameGeneratorHook>() {
            entries.push(item("Generate Terminal Name", Some(IconName::Sparkle), |panel, id, _, cx| panel.generate_name(id, cx)).into());
        }
        entries.extend([
            item("Export Output", Some(IconName::Download), |panel, id, _, cx| panel.export_output(id, cx)).into(),
            MenuEntry::Separator,
            item("Close Terminal", None, |panel, id, window, cx| panel.request_close(vec![id], window, cx)).into(),
            item("Close Other Terminals", None, Self::close_others).into(),
            item("Close All Terminals", None, |panel, _, window, cx| panel.close_all(window, cx)).into(),
            item("Close Terminals to Right", None, Self::close_to_the_right).into(),
        ]);
        self.menu = Some(OpenMenu::new("terminal-tab", entries, position, Anchor::TopLeft, window, cx, |this: &mut Self, _| this.menu = None));
        cx.notify();
    }

    /// The header's own menu, on empty space beside the tabs.
    fn deploy_toolbar_menu(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.weak_entity();
        let item = |label: &'static str, icon: IconName, action: fn(&mut Self, &mut Window, &mut Context<Self>)| {
            let this = this.clone();
            MenuItem::new(label)
                .icon(icon)
                .on_select(move |window, cx| {
                    this.update(cx, |panel, cx| action(panel, window, cx)).ok();
                })
                .into()
        };
        let entries: Vec<MenuEntry> = vec![
            item("New Terminal", IconName::Plus, |panel, window, cx| panel.new_terminal(None, window, cx)),
            item("Search", IconName::Search, |panel, window, cx| {
                if let Some(view) = panel.active_view() {
                    view.update(cx, |view, cx| view.open_find(window, cx));
                }
            }),
            item("Next Tab", IconName::ArrowDown, |panel, window, cx| panel.switch_tab(1, window, cx)),
            item("Previous Tab", IconName::ArrowUp, |panel, window, cx| panel.switch_tab(-1, window, cx)),
            MenuEntry::Separator,
            item(
                if self.full_screen { "Exit Full Screen" } else { "Full Screen" },
                if self.full_screen { IconName::ArrowsIn } else { IconName::ArrowsOut },
                |_, _, cx| cx.emit(TerminalPanelEvent::ToggleFullScreen),
            ),
        ];
        self.menu = Some(OpenMenu::new("terminal-toolbar", entries, position, Anchor::TopLeft, window, cx, |this: &mut Self, _| this.menu = None));
        cx.notify();
    }

    fn render_tab(&self, id: usize, tabs_focused: bool, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let tab = self.tab(id).expect("listed tab");
        let title: SharedString = tab.view.read(cx).title().to_string().into();
        let active = self.active == Some(id) && !self.failed_active;
        let colors = cx.theme().colors.clone();

        if let Some(renaming) = self.renaming.as_ref().filter(|renaming| renaming.id == id) {
            return div()
                .id(("terminal-tab-slot", id))
                .flex()
                .flex_none()
                .items_center()
                .h(metrics::TAB)
                .w(px(140.))
                .px(px(8.))
                .rounded_full()
                .bg(colors.selected)
                .text_size(typography::TEXT_CHROME)
                .text_color(colors.foreground)
                .child(renaming.input.clone())
                .into_any_element();
        }

        let progress = tab.view.read(cx).terminal.progress;
        let show_icons = terminal_settings(cx).show_tab_icons;
        let leading = leading_indicator(id, progress, tab.last_command.filter(|_| !active), show_icons, &colors);
        let split = self.layouts.is_split(id);
        let pinned = tab.pinned;
        let dragged = DraggedTerminalTab { id, title: title.clone(), panel: cx.weak_entity() };
        let bounds = self.tab_bounds.clone();
        let cwd = tab.view.read(cx).terminal.cwd.clone();
        let tooltip: SharedString = if cwd.as_os_str().is_empty() { title.clone() } else { format!("{title} — {}", cwd.display()).into() };
        div()
            .id(("terminal-tab-slot", id))
            .relative()
            .flex_none()
            .anchored_tooltip({ let tip: SharedString = (tooltip).into(); move || ui::Tooltip::new(tip.clone()) })
            .child(canvas(move |tab_bounds, _, _| bounds.borrow_mut().insert(id, tab_bounds), |_, _, _, _| {}).absolute().size_full())
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    cx.stop_propagation();
                    this.deploy_tab_menu(id, event.position, window, cx);
                }),
            )
            .on_mouse_down(
                MouseButton::Middle,
                cx.listener(move |this, _, window, cx| {
                    cx.stop_propagation();
                    if !pinned {
                        this.request_close(vec![id], window, cx);
                    }
                }),
            )
            .on_drag(dragged, |dragged, _, _, cx| cx.new(|_| DraggedTabPreview(dragged.title.clone())))
            .drag_over::<DraggedTerminalTab>(move |style, _, _, _| style.border_l_2().border_color(colors.primary))
            .on_drop(cx.listener(move |this, dragged: &DraggedTerminalTab, _, cx| this.reorder(dragged.id, id, cx)))
            .child(
                Tab::new(("terminal-tab", id), title)
                    .when(leading.is_some() || split, |tab| {
                        tab.leading(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(metrics::CHROME_GAP)
                                .children(leading)
                                .when(split, |this| this.child(ui::Icon::new(IconName::Columns).size(ui::IconSize::XSmall).color(colors.subtle_foreground))),
                        )
                    })
                    .pinned(pinned)
                    .active(active)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if this.active == Some(id) {
                            window.focus(&this.tabs_focus, cx);
                            cx.notify();
                        } else {
                            this.activate(id, window, cx);
                        }
                    }))
                    .on_close(cx.listener(move |this, _, window, cx| {
                        if pinned {
                            this.toggle_pin(id, cx);
                        } else {
                            this.request_close(vec![id], window, cx);
                        }
                    })),
            )
            .when(tabs_focused && active, |slot| slot.child(div().absolute().inset_0().rounded_full().border_1().border_color(colors.focus_ring)))
            .into_any_element()
    }

    /// Moves the dragged tab to where `target` is.
    fn reorder(&mut self, dragged: usize, target: usize, cx: &mut Context<Self>) {
        if dragged == target {
            return;
        }
        let (Some(from), Some(to)) = (self.index_of(dragged), self.index_of(target)) else { return };
        let tab = self.tabs.remove(from);
        self.tabs.insert(to, tab);
        cx.notify();
    }

    /// Pinned tabs stay put at the start; the others (and a failed start's) scroll sideways after
    /// them (`pinnedTerminals` beside the `TabStrip`).
    fn render_tabs(&self, tabs_focused: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let ids = self.sorted_ids();
        self.tab_bounds.borrow_mut().retain(|id, _| ids.contains(id));
        let (pinned, regular): (Vec<usize>, Vec<usize>) = ids.into_iter().partition(|id| self.tab(*id).is_some_and(|tab| tab.pinned));
        let pinned = (!pinned.is_empty()).then(|| {
            div()
                .flex()
                .flex_none()
                .h_full()
                .items_center()
                .gap(metrics::CHROME_GAP_TIGHT)
                .pr(px(2.))
                .children(pinned.into_iter().map(|id| self.render_tab(id, tabs_focused, cx)))
        });
        div()
            .id("terminal-tabs")
            .track_focus(&self.tabs_focus)
            .key_context("TerminalTabs")
            .on_key_down(cx.listener(Self::tabs_key_down))
            .flex()
            .flex_1()
            .min_w_0()
            .h_full()
            .items_center()
            .gap(metrics::CHROME_GAP_TIGHT)
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|this, event: &MouseDownEvent, window, cx| this.deploy_toolbar_menu(event.position, window, cx)),
            )
            .children(pinned)
            .child(
                div()
                    .id("terminal-tab-strip")
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .items_center()
                    .gap(metrics::CHROME_GAP_TIGHT)
                    .overflow_x_scroll()
                    .children(regular.into_iter().map(|id| self.render_tab(id, tabs_focused, cx).into_any_element()))
                    .children(self.failed.as_ref().map(|failed| self.render_failed_tab(failed, cx))),
            )
    }

    fn render_actions(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let find_shortcut = command_shortcut("terminal.find", cx);
        pane_actions()
            .child(
                Button::icon("terminal-find", IconName::Search)
                    .size(ButtonSize::Small)
                    .tooltip("Find in Terminal")
                    .when_some(find_shortcut, |button, shortcut| button.shortcut(shortcut))
                    .on_click(cx.listener(|this, _, window, cx| {
                        if let Some(view) = this.active_view() {
                            view.update(cx, |view, cx| view.open_find(window, cx));
                        }
                    })),
            )
            .child(self.new_menu.clone())
            .when(self.active.is_some(), |this| {
                this.child(
                    Button::icon("terminal-split", IconName::Columns)
                        .size(ButtonSize::Small)
                        .tooltip("Split Terminal")
                        .on_click(cx.listener(|this, _, window, cx| this.split(SplitAxis::Horizontal, None, window, cx))),
                )
            })
            .child(
                Button::icon("terminal-full-screen", if self.full_screen { IconName::ArrowsIn } else { IconName::ArrowsOut })
                    .size(ButtonSize::Small)
                    .tooltip(if self.full_screen { "Exit Full Screen" } else { "Full Screen Terminal" })
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(TerminalPanelEvent::ToggleFullScreen))),
            )
            .child(
                Button::icon("terminal-hide", IconName::X)
                    .size(ButtonSize::Small)
                    .tooltip("Close Panel")
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(TerminalPanelEvent::Hide))),
            )
    }

    fn render_node(&self, node: &PaneNode, cx: &mut Context<Self>) -> gpui::AnyElement {
        match node {
            PaneNode::Leaf(id) => self.render_leaf(*id, cx),
            PaneNode::Split { id: split_id, axis, .. } => {
                let split_id = *split_id;
                let horizontal = *axis == SplitAxis::Horizontal;
                let entries = flatten(node);
                let count = entries.len();
                let sizes = self.split_sizes.clone();
                let mut container = div().relative().flex().size_full().min_w_0().min_h_0().when(horizontal, |this| this.flex_row()).when(!horizontal, |this| this.flex_col());
                for (index, entry) in entries.iter().enumerate() {
                    container = container.child(
                        div()
                            .flex()
                            .flex_basis(px(0.))
                            .flex_grow(entry.size)
                            .flex_shrink(1.)
                            .min_w_0()
                            .min_h_0()
                            .overflow_hidden()
                            .child(self.render_node(entry.node, cx)),
                    );
                    if index + 1 < count {
                        let pair = [entry.size, entries[index + 1].size];
                        container = container.child(self.render_handle(split_id, index, horizontal, pair, cx));
                    }
                }
                container
                    .child(
                        canvas(
                            move |bounds, _, _| {
                                let size = if horizontal { bounds.size.width } else { bounds.size.height };
                                sizes.borrow_mut().insert(split_id, size);
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .into_any_element()
            }
        }
    }

    fn render_handle(&self, split: usize, index: usize, horizontal: bool, sizes: [f32; 2], cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let resizing = self.split_drag.is_some_and(|drag| drag.split == split && drag.index == index);
        let line = if resizing { cx.theme().colors.primary } else { cx.theme().colors.border_strong };
        let group: SharedString = format!("terminal-split-handle-{split}-{index}").into();
        div()
            .id(SharedString::from(format!("terminal-split-{split}-{index}")))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .group(group.clone())
            .when(horizontal, |this| this.w(metrics::WORKBENCH_GAP).h_full().cursor_col_resize())
            .when(!horizontal, |this| this.h(metrics::WORKBENCH_GAP).w_full().cursor_row_resize())
            .child(
                div()
                    .when(horizontal, |this| this.w(px(1.)).h_full())
                    .when(!horizontal, |this| this.h(px(1.)).w_full())
                    .bg(cx.theme().colors.border)
                    .when(resizing, |this| this.bg(line))
                    .group_hover(group, move |style| style.bg(line)),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    if event.click_count >= 2 {
                        this.layouts.distribute(split);
                        this.split_drag = None;
                    } else {
                        let start = if horizontal { event.position.x } else { event.position.y };
                        this.split_drag = Some(SplitDrag { split, index, horizontal, start, sizes });
                    }
                    cx.notify();
                }),
            )
    }

    fn drag_split(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        let Some(drag) = self.split_drag else { return };
        if !event.dragging() {
            self.split_drag = None;
            cx.notify();
            return;
        }
        let Some(total) = self.split_sizes.borrow().get(&drag.split).copied().filter(|size| *size > px(0.)) else { return };
        let position = if drag.horizontal { event.position.x } else { event.position.y };
        let delta = f32::from(position - drag.start) / f32::from(total) * 100.;
        let pair = drag.sizes[0] + drag.sizes[1];
        let first = (drag.sizes[0] + delta).clamp(MIN_PANE_SIZE.min(pair / 2.), pair - MIN_PANE_SIZE.min(pair / 2.));
        self.layouts.resize(drag.split, drag.index, [first / pair * 100., (pair - first) / pair * 100.]);
        cx.notify();
    }

    fn render_leaf(&self, id: usize, cx: &mut Context<Self>) -> gpui::AnyElement {
        let Some(tab) = self.tab(id) else { return div().into_any_element() };
        let zone = self.drop_target.filter(|(target, _)| *target == id).map(|(_, zone)| zone);
        let colors = cx.theme().colors.clone();
        let overlay = zone.map(|zone| {
            let base = div().absolute().border_2().border_color(colors.primary).bg(colors.primary_soft).rounded(metrics::RADIUS);
            match zone {
                DropZone::Left => base.top_0().bottom_0().left_0().w_1_2(),
                DropZone::Right => base.top_0().bottom_0().right_0().w_1_2(),
                DropZone::Top => base.left_0().right_0().top_0().h_1_2(),
                DropZone::Bottom => base.left_0().right_0().bottom_0().h_1_2(),
            }
        });
        div()
            .id(("terminal-pane", id))
            .relative()
            .flex()
            .size_full()
            .min_w_0()
            .min_h_0()
            .on_drag_move::<DraggedTerminalTab>(cx.listener(move |this, event: &DragMoveEvent<DraggedTerminalTab>, _, cx| {
                let dragged = event.drag(cx).id;
                let next = if event.bounds.contains(&event.event.position) && dragged != id {
                    DropZone::at(event.event.position, event.bounds).map(|zone| (id, zone))
                } else if this.drop_target.is_some_and(|(target, _)| target == id) {
                    None
                } else {
                    return;
                };
                if this.drop_target != next {
                    this.drop_target = next;
                    cx.notify();
                }
            }))
            .on_drop(cx.listener(move |this, dragged: &DraggedTerminalTab, window, cx| {
                let target = this.drop_target.take();
                if let Some((target, zone)) = target.filter(|(target, _)| *target == id && dragged.id != id) {
                    let (axis, placement) = zone.split();
                    this.layouts.split(target, dragged.id, axis, placement);
                    this.activate(dragged.id, window, cx);
                }
                cx.notify();
            }))
            // The original dims every pane of a split but the active one (`opacity-60`).
            .child(div().flex().size_full().min_w_0().min_h_0().when(self.active != Some(id), |this| this.opacity(0.6)).child(tab.view.clone()))
            .children(overlay)
            .into_any_element()
    }
}

/// The key a command is bound to, as a tooltip shows it.
fn command_shortcut(command: &str, cx: &App) -> Option<SharedString> {
    let active = cx.try_global::<keymap::ActiveKeymap>()?;
    let binding = active.bindings.iter().find(|binding| binding.command == command && binding.enabled != Some(false))?;
    Some(keymap::display_key(&binding.key).into())
}

#[cfg(not(target_family = "wasm"))]
fn dirs_home() -> Option<PathBuf> {
    dirs::home_dir()
}

#[cfg(target_family = "wasm")]
fn dirs_home() -> Option<PathBuf> {
    None
}

/// Today's date as `YYYY-MM-DD` (UTC), for export file names.
fn today() -> String {
    let days = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|elapsed| elapsed.as_secs() / 86_400).unwrap_or(0) as i64;
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

impl Render for TerminalPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let layout = self.active.map(|active| self.layouts.find(active).cloned().unwrap_or(PaneNode::Leaf(active)));
        let failed = self.failed.as_ref().filter(|_| self.failed_active).map(|failed| failed.error.clone());
        let body = match layout {
            _ if let Some(error) = failed.clone() => div()
                .id("terminal-failed-start")
                .flex()
                .flex_1()
                .min_h_0()
                .items_center()
                .justify_center()
                .child(self.render_failed_start(error, cx))
                .into_any_element(),
            Some(node) => div().relative().flex().flex_1().min_h_0().min_w_0().child(self.render_node(&node, cx)).into_any_element(),
            None if self.starting > 0 => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(EmptyState::new("Starting terminal…").icon(IconName::TerminalWindow).message("Connecting to the project's server."))
                .into_any_element(),
            None => {
                let message = "Start a shell in the active project's folder.";
                div()
                    .flex()
                    .flex_1()
                    .items_center()
                    .justify_center()
                    .child(
                        EmptyState::new("No terminals")
                            .icon(IconName::TerminalWindow)
                            .message(message)
                            .action(
                                Button::new("terminal-start", "New Terminal")
                                    .leading_icon(IconName::Plus)
                                    .size(ButtonSize::Small)
                                    .on_click(cx.listener(|this, _, window, cx| this.new_terminal(None, window, cx))),
                            ),
                    )
                    .into_any_element()
            }
        };
        let scrim = cx.theme().colors.scrim;

        let root = div()
            .track_focus(&self.focus_handle)
            .key_context("TerminalPanel")
            .on_key_down(cx.listener(Self::key_down))
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| this.drag_split(event, cx)))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    if this.split_drag.take().is_some() || this.drop_target.take().is_some() {
                        cx.notify();
                    }
                }),
            )
            .relative()
            .group("chrome-host")
            .flex()
            .flex_col()
            .size_full()
            .bg(cx.theme().colors.background);
        self.register_actions(root, cx)
            .when(!self.buffer, |this| this.child(pane_header(cx).child(self.render_tabs(self.tabs_focus.is_focused(window), cx)).child({
                // `ChromeGroup reveal`: the actions show while the pane is hovered or one of
                // their menus is open.
                let shown = self.menu.is_some() || self.new_menu.read(cx).is_open();
                div()
                    .flex()
                    .flex_none()
                    .when(!shown, |this| this.opacity(0.).group_hover("chrome-host", |style| style.opacity(1.)))
                    .child(self.render_actions(cx))
            })))
            .child(body)
            .children(self.menu.as_ref().map(|menu| menu.render()))
            .children(self.confirmation.as_ref().map(|confirmation| {
                deferred(div().id("terminal-confirm-layer").absolute().inset_0().bg(scrim).flex().items_center().justify_center().occlude().child(confirmation.dialog.clone()))
                    .with_priority(2)
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_completions_read_like_the_web_workbench() {
        use std::time::Duration;
        assert_eq!(format_duration(Duration::from_millis(400)), "1s");
        assert_eq!(format_duration(Duration::from_secs(125)), "2m 05s");
        assert_eq!(format_duration(Duration::from_secs(3780)), "1h 03m");
        let (message, description, kind) = describe_command_completion("zsh", Some(2), Duration::from_secs(12));
        assert_eq!((message.as_str(), description.as_str(), kind), ("Command failed in zsh", "Exit code 2 after 12s", notifications::NotificationKind::Error));
        let (message, _, kind) = describe_command_completion("zsh", Some(0), Duration::from_secs(12));
        assert_eq!((message.as_str(), kind), ("Command finished in zsh", notifications::NotificationKind::Success));
    }

    #[test]
    fn drop_zones() {
        let bounds = Bounds::new(Point::new(px(0.), px(0.)), gpui::size(px(100.), px(100.)));
        let at = |x: f32, y: f32| DropZone::at(Point::new(px(x), px(y)), bounds);
        assert_eq!(at(10., 50.), Some(DropZone::Left));
        assert_eq!(at(90., 50.), Some(DropZone::Right));
        assert_eq!(at(50., 10.), Some(DropZone::Top));
        assert_eq!(at(50., 90.), Some(DropZone::Bottom));
        assert_eq!(at(50., 50.), None);
    }

    #[test]
    fn export_dates() {
        assert_eq!(today().len(), 10);
    }
}
