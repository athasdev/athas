//! The editor's right-click menu (`features/editor` context menu in Athas): clipboard, language
//! features, folding and breakpoints.

use gpui::{Anchor, Context, Pixels, Point, Window};
use ui::{IconName, MenuEntry, MenuItem, OpenMenu};

use crate::{Editor, Status, document::Target, history::EditKind};

/// A shortcut as the menu shows it: `⌘X` on macOS, `Ctrl+X` elsewhere.
fn keys(mac: &'static str, other: &'static str) -> &'static str {
    if cfg!(target_os = "macos") { mac } else { other }
}

impl Editor {
    pub(crate) fn deploy_context_menu(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        if self.status != Status::Ready {
            return;
        }
        window.focus(&self.focus_handle, cx);
        self.dismiss_lsp_popovers(cx);
        // A click outside every selection moves the caret there first.
        let offset = self.offset_for_position(position);
        if !self.document.selections.iter().any(|selection| selection.start() <= offset && offset <= selection.end() && !selection.is_empty()) {
            self.document.set_cursor(offset);
        }
        let editor = cx.entity();
        let has_server = self.lsp.document.is_some();
        let has_selection = self.document.selections.iter().any(|selection| !selection.is_empty());
        let line = self.document.buffer.line_of(self.document.newest_selection().head);
        let foldable = self.folds.is_folded(line) || self.fold_ranges().iter().any(|range| range.contains_line(line));
        let item = |label: &'static str, run: fn(&mut Editor, &mut Window, &mut Context<Editor>)| {
            let editor = editor.clone();
            MenuItem::new(label).on_select(move |window, cx| {
                editor.update(cx, |editor, cx| {
                    window.focus(&editor.focus_handle, cx);
                    run(editor, window, cx);
                })
            })
        };
        let can_edit = !self.document.read_only;
        let mut entries: Vec<MenuEntry> = vec![
            item("Copy", |editor, window, cx| editor.copy(&crate::Copy, window, cx))
                .icon(IconName::Copy)
                .shortcut(keys("⌘C", "Ctrl+C"))
                .disabled(!has_selection)
                .into(),
            item("Cut", |editor, window, cx| editor.cut(&crate::Cut, window, cx))
                .icon(IconName::Scissors)
                .shortcut(keys("⌘X", "Ctrl+X"))
                .disabled(!has_selection || !can_edit)
                .into(),
            item("Paste", |editor, window, cx| editor.paste(&crate::Paste, window, cx))
                .icon(IconName::ClipboardText)
                .shortcut(keys("⌘V", "Ctrl+V"))
                .disabled(!can_edit)
                .into(),
            item("Delete", |editor, _, cx| editor.delete_selection(cx)).icon(IconName::Trash).disabled(!has_selection || !can_edit).into(),
            item("Select All", |editor, window, cx| editor.select_all(&crate::SelectAll, window, cx))
                .icon(IconName::Text)
                .shortcut(keys("⌘A", "Ctrl+A"))
                .into(),
            MenuEntry::Separator,
            item("Quick Fix...", |editor, window, cx| editor.code_actions(&crate::CodeActions, window, cx))
                .icon(IconName::PencilLine)
                .shortcut(keys("⌘.", "Ctrl+."))
                .disabled(!can_edit)
                .into(),
            item("Go to Definition", |editor, window, cx| editor.go_to_definition(&crate::GoToDefinition, window, cx))
                .shortcut("F12")
                .disabled(!has_server)
                .into(),
            item("Find All References", |editor, window, cx| editor.find_references(&crate::FindReferences, window, cx))
                .shortcut("⇧F12")
                .disabled(!has_server)
                .into(),
            item("Rename Symbol", |editor, window, cx| editor.rename(&crate::Rename, window, cx)).shortcut("F2").disabled(!has_server || !can_edit).into(),
            item("Toggle Comment", |editor, window, cx| editor.toggle_comment(&crate::ToggleComment, window, cx))
                .icon(IconName::Code)
                .shortcut(keys("⌘/", "Ctrl+/"))
                .disabled(!can_edit)
                .into(),
            if has_selection {
                item("Format Selection", |editor, window, cx| editor.format_selection(&crate::FormatSelection, window, cx))
            } else {
                item("Format Document", |editor, window, cx| editor.format_document(&crate::FormatDocument, window, cx)).shortcut(keys("⇧⌥F", "Shift+Alt+F"))
            }
            .icon(IconName::TextAlignLeft)
            .disabled(!can_edit)
            .into(),
            item("Toggle Case", |editor, _, cx| editor.toggle_selection_case(cx)).icon(IconName::CaseSensitive).disabled(!has_selection || !can_edit).into(),
            MenuEntry::Separator,
            item("Find", |editor, window, cx| editor.find(&crate::Find, window, cx)).icon(IconName::Search).shortcut(keys("⌘F", "Ctrl+F")).into(),
            MenuEntry::Separator,
            item("Toggle Breakpoint", |editor, window, cx| editor.toggle_breakpoint(&crate::ToggleBreakpoint, window, cx))
                .icon(IconName::CircleDot)
                .shortcut("F9")
                .into(),
            item("Fold / Unfold", |editor, window, cx| editor.toggle_fold(&crate::ToggleFold, window, cx)).disabled(!foldable).into(),
            item("Expand Selection", |editor, window, cx| editor.select_larger_syntax_node(&crate::SelectLargerSyntaxNode, window, cx))
                .shortcut(keys("⌃⇧↑", "Ctrl+Shift+Up"))
                .into(),
        ];
        if self.document.syntax.language.name == "Markdown" {
            entries.push(MenuEntry::Separator);
            entries.push(
                item("Open Preview to the Side", |editor, window, cx| editor.toggle_markdown_preview(&crate::ToggleMarkdownPreview, window, cx))
                    .icon(IconName::Eye)
                    .into(),
            );
        }
        let path = self.path().to_path_buf();
        if path.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| {
            matches!(extension.to_ascii_lowercase().as_str(), "html" | "htm" | "xhtml" | "svg")
        }) {
            let title = format!("Preview {}", path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default());
            entries.push(MenuEntry::Separator);
            entries.push(
                MenuItem::new("Open Preview")
                    .on_select(move |_, cx| workbench_api::open_resource(cx, "preview", &path.to_string_lossy(), &title))
                    .icon(IconName::Eye)
                    .into(),
            );
        }
        self.context_menu = Some(OpenMenu::new("editor-context", entries, position, Anchor::TopLeft, window, cx, |editor, _| editor.context_menu = None));
        cx.notify();
    }
}

impl Editor {
    fn delete_selection(&mut self, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.insert(""));
    }

    /// Upper-cases every selection that has a lowercase letter and lower-cases the rest, keeping
    /// the selections where they are (`toggle-case.ts`).
    pub(crate) fn toggle_selection_case(&mut self, cx: &mut Context<Self>) {
        self.update_document(cx, |document| {
            let mut edits = Vec::new();
            let mut targets = Vec::new();
            for selection in &document.selections {
                if selection.is_empty() {
                    targets.push(Target::Mapped { anchor: selection.anchor, head: selection.head });
                    continue;
                }
                let range = selection.range();
                let replacement = toggle_case(&document.buffer.slice(range.clone()));
                let len = replacement.len();
                let (anchor, head) = if selection.reversed() { (len, 0) } else { (0, len) };
                targets.push(Target::InEdit { at: range.start, anchor, head });
                edits.push((range, replacement));
            }
            document.apply_edits(edits, targets, EditKind::Other);
        });
    }
}

pub(crate) fn toggle_case(text: &str) -> String {
    if text != text.to_uppercase() { text.to_uppercase() } else { text.to_lowercase() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggles_case() {
        assert_eq!(toggle_case("Hello"), "HELLO");
        assert_eq!(toggle_case("HELLO"), "hello");
        assert_eq!(toggle_case("123"), "123");
    }
}
