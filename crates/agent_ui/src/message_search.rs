//! Searching a session's messages (`utils/message-search.ts`, `stores/chat-message-search.store.ts`,
//! the search row of `chat-header.tsx`): Cmd-F in the session opens a field; every occurrence in
//! user and agent messages counts, Enter and Shift-Enter step through them, Escape closes it.

use gpui::{
    AnyElement, AppContext as _, ClickEvent, Context, Entity, Focusable as _, IntoElement, KeyBinding, ParentElement, Styled, Subscription, Window, actions, div,
    prelude::*, px,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, IconName, TextInput, TextInputEvent, typography};

use crate::{SessionView, thread::Entry};

actions!(agent, [SearchMessages, PreviousMessageMatch]);

pub(crate) fn bind_keys(cx: &mut gpui::App) {
    let search = if cfg!(target_os = "macos") { "cmd-f" } else { "ctrl-f" };
    cx.bind_keys([KeyBinding::new(search, SearchMessages, Some("AgentSession")), KeyBinding::new("shift-enter", PreviousMessageMatch, Some("MessageSearch"))]);
}

pub(crate) struct MessageSearch {
    pub input: Entity<TextInput>,
    /// The entry of each occurrence, in order.
    pub matches: Vec<usize>,
    pub active: usize,
    _subscription: Subscription,
}

/// The entry index of every occurrence of `query` in user and agent messages, case folded.
pub fn matches(entries: &[Entry], query: &str) -> Vec<usize> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    entries
        .iter()
        .enumerate()
        .flat_map(|(index, entry)| {
            let text = match entry {
                Entry::User(message) => message.text.to_lowercase(),
                Entry::Agent(message) => crate::follow_ups::extract(&message.text).0.to_lowercase(),
                _ => String::new(),
            };
            std::iter::repeat_n(index, text.matches(query.as_str()).count())
        })
        .collect()
}

impl SessionView {
    pub(crate) fn toggle_message_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.message_search.is_some() {
            self.close_message_search(window, cx);
            return;
        }
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder("Search messages").leading_icon(IconName::Search));
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Changed(query) => {
                let found = matches(&this.transcript.entries, query);
                if let Some(search) = &mut this.message_search {
                    search.matches = found;
                    search.active = 0;
                }
                this.reveal_message_match(cx);
            }
            TextInputEvent::Confirmed => this.step_message_match(1, cx),
            TextInputEvent::Cancelled => this.close_message_search(window, cx),
            _ => {}
        });
        window.focus(&input.focus_handle(cx), cx);
        self.message_search = Some(MessageSearch { input, matches: Vec::new(), active: 0, _subscription: subscription });
        cx.notify();
    }

    fn close_message_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let previous = self.message_search.take().map(|search| search.matches);
        for index in previous.unwrap_or_default() {
            self.entry_changed(index);
        }
        self.composer.update(cx, |composer, cx| composer.focus(window, cx));
        cx.notify();
    }

    pub(crate) fn step_message_match(&mut self, step: isize, cx: &mut Context<Self>) {
        let Some(search) = &mut self.message_search else { return };
        if search.matches.is_empty() {
            return;
        }
        let count = search.matches.len() as isize;
        search.active = (search.active as isize + step).rem_euclid(count) as usize;
        self.reveal_message_match(cx);
    }

    fn reveal_message_match(&mut self, cx: &mut Context<Self>) {
        if let Some(index) = self.message_search.as_ref().and_then(|search| search.matches.get(search.active).copied()) {
            self.list.scroll_to_reveal_item(index);
        }
        for index in 0..self.transcript.entries.len() {
            self.entry_changed(index);
        }
        cx.notify();
    }

    /// Whether `index` holds the occurrence in front, and whether it holds any.
    pub(crate) fn message_match_state(&self, index: usize) -> (bool, bool) {
        let Some(search) = &self.message_search else { return (false, false) };
        (search.matches.get(search.active) == Some(&index), search.matches.contains(&index))
    }

    pub(crate) fn render_message_search(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let search = self.message_search.as_ref()?;
        let colors = cx.theme().colors.clone();
        let count = if search.matches.is_empty() { "No results".to_string() } else { format!("{} of {}", search.active + 1, search.matches.len()) };
        Some(
            div()
                .key_context("MessageSearch")
                .on_action(cx.listener(|this, _: &PreviousMessageMatch, _, cx| this.step_message_match(-1, cx)))
                .flex_none()
                .flex()
                .items_center()
                .gap(px(6.))
                .px(px(12.))
                .py(px(6.))
                .border_b_1()
                .border_color(colors.border)
                .child(div().flex_1().child(search.input.clone()))
                .child(div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(count))
                .child(
                    Button::icon("search-previous", IconName::ChevronUp)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .tooltip("Previous match")
                        .shortcut("⇧↩")
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.step_message_match(-1, cx))),
                )
                .child(
                    Button::icon("search-next", IconName::ChevronDown)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .tooltip("Next match")
                        .shortcut("↩")
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.step_message_match(1, cx))),
                )
                .child(
                    Button::icon("search-close", IconName::X)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .tooltip("Close")
                        .shortcut("⎋")
                        .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.close_message_search(window, cx))),
                )
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::{AgentMessage, UserMessage};

    #[test]
    fn every_occurrence_counts() {
        let entries = vec![
            Entry::User(UserMessage { text: "Fix the Layout, then the layout store".into(), ..Default::default() }),
            Entry::Agent(AgentMessage { message_id: None, text: "Layout done".into(), ..Default::default() }),
        ];
        assert_eq!(matches(&entries, "layout"), vec![0, 0, 1]);
        assert!(matches(&entries, "  ").is_empty());
    }
}
