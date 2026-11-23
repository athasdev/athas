//! Cloud settings sync (`lib/settings-sync.ts`, `services/settings-sync-api.ts`): a Pro account
//! keeps one snapshot of the syncable settings on the server. Turning sync on takes the newer of
//! the cloud copy and this device's; after that every change is pushed a moment later, and
//! Restore replaces this device's settings with the cloud copy.

use std::{path::PathBuf, time::Duration};

use gpui::{App, AppContext as _, Context, Entity, Global, Subscription, Task};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::{
    AccountStore,
    api::{ApiError, Client, Method},
};

/// The settings that travel between devices (`SYNCABLE_SETTINGS_KEYS`).
pub const SYNCABLE_KEYS: &[&str] = &[
    "autoSave", "quickOpenPreview", "confirmQuitWithRunningAgents", "fontFamily", "fontSize", "editorLineHeight", "tabSize",
    "wordWrap", "lineNumbers", "renderWhitespace", "renderIndentGuides", "highlightOccurrences", "showMinimap", "showOutline",
    "editorFontLigatures", "editorItalicComments", "editorStickyScroll", "editorBracketPairColorization", "editorSmoothScrolling",
    "editorScrollBeyondLastLine", "editorAutoCloseBrackets", "editorRulers", "editorMultiCursorModifier", "editorCursorStyle",
    "editorCursorBlinking", "terminalFontFamily", "terminalFontSize", "terminalLineHeight", "terminalLetterSpacing",
    "terminalScrollback", "terminalMinimumContrastRatio", "terminalShellIntegration", "terminalCommandNotifications",
    "terminalCursorStyle", "terminalCursorBlink", "terminalCursorWidth", "terminalCursorInactiveStyle",
    "terminalAltClickMovesCursor", "terminalMacOptionIsMeta", "terminalRightClickSelectsWord", "terminalCopyOnSelect",
    "terminalBell", "terminalConfirmCloseRunning", "terminalGpuAcceleration", "uiFontFamily", "uiFontSize", "showTabIcons",
    "tabCloseButtonVisibility", "theme", "iconTheme", "syncSystemTheme", "autoThemeLight", "autoThemeDark", "compactMenuBar",
    "windowTransparency", "openFoldersInNewWindow", "aiProviderId", "aiModelId", "aiCustomBaseUrl", "aiCustomModelId",
    "aiCompletion", "aiAutocompleteProvider", "aiAutocompleteModelId", "aiAutocompleteCustomBaseUrl",
    "aiAutocompleteCustomModelId", "aiDefaultSessionMode", "aiSkills", "v0DesignSystems", "activeV0DesignSystemId",
    "ollamaBaseUrl", "sidebarWidth", "showGitHubPullRequests", "showGitHubIssues", "showGitHubActions", "showGitHubReleases",
    "showGitHubDeployments", "githubActionNotifications", "keybindingPreset", "vimMode", "vimRelativeLineNumbers",
    "defaultLanguage", "autoDetectLanguage", "formatOnSave", "trimTrailingWhitespaceOnSave", "insertFinalNewlineOnSave",
    "formatter", "lintOnSave", "autoCompletion", "parameterHints", "externalEditor", "customEditorCommand", "coreFeatures",
    "extensionsActiveTab", "maxOpenTabs", "horizontalTabScroll", "fileTreeSortOrder", "fileTreeIndentSize",
    "compactFoldersInFileTree", "hideRootFolderInFileTree", "autoRevealActiveFileInFileTree", "showFileIconsInFileTree",
    "showFolderArrowsInFileTree", "showIndentGuidesInFileTree", "confirmBeforeFileDelete", "showHiddenFilesInFileTree",
    "showGitignoredFilesInFileTree", "hiddenFilePatterns", "hiddenDirectoryPatterns", "searchExcludePatterns",
    "largeFileThresholdMB", "gitChangesFolderView", "confirmBeforeDiscard", "autoRefreshGitStatus", "gitAutoFetchInterval",
    "gitPullRebase", "gitSignOffCommits", "gitDefaultBranchName", "showUntrackedFiles", "showStagedFirst", "gitDefaultDiffView",
    "openDiffOnClick", "showGitStatusInFileTree", "compactGitStatusBadges",     "rememberLastGitPanelMode", "gitLastPanelMode", "gitSidebarTabOrder", "hiddenGitSidebarItems",
    "githubSidebarSectionOrder", "enableInlineGitBlame", "telemetry",
];

const PUSH_DEBOUNCE: Duration = Duration::from_millis(1500);
const SNAPSHOT_PATH: &str = "/api/account/settings-sync";

/// The cloud copy (`CloudSettingsSyncSnapshot`).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema_version: u64,
    pub updated_at: String,
    pub settings: Map<String, Value>,
}

/// Where the last sync came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncSource {
    Cloud,
    Local,
}

impl SyncSource {
    pub fn label(self) -> &'static str {
        match self {
            SyncSource::Cloud => "cloud",
            SyncSource::Local => "local",
        }
    }
}

/// What this device remembers about sync (`athas.settingsSync.meta`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Meta {
    pub enabled: bool,
    pub local_updated_at: Option<String>,
    pub last_synced_at: Option<String>,
    pub last_sync_source: Option<SyncSource>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Disabled,
    Idle,
    Syncing,
    Synced,
    Error,
}

/// `GET /api/account/settings-sync`: the cloud copy, or `None` before the first push.
pub fn fetch_snapshot(client: &Client, token: &str) -> Result<Option<Snapshot>, ApiError> {
    let payload = client.authed(token, Method::Get, SNAPSHOT_PATH, None, "Failed to fetch settings sync snapshot")?;
    match payload.get("snapshot") {
        None | Some(Value::Null) => Ok(None),
        Some(snapshot) => serde_json::from_value(snapshot.clone()).map(Some).map_err(|error| ApiError::Malformed(error.to_string())),
    }
}

/// `PUT /api/account/settings-sync`: replaces the cloud copy and answers with it.
pub fn push_snapshot(client: &Client, token: &str, settings: &Map<String, Value>) -> Result<Snapshot, ApiError> {
    let body = json!({ "schemaVersion": settings::import::SCHEMA_VERSION, "settings": settings });
    let payload = client.authed(token, Method::Put, SNAPSHOT_PATH, Some(&body), "Failed to update settings sync snapshot")?;
    payload
        .get("snapshot")
        .and_then(|snapshot| serde_json::from_value(snapshot.clone()).ok())
        .ok_or_else(|| ApiError::Malformed("Failed to update settings sync snapshot.".into()))
}

/// `buildSyncableSettingsSnapshot`.
pub fn syncable_snapshot(settings: &settings::Settings) -> Map<String, Value> {
    SYNCABLE_KEYS.iter().filter_map(|key| Some((key.to_string(), settings.get(key)?))).collect()
}

fn timestamp_ms(value: Option<&str>) -> i64 {
    value
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map_or(0, |time| time.timestamp_millis())
}

/// `runInitialSettingsSync`: the cloud copy wins when it is at least as new as this device's last
/// change.
pub fn cloud_wins(remote: &Snapshot, local_updated_at: Option<&str>) -> bool {
    timestamp_ms(Some(&remote.updated_at)) >= timestamp_ms(local_updated_at)
}

/// The settings a cloud copy turns this device's into: its syncable keys over the current ones,
/// the rest left as they are.
pub fn apply_snapshot(current: &settings::Settings, snapshot: &Snapshot) -> Result<settings::Settings, String> {
    let text = if snapshot.schema_version > 0 {
        json!({ "format": settings::import::EXPORT_FORMAT, "version": snapshot.schema_version, "exportedAt": snapshot.updated_at, "settings": snapshot.settings }).to_string()
    } else {
        Value::Object(snapshot.settings.clone()).to_string()
    };
    let imported = settings::import::parse_settings_import(&text).map_err(|_| "Could not apply cloud settings.".to_string())?;
    let mut next = current.clone();
    for key in SYNCABLE_KEYS {
        if snapshot.settings.contains_key(*key)
            && let Some(value) = imported.settings.get(key)
        {
            next.set(key, value).ok();
        }
    }
    Ok(next)
}

/// `getSettingsSyncErrorMessage`.
pub fn error_message(error: &ApiError) -> String {
    if error.is_auth_invalid() {
        "Cloud settings sync could not access your account. Your session is still signed in.".into()
    } else {
        error.to_string()
    }
}

#[cfg(not(target_family = "wasm"))]
pub fn default_meta_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("settings-sync.json"))
}

#[cfg(target_family = "wasm")]
pub fn default_meta_path() -> Option<PathBuf> {
    None
}

/// Sync's state on this device (`useSettingsSyncStore`) and the work in flight.
pub struct SettingsSync {
    meta: Meta,
    meta_path: Option<PathBuf>,
    pub status: Status,
    pub error: Option<String>,
    last_uploaded: Option<String>,
    completed_initial: bool,
    applying_remote: bool,
    push_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

struct GlobalSettingsSync(Entity<SettingsSync>);

impl Global for GlobalSettingsSync {}

impl SettingsSync {
    /// Creates sync for the app, reading what this device remembers from `meta_path`, and starts
    /// it once the account allows it.
    pub fn init(cx: &mut App, meta_path: Option<PathBuf>) -> Entity<Self> {
        let sync = cx.new(|cx| {
            let meta: Meta = meta_path
                .as_ref()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or_default();
            let mut subscriptions = vec![cx.observe_global::<settings::SettingsStore>(|this: &mut Self, cx| this.settings_changed(cx))];
            if let Some(store) = AccountStore::global(cx) {
                subscriptions.push(cx.observe(&store, |this, _, cx| this.ensure_started(cx)));
            }
            let mut sync = Self {
                status: if meta.enabled { Status::Idle } else { Status::Disabled },
                meta,
                meta_path,
                error: None,
                last_uploaded: None,
                completed_initial: false,
                applying_remote: false,
                push_task: None,
                _subscriptions: subscriptions,
            };
            sync.ensure_started(cx);
            sync
        });
        cx.set_global(GlobalSettingsSync(sync.clone()));
        sync
    }

    pub fn global(cx: &App) -> Option<Entity<Self>> {
        cx.try_global::<GlobalSettingsSync>().map(|global| global.0.clone())
    }

    pub fn meta(&self) -> &Meta {
        &self.meta
    }

    pub fn enabled(&self) -> bool {
        self.meta.enabled
    }

    pub fn is_syncing(&self) -> bool {
        self.status == Status::Syncing
    }

    fn write_meta(&mut self, change: impl FnOnce(&mut Meta)) {
        change(&mut self.meta);
        if let Some(path) = &self.meta_path {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            if let Ok(json) = serde_json::to_string(&self.meta) {
                std::fs::write(path, json).ok();
            }
        }
    }

    /// The account's client and token, when signed in with a plan that includes sync.
    fn credentials(cx: &App) -> Option<(Client, String)> {
        let store = AccountStore::global(cx)?;
        let store = store.read(cx);
        if !store.is_signed_in() || !store.features().settings_sync {
            return None;
        }
        Some((store.client().clone(), store.token()?.to_string()))
    }

    fn finish(&mut self, updated_at: String, source: SyncSource, cx: &mut Context<Self>) {
        self.status = Status::Synced;
        self.error = None;
        self.write_meta(|meta| {
            meta.local_updated_at = Some(updated_at.clone());
            meta.last_synced_at = Some(updated_at);
            meta.last_sync_source = Some(source);
        });
        cx.notify();
    }

    fn fail(&mut self, error: &ApiError, disable: bool, cx: &mut Context<Self>) -> String {
        let message = error_message(error);
        if disable {
            self.write_meta(|meta| meta.enabled = false);
            self.push_task = None;
        }
        self.status = Status::Error;
        self.error = Some(message.clone());
        cx.notify();
        message
    }

    fn apply_remote(&mut self, snapshot: Snapshot, cx: &mut Context<Self>) -> Result<(), String> {
        let next = apply_snapshot(settings::saved(cx), &snapshot)?;
        self.applying_remote = true;
        settings::update(cx, |settings| *settings = next);
        self.applying_remote = false;
        self.last_uploaded = Some(Value::Object(snapshot.settings.clone()).to_string());
        self.finish(snapshot.updated_at, SyncSource::Cloud, cx);
        Ok(())
    }

    /// `pushLocalSnapshot`: uploads the syncable settings unless the cloud already has them.
    fn push_local(&mut self, cx: &mut Context<Self>) -> Task<Result<(), String>> {
        let payload = syncable_snapshot(settings::saved(cx));
        let payload_json = Value::Object(payload.clone()).to_string();
        if self.last_uploaded.as_deref() == Some(payload_json.as_str()) {
            match self.meta.last_synced_at.clone() {
                Some(at) => {
                    let source = self.meta.last_sync_source.unwrap_or(SyncSource::Local);
                    self.finish(at, source, cx);
                }
                None => {
                    self.status = if self.meta.enabled { Status::Idle } else { Status::Disabled };
                    cx.notify();
                }
            }
            return Task::ready(Ok(()));
        }
        let Some((client, token)) = Self::credentials(cx) else { return Task::ready(Err("Sign in with a Pro account to sync settings.".into())) };
        self.status = Status::Syncing;
        self.error = None;
        cx.notify();
        let push = cx.background_spawn(async move { push_snapshot(&client, &token, &payload) });
        cx.spawn(async move |this, cx| {
            let result = push.await;
            this.update(cx, |this, cx| match result {
                Ok(snapshot) => {
                    this.last_uploaded = Some(payload_json);
                    this.finish(snapshot.updated_at, SyncSource::Local, cx);
                    Ok(())
                }
                Err(error) => Err(this.fail(&error, false, cx)),
            })
            .unwrap_or(Ok(()))
        })
    }

    /// `runInitialSettingsSync`.
    fn run_initial(&mut self, cx: &mut Context<Self>) -> Task<Result<(), ApiError>> {
        let Some((client, token)) = Self::credentials(cx) else { return Task::ready(Ok(())) };
        self.status = Status::Syncing;
        self.error = None;
        cx.notify();
        let fetch = cx.background_spawn(async move { fetch_snapshot(&client, &token) });
        cx.spawn(async move |this, cx| {
            let remote = fetch.await?;
            let push = this
                .update(cx, |this, cx| match remote {
                    Some(remote) if cloud_wins(&remote, this.meta.local_updated_at.as_deref()) => {
                        if let Err(message) = this.apply_remote(remote, cx) {
                            this.status = Status::Error;
                            this.error = Some(message);
                            cx.notify();
                        }
                        None
                    }
                    _ => Some(this.push_local(cx)),
                })
                .ok()
                .flatten();
            if let Some(push) = push
                && let Err(message) = push.await
            {
                return Err(ApiError::Malformed(message));
            }
            Ok(())
        })
    }

    /// `enableSettingsSync`.
    pub fn enable(&mut self, cx: &mut Context<Self>) -> Task<Result<(), String>> {
        self.write_meta(|meta| meta.enabled = true);
        self.status = if self.meta.last_synced_at.is_some() { Status::Synced } else { Status::Idle };
        self.error = None;
        let initial = self.run_initial(cx);
        cx.spawn(async move |this, cx| match initial.await {
            Ok(()) => {
                this.update(cx, |this, _| this.completed_initial = true).ok();
                Ok(())
            }
            Err(error) => Err(this.update(cx, |this, cx| this.fail(&error, true, cx)).unwrap_or_default()),
        })
    }

    /// `disableSettingsSync`.
    pub fn disable(&mut self, cx: &mut Context<Self>) {
        self.write_meta(|meta| meta.enabled = false);
        self.status = Status::Disabled;
        self.error = None;
        self.push_task = None;
        cx.notify();
    }

    /// `syncSettingsNow`.
    pub fn sync_now(&mut self, cx: &mut Context<Self>) -> Task<Result<(), String>> {
        self.push_local(cx)
    }

    /// `restoreSettingsFromCloud`.
    pub fn restore(&mut self, cx: &mut Context<Self>) -> Task<Result<(), String>> {
        let Some((client, token)) = Self::credentials(cx) else { return Task::ready(Err("Sign in with a Pro account to sync settings.".into())) };
        self.status = Status::Syncing;
        self.error = None;
        cx.notify();
        let fetch = cx.background_spawn(async move { fetch_snapshot(&client, &token) });
        cx.spawn(async move |this, cx| {
            let result = fetch.await;
            this.update(cx, |this, cx| match result {
                Ok(Some(snapshot)) => this.apply_remote(snapshot, cx).inspect_err(|message| {
                    this.status = Status::Error;
                    this.error = Some(message.clone());
                    cx.notify();
                }),
                Ok(None) => {
                    let message = "No cloud settings snapshot found yet.".to_string();
                    this.status = Status::Error;
                    this.error = Some(message.clone());
                    cx.notify();
                    Err(message)
                }
                Err(error) => Err(this.fail(&error, false, cx)),
            })
            .unwrap_or(Ok(()))
        })
    }

    /// `ensureSettingsSyncStarted`: runs the first sync once signed in with sync on.
    fn ensure_started(&mut self, cx: &mut Context<Self>) {
        if Self::credentials(cx).is_none() || !self.meta.enabled {
            self.completed_initial = false;
            self.push_task = None;
            if self.status == Status::Syncing {
                self.status = if self.meta.enabled { Status::Idle } else { Status::Disabled };
            }
            return;
        }
        if self.completed_initial || self.status == Status::Syncing {
            return;
        }
        self.completed_initial = true;
        let initial = self.run_initial(cx);
        cx.spawn(async move |this, cx| {
            if let Err(error) = initial.await {
                this.update(cx, |this, cx| {
                    let disable = error.is_auth_invalid();
                    this.fail(&error, disable, cx);
                    this.completed_initial = false;
                })
                .ok();
            }
        })
        .detach();
    }

    /// A setting changed: note when, and push after a quiet moment (`schedulePush`).
    fn settings_changed(&mut self, cx: &mut Context<Self>) {
        if self.applying_remote || !self.meta.enabled {
            return;
        }
        let payload_json = Value::Object(syncable_snapshot(settings::saved(cx))).to_string();
        if self.last_uploaded.as_deref() == Some(payload_json.as_str()) {
            return;
        }
        // Stamped even before the first sync went through (offline, signed out a moment): the
        // next sync then knows this change is newer than the cloud's and keeps it.
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        self.write_meta(|meta| meta.local_updated_at = Some(now));
        if !self.completed_initial {
            return;
        }
        self.push_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(PUSH_DEBOUNCE).await;
            if let Ok(push) = this.update(cx, |this, cx| this.push_local(cx)) {
                push.await.ok();
            }
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service_urls::ServiceUrls;
    use telemetry::mock_server::{MockServer, Response};

    fn snapshot(updated_at: &str, settings: Value) -> Snapshot {
        Snapshot { schema_version: 6, updated_at: updated_at.into(), settings: settings.as_object().cloned().unwrap() }
    }

    #[test]
    fn the_newer_copy_wins() {
        let remote = snapshot("2026-11-10T10:00:00.000Z", json!({}));
        assert!(cloud_wins(&remote, None));
        assert!(cloud_wins(&remote, Some("2026-11-10T09:59:59.000Z")));
        assert!(cloud_wins(&remote, Some("2026-11-10T10:00:00.000Z")));
        assert!(!cloud_wins(&remote, Some("2026-11-10T10:00:01.000Z")));
        assert!(cloud_wins(&remote, Some("not a time")));
    }

    #[test]
    fn snapshots_hold_only_syncable_settings() {
        let mut current = settings::Settings { tab_size: 4.0, ..Default::default() };
        current.extra.insert("gpuiOnboardingCompleted".into(), json!(true));
        let payload = syncable_snapshot(&current);
        assert_eq!(payload["tabSize"], json!(4.0));
        assert!(payload.contains_key("coreFeatures"));
        assert!(!payload.contains_key("lastSettingsTab"));
        assert!(!payload.contains_key("gpuiOnboardingCompleted"));
        assert_eq!(payload.len(), SYNCABLE_KEYS.len());
    }

    #[test]
    fn a_cloud_copy_replaces_only_what_it_carries() {
        let current = settings::Settings { tab_size: 4.0, last_settings_tab: "git".into(), word_wrap: true, ..Default::default() };
        let remote = snapshot("2026-11-10T10:00:00.000Z", json!({ "tabSize": 8, "theme": "vitesse-dark", "lastSettingsTab": "ai" }));
        let next = apply_snapshot(&current, &remote).unwrap();
        assert_eq!(next.tab_size, 8.0);
        assert_eq!(next.theme, "vitesse-dark");
        assert_eq!(next.last_settings_tab, "git");
        assert!(next.word_wrap);
    }

    #[test]
    fn the_client_speaks_the_sync_api() {
        let server = MockServer::start(|request| match request.method.as_str() {
            "GET" => Response::json(200, json!({ "snapshot": { "schemaVersion": 6, "updatedAt": "2026-11-10T10:00:00.000Z", "settings": { "tabSize": 8 } } })),
            "PUT" => Response::json(200, json!({ "snapshot": { "schemaVersion": 6, "updatedAt": "2026-11-11T08:00:00.000Z", "settings": request.json()["settings"].clone() } })),
            _ => Response::json(405, json!({ "error": "nope" })),
        });
        let client = Client::new(ServiceUrls::local(server.url()));
        let fetched = fetch_snapshot(&client, "token").unwrap().unwrap();
        assert_eq!(fetched.settings["tabSize"], json!(8));
        let mut payload = Map::new();
        payload.insert("tabSize".into(), json!(2));
        let pushed = push_snapshot(&client, "token", &payload).unwrap();
        assert_eq!(pushed.updated_at, "2026-11-11T08:00:00.000Z");
        let requests = server.requests();
        assert_eq!(requests[0].path, "/api/account/settings-sync");
        assert_eq!(requests[0].header("authorization"), Some("Bearer token"));
        assert_eq!(requests[1].method, "PUT");
        assert_eq!(requests[1].json()["schemaVersion"], json!(settings::import::SCHEMA_VERSION));
        assert_eq!(requests[1].json()["settings"]["tabSize"], json!(2));
    }

    #[test]
    fn no_snapshot_and_errors() {
        let server = MockServer::start(|request| match request.method.as_str() {
            "GET" => Response::json(200, json!({ "snapshot": null })),
            _ => Response::json(403, json!({ "error": "Settings sync requires Pro" })),
        });
        let client = Client::new(ServiceUrls::local(server.url()));
        assert_eq!(fetch_snapshot(&client, "token").unwrap(), None);
        let error = push_snapshot(&client, "token", &Map::new()).unwrap_err();
        assert_eq!(error_message(&error), "Settings sync requires Pro");
    }

    #[test]
    fn meta_is_kept_between_launches() {
        let dir = std::env::temp_dir().join(format!("athas-sync-meta-{}", std::process::id()));
        let path = dir.join("settings-sync.json");
        gpui::TestAppContext::single().update(|cx| {
            settings::init(cx, settings::Settings::default(), None);
            let sync = SettingsSync::init(cx, Some(path.clone()));
            sync.update(cx, |sync, cx| {
                assert!(!sync.enabled());
                assert_eq!(sync.status, Status::Disabled);
                sync.write_meta(|meta| {
                    meta.enabled = true;
                    meta.last_synced_at = Some("2026-11-10T10:00:00.000Z".into());
                    meta.last_sync_source = Some(SyncSource::Cloud);
                });
                sync.disable(cx);
                assert_eq!(sync.status, Status::Disabled);
            });
        });
        let meta: Meta = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(!meta.enabled);
        assert_eq!(meta.last_sync_source, Some(SyncSource::Cloud));
        std::fs::remove_dir_all(&dir).ok();
    }
}
