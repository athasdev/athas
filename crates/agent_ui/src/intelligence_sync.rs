//! The per-feature models synced with the Athas account, for the user or a team they belong to.
//! A change is a draft until the server takes it; a draft made against a revision another device
//! moved past is kept and the conflict reported, until the saved settings are reloaded.
//!
//! Ported from Athas's `intelligence/stores/intelligence-settings.store.ts`,
//! `intelligence/services/intelligence-settings-api.ts` and
//! `intelligence/hooks/use-intelligence-settings-sync.ts`.

use account::{AccountStore, Method};
use gpui::{App, AppContext as _, Context, Entity, Global, Subscription, Task};
use serde_json::{Value, json};

const STATE_KEY: &str = "aiTaskModelsSync";
pub const PERSONAL: &str = "personal";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scope {
    pub id: String,
    pub name: String,
    pub can_edit: bool,
}

/// What the server holds for a scope.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub scopes: Vec<Scope>,
    pub preferences: Value,
    pub revision: u64,
}

fn personal_scope() -> Scope {
    Scope { id: PERSONAL.into(), name: "Personal".into(), can_edit: true }
}

/// Reads the server's answer for `scope`; `Err` when it is not one.
pub fn parse_snapshot(scope: &str, data: &Value) -> Result<Snapshot, String> {
    let invalid = || "Athas returned invalid AI settings.".to_string();
    if data.get("scope").and_then(Value::as_str) != Some(scope) {
        return Err(invalid());
    }
    let scopes = data.get("scopes").and_then(Value::as_array).ok_or_else(invalid)?;
    let revision = data.get("revision").and_then(Value::as_u64).ok_or_else(invalid)?;
    let scopes = scopes
        .iter()
        .filter_map(|scope| {
            Some(Scope {
                id: scope.get("id")?.as_str()?.to_string(),
                name: scope.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                can_edit: scope.get("canEdit").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect();
    Ok(Snapshot { scopes, preferences: data.get("preferences").cloned().unwrap_or(Value::Null), revision })
}

/// The preferences as the server stores them, from settings.
pub fn preferences(settings: &settings::Settings) -> Value {
    let mut tasks = serde_json::Map::new();
    for (task, _) in crate::intelligence::TASK_OVERRIDES.iter().copied().chain([("autocomplete", "")]) {
        if let Some((provider, model)) = crate::intelligence::task_connection(settings, task) {
            tasks.insert(task.to_string(), json!({ "providerId": provider, "modelId": model }));
        }
    }
    json!({
        "defaultConnection": if crate::intelligence::default_is_auto(settings) {
            json!({ "providerId": "auto", "modelId": "" })
        } else {
            json!({ "providerId": settings.ai_provider_id, "modelId": settings.ai_model_id })
        },
        "tasks": tasks,
        "autoRouting": settings.extra.get("aiAutoRouting").and_then(Value::as_bool).unwrap_or(false),
    })
}

/// Puts the server's preferences into settings; fields it leaves out or gets wrong are left alone.
pub fn apply(settings: &mut settings::Settings, preferences: &Value) {
    if let Some(default) = preferences.get("defaultConnection")
        && let (Some(provider), Some(model)) = (default.get("providerId").and_then(Value::as_str), default.get("modelId").and_then(Value::as_str))
        && !provider.is_empty()
    {
        // `auto` keeps the device's own provider and lets the default route as the original does.
        let auto = provider == "auto";
        crate::intelligence::set_default_auto(settings, auto);
        if !auto {
            settings.ai_provider_id = provider.to_string();
            settings.ai_model_id = model.to_string();
        }
    }
    let tasks = preferences.get("tasks").and_then(Value::as_object);
    for (task, _) in crate::intelligence::TASK_OVERRIDES.iter().copied().chain([("autocomplete", "")]) {
        let connection = tasks.and_then(|tasks| tasks.get(task)).and_then(|entry| {
            Some((entry.get("providerId")?.as_str()?.to_string(), entry.get("modelId")?.as_str()?.to_string()))
        });
        crate::intelligence::set_task_connection(settings, task, connection);
    }
    if let Some(auto) = preferences.get("autoRouting").and_then(Value::as_bool) {
        settings.extra.insert("aiAutoRouting".into(), Value::Bool(auto));
    }
}

pub struct IntelligenceSync {
    scope: String,
    scopes: Vec<Scope>,
    revision: u64,
    dirty: bool,
    loading: bool,
    error: Option<String>,
    user: Option<String>,
    request: Option<Task<()>>,
    /// When a window coming to the front last asked the server.
    focus_refreshed: Option<web_time::Instant>,
    _account: Option<Subscription>,
}

struct GlobalSync(Entity<IntelligenceSync>);

impl Global for GlobalSync {}

/// Starts following the account: loads the signed-in user's settings, and again when they sign
/// in or out.
pub fn init(cx: &mut App) {
    if cx.try_global::<GlobalSync>().is_some() {
        return;
    }
    let sync = cx.new(|cx| {
        let account = AccountStore::global(cx).map(|store| cx.observe(&store, |this: &mut IntelligenceSync, _, cx| this.account_changed(cx)));
        let mut this = IntelligenceSync { scope: PERSONAL.into(), scopes: vec![personal_scope()], revision: 0, dirty: false, loading: false, error: None, user: None, request: None, focus_refreshed: None, _account: account };
        this.restore(cx);
        this.account_changed(cx);
        this
    });
    cx.set_global(GlobalSync(sync));
}

pub fn global(cx: &App) -> Option<Entity<IntelligenceSync>> {
    cx.try_global::<GlobalSync>().map(|sync| sync.0.clone())
}

/// Several windows coming to the front at once ask the server once.
const FOCUS_REFRESH_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

/// A window came to the front: the settings may have changed on another device meanwhile.
pub fn window_focused(cx: &mut App) {
    let Some(sync) = global(cx) else { return };
    sync.update(cx, |sync, cx| {
        if sync.user.is_none() || sync.loading || sync.focus_refreshed.is_some_and(|at| at.elapsed() < FOCUS_REFRESH_INTERVAL) {
            return;
        }
        sync.focus_refreshed = Some(web_time::Instant::now());
        sync.refresh(false, cx);
    });
}

/// A feature's model changed in Settings: saves it to the scope.
pub fn changed(cx: &mut App) {
    if let Some(sync) = global(cx) {
        sync.update(cx, |sync, cx| {
            sync.dirty = true;
            sync.persist(cx);
            sync.save(cx);
        });
    }
}

/// Whether the scope shown can be changed by this user.
pub fn can_edit(cx: &App) -> bool {
    global(cx).is_none_or(|sync| sync.read(cx).can_edit())
}

impl IntelligenceSync {
    pub fn scope(&self) -> &str {
        &self.scope
    }

    pub fn scopes(&self) -> &[Scope] {
        &self.scopes
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub fn is_loading(&self) -> bool {
        self.loading
    }

    pub fn is_signed_in(&self) -> bool {
        self.user.is_some()
    }

    pub fn can_edit(&self) -> bool {
        self.scope == PERSONAL || self.scopes.iter().any(|scope| scope.id == self.scope && scope.can_edit)
    }

    fn client(cx: &App) -> Option<(account::Client, String)> {
        let store = AccountStore::global(cx)?;
        let store = store.read(cx);
        Some((store.client().clone(), store.token()?.to_string()))
    }

    fn restore(&mut self, cx: &App) {
        let Some(state) = cx.try_global::<settings::SettingsStore>().and_then(|_| settings::get(cx).extra.get(STATE_KEY).cloned()) else { return };
        if let Some(scope) = state.get("scope").and_then(Value::as_str).filter(|scope| *scope == PERSONAL || scope.starts_with("team:")) {
            self.scope = scope.to_string();
        }
        self.revision = state.get("revision").and_then(Value::as_u64).unwrap_or(0);
        self.dirty = state.get("dirty").and_then(Value::as_bool).unwrap_or(false);
    }

    fn persist(&self, cx: &mut App) {
        if cx.try_global::<settings::SettingsStore>().is_none() {
            return;
        }
        let state = json!({ "scope": self.scope, "revision": self.revision, "dirty": self.dirty });
        settings::update(cx, move |settings| {
            settings.extra.insert(STATE_KEY.into(), state);
        });
    }

    fn account_changed(&mut self, cx: &mut Context<Self>) {
        crate::intelligence::note_intelligence_access(crate::intelligence::account_access(cx).0);
        let user = AccountStore::global(cx).and_then(|store| store.read(cx).user().map(|user| user.id.to_string()));
        if user == self.user {
            return;
        }
        self.user = user;
        if self.user.is_none() {
            self.scopes = vec![personal_scope()];
            self.scope = PERSONAL.into();
            self.request = None;
            self.loading = false;
            cx.notify();
            return;
        }
        self.refresh(false, cx);
    }

    /// Asks the server for the scope's settings. A draft stays unless `discard_local`.
    pub fn refresh(&mut self, discard_local: bool, cx: &mut Context<Self>) {
        let Some((client, token)) = Self::client(cx) else { return };
        let scope = self.scope.clone();
        self.loading = true;
        self.error = None;
        let path = format!("/api/account/intelligence?scope={}", encode(&scope));
        self.request = Some(cx.spawn(async move |this, cx| {
            let answer = cx.background_spawn(async move { client.authed(&token, Method::Get, &path, None, "Could not sync your AI settings") }).await;
            this.update(cx, |this, cx| {
                this.loading = false;
                this.request = None;
                match answer.map_err(api_error).and_then(|data| parse_snapshot(&scope, &data).map_err(|error| (None, error))) {
                    Ok(snapshot) => {
                        this.scopes = snapshot.scopes.clone();
                        if this.dirty && !discard_local {
                            if snapshot.revision != this.revision {
                                this.error = Some("Settings changed on another device. Reload saved settings to discard this device's draft.".into());
                            }
                        } else {
                            this.revision = snapshot.revision;
                            this.dirty = false;
                            let preferences = snapshot.preferences.clone();
                            if cx.try_global::<settings::SettingsStore>().is_some() {
                                settings::update(cx, move |settings| apply(settings, &preferences));
                            }
                            this.persist(cx);
                        }
                    }
                    Err((Some(403), _)) if this.scope != PERSONAL => {
                        this.scope = PERSONAL.into();
                        this.refresh(true, cx);
                    }
                    Err((_, error)) => this.error = Some(error),
                }
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    /// Shows another scope's settings: the user's own, or a team's.
    pub fn set_scope(&mut self, scope: String, cx: &mut Context<Self>) {
        if scope == self.scope || !self.scopes.iter().any(|candidate| candidate.id == scope) {
            return;
        }
        self.scope = scope;
        self.revision = 0;
        self.dirty = false;
        self.persist(cx);
        self.refresh(true, cx);
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        if !self.dirty || !self.can_edit() {
            return;
        }
        let Some((client, token)) = Self::client(cx) else { return };
        let scope = self.scope.clone();
        let preferences = cx.try_global::<settings::SettingsStore>().map(|_| preferences(settings::get(cx))).unwrap_or(Value::Null);
        let body = json!({ "scope": scope, "revision": self.revision, "preferences": preferences });
        let path = format!("/api/account/intelligence?scope={}", encode(&scope));
        self.loading = true;
        self.error = None;
        self.request = Some(cx.spawn(async move |this, cx| {
            let answer = cx.background_spawn(async move { client.authed(&token, Method::Put, &path, Some(&body), "Could not sync your AI settings") }).await;
            this.update(cx, |this, cx| {
                this.loading = false;
                this.request = None;
                match answer.map_err(api_error).and_then(|data| parse_snapshot(&scope, &data).map_err(|error| (None, error))) {
                    Ok(snapshot) => {
                        this.revision = snapshot.revision;
                        this.scopes = snapshot.scopes;
                        this.dirty = false;
                        this.persist(cx);
                    }
                    Err((_, error)) => this.error = Some(error),
                }
                cx.notify();
            })
            .ok();
        }));
    }
}

fn api_error(error: account::ApiError) -> (Option<u16>, String) {
    match error {
        account::ApiError::Http { status, message, .. } => (Some(status), message),
        other => (None, format!("Settings sync failed. Your draft is saved on this device. {other}")),
    }
}

fn encode(value: &str) -> String {
    value.bytes().map(|byte| if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) { (byte as char).to_string() } else { format!("%{byte:02X}") }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_snapshots_and_rejects_others() {
        let data = json!({ "scope": "team:4", "revision": 7, "scopes": [{ "id": "personal", "name": "Personal", "canEdit": true }, { "id": "team:4", "name": "Acme", "canEdit": false }], "preferences": { "tasks": {} } });
        let snapshot = parse_snapshot("team:4", &data).unwrap();
        assert_eq!(snapshot.revision, 7);
        assert_eq!(snapshot.scopes[1], Scope { id: "team:4".into(), name: "Acme".into(), can_edit: false });
        assert!(parse_snapshot("personal", &data).is_err());
        assert!(parse_snapshot("team:4", &json!({ "scope": "team:4", "scopes": [] })).is_err());
        assert_eq!(encode("team:4"), "team%3A4");
    }

    #[test]
    fn preferences_round_trip_through_settings() {
        let mut settings = settings::Settings::default();
        let preferences = json!({
            "defaultConnection": { "providerId": "anthropic", "modelId": "claude-sonnet-4-5" },
            "tasks": { "chat-title": { "providerId": "openai", "modelId": "gpt-5-mini" } },
            "autoRouting": true,
        });
        apply(&mut settings, &preferences);
        assert_eq!(settings.ai_provider_id, "anthropic");
        assert_eq!(crate::intelligence::task_connection(&settings, "chat-title"), Some(("openai".into(), "gpt-5-mini".into())));
        assert_eq!(super::preferences(&settings), preferences);
    }
}
