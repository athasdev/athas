use gpui::prelude::*;
use crate::scale::px;
use gpui::{App, Hsla, IntoElement, Pixels, RenderOnce, Styled, Window, svg};
use theme::ActiveTheme;

#[path = "icon_names.rs"]
mod icon_names;
pub use icon_names::IconName;

/// The sizes icons render at; the stroke is drawn for 16px, as the web workbench pins it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum IconSize {
    /// 12px: inline with caption and chrome text.
    XSmall,
    /// 14px: forms and dialogs.
    Small,
    /// 16px: the activity rail and rows.
    #[default]
    Medium,
    Custom(Pixels),
}

impl IconSize {
    pub fn pixels(self) -> Pixels {
        match self {
            IconSize::XSmall => px(12.),
            IconSize::Small => px(14.),
            IconSize::Medium => px(16.),
            IconSize::Custom(size) => size,
        }
    }
}

#[derive(IntoElement)]
pub struct Icon {
    name: IconName,
    path: Option<&'static str>,
    size: IconSize,
    color: Option<Hsla>,
    hover_color: Option<(gpui::SharedString, Hsla)>,
    filled: bool,
}

impl Icon {
    pub fn new(name: IconName) -> Self {
        Self { name, path: None, size: IconSize::default(), color: None, hover_color: None, filled: false }
    }

    /// An icon outside the Nucleo set, such as a brand mark.
    pub fn from_path(path: &'static str) -> Self {
        Self { path: Some(path), ..Self::new(IconName::Square) }
    }

    pub fn size(mut self, size: IconSize) -> Self {
        self.size = size;
        self
    }

    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }

    /// The colour the icon takes while the pointer is over `group`, as a `currentColor` icon
    /// follows its button's `hover:text-*`.
    pub fn group_hover_color(mut self, group: impl Into<gpui::SharedString>, color: Hsla) -> Self {
        self.hover_color = Some((group.into(), color));
        self
    }

    /// Draws the solid variant when the icon has one, as active rail items do.
    pub fn filled(mut self, filled: bool) -> Self {
        self.filled = filled;
        self
    }
}

impl RenderOnce for Icon {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let path = self.path.unwrap_or_else(|| {
            self.filled
                .then(|| self.name.filled_path())
                .flatten()
                .unwrap_or_else(|| self.name.path())
        });
        let size = self.size.pixels();
        svg()
            .path(path)
            .size(size)
            .flex_none()
            .text_color(self.color.unwrap_or(cx.theme().colors.foreground))
            .when_some(self.hover_color, |this, (group, color)| this.group_hover(group, move |style| style.text_color(color)))
    }
}

impl From<IconName> for Icon {
    fn from(name: IconName) -> Self {
        Icon::new(name)
    }
}
