//! Agent edits in the editor: Keep / Reject lenses over the hunks an agent left unreviewed in the
//! file (Cmd-Y / Cmd-N on the caret's hunk), and the inline edit prompt over the selection.
//!
//! The editor does not depend on the AI crate; the workbench registers [`AgentHooks`] with
//! [`set_agent_hooks`], and without them neither feature shows.

use ui::TooltipExt as _;
use std::{
    ops::Range,
    path::{Path, PathBuf},
    rc::Rc,
};

use ui::scale::px;
use gpui::{
    AnyElement, AnyView, Anchor, App, Context, FocusHandle, Global, KeyContext, Subscription, WeakEntity, Window, anchored, deferred, div,
    point, prelude::*,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, IconName};

use crate::{Editor, KeepAgentHunk, RejectAgentHunk, document::Target, history::EditKind};

/// An unreviewed agent change in the file: `current_lines` at the 0-based line `current_start`
/// replaced `base_lines`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentHunk {
    pub session: String,
    pub base_start: usize,
    pub base_lines: Vec<String>,
    pub current_start: usize,
    pub current_lines: Vec<String>,
}

impl AgentHunk {
    /// The lines the hunk covers now; empty for a pure deletion.
    pub fn lines(&self) -> Range<usize> {
        self.current_start..self.current_start + self.current_lines.len()
    }

    fn covers(&self, line: usize) -> bool {
        self.lines().contains(&line) || (self.current_lines.is_empty() && self.current_start == line)
    }
}

/// What an inline edit is asked to change.
#[derive(Clone, Debug, Default)]
pub struct InlineEditInput {
    pub path: PathBuf,
    pub language: String,
    pub selection: String,
    pub before: String,
    pub after: String,
}

/// The inline edit prompt a hook built.
pub struct InlineEditView {
    pub view: AnyView,
    pub focus: FocusHandle,
    pub subscription: Subscription,
}

pub trait AgentHooks: 'static {
    /// The unreviewed agent hunks in `path`.
    fn hunks(&self, path: &Path) -> Vec<AgentHunk>;
    /// Keeps or rejects a hunk; the file on disk changes and reviews are announced.
    fn resolve(&self, path: &Path, hunk: AgentHunk, keep: bool, cx: &mut App);
    /// Calls `changed` whenever an agent review changes.
    fn observe_reviews(&self, changed: Box<dyn Fn(&mut App)>, cx: &mut App) -> Subscription;
    /// Builds the inline edit prompt. It reports back with [`Editor::finish_inline_edit`].
    fn inline_edit(&self, input: InlineEditInput, editor: WeakEntity<Editor>, window: &mut Window, cx: &mut App) -> Option<InlineEditView>;
    /// Maps `range` of `previous` onto `next`; `None` when the change touched it.
    fn rebase_range(&self, previous: &str, next: &str, range: Range<usize>) -> Option<Range<usize>>;
    /// Asks the Tab autocomplete model for ghost text at the caret; `None` when it may not run.
    /// The task resolves to the text to show, or `None` for nothing; dropping it cancels.
    fn complete(&self, _input: crate::InlineCompletionInput, _cx: &mut App) -> Option<gpui::Task<Option<String>>> {
        None
    }
}

struct GlobalAgentHooks(Rc<dyn AgentHooks>);

impl Global for GlobalAgentHooks {}

pub fn set_agent_hooks(hooks: Rc<dyn AgentHooks>, cx: &mut App) {
    cx.set_global(GlobalAgentHooks(hooks));
}

pub(crate) fn hooks(cx: &App) -> Option<Rc<dyn AgentHooks>> {
    cx.try_global::<GlobalAgentHooks>().map(|hooks| hooks.0.clone())
}

struct InlineEdit {
    prompt: InlineEditView,
    range: Range<usize>,
    /// The whole text when the prompt opened, to find the range again after edits.
    text: String,
    /// The proposed replacement shown in the buffer, with the buffer version it was set at.
    preview: Option<(String, usize)>,
}

/// A proposed inline edit drawn in the buffer (`inline-edit-preview.ts`): the lines it replaces
/// tinted as removed, and the lines it leaves in rows below them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InlinePreview {
    /// The first and last line the edit replaces.
    pub lines: (usize, usize),
    /// The whole lines the edit leaves.
    pub proposed: Vec<String>,
    /// Each proposed line's syntax spans, relative to the line.
    pub spans: Vec<Vec<(Range<usize>, crate::SyntaxKind)>>,
}

#[derive(Default)]
pub(crate) struct AgentState {
    hunks: Vec<AgentHunk>,
    inline: Option<InlineEdit>,
    observing: Option<Subscription>,
}

impl Editor {
    /// Reads the file's agent hunks again, and starts following review changes.
    pub(crate) fn refresh_agent_hunks(&mut self, cx: &mut Context<Self>) {
        let Some(hooks) = hooks(cx) else { return };
        if self.agent.observing.is_none() {
            let editor = cx.weak_entity();
            let changed = Box::new(move |cx: &mut App| {
                editor.update(cx, |editor, cx| editor.refresh_agent_hunks(cx)).ok();
            });
            self.agent.observing = Some(hooks.observe_reviews(changed, cx));
        }
        let hunks = hooks.hunks(&self.path);
        if hunks != self.agent.hunks {
            self.agent.hunks = hunks;
            cx.notify();
        }
    }

    pub fn agent_hunks(&self) -> &[AgentHunk] {
        &self.agent.hunks
    }

    /// The rows each hunk's widget takes above its line (`AgentHunkWidget`): its Keep / Undo lens
    /// row, then the lines it removed; by line, and a deletion at the end of the file shows above
    /// the last line.
    pub(crate) fn agent_removed_blocks(&self) -> Vec<(usize, usize)> {
        let last = self.document.buffer.line_count().saturating_sub(1);
        let mut blocks: Vec<(usize, usize)> = Vec::new();
        for hunk in &self.agent.hunks {
            let line = hunk.current_start.min(last);
            let rows = 1 + hunk.base_lines.len();
            match blocks.binary_search_by_key(&line, |(block_line, _)| *block_line) {
                Ok(index) => blocks[index].1 += rows,
                Err(index) => blocks.insert(index, (line, rows)),
            }
        }
        blocks
    }

    /// How many hunks start at `line`: each has a lens row there, before the removed lines.
    pub(crate) fn agent_lens_rows(&self, line: usize) -> usize {
        let last = self.document.buffer.line_count().saturating_sub(1);
        self.agent.hunks.iter().filter(|hunk| hunk.current_start.min(last) == line).count()
    }

    /// The lines the agent removed that show above `line`, in order.
    pub(crate) fn agent_removed_lines(&self, line: usize) -> Vec<&str> {
        let last = self.document.buffer.line_count().saturating_sub(1);
        self.agent.hunks.iter().filter(|hunk| hunk.current_start.min(last) == line).flat_map(|hunk| hunk.base_lines.iter().map(String::as_str)).collect()
    }

    fn caret_hunk(&self) -> Option<&AgentHunk> {
        let line = self.document.buffer.line_of(self.document.newest_selection().head);
        self.agent.hunks.iter().find(|hunk| hunk.covers(line))
    }

    pub(crate) fn agent_key_context(&self, context: &mut KeyContext) {
        if self.caret_hunk().is_some() {
            context.add("agent_hunk");
        }
    }

    fn resolve_agent_hunk(&mut self, hunk: AgentHunk, keep: bool, cx: &mut Context<Self>) {
        let Some(hooks) = hooks(cx) else { return };
        self.agent.hunks.retain(|other| *other != hunk);
        hooks.resolve(&self.path, hunk, keep, cx);
        cx.notify();
    }

    pub(crate) fn keep_agent_hunk(&mut self, _: &KeepAgentHunk, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(hunk) = self.caret_hunk().cloned() {
            self.resolve_agent_hunk(hunk, true, cx);
        }
    }

    pub(crate) fn reject_agent_hunk(&mut self, _: &RejectAgentHunk, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(hunk) = self.caret_hunk().cloned() {
            self.resolve_agent_hunk(hunk, false, cx);
        }
    }

    /// Keeps or rejects the agent hunk at the caret, for commands run from elsewhere.
    pub fn resolve_agent_hunk_at_caret(&mut self, keep: bool, cx: &mut Context<Self>) -> bool {
        let Some(hunk) = self.caret_hunk().cloned() else { return false };
        self.resolve_agent_hunk(hunk, keep, cx);
        true
    }

    /// Opens the inline edit prompt over the selection, or over the caret's line.
    pub(crate) fn inline_edit(&mut self, _: &crate::InlineEdit, window: &mut Window, cx: &mut Context<Self>) {
        let Some(hooks) = hooks(cx) else { return };
        if self.status != crate::Status::Ready {
            return;
        }
        let buffer = &self.document.buffer;
        let selection = self.document.newest_selection();
        let range = if selection.is_empty() {
            let line = buffer.line_of(selection.head);
            buffer.line_start(line)..buffer.line_end(line)
        } else {
            selection.range()
        };
        let input = InlineEditInput {
            path: self.path.clone(),
            language: self.document.syntax.language.name.to_lowercase(),
            selection: buffer.slice(range.clone()),
            before: buffer.slice(0..range.start),
            after: buffer.slice(range.end..buffer.len()),
        };
        let text = buffer.text();
        let Some(prompt) = hooks.inline_edit(input, cx.weak_entity(), window, cx) else { return };
        window.focus(&prompt.focus, cx);
        self.agent.inline = Some(InlineEdit { prompt, range, text, preview: None });
        cx.notify();
    }

    /// Shows `replacement` for the selection in the buffer as a diff, or stops showing it.
    pub fn set_inline_edit_preview(&mut self, replacement: Option<String>, cx: &mut Context<Self>) {
        let version = self.document.buffer.version();
        let Some(edit) = &mut self.agent.inline else { return };
        let preview = replacement.map(|text| (text, version));
        if edit.preview != preview {
            edit.preview = preview;
            cx.notify();
        }
    }

    /// The preview to draw, while the text is as it was when it was set.
    pub(crate) fn inline_preview(&self) -> Option<InlinePreview> {
        let edit = self.agent.inline.as_ref()?;
        let (text, version) = edit.preview.as_ref()?;
        let buffer = &self.document.buffer;
        if *version != buffer.version() || edit.range.end > buffer.len() {
            return None;
        }
        let first = buffer.line_of(edit.range.start);
        let mut last = buffer.line_of(edit.range.end);
        if last > first && edit.range.end == buffer.line_start(last) {
            last -= 1;
        }
        let prefix = buffer.slice(buffer.line_start(first)..edit.range.start);
        let suffix = buffer.slice(edit.range.end.max(buffer.line_start(last))..buffer.line_end(last).max(edit.range.end));
        let joined = format!("{prefix}{text}{suffix}");
        let joined = joined.trim_end_matches('\n');
        let proposed: Vec<String> = joined.split('\n').map(str::to_string).collect();
        let starts: Vec<usize> = std::iter::once(0).chain(joined.match_indices('\n').map(|(at, _)| at + 1)).collect();
        let mut spans = vec![Vec::new(); proposed.len()];
        for (range, kind) in crate::highlight_snippet(&self.path, joined) {
            let index = starts.partition_point(|start| *start <= range.start).saturating_sub(1);
            let line_end = starts.get(index + 1).map_or(joined.len(), |next| next - 1);
            let clipped = range.start..range.end.min(line_end);
            if !clipped.is_empty() {
                spans[index].push((clipped.start - starts[index]..clipped.end - starts[index], kind));
            }
        }
        Some(InlinePreview { lines: (first, last), proposed, spans })
    }

    /// Ends the inline edit: replaces the selection with `replacement` as one undo step, or
    /// leaves the text alone when it is `None`.
    pub fn finish_inline_edit(&mut self, replacement: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(edit) = self.agent.inline.take() else { return };
        window.focus(&self.focus_handle, cx);
        cx.notify();
        let Some(replacement) = replacement else { return };
        let current = self.document.buffer.text();
        let range = match hooks(cx) {
            Some(hooks) => hooks.rebase_range(&edit.text, &current, edit.range),
            None => (edit.text == current).then_some(edit.range),
        };
        let Some(range) = range else {
            self.notice = Some("The selection changed while the edit ran, so it was not applied.".into());
            return;
        };
        let start = range.start;
        let end = start + replacement.len();
        self.update_document(cx, |document| {
            document.apply_edits(vec![(range, replacement)], vec![Target::Exact { anchor: start, head: end }], EditKind::Other);
        });
    }

    /// The toolbar above selected text once the pointer lets go (`EditorSelectionAgentAction`):
    /// Edit opens inline edit on the selection, and the chat button adds it to the agent chat.
    pub(crate) fn render_selection_actions(&self, window: &Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        hooks(cx)?;
        let selection = self.document.newest_selection();
        if self.status != crate::Status::Ready
            || self.document.read_only
            || self.agent.inline.is_some()
            || self.drag.is_some()
            || selection.is_empty()
            || self.document.selections.len() > 1
            || !self.focus_handle.is_focused(window)
        {
            return None;
        }
        let range = selection.range();
        let buffer = &self.document.buffer;
        let start = self.offset_bounds(range.start);
        let end = self.offset_bounds(range.end);
        let visible = start.or(end)?;
        let single_line = buffer.line_of(range.start) == buffer.line_of(range.end) && start.is_some() && end.is_some();
        let x = match (single_line, start, end) {
            (true, Some(start), Some(end)) => (start.left() + end.left()) / 2.,
            _ => visible.left(),
        };
        let colors = cx.theme().colors.clone();
        let shortcut = cx
            .try_global::<keymap::ActiveKeymap>()
            .and_then(|active| keymap::shortcuts_by_command(&active.bindings).remove("editor.inlineEdit"))
            .map(|key| keymap::display_key(&key));
        let mut edit = Button::new("selection-inline-edit", "Edit")
            .size(ButtonSize::XSmall)
            .variant(ButtonVariant::Ghost)
            .leading_icon(IconName::Sparkle)
            .tooltip("Edit selection inline");
        if let Some(shortcut) = shortcut {
            edit = edit.shortcut(shortcut);
        }
        let edit = edit
            .on_click(cx.listener(|editor, _, window, cx| editor.inline_edit(&crate::InlineEdit, window, cx)));
        let toolbar = div()
            .flex()
            .items_center()
            .gap(px(2.))
            .p(px(2.))
            .rounded(ui::metrics::radius_md())
            .bg(colors.overlay)
            .border_1()
            .border_color(colors.border)
            .shadow(cx.theme().shadows.popover.clone())
            .occlude()
            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(edit)
            .child(
                Button::icon("selection-add-to-chat", IconName::ChatBubbleText)
                    .size(ButtonSize::XSmall)
                    .variant(ButtonVariant::Ghost)
                    .tooltip("Add to chat")
                    .on_click(|_, window, cx| {
                        if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action("editor.addSelectionToChat")) {
                            window.dispatch_action(action, cx);
                        }
                    }),
            );
        let origin = point(x, visible.top() - px(6.));
        Some(deferred(anchored().anchor(Anchor::BottomCenter).position(origin).snap_to_window_with_margin(px(8.)).child(toolbar)).with_priority(1).into_any_element())
    }

    pub(crate) fn render_agent_overlays(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut overlays = Vec::new();
        let preview = self.inline_preview();
        let anchor_line = preview.as_ref().map(|preview| preview.lines.1);
        if let Some(edit) = &self.agent.inline
            && let Some(bounds) = self.offset_bounds(self.document.buffer.line_start(anchor_line.unwrap_or_else(|| self.document.buffer.line_of(edit.range.start))))
        {
            let below = preview.as_ref().map_or(px(0.), |preview| bounds.size.height * preview.proposed.len() as f32);
            let origin = point(self.layout.as_ref().map_or(bounds.left(), |layout| layout.text_bounds.left()) + px(8.), bounds.bottom() + below + px(4.));
            overlays.push(
                deferred(anchored().position(origin).snap_to_window_with_margin(px(8.)).child(div().w(px(560.)).occlude().child(edit.prompt.view.clone())))
                    .with_priority(2)
                    .into_any_element(),
            );
        }
        let Some(layout) = self.layout.as_ref() else { return overlays };
        let colors = cx.theme().colors.clone();
        // Each hunk's lens is a quiet row of text actions above it (`.cm-agent-edit-lens`: 0.85em,
        // subtle, 0.75em apart, underlined on hover), its removed lines below that.
        let last = self.document.buffer.line_count().saturating_sub(1);
        let font_size = px((settings::get(cx).font_size as f32).clamp(6., 72.) * crate::zoom_level(cx));
        let action = |id: (&'static str, usize), label: &'static str, tooltip: &'static str| {
            div()
                .id(id)
                .text_color(colors.subtle_foreground)
                .hover(|style| style.text_color(colors.foreground).underline())
                .anchored_tooltip({ let text: gpui::SharedString = (tooltip).into(); move || ui::Tooltip::new(text.clone()) })
                .child(label)
        };
        for (index, hunk) in self.agent.hunks.iter().enumerate() {
            let line = hunk.current_start.min(last);
            let Some(bounds) = self.offset_bounds(self.document.buffer.line_start(line)) else { continue };
            let line_height = bounds.size.height;
            let before: Vec<&AgentHunk> = self.agent.hunks.iter().filter(|other| other.current_start.min(last) == line).collect();
            let order = before.iter().position(|other| std::ptr::eq(*other, hunk)).unwrap_or(0);
            let removed: usize = before.iter().map(|other| other.base_lines.len()).sum();
            let top = bounds.top() - line_height * (before.len() + removed - order) as f32;
            let keep = hunk.clone();
            let reject = hunk.clone();
            let lens = div()
                .flex()
                .items_center()
                .gap(font_size * 0.85 * 0.75)
                .h(line_height)
                .text_size(font_size * 0.85)
                .child(action(("agent-keep", index), "Keep", "Keep this agent change").on_click(cx.listener(move |editor, _, _, cx| editor.resolve_agent_hunk(keep.clone(), true, cx))))
                .child(action(("agent-reject", index), "Undo", "Undo this agent change").on_click(cx.listener(move |editor, _, _, cx| editor.resolve_agent_hunk(reject.clone(), false, cx))));
            let origin = point(layout.origin.x, top);
            overlays.push(deferred(anchored().position(origin).child(lens)).with_priority(1).into_any_element());
        }
        overlays
    }
}
