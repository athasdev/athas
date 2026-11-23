//! The appearance picker at the top of Appearance > Theme, also the welcome's first step
//! (`appearance/appearance-choices.tsx`, `theme-previews.tsx`): the color scheme and interface
//! style as two segmented controls, and the themes as a tight grid of swatches, each drawn in the
//! theme's own editor colors.

use ui::scale::px;
use gpui::{AnyElement, App, HighlightStyle, SharedString, StyledText, div, prelude::*,};
use theme::{ActiveTheme, Theme};
use ui::{Icon, IconName, IconSize, Tabs, TabsTrigger, metrics, typography};

#[derive(Clone, Copy, PartialEq)]
enum Scheme {
    Auto,
    Light,
    Dark,
}

impl Scheme {
    fn value(self) -> &'static str {
        match self {
            Scheme::Auto => "auto",
            Scheme::Light => "light",
            Scheme::Dark => "dark",
        }
    }

    fn from_value(value: &str) -> Option<Self> {
        match value {
            "auto" => Some(Scheme::Auto),
            "light" => Some(Scheme::Light),
            "dark" => Some(Scheme::Dark),
            _ => None,
        }
    }
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

/// Width of one theme swatch; the grid wraps as many as fit.
const SWATCH_WIDTH: f32 = 124.;

/// A line of code in a theme's syntax colors: `let a = f("x");`.
fn code_sample(theme: &Theme) -> StyledText {
    let colors = &theme.colors;
    let syntax = |key: &str| colors.syntax.get(key).copied().unwrap_or(colors.foreground);
    let parts: [(&str, gpui::Hsla); 8] = [
        ("let", syntax("keyword")),
        (" ", colors.foreground),
        ("a", syntax("variable")),
        (" = ", syntax("operator")),
        ("f", syntax("function")),
        ("(", syntax("punctuation")),
        ("\"x\"", syntax("string")),
        (");", syntax("punctuation")),
    ];
    let mut text = String::new();
    let mut highlights = Vec::new();
    for (part, color) in parts {
        let start = text.len();
        text.push_str(part);
        highlights.push((start..text.len(), HighlightStyle { color: Some(color), ..Default::default() }));
    }
    StyledText::new(text).with_highlights(highlights)
}

/// One theme: its name and a line of code on its editor background. Chosen, it gets a thin ring
/// in the accent, set off by a gap, and a check in the theme's own accent.
fn theme_swatch(theme: &Theme, key: &'static str, active: bool, cx: &App) -> AnyElement {
    let app = &cx.theme().colors;
    let colors = &theme.colors;
    let id = theme.id.clone();
    let hover_border = app.border_strong;
    div()
        .id(SharedString::from(format!("theme-swatch-{key}-{}", theme.id)))
        .flex_none()
        .w(px(SWATCH_WIDTH))
        .p(px(2.))
        .rounded(metrics::radius_lg() + px(2.))
        .border_1()
        .border_color(if active { app.primary } else { gpui::transparent_black() })
        .when(!active, |this| this.hover(move |style| style.border_color(hover_border)))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .px(px(8.))
                .py(px(6.))
                .rounded(metrics::radius_lg())
                .overflow_hidden()
                .bg(colors.background)
                .border_1()
                .border_color(app.border)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(4.))
                        .h(px(14.))
                        .text_size(typography::text_caption())
                        .text_color(colors.foreground)
                        .when(active, |this| this.font_weight(typography::MEDIUM))
                        .child(div().min_w_0().truncate().child(theme.name.clone()))
                        .when(active, |this| this.child(Icon::new(IconName::Check).size(IconSize::Custom(px(12.))).color(theme.own_primary()))),
                )
                .child(
                    div()
                        .h(px(14.))
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .font_family(typography::MONO_FONT)
                        .text_size(px(10.5))
                        .child(code_sample(theme)),
                ),
        )
        .on_click(move |_, _, cx| {
            let id = id.clone();
            settings::update(cx, |settings| {
                settings.set(key, id.into()).ok();
            });
        })
        .into_any_element()
}

/// The swatches of one appearance, under a caption when both are shown.
fn theme_grid(caption: Option<(IconName, &'static str)>, key: &'static str, dark: bool, cx: &App) -> AnyElement {
    let value = settings::saved(cx).get(key).and_then(|value| value.as_str().map(str::to_string)).unwrap_or_default();
    let muted = cx.theme().colors.muted_foreground;
    let swatches: Vec<AnyElement> = theme::registry(cx)
        .themes()
        .iter()
        .filter(|theme| theme.appearance.is_dark() == dark)
        .map(|theme| theme_swatch(theme, key, theme.id == value, cx))
        .collect();
    div()
        .flex()
        .flex_col()
        .gap(px(6.))
        .children(caption.map(|(icon, label)| {
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .px(px(2.))
                .text_size(typography::text_sm())
                .text_color(muted)
                .child(Icon::new(icon).size(IconSize::Custom(px(13.))).color(muted))
                .child(label)
        }))
        .child(div().flex().flex_wrap().gap(px(4.)).children(swatches))
        .into_any_element()
}

/// The block at the top of Appearance > Theme, and the welcome's first step.
pub fn theme_choices(cx: &App) -> AnyElement {
    let settings = settings::saved(cx).clone();
    let scheme = current_scheme(cx);

    let schemes = Tabs::new(
        "appearance-scheme",
        vec![
            TabsTrigger::new(Scheme::Auto.value(), "Auto").icon(IconName::Monitor),
            TabsTrigger::new(Scheme::Light.value(), "Light").icon(IconName::Sun),
            TabsTrigger::new(Scheme::Dark.value(), "Dark").icon(IconName::Moon),
        ],
        scheme.value(),
    )
    // In the sidebar the three schemes are wider than the card: they run onto a second row
    // rather than past its edge.
    .wrap()
    .on_change(|value, _, cx| {
        if let Some(scheme) = Scheme::from_value(value) {
            set_scheme(scheme, cx);
        }
    });
    let styles = Tabs::new(
        "appearance-style",
        vec![TabsTrigger::new("classic", "Classic"), TabsTrigger::new("glass", "Glass")],
        if settings.window_transparency { "glass" } else { "classic" },
    )
    .on_change(|value, _, cx| {
        let glass = value.as_ref() == "glass";
        settings::update(cx, |settings| settings.window_transparency = glass);
    });

    let mut rows = vec![
        div().flex().flex_wrap().items_center().justify_between().gap(px(8.)).child(schemes).child(styles).into_any_element(),
    ];
    if settings.sync_system_theme {
        rows.push(theme_grid(Some((IconName::Sun, "Light")), "autoThemeLight", false, cx));
        rows.push(theme_grid(Some((IconName::Moon, "Dark")), "autoThemeDark", true, cx));
    } else {
        rows.push(theme_grid(None, "theme", is_dark(&settings.theme, cx), cx));
    }
    div().flex().flex_col().gap(px(12.)).px(px(10.)).py(px(12.)).children(rows).into_any_element()
}
