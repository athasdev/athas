//! What a UI extension may reach: the manifest permissions and the network allowlist check
//! (`extension-permissions.ts`).

use regex::Regex;
use serde::{Deserialize, Serialize};
use url::Url;

/// The `permissions` block of an extension manifest (the same shape `extensions::manifest` reads).
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub network: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub secrets: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub settings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub open_external: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub clipboard_write: bool,
}

impl Permissions {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    pub fn can_read_workspace(&self) -> bool {
        self.workspace.as_deref() == Some("read")
    }
}

fn wildcard_to_regex(pattern: &str) -> Option<Regex> {
    let escaped: Vec<String> = pattern.split('*').map(regex::escape).collect();
    Regex::new(&format!("^{}$", escaped.join(".*"))).ok()
}

/// Whether `url` is an HTTP(S) address without credentials whose origin matches one of the
/// manifest's `network` patterns (`*` matches anything).
pub fn is_network_request_allowed(url: &str, patterns: &[String]) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    if !matches!(parsed.scheme(), "http" | "https") || !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let origin = parsed.origin().ascii_serialization();
    patterns.iter().any(|pattern| {
        if !pattern.starts_with("http://") && !pattern.starts_with("https://") {
            return false;
        }
        wildcard_to_regex(pattern.strip_suffix('/').unwrap_or(pattern)).is_some_and(|regex| regex.is_match(&origin))
    })
}
