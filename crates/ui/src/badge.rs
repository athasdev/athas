use crate::scale::px;
use gpui::{App, Hsla, IntoElement, RenderOnce, Rgba, SharedString, Window, div, prelude::*,};
use theme::{ActiveTheme, ThemeColors};

use crate::{Icon, IconName, IconSize, typography};

/// A status colour shared by badges, markers and alerts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Tone {
    #[default]
    Neutral,
    Accent,
    Success,
    Warning,
    Danger,
    Info,
    Merged,
}

impl Tone {
    /// The tone's (text, soft fill) pair.
    pub fn colors(self, colors: &ThemeColors) -> (Hsla, Hsla) {
        match self {
            Tone::Neutral => (colors.muted_foreground, colors.accent),
            Tone::Accent => (colors.primary, colors.primary_soft),
            Tone::Success => (colors.success, colors.success_soft),
            Tone::Warning => (colors.warning, colors.warning_soft),
            Tone::Danger => (colors.destructive, colors.destructive_soft),
            Tone::Info => (colors.info, colors.info_soft),
            Tone::Merged => (colors.merged, colors.merged_soft),
        }
    }
}

/// A short count or status on a soft pill (`ui/badge.tsx`).
#[derive(IntoElement)]
pub struct Badge {
    label: SharedString,
    tone: Tone,
    icon: Option<IconName>,
    truncate: bool,
    label_color: Option<Hsla>,
}

impl Badge {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self { label: label.into(), tone: Tone::Neutral, icon: None, truncate: false, label_color: None }
    }

    pub fn tone(mut self, tone: Tone) -> Self {
        self.tone = tone;
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// Lets the badge narrow with its row, cutting its label short.
    pub fn truncate(mut self) -> Self {
        self.truncate = true;
        self
    }

    /// A colour the data supplies, such as a GitHub label's; it replaces the tone.
    pub fn label_color(mut self, color: Hsla) -> Self {
        self.label_color = Some(color);
        self
    }
}

impl RenderOnce for Badge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let (text, fill) = match self.label_color {
            Some(color) => {
                let color: Rgba = color.to_rgb();
                (
                    theme::mix(color, 0.62, colors.foreground.to_rgb()).into(),
                    theme::with_alpha(color, 0.16).into(),
                )
            }
            None => self.tone.colors(colors),
        };
        div()
            .flex()
            .items_center()
            .justify_center()
            .gap(px(4.))
            .h(px(20.))
            .max_w_full()
            .px(px(8.))
            .rounded_full()
            .bg(fill)
            .text_color(text)
            .text_size(typography::text_caption())
            .font_weight(typography::MEDIUM)
            .line_height(px(11.))
            .whitespace_nowrap()
            .when(self.truncate, |this| this.min_w_0().flex_shrink(1.).overflow_hidden())
            .when(!self.truncate, |this| this.flex_none())
            .children(self.icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(text)))
            .child(div().when(self.truncate, |this| this.min_w_0().truncate()).child(self.label))
    }
}

/// How a marker sets itself off from what surrounds it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MarkerVariant {
    #[default]
    Default,
    /// Hairlines either side of a centred label.
    Separator,
    /// A hairline under it.
    Border,
}

/// A quiet line in a transcript or a list, such as "Compacted" or "Today" (`ui/marker.tsx`).
#[derive(IntoElement)]
pub struct Marker {
    label: SharedString,
    icon: Option<IconName>,
    icon_tone: Option<Tone>,
    tone: Option<Tone>,
    variant: MarkerVariant,
}

impl Marker {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self { label: label.into(), icon: None, icon_tone: None, tone: None, variant: MarkerVariant::Default }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// Colours the icon alone, while the text stays neutral.
    pub fn icon_tone(mut self, tone: Tone) -> Self {
        self.icon_tone = Some(tone);
        self
    }

    pub fn tone(mut self, tone: Tone) -> Self {
        self.tone = Some(tone);
        self
    }

    pub fn variant(mut self, variant: MarkerVariant) -> Self {
        self.variant = variant;
        self
    }
}

impl RenderOnce for Marker {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let text = self.tone.map_or(colors.subtle_foreground, |tone| tone.colors(colors).0);
        let icon_color = self.icon_tone.map_or(text, |tone| tone.colors(colors).0);
        let line = || div().h(px(1.)).min_w_0().flex_1().bg(colors.divider);
        let separator = self.variant == MarkerVariant::Separator;
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .w_full()
            .min_h(px(16.))
            .text_size(typography::text_sm())
            .text_color(text)
            .when(self.variant == MarkerVariant::Border, |this| this.pb(px(8.)).border_b_1().border_color(colors.divider))
            .when(separator, |this| this.child(line().mr(px(4.))))
            .children(self.icon.map(|icon| {
                div().flex().flex_none().items_center().justify_center().size(px(16.)).child(Icon::new(icon).color(icon_color))
            }))
            .child(div().min_w_0().when(separator, |this| this.flex_none()).child(self.label))
            .when(separator, |this| this.child(line().ml(px(4.))))
    }
}

/// A small dot for a steady state (`ui/status-dot.tsx`).
#[derive(IntoElement)]
pub struct StatusDot {
    color: fn(&ThemeColors) -> Hsla,
}

impl StatusDot {
    /// Something healthy that keeps running.
    pub fn live() -> Self {
        Self { color: |colors| colors.success }
    }

    /// Something new the user has not looked at.
    pub fn unread() -> Self {
        Self { color: |colors| colors.primary }
    }

    /// Something waiting on the user.
    pub fn attention() -> Self {
        Self { color: |colors| colors.warning }
    }

    pub fn error() -> Self {
        Self { color: |colors| colors.destructive }
    }
}

impl RenderOnce for StatusDot {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        div().flex_none().size(px(6.)).rounded_full().bg((self.color)(&cx.theme().colors))
    }
}
