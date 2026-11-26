//! More than one workbench window (`create-app-window.ts`, `window-open-request.ts`), and the
//! native tabs macOS groups them in. Workbench windows share a tabbing identifier, so AppKit groups
//! them, switches them with its shortcuts and menu items and takes them into full screen together;
//! GPUI hides AppKit's own tab bar, and the title row draws the group's tabs instead
//! (`window-tabs-bar.tsx`, `use-window-tabs.ts`).

use std::{collections::HashMap, path::PathBuf, rc::Rc};

use ui::scale::px;
use gpui::{
    AnyWindowHandle, App, Context, Global, MouseButton, SharedString, SystemWindowTabController, Window, WindowId,
    actions, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, IconName, Plane, Tab, metrics};
use workspace::{SessionId, TabItem, WorkspaceState, project_name};

use crate::{CloseWindow, Platform, Workbench};

actions!(
    workbench,
    [
        NewWindow,
        /// Opens a workbench window as a tab of this one (macOS).
        NewWindowTab,
        ShowNextWindowTab,
        ShowPreviousWindowTab,
        MoveTabToNewWindow,
        MergeAllWindows,
        ShowAllWindowTabs,
    ]
);

/// Groups workbench windows into one set of native tabs; detached windows would leave it unset.
pub const TABBING_IDENTIFIER: &str = "dev.athas.workspace";

/// The window tab strip's height: the title strip's, with the tabs centred in it. The window
/// buttons are centred on that same height (`metrics::workbench_traffic_lights`), so a tab and
/// the buttons beside it share a centre line at every zoom.
pub fn window_tabs_height() -> gpui::Pixels { metrics::pane_header() }

pub type WindowSetup = Box<dyn FnOnce(&mut Workbench, &mut Window, &mut Context<Workbench>)>;

/// A workbench window to open: what it starts with, and what to do in it once it is open.
pub struct NewWindowRequest {
    pub state: WorkspaceState,
    /// Join the window in front as a native tab (macOS); elsewhere it is a window of its own.
    pub as_tab: bool,
    pub setup: Option<WindowSetup>,
}

/// Opens workbench windows; the desktop app installs it, since it owns where windows sit and
/// which of them come back after a restart.
#[derive(Clone)]
pub struct WindowOpener(Rc<dyn Fn(NewWindowRequest, &mut App)>);

impl Global for WindowOpener {}

pub fn set_window_opener(cx: &mut App, opener: impl Fn(NewWindowRequest, &mut App) + 'static) {
    cx.set_global(WindowOpener(Rc::new(opener)));
}

pub fn open_window(request: NewWindowRequest, cx: &mut App) {
    match cx.try_global::<WindowOpener>().cloned() {
        Some(opener) => (opener.0)(request, cx),
        None => {
            notifications::info(cx, "New windows need the desktop app");
        }
    }
}

/// What a window shows, so the tabs of the other windows in its group can name it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WindowLabel {
    pub title: String,
    pub project_path: Option<String>,
    pub custom_icon: Option<String>,
}

impl WindowLabel {
    pub fn of(state: &WorkspaceState) -> Self {
        match state.active_project() {
            Some(project) => Self {
                title: project.name.clone(),
                project_path: Some(project.path.clone()),
                custom_icon: project.custom_icon.clone(),
            },
            None => Self { title: "Athas".into(), project_path: None, custom_icon: None },
        }
    }
}

#[derive(Default)]
struct WindowLabels(HashMap<WindowId, WindowLabel>);

/// The workbench window used last, which takes what other views, the `athas` command and links
/// ask to open.
#[derive(Default)]
struct FrontWindow(Option<WindowId>);

impl Global for FrontWindow {}

pub fn front_window(cx: &App) -> Option<WindowId> {
    cx.try_global::<FrontWindow>().and_then(|front| front.0)
}

pub(crate) fn set_front_window(window: WindowId, cx: &mut App) {
    cx.default_global::<FrontWindow>().0 = Some(window);
}

/// The window, workbench or detached, last brought to the front: the one that shows toasts.
#[derive(Default)]
struct ToastWindow(Option<WindowId>);

impl Global for ToastWindow {}

pub(crate) fn set_toast_window(window: WindowId, cx: &mut App) {
    cx.default_global::<ToastWindow>().0 = Some(window);
}

/// Whether `window` draws the toasts: it was in front last, or, while that window is gone,
/// any workbench window does.
pub(crate) fn shows_toasts(window: WindowId, workbench: bool, cx: &App) -> bool {
    match cx.try_global::<ToastWindow>().and_then(|toasts| toasts.0) {
        Some(front) if cx.windows().iter().any(|open| open.window_id() == front) => front == window,
        _ => workbench,
    }
}

impl Global for WindowLabels {}

/// One tab of the window's group, as the title row draws it.
#[derive(Clone, Debug, PartialEq)]
pub struct WindowTab {
    pub window: WindowId,
    pub title: String,
    pub project_path: Option<String>,
    pub custom_icon: Option<String>,
    pub active: bool,
}

/// The tabs of a group in tab order, named after each window's project: the window showing them
/// is the one in front, since a group shows one window at a time.
pub fn window_tabs(group: &[(WindowId, SharedString)], labels: &HashMap<WindowId, WindowLabel>, current: WindowId) -> Vec<WindowTab> {
    group
        .iter()
        .map(|(window, native_title)| {
            let label = labels.get(window);
            let project_path = label.and_then(|label| label.project_path.clone());
            let title = match (&project_path, label) {
                (Some(path), _) => project_name(path),
                (None, Some(label)) if !label.title.is_empty() => label.title.clone(),
                _ if !native_title.is_empty() => native_title.to_string(),
                _ => "Athas".to_string(),
            };
            WindowTab {
                window: *window,
                title,
                project_path,
                custom_icon: label.and_then(|label| label.custom_icon.clone()),
                active: *window == current,
            }
        })
        .collect()
}

/// A lone window has nothing to switch to, so the strip appears from the second tab on, as in
/// Safari, and only while AppKit would show its tab bar.
pub fn strip_shown(platform: Platform, tab_bar_visible: bool, tabs: usize) -> bool {
    platform == Platform::Mac && tab_bar_visible && tabs > 1
}

fn find_window(id: WindowId, cx: &App) -> Option<AnyWindowHandle> {
    cx.windows().into_iter().find(|handle| handle.window_id() == id)
}

fn select_tab(id: WindowId, cx: &mut App) {
    if let Some(handle) = find_window(id, cx) {
        handle.update(cx, |_, window, _| window.activate_window()).ok();
    }
}

/// Closing goes through the tab's own workbench, so it can ask about unsaved work first.
fn close_tab(id: WindowId, cx: &mut App) {
    if let Some(handle) = find_window(id, cx) {
        handle.update(cx, |_, window, cx| window.dispatch_action(Box::new(CloseWindow), cx)).ok();
    }
}

fn move_tab_to_new_window(id: WindowId, cx: &mut App) {
    SystemWindowTabController::move_tab_to_new_window(cx, id);
    if let Some(handle) = find_window(id, cx) {
        handle.update(cx, |_, window, _| window.move_tab_to_new_window()).ok();
    }
}

impl Workbench {
    /// What a new window starts with: no projects or sessions, the folders opened before.
    pub(crate) fn new_window_state(&self) -> WorkspaceState {
        let mut state = WorkspaceState::default();
        state.recent_projects = self.state.recent_projects.clone();
        state
    }

    pub(crate) fn open_new_window(&self, as_tab: bool, setup: Option<WindowSetup>, cx: &mut App) {
        open_window(NewWindowRequest { state: self.new_window_state(), as_tab, setup }, cx);
    }

    /// Opens a folder in a window of its own (`openFoldersInNewWindow`, Open in New Window).
    pub fn open_folder_in_new_window(&self, path: PathBuf, cx: &mut App) {
        self.open_new_window(false, Some(Box::new(move |workbench, _, cx| workbench.open_project_path(path, cx))), cx);
    }

    /// With Open Folders in New Window on and a project already open here, a folder picked in
    /// the dialog or the recents opens in a new window (`handleOpenFolder`, `openRecentFolder`).
    pub(crate) fn opens_folders_elsewhere(&self, cx: &App) -> bool {
        self.platform != Platform::Web && settings::get(cx).open_folders_in_new_window && !self.state.projects.is_empty()
    }

    /// Moves a session to a window of its own: the new window opens it with its project, and
    /// this window goes back to the project.
    pub(crate) fn move_session_to_new_window(&mut self, id: &SessionId, cx: &mut Context<Self>) {
        if self.open_session_in_detached_window(id, cx) {
            return;
        }
        let Some(session) = self.state.session(id).cloned() else { return };
        let key = crate::centre_views::tab_key(&workspace::TabItem::Session { id: id.clone() });
        if let Some(view) = self.centre_views.get(&key).and_then(|view| view.session.clone()) {
            if let Some(blocker) = view.read(cx).transfer_blocker() {
                notifications::info(cx, blocker);
                return;
            }
            view.update(cx, |view, cx| view.hand_off_draft(cx));
        }
        let project = session.project.as_ref().and_then(|project| self.state.project(project)).cloned();
        let mut state = self.new_window_state();
        if let Some(project) = &project {
            let id = state.open_project(&project.path);
            state.set_project_icon(&id, project.custom_icon.clone());
        }
        state.insert_session(session);
        state.open_session(id);
        self.update_state(cx, |state| state.leave_session(id));
        open_window(NewWindowRequest { state, as_tab: false, setup: None }, cx);
    }

    /// Previews draw a made-up group of window tabs.
    pub fn set_window_tabs_preview(&mut self, tabs: Vec<WindowTab>) {
        self.window_tabs_preview = Some(tabs);
    }

    /// Names this window and its tab after the project in front, for the other windows' tabs.
    pub(crate) fn sync_window_label(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let label = WindowLabel::of(&self.state);
        if self.window_label.as_ref() == Some(&label) {
            return;
        }
        window.set_window_title(&label.title);
        let id = window.window_handle().window_id();
        SystemWindowTabController::update_tab_title(cx, id, label.title.clone().into());
        cx.default_global::<WindowLabels>().0.insert(id, label.clone());
        let others_draw_it = self.window_label.is_some();
        self.window_label = Some(label);
        if others_draw_it {
            cx.defer(|cx| cx.refresh_windows());
        }
    }

    /// Marks the window edited while a tab has unsaved changes and names the file in front as its
    /// document (`setWindowDocumentState`).
    pub(crate) fn sync_document_state(&mut self, window: &mut Window) {
        let path = self
            .state
            .focused_tabs()
            .and_then(|set| set.tabs.get(set.active?))
            .and_then(|tab| match tab {
                TabItem::File { path } => Some(PathBuf::from(path)),
                _ => None,
            });
        let state = (!self.dirty_tabs.is_empty(), path);
        if self.document_state.as_ref() == Some(&state) {
            return;
        }
        window.set_window_edited(state.0);
        window.set_document_path(state.1.as_deref().filter(|path| path.is_absolute() && path.exists()));
        self.document_state = Some(state);
    }

    /// The tabs of this window's group, or none while the strip does not show.
    pub(crate) fn window_tabs(&self, window: &Window, cx: &App) -> Vec<WindowTab> {
        if let Some(preview) = &self.window_tabs_preview {
            return preview.clone();
        }
        let id = window.window_handle().window_id();
        let controller = cx.global::<SystemWindowTabController>();
        let Some(group) = controller.tabs(id) else { return Vec::new() };
        let visible = controller.is_visible() || window.tab_bar_visible();
        if !strip_shown(self.platform, visible, group.len()) {
            return Vec::new();
        }
        let group: Vec<(WindowId, SharedString)> = group.iter().map(|tab| (tab.id, tab.title.clone())).collect();
        let labels = cx.try_global::<WindowLabels>().map(|labels| labels.0.clone()).unwrap_or_default();
        window_tabs(&group, &labels, id)
    }

    pub(crate) fn forget_window_label(window: WindowId, cx: &mut App) {
        cx.default_global::<WindowLabels>().0.remove(&window);
        let front = cx.default_global::<FrontWindow>();
        if front.0 == Some(window) {
            front.0 = None;
        }
    }

    /// The group's tabs across the window's top row, beside the traffic lights, with a new tab
    /// at the end; the workbench starts below it.
    pub(crate) fn render_window_tabs(&self, tabs: Vec<WindowTab>, window: &Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let only_tab = tabs.len() == 1;
        let inset = if window.is_fullscreen() { metrics::workbench_gap() + metrics::chrome_padding_inline() } else { metrics::traffic_lights_inset() };
        let muted = cx.theme().colors.subtle_foreground;
        let keep_press = || div().on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation());
        let items: Vec<gpui::AnyElement> = tabs
            .into_iter()
            .map(|tab| {
                let id = tab.window;
                let icon = tab.project_path.as_deref().map(|path| {
                    crate::project_icon::project_glyph(Some(path), tab.custom_icon.as_deref(), ui::IconSize::XSmall.pixels(), muted)
                });
                let weak = cx.weak_entity();
                let tab_element = Tab::new(gpui::ElementId::Name(format!("window-tab-{}", id.as_u64()).into()), tab.title.clone())
                    .stretch()
                    .active(tab.active)
                    .show_close(false)
                    .when_some(icon, |tab, icon| tab.leading(icon))
                    .on_click(move |_, _, cx| {
                        if !tab.active {
                            select_tab(id, cx);
                        }
                    })
                    .on_close(move |_, _, cx| close_tab(id, cx))
                    .on_middle_click(move |_, _, cx| close_tab(id, cx))
                    .on_secondary_mouse_down(move |event, window, cx| {
                        let position = event.position;
                        weak.update(cx, |this, cx| {
                            let entries = vec![
                                ui::MenuItem::new("Move Tab to New Window")
                                    .disabled(only_tab)
                                    .on_select(move |_, cx| move_tab_to_new_window(id, cx))
                                    .into(),
                                ui::MenuEntry::Separator,
                                ui::MenuItem::new("Close Tab").on_select(move |_, cx| close_tab(id, cx)).into(),
                            ];
                            this.show_menu("window-tab", entries, position, gpui::Anchor::TopLeft, window, cx);
                        })
                        .ok();
                    });
                // The row moves the window on a press and a drag; a tab keeps its own press so a
                // slight move between down and up does not swallow the click. The wrapper takes
                // the stretched tab's place in the strip.
                keep_press().flex_1().min_w_0().child(tab_element).into_any_element()
            })
            .collect();
        let row = div()
            .id("window-tabs")
            .flex()
            .flex_none()
            .items_center()
            .gap(metrics::chrome_gap())
            .h(window_tabs_height())
            .pl(inset)
            .pr(metrics::workbench_gap())
            .w_full()
            .child(
                div()
                    .id("window-tab-strip")
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap(px(2.))
                    .overflow_x_scroll()
                    .children(items),
            )
            .child(keep_press().child(
                Button::icon("window-new-tab", IconName::Plus)
                    .size(ButtonSize::Small)
                    .plane(Plane::Page)
                    .tooltip("New Tab")
                    .on_click(|_, window, cx| window.dispatch_action(Box::new(NewWindowTab), cx)),
            ))
            .on_mouse_down(MouseButton::Middle, |_, _, cx| cx.stop_propagation());
        self.drag_region(row, cx).into_any_element()
    }

    pub(crate) fn window_tab_actions(&self, element: gpui::Stateful<gpui::Div>, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        element
            .on_action(cx.listener(|this, _: &NewWindow, _, cx| this.open_new_window(false, None, cx)))
            .on_action(cx.listener(|this, _: &NewWindowTab, _, cx| this.open_new_window(true, None, cx)))
            .on_action(|_: &ShowNextWindowTab, window, cx| {
                SystemWindowTabController::select_next_tab(cx, window.window_handle().window_id())
            })
            .on_action(|_: &ShowPreviousWindowTab, window, cx| {
                SystemWindowTabController::select_previous_tab(cx, window.window_handle().window_id())
            })
            .on_action(|_: &MoveTabToNewWindow, window, cx| {
                let id = window.window_handle().window_id();
                if cx.global::<SystemWindowTabController>().tabs(id).is_some_and(|tabs| tabs.len() > 1) {
                    SystemWindowTabController::move_tab_to_new_window(cx, id);
                    window.move_tab_to_new_window();
                }
            })
            .on_action(|_: &MergeAllWindows, window, cx| {
                SystemWindowTabController::merge_all_windows(cx, window.window_handle().window_id());
                window.merge_all_windows();
            })
            .on_action(|_: &ShowAllWindowTabs, window, _| window.toggle_window_tab_overview())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn label(path: Option<&str>) -> WindowLabel {
        WindowLabel {
            title: path.map_or("Athas".into(), project_name),
            project_path: path.map(str::to_string),
            custom_icon: None,
        }
    }

    #[test]
    fn tabs_follow_the_group_order_and_name_each_project() {
        let (a, b, c) = (WindowId::from(1), WindowId::from(2), WindowId::from(3));
        let group = vec![(b, SharedString::from("athas")), (a, "Athas".into()), (c, "".into())];
        let labels = HashMap::from([(a, label(None)), (b, label(Some("/code/athas")))]);
        let tabs = window_tabs(&group, &labels, a);
        let titles: Vec<&str> = tabs.iter().map(|tab| tab.title.as_str()).collect();
        assert_eq!(titles, ["athas", "Athas", "Athas"]);
        assert_eq!(tabs.iter().map(|tab| tab.active).collect::<Vec<_>>(), [false, true, false]);
        assert_eq!(tabs[0].project_path.as_deref(), Some("/code/athas"));
    }

    #[test]
    fn the_strip_shows_from_the_second_tab_on_macos() {
        assert!(!strip_shown(Platform::Mac, true, 1));
        assert!(strip_shown(Platform::Mac, true, 2));
        assert!(!strip_shown(Platform::Mac, false, 3));
        assert!(!strip_shown(Platform::Linux, true, 3));
    }

    #[test]
    fn a_window_names_itself_after_its_project() {
        let mut state = WorkspaceState::default();
        assert_eq!(WindowLabel::of(&state).title, "Athas");
        state.open_project("/code/www");
        let label = WindowLabel::of(&state);
        assert_eq!(label.title, "www");
        assert_eq!(label.project_path.as_deref(), Some("/code/www"));
    }
}
