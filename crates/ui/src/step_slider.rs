use crate::TooltipExt;
use std::rc::Rc;

use crate::scale::px;
use gpui::{App, ElementId, FocusHandle, IntoElement, KeyDownEvent, RenderOnce, SharedString, Window, div, prelude::*,};
use theme::ActiveTheme;

use crate::{Tooltip, typography};

#[derive(Clone, Debug, PartialEq)]
pub struct StepSliderStep {
    pub value: SharedString,
    pub label: SharedString,
    pub description: Option<SharedString>,
}

impl StepSliderStep {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self { value: value.into(), label: label.into(), description: None }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }
}

struct StepSliderState {
    hovered: Option<SharedString>,
    focus_handle: FocusHandle,
}

type ChangeHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

/// An ordered scale picked by its steps (`ui/step-slider.tsx`): every step up to the chosen one
/// fills, in a tone that deepens toward the top. `auto_step` sits apart before the track for a
/// choice that is not a point on the scale. Left and Right move along the scale.
#[derive(IntoElement)]
pub struct StepSlider {
    id: ElementId,
    label: SharedString,
    steps: Vec<StepSliderStep>,
    value: SharedString,
    auto_step: Option<StepSliderStep>,
    marked: Option<(SharedString, SharedString)>,
    on_change: Option<ChangeHandler>,
}

impl StepSlider {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, steps: Vec<StepSliderStep>, value: impl Into<SharedString>) -> Self {
        Self { id: id.into(), label: label.into(), steps, value: value.into(), auto_step: None, marked: None, on_change: None }
    }

    pub fn auto_step(mut self, step: StepSliderStep) -> Self {
        self.auto_step = Some(step);
        self
    }

    /// Calls out a step next to its label, such as the model's default.
    pub fn marked(mut self, value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        self.marked = Some((value.into(), label.into()));
        self
    }

    pub fn on_change(mut self, handler: impl Fn(SharedString, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for StepSlider {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let state = window.use_keyed_state(self.id.clone(), cx, |_, cx| StepSliderState { hovered: None, focus_handle: cx.focus_handle() });
        let (hovered, focus_handle) = {
            let state = state.read(cx);
            (state.hovered.clone(), state.focus_handle.clone())
        };
        let current = self.steps.iter().position(|step| step.value == self.value);
        let is_auto = self.auto_step.as_ref().is_some_and(|auto| auto.value == self.value || current.is_none());
        let current_step = if is_auto { self.auto_step.clone() } else { self.steps.get(current.unwrap_or(0)).cloned() };
        let shown = hovered
            .as_ref()
            .and_then(|hovered| {
                self.auto_step
                    .iter()
                    .chain(self.steps.iter())
                    .find(|step| &step.value == hovered)
                    .cloned()
            })
            .or(current_step);
        let shown_label = shown.map(|step| match &self.marked {
            Some((value, label)) if *value == step.value => SharedString::from(format!("{} · {label}", step.label)),
            _ => step.label,
        });
        let count = self.steps.len();
        let tone = |index: usize| {
            let level = if count <= 1 { 4 } else { 1 + ((3 * index) as f32 / (count - 1) as f32).round() as usize };
            let alpha = [0.4, 0.6, 0.8, 1.0][level.clamp(1, 4) - 1];
            colors.primary.opacity(alpha)
        };
        let set_hover = |value: Option<SharedString>| {
            let state = state.clone();
            move |hovered: &bool, _: &mut Window, cx: &mut App| {
                state.update(cx, |state, cx| {
                    if *hovered {
                        state.hovered = value.clone();
                    } else if state.hovered == value {
                        state.hovered = None;
                    }
                    cx.notify();
                });
            }
        };

        let steps_for_keys = self.steps.clone();
        let value = self.value.clone();
        let key_handler = self.on_change.clone();
        let auto = self.auto_step.as_ref().map(|auto| {
            let handler = self.on_change.clone();
            let chosen = auto.value.clone();
            div()
                .id("auto-step")
                .flex()
                .flex_none()
                .items_center()
                .h(px(20.))
                .px(px(6.))
                .rounded(crate::metrics::radius())
                .text_size(typography::text_caption())
                .map(|this| {
                    if is_auto {
                        this.bg(colors.primary_soft).text_color(colors.primary)
                    } else {
                        this.text_color(colors.muted_foreground).hover(|style| style.bg(colors.accent).text_color(colors.foreground))
                    }
                })
                .on_hover(set_hover(Some(auto.value.clone())))
                .when_some(auto.description.clone(), |this, description| this.anchored_tooltip(move || Tooltip::new(description.clone())))
                .when_some(handler, |this, handler| this.on_click(move |_, window, cx| handler(chosen.clone(), window, cx)))
                .child(auto.label.clone())
        });
        let steps = self.steps.iter().enumerate().map(|(index, step)| {
            let filled = !is_auto && current.is_some_and(|current| index <= current);
            let handler = self.on_change.clone();
            let chosen = step.value.clone();
            let group = SharedString::from(format!("step-{index}"));
            div()
                .id(index)
                .group(group.clone())
                .flex()
                .flex_1()
                .min_w_0()
                .h_full()
                .items_center()
                .on_hover(set_hover(Some(step.value.clone())))
                .when_some(step.description.clone(), |this, description| this.anchored_tooltip(move || Tooltip::new(description.clone())))
                .when_some(handler, |this, handler| this.on_click(move |_, window, cx| handler(chosen.clone(), window, cx)))
                .child(
                    div()
                        .h(px(6.))
                        .w_full()
                        .rounded_full()
                        .map(|this| {
                            if filled {
                                this.bg(tone(index))
                            } else {
                                let strong = colors.border_strong;
                                this.bg(colors.border).group_hover(group, move |style| style.bg(strong))
                            }
                        }),
                )
        });

        div()
            .id(self.id)
            .track_focus(&focus_handle)
            .on_key_down(move |event: &KeyDownEvent, window, cx| {
                let delta: isize = match event.keystroke.key.as_str() {
                    "left" => -1,
                    "right" => 1,
                    _ => return,
                };
                cx.stop_propagation();
                let from = match steps_for_keys.iter().position(|step| step.value == value) {
                    Some(index) if !is_auto => index as isize,
                    _ if delta > 0 => -1,
                    _ => steps_for_keys.len() as isize,
                };
                let next = (from + delta).clamp(0, steps_for_keys.len() as isize - 1) as usize;
                if let (Some(step), Some(handler)) = (steps_for_keys.get(next), &key_handler)
                    && step.value != value
                {
                    handler(step.value.clone(), window, cx);
                }
            })
            .flex()
            .flex_col()
            .gap(px(4.))
            .px(px(8.))
            .pt(px(6.))
            .pb(px(4.))
            .font_family(typography::ui_font())
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .text_size(typography::text_sm())
                    .child(div().text_color(colors.foreground).child(self.label))
                    .children(shown_label.map(|label| div().truncate().text_color(colors.muted_foreground).child(label))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .children(auto)
                    .child(div().id("steps").flex().flex_1().items_center().h(px(20.)).gap(px(2.)).children(steps)),
            )
    }
}
