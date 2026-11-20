//! The window's size, place, display and maximized/fullscreen state, saved to
//! `<data dir>/dev.athas.gpui/window-state.json` and restored on launch, as the Tauri app's
//! window-state plugin did. A display that is gone, or a place no display shows any more, falls
//! back to the saved size centred on the main display.

use std::{path::PathBuf, time::Duration};

use gpui::{App, Bounds, DisplayId, Global, Pixels, Task, Window, WindowBounds, point, px, size};
use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "window-state.json";
const SAVE_DELAY: Duration = Duration::from_millis(500);
/// Part of the window that must stay on a display for its saved place to be used.
const MIN_VISIBLE: f32 = 64.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowMode {
    #[default]
    Windowed,
    Maximized,
    Fullscreen,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    /// The display's UUID.
    pub display: Option<String>,
    pub mode: WindowMode,
    /// The windowed bounds, which maximized and fullscreen windows return to.
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl WindowState {
    pub fn from_window(bounds: WindowBounds, display: Option<String>) -> Self {
        let (mode, inner) = match bounds {
            WindowBounds::Windowed(bounds) => (WindowMode::Windowed, bounds),
            WindowBounds::Maximized(bounds) => (WindowMode::Maximized, bounds),
            WindowBounds::Fullscreen(bounds) => (WindowMode::Fullscreen, bounds),
        };
        Self {
            display,
            mode,
            x: inner.origin.x.as_f32(),
            y: inner.origin.y.as_f32(),
            width: inner.size.width.as_f32(),
            height: inner.size.height.as_f32(),
        }
    }

    fn bounds(&self) -> Bounds<Pixels> {
        Bounds::new(point(px(self.x), px(self.y)), size(px(self.width), px(self.height)))
    }
}

/// A connected display, as `restore` needs it.
pub struct DisplayInfo {
    pub id: DisplayId,
    pub uuid: Option<String>,
    pub bounds: Bounds<Pixels>,
}

/// Where the window opens.
#[derive(Debug, PartialEq)]
pub struct Restored {
    pub display: Option<DisplayId>,
    pub bounds: WindowBounds,
}

/// Whether enough of `window` lies on `display`. GPUI gives macOS window bounds relative to their
/// display and global ones elsewhere, so both readings are accepted.
fn visible_on(window: Bounds<Pixels>, display: Bounds<Pixels>) -> bool {
    let overlaps = |area: Bounds<Pixels>| {
        let visible = window.intersect(&area);
        visible.size.width.as_f32() >= MIN_VISIBLE && visible.size.height.as_f32() >= MIN_VISIBLE
    };
    overlaps(display) || overlaps(Bounds::new(point(px(0.), px(0.)), display.size))
}

/// Picks the display and bounds for a saved state; `None` when it cannot be used as saved.
pub fn restore(saved: Option<&WindowState>, displays: &[DisplayInfo]) -> Option<Restored> {
    let saved = saved.filter(|saved| saved.width >= 200. && saved.height >= 150.)?;
    let display = displays.iter().find(|display| display.uuid.is_some() && display.uuid == saved.display)?;
    let bounds = saved.bounds();
    if !visible_on(bounds, display.bounds) {
        return None;
    }
    let bounds = match saved.mode {
        WindowMode::Windowed => WindowBounds::Windowed(bounds),
        WindowMode::Maximized => WindowBounds::Maximized(bounds),
        WindowMode::Fullscreen => WindowBounds::Fullscreen(bounds),
    };
    Some(Restored { display: Some(display.id), bounds })
}

pub fn path() -> Option<PathBuf> {
    cli::data_dir().map(|dir| dir.join(FILE_NAME))
}

pub fn load(path: &std::path::Path) -> Option<WindowState> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

pub fn save(path: &std::path::Path, state: &WindowState) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(state).map_err(std::io::Error::other)?)
}

/// The bounds the first window opens with: the saved ones, or `default_size` centred.
pub fn initial_bounds(default_size: gpui::Size<Pixels>, cx: &App) -> Restored {
    let saved = path().and_then(|path| load(&path));
    restore_saved(saved.as_ref(), default_size, cx)
}

/// Where a window with `saved` bounds opens: there, or at their size (else `default_size`)
/// centred on the main display.
pub fn restore_saved(saved: Option<&WindowState>, default_size: gpui::Size<Pixels>, cx: &App) -> Restored {
    let displays: Vec<DisplayInfo> = cx
        .displays()
        .iter()
        .map(|display| DisplayInfo {
            id: display.id(),
            uuid: display.uuid().ok().map(|uuid| uuid.to_string()),
            bounds: display.bounds(),
        })
        .collect();
    restore(saved, &displays).unwrap_or_else(|| {
        let size = saved
            .map(|saved| size(px(saved.width.max(480.)), px(saved.height.max(360.))))
            .unwrap_or(default_size);
        Restored { display: None, bounds: WindowBounds::Windowed(Bounds::centered(None, size, cx)) }
    })
}

/// Saves the window's state a moment after it stops changing.
#[derive(Default)]
struct PendingSave {
    latest: Option<WindowState>,
    task: Option<Task<()>>,
}

impl Global for PendingSave {}

pub fn record(window: &Window, cx: &mut App) {
    let display = window.display(cx).and_then(|display| display.uuid().ok()).map(|uuid| uuid.to_string());
    let state = WindowState::from_window(window.window_bounds(), display);
    let pending = cx.default_global::<PendingSave>();
    pending.latest = Some(state);
    if pending.task.is_none() {
        let task = cx.spawn(async move |cx| {
            cx.background_executor().timer(SAVE_DELAY).await;
            cx.update(flush);
        });
        cx.default_global::<PendingSave>().task = Some(task);
    }
}

/// Writes the last recorded state now; called on quit.
pub fn flush(cx: &mut App) {
    let pending = cx.default_global::<PendingSave>();
    pending.task = None;
    let Some(state) = pending.latest.take() else { return };
    if let Some(path) = path()
        && let Err(error) = save(&path, &state)
    {
        eprintln!("athas: could not save the window state: {error}");
    }
}

/// Saves `window` whenever it moves, resizes or changes display.
pub fn observe<V: 'static>(window: &mut Window, cx: &mut gpui::Context<V>) {
    cx.observe_window_bounds(window, |_, window, cx| record(window, cx)).detach();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: u64, uuid: &str, x: f32) -> DisplayInfo {
        DisplayInfo {
            id: DisplayId::new(id),
            uuid: Some(uuid.into()),
            bounds: Bounds::new(point(px(x), px(0.)), size(px(1920.), px(1080.))),
        }
    }

    fn state(display: &str, mode: WindowMode, x: f32) -> WindowState {
        WindowState { display: Some(display.into()), mode, x, y: 40., width: 1280., height: 820. }
    }

    #[test]
    fn round_trips_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join(FILE_NAME);
        let saved = WindowState::from_window(
            WindowBounds::Fullscreen(Bounds::new(point(px(10.), px(20.)), size(px(1000.), px(700.)))),
            Some("uuid-1".into()),
        );
        save(&path, &saved).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded, saved);
        assert_eq!(loaded.mode, WindowMode::Fullscreen);
        assert_eq!(
            restore(Some(&loaded), &[display(7, "uuid-1", 0.)]).unwrap().bounds,
            WindowBounds::Fullscreen(Bounds::new(point(px(10.), px(20.)), size(px(1000.), px(700.))))
        );
    }

    #[test]
    fn restores_on_the_saved_display() {
        let displays = [display(1, "main", 0.), display(2, "side", 1920.)];
        let restored = restore(Some(&state("side", WindowMode::Maximized, 100.)), &displays).unwrap();
        assert_eq!(restored.display, Some(DisplayId::new(2)));
        assert!(matches!(restored.bounds, WindowBounds::Maximized(_)));
    }

    #[test]
    fn falls_back_when_the_display_or_place_is_gone() {
        let displays = [display(1, "main", 0.)];
        assert_eq!(restore(Some(&state("unplugged", WindowMode::Windowed, 100.)), &displays), None);
        assert_eq!(restore(Some(&state("main", WindowMode::Windowed, 5000.)), &displays), None);
        assert_eq!(restore(None, &displays), None);
        let tiny = WindowState { width: 10., ..state("main", WindowMode::Windowed, 0.) };
        assert_eq!(restore(Some(&tiny), &displays), None);
    }
}
