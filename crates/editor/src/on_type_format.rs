//! Format as you type (`use-on-type-formatting.ts`): typing `;`, `}` or a line break asks the
//! server for `textDocument/onTypeFormatting` when it lists that character, and applies its edits
//! as one change. Off unless `formatOnType` is set in settings.json, as in the original.

use gpui::{Context, Task};
use lsp_client::{lsp, offset_to_position};

use crate::Editor;

#[derive(Default)]
pub(crate) struct OnTypeFormatState {
    task: Option<Task<()>>,
}

/// The trigger a typed text is: a single `;` or `}`, or a line break with only indentation after.
pub(crate) fn trigger_for(text: &str) -> Option<&'static str> {
    match text {
        ";" => Some(";"),
        "}" => Some("}"),
        _ if (text.starts_with('\n') || text.starts_with("\r\n")) && text.trim_start_matches(['\r', '\n']).chars().all(|ch| ch == ' ' || ch == '\t') => {
            (text.matches('\n').count() == 1).then_some("\n")
        }
        _ => None,
    }
}

fn server_triggers(options: &lsp::DocumentOnTypeFormattingOptions) -> impl Iterator<Item = &str> {
    std::iter::once(options.first_trigger_character.as_str()).chain(options.more_trigger_character.iter().flatten().map(String::as_str))
}

impl Editor {
    /// After `text` was typed (or a line break inserted) with one caret.
    pub(crate) fn format_on_type(&mut self, text: &str, cx: &mut Context<Self>) {
        let Some(trigger) = trigger_for(text) else { return };
        if self.document.read_only || self.document.selections.len() != 1 {
            return;
        }
        if settings::get(cx).extra.get("formatOnType") != Some(&serde_json::Value::Bool(true)) {
            return;
        }
        let Some(document) = self.lsp.document.clone() else { return };
        let listed = document
            .server()
            .capabilities()
            .and_then(|capabilities| capabilities.document_on_type_formatting_provider.as_ref())
            .is_some_and(|options| server_triggers(options).any(|character| character == trigger));
        if !listed {
            return;
        }
        let version = self.document.buffer.version();
        let position = offset_to_position(self.document.buffer.rope(), self.document.newest_selection().head);
        let request = document.server().request::<lsp::request::OnTypeFormatting>(lsp::DocumentOnTypeFormattingParams {
            text_document_position: lsp::TextDocumentPositionParams { text_document: document.identifier(), position },
            ch: trigger.to_string(),
            options: lsp::FormattingOptions { tab_size: self.document.tab_size as u32, insert_spaces: !self.document.hard_tabs, ..Default::default() },
        });
        self.on_type_format.task = Some(cx.spawn(async move |this, cx| {
            let Ok(Some(edits)) = request.await else { return };
            this.update(cx, |editor, cx| {
                if !edits.is_empty() && editor.document.buffer.version() == version {
                    editor.apply_lsp_edits(&edits, cx);
                }
            })
            .ok();
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triggers() {
        assert_eq!(trigger_for(";"), Some(";"));
        assert_eq!(trigger_for("}"), Some("}"));
        assert_eq!(trigger_for("\n    "), Some("\n"));
        assert_eq!(trigger_for("\r\n\t"), Some("\n"));
        assert_eq!(trigger_for("\n\n"), None);
        assert_eq!(trigger_for("a;"), None);
        assert_eq!(trigger_for("\nfoo"), None);
    }
}
