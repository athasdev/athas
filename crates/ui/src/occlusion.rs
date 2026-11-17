//! Floating UI (menus, popovers, dialogs, toasts) reports where it paints each frame, so native
//! views placed over the window, such as browser pages, can make room for it.

use std::collections::HashMap;

use gpui::{App, Bounds, Global, IntoElement, Pixels, Styled, Window, WindowId, canvas};

#[derive(Default)]
struct Overlays(HashMap<WindowId, Vec<Bounds<Pixels>>>);

impl Global for Overlays {}

/// Starts a frame of `window`: forgets the overlays of the last one. Only windows that start
/// frames keep reports.
pub fn begin_frame(window: &Window, cx: &mut App) {
    cx.default_global::<Overlays>().0.insert(window.window_handle().window_id(), Vec::new());
}

/// Floating UI paints over `bounds` this frame.
pub fn report(bounds: Bounds<Pixels>, window: &Window, cx: &mut App) {
    if let Some(overlays) = cx.default_global::<Overlays>().0.get_mut(&window.window_handle().window_id()) {
        overlays.push(bounds);
    }
}

/// Where floating UI paints in `window` this frame, as far as it has been laid out.
pub fn overlays(window: &Window, cx: &App) -> Vec<Bounds<Pixels>> {
    cx.try_global::<Overlays>().and_then(|overlays| overlays.0.get(&window.window_handle().window_id()).cloned()).unwrap_or_default()
}

/// Reports its parent's bounds as floating UI. The parent must be positioned.
pub fn occluder() -> impl IntoElement {
    canvas(|bounds, window, cx| report(bounds, window, cx), |_, _, _, _| {}).absolute().size_full()
}
