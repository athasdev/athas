//! The editable Markdown field Athas writes in: the text styled as it is typed, a formatting bar
//! over a selection, `/` block commands and an insert-block menu. One field for every surface
//! that writes markdown -- a GitHub comment, a release note, a block of a markdown file in the
//! preview.
//!
//! Ported from Athas's `github-markdown-editor.tsx` and `github-markdown-editor-controls.tsx`.

use std::ops::Range;

use gpui::{
    Anchor, App, ClickEvent, Context, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, KeyDownEvent, Pixels, Point, Render, SharedString,
    Subscription, Window, anchored, deferred, div, point, prelude::*,
};
use theme::{ActiveTheme, Theme, ThemeColors};
use ui::scale::px;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, MenuEntry, MenuItem, OpenMenu, TextArea, TextAreaEvent, TextAreaVariant, metrics, typography};

use crate::rich::{self, BlockCommand};

/// Where a menu opens under the control that was clicked.
fn below(event: &ClickEvent) -> Point<Pixels> {
    let position = event.position();
    point(position.x + px(8.), position.y + px(8.))
}

#[derive(Clone, Debug, PartialEq)]
pub enum FieldEvent {
    Changed,
    /// Cmd-Return.
    Submit,
    /// Escape.
    Cancel,
}

/// The blocks the slash menu of Athas's rich editor inserts, as Markdown.
const BLOCKS: [(&str, IconName, &str); 10] = [
    ("Heading 1", IconName::Text, "# "),
    ("Heading 2", IconName::Text, "## "),
    ("Heading 3", IconName::Text, "### "),
    ("Quote", IconName::ChatBubbleText, "> "),
    ("Bulleted list", IconName::List, "- "),
    ("Numbered list", IconName::List, "1. "),
    ("Task list", IconName::ListChecks, "- [ ] "),
    ("Code block", IconName::CodeBlock, "```\n\n```"),
    ("Divider", IconName::Minus, "\n---\n"),
    ("Table", IconName::Table, "| Column | Column |\n| --- | --- |\n|  |  |\n"),
];

/// Where a block's Markdown goes: on a line of its own.
pub(crate) fn block_insertion(text: &str, cursor: usize, snippet: &str) -> String {
    let at_line_start = cursor == 0 || text[..cursor.min(text.len())].ends_with('\n');
    if at_line_start { snippet.to_string() } else { format!("\n{snippet}") }
}

/// A Markdown field that shows the page's styling as it is typed: headings sized, bold, italic,
/// code and links drawn in place, their markers dimmed.
pub struct MarkdownField {
    id: SharedString,
    area: Entity<TextArea>,
    repository_url: Option<String>,
    open_menu: Option<OpenMenu>,
    disabled: bool,
    /// The `/` typed before the cursor, the commands it matches and the highlighted one.
    slash: Option<SlashMenu>,
    _subscriptions: Vec<Subscription>,
}

struct SlashMenu {
    range: std::ops::Range<usize>,
    commands: Vec<&'static rich::CommandDefinition>,
    selected: usize,
}

impl EventEmitter<FieldEvent> for MarkdownField {}

impl Focusable for MarkdownField {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.area.focus_handle(cx)
    }
}

impl MarkdownField {
    pub fn new(id: impl Into<SharedString>, placeholder: &str, min_rows: usize, repository_url: Option<String>, cx: &mut Context<Self>) -> Self {
        let area = cx.new(|cx| {
            TextArea::new(cx)
                .auto_size(min_rows, 18)
                .variant(TextAreaVariant::Ghost)
                .placeholder(placeholder.to_string())
                .highlighter(|text, cx| rich::highlights(text, &cx.theme().colors))
                .line_scale(rich::line_scale)
        });
        let subscriptions = vec![
            cx.subscribe(&area, |this, _, event: &TextAreaEvent, cx| {
                match event {
                    TextAreaEvent::Changed => this.update_slash(cx),
                    TextAreaEvent::Cancelled if this.slash.take().is_some() => {
                        cx.notify();
                        return;
                    }
                    _ => {}
                }
                cx.emit(match event {
                    TextAreaEvent::Changed => FieldEvent::Changed,
                    TextAreaEvent::Submit => FieldEvent::Submit,
                    TextAreaEvent::Cancelled => FieldEvent::Cancel,
                })
            }),
            // The formatting bar follows the selection.
            cx.observe(&area, |_, _, cx| cx.notify()),
        ];
        Self { id: id.into(), area, repository_url, open_menu: None, disabled: false, slash: None, _subscriptions: subscriptions }
    }

    pub fn text(&self, cx: &App) -> String {
        self.area.read(cx).text().to_string()
    }

    pub fn set_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.area.update(cx, |area, cx| area.set_text(text, cx));
        cx.notify();
    }

    pub fn set_placeholder(&mut self, placeholder: &str, cx: &mut Context<Self>) {
        self.area.update(cx, |area, cx| area.set_placeholder(placeholder.to_string(), cx));
    }

    pub fn set_disabled(&mut self, disabled: bool, cx: &mut Context<Self>) {
        self.disabled = disabled;
        self.area.update(cx, |area, cx| area.set_disabled(disabled, cx));
        cx.notify();
    }

    pub fn set_repository_url(&mut self, url: Option<String>) {
        self.repository_url = url;
    }

    fn insert_block(&mut self, snippet: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        self.area.update(cx, |area, cx| {
            let cursor = area.cursor();
            let text = block_insertion(area.text(), cursor, snippet);
            area.replace_range(cursor..cursor, &text, cx);
            area.focus(window, cx);
        });
        cx.notify();
    }

    fn update_slash(&mut self, cx: &mut Context<Self>) {
        let area = self.area.read(cx);
        let selection = area.selected_range();
        self.slash = (selection.is_empty())
            .then(|| rich::slash_query(area.text(), selection.end))
            .flatten()
            .map(|(range, query)| SlashMenu { range, commands: rich::filter_commands(&query), selected: 0 });
        cx.notify();
    }

    fn run_slash(&mut self, command: BlockCommand, window: &mut Window, cx: &mut Context<Self>) {
        let Some(slash) = self.slash.take() else { return };
        self.area.update(cx, |area, cx| {
            let (text, cursor) = rich::apply_command(area.text(), slash.range, command);
            area.set_text(text, cx);
            area.select_range(cursor..cursor, cx);
            area.focus(window, cx);
        });
        self.slash = None;
        cx.notify();
    }

    /// Bold, italic, strikethrough, code or a link over the selection.
    fn format(&mut self, marker: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        self.area.update(cx, |area, cx| {
            let selection = area.selected_range();
            if selection.is_empty() {
                return;
            }
            let (text, selection) = if marker == "link" { rich::make_link(area.text(), selection) } else { rich::toggle_wrap(area.text(), selection, marker) };
            area.set_text(text, cx);
            area.select_range(selection, cx);
            area.focus(window, cx);
        });
    }

    /// The slash menu's keys and the formatting shortcuts, before the field sees them.
    fn on_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let keys = &event.keystroke;
        let command = keys.modifiers.platform || (keys.modifiers.control && cfg!(not(target_os = "macos")));
        if let Some(slash) = self.slash.as_mut().filter(|slash| !slash.commands.is_empty()) {
            let handled = match keys.key.as_str() {
                "down" => {
                    slash.selected = (slash.selected + 1) % slash.commands.len();
                    true
                }
                "up" => {
                    slash.selected = (slash.selected + slash.commands.len() - 1) % slash.commands.len();
                    true
                }
                "enter" | "tab" if !command => {
                    let chosen = slash.commands[slash.selected].command;
                    self.run_slash(chosen, window, cx);
                    true
                }
                "escape" => {
                    self.slash = None;
                    true
                }
                _ => false,
            };
            if handled {
                cx.stop_propagation();
                cx.notify();
                return;
            }
        }
        if !command || keys.modifiers.alt {
            return;
        }
        let marker = match (keys.key.as_str(), keys.modifiers.shift) {
            ("b", false) => "**",
            ("i", false) => "_",
            ("e", false) => "`",
            ("x", true) => "~~",
            ("k", false) => "link",
            _ => return,
        };
        if !self.area.read(cx).selected_range().is_empty() {
            cx.stop_propagation();
            self.format(marker, window, cx);
        }
    }

    fn render_format_bar(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        if self.disabled || self.area.read(cx).selected_range().is_empty() {
            return None;
        }
        let button = |id: &str, label: &'static str, tooltip: &'static str, marker: &'static str, cx: &mut Context<Self>| {
            Button::new(SharedString::from(format!("{}-format-{id}", self.id)), label)
                .size(ButtonSize::XSmall)
                .variant(ButtonVariant::Ghost)
                .tooltip(tooltip)
                .on_click(cx.listener(move |this, _, window, cx| this.format(marker, window, cx)))
        };
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(1.))
                .child(button("bold", "B", "Bold (⌘B)", "**", cx))
                .child(button("italic", "I", "Italic (⌘I)", "_", cx))
                .child(button("strike", "S", "Strikethrough (⇧⌘X)", "~~", cx))
                .child(
                    Button::icon(SharedString::from(format!("{}-format-code", self.id)), IconName::Code)
                        .size(ButtonSize::XSmall)
                        .tooltip("Code (⌘E)")
                        .on_click(cx.listener(|this, _, window, cx| this.format("`", window, cx))),
                )
                .child(
                    Button::icon(SharedString::from(format!("{}-format-link", self.id)), IconName::Link)
                        .size(ButtonSize::XSmall)
                        .tooltip("Link (⌘K)")
                        .on_click(cx.listener(|this, _, window, cx| this.format("link", window, cx))),
                ),
        )
    }

    /// The `/` commands, grouped as the original lists them.
    fn render_slash_menu(&self, colors: &ThemeColors, theme: &Theme, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let slash = self.slash.as_ref()?;
        let mut rows: Vec<gpui::AnyElement> = Vec::new();
        if slash.commands.is_empty() {
            rows.push(div().px(px(8.)).py(px(6.)).text_color(colors.subtle_foreground).child("no matching blocks").into_any_element());
        }
        let mut group = "";
        for (index, definition) in slash.commands.iter().enumerate() {
            if definition.group != group {
                group = definition.group;
                rows.push(div().px(px(8.)).pt(px(6.)).pb(px(2.)).text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(group).into_any_element());
            }
            let selected = index == slash.selected;
            let command = definition.command;
            rows.push(
                div()
                    .id(SharedString::from(format!("{}-slash-{index}", self.id)))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(metrics::list_row())
                    .px(px(8.))
                    .rounded(metrics::radius_md())
                    .text_color(if selected { colors.primary_foreground } else { colors.foreground })
                    .when(selected, |this| this.bg(colors.primary))
                    .on_mouse_move(cx.listener(move |this, _, _, cx| {
                        if let Some(slash) = this.slash.as_mut().filter(|slash| slash.selected != index) {
                            slash.selected = index;
                            cx.notify();
                        }
                    }))
                    .on_click(cx.listener(move |this, _, window, cx| this.run_slash(command, window, cx)))
                    .child(Icon::new(definition.icon).size(IconSize::Small).color(if selected { colors.primary_foreground } else { colors.muted_foreground }))
                    .child(div().flex_1().child(definition.label))
                    .when(selected, |this| this.child(ui::Kbd::new("↵").on_primary(true)))
                    .into_any_element(),
            );
        }
        Some(deferred(
            anchored().child(
                div()
                    .id(SharedString::from(format!("{}-slash-menu", self.id)))
                    .occlude()
                    .mt(px(4.))
                    .w(px(240.))
                    .max_h(px(320.))
                    .overflow_y_scroll()
                    .p(px(4.))
                    .rounded(metrics::radius_lg())
                    .bg(colors.overlay)
                    .shadow(theme.shadows.popover.clone())
                    .text_size(typography::text_sm())
                    .text_color(colors.foreground)
                    .children(rows),
            ),
        )
        .with_priority(1))
    }

    fn blocks_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let this = cx.entity().downgrade();
        BLOCKS
            .iter()
            .map(|(label, icon, snippet)| {
                let this = this.clone();
                MenuItem::new(*label)
                    .icon(*icon)
                    .on_select(move |window, cx| {
                        this.update(cx, |this, cx| this.insert_block(snippet, window, cx)).ok();
                    })
                    .into()
            })
            .collect()
    }
}

impl Render for MarkdownField {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let header = div()
            .flex()
            .items_center()
            .gap(px(2.))
            .child(div().flex_1())
            .children(self.render_format_bar(cx))
            .child(
                Button::icon(SharedString::from(format!("{}-blocks", self.id)), IconName::Plus)
                    .size(ButtonSize::XSmall)
                    .tooltip("Insert block")
                    .disabled(self.disabled)
                    .active(is_menu_open(&self.open_menu, "blocks"))
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let entries = this.blocks_menu(cx);
                        this.show_menu("blocks", entries, below(event), Anchor::TopRight, window, cx);
                    })),
            );
        let body = div()
            .min_h(px(80.))
            .capture_key_down(cx.listener(Self::on_key))
            .child(self.area.clone())
            .children(self.render_slash_menu(colors, &theme, cx));
        div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .min_w_0()
            .px(px(12.))
            .pt(px(4.))
            .pb(px(10.))
            .rounded(metrics::radius_lg())
            .bg(colors.raised)
            .shadow(theme.shadows.raised.clone())
            .child(header)
            .child(body)
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}


/// Whether the field's menu `key` is the one open.
fn is_menu_open(menu: &Option<OpenMenu>, key: &str) -> bool {
    menu.as_ref().is_some_and(|menu| menu.key.as_ref() == key)
}

impl MarkdownField {
    /// Opens `entries`, or closes the menu if the same one is already open.
    fn show_menu(&mut self, key: &str, entries: Vec<MenuEntry>, position: Point<Pixels>, anchor: Anchor, window: &mut Window, cx: &mut Context<Self>) {
        if is_menu_open(&self.open_menu, key) {
            self.open_menu = None;
            cx.notify();
            return;
        }
        self.open_menu = Some(OpenMenu::new(key.to_string(), entries, position, anchor, window, cx, |this: &mut Self, _| this.open_menu = None));
        cx.notify();
    }

    /// The field without the raised card around it: the markdown preview edits a block where it
    /// sits, and a card there would read as a dialog over the page.
    pub fn bare(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        div()
            .relative()
            .min_w_0()
            .capture_key_down(cx.listener(Self::on_key))
            .child(self.area.clone())
            .children(self.render_slash_menu(colors, &theme, cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }

    /// The formatting bar, for a caller drawing its own header.
    pub fn format_bar(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        self.render_format_bar(cx)
    }

    /// Puts the caret at the end of the text and takes focus.
    pub fn focus_at_end(&self, window: &mut Window, cx: &mut Context<Self>) {
        self.area.update(cx, |area, cx| {
            let end = area.text().len();
            area.select_range(end..end, cx);
            area.focus(window, cx);
        });
    }

    pub fn select_range(&self, range: Range<usize>, cx: &mut Context<Self>) {
        self.area.update(cx, |area, cx| area.select_range(range, cx));
    }

    /// The field underneath, for a caller that styles it.
    pub fn area(&self) -> &Entity<TextArea> {
        &self.area
    }
}
