//! The type scale (`--ui-text-*`): one family, four sizes.

use gpui::{App, FontWeight, Global, Pixels, SharedString, Styled, px};

pub const UI_FONT: &str = "Inter";
pub const MONO_FONT: &str = "JetBrains Mono";

pub const TEXT_BASE: Pixels = px(13.);
pub const TEXT_LG: Pixels = px(15.);
pub const TEXT_SM: Pixels = px(12.);
pub const TEXT_CAPTION: Pixels = px(11.);
/// Chrome text: headers, tabs and toolbars.
pub const TEXT_CHROME: Pixels = TEXT_SM;

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
        self.text_size(TEXT_BASE)
    }
    fn text_ui_sm(self) -> Self {
        self.text_size(TEXT_SM)
    }
    fn text_ui_caption(self) -> Self {
        self.text_size(TEXT_CAPTION)
    }
    fn text_ui_lg(self) -> Self {
        self.text_size(TEXT_LG)
    }
    fn font_medium(self) -> Self {
        self.font_weight(MEDIUM)
    }
}

impl<T: Styled> TextStyleExt for T {}
