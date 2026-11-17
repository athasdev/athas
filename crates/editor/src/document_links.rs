//! Links in the text (`navigation/document-links.ts`, `lsp/file-reference-navigation.ts`): a web
//! address anywhere, or a quoted relative or absolute path to another file. With the go to
//! definition modifier held they underline under the mouse, and a click opens them.

use std::{
    ops::Range,
    path::{Component, Path, PathBuf},
    sync::LazyLock,
};

use gpui::Context;
use regex::Regex;

use crate::{Editor, lsp::LspEvent};

static URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"\b(?:https?|ftp)://[^\s"'`<>()\[\]{}]+|\bmailto:[^\s"'`<>()\[\]{}]+"#).unwrap());
static QUOTED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""([^"'`]+)"|'([^"'`]+)'|`([^"'`]+)`"#).unwrap());
static FILE_PATH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\\/][^\\/]*\.[A-Za-z0-9]+$").unwrap());
static SCHEME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z][A-Za-z\d+.-]*:").unwrap());
static DRIVE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z]:[\\/]").unwrap());

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkTarget {
    Url(String),
    File(PathBuf),
}

/// The web address around byte `column` of `line`, without trailing punctuation.
pub fn url_at(line: &str, column: usize) -> Option<(Range<usize>, String)> {
    URL.find_iter(line).find_map(|found| {
        let url = found.as_str().trim_end_matches(['.', ',', ';', ':', '!', '?']);
        let range = found.start()..found.start() + url.len();
        (range.start <= column && column <= range.end).then(|| (range, url.to_string()))
    })
}

/// The quoted file path around byte `column` of `line`, resolved against the file it is in (or the
/// project root for a path starting with `/`). Only quotes that read like a path to a file count.
pub fn file_reference_at(line: &str, column: usize, source: &Path, root: Option<&Path>) -> Option<(Range<usize>, PathBuf)> {
    let found = QUOTED.captures_iter(line).find_map(|captures| {
        let raw = captures.get(1).or_else(|| captures.get(2)).or_else(|| captures.get(3))?;
        (raw.start() <= column && column <= raw.end()).then_some(raw)
    })?;
    let lookup = strip_suffix(found.as_str().trim());
    let lookup = percent_decode(lookup);
    if lookup.is_empty() || is_external(found.as_str()) || is_external(&lookup) || !FILE_PATH.is_match(&lookup) {
        return None;
    }
    let target = if DRIVE.is_match(&lookup) {
        PathBuf::from(&lookup)
    } else if let Some(absolute) = lookup.strip_prefix('/') {
        normalize(&root.map(Path::to_path_buf).or_else(|| source.parent().map(Path::to_path_buf))?.join(absolute))
    } else {
        normalize(&source.parent()?.join(&lookup))
    };
    Some((found.range(), target))
}

fn strip_suffix(value: &str) -> &str {
    value.find(['?', '#']).map_or(value, |index| &value[..index])
}

fn is_external(value: &str) -> bool {
    if value.is_empty() || value.starts_with('#') || value.starts_with("//") {
        return true;
    }
    !DRIVE.is_match(value) && SCHEME.is_match(value)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && let Some(byte) = value.get(index + 1..index + 3).and_then(|hex| u8::from_str_radix(hex, 16).ok())
        {
            decoded.push(byte);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.to_string())
}

fn normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push("..");
                }
            }
            other => normalized.push(other),
        }
    }
    normalized
}

impl Editor {
    /// The web address at `offset`, or with `with_files` a quoted file path there.
    pub(crate) fn document_link_at(&self, offset: usize, with_files: bool) -> Option<(Range<usize>, LinkTarget)> {
        let buffer = &self.document.buffer;
        let line = buffer.line_of(offset);
        let start = buffer.line_start(line);
        let text = buffer.line(line);
        let column = offset - start;
        if let Some((range, url)) = url_at(&text, column) {
            return Some((start + range.start..start + range.end, LinkTarget::Url(url)));
        }
        if !with_files || crate::is_untitled(&self.path) {
            return None;
        }
        let (range, path) = file_reference_at(&text, column, &self.path, self.lsp.project_root.as_deref())?;
        Some((start + range.start..start + range.end, LinkTarget::File(path)))
    }

    pub(crate) fn open_document_link(&mut self, target: LinkTarget, cx: &mut Context<Self>) {
        match target {
            LinkTarget::Url(url) => cx.open_url(&url),
            LinkTarget::File(path) if path == self.path => {}
            LinkTarget::File(path) => cx.emit(LspEvent::OpenLocation { path, line: 1, column: 1 }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_urls_without_trailing_punctuation() {
        let line = "see https://athas.dev/docs. or mailto:hi@athas.dev";
        assert_eq!(url_at(line, 10), Some((4..26, "https://athas.dev/docs".into())));
        assert_eq!(url_at(line, 2), None);
        assert_eq!(url_at(line, 35).map(|(_, url)| url), Some("mailto:hi@athas.dev".into()));
    }

    #[test]
    fn resolves_quoted_file_paths() {
        let source = Path::new("/project/src/app/main.ts");
        let root = Some(Path::new("/project"));
        let line = r#"import x from "../lib/util.ts"; load('/assets/logo.svg?raw');"#;
        assert_eq!(file_reference_at(line, 20, source, root), Some((15..29, PathBuf::from("/project/src/lib/util.ts"))));
        assert_eq!(file_reference_at(line, 42, source, root).map(|(_, path)| path), Some(PathBuf::from("/project/assets/logo.svg")));
        assert_eq!(file_reference_at(r#"import x from "react";"#, 16, source, root), None);
        assert_eq!(file_reference_at(r#"a = "https://x.dev/a.js""#, 8, source, root), None);
        assert_eq!(file_reference_at(r#"a = "./my%20file.md""#, 8, source, root).map(|(_, path)| path), Some(PathBuf::from("/project/src/app/my file.md")));
    }
}
