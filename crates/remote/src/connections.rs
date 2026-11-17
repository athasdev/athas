//! Saved SSH connections: a JSON list beside the workspace state, with no secrets in it. A password
//! the user asks to remember goes to the OS keychain (`remote_cred_<id>`). Athas's Tauri store
//! (`remote-connections.json` under `com.code.athas`) is imported the first time.

use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = paths::APP_ID;
const CREDENTIAL_PREFIX: &str = "remote_cred_";

/// How the workspace reaches files: over plain SSH commands, or through the SFTP subsystem
/// (the connection form's "Workspace access").
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    #[default]
    Ssh,
    Sftp,
}

impl Access {
    pub const ALL: [Access; 2] = [Access::Ssh, Access::Sftp];

    pub fn label(self) -> &'static str {
        match self {
            Access::Ssh => "SSH",
            Access::Sftp => "SFTP",
        }
    }
}

/// Connections saved before the choice existed always used SFTP.
fn saved_access() -> Access {
    Access::Sftp
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    /// A host name, an address, or an alias from `~/.ssh/config`.
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(rename = "type", default = "saved_access")]
    pub access: Access,
    /// A private key tried before the configured and default ones (the form's optional
    /// "Private key"). Every connection tries keys, then the SSH agent, then a password, as
    /// Athas's `create_ssh_session` does; there is no method to pick.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    /// Whether the password is kept in the keychain.
    #[serde(default)]
    pub remember_password: bool,
    /// The folder last opened over this connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_folder: Option<String>,
    /// Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_connected: Option<u64>,
}

fn default_port() -> u16 {
    22
}

impl SavedConnection {
    /// A connection to an alias from `~/.ssh/config`: the config fills in the rest when connecting.
    pub fn for_config_host(alias: &str) -> Self {
        Self {
            id: format!("ssh-{}", sanitize_id(alias)),
            name: alias.to_string(),
            host: alias.to_string(),
            port: 22,
            username: String::new(),
            access: Access::Ssh,
            key_path: None,
            remember_password: false,
            last_folder: None,
            last_connected: None,
        }
    }

    /// `user@host:port` for a row's second line.
    pub fn location(&self) -> String {
        let user = if self.username.is_empty() { String::new() } else { format!("{}@", self.username) };
        let port = if self.port == 22 { String::new() } else { format!(":{}", self.port) };
        format!("{user}{}{port}", self.host)
    }

    pub fn validate(&self) -> std::result::Result<(), String> {
        if self.host.trim().is_empty() {
            return Err("Enter a host".into());
        }
        if self.port == 0 {
            return Err("Enter a port between 1 and 65535".into());
        }
        crate::known_hosts::validate_endpoint(self.host.trim(), self.port).map_err(|error| error.to_string())
    }
}

/// Keeps ids safe inside a `remote://<id>/` path.
pub fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') { character } else { '-' })
        .collect()
}

pub fn new_id() -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |duration| duration.as_nanos());
    format!("conn-{nanos:x}")
}

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |duration| duration.as_secs())
}

pub fn default_store_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(paths::APP_ID).join("remote-connections.json"))
}

fn tauri_store_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join("com.code.athas").join("remote-connections.json"))
}

/// The saved connections; the Tauri app's, converted, when this app has none yet.
pub fn load_default() -> Vec<SavedConnection> {
    let Some(path) = default_store_path() else { return Vec::new() };
    if path.exists() {
        return load(&path);
    }
    tauri_store_path().map(|tauri| import_tauri(&tauri)).unwrap_or_default()
}

pub fn save_default(connections: &[SavedConnection]) -> Result<()> {
    let path = default_store_path().context("No data directory")?;
    save(&path, connections)
}

pub fn load(path: &Path) -> Vec<SavedConnection> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    let Ok(values) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else { return Vec::new() };
    values.into_iter().filter_map(|value| serde_json::from_value(value).ok()).collect()
}

pub fn save(path: &Path, connections: &[SavedConnection]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(connections)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, text)?;
    std::fs::rename(&temporary, path).with_context(|| format!("Failed to save {}", path.display()))
}

/// Reads the Tauri app's store: an object of connections keyed by id. Passwords never were in it.
pub fn import_tauri(path: &Path) -> Vec<SavedConnection> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    let Ok(serde_json::Value::Object(entries)) = serde_json::from_str(&text) else { return Vec::new() };
    entries
        .into_iter()
        .filter_map(|(id, value)| {
            let field = |key: &str| value.get(key).and_then(|value| value.as_str()).map(str::to_string);
            let host = field("host")?;
            let key_path = field("keyPath").filter(|path| !path.is_empty());
            Some(SavedConnection {
                id: sanitize_id(&field("id").unwrap_or(id)),
                name: field("name").filter(|name| !name.is_empty()).unwrap_or_else(|| host.clone()),
                port: value.get("port").and_then(|port| port.as_u64()).and_then(|port| u16::try_from(port).ok()).unwrap_or(22),
                username: field("username").unwrap_or_default(),
                access: if field("type").as_deref() == Some("sftp") { Access::Sftp } else { Access::Ssh },
                key_path,
                remember_password: false,
                last_folder: None,
                last_connected: None,
                host,
            })
        })
        .collect()
}

fn credential_key(id: &str) -> String {
    format!("{CREDENTIAL_PREFIX}{id}")
}

pub fn store_password(id: &str, password: &str) -> Result<()> {
    secure_storage::store_secret(KEYCHAIN_SERVICE, &credential_key(id), password)
        .map_err(anyhow::Error::msg)
        .context("Failed to store the password in the keychain")
}

pub fn load_password(id: &str) -> Option<String> {
    secure_storage::get_secret(KEYCHAIN_SERVICE, &credential_key(id)).ok().flatten()
}

pub fn delete_password(id: &str) {
    secure_storage::remove_secret(KEYCHAIN_SERVICE, &credential_key(id)).ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> SavedConnection {
        SavedConnection {
            id: "conn-1".into(),
            name: "Build box".into(),
            host: "build.example.com".into(),
            port: 2222,
            username: "me".into(),
            access: Access::Sftp,
            key_path: None,
            remember_password: true,
            last_folder: Some("/srv/app".into()),
            last_connected: Some(1),
        }
    }

    #[test]
    fn round_trips_without_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/remote-connections.json");
        let connections = vec![sample(), SavedConnection::for_config_host("dev box")];
        save(&path, &connections).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("\"password\":"), "{text}");
        assert!(!text.contains("\"auth\""));
        assert!(text.contains("\"rememberPassword\": true"));
        assert!(text.contains("\"type\": \"sftp\""));
        assert_eq!(load(&path), connections);
        assert_eq!(connections[1].id, "ssh-dev-box");
    }

    #[test]
    fn skips_bad_entries_and_fills_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        std::fs::write(&path, r#"[{"id":"a","name":"A","host":"a.example","auth":"key"},{"nope":1}]"#).unwrap();
        let loaded = load(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].port, 22);
        assert_eq!(loaded[0].access, Access::Sftp);
        assert!(load(&dir.path().join("missing.json")).is_empty());
    }

    #[test]
    fn imports_the_tauri_store_without_passwords() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote-connections.json");
        std::fs::write(
            &path,
            r#"{"c1":{"id":"c1","name":"Web","host":"web.example","port":22,"username":"deploy","keyPath":"~/.ssh/id_web","type":"ssh","isConnected":true},
                "c2":{"id":"c2","name":"","host":"db.example","port":2200,"type":"sftp","username":"root","password":"hunter2","saveCredentials":true}}"#,
        )
        .unwrap();
        let mut imported = import_tauri(&path);
        imported.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(imported[0].key_path.as_deref(), Some("~/.ssh/id_web"));
        assert_eq!(imported[1].name, "db.example");
        assert_eq!(imported[1].port, 2200);
        assert_eq!((imported[0].access, imported[1].access), (Access::Ssh, Access::Sftp));
        assert!(!serde_json::to_string(&imported).unwrap().contains("hunter2"));
    }

    #[test]
    fn validates_and_describes() {
        let mut connection = sample();
        assert_eq!(connection.location(), "me@build.example.com:2222");
        connection.validate().unwrap();
        connection.key_path = None;
        connection.username.clear();
        connection.validate().unwrap();
        connection.host = "bad host".into();
        assert!(connection.validate().is_err());
        assert_eq!(SavedConnection::for_config_host("box").location(), "box");
    }
}
