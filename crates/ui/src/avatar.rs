use gpui::{App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, img, prelude::FluentBuilder, px};
use theme::ActiveTheme;

use crate::typography;

/// A person's initial in a circle, until their picture loads.
#[derive(IntoElement)]
pub struct Avatar {
    initial: SharedString,
    size: gpui::Pixels,
    image: Option<SharedString>,
}

impl Avatar {
    pub fn new(name: &str) -> Self {
        let initial = name.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
        Self { initial: initial.into(), size: px(20.), image: None }
    }

    pub fn size(mut self, size: gpui::Pixels) -> Self {
        self.size = size;
        self
    }

    /// A picture's URL; the initial shows while it loads and when it cannot.
    pub fn image(mut self, url: Option<impl Into<SharedString>>) -> Self {
        self.image = url.map(Into::into);
        self
    }
}

impl RenderOnce for Avatar {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(self.size)
            .rounded_full()
            .bg(colors.selected)
            .text_size(typography::TEXT_CAPTION)
            .font_weight(typography::SEMIBOLD)
            .text_color(colors.foreground)
            .relative()
            .overflow_hidden()
            .child(self.initial)
            .when_some(self.image, |this, url| this.child(img(url).absolute().inset_0().size_full().rounded_full()))
    }
}
