//! The app's zoom: one factor every size in the workbench is drawn at.
//!
//! GPUI resolves a `Pixels` as written, so a size only scales if whatever produced it scaled it.
//! The app writes its sizes through [`px`] instead of `gpui::px`, and through the constants in
//! `metrics` and `typography`, which read the same factor. Zoom In then moves the whole window,
//! not just the editors.
//!
//! The factor lives in a `static` rather than a GPUI global because the sizes are written in
//! `const`-shaped places that have no `App` to read from, and because every window of the app
//! zooms together, as a person means by Cmd-+. Every change refreshes the windows, so the sizes
//! are read again on the next frame.

use std::sync::atomic::{AtomicU32, Ordering};

use gpui::{App, Pixels};

pub const ZOOM_STEPS: [f32; 51] = [
    0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95, 2.0, 2.05, 2.1, 2.15, 2.2, 2.25, 2.3, 2.35, 2.4, 2.45, 2.5, 2.55, 2.6, 2.65, 2.7, 2.75, 2.8, 2.85, 2.9, 2.95, 3.0,
];

static ZOOM: AtomicU32 = AtomicU32::new(1.0f32.to_bits());

/// What the window is drawn at: 1.0 is 100%.
pub fn zoom() -> f32 {
    f32::from_bits(ZOOM.load(Ordering::Relaxed))
}

pub fn from_setting(value: f64) -> f32 {
    if value <= 3.0 { value as f32 } else { (value / 100.0) as f32 }
}

pub fn to_setting(zoom: f32) -> f64 {
    (zoom as f64 * 100.0).round()
}

/// A size in pixels at 100%, scaled to the zoom the app is drawn at.
///
/// This shadows `gpui::px` on purpose: a view writes `px(8.)` and means "8 pixels of this UI",
/// which is 12 at 150%. Reach for `gpui::px` only for a length that must not scale, such as a
/// hairline border or a measurement read back from the platform.
pub fn px(value: f32) -> Pixels {
    gpui::px(value * zoom())
}

/// Sets the zoom and redraws every window. Out-of-range values are clamped to the steps.
pub fn set_zoom(level: f32, cx: &mut App) {
    let level = level.clamp(ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.len() - 1]);
    if (level - zoom()).abs() < f32::EPSILON {
        return;
    }
    ZOOM.store(level.to_bits(), Ordering::Relaxed);
    cx.refresh_windows();
}

/// The step after `level`, in or out; the ends hold.
pub fn stepped(level: f32, in_: bool) -> f32 {
    if in_ {
        ZOOM_STEPS.iter().copied().find(|step| *step > level + 0.001).unwrap_or(ZOOM_STEPS[ZOOM_STEPS.len() - 1])
    } else {
        ZOOM_STEPS.iter().rev().copied().find(|step| *step < level - 0.001).unwrap_or(ZOOM_STEPS[0])
    }
}

/// Zooms a step in or out.
pub fn zoom_by(in_: bool, cx: &mut App) {
    set_zoom(stepped(zoom(), in_), cx);
}

pub fn reset_zoom(cx: &mut App) {
    set_zoom(1.0, cx);
}

/// Holds the sizes for one test at a time: the zoom and the UI font size are each one
/// process-wide value, and the tests that read a scaled size would otherwise race the tests that
/// change either of them.
#[cfg(test)]
pub(crate) static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Sets the zoom without a window to refresh, for tests. Take [`TEST_LOCK`] first.
#[cfg(test)]
pub(crate) fn set_zoom_for_test(level: f32) {
    ZOOM.store(level.to_bits(), Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_walk_the_ladder_and_hold_at_the_ends() {
        assert_eq!(stepped(1.0, true), 1.1);
        assert_eq!(stepped(1.0, false), 0.9);
        assert_eq!(stepped(3.0, true), 3.0);
        assert_eq!(stepped(0.5, false), 0.5);
        // A level between steps moves to the next one either way.
        assert_eq!(stepped(1.27, true), 1.3);
        assert_eq!(stepped(1.27, false), 1.25);
    }

    #[test]
    fn settings_are_percentages_but_old_factors_still_read() {
        assert_eq!(from_setting(100.0), 1.0);
        assert_eq!(from_setting(150.0), 1.5);
        assert_eq!(from_setting(1.25), 1.25);
        assert_eq!(to_setting(1.0), 100.0);
        assert_eq!(to_setting(1.25), 125.0);
    }

    #[test]
    fn a_size_scales_with_the_zoom() {
        let _held = TEST_LOCK.lock().unwrap_or_else(|held| held.into_inner());
        set_zoom_for_test(1.0);
        assert_eq!(px(8.), gpui::px(8.));
        set_zoom_for_test(1.5);
        assert_eq!(px(8.), gpui::px(12.));
        set_zoom_for_test(1.0);
    }
}
