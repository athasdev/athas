use crate::scale::px;
use gpui::{AnyElement, App, IntoElement, prelude::FluentBuilder, ParentElement, RenderOnce, SharedString, Styled, Window, div,};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, metrics, typography};

/// What an empty area says: a title, a line of explanation and the actions that fill it.
#[derive(IntoElement)]
pub struct EmptyState {
    title: SharedString,
    message: Option<SharedString>,
    icon: Option<IconName>,
    actions: Vec<AnyElement>,
}

impl EmptyState {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self { title: title.into(), message: None, icon: None, actions: Vec::new() }
    }

    pub fn message(mut self, message: impl Into<SharedString>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }
}

impl RenderOnce for EmptyState {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(8.))
            .w_full()
            .max_w(px(408.))
            .px(px(12.))
            .text_center()
            .children(self.icon.map(|icon| {
                div()
                    .mb(px(4.))
                    .size(px(32.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(metrics::radius_md())
                    .bg(colors.accent)
                    .child(Icon::new(icon).size(IconSize::Medium).color(colors.muted_foreground))
            }))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(8.))
                    .when(!self.title.is_empty(), |this| {
                        this.child(
                            div()
                                .text_size(typography::text_base())
                                .line_height(gpui::relative(1.5))
                                .font_weight(typography::MEDIUM)
                                .text_color(colors.foreground)
                                .child(self.title),
                        )
                    })
                    .children(self.message.map(|message| {
                        div()
                            .text_size(typography::text_sm())
                            .line_height(gpui::relative(1.625))
                            .text_color(colors.muted_foreground)
                            .child(message)
                    })),
            )
            .when_actions(self.actions)
    }
}

trait WhenActions {
    fn when_actions(self, actions: Vec<AnyElement>) -> Self;
}

impl WhenActions for gpui::Div {
    fn when_actions(self, actions: Vec<AnyElement>) -> Self {
        if actions.is_empty() {
            return self;
        }
        self.child(div().flex().flex_wrap().items_center().justify_center().gap(px(10.)).children(actions))
    }
}
