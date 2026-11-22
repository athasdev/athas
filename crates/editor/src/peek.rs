//! The inline references peek (`references-peek.ts`, `references-peek-view.tsx`): under the line
//! it was opened on, every location grouped by file on the right and a read-only preview of the
//! selected one on the left. Arrow keys move through the list, Enter opens the location, Escape
//! closes the peek.

use ui::WithScrollbar;
use std::{
    collections::HashMap,
    ops::Range,
    path::{Path, PathBuf},
    sync::Arc,
};

use ui::scale::px;
use gpui::{
    AnyElement, App, AppContext as _, Context, FocusHandle, Font, Hsla, InteractiveElement as _, IntoElement, KeyBinding, MouseButton, MouseDownEvent,
    ParentElement as _, Pixels, ScrollHandle, SharedString, StatefulInteractiveElement as _, Styled as _, StyledText, Task, TextRun, Window, div,
    prelude::FluentBuilder as _,
};
use lsp_client::{FileLocation, lsp, offset_to_position, position_to_offset};
use theme::{ActiveTheme as _, Theme};
use ui::{Button, ButtonSize, Icon, IconName, IconSize, typography};

use crate::{
    Autoscroll, Cancel, Editor, MenuConfirm, MenuDown, MenuUp, MoveToEnd, MoveToStart,
    buffer::{AppliedEdit, Bias, map_through},
    fs::Loaded,
    lsp::LspEvent,
    syntax::{self, SyntaxKind, SyntaxState},
};

/// The peek's height in editor lines.
pub(crate) const PEEK_ROWS: usize = 14;
fn header_height() -> Pixels { px(28.) }
fn list_width() -> Pixels { px(288.) }
/// Files past this size show in the preview without highlighting.
const MAX_HIGHLIGHTED_FILE: usize = 1024 * 1024;

pub(crate) fn bind_keys(cx: &mut App) {
    let peek = Some("ReferencesPeek");
    cx.bind_keys([
        KeyBinding::new("up", MenuUp, peek),
        KeyBinding::new("down", MenuDown, peek),
        KeyBinding::new("home", MoveToStart, peek),
        KeyBinding::new("end", MoveToEnd, peek),
        KeyBinding::new("enter", MenuConfirm, peek),
        KeyBinding::new("escape", Cancel, peek),
    ]);
}

struct PeekGroup {
    path: PathBuf,
    /// Indices into the entries.
    entries: Range<usize>,
}

/// A file the preview shows, read once per peek.
enum PeekFile {
    Loading,
    Ready(Arc<PeekText>),
    Error,
}

struct PeekText {
    text: String,
    line_starts: Vec<usize>,
    spans: Vec<(Range<usize>, SyntaxKind)>,
}

impl PeekText {
    fn new(path: &Path, text: String) -> Self {
        let mut line_starts = vec![0];
        line_starts.extend(text.match_indices('\n').map(|(index, _)| index + 1));
        let mut spans = Vec::new();
        if text.len() <= MAX_HIGHLIGHTED_FILE {
            let config = syntax::language_for_path(path);
            let rope = ropey::Rope::from_str(&text);
            let mut state = SyntaxState::new(config.clone());
            if let Some(language) = config.ts_language() {
                state.tree = syntax::parse(&language, &rope, None);
            }
            spans = state.highlights(&rope, 0..text.len());
        }
        Self { text, line_starts, spans }
    }

    fn line_count(&self) -> usize {
        self.line_starts.len()
    }

    fn line_range(&self, line: usize) -> Range<usize> {
        let start = self.line_starts[line];
        let end = self.line_starts.get(line + 1).map(|next| next - 1).unwrap_or(self.text.len());
        start..self.text[start..end].trim_end_matches('\r').len() + start
    }

    fn line(&self, line: usize) -> &str {
        if line >= self.line_count() {
            return "";
        }
        &self.text[self.line_range(line)]
    }

    fn offset(&self, position: lsp::Position) -> usize {
        position_to_offset(&ropey::Rope::from_str(self.line(position.line as usize)), lsp::Position::new(0, position.character))
            + self.line_starts.get(position.line as usize).copied().unwrap_or(self.text.len())
    }
}

/// Locations grouped by file, the source file first and the rest by path, each group in document
/// order, with duplicates dropped.
fn group_locations(locations: &[FileLocation], source: &Path) -> (Vec<PeekGroup>, Vec<FileLocation>) {
    let mut by_file: Vec<(PathBuf, Vec<FileLocation>)> = Vec::new();
    for location in locations {
        let group = match by_file.iter_mut().find(|(path, _)| *path == location.path) {
            Some((_, group)) => group,
            None => {
                by_file.push((location.path.clone(), Vec::new()));
                &mut by_file.last_mut().unwrap().1
            }
        };
        if !group.iter().any(|seen| seen.range == location.range) {
            group.push(location.clone());
        }
    }
    by_file.sort_by(|(a, _), (b, _)| (a != source).cmp(&(b != source)).then_with(|| a.cmp(b)));
    let mut groups = Vec::new();
    let mut entries = Vec::new();
    for (path, mut group) in by_file {
        group.sort_by_key(|location| (location.range.start.line, location.range.start.character));
        let start = entries.len();
        entries.extend(group);
        groups.push(PeekGroup { path, entries: start..entries.len() });
    }
    (groups, entries)
}

pub(crate) struct PeekState {
    /// The end of the line the peek opens under, kept through edits.
    pub anchor: usize,
    groups: Vec<PeekGroup>,
    entries: Vec<FileLocation>,
    selected: usize,
    files: HashMap<PathBuf, PeekFile>,
    pub focus: FocusHandle,
    list_scroll: ScrollHandle,
    /// Scroll the peek into view on the next frame.
    pub reveal: bool,
    _tasks: Vec<Task<()>>,
}

impl Editor {
    /// Opens the peek under the line holding `offset`, replacing one already open.
    pub(crate) fn open_references_peek(&mut self, offset: usize, locations: &[lsp::Location], window: &mut Window, cx: &mut Context<Self>) {
        let locations: Vec<FileLocation> = locations.iter().filter_map(FileLocation::from_lsp).collect();
        if locations.is_empty() {
            self.notice = Some("No references found.".into());
            cx.notify();
            return;
        }
        let (groups, entries) = group_locations(&locations, &self.path);
        let buffer = &self.document.buffer;
        let anchor = buffer.line_end(buffer.line_of(offset.min(buffer.len())));
        let mut files = HashMap::new();
        let mut tasks = Vec::new();
        for group in &groups {
            files.insert(group.path.clone(), PeekFile::Loading);
            let path = group.path.clone();
            let own = (path == self.path).then(|| self.document.buffer.slice(0..self.document.buffer.len()));
            let fs = self.fs.clone();
            tasks.push(cx.spawn(async move |this, cx| {
                let load_path = path.clone();
                let file = cx
                    .background_spawn(async move {
                        let text = match own {
                            Some(text) => Some(text),
                            None => match fs.load(&load_path) {
                                Ok(Loaded::Text { text, .. }) => Some(text),
                                _ => None,
                            },
                        };
                        text.map(|text| Arc::new(PeekText::new(&load_path, text)))
                    })
                    .await;
                this.update(cx, |editor, cx| {
                    if let Some(peek) = &mut editor.peek {
                        peek.files.insert(path, file.map(PeekFile::Ready).unwrap_or(PeekFile::Error));
                        cx.notify();
                    }
                })
                .ok();
            }));
        }
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        self.peek = Some(PeekState { anchor, groups, entries, selected: 0, files, focus, list_scroll: ScrollHandle::new(), reveal: true, _tasks: tasks });
        cx.notify();
    }

    /// `editor.peekReferences`: asks the server for the references at the caret and peeks them.
    pub(crate) fn peek_references(&mut self, _: &crate::commands::PeekReferences, window: &mut Window, cx: &mut Context<Self>) {
        let Some(document) = self.lsp.document.clone() else {
            self.find_references(&crate::FindReferences, window, cx);
            return;
        };
        let caret = self.document.newest_selection().head;
        let version = self.document.buffer.version();
        let request = document.server().request::<lsp::request::References>(lsp::ReferenceParams {
            text_document_position: lsp::TextDocumentPositionParams { text_document: document.identifier(), position: offset_to_position(self.document.buffer.rope(), caret) },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
            context: lsp::ReferenceContext { include_declaration: true },
        });
        self.peek_task = Some(cx.spawn_in(window, async move |this, cx| {
            let locations = request.await.ok().flatten().unwrap_or_default();
            this.update_in(cx, |editor, window, cx| {
                if editor.document.buffer.version() == version {
                    editor.open_references_peek(caret, &locations, window, cx);
                }
            })
            .ok();
        }));
    }

    pub(crate) fn close_references_peek(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.peek.take().is_none() {
            return false;
        }
        window.focus(&self.focus_handle, cx);
        cx.notify();
        true
    }

    pub(crate) fn peek_edited(&mut self, changes: &[AppliedEdit]) {
        if let Some(peek) = &mut self.peek {
            peek.anchor = map_through(peek.anchor, changes, Bias::Right);
        }
    }

    /// The line the peek sits under.
    pub(crate) fn peek_line(&self) -> Option<usize> {
        let peek = self.peek.as_ref()?;
        Some(self.document.buffer.line_of(peek.anchor.min(self.document.buffer.len())))
    }

    fn peek_select(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(peek) = &mut self.peek else { return };
        peek.selected = index.min(peek.entries.len().saturating_sub(1));
        let row = peek.groups.iter().position(|group| group.entries.contains(&peek.selected)).unwrap_or(0) + peek.selected + 1;
        peek.list_scroll.scroll_to_item(row);
        cx.notify();
    }

    fn peek_open(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(location) = self.peek.as_ref().and_then(|peek| peek.entries.get(index).cloned()) else { return };
        self.close_references_peek(window, cx);
        if location.path == self.path {
            let offset = position_to_offset(self.document.buffer.rope(), location.range.start);
            self.document.set_cursor(offset);
            self.autoscroll = Some(Autoscroll::Center);
            self.pause_blink(cx);
            cx.notify();
        } else {
            cx.emit(LspEvent::OpenLocation { path: location.path.clone(), line: location.line(), column: location.column() });
        }
    }

    /// The peek's content, `size` big, for the editor element to draw under its line.
    pub(crate) fn render_references_peek(&mut self, line_height: Pixels, mono: Font, cx: &mut Context<Self>) -> Option<AnyElement> {
        let peek = self.peek.as_ref()?;
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let selected = peek.entries.get(peek.selected)?.clone();
        let group = peek.groups.iter().find(|group| group.path == selected.path)?;
        let file_name = group.path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        let directory = group.path.parent().map(|parent| parent.to_string_lossy().into_owned()).unwrap_or_default();
        let count = if peek.entries.len() == 1 { "1 reference".to_string() } else { format!("{} references", peek.entries.len()) };

        let header = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .h(header_height())
            .px(px(8.))
            .child(div().flex_none().font_weight(typography::MEDIUM).child(file_name))
            .child(div().min_w_0().truncate().text_color(colors.subtle_foreground).child(directory))
            .child(div().ml_auto().flex_none().text_color(colors.subtle_foreground).child(count))
            .child(
                Button::icon("references-peek-close", IconName::X)
                    .size(ButtonSize::XSmall)
                    .tooltip("Close references peek")
                    .on_click(cx.listener(|editor, _, window, cx| {
                        editor.close_references_peek(window, cx);
                    })),
            );

        let preview_rows = ((PEEK_ROWS as f32 * line_height - header_height()) / line_height).floor().max(1.) as usize;
        let preview = match peek.files.get(&selected.path) {
            Some(PeekFile::Ready(text)) => self.peek_preview(text, &selected, preview_rows, line_height, &mono, &theme, cx),
            Some(PeekFile::Error) => div().px(px(12.)).py(px(8.)).text_color(colors.subtle_foreground).child(format!("Could not read {}", selected.path.display())).into_any_element(),
            _ => div().px(px(12.)).py(px(8.)).text_color(colors.subtle_foreground).child("Loading…").into_any_element(),
        };

        let mut list = div()
            .id("references-peek-list")
            .w(list_width())
            .flex_none()
            .h_full()
            .overflow_y_scroll()
            .track_scroll(&peek.list_scroll)
            .border_l_1()
            .border_color(colors.divider)
            .py(px(4.));
        for group in &peek.groups {
            let name = group.path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            list = list.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(8.))
                    .py(px(2.))
                    .text_color(colors.muted_foreground)
                    .child(
                        extensions::file_icon(&name, px(14.), cx)
                            .unwrap_or_else(|| Icon::new(IconName::FileCode).size(IconSize::Small).color(colors.muted_foreground).into_any_element()),
                    )
                    .child(div().min_w_0().truncate().child(name))
                    .child(div().ml_auto().flex_none().child(group.entries.len().to_string())),
            );
            for index in group.entries.clone() {
                let location = &peek.entries[index];
                let line = location.range.start.line as usize;
                let text = match peek.files.get(&location.path) {
                    Some(PeekFile::Ready(text)) => text.line(line).trim().to_string(),
                    _ => String::new(),
                };
                let label = if text.is_empty() { (location.range.start.character + 1).to_string() } else { text };
                let active = index == peek.selected;
                list = list.child(
                    div()
                        .id(("references-peek-entry", index))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .h(px(22.))
                        .mx(px(4.))
                        .px(px(6.))
                        .rounded(ui::metrics::radius())
                        .when(active, |row| row.bg(colors.selected))
                        .when(!active, |row| row.hover(|row| row.bg(colors.accent)))
                        .child(div().flex_none().text_color(colors.subtle_foreground).child((line + 1).to_string()))
                        .child(div().min_w_0().truncate().child(label))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(move |editor, event: &MouseDownEvent, window, cx| {
                                cx.stop_propagation();
                                if event.click_count >= 2 {
                                    editor.peek_open(index, window, cx);
                                } else {
                                    editor.peek_select(index, cx);
                                    if let Some(peek) = &editor.peek {
                                        window.focus(&peek.focus, cx);
                                    }
                                }
                            }),
                        ),
                );
            }
        }

        Some(
            div()
                .id("references-peek")
                .key_context("ReferencesPeek")
                .track_focus(&peek.focus)
                .occlude()
                .size_full()
                .flex()
                .flex_col()
                .overflow_hidden()
                .border_y_1()
                .border_color(colors.divider)
                .bg(colors.surface)
                .font_family(typography::UI_FONT)
                .text_size(typography::text_sm())
                .text_color(colors.foreground)
                .on_action(cx.listener(|editor, _: &MenuUp, _, cx| {
                    let index = editor.peek.as_ref().map_or(0, |peek| peek.selected.saturating_sub(1));
                    editor.peek_select(index, cx);
                }))
                .on_action(cx.listener(|editor, _: &MenuDown, _, cx| {
                    let index = editor.peek.as_ref().map_or(0, |peek| peek.selected + 1);
                    editor.peek_select(index, cx);
                }))
                .on_action(cx.listener(|editor, _: &MoveToStart, _, cx| editor.peek_select(0, cx)))
                .on_action(cx.listener(|editor, _: &MoveToEnd, _, cx| editor.peek_select(usize::MAX, cx)))
                .on_action(cx.listener(|editor, _: &MenuConfirm, window, cx| {
                    let index = editor.peek.as_ref().map_or(0, |peek| peek.selected);
                    editor.peek_open(index, window, cx);
                }))
                .on_action(cx.listener(|editor, _: &Cancel, window, cx| {
                    editor.close_references_peek(window, cx);
                }))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(header)
                .child(div().flex().flex_1().min_h_0().child(div().relative().flex_1().min_w_0().h_full().overflow_hidden().child(preview)).child(list.scrollbar_with(&peek.list_scroll)))
                .into_any_element(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn peek_preview(&self, text: &PeekText, location: &FileLocation, rows: usize, line_height: Pixels, mono: &Font, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let colors = &theme.colors;
        let target = (location.range.start.line as usize).min(text.line_count().saturating_sub(1));
        let first = target.saturating_sub(rows / 2).min(text.line_count().saturating_sub(rows));
        let last = (first + rows).min(text.line_count());
        let start = text.offset(location.range.start);
        let end = text.offset(location.range.end);
        let range = start.min(end)..start.max(end);
        let digits = text.line_count().to_string().len().max(2);
        let mut lines = div().flex().flex_col().py(px(0.));
        for line in first..last {
            let line_range = text.line_range(line);
            let runs = line_runs(text, line_range.clone(), &range, mono, colors.foreground, colors.primary.opacity(0.26), |kind| kind.color(theme));
            let content = text.text[line_range].to_string();
            lines = lines.child(
                div()
                    .flex()
                    .h(line_height)
                    .items_center()
                    .when(line == target, |row| row.bg(colors.accent))
                    .child(
                        div()
                            .flex_none()
                            .w(px(9. * digits as f32 + 16.))
                            .pr(px(8.))
                            .flex()
                            .justify_end()
                            .text_color(if line == target { colors.foreground } else { colors.subtle_foreground })
                            .child((line + 1).to_string()),
                    )
                    .child(div().whitespace_nowrap().child(StyledText::new(SharedString::from(content)).with_runs(runs))),
            );
        }
        div()
            .id("references-peek-preview")
            .size_full()
            .font(mono.clone())
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|editor, event: &MouseDownEvent, window, cx| {
                    if event.click_count >= 2 {
                        let index = editor.peek.as_ref().map_or(0, |peek| peek.selected);
                        editor.peek_open(index, window, cx);
                    }
                }),
            )
            .child(lines)
            .into_any_element()
    }
}

/// The runs of one preview line: syntax colours, with the location's range marked.
fn line_runs(text: &PeekText, line: Range<usize>, marked: &Range<usize>, mono: &Font, foreground: Hsla, mark: Hsla, style: impl Fn(SyntaxKind) -> Hsla) -> Vec<TextRun> {
    let len = line.len();
    let mut kinds: Vec<Option<SyntaxKind>> = vec![None; len];
    let first = text.spans.partition_point(|(range, _)| range.end <= line.start);
    for (range, kind) in &text.spans[first..] {
        if range.start >= line.end {
            break;
        }
        kinds[range.start.max(line.start) - line.start..range.end.min(line.end) - line.start].fill(Some(*kind));
    }
    let content = &text.text[line.clone()];
    let mut runs = Vec::new();
    let mut index = 0;
    while index < len {
        let kind = kinds[index];
        let marked_here = marked.contains(&(line.start + index));
        let mut end = index + 1;
        while end < len && ((kinds[end] == kind && marked.contains(&(line.start + end)) == marked_here) || !content.is_char_boundary(end)) {
            end += 1;
        }
        let (color, font) = match kind {
            Some(kind) => (style(kind), Font { weight: kind.weight(), style: kind.style(false), ..mono.clone() }),
            None => (foreground, mono.clone()),
        };
        runs.push(TextRun { len: end - index, font, color, background_color: marked_here.then_some(mark), underline: None, strikethrough: None });
        index = end;
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::font;

    fn location(path: &str, line: u32, character: u32) -> FileLocation {
        FileLocation { path: PathBuf::from(path), range: lsp::Range::new(lsp::Position::new(line, character), lsp::Position::new(line, character + 1)) }
    }

    #[test]
    fn groups_put_the_source_file_first() {
        let locations = [location("/b.rs", 4, 0), location("/src.rs", 9, 2), location("/a.rs", 1, 0), location("/src.rs", 2, 0), location("/src.rs", 9, 2)];
        let (groups, entries) = group_locations(&locations, Path::new("/src.rs"));
        let order: Vec<(&str, usize)> = groups.iter().map(|group| (group.path.to_str().unwrap(), group.entries.len())).collect();
        assert_eq!(order, vec![("/src.rs", 2), ("/a.rs", 1), ("/b.rs", 1)]);
        assert_eq!(entries[0].range.start.line, 2);
        assert_eq!(entries[1].range.start.line, 9);
    }

    #[test]
    fn preview_lines_and_marks() {
        let text = PeekText::new(Path::new("x.txt"), "one\r\ntwo three\nlast".into());
        assert_eq!(text.line(0), "one");
        assert_eq!(text.line(1), "two three");
        assert_eq!(text.offset(lsp::Position::new(1, 4)), 9);
        let runs = line_runs(&text, text.line_range(1), &(9..14), &font("Mono"), gpui::black(), gpui::white(), |_| gpui::black());
        assert_eq!(runs.iter().map(|run| (run.len, run.background_color.is_some())).collect::<Vec<_>>(), vec![(4, false), (5, true)]);
    }
}
