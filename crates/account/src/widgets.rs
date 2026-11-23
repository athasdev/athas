//! Small pieces the account, sharing and team views share: settings-style sections and rows, a
//! badge, a meter and a dialog frame, drawn as `settings_ui` and `src/ui` draw them.

use ui::scale::px;
use gpui::{AnyElement, App, Div, Hsla, IntoElement, ParentElement, SharedString, Styled, div, prelude::*,};
use theme::ActiveTheme;
use ui::{metrics, typography};

/// A titled group of rows on a raised card, like a Settings section.
pub fn section(title: Option<&str>, rows: Vec<AnyElement>, cx: &App) -> AnyElement {
    let theme = cx.theme();
    let rows = rows.into_iter().enumerate().map(|(index, row)| {
        div()
            .relative()
            .when(index > 0, |this| {
                this.child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(theme.colors.divider))
            })
            .child(row)
    });
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .children(title.map(|title| {
            div()
                .px(px(12.))
                .text_size(typography::text_sm())
                .font_weight(typography::MEDIUM)
                .text_color(theme.colors.muted_foreground)
                .child(SharedString::from(title.to_string()))
        }))
        .child(
            div()
                .flex()
                .flex_col()
                .rounded(metrics::radius_lg())
                .bg(theme.colors.raised)
                .shadow(theme.shadows.raised.clone())
                .children(rows),
        )
        .into_any_element()
}

/// One row: a label with an optional description, and the controls on the right.
pub fn row(label: impl Into<SharedString>, description: Option<SharedString>, controls: impl IntoElement, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(24.))
        .min_h(px(44.))
        .py(px(10.))
        .px(px(12.))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(2.))
                .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(label.into()))
                .children(description.map(|description| {
                    div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(description)
                })),
        )
        .child(div().flex().flex_none().items_center().gap(px(6.)).child(controls))
        .into_any_element()
}

/// A quiet label in a pill, such as a plan or a review state.
pub fn badge(label: impl Into<SharedString>, tone: Option<Hsla>, cx: &App) -> Div {
    let colors = &cx.theme().colors;
    let (text, fill) = match tone {
        Some(tone) => (tone, tone.opacity(0.14)),
        None => (colors.muted_foreground, colors.selected),
    };
    div()
        .flex_none()
        .px(px(6.))
        .py(px(1.))
        .rounded(metrics::radius())
        .bg(fill)
        .text_size(typography::text_caption())
        .font_weight(typography::MEDIUM)
        .text_color(text)
        .child(label.into())
}

/// A thin bar filled to `fraction` (0 to 1).
pub fn meter(fraction: f32, _cx: &App) -> Div {
    let tone = if fraction >= 0.9 { ui::ProgressTone::Warning } else { ui::ProgressTone::Accent };
    div().w_full().child(ui::Progress::new(fraction.clamp(0., 1.) * 100.).tone(tone))
}

/// The card a dialog floats in: title row, body, then the footer's buttons.
pub fn dialog(title: impl Into<SharedString>, body: impl IntoElement, footer: Vec<AnyElement>, cx: &App) -> Div {
    let theme = cx.theme();
    div()
        .flex()
        .flex_col()
        .w(px(520.))
        .max_w_full()
        .rounded(metrics::overlay_radius())
        .overflow_hidden()
        .bg(theme.colors.background)
        .shadow(theme.shadows.dialog.clone())
        .font_family(typography::ui_font())
        .text_color(theme.colors.foreground)
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .h(metrics::pane_header())
                .px(px(20.))
                .text_size(typography::text_base())
                .font_weight(typography::SEMIBOLD)
                .child(title.into()),
        )
        .child(div().flex().flex_col().gap(px(12.)).px(px(20.)).pb(px(16.)).child(body))
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_end()
                .gap(px(8.))
                .px(px(20.))
                .py(px(12.))
                .border_t_1()
                .border_color(theme.colors.divider)
                .children(footer),
        )
}

/// A field's label above its control, with an optional hint under it.
pub fn field(label: impl Into<SharedString>, control: impl IntoElement, hint: Option<SharedString>, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .flex_col()
        .gap(px(6.))
        .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(label.into()))
        .child(control)
        .children(hint.map(|hint| div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(hint)))
        .into_any_element()
}

/// A line of error text.
pub fn error_text(message: impl Into<SharedString>, cx: &App) -> AnyElement {
    div().text_size(typography::text_sm()).text_color(cx.theme().colors.destructive).child(message.into()).into_any_element()
}

/// "5m ago", "3h ago", "2d ago", or the date, for an ISO timestamp.
pub fn relative_time(timestamp: Option<&str>) -> String {
    let Some(time) = timestamp.and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok()) else { return String::new() };
    let seconds = (chrono::Utc::now().timestamp() - time.timestamp()).max(0);
    match seconds {
        0..60 => "just now".into(),
        60..3_600 => format!("{}m ago", seconds / 60),
        3_600..86_400 => format!("{}h ago", seconds / 3_600),
        86_400..2_592_000 => format!("{}d ago", seconds / 86_400),
        _ => time.format("%Y-%m-%d").to_string(),
    }
}
