//! Lint on save (`lintOnSave`): the linter the file's language extension declares runs on the
//! saved text, and its findings join the file's diagnostics.

use gpui::{AppContext as _, BorrowAppContext as _, Context};
use lsp_client::{DiagnosticsStore, ServerId, lsp};

use crate::Editor;

/// The diagnostics owner linters publish under; language servers count up from 1.
const LINTER: ServerId = ServerId::MAX;

/// A linter finding as an LSP diagnostic (`convertLintDiagnostic`): 1-based positions, hints
/// shown as info.
pub(crate) fn to_lsp(diagnostic: &tooling::Diagnostic) -> lsp::Diagnostic {
    let line = diagnostic.line.saturating_sub(1);
    let column = diagnostic.column.saturating_sub(1);
    let end_line = diagnostic.end_line.unwrap_or(diagnostic.line).saturating_sub(1).max(line);
    let end_column = diagnostic.end_column.unwrap_or(diagnostic.column + 1).saturating_sub(1).max(column + 1);
    let severity = match diagnostic.severity.as_str() {
        "error" => lsp::DiagnosticSeverity::ERROR,
        "warning" => lsp::DiagnosticSeverity::WARNING,
        _ => lsp::DiagnosticSeverity::INFORMATION,
    };
    lsp::Diagnostic {
        range: lsp::Range::new(lsp::Position::new(line, column), lsp::Position::new(end_line, end_column)),
        severity: Some(severity),
        code: diagnostic.code.clone().map(lsp::NumberOrString::String),
        source: Some(diagnostic.source.clone().unwrap_or_else(|| "linter".into())),
        message: diagnostic.message.clone(),
        ..Default::default()
    }
}

impl Editor {
    pub(crate) fn lint_saved(&mut self, cx: &mut Context<Self>) {
        if !settings::get(cx).lint_on_save || !self.fs.is_local() {
            return;
        }
        let Some(plan) = extensions::linter_for_path(&self.path, cx) else { return };
        let Some(uri) = lsp_client::uri::from_path(&self.path) else { return };
        let path = self.path.clone();
        let root = self.lsp.project_root.clone();
        let text = self.document.buffer.text_for_disk();
        let version = self.document.buffer.version();
        self.lint_task = Some(cx.spawn(async move |this, cx| {
            let response = cx.background_spawn(async move { plan.run(&path, &text, root.as_deref()) }).await;
            this.update(cx, |editor, cx| {
                if !response.success || editor.document.buffer.version() != version {
                    return;
                }
                let diagnostics = response.diagnostics.iter().map(to_lsp).collect();
                cx.default_global::<DiagnosticsStore>();
                cx.update_global::<DiagnosticsStore, _>(|store, _| {
                    store.publish(LINTER, lsp::PublishDiagnosticsParams { uri, diagnostics, version: None })
                });
            })
            .ok();
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linter_positions_become_zero_based() {
        let diagnostic = tooling::Diagnostic {
            line: 3,
            column: 5,
            end_line: None,
            end_column: None,
            severity: "hint".into(),
            message: "unused".into(),
            code: Some("no-unused".into()),
            source: None,
        };
        let converted = to_lsp(&diagnostic);
        assert_eq!(converted.range.start, lsp::Position::new(2, 4));
        assert_eq!(converted.range.end, lsp::Position::new(2, 5));
        assert_eq!(converted.severity, Some(lsp::DiagnosticSeverity::INFORMATION));
        assert_eq!(converted.source.as_deref(), Some("linter"));
    }
}
