//! Quoting a passage of the transcript back to the agent.
//!
//! Selecting text in a message raises a small card over the selection with Copy and Quote.
//! Quote opens a reply field in the same card: what is written there goes to the composer with
//! the passage as one attachment, so the next prompt says which part of the answer it is about
//! instead of leaving the agent to guess from "that bit above".

use gpui::{App, Entity, Focusable as _, Pixels, Point, prelude::*};
use theme::ActiveTheme as _;
use ui::{Button, ButtonSize, ButtonVariant, IconName, TextInput, scale::px};

use crate::session_view::SessionView;

/// The card over a transcript selection.
pub(crate) struct QuoteCard {
    /// Where the pointer let go of the selection; the card hangs above it.
    pub(crate) position: Point<Pixels>,
    /// The passage, read off the drawn runs when the card opened: the selection may be cleared
    /// while the card is still up.
    pub(crate) text: String,
    /// The reply field, once Quote has been pressed. `None` while the card is only Copy/Quote.
    pub(crate) reply: Option<Entity<TextInput>>,
}

/// How much of the passage the card shows before it scrolls.
const PREVIEW_HEIGHT: f32 = 96.;
const CARD_WIDTH: f32 = 320.;

impl SessionView {
    /// Opens the card for the selection, if there is one worth quoting. Called as the mouse
    /// comes up, with the position it came up at.
    pub(crate) fn open_quote_card(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let text = self
            .text_selection
            .as_ref()
            .filter(|selection| !selection.is_empty())
            .map(|selection| crate::selection::selected_text(&self.drawn_runs.borrow(), selection))
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty());
        let Some(text) = text else {
            self.quote_card = None;
            return;
        };
        self.quote_card = Some(QuoteCard { position, text, reply: None });
        cx.notify();
    }

    pub(crate) fn close_quote_card(&mut self, cx: &mut Context<Self>) {
        if self.quote_card.take().is_some() {
            cx.notify();
        }
    }

    /// Copy in the card: the passage, as Cmd-C would have taken it.
    fn copy_quote(&mut self, cx: &mut Context<Self>) {
        let Some(card) = &self.quote_card else { return };
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(card.text.clone()));
        self.text_selection = None;
        self.close_quote_card(cx);
    }

    /// Quote in the card: the reply field opens under the passage, focused.
    fn start_quote_reply(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let Some(card) = &mut self.quote_card else { return };
        if card.reply.is_some() {
            return;
        }
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder("Reply to this").appearance(ui::InputAppearance::Bare));
        let input_focus = input.read(cx).focus_handle(cx);
        window.focus(&input_focus, cx);
        // `subscribe_in`, not `subscribe`: sending needs a window to hand the composer the focus.
        let confirmed = cx.subscribe_in(&input, window, |this, _, event: &ui::TextInputEvent, window, cx| match event {
            ui::TextInputEvent::Confirmed => this.send_quote(window, cx),
            ui::TextInputEvent::Cancelled => this.close_quote_card(cx),
            _ => {}
        });
        self.quote_subscription = Some(confirmed);
        card.reply = Some(input);
        cx.notify();
    }

    /// The passage and the reply go to the composer as one attachment.
    pub(crate) fn send_quote(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let Some(card) = &self.quote_card else { return };
        let reply = card.reply.as_ref().map(|input| input.read(cx).text().to_string()).unwrap_or_default();
        let reference = crate::context_refs::ContextRef::Quote { text: card.text.clone(), reply: reply.clone() };
        let label = reference.label(self.info.cwd.as_deref());
        let content = crate::context_refs::format_quote(&card.text, &reply);
        self.add_attachment(crate::mentions::Attachment::Context { reference, label, content });
        self.text_selection = None;
        self.quote_subscription = None;
        self.close_quote_card(cx);
        let focus = self.composer.read(cx).focus_handle(cx);
        window.focus(&focus, cx);
    }

    /// The card itself, drawn over everything else in the session.
    pub(crate) fn render_quote_card(&self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        let card = self.quote_card.as_ref()?;
        let colors = &cx.theme().colors;
        let quoted = crate::quote::quote_block(&card.text, cx);
        let body = match &card.reply {
            // Only Copy and Quote until Quote is pressed: a reply field nobody asked for would
            // cover the passage it is about.
            None => gpui::div()
                .flex()
                .items_center()
                .gap(px(2.))
                .p(px(2.))
                .child(
                    Button::new("quote-copy", "Copy")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .leading_icon(IconName::Copy)
                        .on_click(cx.listener(|this, _, _, cx| this.copy_quote(cx))),
                )
                .child(
                    Button::new("quote-start", "Quote")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .leading_icon(IconName::ChatBubbleText)
                        .on_click(cx.listener(|this, _, window, cx| this.start_quote_reply(window, cx))),
                )
                .into_any_element(),
            Some(input) => gpui::div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .p(px(8.))
                .child(quoted)
                .child(
                    gpui::div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(gpui::div().flex_1().min_w_0().child(input.clone()))
                        .child(
                            Button::new("quote-send", "Add")
                                .variant(ButtonVariant::Accent)
                                .size(ButtonSize::Small)
                                .shortcut("↩")
                                .on_click(cx.listener(|this, _, window, cx| this.send_quote(window, cx))),
                        ),
                )
                .into_any_element(),
        };
        Some(
            ui::anchored_overlay(
                card.position,
                gpui::Anchor::BottomLeft,
                px(8.),
                gpui::div()
                    .w(px(CARD_WIDTH))
                    .bg(colors.surface)
                    .border_1()
                    .border_color(colors.border)
                    .rounded(ui::metrics::radius_lg())
                    .shadow(cx.theme().shadows.popover.clone())
                    .child(body),
            )
            .into_any_element(),
        )
    }
}

/// A passage drawn as a quote: the rule down its left, the text muted beside it. The composer's
/// attachment and the card share it, so what the card previews is what the composer shows.
pub(crate) fn quote_block(text: &str, cx: &App) -> gpui::Stateful<gpui::Div> {
    let colors = &cx.theme().colors;
    gpui::div()
        .id("quote-block")
        .max_h(px(PREVIEW_HEIGHT))
        .overflow_y_scroll()
        .border_l_2()
        .border_color(colors.border_strong)
        .pl(px(8.))
        .text_size(ui::typography::text_sm())
        .line_height(gpui::relative(ui::typography::LEADING_ROW))
        .text_color(colors.muted_foreground)
        .child(text.to_string())
}
