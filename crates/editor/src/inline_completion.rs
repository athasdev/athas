//! AI ghost text (Tab autocomplete, `aiCompletion`): after typing pauses, the agent hooks ask a
//! model for text to insert at the caret, shown dimmed after it. Tab accepts it, Cmd-Right
//! (Ctrl-Right) accepts its next word, Escape dismisses it and Alt-\ asks right away. Typing the
//! text it starts with keeps the rest showing; any other edit, or moving the caret, drops it.

use std::{path::PathBuf, time::Duration};

use gpui::{Context, KeyContext, Task, Window};

use crate::{
    AcceptInlineCompletion, AcceptInlineCompletionWord, Editor, Status, TriggerInlineCompletion, agent::hooks, history::EditKind,
};

/// How long typing has to pause before a completion is asked for.
pub const DEBOUNCE: Duration = Duration::from_millis(350);
/// Text before the caret sent as context.
pub const PREFIX_CHARS: usize = 12_000;
/// Text after the caret sent as context.
pub const SUFFIX_CHARS: usize = 4_000;

/// What a completion is asked for at the caret.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct InlineCompletionInput {
    pub path: PathBuf,
    pub language: String,
    /// Up to [`PREFIX_CHARS`] before the caret.
    pub before: String,
    /// Up to [`SUFFIX_CHARS`] after the caret.
    pub after: String,
    /// The caret's 1-based line.
    pub line: usize,
}

/// The suggestion shown after `pos`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Ghost {
    pub pos: usize,
    pub text: String,
}

#[derive(Default)]
pub(crate) struct GhostState {
    pub suggestion: Option<Ghost>,
    task: Option<Task<()>>,
    /// The edit in flight is an accept, which asks for nothing new.
    accepting: bool,
}

/// The next word of a suggestion, with the whitespace before it.
pub fn next_suggestion_word(text: &str) -> &str {
    let is_word = |ch: char| ch.is_alphanumeric() || ch == '_' || ch == '$';
    let rest = text.trim_start();
    let lead = text.len() - rest.len();
    let Some(first) = rest.chars().next() else { return text };
    let word = is_word(first);
    let end = rest.char_indices().find(|(_, ch)| ch.is_whitespace() || is_word(*ch) != word).map_or(rest.len(), |(index, _)| index);
    &text[..lead + end]
}

/// Whether ghost text never runs for `path`: env files and keys.
pub fn is_sensitive_path(path: &std::path::Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else { return false };
    let name = name.to_ascii_lowercase();
    name == ".env" || name.starts_with(".env.") || [".pem", ".key", ".p12", ".pfx"].iter().any(|ext| name.len() > ext.len() && name.ends_with(ext))
}

fn char_floor(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

impl Editor {
    /// The line a multi-line suggestion starts on and the rows its other lines take below it.
    pub(crate) fn ghost_block(&self) -> Option<(usize, usize)> {
        let ghost = self.ghost()?;
        let rows = ghost.text.matches('\n').count();
        (rows > 0).then(|| (self.document.buffer.line_of(ghost.pos.min(self.document.buffer.len())), rows))
    }

    pub(crate) fn ghost(&self) -> Option<&Ghost> {
        self.ghost.suggestion.as_ref().filter(|_| self.lsp.completion.is_none())
    }

    pub(crate) fn ghost_key_context(&self, context: &mut KeyContext) {
        if self.ghost().is_some() {
            context.add("ghost_text");
        }
    }

    /// After `update_document`: keeps what is left of the suggestion when the edit typed its
    /// start, drops it otherwise, and asks for a new one once typing pauses.
    pub(crate) fn ghost_after_update(&mut self, len_before: usize, edited: bool, cx: &mut Context<Self>) {
        let accepting = std::mem::take(&mut self.ghost.accepting);
        let selection = self.document.newest_selection();
        let single_caret = self.document.selections.len() == 1 && selection.is_empty();
        let head = selection.head;
        if let Some(ghost) = self.ghost.suggestion.take() {
            let buffer = &self.document.buffer;
            let kept = if edited {
                let grown = buffer.len().checked_sub(len_before).filter(|grown| *grown > 0);
                grown.and_then(|grown| {
                    let typed = (single_caret && head == ghost.pos + grown).then(|| buffer.slice(ghost.pos..head))?;
                    let rest = ghost.text.strip_prefix(typed.as_str())?;
                    (!rest.is_empty()).then(|| Ghost { pos: head, text: rest.to_string() })
                })
            } else {
                (single_caret && head == ghost.pos).then_some(ghost)
            };
            self.ghost.suggestion = kept;
        }
        if edited || self.ghost.suggestion.is_none() {
            self.ghost.task = None;
        }
        if edited && !accepting && self.ghost.suggestion.is_none() {
            self.schedule_ghost(DEBOUNCE, cx);
        }
    }

    pub(crate) fn ghost_blurred(&mut self) {
        self.ghost.task = None;
        self.ghost.suggestion = None;
    }

    /// Escape: drops the suggestion.
    pub(crate) fn dismiss_ghost(&mut self, cx: &mut Context<Self>) -> bool {
        if self.ghost.suggestion.take().is_none() {
            return false;
        }
        self.ghost.task = None;
        cx.notify();
        true
    }

    fn schedule_ghost(&mut self, delay: Duration, cx: &mut Context<Self>) {
        if !settings::get(cx).ai_completion || hooks(cx).is_none() || is_sensitive_path(&self.path) {
            return;
        }
        self.ghost.task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let Ok(Some(request)) = this.update(cx, |editor, cx| editor.ghost_request(cx)) else { return };
            let (input, pos, version) = request;
            let Some(text) = request_task(input, cx, &this).await else { return };
            this.update(cx, |editor, cx| {
                let selection = editor.document.newest_selection();
                if editor.document.buffer.version() != version
                    || selection.head != pos
                    || !selection.is_empty()
                    || editor.document.selections.len() > 1
                    || editor.lsp.completion.is_some()
                    || !editor.focused
                {
                    return;
                }
                let text = text.replace("\r\n", "\n");
                if text.is_empty() {
                    return;
                }
                editor.ghost.suggestion = Some(Ghost { pos, text });
                cx.notify();
            })
            .ok();
        }));
    }

    /// What to ask for at the caret, or `None` when nothing should be asked.
    fn ghost_request(&self, cx: &mut Context<Self>) -> Option<(InlineCompletionInput, usize, usize)> {
        let selection = self.document.newest_selection();
        if !self.focused
            || self.status != Status::Ready
            || !selection.is_empty()
            || self.document.selections.len() > 1
            || self.lsp.completion.is_some()
            || !settings::get(cx).ai_completion
        {
            return None;
        }
        let buffer = &self.document.buffer;
        let pos = selection.head;
        let before_start = pos.saturating_sub(PREFIX_CHARS * 4);
        let before = buffer.slice(before_start..pos);
        let before = before[char_floor(&before, before.len().saturating_sub(PREFIX_CHARS))..].to_string();
        if before.trim().is_empty() {
            return None;
        }
        let after = buffer.slice(pos..buffer.len().min(pos + SUFFIX_CHARS * 4));
        let after = after[..char_floor(&after, SUFFIX_CHARS.min(after.len()))].to_string();
        let input = InlineCompletionInput {
            path: self.path.clone(),
            language: self.document.syntax.language.name.to_lowercase(),
            before,
            after,
            line: buffer.line_of(pos) + 1,
        };
        Some((input, pos, buffer.version()))
    }

    fn accept_ghost_text(&mut self, take: impl FnOnce(&str) -> &str, cx: &mut Context<Self>) -> bool {
        let Some(ghost) = self.ghost().cloned() else { return false };
        let text = take(&ghost.text).to_string();
        if text.is_empty() {
            return false;
        }
        let rest = ghost.text[text.len()..].to_string();
        self.ghost.accepting = true;
        self.update_document(cx, |document| {
            document.set_cursor(ghost.pos);
            document.insert_plain(&text, EditKind::Other);
        });
        self.ghost.accepting = false;
        if !rest.is_empty() {
            self.ghost.suggestion = Some(Ghost { pos: ghost.pos + text.len(), text: rest });
        }
        true
    }

    pub(crate) fn accept_inline_completion(&mut self, _: &AcceptInlineCompletion, _: &mut Window, cx: &mut Context<Self>) {
        if !self.accept_ghost_text(|text| text, cx) {
            cx.propagate();
        }
    }

    pub(crate) fn accept_inline_completion_word(&mut self, _: &AcceptInlineCompletionWord, _: &mut Window, cx: &mut Context<Self>) {
        if !self.accept_ghost_text(next_suggestion_word, cx) {
            cx.propagate();
        }
    }

    pub(crate) fn trigger_inline_completion(&mut self, _: &TriggerInlineCompletion, _: &mut Window, cx: &mut Context<Self>) {
        self.ghost.suggestion = None;
        self.schedule_ghost(Duration::ZERO, cx);
    }

    /// `ATHAS_EDITOR_DEMO=ghost`: a two-line suggestion at the end of the caret's line.
    pub(crate) fn run_ghost_demo(&mut self) {
        if !crate::demo("ghost") {
            return;
        }
        let buffer = &self.document.buffer;
        let pos = buffer.line_end(buffer.line_of(self.document.newest_selection().head));
        self.document.set_cursor(pos);
        self.ghost.suggestion = Some(Ghost { pos, text: " // suggested by the model\n    let total = values.iter().sum();".into() });
    }

    /// For headless snapshots: shows `text` after the caret.
    pub fn show_inline_completion(&mut self, text: impl Into<String>, cx: &mut Context<Self>) {
        let pos = self.document.newest_selection().head;
        self.ghost.suggestion = Some(Ghost { pos, text: text.into() });
        cx.notify();
    }

    pub fn inline_completion_text(&self) -> Option<&str> {
        self.ghost().map(|ghost| ghost.text.as_str())
    }
}

async fn request_task(input: InlineCompletionInput, cx: &mut gpui::AsyncApp, this: &gpui::WeakEntity<Editor>) -> Option<String> {
    let task = this.update(cx, |_, cx| hooks(cx).and_then(|hooks| hooks.complete(input, cx))).ok()??;
    task.await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_word_takes_leading_whitespace() {
        assert_eq!(next_suggestion_word("  foo(bar)"), "  foo");
        assert_eq!(next_suggestion_word("(bar)"), "(");
        assert_eq!(next_suggestion_word("bar_baz + 1"), "bar_baz");
        assert_eq!(next_suggestion_word("   "), "   ");
    }

    #[test]
    fn env_and_key_files_are_sensitive() {
        assert!(is_sensitive_path(std::path::Path::new("/p/.env")));
        assert!(is_sensitive_path(std::path::Path::new("/p/.env.local")));
        assert!(is_sensitive_path(std::path::Path::new("/p/cert.PEM")));
        assert!(!is_sensitive_path(std::path::Path::new("/p/main.rs")));
        assert!(!is_sensitive_path(std::path::Path::new("/p/environment.ts")));
    }
}
