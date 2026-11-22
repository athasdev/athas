//! Every workbench window: which ones were open when Athas quit, so they all come back, and where
//! each sat. Each window keeps its own projects, sessions and tabs (`workspace-tabs.store.ts` keys
//! them by window label); a window closed for good forgets its state, as the old app dropped the
//! storage of windows that were gone. The last window to close is kept, since closing it quits.

use std::{path::PathBuf, rc::Rc, time::Duration};

use gpui::{
    App, AppContext, Bounds, Task, TitlebarOptions, WindowBounds, WindowHandle, WindowId, WindowOptions, point, px,
    size,
};
use serde::{Deserialize, Serialize};
use workbench::{NewWindowRequest, Workbench};
use workspace::{FileStore, MAIN_WINDOW, StateStore};

use crate::{PlatformState, window_state};

const FILE_NAME: &str = "windows.json";
const SAVE_DELAY: Duration = Duration::from_millis(500);
/// The size of a new window, centred on the display (`create_app_window`).
const NEW_WINDOW_SIZE: (f32, f32) = (1200., 800.);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WindowEntry {
    pub id: String,
    #[serde(default)]
    pub bounds: Option<window_state::WindowState>,
}

impl WindowEntry {
    fn new(id: impl Into<String>) -> Self {
        Self { id: id.into(), bounds: None }
    }
}

/// The workbench windows, in the order they opened.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WindowSet {
    pub windows: Vec<WindowEntry>,
    #[serde(default)]
    next: u32,
}

impl WindowSet {
    /// The windows to open at launch: those open at quit, or the first window.
    pub fn to_restore(&self) -> Vec<WindowEntry> {
        if self.windows.is_empty() { vec![WindowEntry::new(MAIN_WINDOW)] } else { self.windows.clone() }
    }

    /// Names a new window and adds it.
    pub fn allocate(&mut self) -> String {
        let id = loop {
            self.next += 1;
            let id = format!("window-{}", self.next);
            if !self.contains(&id) && id != MAIN_WINDOW {
                break id;
            }
        };
        self.windows.push(WindowEntry::new(id.clone()));
        id
    }

    pub fn contains(&self, id: &str) -> bool {
        self.windows.iter().any(|entry| entry.id == id)
    }

    pub fn ensure(&mut self, id: &str) {
        if !self.contains(id) {
            self.windows.push(WindowEntry::new(id));
        }
    }

    /// Forgets a window closed for good; the last one stays, since closing it quits Athas and it
    /// should open again. Returns whether it was forgotten.
    pub fn close(&mut self, id: &str) -> bool {
        if self.windows.len() <= 1 {
            return false;
        }
        let before = self.windows.len();
        self.windows.retain(|entry| entry.id != id);
        self.windows.len() != before
    }

    pub fn set_bounds(&mut self, id: &str, bounds: window_state::WindowState) {
        if let Some(entry) = self.windows.iter_mut().find(|entry| entry.id == id) {
            entry.bounds = Some(bounds);
        }
    }
}

pub fn path() -> Option<PathBuf> {
    cli::data_dir().map(|dir| dir.join(FILE_NAME))
}

pub fn load(path: &std::path::Path) -> WindowSet {
    std::fs::read_to_string(path).ok().and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default()
}

pub fn save(path: &std::path::Path, set: &WindowSet) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(set).map_err(std::io::Error::other)?)
}

/// A workbench window that is open, and the name its state is kept under.
#[derive(Clone)]
pub(crate) struct OpenWindow {
    pub handle: WindowHandle<Workbench>,
    pub id: String,
}

fn options(bounds: WindowBounds, display: Option<gpui::DisplayId>) -> WindowOptions {
    WindowOptions {
        window_bounds: Some(bounds),
        display_id: display,
        titlebar: Some(TitlebarOptions {
            title: Some("Athas".into()),
            appears_transparent: true,
            // Centred on the title strip's row (`PANE_HEADER`, 40): a 14px button centres at 20.
            traffic_light_position: Some(point(px(16.), px(13.))),
        }),
        // The workbench moves the window itself (`drag_region`); without this AppKit drags the
        // window from anywhere in the top ~28px, so dragging a tab there moved the window.
        app_owns_titlebar_drag: true,
        window_min_size: Some(size(px(480.), px(360.))),
        app_id: Some(paths::BUNDLE_ID.into()),
        tabbing_identifier: Some(workbench::TABBING_IDENTIFIER.into()),
        ..Default::default()
    }
}

fn share_closed_project_tabs(workbench: &mut Workbench) {
    if let Some(file) = FileStore::closed_project_tabs_location() {
        workbench.share_closed_project_tabs(file);
    }
}

fn store(id: &str) -> Option<Rc<FileStore>> {
    FileStore::window_location(id).map(Rc::new)
}

/// Opens the windows open at the last quit; false when none could open.
pub(crate) fn restore_all(cx: &mut App) -> bool {
    let entries = cx.global::<PlatformState>().set.to_restore();
    let legacy = window_state::path().and_then(|path| window_state::load(&path));
    for (index, entry) in entries.into_iter().enumerate() {
        let saved = entry.bounds.clone().or_else(|| if index == 0 { legacy.clone() } else { None });
        let restored = window_state::restore_saved(saved.as_ref(), size(px(1280.), px(820.)), cx);
        let id = entry.id.clone();
        let store = store(&id);
        let opened = open(id.clone(), restored.bounds, restored.display, cx, move |window, cx| {
            let store = store.map(|store| store as Rc<dyn StateStore>);
            cx.new(|cx| {
                let mut workbench = Workbench::new(store, window, cx);
                share_closed_project_tabs(&mut workbench);
                workbench
            })
        });
        if let Err(error) = opened {
            eprintln!("athas: could not open the window {id}: {error:#}");
        }
    }
    !cx.global::<PlatformState>().windows.is_empty()
}

/// Opens a new workbench window for the workbench's New Window, New Window Tab and Open in New
/// Window, and for requests from the `athas` command and links that ask for one.
pub(crate) fn open_new(request: NewWindowRequest, cx: &mut App) -> Option<WindowHandle<Workbench>> {
    let parent = crate::target_window(cx);
    let parent_fullscreen = parent
        .and_then(|parent| parent.update(cx, |_, window, _| window.is_fullscreen()).ok())
        .unwrap_or(false);
    let id = cx.global_mut::<PlatformState>().set.allocate();
    let bounds = WindowBounds::Windowed(Bounds::centered(None, size(px(NEW_WINDOW_SIZE.0), px(NEW_WINDOW_SIZE.1)), cx));
    let store = store(&id);
    if let Some(store) = &store {
        // A name used before may still have a file from a window that never closed cleanly.
        store.remove();
    }
    let NewWindowRequest { state, as_tab, setup } = request;
    let opened = open(id.clone(), bounds, None, cx, move |window, cx| {
        let store = store.map(|store| store as Rc<dyn StateStore>);
        cx.new(|cx| {
            let mut workbench = Workbench::with_state(state, store, window, cx);
            share_closed_project_tabs(&mut workbench);
            workbench.save();
            if let Some(setup) = setup {
                setup(&mut workbench, window, cx);
            }
            workbench
        })
    });
    let handle = match opened {
        Ok(handle) => handle,
        Err(error) => {
            eprintln!("athas: could not open a new window: {error:#}");
            let state = cx.global_mut::<PlatformState>();
            state.set.windows.retain(|entry| entry.id != id);
            schedule_save(cx);
            return None;
        }
    };
    if as_tab && let Some(parent) = parent {
        add_as_tab(parent, handle, cx);
    }
    // A new window follows a full-screen one into its own space instead of floating over it; a
    // tab joins its window's space on its own.
    handle
        .update(cx, |_, window, _| {
            if parent_fullscreen && !window.is_fullscreen() {
                window.toggle_fullscreen();
            }
        })
        .ok();
    Some(handle)
}

fn open(
    id: String,
    bounds: WindowBounds,
    display: Option<gpui::DisplayId>,
    cx: &mut App,
    build: impl FnOnce(&mut gpui::Window, &mut App) -> gpui::Entity<Workbench>,
) -> anyhow::Result<WindowHandle<Workbench>> {
    let handle = cx.open_window(options(bounds, display), build)?;
    let state = cx.global_mut::<PlatformState>();
    state.set.ensure(&id);
    state.windows.push(OpenWindow { handle, id: id.clone() });
    schedule_save(cx);
    crate::watch_window(handle, id, cx);
    Ok(handle)
}

/// Opens a single-view window (`create_app_window` with `content` or `detached`): AppKit's own
/// traffic lights over a 32px title bar, outside the workbench windows' tab group, and not
/// restored after a restart.
pub(crate) fn open_detached(content: workbench::DetachedContent, cx: &mut App) -> Option<gpui::AnyWindowHandle> {
    let bounds = WindowBounds::Windowed(Bounds::centered(None, size(px(NEW_WINDOW_SIZE.0), px(NEW_WINDOW_SIZE.1)), cx));
    let mut options = options(bounds, None);
    options.window_min_size = Some(size(px(400.), px(400.)));
    options.tabbing_identifier = None;
    if let Some(titlebar) = options.titlebar.as_mut() {
        titlebar.title = Some(content.window_title().into());
        // Settings draws no title bar of its own: the lights sit centred in the space its
        // sidebar leaves at the top.
        titlebar.traffic_light_position = content.overlays_title_bar().then(|| point(px(16.), px(20.)));
    }
    match cx.open_window(options, move |window, cx| cx.new(|cx| workbench::DetachedWindow::new(content, window, cx))) {
        Ok(handle) => Some(handle.into()),
        Err(error) => {
            notifications::error(cx, "Could not open a new window", Some(error.to_string().into()));
            None
        }
    }
}

/// Makes `tab` a tab of `parent`'s group, right after it (`add_window_tab`), unless macOS
/// already grouped it.
fn add_as_tab(parent: WindowHandle<Workbench>, tab: WindowHandle<Workbench>, cx: &mut App) {
    #[cfg(target_os = "macos")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let ns_view = |handle: WindowHandle<Workbench>, cx: &mut App| {
            handle
                .update(cx, |_, window, _| match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
                    Ok(RawWindowHandle::AppKit(appkit)) => Some(appkit.ns_view.as_ptr() as usize),
                    _ => None,
                })
                .ok()
                .flatten()
        };
        let (Some(parent_view), Some(tab_view)) = (ns_view(parent, cx), ns_view(tab, cx)) else { return };
        let grouped = tab
            .update(cx, |_, window, _| {
                window.tabbed_windows().is_some_and(|tabs| tabs.iter().any(|other| other.id == parent.window_id()))
            })
            .unwrap_or(false);
        if !grouped {
            native_tabs::add_tabbed_window(parent_view, tab_view);
        }
        tab.update(cx, |_, window, cx| {
            if let Some(tabs) = window.tabbed_windows() {
                gpui::SystemWindowTabController::remove_tab(cx, tab.window_id());
                gpui::SystemWindowTabController::add_tab(cx, tab.window_id(), tabs);
            }
            window.activate_window();
        })
        .ok();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (parent, tab, cx);
    }
}

#[cfg(target_os = "macos")]
mod native_tabs {
    use objc2::{msg_send, runtime::AnyObject};

    /// `[[parent_view window] addTabbedWindow:[[tab_view window]] ordered:NSWindowAbove]`.
    pub(super) fn add_tabbed_window(parent_view: usize, tab_view: usize) {
        unsafe {
            let parent_view = parent_view as *mut AnyObject;
            let tab_view = tab_view as *mut AnyObject;
            let parent: *mut AnyObject = msg_send![parent_view, window];
            let tab: *mut AnyObject = msg_send![tab_view, window];
            if parent.is_null() || tab.is_null() || parent == tab {
                return;
            }
            let _: () = msg_send![parent, addTabbedWindow: tab, ordered: 1isize];
        }
    }
}

/// Forgets a window the user closed: its entry and its saved state, unless it was the last.
pub(crate) fn closed(window: WindowId, cx: &mut App) {
    workbench::forget_window(window, cx);
    if !cx.has_global::<PlatformState>() {
        return;
    }
    let state = cx.global_mut::<PlatformState>();
    let Some(index) = state.windows.iter().position(|open| open.handle.window_id() == window) else { return };
    let open = state.windows.remove(index);
    if state.set.close(&open.id)
        && let Some(store) = FileStore::window_location(&open.id)
    {
        store.remove();
    }
    schedule_save(cx);
}

pub(crate) fn record_bounds(id: &str, window: &gpui::Window, cx: &mut App) {
    let display = window.display(cx).and_then(|display| display.uuid().ok()).map(|uuid| uuid.to_string());
    let bounds = window_state::WindowState::from_window(window.window_bounds(), display);
    if cx.has_global::<PlatformState>() {
        cx.global_mut::<PlatformState>().set.set_bounds(id, bounds);
    }
    schedule_save(cx);
}

fn schedule_save(cx: &mut App) {
    if cx.try_global::<PlatformState>().is_none_or(|state| state.save_task.is_some()) {
        return;
    }
    let task: Task<()> = cx.spawn(async move |cx| {
        cx.background_executor().timer(SAVE_DELAY).await;
        cx.update(flush);
    });
    cx.global_mut::<PlatformState>().save_task = Some(task);
}

/// Writes the window set now; called on quit.
pub(crate) fn flush(cx: &mut App) {
    if !cx.has_global::<PlatformState>() {
        return;
    }
    let state = cx.global_mut::<PlatformState>();
    state.save_task = None;
    if let Some(path) = path()
        && let Err(error) = save(&path, &state.set)
    {
        eprintln!("athas: could not save the open windows: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(x: f32) -> window_state::WindowState {
        window_state::WindowState { display: Some("main".into()), mode: window_state::WindowMode::Windowed, x, y: 0., width: 900., height: 700. }
    }

    #[test]
    fn launches_with_the_first_window_until_more_were_open() {
        let set = WindowSet::default();
        assert_eq!(set.to_restore(), vec![WindowEntry::new(MAIN_WINDOW)]);
    }

    #[test]
    fn new_windows_get_names_of_their_own() {
        let mut set = WindowSet::default();
        set.ensure(MAIN_WINDOW);
        let second = set.allocate();
        let third = set.allocate();
        assert_eq!((second.as_str(), third.as_str()), ("window-1", "window-2"));
        assert!(set.close(&second));
        assert_eq!(set.allocate(), "window-3", "a closed window's name is not reused while its file may linger");
        assert_eq!(set.windows.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), ["main", "window-2", "window-3"]);
    }

    #[test]
    fn the_last_window_is_kept_for_the_next_launch() {
        let mut set = WindowSet::default();
        set.ensure(MAIN_WINDOW);
        let second = set.allocate();
        assert!(set.close(MAIN_WINDOW));
        assert!(!set.close(&second));
        assert_eq!(set.to_restore().iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), [second.as_str()]);
    }

    #[test]
    fn windows_and_their_places_round_trip_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join(FILE_NAME);
        let mut set = WindowSet::default();
        set.ensure(MAIN_WINDOW);
        let second = set.allocate();
        set.set_bounds(&second, bounds(300.));
        save(&path, &set).unwrap();
        let loaded = load(&path);
        assert_eq!(loaded, set);
        assert_eq!(loaded.to_restore()[1].bounds, Some(bounds(300.)));
        assert_eq!(load(&dir.path().join("missing.json")), WindowSet::default());
    }
}
