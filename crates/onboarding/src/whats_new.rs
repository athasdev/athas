//! What's New (`settings/services/whats-new.ts`): the release notes of the running version, from
//! the update manifest or else its GitHub release, and which version's notes were last read.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

pub const GITHUB_RELEASES_URL: &str = "https://github.com/athasdev/athas/releases";
const GITHUB_RELEASES_API_URL: &str = "https://api.github.com/repos/athasdev/athas/releases";
const STABLE_UPDATE_URL: &str = "https://athas.dev/api/update/stable";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsNewInfo {
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

impl WhatsNewInfo {
    pub fn new(version: impl Into<String>) -> Self {
        Self { version: version.into(), ..Default::default() }
    }

    fn has_body(&self) -> bool {
        self.body.as_deref().is_some_and(|body| !body.trim().is_empty())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    #[serde(default)]
    current: Option<WhatsNewInfo>,
    #[serde(default)]
    pending: Option<WhatsNewInfo>,
    #[serde(default)]
    last_read_version: Option<String>,
}

fn escape_link_label(value: &str) -> String {
    value.replace('[', "\\[").replace(']', "\\]")
}

/// GitHub's generated notes made readable: `* Title by @me in <PR url>` becomes a linked title
/// and author, and the Full Changelog line a compare link.
pub fn normalize_release_notes(body: &str) -> String {
    static ENTRY: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^\s*[*-]\s+(.+?)\s+by\s+(.+?)\s+in\s+(https://github\.com/\S+/(?:pull/\d+|commit/[0-9a-f]+))\s*$").expect("valid pattern")
    });
    static CHANGELOG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*\*\*Full Changelog\*\*:\s+(https?://\S+)\s*$").expect("valid pattern"));
    body.trim()
        .split('\n')
        .map(|line| {
            if let Some(captures) = ENTRY.captures(line) {
                return format!("- [{}]({}) — {}", escape_link_label(&captures[1]), &captures[3], &captures[2]);
            }
            if let Some(captures) = CHANGELOG.captures(line) {
                return format!("**Full changelog:** [Compare changes]({})", &captures[1]);
            }
            line.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `2026-11-12` (or a full timestamp) as `November 12, 2026`; anything else as it is.
pub fn format_release_date(value: &str) -> String {
    const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    let date = value.get(..10).unwrap_or(value);
    let mut parts = date.split('-').map(str::parse::<u32>);
    match (parts.next(), parts.next(), parts.next()) {
        (Some(Ok(year)), Some(Ok(month)), Some(Ok(day))) if (1..=12).contains(&month) && (1..=31).contains(&day) => {
            format!("{} {day}, {year}", MONTHS[month as usize - 1])
        }
        _ => value.to_string(),
    }
}

pub fn build_release_notes_markdown(info: &WhatsNewInfo) -> String {
    let mut lines = Vec::new();
    match info.body.as_deref().filter(|body| !body.trim().is_empty()) {
        Some(body) => lines.extend([normalize_release_notes(body), String::new()]),
        None => lines.extend([
            "Release notes were not bundled with this update.".to_string(),
            String::new(),
            "You can still review the GitHub release page for downloads and changelog notes.".to_string(),
            String::new(),
        ]),
    }
    lines.push(format!("[View the full release on GitHub]({GITHUB_RELEASES_URL}/tag/v{})", info.version));
    lines.join("\n")
}

fn text(value: Option<&serde_json::Value>) -> Option<String> {
    value.and_then(serde_json::Value::as_str).filter(|text| !text.trim().is_empty()).map(str::to_string)
}

fn date_part(value: Option<String>) -> Option<String> {
    value.map(|value| value.chars().take(10).collect())
}

/// Fills in the notes and date from the update manifest (when it is for this version), else from
/// the GitHub release; `fetch` reads a URL as JSON.
pub fn resolve_with(mut info: WhatsNewInfo, fetch: impl Fn(&str) -> Option<serde_json::Value>) -> WhatsNewInfo {
    if info.has_body() {
        return info;
    }
    let update_url = std::env::var("ATHAS_UPDATE_URL").unwrap_or_else(|_| STABLE_UPDATE_URL.to_string());
    if let Some(manifest) = fetch(&update_url)
        && manifest.get("version").and_then(serde_json::Value::as_str) == Some(info.version.as_str())
    {
        info.body = info.body.filter(|body| !body.trim().is_empty()).or_else(|| text(manifest.get("notes")));
        info.date = info.date.or_else(|| date_part(text(manifest.get("pub_date"))));
        if info.has_body() {
            return info;
        }
    }
    let releases_api = std::env::var("ATHAS_RELEASES_API_URL").unwrap_or_else(|_| GITHUB_RELEASES_API_URL.to_string());
    if let Some(release) = fetch(&format!("{releases_api}/tags/v{}", info.version)) {
        info.body = info.body.filter(|body| !body.trim().is_empty()).or_else(|| text(release.get("body")));
        info.date = info.date.or_else(|| date_part(text(release.get("published_at"))));
    }
    info
}

#[cfg(not(target_family = "wasm"))]
pub fn resolve(info: WhatsNewInfo) -> WhatsNewInfo {
    resolve_with(info, |url| {
        let mut response = ureq::get(url).header("User-Agent", "Athas").call().ok()?;
        serde_json::from_str(&response.body_mut().read_to_string().ok()?).ok()
    })
}

#[cfg(target_family = "wasm")]
pub fn resolve(info: WhatsNewInfo) -> WhatsNewInfo {
    info
}

/// Where the state is kept (`athas-whats-new` in the webview's storage).
#[derive(Clone, Debug)]
pub struct WhatsNewStore {
    path: Option<std::path::PathBuf>,
}

impl WhatsNewStore {
    pub fn at(path: impl Into<std::path::PathBuf>) -> Self {
        Self { path: Some(path.into()) }
    }

    pub fn default_location() -> Self {
        #[cfg(not(target_family = "wasm"))]
        let path = dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("whats-new.json"));
        #[cfg(target_family = "wasm")]
        let path = None;
        Self { path }
    }

    fn read(&self) -> State {
        self.path.as_ref().and_then(|path| std::fs::read_to_string(path).ok()).and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default()
    }

    fn write(&self, state: &State) {
        let Some(path) = &self.path else { return };
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).ok();
        }
        if let Ok(json) = serde_json::to_string_pretty(state) {
            std::fs::write(path, json).ok();
        }
    }

    /// Remembers an update's notes to show once the new version runs.
    pub fn queue_pending(&self, info: WhatsNewInfo) {
        let mut state = self.read();
        state.pending = Some(info);
        self.write(&state);
    }

    pub fn store_current(&self, info: WhatsNewInfo) {
        let mut state = self.read();
        state.current = Some(info);
        self.write(&state);
    }

    /// Whether this version came from an update whose notes are not read yet.
    pub fn is_unread(&self, current_version: &str) -> bool {
        let state = self.read();
        state.current.as_ref().is_some_and(|current| current.version == current_version && current.previous_version.is_some())
            && state.last_read_version.as_deref() != Some(current_version)
    }

    pub fn mark_read(&self, version: &str) {
        let mut state = self.read();
        state.last_read_version = Some(version.to_string());
        self.write(&state);
    }

    /// The running version's info: a queued update's when it is this version, else what was kept.
    pub fn hydrate(&self, current_version: &str) -> WhatsNewInfo {
        let mut state = self.read();
        if let Some(pending) = state.pending.take().filter(|pending| pending.version == current_version) {
            state.current = Some(pending.clone());
            self.write(&state);
            return pending;
        }
        if let Some(current) = state.current.clone().filter(|current| current.version == current_version) {
            return current;
        }
        let info = WhatsNewInfo::new(current_version);
        state.current = Some(info.clone());
        self.write(&state);
        info
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_generated_release_entries() {
        let body = "## What's Changed\n* Add tabs by @ana in https://github.com/athasdev/athas/pull/12\n**Full Changelog**: https://github.com/athasdev/athas/compare/v1...v2";
        assert_eq!(
            normalize_release_notes(body),
            "## What's Changed\n- [Add tabs](https://github.com/athasdev/athas/pull/12) — @ana\n**Full changelog:** [Compare changes](https://github.com/athasdev/athas/compare/v1...v2)"
        );
    }

    #[test]
    fn formats_dates_and_falls_back_without_notes() {
        assert_eq!(format_release_date("2026-11-12T10:00:00Z"), "November 12, 2026");
        assert_eq!(format_release_date("soon"), "soon");
        let markdown = build_release_notes_markdown(&WhatsNewInfo::new("1.2.3"));
        assert!(markdown.starts_with("Release notes were not bundled"));
        assert!(markdown.ends_with("(https://github.com/athasdev/athas/releases/tag/v1.2.3)"));
    }

    #[test]
    fn prefers_the_manifest_for_this_version_then_github() {
        let manifest = serde_json::json!({ "version": "1.2.3", "notes": "Manifest notes", "pub_date": "2026-11-01T00:00:00Z" });
        let resolved = resolve_with(WhatsNewInfo::new("1.2.3"), |url| url.contains("update").then(|| manifest.clone()));
        assert_eq!((resolved.body.as_deref(), resolved.date.as_deref()), (Some("Manifest notes"), Some("2026-11-01")));

        let release = serde_json::json!({ "body": "GitHub notes", "published_at": "2026-10-30T08:00:00Z" });
        let resolved = resolve_with(WhatsNewInfo::new("1.2.4"), |url| {
            if url.contains("update") { Some(manifest.clone()) } else { url.ends_with("/tags/v1.2.4").then(|| release.clone()) }
        });
        assert_eq!((resolved.body.as_deref(), resolved.date.as_deref()), (Some("GitHub notes"), Some("2026-10-30")));
    }

    #[test]
    fn a_queued_update_is_unread_until_marked() {
        let dir = tempfile::tempdir().unwrap();
        let store = WhatsNewStore::at(dir.path().join("whats-new.json"));
        assert_eq!(store.hydrate("1.0.0"), WhatsNewInfo::new("1.0.0"));
        assert!(!store.is_unread("1.0.0"));
        store.queue_pending(WhatsNewInfo { version: "1.1.0".into(), previous_version: Some("1.0.0".into()), ..Default::default() });
        assert_eq!(store.hydrate("1.1.0").previous_version.as_deref(), Some("1.0.0"));
        assert!(store.is_unread("1.1.0"));
        store.mark_read("1.1.0");
        assert!(!store.is_unread("1.1.0"));
    }
}
