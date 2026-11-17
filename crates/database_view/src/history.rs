//! The SQL history of each database (`lib/sql-history.ts`, `lib/sql-history-storage.ts`): the
//! last few distinct statements, newest first, kept in a JSON file beside the connections.

#[cfg(not(target_family = "wasm"))]
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const LIMIT: usize = 10;
const PREVIEW_LIMIT: usize = 96;

/// The text two entries are compared by: no comments, trailing semicolons or runs of spaces.
pub fn entry_key(query: &str) -> String {
    let stripped = crate::backend::strip_leading_comments(query);
    let text = if stripped.is_empty() { query } else { stripped };
    let text = text.trim().trim_end_matches(|c: char| c == ';' || c.is_whitespace()).trim();
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn add(history: &[String], query: &str) -> Vec<String> {
    let query = query.trim();
    if query.is_empty() {
        return history.to_vec();
    }
    let key = entry_key(query);
    std::iter::once(query.to_string())
        .chain(history.iter().filter(|entry| entry_key(entry) != key).cloned())
        .take(LIMIT)
        .collect()
}

pub fn remove(history: &[String], query: &str) -> Vec<String> {
    let key = entry_key(query);
    history.iter().filter(|entry| entry_key(entry) != key).cloned().collect()
}

/// One line of a statement for a list row.
pub fn preview(query: &str) -> String {
    let preview = entry_key(query);
    if preview.chars().count() <= PREVIEW_LIMIT {
        return preview;
    }
    let truncated: String = preview.chars().take(PREVIEW_LIMIT - 1).collect();
    match truncated.rfind(' ') {
        Some(space) if space > 0 => format!("{}…", &truncated[..space]),
        _ => format!("{truncated}…"),
    }
}

/// Drops blanks and duplicates, and keeps the newest [`LIMIT`].
fn normalize(history: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    history
        .into_iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty() && seen.insert(entry_key(entry)))
        .take(LIMIT)
        .collect()
}

#[cfg(not(target_family = "wasm"))]
pub fn default_store_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(paths::APP_ID).join("database-history.json"))
}

#[cfg(not(target_family = "wasm"))]
fn read_all(path: &Path) -> BTreeMap<String, Vec<String>> {
    std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

#[cfg(not(target_family = "wasm"))]
pub fn load(path: &Path, key: &str) -> Vec<String> {
    normalize(read_all(path).remove(key).unwrap_or_default())
}

#[cfg(not(target_family = "wasm"))]
pub fn save(path: &Path, key: &str, history: &[String]) {
    let mut all = read_all(path);
    let history = normalize(history.to_vec());
    if history.is_empty() {
        all.remove(key);
    } else {
        all.insert(key.to_string(), history);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if let Ok(text) = serde_json::to_string_pretty(&all) {
        std::fs::write(path, text).ok();
    }
}

/// On the web the workspace server keeps the history; the path only names it.
#[cfg(target_family = "wasm")]
pub fn default_store_path() -> Option<PathBuf> {
    Some(PathBuf::from("database-history.json"))
}

#[cfg(target_family = "wasm")]
pub fn load(_path: &Path, key: &str) -> Vec<String> {
    normalize(crate::relay::load_history(key).unwrap_or_default())
}

#[cfg(target_family = "wasm")]
pub fn save(_path: &Path, key: &str, history: &[String]) {
    crate::relay::save_history(key, &normalize(history.to_vec())).ok();
}
