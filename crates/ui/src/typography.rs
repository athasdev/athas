//! The type scale (`--ui-text-*`): one family, four sizes.

use gpui::{App, FontWeight, Global, Pixels, SharedString, Styled};

// The settings' own `uiFontSize` scales with the window too.
use crate::scale::px;

pub const UI_FONT: &str = "Inter";
pub const MONO_FONT: &str = "JetBrains Mono";

pub fn text_base() -> Pixels { crate::scale::px(13.) }
pub fn text_lg() -> Pixels { crate::scale::px(15.) }
pub fn text_sm() -> Pixels { crate::scale::px(12.) }
pub fn text_caption() -> Pixels { crate::scale::px(11.) }
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
        Self { family: UI_FONT.into(), size: 13. }
    }
}

impl Global for UiTypography {}

impl UiTypography {
    pub fn base(&self) -> Pixels {
        px(self.size)
    }
    pub fn lg(&self) -> Pixels {
        px(self.size + 2.)
    }
    pub fn sm(&self) -> Pixels {
        px((self.size - 1.).max(11.))
    }
    pub fn caption(&self) -> Pixels {
        px((self.size - 3.).max(11.))
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
    if cx.try_global::<UiTypography>() != Some(&typography) {
        cx.set_global(typography);
    }
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
