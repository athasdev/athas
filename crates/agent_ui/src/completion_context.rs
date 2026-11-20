//! What Tab autocomplete sends besides the text around the cursor
//! (`intelligence/services/intelligence-completion-context.ts`): the lines of the user's latest
//! edits elsewhere, errors and warnings near the cursor, and summaries of other open files, first
//! those the file imports. Sensitive files are never sent.

use std::path::Path;

use ai_providers::{ContextSnippet, NearbyDiagnostic};
use gpui::{App, Global};

const MAX_RECENT_EDITS: usize = 5;
const MAX_SNIPPET_CHARS: usize = 400;
const SNIPPET_CONTEXT_LINES: usize = 1;
const MAX_DIAGNOSTICS: usize = 5;
const DIAGNOSTIC_LINE_WINDOW: u32 = 20;
const MAX_DIAGNOSTIC_MESSAGE_CHARS: usize = 300;
const MAX_RELATED_FILES: usize = 3;
const MAX_RELATED_SNIPPET_CHARS: usize = 1200;
const MAX_RELATED_LINE_CHARS: usize = 160;
const RELATED_FALLBACK_LINES: usize = 30;
/// Open files larger than this are not read for related-file summaries.
pub const MAX_RELATED_FILE_BYTES: u64 = 512 * 1024;

/// `.env` files and keys (`SENSITIVE_FILE_PATTERN`).
pub fn is_sensitive(path: &str) -> bool {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase();
    name == ".env" || name.starts_with(".env.") || [".pem", ".key", ".p12", ".pfx"].iter().any(|ext| name.len() > ext.len() && name.ends_with(ext))
}

struct RecentEdit {
    file_path: String,
    snippet: String,
    line: usize,
}

/// The latest edits, at most five, oldest first.
#[derive(Default)]
pub struct RecentEdits(Vec<RecentEdit>);

impl Global for RecentEdits {}

impl RecentEdits {
    /// Notes the lines around an edit at 1-based `start_line` that inserted `inserted`; an edit
    /// within two lines of the last one in the same file replaces it.
    pub fn record(&mut self, file_path: &str, lines: &[&str], start_line: usize, inserted: &str) {
        if file_path.is_empty() || is_sensitive(file_path) || lines.is_empty() {
            return;
        }
        let inserted_lines = inserted.split('\n').count() - 1;
        let first = start_line.saturating_sub(SNIPPET_CONTEXT_LINES).max(1);
        let last = (start_line + inserted_lines + SNIPPET_CONTEXT_LINES).min(lines.len());
        let snippet: String = lines.get(first - 1..last).unwrap_or_default().join("\n").chars().take(MAX_SNIPPET_CHARS).collect();
        if snippet.trim().is_empty() {
            return;
        }
        if self.0.last().is_some_and(|last| last.file_path == file_path && last.line.abs_diff(start_line) <= 2) {
            self.0.pop();
        }
        self.0.push(RecentEdit { file_path: file_path.to_string(), snippet, line: start_line });
        if self.0.len() > MAX_RECENT_EDITS {
            self.0.remove(0);
        }
    }

    /// Edits other than the one at the cursor: the edit being typed is in the prefix already.
    pub fn others(&self, file_path: &str, line: usize) -> Vec<ContextSnippet> {
        self.0
            .iter()
            .filter(|edit| edit.file_path != file_path || edit.line.abs_diff(line) > 2)
            .map(|edit| ContextSnippet { file_path: edit.file_path.clone(), snippet: edit.snippet.clone() })
            .collect()
    }
}

/// The recent edits to send for a completion at `line` of `file_path`, then this edit noted
/// (the editor asks once typing pauses, so the cursor is where the user just edited).
pub fn take_recent_edits(cx: &mut App, file_path: &str, before_cursor: &str, after_cursor: &str) -> Vec<ContextSnippet> {
    let line = before_cursor.matches('\n').count() + 1;
    let edits = cx.default_global::<RecentEdits>();
    let others = edits.others(file_path, line);
    let head: Vec<&str> = before_cursor.rsplit('\n').take(SNIPPET_CONTEXT_LINES + 1).collect::<Vec<_>>().into_iter().rev().collect();
    let tail: Vec<&str> = after_cursor.split('\n').take(SNIPPET_CONTEXT_LINES + 1).collect();
    let mut lines: Vec<String> = head.iter().map(|line| line.to_string()).collect();
    if let (Some(last), Some(first)) = (lines.last_mut(), tail.first()) {
        last.push_str(first);
    }
    lines.extend(tail.iter().skip(1).map(|line| line.to_string()));
    let start = line - (head.len() - 1);
    let window: Vec<&str> = lines.iter().map(String::as_str).collect();
    // `window` holds lines `start..`; pad so `record` reads them at their real numbers.
    let padded: Vec<&str> = std::iter::repeat_n("", start - 1).chain(window).collect();
    edits.record(file_path, &padded, line, "");
    others
}

fn severity_rank(severity: &str) -> u8 {
    match severity {
        "error" => 3,
        "warning" => 2,
        _ => 1,
    }
}

/// Errors and warnings within 20 lines of 1-based `line`, closest and most severe first.
pub fn nearby_diagnostics(problems: &[crate::context_refs::Problem], path: &Path, line: u32) -> Vec<NearbyDiagnostic> {
    let mut near: Vec<(u32, &crate::context_refs::Problem)> = problems
        .iter()
        .filter(|problem| problem.path == path && severity_rank(problem.severity) >= 2)
        .map(|problem| (problem.line + 1, problem))
        .filter(|(at, _)| at.abs_diff(line) <= DIAGNOSTIC_LINE_WINDOW)
        .collect();
    near.sort_by(|(a, left), (b, right)| a.abs_diff(line).cmp(&b.abs_diff(line)).then(severity_rank(right.severity).cmp(&severity_rank(left.severity))));
    near.into_iter()
        .take(MAX_DIAGNOSTICS)
        .map(|(at, problem)| NearbyDiagnostic { line: at, severity: problem.severity.to_string(), message: problem.message.chars().take(MAX_DIAGNOSTIC_MESSAGE_CHARS).collect() })
        .collect()
}

/// An open file that may tell the model which APIs exist.
pub struct RelatedCandidate {
    pub path: String,
    pub content: String,
}

fn file_stem(path: &str) -> String {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    match name.rfind('.') {
        Some(dot) => &name[..dot],
        None => name,
    }
    .to_lowercase()
}

fn extension(path: &str) -> Option<String> {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    name.rfind('.').map(|dot| name[dot + 1..].to_ascii_lowercase())
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// The specifiers after `from`, `import`, `require(` and `import(`, as quoted strings.
fn quoted_specifiers(text: &str) -> Vec<String> {
    let mut specifiers = Vec::new();
    for keyword in ["from", "import", "require(", "import("] {
        let mut from = 0;
        while let Some(found) = text[from..].find(keyword) {
            let start = from + found;
            from = start + keyword.len();
            if text[..start].chars().next_back().is_some_and(is_word) {
                continue;
            }
            let rest = &text[from..];
            let trimmed = rest.trim_start();
            let gap = rest.len() - trimmed.len();
            if !keyword.ends_with('(') && gap == 0 {
                continue;
            }
            let Some(quote) = trimmed.chars().next().filter(|c| *c == '"' || *c == '\'') else { continue };
            if let Some(end) = trimmed[1..].find(['"', '\'']) {
                let specifier = &trimmed[1..1 + end];
                if trimmed[1 + end..].starts_with(quote) && !specifier.is_empty() {
                    specifiers.push((start, specifier.to_string()));
                }
            }
        }
    }
    specifiers.sort();
    specifiers.into_iter().map(|(_, specifier)| specifier).collect()
}

/// `from x.y import` and `import x.y` at the start of a line.
fn python_modules(text: &str) -> Vec<String> {
    let module = |rest: &str| rest.chars().take_while(|c| is_word(*c) || *c == '.').collect::<String>();
    text.lines()
        .filter_map(|line| {
            let line = line.trim_start();
            if let Some(rest) = line.strip_prefix("from").filter(|rest| rest.starts_with(char::is_whitespace)) {
                let name = module(rest.trim_start());
                let after = rest.trim_start()[name.len()..].trim_start();
                return (!name.is_empty() && after.starts_with("import") && rest.trim_start()[name.len()..].starts_with(char::is_whitespace)).then_some(name);
            }
            let rest = line.strip_prefix("import").filter(|rest| rest.starts_with(char::is_whitespace))?;
            Some(module(rest.trim_start())).filter(|name| !name.is_empty())
        })
        .collect()
}

/// The last path segment each import names, in order; `./components` reads as its folder.
fn imported_stems(text: &str) -> Vec<String> {
    let mut stems: Vec<String> = Vec::new();
    let mut add = |specifier: &str, separator: char| {
        let mut segments: Vec<&str> = specifier.split(separator).filter(|segment| !segment.is_empty() && *segment != ".").collect();
        let Some(last) = segments.pop() else { return };
        let last = match last.rfind('.') {
            Some(dot) if separator == '/' => &last[..dot],
            _ => last,
        }
        .to_lowercase();
        if last.is_empty() || last == ".." {
            return;
        }
        let stem = if last == "index" { segments.pop().map_or(last, str::to_lowercase) } else { last };
        if !stems.contains(&stem) {
            stems.push(stem);
        }
    };
    for specifier in quoted_specifiers(text) {
        add(&specifier, '/');
    }
    for module in python_modules(text) {
        add(&module, '.');
    }
    stems
}

const DECLARATION_STARTS: &[&str] = &[
    "export ", "function ", "async function ", "class ", "interface ", "enum ", "def ", "fn ", "struct ", "trait ", "func ", "module ", "public ", "protected ", "abstract ",
];

fn is_declaration(line: &str) -> bool {
    let line = line.trim_start();
    if DECLARATION_STARTS.iter().any(|start| line.starts_with(start)) {
        return true;
    }
    if line.starts_with("pub ") || (line.starts_with("pub(") && line.find(')').is_some_and(|close| line[close + 1..].starts_with(' '))) {
        return true;
    }
    if line.strip_prefix("type ").is_some_and(|rest| rest.trim_start().starts_with(is_word)) {
        return true;
    }
    line.strip_prefix("impl").is_some_and(|rest| !rest.starts_with(is_word))
}

/// A file's declarations, or its opening lines when it has none (`summarizeRelatedFile`).
pub fn summarize_related_file(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let declarations: Vec<&str> = lines.iter().copied().filter(|line| is_declaration(line)).collect();
    let picked = if declarations.is_empty() { lines.into_iter().take(RELATED_FALLBACK_LINES).collect() } else { declarations };
    let mut snippet = String::new();
    for line in picked {
        let trimmed: String = line.trim_end().chars().take(MAX_RELATED_LINE_CHARS).collect();
        if trimmed.trim().is_empty() {
            continue;
        }
        if snippet.len() + trimmed.len() + 1 > MAX_RELATED_SNIPPET_CHARS {
            break;
        }
        snippet.push_str(&trimmed);
        snippet.push('\n');
    }
    snippet.trim_end().to_string()
}

/// Up to three other open files: those the text before the cursor imports, then the latest
/// opened in the same language.
pub fn related_file_snippets(file_path: &str, before_cursor: &str, candidates: &[RelatedCandidate]) -> Vec<ContextSnippet> {
    let usable: Vec<&RelatedCandidate> =
        candidates.iter().filter(|candidate| !candidate.path.is_empty() && candidate.path != file_path && !candidate.content.trim().is_empty() && !is_sensitive(&candidate.path)).collect();
    let imported = imported_stems(before_cursor).into_iter().flat_map(|stem| {
        usable
            .iter()
            .copied()
            .filter(|candidate| {
                if file_stem(&candidate.path) == stem {
                    return true;
                }
                let parts: Vec<&str> = candidate.path.split(['/', '\\']).collect();
                file_stem(&candidate.path) == "index" && parts.len() >= 2 && parts[parts.len() - 2].to_lowercase() == stem
            })
            .collect::<Vec<_>>()
    });
    let language = extension(file_path);
    let same_language: Vec<&RelatedCandidate> =
        if language.is_some() { usable.iter().rev().copied().filter(|candidate| extension(&candidate.path) == language).collect() } else { Vec::new() };
    let mut related = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for candidate in imported.collect::<Vec<_>>().into_iter().chain(same_language) {
        if related.len() >= MAX_RELATED_FILES {
            break;
        }
        if seen.contains(&candidate.path.as_str()) {
            continue;
        }
        seen.push(&candidate.path);
        let snippet = summarize_related_file(&candidate.content);
        if !snippet.is_empty() {
            related.push(ContextSnippet { file_path: candidate.path.clone(), snippet });
        }
    }
    related
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_edits_skip_the_one_at_the_cursor() {
        let mut edits = RecentEdits::default();
        let lines = ["a", "b", "c", "d", "e", "f", "g"];
        edits.record("/p/a.rs", &lines, 2, "");
        edits.record("/p/a.rs", &lines, 3, "x\ny");
        assert_eq!(edits.0.len(), 1);
        assert_eq!(edits.0[0].snippet, "b\nc\nd\ne");
        edits.record("/p/b.rs", &lines, 6, "");
        edits.record("/p/.env", &lines, 1, "");
        let others = edits.others("/p/a.rs", 3);
        assert_eq!(others.len(), 1);
        assert_eq!(others[0].file_path, "/p/b.rs");
        assert_eq!(others[0].snippet, "e\nf\ng");
        assert_eq!(edits.others("/p/a.rs", 9).len(), 2);
    }

    #[test]
    fn sensitive_files_are_recognised() {
        assert!(is_sensitive("/p/.env"));
        assert!(is_sensitive("/p/.env.local"));
        assert!(is_sensitive("C:\\keys\\server.PEM"));
        assert!(!is_sensitive("/p/src/env.rs"));
    }

    #[test]
    fn imports_name_the_files_they_use() {
        let text = "import React from 'react';\nimport { Button } from \"./components\";\nconst x = require('../lib/api.js');\nfrom app.models import User\n";
        assert_eq!(imported_stems(text), ["react", "components", "api", "models"]);
        assert_eq!(imported_stems("import { a } from './widgets/index'"), ["widgets"]);
    }

    #[test]
    fn related_files_prefer_imports_then_the_same_language() {
        let candidates = vec![
            RelatedCandidate { path: "/p/src/other.ts".into(), content: "export const other = 1;".into() },
            RelatedCandidate { path: "/p/src/api.ts".into(), content: "// helpers\nexport function get() {}\nconst hidden = 1;\n".into() },
            RelatedCandidate { path: "/p/.env".into(), content: "SECRET=1".into() },
            RelatedCandidate { path: "/p/src/main.ts".into(), content: "export {}".into() },
        ];
        let related = related_file_snippets("/p/src/main.ts", "import { get } from './api';\n", &candidates);
        assert_eq!(related.iter().map(|file| file.file_path.as_str()).collect::<Vec<_>>(), ["/p/src/api.ts", "/p/src/other.ts"]);
        assert_eq!(related[0].snippet, "export function get() {}");
        assert_eq!(summarize_related_file("a\n\nb"), "a\nb");
        assert!(is_declaration("pub(crate) fn x()"));
        assert!(is_declaration("impl Foo {"));
        assert!(!is_declaration("implement"));
    }

    #[test]
    fn diagnostics_near_the_cursor_come_closest_first() {
        let problem = |line: u32, severity: &'static str| crate::context_refs::Problem { path: "/p/a.rs".into(), line, column: 0, severity, message: format!("{severity} {line}"), origin: None };
        let problems = vec![problem(30, "error"), problem(9, "warning"), problem(11, "error"), problem(10, "info"), problem(80, "error")];
        let near = nearby_diagnostics(&problems, Path::new("/p/a.rs"), 11);
        assert_eq!(near.iter().map(|diagnostic| diagnostic.message.as_str()).collect::<Vec<_>>(), ["error 11", "warning 9", "error 30"]);
        assert_eq!(near[0].line, 12);
    }
}
