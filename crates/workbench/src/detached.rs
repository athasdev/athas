//! Single-view windows next to the workbench (`window/detached/*`): a terminal, Settings or
//! Extensions in a bare window of its own (`window.newTerminalWindow`, `newSettingsWindow`,
//! `newExtensionsWindow`, `standalone-content-window.tsx`), and one agent session taken out of the
//! workbench (`detached-agent-window.tsx`), or a GitHub pull request, issue or run
//! (`detached-resource-window.tsx`). Each has the minimal title bar of
//! `detached-window-shell.tsx`; the desktop app opens the native window, previews render the root
//! view headlessly.

use ui::TooltipExt as _;
use std::{collections::HashMap, path::PathBuf, rc::Rc};

use ui::scale::px;
use gpui::{
    AnyView, AnyWindowHandle, App, Context, FocusHandle, Focusable, Global, MouseButton, MouseMoveEvent, SharedString,
    Subscription, Window, WindowControlArea, actions, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, metrics, typography};

use crate::{CloseTab, CloseWindow, MinimizeWindow, Platform, Quit, ToggleFullscreen, ZoomWindow};

actions!(
    workbench,
    [
        /// Opens a terminal in its own window.
        NewTerminalWindow,
        /// Opens Settings in its own window.
        NewSettingsWindow,
        /// Opens Extensions in its own window.
        NewExtensionsWindow,
    ]
);

pub(crate) fn register(cx: &mut App) {
    keymap::register(cx, "window.newTerminalWindow", NewTerminalWindow);
    keymap::register(cx, "window.newSettingsWindow", NewSettingsWindow);
    keymap::register(cx, "window.newExtensionsWindow", NewExtensionsWindow);
    terminal_view::set_window_opener(
        |cwd, cx| {
            open_detached(DetachedContent::Terminal { cwd }, cx);
        },
        cx,
    );
}

/// A session shown on its own (`AgentWindowSnapshot`): what its view needs to start.
#[derive(Clone, Debug, PartialEq)]
pub struct DetachedSession {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub cwd: Option<PathBuf>,
    pub folders: Vec<PathBuf>,
}

/// What a detached window shows (`StandaloneContentSpec`, the agent window).
#[derive(Clone, Debug, PartialEq)]
pub enum DetachedContent {
    Terminal { cwd: Option<PathBuf> },
    Settings,
    Extensions,
    Session(DetachedSession),
    /// A GitHub page (`ResourceWindowPayload`): `kind` and `id` as the centre's resource tab
    /// names them, of the repository at `root`.
    Resource { kind: String, id: String, title: String, root: PathBuf },
}

impl DetachedContent {
    /// The native window's title (`window_title_for_request`).
    pub fn window_title(&self) -> String {
        let title = match self {
            Self::Terminal { .. } => "Terminal",
            Self::Settings => "Settings",
            Self::Extensions => "Integrations",
            Self::Session(_) => "Agents",
            // `DetachedWindowShell` names a GitHub page's window after it: "#41 Fix login — Athas".
            Self::Resource { .. } => return format!("{} — Athas", self.title()),
        };
        format!("{title} - Athas")
    }

    /// The title the window's title bar shows: the buffer's name.
    pub fn title(&self) -> String {
        match self {
            Self::Terminal { .. } => "Terminal".into(),
            Self::Settings => "Settings".into(),
            Self::Extensions => "Integrations".into(),
            Self::Session(session) => if session.title.trim().is_empty() { "New session".into() } else { session.title.clone() },
            Self::Resource { kind, id, title, .. } => {
                if !title.trim().is_empty() {
                    return title.clone();
                }
                match kind.as_str() {
                    "github-pr" => format!("Pull request #{id}"),
                    "github-issue" => format!("Issue #{id}"),
                    _ => "Athas".into(),
                }
            }
        }
    }

    /// The resource's icon beside the title (`ResourceBufferIcon`).
    fn icon(&self) -> Option<IconName> {
        match self {
            Self::Resource { kind, .. } => Some(match kind.as_str() {
                "github-pr" => IconName::GitPullRequest,
                "github-issue" => IconName::CircleDot,
                "github-run" => IconName::PlayCircle,
                _ => IconName::Github,
            }),
            _ => None,
        }
    }

    /// Workbench windows sit on the window plane, see-through with glass; the others are one
    /// opaque document (`plane` of `DetachedWindowShell`).
    /// Whether the view runs to the window's top and the title bar is only an invisible drag
    /// strip over it (Settings, whose sidebar sits under the traffic lights).
    pub fn overlays_title_bar(&self) -> bool {
        matches!(self, Self::Settings)
    }

    pub fn on_window_plane(&self) -> bool {
        matches!(self, Self::Session(_))
    }

    /// One window per session: asking again focuses the window it already has.
    fn key(&self) -> Option<String> {
        match self {
            Self::Session(session) => Some(format!("session:{}", session.id)),
            // One window per resource (`getResourceWindowKey`).
            Self::Resource { kind, id, root, .. } => Some(format!("{kind}:{}:{id}", root.display())),
            _ => None,
        }
    }
}

/// Opens detached windows; the desktop app installs it.
#[derive(Clone)]
pub struct DetachedOpener(Rc<dyn Fn(DetachedContent, &mut App) -> Option<AnyWindowHandle>>);

impl Global for DetachedOpener {}

pub fn set_detached_opener(cx: &mut App, opener: impl Fn(DetachedContent, &mut App) -> Option<AnyWindowHandle> + 'static) {
    cx.set_global(DetachedOpener(Rc::new(opener)));
}

/// The detached windows that show one thing only once, by key.
#[derive(Default)]
struct DetachedWindows(HashMap<String, AnyWindowHandle>);

impl Global for DetachedWindows {}

fn find(key: &str, cx: &App) -> Option<AnyWindowHandle> {
    let handle = *cx.try_global::<DetachedWindows>()?.0.get(key)?;
    cx.windows().into_iter().any(|open| open.window_id() == handle.window_id()).then_some(handle)
}

/// Opens `content` in a window of its own, or focuses the window that already shows it.
/// Runs `change` on the workbench window that holds session `id` (the one it was taken out of).
fn with_session_owner(id: &workspace::SessionId, cx: &mut App, change: impl FnOnce(&mut crate::Workbench, &mut Context<crate::Workbench>)) {
    let mut change = Some(change);
    for handle in cx.windows().into_iter().filter_map(|handle| handle.downcast::<crate::Workbench>()) {
        let Some(run) = change.take() else { return };
        let mut run = Some(run);
        let _ = handle.update(cx, |workbench, _, cx| {
            if workbench.state.session(id).is_some()
                && let Some(run) = run.take()
            {
                run(workbench, cx);
            }
        });
        change = run;
    }
}

pub fn open_detached(content: DetachedContent, cx: &mut App) -> bool {
    let key = content.key();
    if let Some(handle) = key.as_deref().and_then(|key| find(key, cx)) {
        handle.update(cx, |_, window, _| window.activate_window()).ok();
        return true;
    }
    let Some(opener) = cx.try_global::<DetachedOpener>().cloned() else {
        notifications::info(cx, "New windows need the desktop app");
        return false;
    };
    let Some(handle) = (opener.0)(content, cx) else { return false };
    if let Some(key) = key {
        cx.default_global::<DetachedWindows>().0.insert(key, handle);
    }
    true
}

/// Whether a session shows in a window of its own.
pub fn session_is_detached(id: &str, cx: &App) -> bool {
    find(&format!("session:{id}"), cx).is_some()
}

/// Every session showing in a window of its own, for a list that would otherwise ask about each
/// of its rows: `find` walks the open windows, and a sidebar of two hundred rows walked them two
/// hundred times a frame.
pub fn detached_sessions(cx: &App) -> std::collections::HashSet<String> {
    let Some(windows) = cx.try_global::<DetachedWindows>() else { return Default::default() };
    if windows.0.is_empty() {
        return Default::default();
    }
    let open: std::collections::HashSet<gpui::WindowId> = cx.windows().into_iter().map(|window| window.window_id()).collect();
    windows
        .0
        .iter()
        .filter(|(_, handle)| open.contains(&handle.window_id()))
        .filter_map(|(key, _)| key.strip_prefix("session:").map(str::to_string))
        .collect()
}

/// Takes a session back from its window (`recallAgentWindow`): the window closes, so the
/// workbench can show it again.
pub fn recall_session(id: &str, cx: &mut App) {
    let key = format!("session:{id}");
    let Some(handle) = cx.try_global::<DetachedWindows>().and_then(|windows| windows.0.get(&key).copied()) else { return };
    cx.default_global::<DetachedWindows>().0.remove(&key);
    cx.defer(move |cx| {
        handle.update(cx, |_, window, _| window.remove_window()).ok();
    });
}

/// The root view of a detached window: a 32px title bar and the one view it hosts.
/// Where the buttons centre in a window that draws over the title bar: the room its own chrome
/// leaves at the top (`traffic_light_position`'s y 20 plus half a 14px button).
const OVERLAY_LIGHTS_CENTRE: f32 = 27.;

/// Where a single-view window that draws over the title bar wants its window buttons, for the
/// platform crate that opens it.
pub fn detached_traffic_lights() -> gpui::Point<gpui::Pixels> {
    ui::metrics::traffic_light_position(ui::scale::px(OVERLAY_LIGHTS_CENTRE))
}

pub struct DetachedWindow {
    content: DetachedContent,
    view: AnyView,
    focus: FocusHandle,
    /// The window's own focus, on the root that carries the `App` key context. Its view may stop
    /// being drawn; this one always is, so the window keeps answering the global shortcuts.
    root_focus: FocusHandle,
    platform: Platform,
    should_move_window: bool,
    /// The zoom the window buttons were last placed for.
    traffic_lights_zoom: f32,
    _subscriptions: Vec<Subscription>,
}

impl DetachedWindow {
    pub fn new(content: DetachedContent, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut subscriptions = Vec::new();
        // Toasts raised while this window is in front show here (`detached-window-shell.tsx`
        // gives each window its own toaster).
        crate::windows::set_toast_window(window.window_handle().window_id(), cx);
        subscriptions.push(cx.observe_window_activation(window, |_, window, cx| {
            if window.is_window_active() {
                crate::windows::set_toast_window(window.window_handle().window_id(), cx);
            }
        }));
        subscriptions.push(cx.observe_global::<notifications::Notifications>(|_, cx| cx.notify()));
        let (view, focus): (AnyView, FocusHandle) = match &content {
            DetachedContent::Terminal { cwd } => {
                let terminal = cx.new(|cx| {
                    terminal_view::TerminalPanel::with_starter(cwd.clone(), Some(crate::remote_projects::terminal_starter()), window, cx)
                });
                // The last terminal closed: the window has nothing left to show.
                subscriptions.push(cx.subscribe_in(&terminal, window, |_, _, event: &terminal_view::TerminalPanelEvent, window, _| {
                    if matches!(event, terminal_view::TerminalPanelEvent::Hide) {
                        window.remove_window();
                    }
                }));
                let focus = terminal.focus_handle(cx);
                (terminal.into(), focus)
            }
            DetachedContent::Settings => {
                let settings = cx.new(|cx| {
                    let mut view = settings_ui::SettingsView::new(None, window, cx);
                    view.set_presentation(settings_ui::SettingsPresentation::Window);
                    view
                });
                let focus = settings.focus_handle(cx);
                (settings.into(), focus)
            }
            DetachedContent::Extensions => {
                let extensions = cx.new(|cx| extensions_ui::ExtensionsView::new(window, cx));
                let focus = extensions.focus_handle(cx);
                (extensions.into(), focus)
            }
            DetachedContent::Session(session) => {
                let info = agent_ui::SessionInfo {
                    id: session.id.clone(),
                    title: session.title.clone(),
                    agent: session.agent.clone(),
                    cwd: session.cwd.clone(),
                };
                let folders = session.folders.clone();
                let view = cx.new(|cx| agent_ui::SessionView::new(info, window, cx));
                view.update(cx, |view, _| view.set_workspace_folders(folders));
                // What the session says goes to the workbench that owns it, as it does for a
                // session in a tab: file links open there, and its title and status (which the
                // quit guard reads for running agents) stay current.
                let session_id = workspace::SessionId(session.id.clone());
                subscriptions.push(cx.subscribe(&view, move |_, _, event: &agent_ui::SessionViewEvent, cx| {
                    use agent_ui::SessionViewEvent;
                    let id = session_id.clone();
                    match event {
                        SessionViewEvent::TitleChanged(title) => {
                            let title = title.clone();
                            with_session_owner(&session_id, cx, move |workbench, cx| workbench.update_state(cx, |state| state.rename_session(&id, &title)));
                        }
                        SessionViewEvent::StatusChanged(status) => {
                            let status = *status;
                            with_session_owner(&session_id, cx, move |workbench, cx| workbench.update_state(cx, |state| state.set_session_status(&id, status)));
                        }
                        SessionViewEvent::Activity => {
                            with_session_owner(&session_id, cx, move |workbench, cx| workbench.update_state(cx, |state| state.touch_session(&id, workspace::now_ms())));
                        }
                        SessionViewEvent::OpenFile(path) => {
                            let path = path.to_string_lossy().into_owned();
                            with_session_owner(&session_id, cx, move |workbench, cx| workbench.update_state(cx, |state| state.open_file(&path)));
                        }
                        SessionViewEvent::OpenBrowser(url) => browser_view::open_browser_tab(url.as_deref(), cx),
                        _ => {}
                    }
                }));
                let focus = view.focus_handle(cx);
                (view.into(), focus)
            }
            DetachedContent::Resource { kind, id, root, .. } => {
                let view = github_panel::open_resource(kind, id, root.clone(), window, cx)
                    .unwrap_or_else(|| cx.new(|_| NothingToShow).into());
                (view, cx.focus_handle())
            }
        };
        window.focus(&focus, cx);
        window.set_window_title(&content.window_title());
        window.set_background_appearance(Self::background(&content, cx));
        subscriptions.push(cx.observe_global_in::<settings::SettingsStore>(window, |this, window, cx| {
            window.set_background_appearance(Self::background(&this.content, cx));
            cx.notify();
        }));
        let root_focus = cx.focus_handle();
        // The view holding the keyboard may stop being drawn; with nothing focused the window
        // answers no shortcut, so the root takes it back.
        let root = root_focus.clone();
        subscriptions.push(cx.on_focus_lost(window, move |_, window, cx| window.focus(&root, cx)));
        Self {
            content,
            view,
            focus,
            root_focus,
            platform: Platform::current(),
            should_move_window: false,
            traffic_lights_zoom: ui::scale::zoom(),
            _subscriptions: subscriptions,
        }
    }

    pub fn content(&self) -> &DetachedContent {
        &self.content
    }

    /// The buttons hold AppKit's size and last position through a zoom; a window that draws over
    /// the title bar puts them back where its own chrome leaves room.
    fn centre_traffic_lights(&mut self, window: &Window) {
        let zoom = ui::scale::zoom();
        if !self.content.overlays_title_bar() || !Platform::current().has_traffic_lights() || self.traffic_lights_zoom == zoom {
            return;
        }
        self.traffic_lights_zoom = zoom;
        #[cfg(target_os = "macos")]
        window.set_traffic_light_position(ui::metrics::traffic_light_position(ui::scale::px(OVERLAY_LIGHTS_CENTRE)));
        #[cfg(not(target_os = "macos"))]
        let _ = window;
    }

    /// Zooms what this window shows: a terminal window its terminal, anything else the editors.
    fn zoom_view(&mut self, step: Option<bool>, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(self.content, DetachedContent::Terminal { .. }) {
            let action: Box<dyn gpui::Action> = match step {
                Some(true) => Box::new(terminal_view::IncreaseFontSize),
                Some(false) => Box::new(terminal_view::DecreaseFontSize),
                None => Box::new(terminal_view::ResetFontSize),
            };
            window.dispatch_action(action, cx);
            return;
        }
        match step {
            Some(in_) => ui::scale::zoom_by(in_, cx),
            None => ui::scale::reset_zoom(cx),
        }
    }

    /// Draws the window chrome of another platform, for previews.
    pub fn set_platform(&mut self, platform: Platform) {
        self.platform = platform;
    }

    fn background(content: &DetachedContent, cx: &App) -> gpui::WindowBackgroundAppearance {
        if content.on_window_plane() { crate::background_appearance(cx) } else { gpui::WindowBackgroundAppearance::Opaque }
    }

    fn render_title_bar(&self, maximized: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let mac = self.platform == Platform::Mac;
        let control = |id: &'static str, icon: IconName, area: WindowControlArea, label: &'static str| {
            let hover = if area == WindowControlArea::Close { colors.destructive } else { colors.accent };
            div()
                .id(id)
                .flex()
                .items_center()
                .justify_center()
                .w(px(36.))
                .h_full()
                .window_control_area(area)
                // The bar moves the window on a press and a drag, and on Windows it answers the
                // hit test as the title bar; without this the window takes the press and Close
                // never fires.
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .hover(move |style| style.bg(hover))
                .anchored_tooltip({ let text: gpui::SharedString = (label).into(); move || ui::Tooltip::new(text.clone()) })
                .child(Icon::new(icon).size(IconSize::Small).color(colors.subtle_foreground))
                .on_click(move |_, window, cx| match area {
                    WindowControlArea::Min => window.minimize_window(),
                    WindowControlArea::Max => window.zoom_window(),
                    WindowControlArea::Close => window.dispatch_action(Box::new(CloseWindow), cx),
                    WindowControlArea::Drag => {}
                })
        };
        let overlay = self.content.overlays_title_bar();
        let title = (!self.content.on_window_plane() && !overlay).then(|| SharedString::from(self.content.title()));
        let icon = self.content.icon();
        // A pull request, issue or run shows its author and live state beside the title, once
        // loaded (`resource.badge`, `PullRequestStatusBadge`).
        let chrome = matches!(self.content, DetachedContent::Resource { .. }).then(|| github_panel::resource_chrome(&self.view, cx)).flatten();
        div()
            .id("detached-title-bar")
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .h(px(32.))
            .w_full()
            .when(overlay, |this| this.absolute().top_0().left_0().right_0().h(px(40.)))
            .window_control_area(WindowControlArea::Drag)
            .on_mouse_down(MouseButton::Left, cx.listener(|this, _, _, _| this.should_move_window = true))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _, _, _| this.should_move_window = false))
            .on_mouse_move(cx.listener(|this, _: &MouseMoveEvent, window, _| {
                if this.should_move_window {
                    this.should_move_window = false;
                    window.start_window_move();
                }
            }))
            .on_click(|event, window, _| {
                if event.click_count() == 2 && cfg!(target_os = "macos") {
                    window.titlebar_double_click();
                }
            })
            .children(title.map(|title| {
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .px(px(84.))
                    .gap(px(6.))
                    .children(icon.map(|icon| Icon::new(icon).size(IconSize::Small).color(colors.muted_foreground)))
                    .child(
                        div()
                            .truncate()
                            .text_size(typography::text_sm())
                            .font_weight(typography::MEDIUM)
                            .text_color(colors.muted_foreground)
                            .child(title),
                    )
                    .when_some(chrome, |this, chrome| {
                        this.when_some(chrome.login, |this, login| {
                            // Fall back to the author's GitHub picture when the chrome has none.
                            this.child(ui::Avatar::new(&login).size(px(16.)).image(chrome.avatar_url.or_else(|| Some(ui::avatar::github_avatar_url(&login)))))
                        })
                            .child(div().flex_none().child(ui::Badge::new(chrome.state).label_color(chrome.color)))
                    })
            }))
            .when(!mac && self.platform != Platform::Web, |this| {
                this.child(
                    div()
                        .absolute()
                        .top_0()
                        .bottom_0()
                        .right_0()
                        .flex()
                        .child(control("detached-minimize", IconName::Minus, WindowControlArea::Min, "Minimize"))
                        .child(if maximized {
                            control("detached-maximize", IconName::ArrowsIn, WindowControlArea::Max, "Restore")
                        } else {
                            control("detached-maximize", IconName::ArrowsOut, WindowControlArea::Max, "Maximize")
                        })
                        .child(control("detached-close", IconName::X, WindowControlArea::Close, "Close")),
                )
            })
    }
}

impl Focusable for DetachedWindow {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for DetachedWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.centre_traffic_lights(window);
        let colors = cx.theme().colors.clone();
        let plane = self.content.on_window_plane();
        let overlay = self.content.overlays_title_bar();
        let body = div().flex().flex_col().flex_1().min_h_0().min_w_0().overflow_hidden();
        let body = if plane {
            body.px(metrics::workbench_gap()).pb(metrics::workbench_gap()).child(ui::island(cx).flex_1().child(self.view.clone()))
        } else {
            body.child(self.view.clone())
        };
        div()
            .id("detached-window")
            .key_context(keymap::when::DETACHED_CONTEXT)
            .track_focus(&self.root_focus)
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(if plane { colors.window } else { colors.background })
            .font_family(typography::ui(cx).family)
            .text_size(typography::ui(cx).base())
            .text_color(colors.foreground)
            .on_action(|_: &CloseWindow, window, _| window.remove_window())
            // The macOS menu bar answers Cmd-W before the window does, and File > Close Tab is
            // what it runs. A window with one view has no tabs, so closing the tab closes it.
            .on_action(|_: &CloseTab, window, _| window.remove_window())
            .on_action(|_: &MinimizeWindow, window, _| window.minimize_window())
            .on_action(|_: &ZoomWindow, window, _| window.zoom_window())
            .on_action(|_: &ToggleFullscreen, window, _| window.toggle_fullscreen())
            .on_action(|_: &Quit, _, cx| quit_through_workbench(cx))
            // Zoom In, Zoom Out and Reset Zoom act on the view this window shows.
            .on_action(cx.listener(|this, _: &editor::ZoomIn, window, cx| this.zoom_view(Some(true), window, cx)))
            .on_action(cx.listener(|this, _: &editor::ZoomOut, window, cx| this.zoom_view(Some(false), window, cx)))
            .on_action(cx.listener(|this, _: &editor::ResetZoom, window, cx| this.zoom_view(None, window, cx)))
            .map(|this| {
                workbench_commands(cx).into_iter().fold(this, |this, action| {
                    this.on_boxed_action(&*action, |action, _, cx| run_in_workbench(action, cx))
                })
            })
            .relative()
            .when(!overlay, |this| this.child(self.render_title_bar(window.is_maximized(), cx)))
            .child(body)
            // Over the view, so the view runs under it to the window's top.
            .when(overlay, |this| this.child(self.render_title_bar(window.is_maximized(), cx)))
            .children(crate::toast_stack(window, false, cx))
    }
}

/// Stands in for a session shown in its own window (`agent-window-placeholder.tsx`): the tab keeps
/// its place and says where the session went, with Show window (`focusAgentWindow`) and Bring
/// back here (`recallAgentWindow`).
pub(crate) struct DetachedSessionPlaceholder {
    id: workspace::SessionId,
    workbench: gpui::WeakEntity<crate::Workbench>,
    _window_closed: Subscription,
}

impl DetachedSessionPlaceholder {
    pub(crate) fn new(id: workspace::SessionId, workbench: gpui::WeakEntity<crate::Workbench>, cx: &mut Context<Self>) -> Self {
        // Closing the session's window brings it back: the workbench swaps this for its view.
        let closed = workbench.clone();
        let window_closed = cx.on_window_closed(move |cx, _| {
            closed.update(cx, |_, cx| cx.notify()).ok();
        });
        Self { id, workbench, _window_closed: window_closed }
    }
}

impl Render for DetachedSessionPlaceholder {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let title = self
            .workbench
            .upgrade()
            .and_then(|workbench| workbench.read(cx).state().session(&self.id).map(|session| session.title.clone()))
            .filter(|title| !title.is_empty())
            .unwrap_or_else(|| "This session".into());
        let (show, back) = (self.workbench.clone(), self.workbench.clone());
        let (show_id, back_id) = (self.id.clone(), self.id.clone());
        let actions = div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_center()
            .gap_2()
            .child(ui::Button::new("detached-session-show", "Show window").leading_icon(IconName::WindowExpand).on_click(move |_, _, cx| {
                show.update(cx, |workbench, cx| {
                    workbench.open_session_in_detached_window(&show_id, cx);
                })
                .ok();
            }))
            .child(
                ui::Button::new("detached-session-back", "Bring back here")
                    .leading_icon(IconName::ArrowCounterClockwise)
                    .variant(ui::ButtonVariant::Ghost)
                    .on_click(move |_, _, cx| {
                        recall_session(&back_id.0, cx);
                        back.update(cx, |_, cx| cx.notify()).ok();
                    }),
            );
        div().size_full().flex().items_center().justify_center().child(
            ui::EmptyState::new(format!("{title} is in its own window"))
                .icon(IconName::Sparkle)
                .message("It keeps running there. Bring it back to continue in this window.")
                .action(actions),
        )
    }
}

/// A resource the window cannot show.
struct NothingToShow;

impl Render for NothingToShow {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .child(ui::EmptyState::new("Nothing to show").message("This content cannot open in its own window."))
    }
}

/// Quitting from a detached window goes through a workbench window, so it can ask about unsaved
/// work first.
/// The workbench window a single-view window hands its app-level keys to: the one in front,
/// else any open one.
fn front_workbench(cx: &App) -> Option<gpui::AnyWindowHandle> {
    let front = crate::front_window(cx);
    let workbenches: Vec<_> = cx.windows().into_iter().filter(|handle| handle.downcast::<crate::Workbench>().is_some()).collect();
    workbenches.iter().find(|handle| Some(handle.window_id()) == front).or(workbenches.first()).copied()
}

/// Commands that belong to the workbench, not to the view in this window. A settings or
/// extensions window has no tabs, sidebar or project, so Cmd-P, Shift-Cmd-N and the rest would
/// answer nothing at all; they run in the workbench window instead, as the Mac expects a utility
/// window's menu keys to.
fn workbench_commands(cx: &App) -> Vec<Box<dyn gpui::Action>> {
    let registry = cx.try_global::<keymap::CommandRegistry>();
    let mut actions: Vec<Box<dyn gpui::Action>> = Vec::new();
    for binding in keymap::default_bindings().iter().filter(|binding| binding.when.is_none()) {
        let Some(action) = registry.and_then(|registry| registry.action(&binding.command)) else { continue };
        // The window answers these itself; handing them on as well would close it and then act
        // on the workbench too.
        if OWN_ACTIONS.contains(&action.name()) {
            continue;
        }
        if actions.iter().any(|other| other.name() == action.name()) {
            continue;
        }
        actions.push(action);
    }
    actions
}

/// What a single-view window does for itself, whatever the keymap calls the command.
const OWN_ACTIONS: &[&str] = &[
    "workbench::CloseWindow",
    "workbench::CloseTab",
    "workbench::MinimizeWindow",
    "workbench::ZoomWindow",
    "workbench::ToggleFullscreen",
    "workbench::Quit",
    // Zoom belongs to the view in this window, not to the workbench behind it.
    "editor::ZoomIn",
    "editor::ZoomOut",
    "editor::ResetZoom",
];

/// Sends `action` to the workbench window, which has the tabs, the sidebar and the project it
/// needs. Nothing happens when no workbench window is open.
fn run_in_workbench(action: &dyn gpui::Action, cx: &mut App) {
    let Some(handle) = front_workbench(cx) else { return };
    let action = action.boxed_clone();
    cx.defer(move |cx| {
        handle
            .update(cx, |_, window, cx| {
                window.activate_window();
                window.dispatch_action(action, cx)
            })
            .ok();
    });
}

fn quit_through_workbench(cx: &mut App) {
    let front = crate::front_window(cx);
    let workbenches: Vec<_> = cx.windows().into_iter().filter(|handle| handle.downcast::<crate::Workbench>().is_some()).collect();
    let target = workbenches.iter().find(|handle| Some(handle.window_id()) == front).or(workbenches.first()).copied();
    match target {
        Some(handle) => {
            cx.defer(move |cx| {
                handle.update(cx, |_, window, cx| window.dispatch_action(Box::new(Quit), cx)).ok();
            });
        }
        None => cx.quit(),
    }
}

impl crate::Workbench {
    /// The folder a new terminal window starts in: the project in front.
    fn detached_terminal_cwd(&self) -> Option<PathBuf> {
        self.state.active_project().map(|project| PathBuf::from(&project.path))
    }

    pub(crate) fn new_terminal_window(&mut self, _: &NewTerminalWindow, _: &mut Window, cx: &mut Context<Self>) {
        open_detached(DetachedContent::Terminal { cwd: self.detached_terminal_cwd() }, cx);
    }

    pub(crate) fn new_settings_window(&mut self, _: &NewSettingsWindow, _: &mut Window, cx: &mut Context<Self>) {
        open_detached(DetachedContent::Settings, cx);
    }

    pub(crate) fn new_extensions_window(&mut self, _: &NewExtensionsWindow, _: &mut Window, cx: &mut Context<Self>) {
        open_detached(DetachedContent::Extensions, cx);
    }

    /// Opens a GitHub page in a window of its own (`openGitHubContentInNewWindow`).
    pub(crate) fn open_resource_in_detached_window(&mut self, kind: &str, id: &str, title: &str, cx: &mut Context<Self>) {
        let Some(root) = self.state.active_project().map(|project| PathBuf::from(&project.path)) else { return };
        open_detached(DetachedContent::Resource { kind: kind.into(), id: id.into(), title: title.into(), root }, cx);
    }

    /// What a session's window needs to show it.
    pub fn detached_session(&self, id: &workspace::SessionId) -> Option<DetachedSession> {
        let session = self.state.session(id)?;
        let project = session.project.as_ref().and_then(|project| self.state.project(project));
        let cwd = project.map(|project| PathBuf::from(&project.path)).or_else(|| session.workspace_path.as_ref().map(PathBuf::from));
        let folders = project
            .filter(|project| !project.is_remote())
            .map(|project| project.folders.iter().map(PathBuf::from).collect())
            .unwrap_or_default();
        Some(DetachedSession { id: id.0.clone(), title: session.title.clone(), agent: session.agent.clone(), cwd, folders })
    }

    /// Takes a session out into a window of its own (`openAgentInNewWindow`): its draft goes
    /// along, and this window lets go of it until the window closes or it is opened here again.
    pub(crate) fn open_session_in_detached_window(&mut self, id: &workspace::SessionId, cx: &mut Context<Self>) -> bool {
        if session_is_detached(&id.0, cx) {
            let content = match self.detached_session(id) {
                Some(session) => DetachedContent::Session(session),
                None => return false,
            };
            return open_detached(content, cx);
        }
        if cx.try_global::<DetachedOpener>().is_none() {
            return false;
        }
        let Some(session) = self.detached_session(id) else { return false };
        let key = crate::centre_views::tab_key(&workspace::TabItem::Session { id: id.clone() });
        if let Some(view) = self.centre_views.get(&key).and_then(|view| view.session.clone()) {
            if let Some(blocker) = view.read(cx).transfer_blocker() {
                notifications::info(cx, blocker);
                return true;
            }
            view.update(cx, |view, cx| view.hand_off_draft(cx));
        }
        self.update_state(cx, |state| state.leave_session(id));
        let opened = open_detached(DetachedContent::Session(session), cx);
        if opened {
            // The window runs the session now; this one shows a stand-in until it comes back.
            self.centre_views.remove(&key);
        }
        opened
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_follow_the_original() {
        assert_eq!(DetachedContent::Terminal { cwd: None }.window_title(), "Terminal - Athas");
        assert_eq!(DetachedContent::Settings.window_title(), "Settings - Athas");
        assert_eq!(DetachedContent::Extensions.window_title(), "Integrations - Athas");
        let session = DetachedSession { id: "s1".into(), title: String::new(), agent: "claude-code".into(), cwd: None, folders: Vec::new() };
        assert_eq!(DetachedContent::Session(session.clone()).window_title(), "Agents - Athas");
        assert_eq!(DetachedContent::Session(session.clone()).title(), "New session");
        assert!(DetachedContent::Session(session.clone()).on_window_plane());
        assert!(!DetachedContent::Settings.on_window_plane());
        assert_eq!(DetachedContent::Session(session).key().as_deref(), Some("session:s1"));
        assert_eq!(DetachedContent::Terminal { cwd: None }.key(), None);
        let pr = DetachedContent::Resource { kind: "github-pr".into(), id: "41".into(), title: String::new(), root: "/repo".into() };
        assert_eq!(pr.window_title(), "Pull request #41 — Athas");
        assert_eq!(pr.title(), "Pull request #41");
        assert_eq!(pr.key().as_deref(), Some("github-pr:/repo:41"));
        assert!(!pr.on_window_plane());
    }
}
