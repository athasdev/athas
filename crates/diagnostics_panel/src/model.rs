//! What the Problems panel lists: the published diagnostics narrowed by the search, the severity
//! and source filters and "only the current file", sorted and grouped as `diagnostics-pane.tsx`
//! does.

use std::path::{Path, PathBuf};

use lsp_client::{Diagnostic, DiagnosticsStore, Severity};
use serde::{Deserialize, Serialize};

use crate::Filters;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GroupBy {
    #[default]
    File,
    Severity,
    None,
}

impl GroupBy {
    pub const ALL: [GroupBy; 3] = [GroupBy::File, GroupBy::Severity, GroupBy::None];

    pub fn label(self) -> &'static str {
        match self {
            GroupBy::File => "File",
            GroupBy::Severity => "Severity",
            GroupBy::None => "None",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortBy {
    #[default]
    Severity,
    File,
    Position,
}

impl SortBy {
    pub const ALL: [SortBy; 3] = [SortBy::Severity, SortBy::File, SortBy::Position];

    pub fn label(self) -> &'static str {
        match self {
            SortBy::Severity => "Severity",
            SortBy::File => "File",
            SortBy::Position => "Position",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub group_by: GroupBy,
    pub sort_by: SortBy,
    pub only_current_file: bool,
    pub wrap_messages: bool,
    /// The file navigator as a flat list or a tree (`fileNavigatorViewMode`: `flat` or `tree`).
    pub file_navigator_view_mode: NavigatorView,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NavigatorView {
    #[default]
    Flat,
    Tree,
}

/// The pane's preferences as saved (`athas.diagnostics.preferences`); anything unreadable is the
/// defaults.
pub fn read_preferences(path: &Path) -> Preferences {
    std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn write_preferences(path: &Path, preferences: &Preferences) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(preferences) {
        let _ = std::fs::write(path, text);
    }
}

impl Default for Preferences {
    fn default() -> Self {
        Self { group_by: GroupBy::File, sort_by: SortBy::Severity, only_current_file: false, wrap_messages: true, file_navigator_view_mode: NavigatorView::Flat }
    }
}

/// The three buckets the pane counts: errors, warnings, and info with hints.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SeverityCounts {
    pub errors: usize,
    pub warnings: usize,
    pub infos: usize,
}

impl SeverityCounts {
    fn add(&mut self, severity: Severity) {
        match severity {
            Severity::Error => self.errors += 1,
            Severity::Warning => self.warnings += 1,
            Severity::Info | Severity::Hint => self.infos += 1,
        }
    }

    pub fn total(&self) -> usize {
        self.errors + self.warnings + self.infos
    }

    pub fn highest(&self) -> Severity {
        if self.errors > 0 {
            Severity::Error
        } else if self.warnings > 0 {
            Severity::Warning
        } else {
            Severity::Info
        }
    }

    /// `2 errors · 1 warnings`, as the result badge's tooltip.
    pub fn summary(&self) -> String {
        [(self.errors, "errors"), (self.warnings, "warnings"), (self.infos, "info")]
            .into_iter()
            .filter(|(count, _)| *count > 0)
            .map(|(count, label)| format!("{count} {label}"))
            .collect::<Vec<_>>()
            .join(" · ")
    }
}

/// Everything that narrows the list besides the preferences.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Narrowing {
    pub query: String,
    pub source: Option<String>,
    pub filters: Filters,
    pub active_file: Option<PathBuf>,
}

impl Narrowing {
    /// How many filters differ from the defaults (the filter button's count).
    pub fn active_filter_count(&self, preferences: &Preferences) -> usize {
        let defaults = Preferences::default();
        [
            self.source.is_some(),
            !self.filters.errors,
            !self.filters.warnings,
            !self.filters.infos,
            preferences.group_by != defaults.group_by,
            preferences.sort_by != defaults.sort_by,
            preferences.only_current_file != defaults.only_current_file,
        ]
        .into_iter()
        .filter(|changed| *changed)
        .count()
    }

    pub fn has_filters(&self, preferences: &Preferences) -> bool {
        !self.query.trim().is_empty() || self.active_filter_count(preferences) > 0
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Problem {
    pub path: PathBuf,
    pub diagnostic: Diagnostic,
}

impl Problem {
    pub fn line(&self) -> usize {
        self.diagnostic.range.start.line as usize + 1
    }

    pub fn column(&self) -> usize {
        self.diagnostic.range.start.character as usize + 1
    }

    /// `/p/src/a.rs:3:5`.
    pub fn location(&self) -> String {
        format!("{}:{}:{}", self.path.display(), self.line(), self.column())
    }

    /// `buildDiagnosticKey`: tells problems apart for the quick-fix cache.
    pub fn key(&self) -> String {
        let range = self.diagnostic.range;
        format!(
            "{}::{}::{}::{}::{}::{}::{}::{}",
            self.path.display(),
            range.start.line,
            range.start.character,
            range.end.line,
            range.end.character,
            self.diagnostic.message,
            self.diagnostic.code.as_deref().unwrap_or(""),
            self.diagnostic.source.as_deref().unwrap_or("")
        )
    }

    /// "Copy Full Details": location, severity, message, source and code joined by bars.
    pub fn details(&self) -> String {
        let severity = match self.diagnostic.severity {
            Severity::Error => "ERROR",
            Severity::Warning => "WARNING",
            Severity::Info | Severity::Hint => "INFO",
        };
        let mut parts = vec![self.location(), severity.to_string(), self.diagnostic.message.clone()];
        parts.extend(self.diagnostic.source.as_ref().map(|source| format!("source: {source}")));
        parts.extend(self.diagnostic.code.as_ref().map(|code| format!("code: {code}")));
        parts.join(" | ")
    }

    fn matches(&self, query: &str) -> bool {
        let haystack = [
            self.diagnostic.message.as_str(),
            self.diagnostic.source.as_deref().unwrap_or(""),
            self.diagnostic.code.as_deref().unwrap_or(""),
            &self.path.to_string_lossy(),
            &format!("{}:{}", self.line(), self.column()),
        ]
        .join(" ")
        .to_lowercase();
        haystack.contains(query)
    }
}

pub fn severity_rank(severity: Severity) -> u8 {
    match severity {
        Severity::Error => 0,
        Severity::Warning => 1,
        Severity::Info | Severity::Hint => 2,
    }
}

/// Every published problem and the counts by severity before narrowing.
pub fn all_problems(store: &DiagnosticsStore) -> (Vec<Problem>, SeverityCounts) {
    let mut counts = SeverityCounts::default();
    let problems = store
        .files()
        .flat_map(|(path, diagnostics)| diagnostics.into_iter().map(move |diagnostic| Problem { path: path.to_path_buf(), diagnostic: diagnostic.clone() }))
        .inspect(|problem| counts.add(problem.diagnostic.severity))
        .collect();
    (problems, counts)
}

/// The problems left after narrowing, sorted, at most `limit` of them.
pub fn narrow(problems: &[Problem], narrowing: &Narrowing, preferences: &Preferences, limit: usize) -> Vec<Problem> {
    let query = narrowing.query.trim().to_lowercase();
    let source = narrowing.source.as_ref().map(|source| source.to_lowercase());
    let current = narrowing.active_file.as_ref().filter(|_| preferences.only_current_file).map(|path| path.to_string_lossy().to_lowercase());
    let mut kept: Vec<Problem> = problems
        .iter()
        .filter(|problem| narrowing.filters.allows(problem.diagnostic.severity))
        .filter(|problem| current.as_ref().is_none_or(|current| problem.path.to_string_lossy().to_lowercase() == *current))
        .filter(|problem| source.as_ref().is_none_or(|source| problem.diagnostic.source.as_deref().unwrap_or("").to_lowercase() == *source))
        .filter(|problem| query.is_empty() || problem.matches(&query))
        .cloned()
        .collect();
    let sort_by = preferences.sort_by;
    kept.sort_by(|left, right| {
        let severity = if sort_by == SortBy::Severity { severity_rank(left.diagnostic.severity).cmp(&severity_rank(right.diagnostic.severity)) } else { std::cmp::Ordering::Equal };
        let file = if sort_by != SortBy::Position { left.path.cmp(&right.path) } else { std::cmp::Ordering::Equal };
        severity
            .then(file)
            .then(left.diagnostic.range.start.line.cmp(&right.diagnostic.range.start.line))
            .then(left.diagnostic.range.start.character.cmp(&right.diagnostic.range.start.character))
    });
    kept.truncate(limit);
    kept
}

pub fn count(problems: &[Problem]) -> SeverityCounts {
    let mut counts = SeverityCounts::default();
    for problem in problems {
        counts.add(problem.diagnostic.severity);
    }
    counts
}

#[derive(Clone, Debug, PartialEq)]
pub struct Group {
    pub id: String,
    pub label: String,
    pub severity: Option<Severity>,
    pub path: Option<PathBuf>,
    /// Indices into the narrowed problems.
    pub items: Vec<usize>,
}

/// The groups the list shows: by file (sorted by path), by severity, or one group of all.
pub fn group(problems: &[Problem], group_by: GroupBy) -> Vec<Group> {
    match group_by {
        GroupBy::None => vec![Group { id: "all".into(), label: "All Diagnostics".into(), severity: None, path: None, items: (0..problems.len()).collect() }],
        GroupBy::Severity => [(Severity::Error, "Errors"), (Severity::Warning, "Warnings"), (Severity::Info, "Info")]
            .into_iter()
            .map(|(severity, label)| Group {
                id: format!("severity-{}", severity.label().to_lowercase()),
                label: label.into(),
                severity: Some(severity),
                path: None,
                items: problems.iter().enumerate().filter(|(_, problem)| severity_rank(problem.diagnostic.severity) == severity_rank(severity)).map(|(index, _)| index).collect(),
            })
            .filter(|group| !group.items.is_empty())
            .collect(),
        GroupBy::File => {
            let mut groups: Vec<Group> = Vec::new();
            let mut order: Vec<usize> = (0..problems.len()).collect();
            order.sort_by(|a, b| problems[*a].path.cmp(&problems[*b].path));
            for index in order {
                let path = &problems[index].path;
                match groups.last_mut() {
                    Some(group) if group.path.as_deref() == Some(path.as_path()) => group.items.push(index),
                    _ => groups.push(Group { id: format!("file-{}", path.display()), label: path.to_string_lossy().into_owned(), severity: None, path: Some(path.clone()), items: vec![index] }),
                }
            }
            groups
        }
    }
}

/// `getDiagnosticNavigatorPath`: relative to the project, or the file name outside it.
pub fn navigator_path(path: &Path, root: Option<&Path>) -> String {
    match root.and_then(|root| path.strip_prefix(root).ok()) {
        Some(relative) if !relative.as_os_str().is_empty() => relative.to_string_lossy().into_owned(),
        _ if path.is_absolute() => path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned()),
        _ => path.to_string_lossy().into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use lsp_client::lsp::{self, DiagnosticSeverity, NumberOrString, Position, PublishDiagnosticsParams, Range, Url};

    use super::*;

    #[test]
    fn preferences_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!("athas-diagnostics-prefs-{}", std::process::id()));
        let path = dir.join("diagnostics-preferences.json");
        assert_eq!(read_preferences(&path), Preferences::default());
        let chosen = Preferences {
            group_by: GroupBy::Severity,
            sort_by: SortBy::Position,
            only_current_file: true,
            wrap_messages: false,
            file_navigator_view_mode: NavigatorView::Tree,
        };
        write_preferences(&path, &chosen);
        assert_eq!(read_preferences(&path), chosen);
        std::fs::write(&path, r#"{"groupBy":"none"}"#).unwrap();
        assert_eq!(read_preferences(&path), Preferences { group_by: GroupBy::None, ..Preferences::default() });
        std::fs::write(&path, r#"{"fileNavigatorViewMode":"tree"}"#).unwrap();
        assert_eq!(read_preferences(&path).file_navigator_view_mode, NavigatorView::Tree);
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(read_preferences(&path), Preferences::default());
        std::fs::remove_dir_all(dir).ok();
    }

    fn store() -> DiagnosticsStore {
        let mut store = DiagnosticsStore::default();
        let diagnostic = |line: u32, column: u32, severity: DiagnosticSeverity, message: &str, source: &str| lsp::Diagnostic {
            range: Range::new(Position::new(line, column), Position::new(line, column + 1)),
            severity: Some(severity),
            message: message.into(),
            source: Some(source.into()),
            code: Some(NumberOrString::String("E0308".into())),
            ..Default::default()
        };
        store.publish(
            1,
            PublishDiagnosticsParams {
                uri: Url::from_file_path("/p/src/b.rs").unwrap(),
                diagnostics: vec![diagnostic(9, 0, DiagnosticSeverity::WARNING, "unused variable", "rustc"), diagnostic(2, 4, DiagnosticSeverity::ERROR, "mismatched types", "rustc")],
                version: None,
            },
        );
        store.publish(
            1,
            PublishDiagnosticsParams {
                uri: Url::from_file_path("/p/src/a.rs").unwrap(),
                diagnostics: vec![diagnostic(5, 1, DiagnosticSeverity::HINT, "consider borrowing", "clippy")],
                version: None,
            },
        );
        store
    }

    fn messages(problems: &[Problem]) -> Vec<&str> {
        problems.iter().map(|problem| problem.diagnostic.message.as_str()).collect()
    }

    #[test]
    fn sorts_by_severity_then_file_then_position() {
        let (all, total) = all_problems(&store());
        assert_eq!(total, SeverityCounts { errors: 1, warnings: 1, infos: 1 });
        let preferences = Preferences::default();
        let narrowed = narrow(&all, &Narrowing::default(), &preferences, 100);
        assert_eq!(messages(&narrowed), ["mismatched types", "unused variable", "consider borrowing"]);
        let by_file = narrow(&all, &Narrowing::default(), &Preferences { sort_by: SortBy::File, ..preferences }, 100);
        assert_eq!(messages(&by_file), ["consider borrowing", "mismatched types", "unused variable"]);
        let by_position = narrow(&all, &Narrowing::default(), &Preferences { sort_by: SortBy::Position, ..preferences }, 100);
        assert_eq!(messages(&by_position), ["mismatched types", "consider borrowing", "unused variable"]);
        assert_eq!(narrow(&all, &Narrowing::default(), &preferences, 2).len(), 2);
    }

    #[test]
    fn narrows_by_search_source_severity_and_current_file() {
        let (all, _) = all_problems(&store());
        let preferences = Preferences::default();
        let search = |query: &str| messages(&narrow(&all, &Narrowing { query: query.into(), ..Default::default() }, &preferences, 100)).len();
        assert_eq!(search("MISMATCHED"), 1);
        assert_eq!(search("clippy"), 1);
        assert_eq!(search("e0308"), 3);
        assert_eq!(search("3:5"), 1);
        assert_eq!(search("src/b.rs"), 2);

        let source = Narrowing { source: Some("RUSTC".into()), ..Default::default() };
        assert_eq!(narrow(&all, &source, &preferences, 100).len(), 2);
        assert_eq!(source.active_filter_count(&preferences), 1);

        let errors = Narrowing { filters: Filters { errors: true, warnings: false, infos: false }, ..Default::default() };
        assert_eq!(messages(&narrow(&all, &errors, &preferences, 100)), ["mismatched types"]);
        assert_eq!(errors.active_filter_count(&preferences), 2);

        let current = Narrowing { active_file: Some("/p/src/a.rs".into()), ..Default::default() };
        assert_eq!(narrow(&all, &current, &preferences, 100).len(), 3, "only with the preference on");
        let only = Preferences { only_current_file: true, ..preferences };
        assert_eq!(messages(&narrow(&all, &current, &only, 100)), ["consider borrowing"]);
        assert_eq!(current.active_filter_count(&only), 1);
        assert!(Narrowing { query: "x".into(), ..Default::default() }.has_filters(&preferences));
        assert!(!Narrowing::default().has_filters(&preferences));
    }

    #[test]
    fn groups_by_file_severity_or_not_at_all() {
        let (all, _) = all_problems(&store());
        let narrowed = narrow(&all, &Narrowing::default(), &Preferences::default(), 100);
        let by_file = group(&narrowed, GroupBy::File);
        assert_eq!(by_file.iter().map(|group| (group.label.as_str(), group.items.len())).collect::<Vec<_>>(), [("/p/src/a.rs", 1), ("/p/src/b.rs", 2)]);
        let by_severity = group(&narrowed, GroupBy::Severity);
        assert_eq!(by_severity.iter().map(|group| group.label.as_str()).collect::<Vec<_>>(), ["Errors", "Warnings", "Info"]);
        let none = group(&narrowed, GroupBy::None);
        assert_eq!((none.len(), none[0].label.as_str(), none[0].items.len()), (1, "All Diagnostics", 3));
        assert_eq!(count(&narrowed).summary(), "1 errors · 1 warnings · 1 info");
    }

    #[test]
    fn copies_and_paths_read_like_athas() {
        let (all, _) = all_problems(&store());
        let error = all.iter().find(|problem| problem.diagnostic.severity == Severity::Error).unwrap();
        assert_eq!(error.location(), "/p/src/b.rs:3:5");
        assert_eq!(error.details(), "/p/src/b.rs:3:5 | ERROR | mismatched types | source: rustc | code: E0308");
        assert_ne!(error.key(), all.iter().find(|problem| problem.diagnostic.severity == Severity::Warning).unwrap().key());
        assert_eq!(navigator_path(Path::new("/p/src/a.rs"), Some(Path::new("/p"))), "src/a.rs");
        assert_eq!(navigator_path(Path::new("/q/a.rs"), Some(Path::new("/p"))), "a.rs");
        assert_eq!(navigator_path(Path::new("rel/a.rs"), None), "rel/a.rs");
    }
}
