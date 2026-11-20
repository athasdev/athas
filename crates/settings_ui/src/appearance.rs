//! The Appearance page's choice cards (`appearance/appearance-choices.tsx`, `theme-previews.tsx`):
//! the color scheme and interface style as tiny windows, and the themes as swatches.

use std::sync::Arc;

use gpui::{AnyElement, App, ElementId, Hsla, SharedString, div, prelude::*, px};
use theme::{ActiveTheme, Theme};
use ui::{metrics, typography};

#[derive(Clone, Copy, PartialEq)]
enum Scheme {
    Auto,
    Light,
    Dark,
}

fn theme_or_fallback(id: &str, dark: bool, cx: &App) -> Option<Arc<Theme>> {
    let registry = theme::registry(cx);
    registry
        .get(id)
        .or_else(|| registry.themes().iter().find(|theme| theme.appearance.is_dark() == dark).cloned())
        .or_else(|| registry.themes().first().cloned())
}

fn is_dark(id: &str, cx: &App) -> bool {
    theme::registry(cx).get(id).is_some_and(|theme| theme.appearance.is_dark())
}

fn current_scheme(cx: &App) -> Scheme {
    let settings = settings::saved(cx);
    if settings.sync_system_theme {
        Scheme::Auto
    } else if is_dark(&settings.theme, cx) {
        Scheme::Dark
    } else {
        Scheme::Light
    }
}

/// Picking light or dark stops following the system and keeps the theme when it already fits,
/// else takes the preferred theme of that appearance (`getColorSchemeUpdates`).
fn set_scheme(scheme: Scheme, cx: &mut App) {
    let current = settings::saved(cx).clone();
    let theme_dark = is_dark(&current.theme, cx);
    settings::update(cx, |settings| match scheme {
        Scheme::Auto => settings.sync_system_theme = true,
        Scheme::Light | Scheme::Dark => {
            let wants_dark = scheme == Scheme::Dark;
            settings.sync_system_theme = false;
            if theme_dark != wants_dark {
                settings.theme = if wants_dark { current.auto_theme_dark.clone() } else { current.auto_theme_light.clone() };
            }
        }
    });
}

/// A small window drawn in a theme's colors: traffic lights, a sidebar, a document.
fn window_sketch(theme: &Theme, glass: bool) -> gpui::Div {
    let colors = &theme.colors;
    let line = |width: f32, color: Hsla| div().w(px(width)).h(px(2.)).rounded_full().bg(color);
    div()
        .flex()
        .flex_col()
        .w(px(60.))
        .h(px(40.))
        .rounded(px(6.))
        .overflow_hidden()
        .when(!glass, |this| this.bg(colors.surface))
        .when(glass, |this| this.bg(colors.surface.opacity(0.35)))
        .shadow(theme.shadows.raised.clone())
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(2.))
                .h(px(10.))
                .px(px(4.))
                .children([colors.terminal[1], colors.terminal[3], colors.terminal[2]].map(|color| div().size(px(4.)).rounded_full().bg(color))),
        )
        .child(
            div()
                .flex()
                .flex_1()
                .min_h_0()
                .gap(px(2.))
                .pr(px(2.))
                .pb(px(2.))
                .child(div().w(px(14.)).flex_none())
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .gap(px(2.))
                        .p(px(4.))
                        .rounded(px(2.))
                        .bg(colors.background)
                        .child(line(20., colors.primary))
                        .child(line(28., colors.muted_foreground))
                        .child(line(16., colors.muted_foreground)),
                ),
        )
}

/// One card: a preview over its name, ringed in the accent while chosen.
fn choice_card(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    preview: impl IntoElement,
    width: f32,
    active: bool,
    on_click: impl Fn(&mut App) + 'static,
    cx: &App,
) -> AnyElement {
    let theme = cx.theme();
    let colors = &theme.colors;
    let wide = width >= 144.;
    div()
        .id(id)
        .flex()
        .flex_col()
        .flex_none()
        .items_center()
        .gap(px(6.))
        .p(px(4.))
        .rounded(metrics::RADIUS_LG)
        .child(
            div()
                .w(px(if wide { 144. } else { 96. }))
                .h(px(if wide { 80. } else { 64. }))
                .rounded(metrics::RADIUS_MD)
                .overflow_hidden()
                .bg(colors.surface)
                .shadow(theme.shadows.raised.clone())
                .when(active, |this| this.border_2().border_color(colors.primary))
                .child(preview),
        )
        .child(
            div()
                .truncate()
                .text_size(typography::TEXT_SM)
                .text_color(if active { colors.foreground } else { colors.muted_foreground })
                .when(active, |this| this.font_weight(typography::MEDIUM))
                .child(label.into()),
        )
        .on_click(move |_, _, cx| on_click(cx))
        .into_any_element()
}

fn backdrop(cx: &App) -> gpui::Div {
    div().flex().items_center().justify_center().size_full().rounded(metrics::RADIUS_MD).bg(cx.theme().colors.primary)
}

/// A theme at a glance: its text, a prompt in its chrome, its accent, and its ANSI colors.
fn theme_swatch(theme: &Theme) -> gpui::Div {
    let colors = &theme.colors;
    div()
        .rounded(metrics::RADIUS_MD)
        .flex()
        .flex_col()
        .justify_center()
        .gap(px(10.))
        .size_full()
        .px(px(14.))
        .bg(colors.background)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(div().text_size(typography::TEXT_LG).text_color(colors.foreground).child("Aa"))
                .child(
                    div()
                        .px(px(4.))
                        .rounded(px(3.))
                        .bg(colors.surface)
                        .font_family(typography::MONO_FONT)
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.foreground)
                        .child("~/"),
                )
                .child(div().w(px(6.)).h(px(14.)).rounded_full().bg(theme.own_primary())),
        )
        .child(
            div()
                .flex()
                .gap(px(2.))
                .children(colors.terminal[..7].iter().map(|color| div().size(px(10.)).rounded_full().border_1().border_color(colors.border).bg(*color))),
        )
}

fn field(label: &'static str, content: impl IntoElement, cx: &App) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .min_w_0()
        .gap(px(8.))
        .child(div().text_size(typography::TEXT_SM).text_color(cx.theme().colors.muted_foreground).child(label))
        .child(content)
        .into_any_element()
}

fn theme_row(label: &'static str, key: &'static str, dark: bool, cx: &App) -> AnyElement {
    let value = settings::saved(cx).get(key).and_then(|value| value.as_str().map(str::to_string)).unwrap_or_default();
    let cards: Vec<AnyElement> = theme::registry(cx)
        .themes()
        .iter()
        .filter(|theme| theme.appearance.is_dark() == dark)
        .map(|theme| {
            let id = theme.id.clone();
            choice_card(
                SharedString::from(format!("theme-card-{key}-{id}")),
                theme.name.clone(),
                theme_swatch(theme),
                144.,
                theme.id == value,
                move |cx| {
                    let id = id.clone();
                    settings::update(cx, |settings| {
                        settings.set(key, id.into()).ok();
                    });
                },
                cx,
            )
        })
        .collect();
    field(
        label,
        div()
            .id(SharedString::from(format!("theme-row-{key}")))
            .flex()
            .gap(px(12.))
            .pb(px(6.))
            .overflow_x_scroll()
            .children(cards),
        cx,
    )
}

/// The block at the top of Appearance > Theme.
pub fn theme_choices(cx: &App) -> AnyElement {
    let settings = settings::saved(cx).clone();
    let light = theme_or_fallback(&settings.auto_theme_light, false, cx);
    let dark = theme_or_fallback(&settings.auto_theme_dark, true, cx);
    let current = if settings.sync_system_theme { None } else { theme::registry(cx).get(&settings.theme) };
    let (Some(light), Some(dark)) = (light, dark) else { return div().into_any_element() };
    let current = current.unwrap_or_else(|| cx.theme().clone());
    let scheme = current_scheme(cx);

    let split = {
        let (light, dark) = (light.clone(), dark.clone());
        div()
            .relative()
            .w(px(60.))
            .h(px(40.))
            .child(div().absolute().inset_0().child(window_sketch(&light, false)))
            .child(div().absolute().top_0().bottom_0().left(px(30.)).right_0().overflow_hidden().child(
                div().absolute().top_0().left(px(-30.)).child(window_sketch(&dark, false)),
            ))
    };
    let schemes = div()
        .flex()
        .gap(px(12.))
        .child(choice_card("scheme-auto", "Auto", backdrop(cx).child(split), 104., scheme == Scheme::Auto, |cx| set_scheme(Scheme::Auto, cx), cx))
        .child(choice_card("scheme-light", "Light", backdrop(cx).child(window_sketch(&light, false)), 104., scheme == Scheme::Light, |cx| set_scheme(Scheme::Light, cx), cx))
        .child(choice_card("scheme-dark", "Dark", backdrop(cx).child(window_sketch(&dark, false)), 104., scheme == Scheme::Dark, |cx| set_scheme(Scheme::Dark, cx), cx));
    let glass = settings.window_transparency;
    let set_glass = |glass: bool| move |cx: &mut App| settings::update(cx, |settings| settings.window_transparency = glass);
    let styles = div()
        .flex()
        .gap(px(12.))
        .child(choice_card("style-classic", "Classic", backdrop(cx).child(window_sketch(&current, false)), 104., !glass, set_glass(false), cx))
        .child(choice_card("style-glass", "Glass", backdrop(cx).child(window_sketch(&current, true)), 104., glass, set_glass(true), cx));

    let mut rows = vec![
        div()
            .flex()
            .flex_wrap()
            .gap_x(px(32.))
            .gap_y(px(16.))
            .child(field("Color Scheme", schemes, cx))
            .child(field("Interface Style", styles, cx))
            .into_any_element(),
    ];
    if settings.sync_system_theme {
        rows.push(theme_row("Light Theme", "autoThemeLight", false, cx));
        rows.push(theme_row("Dark Theme", "autoThemeDark", true, cx));
    } else {
        rows.push(theme_row("Theme", "theme", is_dark(&settings.theme, cx), cx));
    }
    div().flex().flex_col().gap(px(16.)).px(px(12.)).py(px(12.)).children(rows).into_any_element()
}
