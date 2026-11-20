//! A password field: typed text shows as dots and never reaches the clipboard.

use gpui::{App, ClipboardItem, Context, EventEmitter, FocusHandle, Focusable, KeyDownEvent, SharedString, Window, div, prelude::*, px};
use theme::ActiveTheme;
use ui::typography;

pub enum SecretEvent {
    Confirmed,
    Cancelled,
}

pub struct SecretInput {
    focus_handle: FocusHandle,
    text: String,
    placeholder: SharedString,
}

impl EventEmitter<SecretEvent> for SecretInput {}

impl Focusable for SecretInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl SecretInput {
    pub fn new(placeholder: impl Into<SharedString>, cx: &mut Context<Self>) -> Self {
        Self { focus_handle: cx.focus_handle(), text: String::new(), placeholder: placeholder.into() }
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.text.clear();
        cx.notify();
    }

    fn key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let command = keystroke.modifiers.platform || keystroke.modifiers.control;
        match keystroke.key.as_str() {
            "enter" => cx.emit(SecretEvent::Confirmed),
            "escape" => cx.emit(SecretEvent::Cancelled),
            "backspace" if command || keystroke.modifiers.alt => self.text.clear(),
            "backspace" => {
                self.text.pop();
            }
            "v" if command => {
                if let Some(text) = cx.read_from_clipboard().and_then(|item: ClipboardItem| item.text()) {
                    self.text.push_str(text.trim_end_matches(['\n', '\r']));
                }
            }
            "tab" => return,
            _ if !command => match keystroke.key_char.as_ref() {
                Some(chars) if !chars.chars().any(char::is_control) => self.text.push_str(chars),
                _ => return,
            },
            _ => return,
        }
        cx.stop_propagation();
        cx.notify();
    }
}

impl Render for SecretInput {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let focused = self.focus_handle.is_focused(window);
        let dots: SharedString = "•".repeat(self.text.chars().count()).into();
        div()
            .id("secret-input")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::key_down))
            .on_click(cx.listener(|this, _, window, cx| window.focus(&this.focus_handle, cx)))
            .flex()
            .items_center()
            .h(px(28.))
            .px(px(12.))
            .rounded_full()
            .bg(theme.colors.raised)
            .shadow(theme.shadows.raised.clone())
            .when(focused, |this| this.border_1().border_color(theme.colors.focus_ring).px(px(11.)))
            .text_size(typography::TEXT_SM)
            .child(if self.text.is_empty() {
                div().text_color(theme.colors.subtle_foreground).child(self.placeholder.clone())
            } else {
                div().text_color(theme.colors.foreground).child(dots)
            })
            .when(focused, |this| this.child(div().ml(px(1.)).w(px(1.5)).h(px(14.)).bg(theme.colors.cursor)))
    }
}
