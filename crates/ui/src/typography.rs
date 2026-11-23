//! The type scale (`--ui-text-*`): one family, four sizes, both of them what `uiFontFamily` and
//! `uiFontSize` ask for.
//!
//! The size and the family live in `static`s, for the same reason the zoom factor does (see
//! `scale`): the ladder below is written in `const`-shaped places with no `App` to read from, and
//! every window of the app shares them. They used to be constants with the setting applied to the
//! workbench's root element alone — which the seven hundred odd `text_size(text_sm())` calls
//! under it each overrode, so changing the setting moved nothing anyone could see.

use std::sync::RwLock;
use std::sync::atomic::{AtomicU32, Ordering};

use gpui::{App, FontWeight, Global, Pixels, SharedString, Styled};

// The settings' own `uiFontSize` scales with the window too.
use crate::scale::px;

pub const UI_FONT: &str = "Inter";
pub const MONO_FONT: &str = "JetBrains Mono";
/// What `uiFontSize` is before anyone changes it; the rungs below are offsets from it.
pub const UI_FONT_SIZE: f32 = 13.;

static SIZE: AtomicU32 = AtomicU32::new(UI_FONT_SIZE.to_bits());
static FAMILY: RwLock<Option<SharedString>> = RwLock::new(None);

/// The size `uiFontSize` asks for, before the zoom.
pub fn ui_font_size() -> f32 {
    f32::from_bits(SIZE.load(Ordering::Relaxed))
}

/// The family `uiFontFamily` asks for. Write `font_family(ui_font())`, not the `UI_FONT`
/// constant, or the setting stops at whatever element set it last.
pub fn ui_font() -> SharedString {
    FAMILY.read().ok().and_then(|family| family.clone()).unwrap_or_else(|| UI_FONT.into())
}

pub fn text_base() -> Pixels { px(ui_font_size()) }
pub fn text_lg() -> Pixels { px(ui_font_size() + 2.) }
pub fn text_sm() -> Pixels { px(ui_font_size() - 1.) }
pub fn text_caption() -> Pixels { px(ui_font_size() - 2.) }
/// Chrome text: headers, tabs and toolbars.
pub fn text_chrome() -> Pixels { text_sm() }

pub const MEDIUM: FontWeight = FontWeight::MEDIUM;
pub const SEMIBOLD: FontWeight = FontWeight::SEMIBOLD;

/// The line height rows use (`--leading-row`).
pub const LEADING_ROW: f32 = 1.35;

/// `uiFontFamily` and `uiFontSize` from the settings; the constants above are their defaults.
#[derive(Clone, Debug, PartialEq)]
pub struct UiTypography {
    pub family: SharedString,
    pub size: f32,
}

impl Default for UiTypography {
    fn default() -> Self {
        Self { family: UI_FONT.into(), size: UI_FONT_SIZE }
    }
}

impl Global for UiTypography {}

impl UiTypography {
    pub fn base(&self) -> Pixels {
        text_base()
    }
    pub fn lg(&self) -> Pixels {
        text_lg()
    }
    pub fn sm(&self) -> Pixels {
        text_sm()
    }
    pub fn caption(&self) -> Pixels {
        text_caption()
    }
    /// A list row's height for this size (`getFileTreeRowHeight`).
    pub fn row_height(&self) -> Pixels {
        px((self.size * LEADING_ROW + 10.).round())
    }
}

/// The UI type the settings ask for.
pub fn ui(cx: &App) -> UiTypography {
    cx.try_global::<UiTypography>().cloned().unwrap_or_default()
}

pub fn set_ui(cx: &mut App, typography: UiTypography) {
    if cx.try_global::<UiTypography>() == Some(&typography) {
        return;
    }
    SIZE.store(typography.size.to_bits(), Ordering::Relaxed);
    if let Ok(mut family) = FAMILY.write() {
        *family = Some(typography.family.clone());
    }
    cx.set_global(typography);
    // The ladder is read on the next frame, so every window has to draw one.
    cx.refresh_windows();
}

pub trait TextStyleExt: Styled + Sized {
    fn text_ui_base(self) -> Self {
        self.text_size(text_base())
    }
    fn text_ui_sm(self) -> Self {
        self.text_size(text_sm())
    }
    fn text_ui_caption(self) -> Self {
        self.text_size(text_caption())
    }
    fn text_ui_lg(self) -> Self {
        self.text_size(text_lg())
    }
    fn font_medium(self) -> Self {
        self.font_weight(MEDIUM)
    }
}

impl<T: Styled> TextStyleExt for T {}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rungs are offsets from `uiFontSize`, not constants. They were constants once, with the
    /// setting applied to the workbench's root element alone — which every `text_size` call under
    /// it overrode, so the setting moved nothing anyone could see.
    #[test]
    fn the_rungs_follow_the_setting() {
        // The zoom is a process-wide factor and the sizes below read it, so hold it still rather
        // than racing the tests that move it.
        let _held = crate::scale::TEST_LOCK.lock().unwrap_or_else(|held| held.into_inner());
        SIZE.store(UI_FONT_SIZE.to_bits(), Ordering::Relaxed);
        assert_eq!(text_base(), gpui::px(13.));
        assert_eq!(text_sm(), gpui::px(12.));
        assert_eq!(text_caption(), gpui::px(11.));
        assert_eq!(text_lg(), gpui::px(15.));

        SIZE.store(18.0f32.to_bits(), Ordering::Relaxed);
        assert_eq!(text_base(), gpui::px(18.));
        assert_eq!(text_sm(), gpui::px(17.));
        assert_eq!(text_caption(), gpui::px(16.));
        assert_eq!(text_chrome(), text_sm());

        SIZE.store(UI_FONT_SIZE.to_bits(), Ordering::Relaxed);
    }

    #[test]
    fn the_family_falls_back_to_the_default() {
        assert_eq!(ui_font(), SharedString::from(UI_FONT));
    }
}
