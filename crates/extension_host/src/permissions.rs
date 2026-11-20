//! What a UI extension may reach: the manifest permissions, the network allowlist check
//! (`extension-permissions.ts`) and the stricter rules for AI-generated extensions
//! (`generated-ui-extension-permissions.ts`, `generated-ui-extension-source.ts`).

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

const MAX_NETWORK_ORIGINS: usize = 5;
const PERMISSION_KEYS: &[&str] = &["network", "secrets", "workspace", "openExternal", "clipboardWrite"];

fn parse_network_origin(value: &Value, index: usize) -> Result<String, String> {
    let number = index + 1;
    let Some(text) = value.as_str().filter(|text| !text.contains('*')) else {
        return Err(format!("Generated integration network permission {number} must be an exact origin"));
    };
    let url = Url::parse(text).map_err(|_| format!("Generated integration network permission {number} is invalid"))?;
    let local_http = url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !local_http) || !url.username().is_empty() || url.password().is_some() {
        return Err(format!("Generated integration network permission {number} must use HTTPS or local HTTP"));
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(format!("Generated integration network permission {number} must not include a path"));
    }
    Ok(url.origin().ascii_serialization())
}

/// Reads the permissions an AI-generated extension asks for, refusing anything it may not have.
pub fn parse_generated_permissions(value: &Value) -> Result<Permissions, String> {
    let record = match value {
        Value::Null => return Ok(Permissions::default()),
        Value::Object(record) => record,
        _ => return Err("Generated integration permissions must be an object".into()),
    };
    if let Some(key) = record.keys().find(|key| !PERMISSION_KEYS.contains(&key.as_str())) {
        return Err(format!("Generated integration permission is not supported: {key}"));
    }
    let mut permissions = Permissions::default();
    match record.get("network") {
        None | Some(Value::Null) => {}
        Some(Value::Array(origins)) if !origins.is_empty() => {
            if origins.len() > MAX_NETWORK_ORIGINS {
                return Err(format!("Generated integrations may request at most {MAX_NETWORK_ORIGINS} network origins"));
            }
            for (index, origin) in origins.iter().enumerate() {
                let origin = parse_network_origin(origin, index)?;
                if !permissions.network.contains(&origin) {
                    permissions.network.push(origin);
                }
            }
        }
        Some(_) => return Err("Generated integration network permissions must be a non-empty array".into()),
    }
    let flag = |key: &str, label: &str| -> Result<bool, String> {
        match record.get(key) {
            None | Some(Value::Null) => Ok(false),
            Some(Value::Bool(flag)) => Ok(*flag),
            Some(_) => Err(format!("Generated integration {label} permission must be a boolean")),
        }
    };
    permissions.secrets = flag("secrets", "secrets")?;
    permissions.open_external = flag("openExternal", "external-link")?;
    permissions.clipboard_write = flag("clipboardWrite", "clipboard-write")?;
    match record.get("workspace") {
        None | Some(Value::Null) => {}
        Some(Value::String(mode)) if mode == "read" => permissions.workspace = Some("read".into()),
        Some(_) => return Err("Generated integration workspace permission must be \"read\"".into()),
    }
    Ok(permissions)
}

static API_USE: LazyLock<[(Regex, &'static str); 5]> = LazyLock::new(|| {
    let pattern = |name: &str| Regex::new(&format!(r"\bapi\.{name}\s*\.")).unwrap();
    [
        (pattern("http"), "network"),
        (pattern("secrets"), "secrets"),
        (pattern("workspace"), "workspace read"),
        (pattern("opener"), "external links"),
        (pattern("clipboard"), "clipboard write"),
    ]
});

/// Each capability a generated extension's code uses must be requested, and each one it
/// requests must be used.
pub fn validate_generated_permission_usage(code: &str, permissions: &Permissions) -> Result<(), String> {
    let granted = [
        !permissions.network.is_empty(),
        permissions.secrets,
        permissions.can_read_workspace(),
        permissions.open_external,
        permissions.clipboard_write,
    ];
    for ((pattern, label), granted) in API_USE.iter().zip(granted) {
        let used = pattern.is_match(code);
        if used && !granted {
            return Err(format!("Generated integration uses {label} without requesting permission"));
        }
        if !used && granted {
            return Err(format!("Generated integration requests unused {label} permission"));
        }
    }
    Ok(())
}

pub const MAX_GENERATED_SOURCE_LENGTH: usize = 100_000;

static FORBIDDEN_SOURCE: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r#"\bimport\s*(?:\(|["'{*])"#, "imports"),
        (r"\brequire\s*\(", "require"),
        (r"\beval\s*\(", "eval"),
        (r"\bFunction\s*\(", "Function"),
        (r"\b(?:document|window)\s*(?:\.|\[)", "browser DOM APIs"),
        (
            r"\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|WebTransport|Worker|SharedWorker|importScripts|BroadcastChannel)\b",
            "direct network or worker APIs",
        ),
        (r"\b(?:postMessage|indexedDB|caches)\b", "worker messaging or storage globals"),
        (r"\.constructor\b", "dynamic code constructors"),
    ]
    .into_iter()
    .map(|(pattern, label)| (Regex::new(pattern).unwrap(), label))
    .collect()
});

static WORKER_GLOBALS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(?:self|globalThis)\b").unwrap());

/// `(?<![\w$.])(?:self|globalThis)\b`: the regex crate has no look-behind, so the character
/// before each match is checked by hand.
fn uses_worker_globals(code: &str) -> bool {
    WORKER_GLOBALS.find_iter(code).any(|found| {
        !code[..found.start()].chars().next_back().is_some_and(|before| before.is_alphanumeric() || matches!(before, '_' | '$' | '.'))
    })
}

/// Rejects generated code that reaches for anything outside the extension API.
pub fn validate_generated_source(code: &str) -> Result<(), String> {
    if code.trim().is_empty() {
        return Err("Generated integration source must not be empty".into());
    }
    if crate::view::js_len(code) > MAX_GENERATED_SOURCE_LENGTH {
        return Err(format!("Generated integration source must be at most {MAX_GENERATED_SOURCE_LENGTH} characters"));
    }
    let forbidden = FORBIDDEN_SOURCE.iter().position(|(pattern, _)| pattern.is_match(code));
    let label = match forbidden {
        Some(index) if index < 7 => Some(FORBIDDEN_SOURCE[index].1),
        _ if uses_worker_globals(code) => Some("worker global objects"),
        Some(index) => Some(FORBIDDEN_SOURCE[index].1),
        None => None,
    };
    match label {
        Some(label) => Err(format!("Generated integration source must not use {label}")),
        None => Ok(()),
    }
}
