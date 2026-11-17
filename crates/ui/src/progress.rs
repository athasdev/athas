use crate::TooltipExt;
use std::rc::Rc;

use gpui::{
    App, ElementId, Hsla, IntoElement, PathBuilder, RenderOnce, SharedString, Window, canvas, div, point, prelude::*, px,
    relative,
};
use theme::{ActiveTheme, ThemeColors};

use crate::{Tooltip, typography};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ProgressTone {
    Default,
    #[default]
    Accent,
    Success,
    Warning,
    Error,
}

impl ProgressTone {
    fn color(self, colors: &ThemeColors) -> Hsla {
        match self {
            ProgressTone::Default => colors.muted_foreground,
            ProgressTone::Accent => colors.primary,
            ProgressTone::Success => colors.success,
            ProgressTone::Warning => colors.warning,
            ProgressTone::Error => colors.destructive,
        }
    }
}

/// A 4px bar filled to `value` percent (`ui/progress.tsx`), with an optional label and value
/// above it.
#[derive(IntoElement)]
pub struct Progress {
    value: f32,
    tone: ProgressTone,
    label: Option<SharedString>,
    value_label: Option<SharedString>,
}

impl Progress {
    pub fn new(value: f32) -> Self {
        Self { value: value.clamp(0., 100.), tone: ProgressTone::Accent, label: None, value_label: None }
    }

    pub fn tone(mut self, tone: ProgressTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    /// Shows the value at the end of the label row, such as "42%".
    pub fn value_label(mut self, value: impl Into<SharedString>) -> Self {
        self.value_label = Some(value.into());
        self
    }

    pub fn show_percent(self) -> Self {
        let percent = format!("{}%", self.value.round());
        self.value_label(percent)
    }
}

impl RenderOnce for Progress {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let has_header = self.label.is_some() || self.value_label.is_some();
        div()
            .flex()
            .flex_col()
            .w_full()
            .gap(px(8.))
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_SM)
            .when(has_header, |this| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .children(self.label.map(|label| div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(label)))
                        .children(self.value_label.map(|value| div().ml_auto().text_color(colors.muted_foreground).child(value))),
                )
            })
            .child(
                div()
                    .relative()
                    .flex()
                    .items_center()
                    .w_full()
                    .h(px(4.))
                    .overflow_hidden()
                    .rounded_full()
                    .bg(colors.accent)
                    .child(div().h_full().w(relative(self.value / 100.)).rounded_full().bg(self.tone.color(colors))),
            )
    }
}

/// A ring filled to `value` percent, for progress inside a row (`ProgressCircle`).
#[derive(IntoElement)]
pub struct ProgressCircle {
    value: f32,
    tone: ProgressTone,
    size: gpui::Pixels,
}

impl ProgressCircle {
    pub fn new(value: f32) -> Self {
        Self { value: value.clamp(0., 100.), tone: ProgressTone::Accent, size: px(16.) }
    }

    pub fn tone(mut self, tone: ProgressTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn size(mut self, size: gpui::Pixels) -> Self {
        self.size = size;
        self
    }
}

impl RenderOnce for ProgressCircle {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let (track, fill) = (colors.border, self.tone.color(colors));
        let progress = self.value / 100.;
        canvas(
            |_, _, _| {},
            move |bounds, _, window, _| {
                let scale = bounds.size.width / px(28.);
                let center = bounds.center();
                let radius = px(11.5) * scale;
                let stroke = px(2.) * scale;
                let at = |turn: f32| {
                    let angle = turn * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                    point(center.x + radius * angle.cos(), center.y + radius * angle.sin())
                };
                let mut ring = PathBuilder::stroke(stroke);
                ring.move_to(at(0.));
                ring.arc_to(point(radius, radius), px(0.), false, true, at(0.5));
                ring.arc_to(point(radius, radius), px(0.), false, true, at(0.9999));
                ring.close();
                if let Ok(path) = ring.build() {
                    window.paint_path(path, track);
                }
                if progress > 0. {
                    let mut arc = PathBuilder::stroke(stroke);
                    arc.move_to(at(0.));
                    let end = progress.min(0.9999);
                    if end > 0.5 {
                        arc.arc_to(point(radius, radius), px(0.), false, true, at(0.5));
                    }
                    arc.arc_to(point(radius, radius), px(0.), false, true, at(end));
                    if let Ok(path) = arc.build() {
                        window.paint_path(path, fill);
                    }
                }
            },
        )
        .flex_none()
        .size(self.size)
    }
}

/// One choice on a `ToggleGroup`.
#[derive(Clone, Debug, PartialEq)]
pub struct ToggleOption {
    pub value: SharedString,
    pub label: SharedString,
    pub icon: Option<crate::IconName>,
    pub disabled: bool,
}

impl ToggleOption {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self { value: value.into(), label: label.into(), icon: None, disabled: false }
    }

    pub fn icon(mut self, icon: crate::IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

type ToggleHandler = Rc<dyn Fn(Vec<SharedString>, &mut Window, &mut App)>;

/// A segmented control (`ui/toggle-group.tsx`): a recessed track with the chosen items raised out
/// of it. One choice by default, several with `multiple`.
#[derive(IntoElement)]
pub struct ToggleGroup {
    id: ElementId,
    options: Vec<ToggleOption>,
    selected: Vec<SharedString>,
    multiple: bool,
    icon_only: bool,
    full_width: bool,
    disabled: bool,
    on_change: Option<ToggleHandler>,
}

impl ToggleGroup {
    pub fn new(id: impl Into<ElementId>, options: Vec<ToggleOption>, value: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            options,
            selected: vec![value.into()],
            multiple: false,
            icon_only: false,
            full_width: false,
            disabled: false,
            on_change: None,
        }
    }

    pub fn multiple(id: impl Into<ElementId>, options: Vec<ToggleOption>, values: Vec<SharedString>) -> Self {
        Self { selected: values, multiple: true, ..Self::new(id, options, "") }
    }

    pub fn icon_only(mut self) -> Self {
        self.icon_only = true;
        self
    }

    pub fn full_width(mut self) -> Self {
        self.full_width = true;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// Called with the one chosen value.
    pub fn on_change(mut self, handler: impl Fn(SharedString, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(move |values: Vec<SharedString>, window, cx| {
            if let Some(value) = values.into_iter().next() {
                handler(value, window, cx);
            }
        }));
        self
    }

    /// Called with every chosen value, for a `multiple` group.
    pub fn on_change_multiple(mut self, handler: impl Fn(Vec<SharedString>, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for ToggleGroup {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let item_height = crate::metrics::CHROME_CONTROL - px(2.);
        let items = self.options.into_iter().enumerate().map(|(index, option)| {
            let pressed = self.selected.contains(&option.value);
            let disabled = self.disabled || option.disabled;
            let handler = self.on_change.clone();
            let selected = self.selected.clone();
            let multiple = self.multiple;
            let value = option.value.clone();
            let label = option.label.clone();
            let text = if pressed { colors.foreground } else { colors.muted_foreground };
            div()
                .id(index)
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .gap(px(4.))
                .min_h(item_height)
                .rounded_full()
                .text_color(text)
                .map(|this| if self.icon_only { this.size(item_height) } else { this.px(px(12.)) })
                .when(self.full_width, |this| this.flex_1().min_w_0())
                .when(pressed, |this| this.bg(colors.segment_knob).shadow(theme.shadows.raised_inset.clone()))
                .when(disabled, |this| this.opacity(0.5))
                .children(option.icon.map(|icon| crate::Icon::new(icon).size(crate::IconSize::XSmall).color(text)))
                .when(!self.icon_only, |this| this.child(option.label.clone()))
                .when(self.icon_only, |this| this.anchored_tooltip(move || Tooltip::new(label.clone())))
                .when_some(handler.filter(|_| !disabled), |this, handler| {
                    this.on_click(move |_, window, cx| {
                        let next = if multiple {
                            let mut next = selected.clone();
                            if let Some(position) = next.iter().position(|item| *item == value) {
                                next.remove(position);
                            } else {
                                next.push(value.clone());
                            }
                            next
                        } else if selected.contains(&value) {
                            return;
                        } else {
                            vec![value.clone()]
                        };
                        handler(next, window, cx);
                    })
                })
        });
        div()
            .id(self.id)
            .flex()
            .flex_wrap()
            .items_stretch()
            .self_start()
            .gap(px(2.))
            .p(px(2.))
            .max_w_full()
            .rounded_full()
            .bg(colors.segment_track)
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_SM)
            .font_weight(typography::MEDIUM)
            .when(self.full_width, |this| this.w_full())
            .children(items)
    }
}
