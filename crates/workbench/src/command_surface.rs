//! The floating command panel (`ui/command.tsx`) for surfaces with steps of their own, such as the
//! project picker: a header with the field, a list of rows, then a footer of actions.

use ui::scale::px;
use gpui::{AnyElement, App, ClickEvent, ElementId, MouseButton, SharedString, Stateful, Window, div, prelude::*, relative};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, metrics, typography};

/// The panel, sized as the pickers are.
pub(crate) fn panel(id: impl Into<ElementId>, window: &Window, cx: &App) -> Stateful<gpui::Div> {
    let theme = cx.theme();
    let viewport = window.viewport_size();
    div()
        .id(id.into())
        .occlude()
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .flex()
        .flex_col()
        .w((viewport.width - px(32.)).min(px(800.)))
        .max_h((viewport.height * 0.72).min(px(608.)))
        .rounded(metrics::overlay_radius())
        .bg(theme.colors.overlay)
        .shadow(theme.shadows.dialog.clone())
        .overflow_hidden()
        .font_family(typography::UI_FONT)
        .text_color(theme.colors.foreground)
}

pub(crate) fn header(cx: &App) -> gpui::Div {
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(8.))
        .px(px(12.))
        .py(px(10.))
        .min_h(px(52.))
        .border_b_1()
        .border_color(cx.theme().colors.divider)
}

/// The header's close button.
pub(crate) fn close_button(id: impl Into<ElementId>, cx: &App, on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Stateful<gpui::Div> {
    let colors = cx.theme().colors.clone();
    div()
        .id(id.into())
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(24.))
        .rounded_full()
        .hover(|style| style.bg(colors.accent))
        .child(Icon::new(IconName::X).size(IconSize::XSmall).color(colors.subtle_foreground))
        .on_click(on_click)
}

/// A title in the header, for steps without a search field.
pub(crate) fn header_title(icon: IconName, title: impl Into<SharedString>, accent: bool, cx: &App) -> gpui::Div {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .flex_1()
        .min_w_0()
        .items_center()
        .gap(px(8.))
        .child(Icon::new(icon).size(IconSize::Medium).color(if accent { colors.primary } else { colors.subtle_foreground }))
        .child(div().min_w_0().truncate().text_size(typography::text_base()).font_weight(typography::MEDIUM).child(title.into()))
}

pub(crate) fn list(id: impl Into<ElementId>) -> Stateful<gpui::Div> {
    div().id(id.into()).flex().flex_col().flex_1().min_h_0().overflow_y_scroll().p(px(4.))
}

pub(crate) fn footer(cx: &App) -> gpui::Div {
    div()
        .flex()
        .flex_none()
        .flex_wrap()
        .items_center()
        .gap(px(6.))
        .p(px(8.))
        .border_t_1()
        .border_color(cx.theme().colors.divider)
}

pub(crate) fn empty(message: impl Into<SharedString>, cx: &App) -> gpui::Div {
    div()
        .p(px(12.))
        .text_center()
        .text_size(typography::text_sm())
        .line_height(relative(typography::LEADING_ROW))
        .text_color(cx.theme().colors.muted_foreground)
        .child(message.into())
}

/// A small pill beside a row's title (`CommandItemBadge`).
pub(crate) fn badge(label: impl Into<SharedString>, warning: bool, selected: bool, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    let (background, text) = if selected {
        (colors.primary_foreground.opacity(0.2), colors.primary_foreground)
    } else if warning {
        (colors.warning_soft, colors.warning)
    } else {
        (colors.accent, colors.muted_foreground)
    };
    div()
        .flex_none()
        .px(px(6.))
        .rounded_full()
        .bg(background)
        .text_size(typography::text_caption())
        .text_color(text)
        .child(label.into())
        .into_any_element()
}

/// One row of a command list: what it is, a quiet description under it, and what sits at its end.
#[derive(IntoElement)]
pub(crate) struct CommandRow {
    id: ElementId,
    leading: Option<AnyElement>,
    title: SharedString,
    description: Option<SharedString>,
    accessories: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    selected: bool,
}

impl CommandRow {
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            leading: None,
            title: title.into(),
            description: None,
            accessories: Vec::new(),
            actions: Vec::new(),
            selected: false,
        }
    }

    pub fn leading(mut self, leading: impl IntoElement) -> Self {
        self.leading = Some(leading.into_any_element());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn accessory(mut self, accessory: impl IntoElement) -> Self {
        self.accessories.push(accessory.into_any_element());
        self
    }

    /// Buttons that show while the row is selected or hovered.
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
}

impl RenderOnce for CommandRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let (text, subtle, muted) = if self.selected {
            (colors.primary_foreground, colors.primary_foreground.opacity(0.8), colors.primary_foreground.opacity(0.8))
        } else {
            (colors.foreground, colors.subtle_foreground, colors.muted_foreground)
        };
        div()
            .id(self.id)
            .group("command-row")
            .flex()
            .items_center()
            .gap(px(10.))
            .w_full()
            .min_h(px(40.))
            .mb(px(2.))
            .px(px(10.))
            .py(px(6.))
            .rounded(metrics::radius_md())
            .text_size(typography::text_sm())
            .line_height(relative(typography::LEADING_ROW))
            .when(self.selected, |this| this.bg(colors.primary))
            .children(self.leading.map(|leading| {
                div().flex().flex_none().items_center().justify_center().size(px(24.)).text_color(subtle).child(leading)
            }))
            // `CommandItemRow` inline: the title keeps its width and the description gives way.
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .flex_1()
                    .min_w_0()
                    .child(div().flex_none().max_w_full().truncate().text_color(text).child(self.title))
                    .children(self.description.map(|description| div().min_w_0().truncate().text_color(muted).child(description))),
            )
            .children(self.accessories)
            // `CommandItemAction`s show while the pointer is over the row (`group-hover/command-item`).
            .when(!self.actions.is_empty(), |this| {
                this.child(div().flex().flex_none().items_center().opacity(0.).group_hover("command-row", |style| style.opacity(1.)).children(self.actions))
            })
    }
}
