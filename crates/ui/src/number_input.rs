use crate::scale::px;
use gpui::{App, Context, Entity, EventEmitter, FocusHandle, Focusable, KeyDownEvent, Subscription, Window, div, prelude::*,};

use crate::{Button, IconName, TextInput, TextInputEvent};

#[derive(Clone, Debug, PartialEq)]
pub enum NumberInputEvent {
    Changed(f64),
}

/// A number field between minus and plus buttons (`ui/number-input.tsx`). Up and Down step it;
/// typed values apply on Return or when the field loses focus, clamped to the range.
pub struct NumberInput {
    input: Entity<TextInput>,
    value: f64,
    min: Option<f64>,
    max: Option<f64>,
    step: f64,
    disabled: bool,
    full_width: bool,
    _subscription: Subscription,
}

impl EventEmitter<NumberInputEvent> for NumberInput {}

impl Focusable for NumberInput {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl NumberInput {
    pub fn new(value: f64, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| TextInput::new(window, cx).centered());
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, _, cx| match event {
            TextInputEvent::Confirmed | TextInputEvent::Blurred => this.commit(cx),
            TextInputEvent::Cancelled => this.show(cx),
            _ => {}
        });
        let mut this = Self { input, value, min: None, max: None, step: 1., disabled: false, full_width: false, _subscription: subscription };
        this.show(cx);
        this
    }

    pub fn range(mut self, min: Option<f64>, max: Option<f64>, cx: &mut Context<Self>) -> Self {
        self.min = min;
        self.max = max;
        self.value = self.clamp(self.value);
        self.show(cx);
        self
    }

    pub fn step(mut self, step: f64, cx: &mut Context<Self>) -> Self {
        self.step = if step > 0. { step } else { 1. };
        self.show(cx);
        self
    }

    /// Fills its parent, such as a settings row's shared number width.
    pub fn full_width(mut self) -> Self {
        self.full_width = true;
        self
    }

    pub fn value(&self) -> f64 {
        self.value
    }

    pub fn set_value(&mut self, value: f64, cx: &mut Context<Self>) {
        self.value = self.clamp(value);
        self.show(cx);
    }

    pub fn set_disabled(&mut self, disabled: bool, cx: &mut Context<Self>) {
        self.disabled = disabled;
        self.input.update(cx, |input, cx| input.set_disabled(disabled, cx));
        cx.notify();
    }

    fn precision(&self) -> usize {
        let step = self.step.to_string();
        step.split_once('.').map_or(0, |(_, fraction)| fraction.len())
    }

    fn clamp(&self, value: f64) -> f64 {
        let value = self.min.map_or(value, |min| value.max(min));
        self.max.map_or(value, |max| value.min(max))
    }

    fn format(&self, value: f64) -> String {
        let text = format!("{value:.*}", self.precision());
        if text.contains('.') { text.trim_end_matches('0').trim_end_matches('.').to_string() } else { text }
    }

    fn show(&mut self, cx: &mut Context<Self>) {
        let text = self.format(self.value);
        self.input.update(cx, |input, cx| {
            if input.text().as_ref() != text {
                input.set_text(text, cx);
            }
        });
        cx.notify();
    }

    fn apply(&mut self, value: f64, cx: &mut Context<Self>) {
        let value = self.clamp(value);
        let changed = value != self.value;
        self.value = value;
        self.show(cx);
        if changed {
            cx.emit(NumberInputEvent::Changed(value));
        }
    }

    fn commit(&mut self, cx: &mut Context<Self>) {
        let typed = self.input.read(cx).text().trim().parse::<f64>().ok().filter(|value| value.is_finite());
        match typed {
            Some(value) => self.apply(value, cx),
            None => self.show(cx),
        }
    }

    fn nudge(&mut self, steps: f64, cx: &mut Context<Self>) {
        if self.disabled {
            return;
        }
        self.commit(cx);
        self.apply(self.value + self.step * steps, cx);
    }
}

impl Render for NumberInput {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let at_min = self.min.is_some_and(|min| self.value <= min);
        let at_max = self.max.is_some_and(|max| self.value >= max);
        div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(4.))
            .when(self.full_width, |this| this.w_full())
            .when(self.disabled, |this| this.opacity(0.5))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                let steps = match event.keystroke.key.as_str() {
                    "up" => 1.,
                    "down" => -1.,
                    "pageup" => 10.,
                    "pagedown" => -10.,
                    _ => return,
                };
                cx.stop_propagation();
                this.nudge(steps, cx);
            }))
            .child(
                Button::icon("decrement", IconName::Minus)
                    .tooltip("Decrease value")
                    .disabled(self.disabled || at_min)
                    .on_click(cx.listener(|this, _, _, cx| this.nudge(-1., cx))),
            )
            .child(div().flex_1().min_w(px(44.)).child(self.input.clone()))
            .child(
                Button::icon("increment", IconName::Plus)
                    .tooltip("Increase value")
                    .disabled(self.disabled || at_max)
                    .on_click(cx.listener(|this, _, _, cx| this.nudge(1., cx))),
            )
    }
}
