//! The find and replace bar, floating at the editor's top right as the web workbench's find
//! widget did.

use std::ops::Range;

use gpui::{Context, Entity, IntoElement, Subscription, Window, div, prelude::*, px};
use regex::Regex;
use theme::ActiveTheme;
use ui::{Button, ButtonSize, IconName, InputAppearance, TextInput, TextInputEvent, typography};

use crate::{
    Editor,
    search::{self, SearchOptions},
};

/// The find bar's fields and the matches of its query.
pub struct FindState {
    pub query: Entity<TextInput>,
    pub replace: Entity<TextInput>,
    pub replace_open: bool,
    pub options: SearchOptions,
    pub regex: Option<Regex>,
    pub error: bool,
    pub matches: Vec<Range<usize>>,
    pub capped: bool,
    /// The buffer version the matches were found in.
    pub version: usize,
    _subscriptions: Vec<Subscription>,
}

impl FindState {
    pub fn new(window: &mut Window, cx: &mut Context<Editor>) -> Self {
        let query = cx.new(|cx| TextInput::new(window, cx).placeholder("Find").appearance(InputAppearance::Bare));
        let replace = cx.new(|cx| TextInput::new(window, cx).placeholder("Replace").appearance(InputAppearance::Bare));
        let subscriptions = vec![
            cx.subscribe_in(&query, window, |editor, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => editor.find_query_changed(cx),
                TextInputEvent::Confirmed => editor.find_step(true, window, cx),
                TextInputEvent::Cancelled => editor.close_find(window, cx),
                _ => {}
            }),
            cx.subscribe_in(&replace, window, |editor, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Confirmed => editor.replace_next(window, cx),
                TextInputEvent::Cancelled => editor.close_find(window, cx),
                _ => {}
            }),
        ];
        Self {
            query,
            replace,
            replace_open: false,
            options: SearchOptions::default(),
            regex: None,
            error: false,
            matches: Vec::new(),
            capped: false,
            version: usize::MAX,
            _subscriptions: subscriptions,
        }
    }

    /// Recompiles the query and finds its matches in `text`.
    pub fn refresh(&mut self, text: &str, version: usize, cx: &Context<Editor>) {
        let query = self.query.read(cx).text().to_string();
        self.version = version;
        self.error = false;
        self.regex = None;
        self.matches.clear();
        self.capped = false;
        match search::compile(&query, &self.options) {
            Some(Ok(regex)) => {
                let (matches, capped) = search::find_all(&regex, text);
                self.matches = matches;
                self.capped = capped;
                self.regex = Some(regex);
            }
            Some(Err(_)) => self.error = true,
            None => {}
        }
    }

    /// The index of the match a selection covers exactly.
    pub fn index_of(&self, range: &Range<usize>) -> Option<usize> {
        self.matches.binary_search_by_key(&range.start, |found| found.start).ok().filter(|index| self.matches[*index] == *range)
    }

    /// The matches that intersect `range`, by binary search.
    pub fn visible(&self, range: Range<usize>) -> &[Range<usize>] {
        let start = self.matches.partition_point(|found| found.end <= range.start);
        let end = self.matches.partition_point(|found| found.start < range.end);
        &self.matches[start..end.max(start)]
    }
}

impl Editor {
    pub(crate) fn render_find_bar(&mut self, cx: &mut Context<Self>) -> Option<impl IntoElement + use<>> {
        let find = self.find.as_ref()?;
        if !self.find_open {
            return None;
        }
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let newest = self.document.newest_selection().range();
        let current = find.index_of(&newest);
        let count = if find.error {
            "Invalid".to_string()
        } else if find.query.read(cx).text().is_empty() {
            String::new()
        } else if find.matches.is_empty() {
            "No results".to_string()
        } else {
            let total = if find.capped { format!("{}+", find.matches.len()) } else { find.matches.len().to_string() };
            match current {
                Some(index) => format!("{} of {total}", index + 1),
                None => format!("{total} found"),
            }
        };
        let options = find.options.clone();
        let replace_open = find.replace_open;
        let entity = cx.entity();
        let toggle = |id: &'static str, glyph: &'static str, tooltip: &'static str, active: bool, change: fn(&mut SearchOptions)| {
            let entity = entity.clone();
            Button::new(id, "")
                .icon_only()
                .size(ButtonSize::XSmall)
                .leading(div().font_family(typography::MONO_FONT).text_size(px(11.)).child(glyph))
                .active(active)
                .tooltip(tooltip)
                .on_click(move |_, _, cx| entity.update(cx, |editor, cx| editor.toggle_find_option(change, cx)))
        };
        let icon_button = |id: &'static str, icon: IconName, tooltip: &'static str, action: fn(&mut Editor, &mut Window, &mut Context<Editor>)| {
            let entity = entity.clone();
            Button::icon(id, icon)
                .size(ButtonSize::XSmall)
                .tooltip(tooltip)
                .on_click(move |_, window, cx| entity.update(cx, |editor, cx| action(editor, window, cx)))
        };
        let field = |input: Entity<TextInput>| {
            div()
                .flex()
                .items_center()
                .h(px(24.))
                .w(px(220.))
                .px(px(8.))
                .rounded(ui::metrics::RADIUS_MD)
                .bg(colors.field)
                .child(input)
        };

        let find_row = div()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(icon_button(
                "find-toggle-replace",
                if replace_open { IconName::ChevronDown } else { IconName::ChevronRight },
                "Toggle Replace",
                |editor, window, cx| editor.toggle_replace(window, cx),
            ))
            .child(
                field(find.query.clone())
                    .when(find.error, |this| this.text_color(colors.destructive)),
            )
            .child(toggle("find-case", "Aa", "Match Case", options.case_sensitive, |options| options.case_sensitive = !options.case_sensitive))
            .child(toggle("find-word", "ab", "Match Whole Word", options.whole_word, |options| options.whole_word = !options.whole_word))
            .child(toggle("find-regex", ".*", "Use Regular Expression", options.regex, |options| options.regex = !options.regex))
            .child(
                div()
                    .min_w(px(64.))
                    .px(px(4.))
                    .text_size(typography::TEXT_CAPTION)
                    .text_color(if find.error || (find.matches.is_empty() && !count.is_empty()) { colors.destructive } else { colors.subtle_foreground })
                    .child(count),
            )
            .child(icon_button("find-previous", IconName::ArrowUp, "Previous Match", |editor, window, cx| editor.find_step(false, window, cx)))
            .child(icon_button("find-next", IconName::ArrowDown, "Next Match", |editor, window, cx| editor.find_step(true, window, cx)))
            .child(icon_button("find-close", IconName::X, "Close", |editor, window, cx| editor.close_find(window, cx)));

        let replace_row = replace_open.then(|| {
            div()
                .flex()
                .items_center()
                .gap(px(4.))
                .pl(px(24.))
                .child(field(find.replace.clone()))
                .child(
                    Button::new("replace-one", "Replace").size(ButtonSize::XSmall).on_click({
                        let entity = entity.clone();
                        move |_, window, cx| entity.update(cx, |editor, cx| editor.replace_next(window, cx))
                    }),
                )
                .child(
                    Button::new("replace-all", "All").size(ButtonSize::XSmall).tooltip("Replace All").on_click({
                        let entity = entity.clone();
                        move |_, window, cx| entity.update(cx, |editor, cx| editor.replace_all(window, cx))
                    }),
                )
        });

        Some(
            div()
                .id("editor-find")
                .key_context("EditorFind")
                .absolute()
                .top(px(8.))
                .right(px(20.))
                .flex()
                .flex_col()
                .gap(px(4.))
                .p(px(4.))
                .rounded(ui::metrics::ISLAND_RADIUS)
                .bg(colors.overlay)
                .shadow(theme.shadows.popover.clone())
                .text_color(colors.foreground)
                .text_size(typography::TEXT_SM)
                .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_action(cx.listener(|editor, _: &crate::FindPrevious, window, cx| editor.find_step(false, window, cx)))
                .on_action(cx.listener(|editor, _: &crate::ReplaceAll, window, cx| editor.replace_all(window, cx)))
                .child(find_row)
                .children(replace_row),
        )
    }
}
