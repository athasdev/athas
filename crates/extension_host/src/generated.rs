//! AI-generated UI extensions: their record, how they are stored, wrapped and given a manifest
//! (the original's `services/generated/*`).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::permissions::{Permissions, parse_generated_permissions, validate_generated_permission_usage, validate_generated_source};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContributionType {
    #[default]
    Sidebar,
    Toolbar,
    Command,
}

impl ContributionType {
    pub fn label(self) -> &'static str {
        match self {
            ContributionType::Sidebar => "Sidebar",
            ContributionType::Toolbar => "Toolbar",
            ContributionType::Command => "Command",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedExtension {
    pub id: String,
    pub name: String,
    pub description: String,
    pub contribution_type: ContributionType,
    pub code: String,
    #[serde(default, skip_serializing_if = "Permissions::is_empty")]
    pub permissions: Permissions,
    /// Kept installed but not run; the original had no way to pause a generated extension.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub disabled: bool,
}

/// What a UI extension runs as: its id, display name and permissions.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HostManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub permissions: Permissions,
    /// The `aiProviders` the manifest contributes; an extension may register only these.
    pub ai_providers: Vec<Value>,
}

pub fn normalize_generated_id(id: &str) -> String {
    let mut normalized = String::new();
    let mut in_gap = false;
    for c in id.trim().to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-' {
            normalized.push(c);
            in_gap = false;
        } else if !in_gap {
            normalized.push('-');
            in_gap = true;
        }
    }
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        let millis = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or_default();
        format!("generated.{}", to_base36(millis))
    } else {
        format!("generated.{normalized}")
    }
}

fn to_base36(mut value: u128) -> String {
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(digits[(value % 36) as usize]);
        value /= 36;
        if value == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// The generated body becomes an ES module whose `activate(api)` runs it.
pub fn wrap_generated_source(code: &str) -> Result<String, String> {
    validate_generated_source(code)?;
    Ok(format!("export async function activate(api) {{\n\"use strict\";\n{code}\n}}\n"))
}

pub fn generated_manifest(extension: &GeneratedExtension) -> Result<HostManifest, String> {
    let permissions = parse_generated_permissions(&serde_json::to_value(&extension.permissions).unwrap_or(Value::Null))?;
    validate_generated_permission_usage(&extension.code, &permissions)?;
    Ok(HostManifest {
        id: normalize_generated_id(&extension.id),
        name: extension.name.clone(),
        description: extension.description.clone(),
        permissions,
        ai_providers: Vec::new(),
    })
}

/// Reads one stored or generated record, refusing any that would not install.
pub fn read_generated_extension(value: &Value) -> Option<GeneratedExtension> {
    let record = value.as_object()?;
    for key in ["id", "name", "description", "code"] {
        record.get(key)?.as_str()?;
    }
    let mut extension: GeneratedExtension = serde_json::from_value(Value::Object({
        let mut record = record.clone();
        record.remove("permissions");
        record
    }))
    .ok()?;
    let permissions = parse_generated_permissions(record.get("permissions").unwrap_or(&Value::Null)).ok()?;
    validate_generated_permission_usage(&extension.code, &permissions).ok()?;
    extension.permissions = permissions;
    Some(extension)
}

/// Where generated extensions are kept: `generated-ui-extensions.json` in the data folder (the
/// original used `localStorage["athas.generated-ui-extensions"]`), or memory only.
#[derive(Clone, Debug, Default)]
pub struct GeneratedStore {
    path: Option<PathBuf>,
    /// The browser's `localStorage` key, as the original kept them.
    local_key: Option<String>,
    memory: Vec<GeneratedExtension>,
}

/// The original's `localStorage` key for generated extensions.
pub const GENERATED_STORAGE_KEY: &str = "athas.generated-ui-extensions";

pub const GENERATED_STORE_FILE: &str = "generated-ui-extensions.json";

impl GeneratedStore {
    pub fn at(path: Option<PathBuf>) -> Self {
        Self { path, local_key: None, memory: Vec::new() }
    }

    /// Generated extensions in the browser's `localStorage` (memory where it is unavailable).
    pub fn local_storage() -> Self {
        Self { path: None, local_key: Some(GENERATED_STORAGE_KEY.into()), memory: Vec::new() }
    }

    pub fn path(&self) -> Option<&PathBuf> {
        self.path.as_ref()
    }

    pub fn read(&self) -> Vec<GeneratedExtension> {
        let raw = match (&self.path, &self.local_key) {
            (Some(path), _) => std::fs::read_to_string(path).ok(),
            (None, Some(key)) if crate::web::has_local_storage() => crate::web::local_get(key),
            _ => return self.memory.clone(),
        };
        let Some(raw) = raw else {
            return Vec::new();
        };
        match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Array(items)) => items.iter().filter_map(read_generated_extension).collect(),
            _ => Vec::new(),
        }
    }

    fn write(&mut self, extensions: Vec<GeneratedExtension>) -> Result<(), String> {
        let Some(path) = &self.path else {
            if let Some(key) = &self.local_key
                && crate::web::has_local_storage()
            {
                let json = serde_json::to_string(&extensions).map_err(|error| error.to_string())?;
                return crate::web::local_set(key, &json);
            }
            self.memory = extensions;
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let json = serde_json::to_string_pretty(&extensions).map_err(|error| error.to_string())?;
        std::fs::write(path, json).map_err(|error| error.to_string())
    }

    /// Adds `extension`, replacing a stored one with the same id (it moves to the end).
    pub fn store(&mut self, extension: &GeneratedExtension) -> Result<(), String> {
        let mut extensions: Vec<_> = self.read().into_iter().filter(|stored| stored.id != extension.id).collect();
        extensions.push(extension.clone());
        self.write(extensions)
    }

    /// Removes the record whose normalized id is `extension_id`.
    pub fn remove(&mut self, extension_id: &str) -> Result<Option<GeneratedExtension>, String> {
        let (removed, kept): (Vec<_>, Vec<_>) = self.read().into_iter().partition(|stored| normalize_generated_id(&stored.id) == extension_id);
        self.write(kept)?;
        Ok(removed.into_iter().next())
    }

    pub fn set_disabled(&mut self, extension_id: &str, disabled: bool) -> Result<Option<GeneratedExtension>, String> {
        let mut found = None;
        let extensions = self
            .read()
            .into_iter()
            .map(|mut stored| {
                if normalize_generated_id(&stored.id) == extension_id {
                    stored.disabled = disabled;
                    found = Some(stored.clone());
                }
                stored
            })
            .collect();
        self.write(extensions)?;
        Ok(found)
    }
}
