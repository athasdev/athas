//! Project files and content search, walking the folder the way ripgrep does (`.gitignore`
//! respected), with the answer shaped as the cloud's `search.content` parses ripgrep's.

use std::path::Path;

use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde_json::{Map, Value, json};
use web_protocol::{CallError, MAX_LISTED_FILES, MAX_SEARCH_MATCHES};

/// Files larger than this are skipped, like ripgrep's `--max-filesize 2M`.
const MAX_SEARCHED_FILE: u64 = 2 * 1024 * 1024;
const MAX_COLUMNS: usize = 1000;

/// The folder's files, relative to it, for a folder that is not a git repository.
pub(crate) fn walk_files(root: &Path) -> Vec<String> {
    WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(|entry| entry.file_name() != ".git")
        .build()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_some_and(|kind| kind.is_file()))
        .filter_map(|entry| web_protocol::relative_path(root, entry.path()))
        .take(MAX_LISTED_FILES + 1)
        .collect()
}

/// UTF-16 offset of a byte offset in `text`, as the editor's ranges count.
fn utf16_offset(text: &str, byte: usize) -> usize {
    text[..byte.min(text.len())].encode_utf16().count()
}

pub(crate) fn content(root: &Path, params: &Map<String, Value>) -> Result<Value, CallError> {
    let query = params.get("query").and_then(Value::as_str).filter(|query| query.len() <= 1000).ok_or_else(|| CallError::invalid("Invalid query."))?;
    if query.is_empty() {
        return Ok(json!({ "results": [], "truncated": false }));
    }
    let max_results = params.get("maxResults").and_then(Value::as_u64).map(|max| max.clamp(1, MAX_SEARCH_MATCHES as u64) as usize).unwrap_or(1000);
    let context = params.get("contextLines").and_then(Value::as_u64).map(|lines| lines.min(10) as usize).unwrap_or(0);
    let mut pattern = if params.get("regex").and_then(Value::as_bool) == Some(true) { query.to_string() } else { regex::escape(query) };
    if params.get("wholeWord").and_then(Value::as_bool) == Some(true) {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    // Smart case unless the caller says: case-insensitive when the query has no capitals.
    let insensitive = match params.get("caseSensitive").and_then(Value::as_bool) {
        Some(sensitive) => !sensitive,
        None => !query.chars().any(char::is_uppercase),
    };
    let regex = RegexBuilder::new(&pattern).case_insensitive(insensitive).build().map_err(|error| CallError::new("search_failed", error.to_string()))?;
    let mut walk = WalkBuilder::new(root);
    walk.hidden(false).filter_entry(|entry| entry.file_name() != ".git");
    if let Some(glob) = params.get("glob").and_then(Value::as_str).filter(|glob| !glob.is_empty()) {
        let mut overrides = ignore::overrides::OverrideBuilder::new(root);
        overrides.add(glob).map_err(|error| CallError::invalid(error.to_string()))?;
        walk.overrides(overrides.build().map_err(|error| CallError::invalid(error.to_string()))?);
    }

    let mut results = Vec::new();
    let mut total = 0;
    let mut truncated = false;
    'files: for entry in walk.build().filter_map(Result::ok) {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) || entry.metadata().map(|metadata| metadata.len()).unwrap_or(0) > MAX_SEARCHED_FILE {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
        let lines: Vec<&str> = text.lines().collect();
        let mut matches = Vec::new();
        for (index, line) in lines.iter().enumerate() {
            if line.len() > MAX_COLUMNS * 4 {
                continue;
            }
            let ranges: Vec<Value> = regex
                .find_iter(line)
                .filter(|found| found.start() < found.end())
                .map(|found| json!({ "start": utf16_offset(line, found.start()), "end": utf16_offset(line, found.end()) }))
                .collect();
            if ranges.is_empty() {
                continue;
            }
            if total >= max_results {
                truncated = true;
                break 'files;
            }
            total += 1;
            let before: Vec<&str> = lines[index.saturating_sub(context)..index].to_vec();
            let after: Vec<&str> = lines[index + 1..(index + 1 + context).min(lines.len())].to_vec();
            matches.push(json!({ "line": index + 1, "text": line, "ranges": ranges, "before": before, "after": after }));
        }
        if !matches.is_empty()
            && let Some(path) = web_protocol::relative_path(root, entry.path())
        {
            results.push(json!({ "path": path, "matches": matches }));
        }
    }
    Ok(json!({ "results": results, "truncated": truncated }))
}
