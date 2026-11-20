//! Diagnostics the servers publish, per file and server, for the editor's squiggles and the
//! Problems panel. Observe the `DiagnosticsStore` global to hear about changes.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use gpui::Global;
use lsp_types::{DiagnosticSeverity, NumberOrString, PublishDiagnosticsParams};

use crate::server::ServerId;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Severity {
    Error,
    Warning,
    Info,
    Hint,
}

impl Severity {
    pub fn from_lsp(severity: Option<DiagnosticSeverity>) -> Self {
        match severity {
            Some(DiagnosticSeverity::WARNING) => Severity::Warning,
            Some(DiagnosticSeverity::INFORMATION) => Severity::Info,
            Some(DiagnosticSeverity::HINT) => Severity::Hint,
            // Servers that leave it out mean an error.
            _ => Severity::Error,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Severity::Error => "Error",
            Severity::Warning => "Warning",
            Severity::Info => "Info",
            Severity::Hint => "Hint",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Diagnostic {
    pub range: lsp_types::Range,
    pub severity: Severity,
    pub message: String,
    pub source: Option<String>,
    pub code: Option<String>,
    /// The diagnostic as the server sent it, for code action requests.
    pub raw: lsp_types::Diagnostic,
}

impl Diagnostic {
    pub fn from_lsp(diagnostic: lsp_types::Diagnostic) -> Self {
        Self {
            range: diagnostic.range,
            severity: Severity::from_lsp(diagnostic.severity),
            message: diagnostic.message.trim().to_string(),
            source: diagnostic.source.clone(),
            code: diagnostic.code.as_ref().map(|code| match code {
                NumberOrString::Number(number) => number.to_string(),
                NumberOrString::String(text) => text.clone(),
            }),
            raw: diagnostic,
        }
    }

    /// `rustc(E0308)` style label for the source and code.
    pub fn origin(&self) -> Option<String> {
        match (&self.source, &self.code) {
            (Some(source), Some(code)) => Some(format!("{source}({code})")),
            (Some(source), None) => Some(source.clone()),
            (None, Some(code)) => Some(code.clone()),
            (None, None) => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub errors: usize,
    pub warnings: usize,
    pub infos: usize,
    pub hints: usize,
}

impl Counts {
    fn add(&mut self, severity: Severity) {
        match severity {
            Severity::Error => self.errors += 1,
            Severity::Warning => self.warnings += 1,
            Severity::Info => self.infos += 1,
            Severity::Hint => self.hints += 1,
        }
    }
}

#[derive(Default)]
pub struct DiagnosticsStore {
    files: BTreeMap<PathBuf, BTreeMap<ServerId, Vec<Diagnostic>>>,
    /// Bumped on every change, so views can cache by it.
    generation: u64,
    /// The generation each file last changed at: an editor keeps the diagnostics it moved
    /// through its own edits until the server reports this file again.
    file_generations: std::collections::HashMap<PathBuf, u64>,
}

impl Global for DiagnosticsStore {}

impl DiagnosticsStore {
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// When `path`'s diagnostics last changed (0 for never).
    pub fn generation_for(&self, path: &Path) -> u64 {
        self.file_generations.get(path).copied().unwrap_or(0)
    }

    /// Replaces what one server reported for a file.
    pub fn publish(&mut self, server: ServerId, params: PublishDiagnosticsParams) {
        let Some(path) = crate::uri::to_path(&params.uri) else { return };
        let mut diagnostics: Vec<Diagnostic> = params.diagnostics.into_iter().map(Diagnostic::from_lsp).collect();
        diagnostics.sort_by_key(|diagnostic| (diagnostic.range.start.line, diagnostic.range.start.character, diagnostic.severity));
        let file = self.files.entry(path.clone()).or_default();
        if diagnostics.is_empty() {
            if file.remove(&server).is_none() {
                if file.is_empty() {
                    self.files.remove(&path);
                }
                return;
            }
        } else {
            file.insert(server, diagnostics);
        }
        if file.is_empty() {
            self.files.remove(&path);
        }
        self.generation += 1;
        self.file_generations.insert(path, self.generation);
    }

    /// Drops everything a server reported (it exited).
    pub fn clear_server(&mut self, server: ServerId) {
        let before = self.files.len();
        let mut changed = false;
        let mut touched = Vec::new();
        self.files.retain(|path, file| {
            if file.remove(&server).is_some() {
                changed = true;
                touched.push(path.clone());
            }
            !file.is_empty()
        });
        if changed || before != self.files.len() {
            self.generation += 1;
            for path in touched {
                self.file_generations.insert(path, self.generation);
            }
        }
    }

    /// A file's diagnostics from every server, in position order.
    pub fn for_path(&self, path: &Path) -> Vec<Diagnostic> {
        let mut all: Vec<Diagnostic> = self.files.get(path).into_iter().flat_map(|file| file.values().flatten().cloned()).collect();
        all.sort_by_key(|diagnostic| (diagnostic.range.start.line, diagnostic.range.start.character, diagnostic.severity));
        all
    }

    /// Every file with diagnostics, sorted by path.
    pub fn files(&self) -> impl Iterator<Item = (&Path, Vec<&Diagnostic>)> {
        self.files.iter().map(|(path, servers)| {
            let mut all: Vec<&Diagnostic> = servers.values().flatten().collect();
            all.sort_by_key(|diagnostic| (diagnostic.range.start.line, diagnostic.range.start.character, diagnostic.severity));
            (path.as_path(), all)
        })
    }

    pub fn counts(&self) -> Counts {
        let mut counts = Counts::default();
        for servers in self.files.values() {
            for diagnostic in servers.values().flatten() {
                counts.add(diagnostic.severity);
            }
        }
        counts
    }
}

#[cfg(test)]
mod tests {
    use lsp_types::{Position, Range, Url};

    use super::*;

    fn diagnostic(line: u32, severity: Option<DiagnosticSeverity>, message: &str) -> lsp_types::Diagnostic {
        lsp_types::Diagnostic {
            range: Range::new(Position::new(line, 0), Position::new(line, 3)),
            severity,
            message: message.into(),
            source: Some("rustc".into()),
            code: Some(NumberOrString::String("E0308".into())),
            ..Default::default()
        }
    }

    fn publish(store: &mut DiagnosticsStore, server: ServerId, path: &str, diagnostics: Vec<lsp_types::Diagnostic>) {
        store.publish(server, PublishDiagnosticsParams { uri: Url::from_file_path(path).unwrap(), diagnostics, version: None });
    }

    #[test]
    fn merges_servers_and_maps_severities() {
        let mut store = DiagnosticsStore::default();
        publish(&mut store, 1, "/p/a.rs", vec![diagnostic(4, Some(DiagnosticSeverity::WARNING), "unused"), diagnostic(1, None, " mismatched types\n")]);
        publish(&mut store, 2, "/p/a.rs", vec![diagnostic(2, Some(DiagnosticSeverity::HINT), "hint")]);
        let all = store.for_path(Path::new("/p/a.rs"));
        assert_eq!(all.iter().map(|diagnostic| diagnostic.severity).collect::<Vec<_>>(), [Severity::Error, Severity::Hint, Severity::Warning]);
        assert_eq!(all[0].message, "mismatched types");
        assert_eq!(all[0].origin().as_deref(), Some("rustc(E0308)"));
        assert_eq!(store.counts(), Counts { errors: 1, warnings: 1, infos: 0, hints: 1 });

        let generation = store.generation();
        publish(&mut store, 1, "/p/a.rs", Vec::new());
        assert!(store.generation() > generation);
        assert_eq!(store.for_path(Path::new("/p/a.rs")).len(), 1);
        store.clear_server(2);
        assert_eq!(store.files().count(), 0);
        let generation = store.generation();
        publish(&mut store, 1, "/p/b.rs", Vec::new());
        assert_eq!(store.generation(), generation, "clearing nothing changes nothing");
    }
}
