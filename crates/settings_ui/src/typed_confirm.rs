//! A button that asks for a word before it acts (`typed-confirm-action.tsx`): "Reset" turns into
//! a field that wants "yes", then the button runs.

use gpui::{Context, Entity, EventEmitter, SharedString, Subscription, Window, div, prelude::*, px};
use ui::{Button, ButtonTone, ButtonVariant, TextInput, TextInputEvent};

pub struct Confirmed;

pub struct TypedConfirm {
    id: SharedString,
    label: SharedString,
    danger: bool,
    confirm_word: &'static str,
    input: Entity<TextInput>,
    confirming: bool,
    _subscription: Subscription,
}

impl EventEmitter<Confirmed> for TypedConfirm {}

impl TypedConfirm {
    pub fn new(id: impl Into<SharedString>, label: impl Into<SharedString>, danger: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let confirm_word = "yes";
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder(format!("Type '{confirm_word}'")));
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Changed(_) => cx.notify(),
            TextInputEvent::Cancelled => this.cancel(window, cx),
            TextInputEvent::Confirmed if this.typed(cx) => this.confirm(window, cx),
            _ => {}
        });
        Self { id: id.into(), label: label.into(), danger, confirm_word, input, confirming: false, _subscription: subscription }
    }

    fn typed(&self, cx: &gpui::App) -> bool {
        self.input.read(cx).text().trim().eq_ignore_ascii_case(self.confirm_word)
    }

    fn cancel(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.confirming = false;
        self.input.update(cx, |input, cx| input.set_text("", cx));
        cx.notify();
    }

    fn confirm(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        cx.emit(Confirmed);
        self.cancel(window, cx);
    }
}

impl Render for TypedConfirm {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let tone = if self.danger { ButtonTone::Danger } else { ButtonTone::Default };
        if !self.confirming {
            return Button::new(self.id.clone(), self.label.clone())
                .variant(ButtonVariant::Outline)
                .tone(tone)
                .on_click(cx.listener(|this, _, window, cx| {
                    this.confirming = true;
                    this.input.update(cx, |input, cx| input.focus(window, cx));
                    cx.notify();
                }))
                .into_any_element();
        }
        let typed = self.typed(cx);
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(div().w(px(112.)).child(self.input.clone()))
            .child(
                Button::new(SharedString::from(format!("{}-confirm", self.id)), self.label.clone())
                    .variant(ButtonVariant::Outline)
                    .tone(tone)
                    .disabled(!typed)
                    .on_click(cx.listener(|this, _, window, cx| this.confirm(window, cx))),
            )
            .child(
                Button::new(SharedString::from(format!("{}-cancel", self.id)), "Cancel")
                    .variant(ButtonVariant::Ghost)
                    .on_click(cx.listener(|this, _, window, cx| this.cancel(window, cx))),
            )
            .into_any_element()
    }
}
