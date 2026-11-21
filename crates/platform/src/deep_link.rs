//! `athas://` links, as the Tauri app's `use-deep-link.ts` and `window-open-request.ts` read them:
//!
//! - `athas://open?path=…&line=…&column=…&type=directory`
//! - `athas://open?type=remote&connectionId=…&name=…`, `type=web&url=…`, `type=terminal&command=…&cwd=…`
//! - `athas://settings?tab=…` (`tab=extensions&category=…` opens the extensions view)
//! - `athas://extension/install/<id>`
//! - `athas://mcp/install?name=…&config=<base64 JSON>`
//!
//! `athas-dev://` works the same. `file://` URLs, which macOS sends for files dropped on the Dock
//! icon or opened from Finder, open those files.

use std::path::{Path, PathBuf};

use cli::CliRequest;
use url::Url;

const SCHEMES: [&str; 2] = ["athas", "athas-dev"];

const SETTINGS_TABS: [&str; 18] = [
    "account",
    "general",
    "editor",
    "git",
    "appearance",
    "ai",
    "ai-models",
    "ai-completion",
    "ai-agents",
    "integrations",
    "workspaces",
    "keyboard",
    "language",
    "collaboration",
    "enterprise",
    "advanced",
    "terminal",
    "file-explorer",
];

const EXTENSION_CATEGORIES: [&str; 8] = ["all", "language", "theme", "icon-theme", "ai", "integration", "skill", "agent"];

#[derive(Clone, Debug, PartialEq)]
pub enum DeepLink {
    Open(CliRequest),
    Settings { tab: String },
    Extensions { category: Option<String> },
    InstallExtension { id: String },
    /// Settings > Integrations reviews the server before adding it.
    InstallMcp { url: String },
}

fn param(url: &Url, name: &str) -> Option<String> {
    url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned())
}

fn positive(value: Option<&str>) -> Option<u32> {
    value?.trim().parse::<u32>().ok().filter(|value| *value > 0)
}

/// `line=12`, `line=12:4` or `line=12&column=4`. A column without a line is dropped.
fn position(url: &Url) -> (Option<u32>, Option<u32>) {
    let line_param = param(url, "line");
    let mut parts = line_param.as_deref().unwrap_or("").splitn(2, ':');
    let line = positive(parts.next());
    let column = positive(param(url, "column").as_deref()).or_else(|| positive(parts.next()));
    (line, line.and(column))
}

fn settings_tab(value: Option<String>) -> String {
    match value.as_deref() {
        Some("features") => "advanced".into(),
        Some(tab) if SETTINGS_TABS.contains(&tab) => tab.into(),
        _ => "general".into(),
    }
}

fn extension_category(url: &Url) -> Option<String> {
    param(url, "category").filter(|category| EXTENSION_CATEGORIES.contains(&category.as_str()))
}

fn settings_link(url: &Url) -> DeepLink {
    if param(url, "tab").as_deref() == Some("extensions") {
        DeepLink::Extensions { category: extension_category(url) }
    } else {
        DeepLink::Settings { tab: settings_tab(param(url, "tab")) }
    }
}

fn open_link(url: &Url) -> Option<DeepLink> {
    let request = match param(url, "type").as_deref() {
        Some("remote") => CliRequest::Remote { connection_id: param(url, "connectionId")?, name: param(url, "name") },
        Some("web") => CliRequest::Web { url: param(url, "url")? },
        Some("terminal") => CliRequest::Terminal { command: param(url, "command"), working_directory: param(url, "cwd") },
        Some("settings") => return Some(settings_link(url)),
        kind => {
            let path = param(url, "path").filter(|path| !path.is_empty())?;
            let is_directory = kind == Some("directory");
            let (line, column) = if is_directory { (None, None) } else { position(url) };
            CliRequest::Path { path, is_directory, line, column, wait_marker: None }
        }
    };
    Some(DeepLink::Open(request))
}

/// Reads an `athas://` or `file://` URL. `None` for anything else.
pub fn parse(text: &str) -> Option<DeepLink> {
    let url = Url::parse(text).ok()?;
    if url.scheme() == "file" {
        let path = url.to_file_path().ok()?;
        return cli::args::parse_open_arg(&path.to_string_lossy(), Path::new("/")).map(DeepLink::Open);
    }
    if !SCHEMES.contains(&url.scheme()) {
        return None;
    }
    if url.host_str() == Some("open") || param(&url, "target").as_deref() == Some("open") {
        return open_link(&url);
    }
    let segments: Vec<&str> = url
        .host_str()
        .into_iter()
        .chain(url.path().trim_start_matches('/').split('/'))
        .filter(|segment| !segment.is_empty())
        .collect();
    match segments.as_slice() {
        ["extension", "install", id, ..] => Some(DeepLink::InstallExtension { id: id.to_string() }),
        ["mcp", "install", ..] => Some(DeepLink::InstallMcp { url: text.to_string() }),
        ["settings", ..] => Some(settings_link(&url)),
        _ => None,
    }
}

/// A `file://` path that could not be opened still names a file; the caller reports it.
pub fn file_path(text: &str) -> Option<PathBuf> {
    Url::parse(text).ok().filter(|url| url.scheme() == "file")?.to_file_path().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(path: &str, is_directory: bool, line: Option<u32>, column: Option<u32>) -> Option<DeepLink> {
        Some(DeepLink::Open(CliRequest::Path { path: path.into(), is_directory, line, column, wait_marker: None }))
    }

    #[test]
    fn opens_paths_at_lines() {
        assert_eq!(parse("athas://open?path=/tmp/a.rs&line=42"), path("/tmp/a.rs", false, Some(42), None));
        assert_eq!(parse("athas://open?path=/tmp/a.rs&line=42:7"), path("/tmp/a.rs", false, Some(42), Some(7)));
        assert_eq!(parse("athas://open?path=/tmp/a.rs&line=4&column=9"), path("/tmp/a.rs", false, Some(4), Some(9)));
        assert_eq!(parse("athas://open?path=/tmp/a.rs&column=9"), path("/tmp/a.rs", false, None, None));
        assert_eq!(parse("athas://open?path=/tmp/a.rs&line=0"), path("/tmp/a.rs", false, None, None));
        assert_eq!(parse("athas://open?path=/Users/me/my%20project&type=directory&line=3"), path("/Users/me/my project", true, None, None));
        assert_eq!(parse("athas-dev://open?path=/tmp/a.rs"), path("/tmp/a.rs", false, None, None));
        assert_eq!(parse("athas://x?target=open&path=/tmp/a.rs"), path("/tmp/a.rs", false, None, None));
        assert_eq!(parse("athas://open"), None);
    }

    #[test]
    fn opens_remotes_web_pages_and_terminals() {
        assert_eq!(
            parse("athas://open?type=remote&connectionId=c1&name=Box"),
            Some(DeepLink::Open(CliRequest::Remote { connection_id: "c1".into(), name: Some("Box".into()) }))
        );
        assert_eq!(parse("athas://open?type=remote"), None);
        assert_eq!(
            parse("athas://open?type=web&url=https%3A%2F%2Fathas.dev"),
            Some(DeepLink::Open(CliRequest::Web { url: "https://athas.dev".into() }))
        );
        assert_eq!(
            parse("athas://open?type=terminal&command=ls&cwd=/tmp"),
            Some(DeepLink::Open(CliRequest::Terminal { command: Some("ls".into()), working_directory: Some("/tmp".into()) }))
        );
    }

    #[test]
    fn settings_and_extensions() {
        assert_eq!(parse("athas://settings?tab=git"), Some(DeepLink::Settings { tab: "git".into() }));
        assert_eq!(parse("athas://settings?tab=features"), Some(DeepLink::Settings { tab: "advanced".into() }));
        assert_eq!(parse("athas://settings?tab=nope"), Some(DeepLink::Settings { tab: "general".into() }));
        assert_eq!(parse("athas://open?type=settings&tab=ai"), Some(DeepLink::Settings { tab: "ai".into() }));
        assert_eq!(
            parse("athas://settings?tab=extensions&category=theme"),
            Some(DeepLink::Extensions { category: Some("theme".into()) })
        );
        assert_eq!(parse("athas://settings?tab=extensions&category=x"), Some(DeepLink::Extensions { category: None }));
    }

    #[test]
    fn installs() {
        assert_eq!(parse("athas://extension/install/rust"), Some(DeepLink::InstallExtension { id: "rust".into() }));
        assert_eq!(parse("athas://extension/install/"), None);
        let mcp = "athas://mcp/install?name=x&config=e30=";
        assert_eq!(parse(mcp), Some(DeepLink::InstallMcp { url: mcp.into() }));
    }

    #[test]
    fn file_urls_open_existing_files() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        let url = Url::from_file_path(&manifest).unwrap().to_string();
        assert!(matches!(parse(&url), Some(DeepLink::Open(CliRequest::Path { is_directory: false, .. }))));
        assert_eq!(parse("file:///athas-does-not-exist-123"), None);
        assert_eq!(file_path("file:///athas-does-not-exist-123"), Some(PathBuf::from("/athas-does-not-exist-123")));
    }

    #[test]
    fn ignores_other_schemes() {
        assert_eq!(parse("https://athas.dev"), None);
        assert_eq!(parse("athas://unknown"), None);
        assert_eq!(parse("not a url"), None);
    }
}
