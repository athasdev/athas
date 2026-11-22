//! What shows while something loads: `ui/spinner.tsx`, `ui/skeleton.tsx`, `ui/shimmer.tsx` and
//! `ui/thinking-orb.tsx`.

use std::time::Duration;

use crate::scale::px;
use gpui::{
    Animation, AnimationExt as _, App, ElementId, Hsla, HighlightStyle, IntoElement, PathBuilder, Pixels, RenderOnce, SharedString, StyleRefinement,
    StyledText, Window, canvas, div, point, prelude::*,
};
use theme::ActiveTheme;

use crate::typography;

fn arc_point(center: gpui::Point<Pixels>, radius: Pixels, turn: f32) -> gpui::Point<Pixels> {
    let angle = turn * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
    point(center.x + radius * angle.cos(), center.y + radius * angle.sin())
}

/// A ring with one quarter open, turning once a second (`Spinner`); with `show_label` the label
/// follows it.
#[derive(IntoElement)]
pub struct Spinner {
    id: ElementId,
    label: SharedString,
    show_label: bool,
    compact: bool,
    color: Option<Hsla>,
}

impl Spinner {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), label: "Loading".into(), show_label: false, compact: false, color: None }
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = label.into();
        self
    }

    pub fn show_label(mut self) -> Self {
        self.show_label = true;
        self
    }

    /// 12px instead of 16px.
    pub fn compact(mut self) -> Self {
        self.compact = true;
        self
    }

    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }
}

impl RenderOnce for Spinner {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let color = self.color.unwrap_or(if self.show_label { colors.muted_foreground } else { colors.foreground });
        let size = if self.compact { px(12.) } else { px(16.) };
        let ring = div().flex_none().size(size).with_animation(self.id.clone(), Animation::new(Duration::from_secs(1)).repeat(), move |this, delta| {
            this.child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        let stroke = px(2.);
                        let radius = bounds.size.width / 2. - stroke / 2.;
                        let center = bounds.center();
                        let mut arc = PathBuilder::stroke(stroke);
                        arc.move_to(arc_point(center, radius, delta));
                        arc.arc_to(point(radius, radius), px(0.), false, true, arc_point(center, radius, delta + 0.5));
                        arc.arc_to(point(radius, radius), px(0.), false, true, arc_point(center, radius, delta + 0.75));
                        if let Ok(path) = arc.build() {
                            window.paint_path(path, color);
                        }
                    },
                )
                .size_full(),
            )
        });
        if !self.show_label {
            return ring.into_any_element();
        }
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .font_family(typography::UI_FONT)
            .text_size(typography::text_sm())
            .text_color(colors.muted_foreground)
            .child(ring)
            .child(self.label)
            .into_any_element()
    }
}

/// A placeholder block for content still loading, pulsing; size it with the `Styled` methods.
#[derive(IntoElement)]
pub struct Skeleton {
    id: ElementId,
    style: StyleRefinement,
}

impl Skeleton {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), style: StyleRefinement::default() }
    }
}

impl Styled for Skeleton {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Skeleton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let mut block = div().rounded(crate::metrics::radius_md()).bg(cx.theme().colors.accent);
        *block.style() = block.style().clone().refined(self.style);
        if theme::accessibility(cx).reduce_motion {
            return block.into_any_element();
        }
        block.with_animation(
            self.id,
            Animation::new(Duration::from_secs(2)).repeat().with_easing(gpui::pulsating_between(0.5, 1.)),
            |this, delta| this.opacity(delta),
        )
        .into_any_element()
    }
}

/// Text with a bright band sweeping across it (`Shimmer`), for "Thinking…" or a running tool's
/// label. Inactive, it is plain text.
#[derive(IntoElement)]
pub struct Shimmer {
    id: ElementId,
    text: SharedString,
    active: bool,
    duration: Duration,
}

impl Shimmer {
    pub fn new(id: impl Into<ElementId>, text: impl Into<SharedString>) -> Self {
        Self { id: id.into(), text: text.into(), active: true, duration: Duration::from_secs(2) }
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    /// How long one sweep takes.
    pub fn duration(mut self, duration: Duration) -> Self {
        self.duration = duration;
        self
    }
}

/// The bytes the sweep brightens when it is `delta` of the way across `text`.
pub fn shimmer_band(text: &str, delta: f32) -> Option<std::ops::Range<usize>> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    if chars.is_empty() {
        return None;
    }
    let width = (chars.len() / 4).max(2) as f32;
    let center = -width + delta * (chars.len() as f32 + 2. * width);
    let start = (center - width / 2.).max(0.) as usize;
    let end = ((center + width / 2.).max(0.) as usize).min(chars.len());
    if start >= end {
        return None;
    }
    let byte_end = chars.get(end).map(|(index, _)| *index).unwrap_or(text.len());
    Some(chars[start].0..byte_end)
}

impl RenderOnce for Shimmer {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        if !self.active {
            return div().child(self.text).into_any_element();
        }
        if theme::accessibility(cx).reduce_motion {
            return div().text_color(colors.subtle_foreground).child(self.text).into_any_element();
        }
        let bright = colors.foreground;
        let text = self.text;
        div()
            .text_color(colors.subtle_foreground)
            .with_animation(self.id, Animation::new(self.duration).repeat(), move |this, delta| {
                let highlights = shimmer_band(&text, delta).map(|band| (band, HighlightStyle { color: Some(bright), ..Default::default() }));
                this.child(StyledText::new(text.clone()).with_highlights(highlights))
            })
            .into_any_element()
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ThinkingOrbState {
    #[default]
    Idle,
    Working,
}

/// The agent's orb (`ThinkingOrb`): the `thinking-orbs` dotted artwork in the primary colour, a
/// morphing ring while idle and particles on tilted orbits while it works.
#[derive(IntoElement)]
pub struct ThinkingOrb {
    id: ElementId,
    state: ThinkingOrbState,
    size: Pixels,
    color: Option<Hsla>,
}

impl ThinkingOrb {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), state: ThinkingOrbState::Idle, size: px(20.), color: None }
    }

    pub fn state(mut self, state: ThinkingOrbState) -> Self {
        self.state = state;
        self
    }

    pub fn size(mut self, size: Pixels) -> Self {
        self.size = size;
        self
    }

    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }
}

impl RenderOnce for ThinkingOrb {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or(cx.theme().colors.primary);
        let mode = if self.state == ThinkingOrbState::Working { crate::orb::OrbMode::Orbits } else { crate::orb::OrbMode::Ring };
        let preset = crate::orb::preset(mode, f32::from(self.size));
        let still = theme::accessibility(cx).reduce_motion;
        // A long period keeps the time continuous; reduced motion holds the library's still frame.
        const PERIOD: f32 = 3600.;
        div().flex_none().size(self.size).with_animation(self.id, Animation::new(Duration::from_secs_f32(PERIOD)).repeat(), move |this, delta| {
            let t = if still { 0.6 } else { delta * PERIOD } * preset.speed;
            this.child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        let scale = bounds.size.width / px(preset.size);
                        for dot in crate::orb::dots(&preset, t) {
                            let alpha = crate::orb::coverage(&dot);
                            if alpha < 0.02 {
                                continue;
                            }
                            let radius = px(dot.radius.max(0.3)) * scale;
                            let center = bounds.origin + gpui::point(px(dot.x) * scale, px(dot.y) * scale);
                            window.paint_quad(gpui::fill(gpui::Bounds::centered_at(center, gpui::size(radius * 2., radius * 2.)), color.opacity(alpha)).corner_radii(radius));
                        }
                    },
                )
                .size_full(),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::shimmer_band;

    #[test]
    fn the_band_sweeps_from_before_the_start_to_past_the_end() {
        let text = "Thinking about it";
        assert_eq!(shimmer_band(text, 0.), None);
        let middle = shimmer_band(text, 0.5).unwrap();
        assert!(middle.start > 0 && middle.end < text.len());
        assert_eq!(shimmer_band(text, 1.), None);
        assert_eq!(shimmer_band("", 0.5), None);
        assert!(shimmer_band("é😀abc", 0.5).is_some_and(|band| "é😀abc".get(band).is_some()));
    }
}
