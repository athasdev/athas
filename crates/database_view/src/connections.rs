//! Saved connections: a JSON list beside the workspace state, with passwords in the OS keychain
//! (`db_cred_<id>`, as the old app stores them).

use std::path::{Path, PathBuf};

#[cfg(not(target_family = "wasm"))]
use anyhow::Context as _;
use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::model::Provider;

#[cfg(not(target_family = "wasm"))]
const KEYCHAIN_SERVICE: &str = paths::APP_ID;
#[cfg(not(target_family = "wasm"))]
const CREDENTIAL_PREFIX: &str = "db_cred_";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    #[serde(rename = "db_type")]
    pub provider: Provider,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub file_path: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_string: Option<String>,
}

impl SavedConnection {
    /// A database file opened directly, without saving it.
    pub fn for_file(path: &str) -> Option<SavedConnection> {
        let provider = Provider::for_file(path)?;
        Some(SavedConnection {
            id: path.to_string(),
            name: Path::new(path).file_name().map_or_else(|| path.to_string(), |name| name.to_string_lossy().into_owned()),
            provider,
            file_path: path.to_string(),
            host: String::new(),
            port: 0,
            database: String::new(),
            username: String::new(),
            connection_string: None,
        })
    }

    /// Where it points, for a row's second line.
    pub fn location(&self) -> String {
        if self.provider.is_file_based() {
            return self.file_path.clone();
        }
        if let Some(string) = self.connection_string.as_ref().filter(|string| !string.trim().is_empty()) {
            return redact(string);
        }
        let user = if self.username.is_empty() { String::new() } else { format!("{}@", self.username) };
        format!("{user}{}:{}/{}", self.host, self.port, self.database)
    }

    /// Whether its fields are enough to connect.
    pub fn validate(&self) -> std::result::Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("Give the connection a name".into());
        }
        if self.provider.is_file_based() {
            if self.file_path.trim().is_empty() {
                return Err("Choose a database file".into());
            }
            return Ok(());
        }
        if self.connection_string.as_ref().is_some_and(|string| !string.trim().is_empty()) {
            return Ok(());
        }
        if self.host.trim().is_empty() {
            return Err("Enter a host".into());
        }
        if self.port == 0 {
            return Err("Enter a port between 1 and 65535".into());
        }
        Ok(())
    }
}

/// Hides the password in a connection URL.
pub(crate) fn redact(url: &str) -> String {
    let Some(scheme_end) = url.find("://") else { return url.to_string() };
    let rest = &url[scheme_end + 3..];
    let Some(at) = rest.find('@') else { return url.to_string() };
    let userinfo = &rest[..at];
    match userinfo.find(':') {
        Some(colon) => format!("{}://{}:••••{}", &url[..scheme_end], &userinfo[..colon], &rest[at..]),
        None => url.to_string(),
    }
}

#[cfg(not(target_family = "wasm"))]
pub fn default_store_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(paths::APP_ID).join("database-connections.json"))
}

#[cfg(not(target_family = "wasm"))]
pub fn load(path: &Path) -> Vec<SavedConnection> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    let Ok(values) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else { return Vec::new() };
    values.into_iter().filter_map(|value| serde_json::from_value(value).ok()).collect()
}

#[cfg(not(target_family = "wasm"))]
pub fn save(path: &Path, connections: &[SavedConnection]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(connections)?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text)?;
    // Connection strings can carry passwords: readable by this user only.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&temp, path).with_context(|| format!("Failed to save {}", path.display()))
}

/// On the web the workspace server keeps the list; the path only names it.
#[cfg(target_family = "wasm")]
pub fn default_store_path() -> Option<PathBuf> {
    Some(PathBuf::from("database-connections.json"))
}

#[cfg(target_family = "wasm")]
pub fn load(_path: &Path) -> Vec<SavedConnection> {
    crate::relay::connections().unwrap_or_default()
}

#[cfg(target_family = "wasm")]
pub fn save(_path: &Path, connections: &[SavedConnection]) -> Result<()> {
    crate::relay::save_connections(connections)
}

/// A fresh id for a new connection.
pub fn new_id() -> String {
    let nanos = web_time::SystemTime::now()
        .duration_since(web_time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    format!("conn-{nanos:x}")
}

#[cfg(not(target_family = "wasm"))]
fn credential_key(id: &str) -> String {
    format!("{CREDENTIAL_PREFIX}{id}")
}

#[cfg(not(target_family = "wasm"))]
pub fn store_password(id: &str, password: &str) -> Result<()> {
    secure_storage::store_secret(KEYCHAIN_SERVICE, &credential_key(id), password)
        .map_err(anyhow::Error::msg)
        .context("Failed to store the password in the keychain")
}

#[cfg(not(target_family = "wasm"))]
pub fn load_password(id: &str) -> Option<String> {
    secure_storage::get_secret(KEYCHAIN_SERVICE, &credential_key(id)).ok().flatten()
}

#[cfg(not(target_family = "wasm"))]
pub fn delete_password(id: &str) {
    secure_storage::remove_secret(KEYCHAIN_SERVICE, &credential_key(id)).ok();
}

/// The server keeps passwords; the browser only ever sends one it was typed.
#[cfg(target_family = "wasm")]
pub fn store_password(id: &str, password: &str) -> Result<()> {
    crate::relay::store_password(id, password)
}

#[cfg(target_family = "wasm")]
pub fn load_password(_id: &str) -> Option<String> {
    None
}

#[cfg(target_family = "wasm")]
pub fn delete_password(id: &str) {
    crate::relay::delete_password(id).ok();
}
