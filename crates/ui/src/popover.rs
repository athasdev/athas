use crate::scale::px;
use gpui::{AnyElement, Anchor, App, IntoElement, Pixels, Point, RenderOnce, SharedString, Window, anchored, deferred, div, prelude::*,};
use theme::ActiveTheme;

use crate::{MenuSize, overlay_max_width, metrics, typography};

/// A floating panel of content (`ui/popover.tsx`): the overlay plane with the popover ring.
#[derive(IntoElement)]
pub struct Popover {
    size: MenuSize,
    list: bool,
    children: Vec<AnyElement>,
}

impl Popover {
    /// 288px wide, as the web popover's default `wide` preset.
    pub fn new() -> Self {
        Self { size: MenuSize::Wide, list: false, children: Vec::new() }
    }

    pub fn size(mut self, size: MenuSize) -> Self {
        self.size = size;
        self
    }

    /// No padding or gap, for a list that runs to the edges.
    pub fn list(mut self) -> Self {
        self.list = true;
        self
    }
}

impl Default for Popover {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Popover {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Popover {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        div()
            .id("popover")
            .occlude()
            .flex()
            .flex_col()
            .max_w(overlay_max_width())
            .when_some(self.size.width(), |this, width| this.w(width))
            .when(!self.list, |this| this.gap(px(8.)).p(px(8.)))
            .when(self.list, |this| this.overflow_hidden())
            .rounded(metrics::radius_lg())
            .bg(theme.colors.overlay)
            .shadow(theme.shadows.popover.clone())
            .font_family(typography::ui_font())
            .text_size(typography::text_chrome())
            .text_color(theme.colors.foreground)
            .children(self.children)
    }
}

/// A popover's title and the line under it.
#[derive(IntoElement)]
pub struct PopoverHeader {
    title: SharedString,
    description: Option<SharedString>,
}

impl PopoverHeader {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self { title: title.into(), description: None }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }
}

impl RenderOnce for PopoverHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .text_size(typography::text_chrome())
            .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(self.title))
            .children(self.description.map(|description| div().text_color(colors.muted_foreground).child(description)))
    }
}

/// Floats `content` over the window from `position`, kept 8px inside its edges, as menus and
/// popovers hang from their trigger.
pub fn anchored_overlay(position: Point<Pixels>, anchor: Anchor, offset: Pixels, content: impl IntoElement) -> impl IntoElement {
    let spaced = match anchor {
        Anchor::BottomLeft | Anchor::BottomRight | Anchor::BottomCenter => div().mb(offset),
        _ => div().mt(offset),
    };
    deferred(anchored().position(position).anchor(anchor).snap_to_window_with_margin(px(8.)).child(spaced.relative().child(content).child(crate::occluder()))).with_priority(1)
}
