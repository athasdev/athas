//! The editing model: a buffer, its selections, undo history and syntax tree, and every edit the
//! editor makes, independent of the view so it can be tested without a window.

use std::ops::Range;

use ropey::Rope;

use crate::{
    buffer::{Bias, Buffer, Edit, map_offset, normalize_edits},
    display_map::{DisplayMap, DisplayPoint, display_column},
    history::{EditKind, History, Transaction},
    selection::{Selection, normalize},
    syntax::{LanguageConfig, SyntaxState},
};

/// Where a selection ends up after a batch of edits.
#[derive(Clone, Copy, Debug)]
pub enum Target {
    /// Relative to where the edit starting at old offset `at` begins, in its new text.
    InEdit { at: usize, anchor: usize, head: usize },
    /// Old offsets, carried through the edits.
    Mapped { anchor: usize, head: usize },
    /// Offsets in the text after the batch.
    Exact { anchor: usize, head: usize },
}

/// What the clipboard holds after a copy, so a paste can put whole lines back as lines and spread
/// one piece per cursor.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClipboardText {
    pub text: String,
    pub whole_lines: bool,
    pub pieces: Vec<String>,
}

pub struct Document {
    pub buffer: Buffer,
    pub selections: Vec<Selection>,
    pub history: History,
    pub syntax: SyntaxState,
    /// The text as last loaded or saved, for the dirty state.
    saved: Rope,
    /// The file's exact text when rebuilding it from `saved` and the line ending would not give
    /// it back (mixed `\r\n` and `\n`): what a checked save expects to find on disk.
    disk_text: Option<String>,
    next_selection_id: usize,
    pub tab_size: usize,
    /// Indent with tabs (detected from the file) instead of spaces.
    pub hard_tabs: bool,
    pub auto_close: bool,
    /// Edits are refused (a local history snapshot); carets still move and select.
    pub read_only: bool,
    /// The last cmd-d expanded a caret to a word, so later ones match whole words only.
    select_next_whole_word: bool,
}

const PAIRS: [(char, char); 6] = [('(', ')'), ('[', ']'), ('{', '}'), ('"', '"'), ('\'', '\''), ('`', '`')];

/// A target relative to the selection's own edit (`apply` fills in where that edit starts).
fn in_edit(anchor: usize, head: usize) -> Target {
    Target::InEdit { at: 0, anchor, head }
}

fn closing_for(open: char) -> Option<char> {
    PAIRS.iter().find(|(o, _)| *o == open).map(|(_, close)| *close)
}

fn is_quote(ch: char) -> bool {
    matches!(ch, '"' | '\'' | '`')
}

impl Document {
    pub fn new(text: &str, language: std::sync::Arc<LanguageConfig>) -> Self {
        let buffer = Buffer::new(text);
        let hard_tabs = detect_hard_tabs(&buffer);
        Self {
            saved: buffer.rope().clone(),
            buffer,
            selections: vec![Selection::cursor(0, 0)],
            history: History::default(),
            syntax: SyntaxState::new(language),
            next_selection_id: 1,
            tab_size: 2,
            hard_tabs,
            auto_close: true,
            read_only: false,
            select_next_whole_word: false,
            disk_text: None,
        }
        .with_disk_text(text)
    }

    fn with_disk_text(mut self, text: &str) -> Self {
        self.note_disk_text(text);
        self
    }

    /// Notes `text` as what the disk holds, after it was read; only kept when the saved text
    /// with the file's line ending would differ from it.
    pub fn note_disk_text(&mut self, text: &str) {
        // The buffer holds `text` with `\r\n` as `\n`; the rebuild turns every `\n` into the
        // file's ending. It gives `text` back unless the file mixes the two.
        let rebuilt_matches = match self.buffer.line_ending() {
            crate::buffer::LineEnding::Lf => !text.contains("\r\n"),
            crate::buffer::LineEnding::CrLf => !text.replace("\r\n", "").contains('\n'),
        };
        self.disk_text = (!rebuilt_matches).then(|| text.to_string());
    }

    pub fn is_dirty(&self) -> bool {
        let rope = self.buffer.rope();
        rope.len_bytes() != self.saved.len_bytes() || *rope != self.saved
    }

    /// The text last read from or written to disk, with the file's line ending.
    pub fn saved_text_for_disk(&self) -> String {
        if let Some(text) = &self.disk_text {
            return text.clone();
        }
        let text = self.saved.to_string();
        match self.buffer.line_ending() {
            crate::buffer::LineEnding::Lf => text,
            crate::buffer::LineEnding::CrLf => text.replace('\n', "\r\n"),
        }
    }

    pub fn mark_saved(&mut self) {
        self.mark_saved_as(self.buffer.rope().clone());
    }

    /// Records `rope` as the text on disk (the buffer may have changed while it was written).
    pub fn mark_saved_as(&mut self, rope: Rope) {
        self.saved = rope;
        // What was just written (or loaded, which notes its text again) is the plain rebuild.
        self.disk_text = None;
        self.history.break_group();
    }

    pub fn indent_unit(&self) -> String {
        if self.hard_tabs { "\t".into() } else { " ".repeat(self.tab_size) }
    }

    pub fn newest_selection(&self) -> &Selection {
        self.selections.iter().max_by_key(|selection| selection.id).expect("there is always a selection")
    }

    pub fn new_selection_id(&mut self) -> usize {
        self.next_selection_id += 1;
        self.next_selection_id
    }

    pub fn set_selections(&mut self, selections: Vec<Selection>) {
        let len = self.buffer.len();
        let selections = selections
            .into_iter()
            .map(|mut selection| {
                selection.anchor = self.buffer.clip(selection.anchor.min(len));
                selection.head = self.buffer.clip(selection.head.min(len));
                selection
            })
            .collect::<Vec<_>>();
        self.selections = if selections.is_empty() { vec![Selection::cursor(self.new_selection_id(), 0)] } else { normalize(selections) };
    }

    /// One caret at `offset`, dropping the others.
    pub fn set_cursor(&mut self, offset: usize) {
        let id = self.new_selection_id();
        self.set_selections(vec![Selection::cursor(id, offset)]);
    }

    pub fn select_range(&mut self, range: Range<usize>) {
        let id = self.new_selection_id();
        let mut selection = Selection::cursor(id, 0);
        selection.set_range(range, false);
        self.set_selections(vec![selection]);
    }

    /// Applies a batch of edits, one per selection at most, and places the selections. An edit's
    /// `InEdit` target is relative to that edit.
    pub fn apply(&mut self, items: Vec<(Option<Edit>, Target)>, kind: EditKind) {
        let mut edits = Vec::with_capacity(items.len());
        let mut targets = Vec::with_capacity(items.len());
        for (edit, target) in items {
            let target = match (target, &edit) {
                (Target::InEdit { anchor, head, .. }, Some((range, _))) => Target::InEdit { at: range.start, anchor, head },
                (target, _) => target,
            };
            edits.extend(edit);
            targets.push(target);
        }
        self.apply_edits(edits, targets, kind);
    }

    /// Applies `edits` (in current coordinates) as one undo step and puts one selection at each
    /// target, keeping the selection ids in order.
    pub fn apply_edits(&mut self, edits: Vec<Edit>, targets: Vec<Target>, kind: EditKind) {
        if self.read_only && !edits.is_empty() {
            return;
        }
        let ids: Vec<usize> = self.selections.iter().map(|selection| selection.id).collect();
        // The buffer keeps `\n` only. Normalised here, before history and the targets see the
        // text: otherwise undo removes as many bytes as the pasted `\r\n` text had (eating the
        // text after it) and the caret lands one byte late per line.
        let (edits, targets) = normalize_crlf(edits, targets);
        let edits = normalize_edits(edits);
        let before = self.selections.clone();
        let changed = !edits.is_empty();
        if changed {
            let transaction = Transaction::record(&self.buffer, &edits);
            let input_edits = self.buffer.apply(&edits);
            self.syntax.edit(&input_edits);
            self.history.push(transaction, before, Vec::new(), kind);
        }
        let mut selections = Vec::with_capacity(targets.len());
        for (index, target) in targets.into_iter().enumerate() {
            let (anchor, head) = match target {
                Target::InEdit { at, anchor, head } => {
                    let base = map_offset(at, &edits, Bias::Left);
                    (base + anchor, base + head)
                }
                Target::Exact { anchor, head } => (anchor, head),
                Target::Mapped { anchor, head } => (map_offset(anchor, &edits, Bias::Right), map_offset(head, &edits, Bias::Right)),
            };
            let id = match ids.get(index) {
                Some(id) => *id,
                None => self.new_selection_id(),
            };
            selections.push(Selection { id, anchor, head, goal_column: None });
        }
        self.set_selections(selections);
        if changed {
            self.history.set_selections_after(self.selections.clone());
        }
    }

    /// Replaces every selection with `text`, as typing does.
    pub fn insert(&mut self, text: &str) {
        let single = {
            let mut chars = text.chars();
            match (chars.next(), chars.next()) {
                (Some(ch), None) => Some(ch),
                _ => None,
            }
        };
        let mut items = Vec::with_capacity(self.selections.len());
        for selection in &self.selections {
            let range = selection.range();
            if let (Some(ch), true) = (single, self.auto_close) {
                let next = self.buffer.char_at(range.end);
                // Typing the closing character that is already there steps over it.
                if selection.is_empty() && next == Some(ch) && PAIRS.iter().any(|(open, close)| *close == ch && (*open != ch || is_quote(ch))) {
                    let after = range.end + ch.len_utf8();
                    // Mapped: other carets' edits before this one move it.
                    items.push((None, Target::Mapped { anchor: after, head: after }));
                    continue;
                }
                if let Some(close) = closing_for(ch) {
                    if !selection.is_empty() {
                        let inner = self.buffer.slice(range.clone());
                        let len = inner.len();
                        let wrapped = format!("{ch}{inner}{close}");
                        let start = ch.len_utf8();
                        items.push((Some((range, wrapped)), in_edit(start, start + len)));
                        continue;
                    }
                    let previous = self.buffer.char_before(range.start);
                    let next_allows = next.is_none_or(|next| next.is_whitespace() || matches!(next, ')' | ']' | '}' | ';' | ',' | ':'));
                    let quote_allowed = !is_quote(ch) || !previous.is_some_and(|previous| previous.is_alphanumeric() || previous == ch || previous == '\\');
                    if next_allows && quote_allowed {
                        let caret = ch.len_utf8();
                        items.push((Some((range, format!("{ch}{close}"))), in_edit(caret, caret)));
                        continue;
                    }
                }
            }
            items.push((Some((range, text.to_string())), in_edit(text.len(), text.len())));
        }
        self.apply(items, EditKind::Insert);
    }

    /// Inserts `text` at every selection as is, without pairing brackets.
    pub fn insert_plain(&mut self, text: &str, kind: EditKind) {
        let items = self
            .selections
            .iter()
            .map(|selection| (Some((selection.range(), text.to_string())), in_edit(text.len(), text.len())))
            .collect();
        self.apply(items, kind);
    }

    pub fn newline(&mut self) {
        let unit = self.indent_unit();
        let mut items = Vec::with_capacity(self.selections.len());
        for selection in &self.selections {
            let range = selection.range();
            let line = self.buffer.line_of(range.start);
            let line_start = self.buffer.line_start(line);
            let text = self.buffer.line(line);
            let column = range.start - line_start;
            let indent: String = text[..text.len().min(column)].chars().take_while(|ch| *ch == ' ' || *ch == '\t').collect();
            let before = text[..column].trim_end();
            let opens = before.ends_with(['{', '[', '(']) || (before.ends_with(':') && self.syntax.language.name == "Python");
            let next = self.buffer.char_at(range.end);
            let closes = before.chars().next_back().and_then(closing_for).is_some_and(|close| Some(close) == next && !is_quote(close));
            let (inserted, caret) = if opens && closes {
                let first = format!("\n{indent}{unit}");
                let caret = first.len();
                (format!("{first}\n{indent}"), caret)
            } else if opens {
                let text = format!("\n{indent}{unit}");
                let caret = text.len();
                (text, caret)
            } else {
                let text = format!("\n{indent}");
                let caret = text.len();
                (text, caret)
            };
            items.push((Some((range, inserted)), in_edit(caret, caret)));
        }
        self.apply(items, EditKind::Other);
    }

    /// Inserts a line below (or above) each cursor's line and moves there.
    pub fn newline_beside(&mut self, above: bool) {
        let mut items = Vec::with_capacity(self.selections.len());
        for selection in &self.selections {
            let line = self.buffer.line_of(selection.head);
            let indent: String = self.buffer.line(line).chars().take_while(|ch| *ch == ' ' || *ch == '\t').collect();
            if above {
                let at = self.buffer.line_start(line);
                let caret = indent.len();
                items.push((Some((at..at, format!("{indent}\n"))), in_edit(caret, caret)));
            } else {
                let at = self.buffer.line_end(line);
                let text = format!("\n{indent}");
                let caret = text.len();
                items.push((Some((at..at, text)), in_edit(caret, caret)));
            }
        }
        self.apply(items, EditKind::Other);
    }

    pub fn backspace(&mut self) {
        let tab_size = self.tab_size;
        let mut items = Vec::with_capacity(self.selections.len());
        for selection in &self.selections {
            let range = selection.range();
            if !range.is_empty() {
                items.push((Some((range, String::new())), in_edit(0, 0)));
                continue;
            }
            let offset = range.start;
            if offset == 0 {
                items.push((None, Target::Exact { anchor: 0, head: 0 }));
                continue;
            }
            let previous = self.buffer.char_before(offset);
            let next = self.buffer.char_at(offset);
            if self.auto_close
                && let Some(previous) = previous
                && closing_for(previous).is_some_and(|close| Some(close) == next)
            {
                let start = offset - previous.len_utf8();
                items.push((Some((start..offset + 1, String::new())), in_edit(0, 0)));
                continue;
            }
            // In leading spaces, delete back to the previous tab stop.
            let line = self.buffer.line_of(offset);
            let line_start = self.buffer.line_start(line);
            let column = offset - line_start;
            let text = self.buffer.line(line);
            if column > 0 && text[..column].bytes().all(|byte| byte == b' ') {
                let remove = match column % tab_size {
                    0 => tab_size,
                    rest => rest,
                }
                .min(column);
                items.push((Some((offset - remove..offset, String::new())), in_edit(0, 0)));
                continue;
            }
            let start = self.buffer.previous_boundary(offset);
            items.push((Some((start..offset, String::new())), in_edit(0, 0)));
        }
        self.apply(items, EditKind::Delete);
    }

    /// Deletes each selection, or from each caret to the offset `to` gives.
    pub fn delete_to(&mut self, to: impl Fn(&Buffer, usize) -> usize) {
        let mut items = Vec::with_capacity(self.selections.len());
        for selection in &self.selections {
            let range = if selection.is_empty() {
                let other = to(&self.buffer, selection.head);
                selection.head.min(other)..selection.head.max(other)
            } else {
                selection.range()
            };
            if range.is_empty() {
                items.push((None, Target::Exact { anchor: range.start, head: range.start }));
            } else {
                items.push((Some((range, String::new())), in_edit(0, 0)));
            }
        }
        self.apply(items, EditKind::Delete);
    }

    /// Lines the selections touch, merged into blocks of whole lines (inclusive).
    pub fn line_blocks(&self) -> Vec<(usize, usize)> {
        let mut blocks: Vec<(usize, usize)> = Vec::new();
        for selection in &self.selections {
            let first = self.buffer.line_of(selection.start());
            let mut last = self.buffer.line_of(selection.end());
            // A selection ending at a line start does not include that line.
            if last > first && self.buffer.line_start(last) == selection.end() {
                last -= 1;
            }
            match blocks.last_mut() {
                Some(block) if first <= block.1 + 1 => block.1 = block.1.max(last),
                _ => blocks.push((first, last)),
            }
        }
        blocks
    }

    pub fn delete_lines(&mut self) {
        let line_count = self.buffer.line_count();
        let mut edits: Vec<Edit> = Vec::new();
        let mut blocks = Vec::new();
        for (first, last) in self.line_blocks() {
            let range = if last + 1 < line_count {
                self.buffer.line_start(first)..self.buffer.line_start(last + 1)
            } else if first > 0 {
                self.buffer.line_end(first - 1)..self.buffer.len()
            } else {
                0..self.buffer.len()
            };
            blocks.push((first, last, range.start));
            edits.push((range, String::new()));
        }
        let targets = self
            .selections
            .iter()
            .map(|selection| {
                let line = self.buffer.line_of(selection.head);
                let at = blocks.iter().find(|(first, last, _)| (*first..=*last).contains(&line)).map(|block| block.2).unwrap_or(selection.head);
                Target::InEdit { at, anchor: 0, head: 0 }
            })
            .collect();
        self.apply_edits(edits, targets, EditKind::Other);
        // Land at the first non-blank character of the line that moved up.
        let selections = self
            .selections
            .iter()
            .map(|selection| {
                let line = self.buffer.line_of(selection.head);
                Selection::cursor(selection.id, self.buffer.line_start(line) + self.buffer.indent_len(line))
            })
            .collect();
        self.set_selections(selections);
    }

    pub fn move_lines(&mut self, up: bool) {
        let line_count = self.buffer.line_count();
        let blocks = self.line_blocks();
        if (up && blocks.first().is_some_and(|block| block.0 == 0)) || (!up && blocks.last().is_some_and(|block| block.1 + 1 >= line_count)) {
            return;
        }
        let mut edits: Vec<Edit> = Vec::new();
        let mut shifts: Vec<(Range<usize>, isize)> = Vec::new();
        for (first, last) in blocks {
            let block_range = self.buffer.line_start(first)..self.buffer.line_end(last);
            let block = self.buffer.slice(block_range.clone());
            if up {
                let other = self.buffer.line(first - 1).into_owned();
                let region = self.buffer.line_start(first - 1)..block_range.end;
                edits.push((region, format!("{block}\n{other}")));
                shifts.push((block_range.start..block_range.end + 1, -(other.len() as isize + 1)));
            } else {
                let other = self.buffer.line(last + 1).into_owned();
                let region = block_range.start..self.buffer.line_end(last + 1);
                edits.push((region, format!("{other}\n{block}")));
                shifts.push((block_range.start..block_range.end + 1, other.len() as isize + 1));
            }
        }
        let shift = |offset: usize| {
            shifts
                .iter()
                .find(|(range, _)| range.contains(&offset))
                .map(|(_, delta)| (offset as isize + delta) as usize)
                .unwrap_or(offset)
        };
        let targets: Vec<Target> =
            self.selections.iter().map(|selection| Target::Exact { anchor: shift(selection.anchor), head: shift(selection.head) }).collect();
        self.apply_edits(edits, targets, EditKind::Other);
    }

    /// Duplicates the selected lines; the selections follow the lower copy when `down`.
    pub fn copy_lines(&mut self, down: bool) {
        let blocks = self.line_blocks();
        let mut edits: Vec<Edit> = Vec::new();
        let mut inserted: Vec<(usize, usize, usize)> = Vec::new();
        for (first, last) in blocks {
            let start = self.buffer.line_start(first);
            let block = self.buffer.slice(start..self.buffer.line_end(last));
            let text = format!("{block}\n");
            inserted.push((start, self.buffer.line_end(last), text.len()));
            edits.push((start..start, text));
        }
        let place = |offset: usize| {
            let mut delta = 0;
            for (start, end, len) in &inserted {
                if offset >= *start && offset <= *end {
                    return offset + delta + if down { *len } else { 0 };
                }
                if offset > *end {
                    delta += len;
                }
            }
            offset + delta
        };
        let targets = self.selections.iter().map(|selection| Target::Exact { anchor: place(selection.anchor), head: place(selection.head) }).collect();
        self.apply_edits(edits, targets, EditKind::Other);
    }

    /// Indents (or outdents) every line the selections touch.
    pub fn indent_lines(&mut self, outdent: bool) {
        let unit = self.indent_unit();
        let mut edits: Vec<Edit> = Vec::new();
        for (first, last) in self.line_blocks() {
            for line in first..=last {
                let start = self.buffer.line_start(line);
                if outdent {
                    let text = self.buffer.line(line);
                    let remove = if text.starts_with('\t') {
                        1
                    } else {
                        text.bytes().take(self.tab_size).take_while(|byte| *byte == b' ').count()
                    };
                    if remove > 0 {
                        edits.push((start..start + remove, String::new()));
                    }
                } else if !self.buffer.is_blank_line(line) {
                    edits.push((start..start, unit.clone()));
                }
            }
        }
        let targets = self.selections.iter().map(|selection| Target::Mapped { anchor: selection.anchor, head: selection.head }).collect();
        self.apply_edits(edits, targets, EditKind::Other);
    }

    /// Tab: indents the lines of a multi-line selection, otherwise inserts an indent.
    pub fn tab(&mut self) {
        let multi_line = self.selections.iter().any(|selection| self.buffer.line_of(selection.start()) != self.buffer.line_of(selection.end()));
        if multi_line {
            self.indent_lines(false);
            return;
        }
        let tab_size = self.tab_size;
        let hard_tabs = self.hard_tabs;
        let items = self
            .selections
            .iter()
            .map(|selection| {
                let text = if hard_tabs {
                    "\t".to_string()
                } else {
                    let line = self.buffer.line_of(selection.start());
                    let start = self.buffer.line_start(line);
                    let column = display_column(&self.buffer.line(line), selection.start() - start, tab_size);
                    " ".repeat(tab_size - column % tab_size)
                };
                let len = text.len();
                (Some((selection.range(), text)), in_edit(len, len))
            })
            .collect();
        self.apply(items, EditKind::Insert);
    }

    pub fn toggle_comment(&mut self) {
        let language = self.syntax.language.clone();
        if let Some(prefix) = language.line_comment {
            self.toggle_line_comment(prefix);
        } else if let Some((open, close)) = language.block_comment {
            self.toggle_block_comment(open, close);
        }
    }

    fn toggle_line_comment(&mut self, prefix: &str) {
        let blocks = self.line_blocks();
        let lines: Vec<usize> = blocks.iter().flat_map(|(first, last)| *first..=*last).filter(|line| !self.buffer.is_blank_line(*line)).collect();
        if lines.is_empty() {
            return;
        }
        let commented = lines.iter().all(|line| self.buffer.line(*line).trim_start().starts_with(prefix));
        let mut edits: Vec<Edit> = Vec::new();
        if commented {
            for line in lines {
                let start = self.buffer.line_start(line) + self.buffer.indent_len(line);
                let text = self.buffer.line(line);
                let rest = &text[self.buffer.indent_len(line) + prefix.len()..];
                let len = prefix.len() + usize::from(rest.starts_with(' '));
                edits.push((start..start + len, String::new()));
            }
        } else {
            // Comment at the shallowest indent of each block so the markers line up.
            for (first, last) in blocks {
                let block_lines: Vec<usize> = (first..=last).filter(|line| !self.buffer.is_blank_line(*line)).collect();
                let indent = block_lines.iter().map(|line| self.buffer.indent_len(*line)).min().unwrap_or(0);
                for line in block_lines {
                    let at = self.buffer.line_start(line) + indent;
                    edits.push((at..at, format!("{prefix} ")));
                }
            }
        }
        let targets = self.selections.iter().map(|selection| Target::Mapped { anchor: selection.anchor, head: selection.head }).collect();
        self.apply_edits(edits, targets, EditKind::Other);
    }

    fn toggle_block_comment(&mut self, open: &str, close: &str) {
        let mut edits: Vec<Edit> = Vec::new();
        for (first, last) in self.line_blocks() {
            let start = self.buffer.line_start(first) + self.buffer.indent_len(first);
            let end = self.buffer.line_end(last);
            let text = self.buffer.slice(start..end);
            let trimmed = text.trim_end();
            if trimmed.starts_with(open) && trimmed.ends_with(close) && trimmed.len() >= open.len() + close.len() {
                let open_len = open.len() + usize::from(trimmed[open.len()..].starts_with(' '));
                let close_start = start + trimmed.len() - close.len();
                let close_start = if trimmed[..trimmed.len() - close.len()].ends_with(' ') { close_start - 1 } else { close_start };
                edits.push((start..start + open_len, String::new()));
                edits.push((close_start..start + trimmed.len(), String::new()));
            } else {
                edits.push((start..start, format!("{open} ")));
                edits.push((end..end, format!(" {close}")));
            }
        }
        let targets = self.selections.iter().map(|selection| Target::Mapped { anchor: selection.anchor, head: selection.head }).collect();
        self.apply_edits(edits, targets, EditKind::Other);
    }

    pub fn undo(&mut self) -> bool {
        let Some(step) = self.history.undo() else { return false };
        self.replay(step.edits, step.selections);
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(step) = self.history.redo() else { return false };
        self.replay(step.edits, step.selections);
        true
    }

    fn replay(&mut self, batches: Vec<Vec<Edit>>, selections: Vec<Selection>) {
        for edits in batches {
            let input_edits = self.buffer.apply(&edits);
            self.syntax.edit(&input_edits);
        }
        self.set_selections(selections);
    }

    /// Moves every caret with `motion`; with `select`, extends the selections instead.
    pub fn move_heads(&mut self, select: bool, motion: impl Fn(&Buffer, &Selection) -> usize) {
        let selections = self
            .selections
            .iter()
            .map(|selection| {
                let head = motion(&self.buffer, selection);
                let mut selection = selection.clone();
                if select { selection.select_to(head) } else { selection.collapse_to(head) }
                selection
            })
            .collect();
        self.set_selections(selections);
    }

    /// Vertical motion by display rows, keeping each caret's goal column.
    pub fn move_vertically(&mut self, map: &DisplayMap, rows: isize, select: bool) {
        let selections = self
            .selections
            .iter()
            .map(|selection| {
                let mut selection = selection.clone();
                let from = if select || selection.is_empty() {
                    selection.head
                } else if rows < 0 {
                    selection.start()
                } else {
                    selection.end()
                };
                let (head, goal) = crate::movement::vertical(map, from, selection.goal_column, rows);
                if select { selection.head = head } else { selection.collapse_to(head) }
                selection.goal_column = Some(goal);
                selection
            })
            .collect();
        self.set_selections(selections);
    }

    /// Adds a caret on the row above or below each caret.
    pub fn add_cursors_vertically(&mut self, map: &DisplayMap, rows: isize) {
        let mut selections = self.selections.clone();
        for selection in &self.selections {
            let point = map.to_display(selection.head);
            let goal = selection.goal_column.unwrap_or(point.column);
            let target = point.row as isize + rows;
            if target < 0 || target as usize >= map.row_count() {
                continue;
            }
            let Some(target) = map.skip_blocks(target as usize, rows > 0) else { continue };
            let offset = map.from_display(DisplayPoint { row: target, column: goal });
            self.next_selection_id += 1;
            selections.push(Selection { id: self.next_selection_id, anchor: offset, head: offset, goal_column: Some(goal) });
        }
        self.set_selections(selections);
    }

    /// A caret at the end of every line the selections cover.
    pub fn cursors_at_line_ends(&mut self) {
        let mut selections = Vec::new();
        for selection in self.selections.clone() {
            let first = self.buffer.line_of(selection.start());
            let last = self.buffer.line_of(selection.end());
            for line in first..=last {
                let end = self.buffer.line_end(line);
                selections.push(Selection::cursor(self.new_selection_id(), end));
            }
        }
        self.set_selections(selections);
    }

    /// Cmd-D: selects the word at a caret, then adds the next occurrence of the selected text.
    pub fn select_next_occurrence(&mut self) -> bool {
        let newest = self.newest_selection().clone();
        if newest.is_empty() {
            let Some(word) = self.buffer.word_range_at(newest.head) else { return false };
            let selections = self
                .selections
                .iter()
                .map(|selection| {
                    let mut selection = selection.clone();
                    if let Some(range) = self.buffer.word_range_at(selection.head).filter(|_| selection.is_empty()) {
                        selection.set_range(range, false);
                    }
                    selection
                })
                .collect();
            self.set_selections(selections);
            self.select_next_whole_word = !word.is_empty();
            return true;
        }
        let needle = self.buffer.slice(newest.range());
        let text = self.buffer.text();
        let occurrences = self.occurrences(&text, &needle);
        let taken = |range: &Range<usize>| self.selections.iter().any(|selection| selection.range() == *range);
        let next = occurrences
            .iter()
            .find(|range| range.start >= newest.end() && !taken(range))
            .or_else(|| occurrences.iter().find(|range| !taken(range)))
            .cloned();
        let Some(range) = next else { return false };
        let mut selections = self.selections.clone();
        let mut selection = Selection::cursor(self.new_selection_id(), 0);
        selection.set_range(range, false);
        selections.push(selection);
        self.set_selections(selections);
        true
    }

    /// Like `select_next_occurrence`, searching backwards from the newest selection.
    pub fn select_previous_occurrence(&mut self) -> bool {
        let newest = self.newest_selection().clone();
        if newest.is_empty() {
            return self.select_next_occurrence();
        }
        let needle = self.buffer.slice(newest.range());
        let text = self.buffer.text();
        let occurrences = self.occurrences(&text, &needle);
        let taken = |range: &Range<usize>| self.selections.iter().any(|selection| selection.range() == *range);
        let previous = occurrences
            .iter()
            .rev()
            .find(|range| range.end <= newest.start() && !taken(range))
            .or_else(|| occurrences.iter().rev().find(|range| !taken(range)))
            .cloned();
        let Some(range) = previous else { return false };
        let mut selections = self.selections.clone();
        let mut selection = Selection::cursor(self.new_selection_id(), 0);
        selection.set_range(range, false);
        selections.push(selection);
        self.set_selections(selections);
        true
    }

    /// Keeps only the newest selection.
    pub fn remove_secondary_cursors(&mut self) {
        let newest = self.newest_selection().clone();
        self.set_selections(vec![newest]);
    }

    /// The bracket pair around `offset` (or at it): the offsets of the opening and closing
    /// brackets.
    pub fn enclosing_brackets(&self, offset: usize) -> Option<(usize, usize)> {
        if let Some((at, partner)) = crate::element::matching_bracket(self, offset) {
            return Some((at.min(partner), at.max(partner)));
        }
        let mut depth = 0usize;
        let mut position = offset;
        for ch in self.buffer.reversed_chars_at(offset).take(200_000) {
            position -= ch.len_utf8();
            match ch {
                ')' | ']' | '}' => depth += 1,
                '(' | '[' | '{' if depth > 0 => depth -= 1,
                '(' | '[' | '{' => {
                    let (_, close) = crate::element::matching_bracket(self, position)?;
                    return Some((position, close));
                }
                _ => {}
            }
        }
        None
    }

    /// Selects from the bracket at or around the newest caret to its partner, both included.
    pub fn select_to_bracket(&mut self) {
        let head = self.newest_selection().head;
        if let Some((open, close)) = self.enclosing_brackets(head) {
            let end = close + self.buffer.char_at(close).map_or(1, char::len_utf8);
            self.select_range(open..end);
        }
    }

    /// Deletes the bracket pair around the newest caret, keeping what is inside.
    pub fn remove_brackets(&mut self) {
        let head = self.newest_selection().head;
        let Some((open, close)) = self.enclosing_brackets(head) else { return };
        let open_len = self.buffer.char_at(open).map_or(1, char::len_utf8);
        let close_len = self.buffer.char_at(close).map_or(1, char::len_utf8);
        let target = Target::Mapped { anchor: head, head };
        let id = self.newest_selection().id;
        self.selections.retain(|selection| selection.id == id);
        self.apply_edits(vec![(open..open + open_len, String::new()), (close..close + close_len, String::new())], vec![target], EditKind::Other);
    }

    /// Selects every occurrence of the newest selection's text (or the word at the caret).
    pub fn select_all_occurrences(&mut self) {
        let newest = self.newest_selection().clone();
        let range = if newest.is_empty() {
            match self.buffer.word_range_at(newest.head) {
                Some(range) => {
                    self.select_next_whole_word = true;
                    range
                }
                None => return,
            }
        } else {
            newest.range()
        };
        let needle = self.buffer.slice(range);
        let text = self.buffer.text();
        let mut selections: Vec<Selection> = Vec::new();
        for found in self.occurrences(&text, &needle) {
            let mut selection = Selection::cursor(self.new_selection_id(), 0);
            selection.set_range(found, false);
            selections.push(selection);
        }
        if !selections.is_empty() {
            self.set_selections(selections);
        }
    }

    fn occurrences(&self, text: &str, needle: &str) -> Vec<Range<usize>> {
        if needle.is_empty() {
            return Vec::new();
        }
        if self.select_next_whole_word {
            crate::search::word_occurrences(text, 0, needle)
        } else {
            text.match_indices(needle).map(|(index, _)| index..index + needle.len()).collect()
        }
    }

    /// Forgets the whole-word mode once the selections change by other means.
    pub fn reset_occurrence_mode(&mut self) {
        self.select_next_whole_word = false;
    }

    /// The text a copy takes: the selections, or the caret lines when nothing is selected.
    pub fn copy_text(&self) -> ClipboardText {
        if self.selections.iter().all(Selection::is_empty) {
            let mut lines: Vec<usize> = self.selections.iter().map(|selection| self.buffer.line_of(selection.head)).collect();
            lines.dedup();
            let pieces: Vec<String> = lines.iter().map(|line| format!("{}\n", self.buffer.line(*line))).collect();
            return ClipboardText { text: pieces.concat(), whole_lines: true, pieces };
        }
        let pieces: Vec<String> = self.selections.iter().filter(|selection| !selection.is_empty()).map(|selection| self.buffer.slice(selection.range())).collect();
        ClipboardText { text: pieces.join("\n"), whole_lines: false, pieces }
    }

    pub fn cut(&mut self) -> ClipboardText {
        let copied = self.copy_text();
        if copied.whole_lines {
            self.delete_lines();
        } else {
            self.delete_to(|_, offset| offset);
        }
        copied
    }

    pub fn paste(&mut self, clipboard: &ClipboardText) {
        let count = self.selections.len();
        if count > 1 && clipboard.pieces.len() == count {
            let items = self
                .selections
                .iter()
                .zip(&clipboard.pieces)
                .map(|(selection, piece)| {
                    let piece = piece.trim_end_matches('\n').to_string();
                    let len = piece.len();
                    (Some((selection.range(), piece)), in_edit(len, len))
                })
                .collect();
            self.apply(items, EditKind::Other);
            return;
        }
        if clipboard.whole_lines && self.selections.iter().all(Selection::is_empty) {
            let items = self
                .selections
                .iter()
                .map(|selection| {
                    let start = self.buffer.line_start(self.buffer.line_of(selection.head));
                    (Some((start..start, clipboard.text.clone())), Target::Mapped { anchor: selection.head, head: selection.head })
                })
                .collect();
            self.apply(items, EditKind::Other);
            return;
        }
        self.insert_plain(&clipboard.text, EditKind::Other);
    }

    /// Replaces the whole text with `text` (a reload), as one minimal edit so carets and the
    /// syntax tree survive.
    pub fn replace_all(&mut self, text: &str) {
        let new = Buffer::new(text).text();
        let old = self.buffer.text();
        let prefix = old.bytes().zip(new.bytes()).take_while(|(a, b)| a == b).count();
        let prefix = (0..=prefix).rev().find(|index| old.is_char_boundary(*index) && new.is_char_boundary(*index)).unwrap_or(0);
        let max_suffix = (old.len() - prefix).min(new.len() - prefix);
        let suffix = old.bytes().rev().zip(new.bytes().rev()).take(max_suffix).take_while(|(a, b)| a == b).count();
        let suffix = (0..=suffix).rev().find(|len| old.is_char_boundary(old.len() - len) && new.is_char_boundary(new.len() - len)).unwrap_or(0);
        if prefix == old.len() && prefix == new.len() {
            return;
        }
        let edit = (prefix..old.len() - suffix, new[prefix..new.len() - suffix].to_string());
        let targets = self.selections.iter().map(|selection| Target::Mapped { anchor: selection.anchor, head: selection.head }).collect();
        self.apply_outside_edits(vec![edit], targets);
    }

    /// Edits that come from outside the typing (a reload, the language server): their own undo
    /// step, never folded into an open vim insert group around them.
    pub fn apply_outside_edits(&mut self, edits: Vec<Edit>, targets: Vec<Target>) {
        self.history.end_group();
        self.apply_edits(edits, targets, EditKind::Other);
        self.history.end_group();
    }
}

/// A file indents with tabs when more of its indented lines start with a tab than a space.
fn detect_hard_tabs(buffer: &Buffer) -> bool {
    let (mut tabs, mut spaces) = (0, 0);
    for line in buffer.rope().lines().take(2000) {
        match line.chars().next() {
            Some('\t') => tabs += 1,
            Some(' ') => spaces += 1,
            _ => {}
        }
    }
    tabs > spaces
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::syntax::language_for_path;

    fn doc(text: &str) -> Document {
        let mut document = Document::new(text, language_for_path(Path::new("a.rs")));
        document.tab_size = 4;
        document
    }

    #[test]
    fn read_only_documents_refuse_edits_but_move_carets() {
        let mut document = doc("let a = 1;");
        document.read_only = true;
        document.insert("x");
        document.newline();
        assert_eq!(document.buffer.text(), "let a = 1;");
        assert!(!document.is_dirty() && !document.undo());
        document.select_range(4..5);
        assert_eq!(document.selections[0].range(), 4..5);
    }

    fn carets(document: &mut Document, offsets: &[usize]) {
        let selections = offsets.iter().enumerate().map(|(id, offset)| Selection::cursor(id + 10, *offset)).collect();
        document.set_selections(selections);
    }

    fn heads(document: &Document) -> Vec<usize> {
        document.selections.iter().map(|selection| selection.head).collect()
    }

    #[test]
    fn mixed_line_endings_are_expected_as_they_are_on_disk() {
        let mixed = "a\r\nb\nc\r\n";
        assert_eq!(doc(mixed).saved_text_for_disk(), mixed);
        assert_eq!(doc("a\r\nb\r\n").saved_text_for_disk(), "a\r\nb\r\n");
        assert_eq!(doc("a\nb\n").saved_text_for_disk(), "a\nb\n");
    }

    #[test]
    fn many_carets_step_over_closing_brackets() {
        let mut document = doc("ab\n()");
        carets(&mut document, &[1, 4]);
        document.insert(")");
        assert_eq!(document.buffer.text(), "a)b\n()");
        assert_eq!(heads(&document), vec![2, 6]);
    }

    #[test]
    fn crlf_text_inserts_as_lf_and_undoes_cleanly() {
        let mut document = doc("XY");
        carets(&mut document, &[1]);
        document.insert("a\r\nb");
        assert_eq!(document.buffer.text(), "Xa\nbY");
        assert_eq!(heads(&document), vec![4]);
        document.undo();
        assert_eq!(document.buffer.text(), "XY");
    }

    #[test]
    fn typing_at_many_carets() {
        let mut document = doc("ab\ncd");
        carets(&mut document, &[1, 4]);
        document.insert("x");
        assert_eq!(document.buffer.text(), "axb\ncxd");
        assert_eq!(heads(&document), vec![2, 6]);
        document.undo();
        assert_eq!(document.buffer.text(), "ab\ncd");
        assert_eq!(heads(&document), vec![1, 4]);
    }

    #[test]
    fn brackets_auto_close_and_step_over() {
        let mut document = doc("");
        document.insert("(");
        assert_eq!(document.buffer.text(), "()");
        assert_eq!(heads(&document), vec![1]);
        document.insert(")");
        assert_eq!(document.buffer.text(), "()");
        assert_eq!(heads(&document), vec![2]);
        let mut document = doc("word");
        document.select_range(0..4);
        document.insert("\"");
        assert_eq!(document.buffer.text(), "\"word\"");
        let mut document = doc("don");
        document.set_cursor(3);
        document.insert("'");
        assert_eq!(document.buffer.text(), "don'");
    }

    #[test]
    fn backspace_removes_pairs_and_indent_stops() {
        let mut document = doc("()");
        document.set_cursor(1);
        document.backspace();
        assert_eq!(document.buffer.text(), "");
        let mut document = doc("      x");
        document.set_cursor(6);
        document.backspace();
        assert_eq!(document.buffer.text(), "    x");
    }

    #[test]
    fn enter_indents_inside_brackets() {
        let mut document = doc("    fn f() {}");
        document.set_cursor(12);
        document.newline();
        assert_eq!(document.buffer.text(), "    fn f() {\n        \n    }");
        assert_eq!(heads(&document), vec![21]);
        let mut document = doc("  x");
        document.set_cursor(3);
        document.newline();
        assert_eq!(document.buffer.text(), "  x\n  ");
    }

    #[test]
    fn line_moves_and_copies() {
        let mut document = doc("one\ntwo\nthree");
        document.set_cursor(5);
        document.move_lines(true);
        assert_eq!(document.buffer.text(), "two\none\nthree");
        assert_eq!(heads(&document), vec![1]);
        document.move_lines(false);
        document.move_lines(false);
        assert_eq!(document.buffer.text(), "one\nthree\ntwo");
        assert_eq!(heads(&document), vec![11]);
        document.copy_lines(true);
        assert_eq!(document.buffer.text(), "one\nthree\ntwo\ntwo");
        assert_eq!(heads(&document), vec![15]);
        document.delete_lines();
        assert_eq!(document.buffer.text(), "one\nthree\ntwo");
    }

    #[test]
    fn comments_toggle() {
        let mut document = doc("fn a() {\n    b();\n}");
        document.select_range(0..document.buffer.len());
        document.toggle_comment();
        assert_eq!(document.buffer.text(), "// fn a() {\n//     b();\n// }");
        document.toggle_comment();
        assert_eq!(document.buffer.text(), "fn a() {\n    b();\n}");
    }

    #[test]
    fn indent_and_outdent() {
        let mut document = doc("a\nb");
        document.select_range(0..3);
        document.tab();
        assert_eq!(document.buffer.text(), "    a\n    b");
        document.indent_lines(true);
        assert_eq!(document.buffer.text(), "a\nb");
        document.set_cursor(1);
        document.tab();
        assert_eq!(document.buffer.text(), "a   \nb");
    }

    #[test]
    fn occurrences_and_whole_line_clipboard() {
        let mut document = doc("foo bar foo foobar");
        document.set_cursor(1);
        document.select_next_occurrence();
        document.select_next_occurrence();
        let ranges: Vec<_> = document.selections.iter().map(Selection::range).collect();
        assert_eq!(ranges, vec![0..3, 8..11]);
        assert!(!document.select_next_occurrence());

        let mut document = doc("one\ntwo");
        document.set_cursor(5);
        let copied = document.copy_text();
        assert!(copied.whole_lines);
        assert_eq!(copied.text, "two\n");
        document.set_cursor(1);
        document.paste(&copied);
        assert_eq!(document.buffer.text(), "two\none\ntwo");
        assert_eq!(heads(&document), vec![5]);
    }

    #[test]
    fn previous_occurrences_and_secondary_cursors() {
        let mut document = doc("foo bar foo baz foo");
        document.select_range(16..19);
        assert!(document.select_previous_occurrence());
        let ranges: Vec<_> = document.selections.iter().map(Selection::range).collect();
        assert_eq!(ranges, vec![8..11, 16..19]);
        document.remove_secondary_cursors();
        let ranges: Vec<_> = document.selections.iter().map(Selection::range).collect();
        assert_eq!(ranges, vec![8..11]);
    }

    #[test]
    fn brackets_select_and_remove() {
        let mut document = doc("f(a, [b])");
        document.set_cursor(6);
        document.select_to_bracket();
        assert_eq!(document.newest_selection().range(), 5..8);
        document.set_cursor(3);
        document.select_to_bracket();
        assert_eq!(document.newest_selection().range(), 1..9);
        document.set_cursor(6);
        document.remove_brackets();
        assert_eq!(document.buffer.text(), "f(a, b)");
        assert_eq!(heads(&document), vec![5]);
        document.copy_lines(true);
        assert_eq!(document.buffer.text(), "f(a, b)\nf(a, b)");
    }

    #[test]
    fn reload_keeps_carets() {
        let mut document = doc("hello world");
        document.set_cursor(8);
        document.replace_all("hello big world");
        assert_eq!(document.buffer.text(), "hello big world");
        assert_eq!(heads(&document), vec![12]);
    }

    #[test]
    fn dirty_tracks_the_saved_text() {
        let mut document = doc("a");
        document.set_cursor(1);
        document.insert("b");
        assert!(document.is_dirty());
        document.undo();
        assert!(!document.is_dirty());
    }
}

/// `edits` with `\r\n` turned into `\n`, and the offsets `targets` give inside an inserted text
/// moved back by the `\r`s dropped before them.
fn normalize_crlf(edits: Vec<crate::buffer::Edit>, targets: Vec<Target>) -> (Vec<crate::buffer::Edit>, Vec<Target>) {
    if !edits.iter().any(|(_, text)| text.contains("\r\n")) {
        return (edits, targets);
    }
    // Counted on bytes, so an offset inside a character cannot panic.
    let shrink = |text: &str, offset: usize| -> usize {
        let bytes = text.as_bytes();
        let dropped = (0..offset.min(bytes.len())).filter(|&i| bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n')).count();
        offset - dropped
    };
    let targets = targets
        .into_iter()
        .map(|target| match target {
            Target::InEdit { at, anchor, head } => match edits.iter().find(|(range, _)| range.start == at) {
                Some((_, text)) => Target::InEdit { at, anchor: shrink(text, anchor), head: shrink(text, head) },
                None => Target::InEdit { at, anchor, head },
            },
            other => other,
        })
        .collect();
    let edits = edits.into_iter().map(|(range, text)| (range, if text.contains("\r\n") { text.replace("\r\n", "\n") } else { text })).collect();
    (edits, targets)
}
