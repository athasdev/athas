use crate::TooltipExt;
use std::rc::Rc;

use gpui::{
    App, ClickEvent, ElementId, InteractiveElement, IntoElement, ParentElement, RenderOnce,
    SharedString, StatefulInteractiveElement, Styled, Window, div, prelude::FluentBuilder, px,
};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, Tooltip, metrics, typography};

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;
type MouseHandler = Rc<dyn Fn(&gpui::MouseDownEvent, &mut Window, &mut App)>;

/// An editor tab in a pane header: a pill that lifts while it is the one in front.
#[derive(IntoElement)]
pub struct Tab {
    id: ElementId,
    label: SharedString,
    icon: Option<IconName>,
    leading: Option<gpui::AnyElement>,
    indicator: Option<gpui::AnyElement>,
    active: bool,
    dirty: bool,
    pinned: bool,
    preview: bool,
    stretch: bool,
    show_close: Option<bool>,
    close_shortcut: Option<SharedString>,
    forced_hover: bool,
    on_click: Option<ClickHandler>,
    on_close: Option<ClickHandler>,
    on_secondary: Option<MouseHandler>,
    on_middle: Option<MouseHandler>,
}

impl Tab {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon: None,
            leading: None,
            indicator: None,
            active: false,
            dirty: false,
            pinned: false,
            preview: false,
            stretch: false,
            show_close: None,
            close_shortcut: None,
            forced_hover: false,
            on_click: None,
            on_close: None,
            on_secondary: None,
            on_middle: None,
        }
    }

    /// The shortcut the close button's tooltip shows (`closeShortcut`).
    pub fn close_shortcut(mut self, shortcut: Option<SharedString>) -> Self {
        self.close_shortcut = shortcut;
        self
    }

    /// Draws the hover state without the pointer (state galleries and snapshots).
    pub fn force_hover(mut self, hovered: bool) -> Self {
        self.forced_hover = hovered;
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// Something drawn in place of the icon, such as a project's glyph.
    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    /// Shown after the label, for state that needs the user (`TabDecoration.indicator`).
    pub fn indicator(mut self, element: impl IntoElement) -> Self {
        self.indicator = Some(element.into_any_element());
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    pub fn dirty(mut self, dirty: bool) -> Self {
        self.dirty = dirty;
        self
    }

    /// A pinned tab shows a pin where the close button goes; `on_close` then unpins it.
    pub fn pinned(mut self, pinned: bool) -> Self {
        self.pinned = pinned;
        self
    }

    /// A preview tab, replaced by the next file opened, reads in italics (`TabLabel preview`).
    pub fn preview(mut self, preview: bool) -> Self {
        self.preview = preview;
        self
    }

    /// Shares the strip's width with the other stretched tabs, its label centred, as window
    /// tabs do.
    pub fn stretch(mut self) -> Self {
        self.stretch = true;
        self
    }

    /// Keeps the close button shown instead of only on hover; by default it shows on the tab in
    /// front (`tabCloseButtonVisibility`).
    pub fn show_close(mut self, show: bool) -> Self {
        self.show_close = Some(show);
        self
    }

    /// The middle button, which closes the tab.
    pub fn on_middle_click(mut self, handler: impl Fn(&gpui::MouseDownEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_middle = Some(Rc::new(handler));
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }

    /// The tab's context menu.
    pub fn on_secondary_mouse_down(mut self, handler: impl Fn(&gpui::MouseDownEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_secondary = Some(Rc::new(handler));
        self
    }

    pub fn on_close(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Tab {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme();
        let colors = &theme.colors;
        let group = SharedString::from(format!("tab-{}", self.id));
        let text = if self.active { colors.foreground } else { colors.subtle_foreground };
        let close_id = ElementId::Name(format!("{}-close", self.id).into());
        let hover_fg = colors.foreground;
        let hover_bg = colors.segment_track;
        let close_hover = colors.accent;
        let forced = self.forced_hover && !self.active;
        let show_close = self.show_close.unwrap_or(self.active) || self.forced_hover;
        let text = if forced { hover_fg } else { text };

        // `TabItem`: 12px in front, 24px behind for the close button, which sits 4px from the
        // end as an extra-small ghost icon button (20px, subtle, accent fill on hover). Unsaved
        // changes show as an 8px primary dot after the label (`tab-bar-item.tsx`).
        let subtle = colors.subtle_foreground;
        let close_group = group.clone();
        div()
            .id(self.id)
            .group(group.clone())
            .relative()
            .flex()
            .items_center()
            .gap(metrics::CHROME_GAP)
            .h(metrics::TAB)
            .when(self.stretch, |this| this.flex_1().min_w_0().justify_center().px(px(20.)))
            .when(!self.stretch, |this| this.flex_none().min_w(px(80.)).max_w(metrics::TAB_MAX_WIDTH).pl(px(8.)).pr(px(24.)))
            .rounded(metrics::RADIUS_MD)
            .text_size(typography::TEXT_CHROME)
            .text_color(text)
            .when(self.active, |this| {
                this.font_weight(typography::MEDIUM).bg(colors.segment_knob).shadow(theme.shadows.raised_inset.clone())
            })
            .when(self.active && theme::accessibility(cx).differentiate_without_color, |this| this.border_1().border_color(colors.border_strong))
            .when(!self.active, |this| this.hover(move |style| style.text_color(hover_fg).bg(hover_bg)))
            .when(forced, |this| this.bg(hover_bg))
            .children(self.leading)
            .children(self.icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(text)))
            .child(div().min_w_0().when(!self.stretch, |this| this.flex_1()).truncate().when(self.preview, |this| this.italic()).child(self.label))
            .when(self.dirty, |this| this.child(div().flex_none().size(px(8.)).rounded_full().bg(colors.primary)))
            .children(self.indicator)
            .child(
                div()
                    .id(close_id)
                    .absolute()
                    .top(px(2.))
                    .right(px(4.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(20.))
                    .rounded(metrics::RADIUS_MD)
                    .group("ui-tab-close")
                    .text_color(subtle)
                    .hover(move |style| style.bg(close_hover))
                    .when(!show_close, |this| this.invisible().group_hover(close_group, |style| style.visible()))
                    .child(if self.pinned {
                        Icon::new(IconName::Pin).filled(true).size(IconSize::XSmall).color(colors.primary)
                    } else {
                        Icon::new(IconName::X).size(IconSize::XSmall).color(subtle).group_hover_color("ui-tab-close", hover_fg)
                    })
                    .anchored_tooltip({
                        let pinned = self.pinned;
                        let shortcut = self.close_shortcut.clone();
                        move || Tooltip::new(if pinned { "Unpin tab" } else { "Close" }).shortcut(shortcut.clone())
                    })
                    .when_some(self.on_close, |this, handler| {
                        this.on_click(move |event, window, cx| {
                            cx.stop_propagation();
                            handler(event, window, cx)
                        })
                    }),
            )
            .when_some(self.on_click, |this, handler| {
                this.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .when_some(self.on_secondary, |this, handler| {
                this.on_mouse_down(gpui::MouseButton::Right, move |event, window, cx| handler(event, window, cx))
            })
            .when_some(self.on_middle, |this, handler| {
                this.on_mouse_down(gpui::MouseButton::Middle, move |event, window, cx| handler(event, window, cx))
            })
    }
}
