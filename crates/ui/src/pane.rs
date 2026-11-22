use crate::scale::px;
use gpui::{
    App, Div, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div,
};
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, metrics, typography};

/// A raised card on the page plane: the editor area, a session, each dock tool. The island's
/// content covers its inner edge, as the page's opaque panes cover it, so only the outer ring shows.
pub fn island(cx: &App) -> Div {
    let theme = cx.theme();
    let shadow = theme.shadows.raised.iter().filter(|shadow| !shadow.inset).cloned().collect::<Vec<_>>();
    div()
        .flex()
        .flex_col()
        .min_h_0()
        .min_w_0()
        .overflow_hidden()
        .rounded(metrics::island_radius())
        .bg(theme.colors.background)
        .shadow(shadow)
}

/// The workbench's inner frame: the sidebar and the centre share one surface inside the window
/// chrome, as a single rounded panel with a hairline border. The window around it (the activity
/// bar, the title strip) stays on `colors.window`.
pub fn shell(cx: &App) -> Div {
    let theme = cx.theme();
    let shadow = theme.shadows.raised.iter().filter(|shadow| !shadow.inset).cloned().collect::<Vec<_>>();
    div()
        .flex()
        .flex_row()
        .flex_1()
        .min_h_0()
        .min_w_0()
        .overflow_hidden()
        .rounded(metrics::island_radius())
        .border_1()
        .border_color(theme.colors.border)
        .bg(theme.colors.background)
        .shadow(shadow)
}

/// A pane inside [`shell`]: the shell draws the surface, so the pane only lays its content out.
pub fn framed_pane() -> Div {
    div().flex().flex_col().min_h_0().min_w_0().overflow_hidden()
}

/// The header row every pane opens with: its title or tabs on the left, then its actions.
pub fn pane_header(cx: &App) -> Div {
    div()
        .flex()
        .flex_none()
        .items_center()
        .w_full()
        .min_w_0()
        .h(metrics::pane_header())
        .gap(metrics::chrome_gap())
        .px(px(8.))
        .text_size(typography::text_chrome())
        .text_color(cx.theme().colors.subtle_foreground)
}

/// The actions at the end of a pane header. Put maximize and close last.
pub fn pane_actions() -> Div {
    div().ml_auto().flex().flex_none().items_center().gap(metrics::chrome_gap_tight())
}

/// A pane's icon and name, with an optional quiet reading such as a count after it.
#[derive(IntoElement)]
pub struct PaneTitle {
    title: SharedString,
    icon: Option<IconName>,
    detail: Option<SharedString>,
}

impl PaneTitle {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self { title: title.into(), icon: None, detail: None }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

impl RenderOnce for PaneTitle {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .gap(metrics::chrome_gap())
            .px(px(4.))
            .children(
                self.icon
                    .map(|icon| Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground)),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.foreground)
                    .child(self.title),
            )
            .children(
                self.detail
                    .map(|detail| div().flex_none().text_color(colors.subtle_foreground).child(detail)),
            )
    }
}
