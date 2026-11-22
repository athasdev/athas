//! Find in terminal: the search popover over the terminal's top right corner, with match case,
//! whole word and regex toggles and previous/next (`terminal-search.tsx` on `SearchPopover`).

use alacritty_terminal::{index::Line, term::search::Match};
use ui::scale::px;
use gpui::{App, Context, Entity, Focusable, IntoElement, KeyDownEvent, SharedString, Subscription, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, IconName, TextInput, TextInputEvent, typography};

use crate::{terminal::SearchOptions, view::TerminalView};

pub(crate) struct FindState {
    pub input: Entity<TextInput>,
    pub options: SearchOptions,
    pub matches: Vec<Match>,
    pub active: Option<usize>,
    pub refresh_pending: bool,
    _subscription: Subscription,
}

impl FindState {
    pub fn query(&self, cx: &App) -> SharedString {
        self.input.read(cx).text().clone()
    }

    /// `current/total` as the popover shows it, or nothing before anything is typed.
    pub fn match_label(&self, cx: &App) -> Option<String> {
        if self.query(cx).is_empty() {
            return None;
        }
        Some(match self.active {
            Some(index) if !self.matches.is_empty() => format!("{}/{}", index + 1, self.matches.len()),
            _ => "0/0".into(),
        })
    }
}

impl TerminalView {
    /// Opens the find popover, or focuses it and selects its text when it is open.
    pub fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.find.is_none() {
            let input = cx.new(|cx| TextInput::new(window, cx).placeholder("Find in terminal...").leading_icon(IconName::Search));
            let subscription = cx.subscribe_in(&input, window, |view, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => view.run_search(true, cx),
                TextInputEvent::Confirmed => view.find_step(1, cx),
                TextInputEvent::Cancelled => view.close_find(window, cx),
                _ => {}
            });
            self.find = Some(FindState {
                input,
                options: SearchOptions::default(),
                matches: Vec::new(),
                active: None,
                refresh_pending: false,
                _subscription: subscription,
            });
        }
        if let Some(find) = &self.find {
            let input = find.input.clone();
            input.update(cx, |input, cx| input.select_all_text(cx));
            window.focus(&input.focus_handle(cx), cx);
        }
        cx.notify();
    }

    /// Opens the popover with `query` searched, for headless snapshots.
    pub(crate) fn open_find_with(&mut self, query: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.open_find(window, cx);
        if let Some(find) = &self.find {
            find.input.clone().update(cx, |input, cx| input.set_text(query.to_string(), cx));
        }
        self.run_search(true, cx);
    }

    pub fn close_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.find.take().is_some() {
            self.terminal.clear_selection();
            self.focus(window, cx);
            cx.notify();
        }
    }

    fn toggle_option(&mut self, change: fn(&mut SearchOptions), cx: &mut Context<Self>) {
        let Some(find) = self.find.as_mut() else { return };
        change(&mut find.options);
        self.run_search(true, cx);
    }

    /// Searches again; `incremental` picks the match at or after the current one (or the top of
    /// the view), as the addon's `findNext` with `incremental` does.
    pub(crate) fn run_search(&mut self, incremental: bool, cx: &mut Context<Self>) {
        let Some(find) = self.find.as_mut() else { return };
        let query = find.input.read(cx).text().clone();
        if query.is_empty() {
            find.matches.clear();
            find.active = None;
            self.terminal.clear_selection();
            cx.notify();
            return;
        }
        let previous = find.active.and_then(|index| find.matches.get(index)).map(|found| *found.start());
        let matches = self.terminal.search(&query, find.options).unwrap_or_default();
        let active = if matches.is_empty() {
            None
        } else if incremental {
            let from = previous.unwrap_or_else(|| {
                let term = self.terminal.term.lock();
                alacritty_terminal::index::Point::new(Line(-(term.grid().display_offset() as i32)), alacritty_terminal::index::Column(0))
            });
            Some(matches.iter().position(|found| *found.start() >= from).unwrap_or(0))
        } else {
            Some(find.active.unwrap_or(0).min(matches.len() - 1))
        };
        find.matches = matches;
        find.active = active;
        match active.and_then(|index| find.matches.get(index)) {
            Some(found) => self.terminal.reveal_match(found),
            None => self.terminal.clear_selection(),
        }
        cx.notify();
    }

    /// Re-runs the search after new output, keeping the current match.
    pub(crate) fn refresh_search(&mut self, cx: &mut Context<Self>) {
        let Some(find) = self.find.as_mut() else { return };
        let query = find.input.read(cx).text().clone();
        if query.is_empty() {
            return;
        }
        find.matches = self.terminal.search(&query, find.options).unwrap_or_default();
        find.active = find.active.map(|index| index.min(find.matches.len().saturating_sub(1))).filter(|_| !find.matches.is_empty());
        cx.notify();
    }

    /// The next (`1`) or previous (`-1`) match, wrapping around.
    pub fn find_step(&mut self, direction: isize, cx: &mut Context<Self>) {
        let Some(find) = self.find.as_mut() else { return };
        if find.query(cx).is_empty() || find.matches.is_empty() {
            return;
        }
        let count = find.matches.len() as isize;
        let index = match find.active {
            Some(index) => (index as isize + direction + count) % count,
            None if direction > 0 => 0,
            None => count - 1,
        } as usize;
        find.active = Some(index);
        let found = find.matches[index].clone();
        self.terminal.reveal_match(&found);
        cx.notify();
    }

    pub(crate) fn render_find_bar(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> Option<impl IntoElement + use<>> {
        let find = self.find.as_ref()?;
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let has_query = !find.query(cx).is_empty();
        let can_navigate = has_query && !find.matches.is_empty();
        let label = find.match_label(cx);
        let options = find.options;
        let entity = cx.entity();

        let toggle = |id: &'static str, icon: IconName, label: &'static str, active: bool, change: fn(&mut SearchOptions)| {
            let entity = entity.clone();
            Button::icon(id, icon)
                .size(ButtonSize::Small)
                .active(active)
                .tooltip(label)
                .on_click(move |_, _, cx| entity.update(cx, |view, cx| view.toggle_option(change, cx)))
        };
        let step = |id: &'static str, icon: IconName, label: &'static str, direction: isize| {
            let entity = entity.clone();
            Button::icon(id, icon)
                .size(ButtonSize::Small)
                .tooltip(label)
                .disabled(!can_navigate)
                .on_click(move |_, _, cx| entity.update(cx, |view, cx| view.find_step(direction, cx)))
        };

        let input = find.input.clone();
        let clear = has_query.then(|| {
            let input = input.clone();
            Button::icon("terminal-find-clear", IconName::X).size(ButtonSize::XSmall).tooltip("Clear search").on_click(move |_, window, cx| {
                input.update(cx, |input, cx| input.set_text("", cx));
                window.focus(&input.focus_handle(cx), cx);
            })
        });

        Some(
            div()
                .id("terminal-find")
                .absolute()
                .top(px(8.))
                .right(px(8.))
                .w(px(320.))
                .p(px(8.))
                .flex()
                .flex_col()
                .gap(px(6.))
                .rounded(ui::metrics::radius_lg())
                .bg(colors.overlay)
                .shadow(theme.shadows.popover.clone())
                .text_color(colors.foreground)
                .text_size(typography::text_sm())
                .cursor_default()
                .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_mouse_down(gpui::MouseButton::Right, |_, _, cx| cx.stop_propagation())
                .on_key_down(cx.listener(|view, event: &KeyDownEvent, _, cx| {
                    let modifiers = &event.keystroke.modifiers;
                    if event.keystroke.key == "enter" && modifiers.shift && !modifiers.platform && !modifiers.control {
                        view.find_step(-1, cx);
                        cx.stop_propagation();
                    }
                }))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(div().relative().flex().items_center().flex_1().min_w_0().child(input).children(
                            clear.map(|clear| div().absolute().right(px(4.)).top_0().bottom_0().flex().items_center().child(clear)),
                        ))
                        .children(label.map(|label| div().flex_none().text_color(colors.subtle_foreground).child(label)))
                        .child(Button::icon("terminal-find-close", IconName::X).size(ButtonSize::Small).tooltip("Close search").on_click({
                            let entity = entity.clone();
                            move |_, window, cx| entity.update(cx, |view, cx| view.close_find(window, cx))
                        })),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .child(toggle("terminal-find-case", IconName::CaseSensitive, "Match case", options.case_sensitive, |options| {
                                    options.case_sensitive = !options.case_sensitive
                                }))
                                .child(toggle("terminal-find-word", IconName::Text, "Match whole word", options.whole_word, |options| {
                                    options.whole_word = !options.whole_word
                                }))
                                .child(toggle("terminal-find-regex", IconName::BracketsCurly, "Use regular expression", options.regex, |options| {
                                    options.regex = !options.regex
                                })),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .child(step("terminal-find-previous", IconName::ChevronUp, "Previous match", -1))
                                .child(step("terminal-find-next", IconName::ChevronDown, "Next match", 1)),
                        ),
                ),
        )
    }
}
