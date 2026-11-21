//! The host calls an extension may make through its `api` (`extension-host-services.ts`):
//! network, secrets, storage, settings, workspace, notifications, clipboard and links, each
//! behind the manifest's permissions.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use futures::channel::mpsc::UnboundedSender;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use web_time::{Duration, Instant};

use crate::HostEvent;
use crate::HostManifest;
use crate::permissions::is_network_request_allowed;

pub const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const MAX_CLIPBOARD_CHARACTERS: usize = 100_000;
const MAX_NOTIFICATION_TITLE_CHARACTERS: usize = 200;
const MAX_NOTIFICATION_DESCRIPTION_CHARACTERS: usize = 1_000;
const MAX_NOTIFICATIONS_PER_WINDOW: usize = 5;
const NOTIFICATION_WINDOW: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct HttpRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Makes an extension's HTTP request (no redirects, at most 5 MB back).
pub trait HttpClient: Send + Sync {
    fn request(&self, request: HttpRequest) -> Result<HttpResponse, String>;
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContext {
    pub root_path: Option<String>,
    pub repo_path: Option<String>,
    pub active_file_path: Option<String>,
    pub remotes: Vec<Remote>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

/// The app state the host services read and change; the app fills it in.
pub trait AppBridge: Send + Sync {
    fn setting(&self, _key: &str) -> Option<Value> {
        None
    }

    fn set_setting(&self, key: &str, _value: Value) -> Result<(), String> {
        Err(format!("Unknown setting: {key}"))
    }

    fn workspace(&self) -> WorkspaceContext {
        WorkspaceContext::default()
    }

    fn secret(&self, _extension_id: &str, _key: &str) -> Result<Option<String>, String> {
        Err("Secret storage is not available".into())
    }

    fn set_secret(&self, _extension_id: &str, _key: &str, _value: &str) -> Result<(), String> {
        Err("Secret storage is not available".into())
    }

    fn delete_secret(&self, _extension_id: &str, _key: &str) -> Result<(), String> {
        Err("Secret storage is not available".into())
    }
}

pub struct NoBridge;

impl AppBridge for NoBridge {}

pub struct HostServices {
    storage_dir: Option<PathBuf>,
    storage: Mutex<HashMap<String, Map<String, Value>>>,
    bridge: Arc<dyn AppBridge>,
    http: Option<Arc<dyn HttpClient>>,
    notifications: Mutex<HashMap<String, Vec<Instant>>>,
}

fn require_permission(granted: bool, capability: &str) -> Result<(), String> {
    if granted { Ok(()) } else { Err(format!("Integration does not have {capability} permission")) }
}

fn require_string<'a>(value: Option<&'a Value>, label: &str, maximum: usize) -> Result<&'a str, String> {
    let text = value.and_then(Value::as_str).ok_or_else(|| format!("{label} must be a string"))?;
    if crate::view::js_len(text) > maximum {
        return Err(format!("{label} exceeds the {maximum} character limit"));
    }
    Ok(text)
}

/// `String(value)` for a host-call argument.
pub fn js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".into(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => number.as_f64().map(crate::view::format_number).unwrap_or_else(|| number.to_string()),
        Some(other) => other.to_string(),
    }
}

/// The `localStorage` key of one stored value in the browser (`athas-extension:<id>:<key>`).
fn local_storage_key(extension_id: &str, key: &str) -> String {
    format!("athas-extension:{extension_id}:{key}")
}

/// The request an `http.request` call asks for, once the manifest's network permission allows it.
pub fn http_request(manifest: &HostManifest, params: &[Value]) -> Result<HttpRequest, String> {
    let request: HttpRequest = serde_json::from_value(params.first().cloned().unwrap_or(Value::Null)).map_err(|error| format!("Invalid integration HTTP request: {error}"))?;
    require_permission(is_network_request_allowed(&request.url, &manifest.permissions.network), "network")?;
    Ok(request)
}

impl HostServices {
    pub fn new(storage_dir: Option<PathBuf>, bridge: Arc<dyn AppBridge>, http: Option<Arc<dyn HttpClient>>) -> Self {
        Self { storage_dir, storage: Mutex::default(), bridge, http, notifications: Mutex::default() }
    }

    /// Services with no app behind them: storage in memory, no network.
    pub fn detached() -> Self {
        Self::new(None, Arc::new(NoBridge), None)
    }

    pub fn clear_extension_state(&self, extension_id: &str) {
        self.notifications.lock().unwrap().remove(extension_id);
    }

    fn storage_path(&self, extension_id: &str) -> Option<PathBuf> {
        let name: String = extension_id.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect();
        self.storage_dir.as_ref().map(|dir| dir.join(format!("{name}.json")))
    }

    fn with_storage<T>(&self, extension_id: &str, change: impl FnOnce(&mut Map<String, Value>) -> (T, bool)) -> Result<T, String> {
        let mut storage = self.storage.lock().unwrap();
        let entry = storage.entry(extension_id.to_string()).or_insert_with(|| {
            self.storage_path(extension_id)
                .and_then(|path| std::fs::read_to_string(path).ok())
                .and_then(|raw| serde_json::from_str::<Map<String, Value>>(&raw).ok())
                .unwrap_or_default()
        });
        let (result, changed) = change(entry);
        if changed && let Some(path) = self.storage_path(extension_id) {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::write(path, Value::Object(entry.clone()).to_string()).map_err(|error| error.to_string())?;
        }
        Ok(result)
    }

    fn consume_notification_quota(&self, extension_id: &str) -> Result<(), String> {
        let now = Instant::now();
        let mut times = self.notifications.lock().unwrap();
        let recent = times.entry(extension_id.to_string()).or_default();
        recent.retain(|time| now.duration_since(*time) < NOTIFICATION_WINDOW);
        if recent.len() >= MAX_NOTIFICATIONS_PER_WINDOW {
            return Err("Integration notification rate limit exceeded".into());
        }
        recent.push(now);
        Ok(())
    }

    pub fn call(&self, manifest: &HostManifest, method: &str, params: &[Value], events: &UnboundedSender<HostEvent>) -> Result<Value, String> {
        let extension_id = manifest.id.as_str();
        let permissions = &manifest.permissions;
        let param = |index: usize| params.get(index);
        match method {
            "http.request" => {
                let request = http_request(manifest, params)?;
                let http = self.http.as_ref().ok_or("Network requests are not available here")?;
                let response = http.request(request)?;
                serde_json::to_value(response).map_err(|error| error.to_string())
            }
            "secrets.get" => {
                require_permission(permissions.secrets, "secrets")?;
                Ok(self.bridge.secret(extension_id, &js_string(param(0)))?.map(Value::String).unwrap_or(Value::Null))
            }
            "secrets.set" => {
                require_permission(permissions.secrets, "secrets")?;
                self.bridge.set_secret(extension_id, &js_string(param(0)), &js_string(param(1)))?;
                Ok(Value::Null)
            }
            "secrets.delete" => {
                require_permission(permissions.secrets, "secrets")?;
                self.bridge.delete_secret(extension_id, &js_string(param(0)))?;
                Ok(Value::Null)
            }
            "storage.get" if crate::web::has_local_storage() => {
                let value = crate::web::local_get(&local_storage_key(extension_id, &js_string(param(0))));
                Ok(value.and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or(Value::Null))
            }
            "storage.set" if crate::web::has_local_storage() => {
                let value = param(1).cloned().unwrap_or(Value::Null);
                crate::web::local_set(&local_storage_key(extension_id, &js_string(param(0))), &value.to_string())?;
                Ok(Value::Null)
            }
            "storage.delete" if crate::web::has_local_storage() => {
                crate::web::local_remove(&local_storage_key(extension_id, &js_string(param(0))));
                Ok(Value::Null)
            }
            "storage.get" => {
                let key = js_string(param(0));
                self.with_storage(extension_id, |entry| (entry.get(&key).cloned().unwrap_or(Value::Null), false))
            }
            "storage.set" => {
                let key = js_string(param(0));
                let value = param(1).cloned().unwrap_or(Value::Null);
                self.with_storage(extension_id, |entry| {
                    entry.insert(key, value);
                    (Value::Null, true)
                })
            }
            "storage.delete" => {
                let key = js_string(param(0));
                self.with_storage(extension_id, |entry| (Value::Null, entry.remove(&key).is_some()))
            }
            "settings.get" => {
                let key = js_string(param(0));
                require_permission(permissions.settings.contains(&key), "settings access")?;
                Ok(self.bridge.setting(&key).unwrap_or(Value::Null))
            }
            "settings.set" => {
                let key = js_string(param(0));
                require_permission(permissions.settings.contains(&key), "settings access")?;
                if self.bridge.setting(&key).is_none() {
                    return Err(format!("Unknown setting: {key}"));
                }
                self.bridge.set_setting(&key, param(1).cloned().unwrap_or(Value::Null))?;
                Ok(Value::Null)
            }
            "workspace.getCurrent" => {
                require_permission(permissions.can_read_workspace(), "workspace read")?;
                let mut workspace = self.bridge.workspace();
                if workspace.repo_path.is_none() {
                    workspace.repo_path = workspace.root_path.clone();
                }
                serde_json::to_value(workspace).map_err(|error| error.to_string())
            }
            "notifications.show" => {
                let Some(Value::Object(notification)) = param(0) else {
                    return Err("Integration notification must be an object".into());
                };
                let title = require_string(notification.get("title"), "Integration notification title", MAX_NOTIFICATION_TITLE_CHARACTERS)?.trim().to_string();
                if title.is_empty() {
                    return Err("Integration notification title must not be empty".into());
                }
                let description = match notification.get("description") {
                    None | Some(Value::Null) => None,
                    value => Some(require_string(value, "Integration notification description", MAX_NOTIFICATION_DESCRIPTION_CHARACTERS)?.to_string()),
                };
                let tone = match notification.get("tone") {
                    None | Some(Value::Null) => "default".to_string(),
                    Some(value) => js_string(Some(value)),
                };
                if !["default", "info", "success", "warning", "error"].contains(&tone.as_str()) {
                    return Err("Integration notification tone is invalid".into());
                }
                let duration = match notification.get("duration") {
                    None | Some(Value::Null) => None,
                    Some(value) => match value.as_f64() {
                        Some(ms) if value.is_number() && (2_000.0..=10_000.0).contains(&ms) => Some(ms as u64),
                        _ => return Err("Integration notification duration must be between 2000 and 10000 ms".into()),
                    },
                };
                self.consume_notification_quota(extension_id)?;
                events.unbounded_send(HostEvent::Notification { extension_id: extension_id.into(), title, description, tone, duration_ms: duration }).ok();
                Ok(Value::Null)
            }
            "clipboard.writeText" => {
                require_permission(permissions.clipboard_write, "clipboard write")?;
                let text = require_string(param(0), "Integration clipboard text", MAX_CLIPBOARD_CHARACTERS)?;
                events.unbounded_send(HostEvent::Clipboard(text.to_string())).ok();
                Ok(Value::Null)
            }
            "editor.updateSettings" => {
                let Some(settings @ Value::Object(_)) = param(0) else {
                    return Err("Editor settings must be an object".into());
                };
                events.unbounded_send(HostEvent::EditorSettings(settings.clone())).ok();
                Ok(Value::Null)
            }
            "editor.clearSettingOverrides" => {
                events.unbounded_send(HostEvent::ClearEditorSettings).ok();
                Ok(Value::Null)
            }
            "opener.openExternal" => {
                require_permission(permissions.open_external, "external link")?;
                let url = url::Url::parse(&js_string(param(0))).map_err(|error| error.to_string())?;
                if !matches!(url.scheme(), "http" | "https") {
                    return Err("Integrations can only open HTTP or HTTPS links".into());
                }
                events.unbounded_send(HostEvent::OpenExternal(url.to_string())).ok();
                Ok(Value::Null)
            }
            _ => Err(format!("Unknown integration host method: {method}")),
        }
    }
}

/// HTTP for extensions on the desktop: rustls, no redirects, the body capped at 5 MB.
#[cfg(not(target_family = "wasm"))]
pub struct UreqClient;

#[cfg(not(target_family = "wasm"))]
impl HttpClient for UreqClient {
    fn request(&self, request: HttpRequest) -> Result<HttpResponse, String> {
        use std::io::Read as _;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_global(Some(std::time::Duration::from_secs(30)))
            .build()
            .into();
        let method = request.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
        if !["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&method.as_str()) {
            return Err(format!("Unsupported integration HTTP method: {method}"));
        }
        let mut builder = ureq::http::Request::builder().method(method.as_str()).uri(&request.url);
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        let http_request = builder.body(request.body.unwrap_or_default()).map_err(|error| error.to_string())?;
        let response = agent.run(http_request).map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let headers = response.headers().iter().map(|(name, value)| (name.to_string(), value.to_str().unwrap_or_default().to_string())).collect();
        let declared: usize = response.headers().get("content-length").and_then(|value| value.to_str().ok()).and_then(|value| value.parse().ok()).unwrap_or(0);
        if declared > MAX_RESPONSE_BYTES {
            return Err("Integration response exceeded the 5 MB limit".into());
        }
        let mut bytes = Vec::new();
        response.into_body().into_reader().take(MAX_RESPONSE_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err("Integration response exceeded the 5 MB limit".into());
        }
        Ok(HttpResponse { status, headers, body: String::from_utf8_lossy(&bytes).into_owned() })
    }
}
