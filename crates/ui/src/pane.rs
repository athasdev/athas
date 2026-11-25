use crate::scale::px;
use gpui::{
    AnyElement, App, Div, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div,
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
pub fn shell(cx: &App, border_width: gpui::Pixels) -> Div {
    let theme = cx.theme();
    div()
        .flex()
        .flex_row()
        .flex_1()
        .min_h_0()
        .min_w_0()
        .overflow_hidden()
        // inner radius = outer radius - border width
        .rounded(metrics::island_radius() + border_width)
        .border(border_width)
        .border_color(theme.colors.border)
        .p(border_width)
        .bg(theme.colors.background)
}

/// A pane inside [`shell`]: the shell draws the surface, so the pane only lays its content out.
pub fn framed_pane() -> Div {
    div().flex().flex_col().min_h_0().min_w_0().overflow_hidden().rounded_b(metrics::island_radius())
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

/// The one header every sidebar tool and side panel wears: the name, a quiet reading after it,
/// then whatever buttons the tool has.
///
/// There used to be two. Sidebar tools (Sessions, Files, Source Control, GitHub) wore a
/// `SectionLabel` — quiet, no icon, no rule under it — while the side panels (the Inbox and the
/// lists the sessions footer opens) wore `pane_header` with a `PaneTitle` and a divider beneath.
/// Side by side they read as two different apps. This is the sidebar's version, because that is
/// the quieter of the two and there are more of them: no icon (the rail and the row that opened
/// the panel both show it already), and one full-width rule under the row to close it off.
#[derive(IntoElement)]
pub struct PanelHeader {
    label: SharedString,
    detail: Option<SharedString>,
    more: Option<AnyElement>,
    trailing: Option<AnyElement>,
}

impl PanelHeader {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self { label: label.into(), detail: None, more: None, trailing: None }
    }

    /// A quiet reading after the name: "3 new", "2 selected", "12 archived".
    pub fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    /// The tool's More actions button, which sits against the name. Everything the menu holds is
    /// about the thing the name says, so it reads as part of the name rather than as one more
    /// control in the row; and where the row's other buttons change with what the tool is
    /// showing, this one is always there, so a fixed place at the end would be the wrong one.
    pub fn more(mut self, element: impl IntoElement) -> Self {
        self.more = Some(element.into_any_element());
        self
    }

    /// The tool's own buttons, at the row's end.
    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }
}

impl RenderOnce for PanelHeader {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        // The row keeps the sidebar's inset; the rule does not, so it runs the panel's full width.
        div()
            .flex_none()
            .pb(px(4.))
            .mb(px(4.))
            .border_b_1()
            .border_color(colors.border)
            .child(
                div()
                    .flex()
                    .items_center()
                    .min_w_0()
                    .h(metrics::chrome_control())
                    .gap(metrics::chrome_gap())
                    .pl(metrics::sidebar_inset() + px(6.))
                    .pr(metrics::sidebar_inset() + px(2.))
                    .text_size(typography::text_sm())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .child(div().flex_none().min_w_0().truncate().child(self.label))
                    .children(self.detail.map(|detail| {
                        div()
                            .flex_none()
                            .min_w_0()
                            .truncate()
                            .font_weight(gpui::FontWeight::NORMAL)
                            .text_size(typography::text_caption())
                            .text_color(colors.subtle_foreground)
                            .child(detail)
                    }))
                    .children(self.more.map(|more| div().flex().flex_none().items_center().child(more)))
                    .child(div().flex_1().min_w_0())
                    .children(self.trailing.map(|trailing| div().flex().flex_none().items_center().gap(px(2.)).child(trailing))),
            )
    }
}

/// The plane a thing floats on, clear of the window: the command palette, a command surface, a
/// dialog. It carries the corner, the fill, the shadow and the UI face; the caller gives it only
/// its size and its content.
///
/// The four surfaces that float were each writing those four lines out, and had drifted: three
/// filled with `overlay` and one with `background`, while [`Dialog`](crate::Dialog) rounded at
/// its own 12px against their 16.
pub fn overlay_surface(cx: &App) -> Div {
    let theme = cx.theme();
    div()
        .flex()
        .flex_col()
        .overflow_hidden()
        .rounded(metrics::overlay_radius())
        .bg(theme.colors.overlay)
        .shadow(theme.shadows.dialog.clone())
        .font_family(typography::ui_font())
        .text_color(theme.colors.foreground)
}
