//! The content of Settings > AI: the model and provider, API keys (kept in the keychain), the
//! custom endpoint and Ollama with model discovery, tab completion, the built-in agent's default
//! mode and rules, notifications, MCP servers (secrets in the keychain), installable agents and
//! skills.
//!
//! # Mounting (settings_ui)
//!
//! Keep one `cx.new(|cx| AiSettingsView::new(window, cx))` and push it after the "ai" page's rows,
//! as the keyboard page pushes its shortcut list; it draws its own sections in the page's style
//! and does not scroll by itself. The placeholder `SettingKind::Action` rows of the "ai" tab in
//! `settings/src/schema.rs` (provider, model, keys, custom endpoint, suggestions model) are what
//! this view replaces, so the page can hide them.
//!
//! Ported from Athas's `features/settings/components/tabs/ai-settings*.tsx`,
//! `features/ai/customize/*` and `services/mcp-server-secrets.ts`.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use ai_mcp::{McpNameValue, McpServerSecrets, McpServerSetting, McpTransportKind};
use ai_providers::{Keychain, RemoteModel, SecretStore, catalog, secrets};
use gpui::{
    AnyElement, App, AppContext as _, ClickEvent, Context, Entity, FocusHandle, Focusable, IntoElement, ParentElement, Render, SharedString,
    Styled, Subscription, Task, Window, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{
    Alert, Button, ButtonSize, ButtonTone, ButtonVariant, Dialog, DialogLayout, DialogSize, Field, Icon, IconName, IconSize, MenuEntry, MenuItem, OpenMenu, Switch, TextArea, TextInput,
    TextInputEvent, ToggleGroup, ToggleOption, metrics, typography,
};

use crate::{
    agent_registry::{AgentRegistry, InstallState, Operation},
    builtin::prompt::Mode,
    composer::{Composer, ComposerEvent},
};

/// How a provider's API key stands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeyStatus {
    /// Saved in the keychain, shown masked.
    Saved(String),
    /// Read from this environment variable.
    Environment(&'static str),
    Missing,
}

enum OllamaModels {
    Idle,
    Loading,
    Loaded(Vec<RemoteModel>),
    Failed(String),
}

/// One environment variable or header in the MCP server dialog (`NameValueList`).
struct NameValueRow {
    name: Entity<TextInput>,
    /// Masked, as a password field.
    value: Entity<TextInput>,
}

/// The MCP server dialog (`mcp-server-dialog.tsx`).
struct McpEditor {
    /// The server being changed; `None` for a new one.
    id: Option<String>,
    enabled: bool,
    name: Entity<TextInput>,
    transport: McpTransportKind,
    command: Entity<TextInput>,
    /// One argument per line.
    args: Entity<TextArea>,
    url: Entity<TextInput>,
    /// Environment variables (stdio); kept while another transport is picked, as the draft is.
    env: Vec<NameValueRow>,
    /// Headers (HTTP, SSE).
    headers: Vec<NameValueRow>,
    /// What a catalog server still needs from the user, above the form.
    setup_note: Option<String>,
    /// What keeps the draft from saving, under the field it is about (`FieldError`).
    errors: ai_mcp::DraftErrors,
    focus: FocusHandle,
}

/// The kinds Settings > Integrations lists (`integrations-settings.tsx`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Integration {
    Mcp,
    Agents,
    Skills,
    Extensions,
}

impl Integration {
    const ALL: [Integration; 4] = [Integration::Mcp, Integration::Agents, Integration::Skills, Integration::Extensions];

    fn id(self) -> &'static str {
        match self {
            Integration::Mcp => "mcp",
            Integration::Agents => "agents",
            Integration::Skills => "skills",
            Integration::Extensions => "extensions",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Integration::Mcp => "MCP servers",
            Integration::Agents => "Agents",
            Integration::Skills => "Skills",
            Integration::Extensions => "Extensions",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Integration::Mcp => "Give agents tools from your apps and services",
            Integration::Agents => "Coding agents that run in Athas with their own accounts",
            Integration::Skills => "Reusable instructions you can hand to any agent",
            Integration::Extensions => "Languages, themes and databases for the editor",
        }
    }

    fn placeholder(self) -> &'static str {
        match self {
            Integration::Mcp => "Search MCP servers",
            Integration::Agents => "Search agents",
            Integration::Skills => "Search skills",
            Integration::Extensions => "Search extensions",
        }
    }

    fn installed_label(self) -> &'static str {
        if self == Integration::Skills { "Personal" } else { "Installed" }
    }
}

/// Whether any of `fields` holds the query, ignoring case (`matchesCustomizeQuery`).
pub fn matches_query(query: &str, fields: &[&str]) -> bool {
    let query = query.trim().to_lowercase();
    query.is_empty() || fields.iter().any(|field| field.to_lowercase().contains(&query))
}

pub struct AiSettingsView {
    secrets: Arc<dyn SecretStore>,
    keys: HashMap<&'static str, KeyStatus>,
    /// The provider whose key is being typed.
    editing_key: Option<&'static str>,
    key_input: Entity<TextInput>,
    custom_url: Entity<TextInput>,
    custom_model: Entity<TextInput>,
    ollama_url: Entity<TextInput>,
    ollama: OllamaModels,
    /// The models each provider's `/models` lists, fetched when its model picker first shows.
    remote_models: HashMap<String, OllamaModels>,
    /// Whether model pickers ask providers for their lists; off for headless renders and tests.
    fetch_remote: bool,
    rules: Entity<Composer>,
    rules_dirty: bool,
    mcp_editor: Option<McpEditor>,
    registry: Entity<AgentRegistry>,
    notice: Option<String>,
    open_menu: Option<OpenMenu>,
    focus: FocusHandle,
    loading_keys: Option<Task<()>>,
    codex: crate::codex::CodexSettings,
    codex_installed: bool,
    /// What Settings > AI > Codex last learned from the app-server (`CodexIntegrationStatus`).
    codex_connection: crate::codex::probe::CodexConnection,
    /// Connect / Refresh, or a sign-in or sign-out, running.
    codex_busy: Option<Task<()>>,
    /// Whether "Models per feature" is unfolded; `None` follows whether any feature has its own.
    features_open: Option<bool>,
    integration: Integration,
    /// Kinds showing what is installed instead of the catalog.
    integration_installed: HashSet<Integration>,
    integration_query: Entity<TextInput>,
    /// An installed MCP server or agent another surface asked to show: its row keeps a quiet fill
    /// until the next reveal or kind change (`revealedItemId`).
    revealed: Option<String>,
    /// Set by a reveal until the page has scrolled the row to its middle.
    reveal_scroll: std::rc::Rc<std::cell::Cell<bool>>,
    /// The settings page's scroll, which a reveal moves.
    page_scroll: Option<gpui::ScrollHandle>,
    installing_skills: HashSet<String>,
    /// Codex's own skills for Integrations > Skills > Personal; `None` until listed.
    codex_skills: Option<Vec<crate::codex::CodexSkill>>,
    codex_skills_task: Option<Task<()>>,
    /// A confirmation asked over the page, such as removing a skill.
    confirm: Option<(Entity<ui::AlertDialog>, Subscription)>,
    /// Clear chat history waiting for the user to type "yes" (`TypedConfirmAction`).
    clear_history: Option<(Entity<TextInput>, Subscription)>,
    _subscriptions: Vec<Subscription>,
}

impl Focusable for AiSettingsView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

fn settings(cx: &App) -> settings::Settings {
    cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default()
}

fn update_settings(cx: &mut App, change: impl FnOnce(&mut settings::Settings)) {
    if cx.try_global::<settings::SettingsStore>().is_some() {
        settings::update(cx, change);
    }
}

/// The mark of each model row of `provider`'s picker.
fn model_icons(provider: &str) -> Box<dyn Fn(&str) -> IconName> {
    let provider = provider.to_string();
    Box::new(move |model| crate::model_vendor::model_icon(&provider, model))
}

/// Providers that take an API key, extensions' last.
fn keyed_providers() -> impl Iterator<Item = &'static catalog::Provider> {
    catalog::PROVIDERS
        .iter()
        .filter(|provider| provider.requires_api_key || provider.id == catalog::CUSTOM)
        .chain(ai_providers::external_providers().into_iter().filter(|provider| provider.requires_api_key))
}

fn catalog_mcp_servers(cx: &App) -> Vec<extensions::manifest::McpServerContribution> {
    cx.try_global::<extensions::Extensions>().map(|_| extensions::get(cx).catalog_mcp_servers()).unwrap_or_default().into_iter().map(|(_, server)| server).collect()
}

/// The npm or PyPI package a stdio command runs, without its version.
fn package_of(args: &[String]) -> Option<&str> {
    let name = args.iter().find(|arg| !arg.starts_with('-'))?;
    Some(match name.rfind('@') {
        Some(at) if at > 0 && !name[at..].contains('/') => &name[..at],
        _ => name,
    })
}

/// Whether a configured server is this catalog entry: the same name, the same remote URL, or the
/// same command running the same package. Users rename servers, so the name alone is not enough.
pub(crate) fn is_catalog_server(entry: &extensions::manifest::McpServerContribution, server: &McpServerSetting) -> bool {
    let name = server.name.trim().to_lowercase();
    if name == entry.id || name == entry.name.to_lowercase() {
        return true;
    }
    let normalize = |url: &str| url.trim().trim_end_matches('/').to_lowercase();
    match &entry.config {
        extensions::manifest::McpServerConfig::Stdio { command, args, .. } => {
            server.transport == McpTransportKind::Stdio && server.command == *command && package_of(&server.args) == package_of(args)
        }
        extensions::manifest::McpServerConfig::Http { url, .. } | extensions::manifest::McpServerConfig::Sse { url, .. } => {
            server.transport != McpTransportKind::Stdio && normalize(&server.url) == normalize(url)
        }
    }
}

/// The arguments of the dialog's Arguments field: one per line, blank lines left out
/// (`parseArgs`).
pub fn parse_args(text: &str) -> Vec<String> {
    text.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_string).collect()
}

/// The rows of a name/value list with both halves blank left out, names trimmed
/// (`withoutBlankRows`).
pub fn without_blank_rows(values: &[McpNameValue]) -> Vec<McpNameValue> {
    values.iter().map(|entry| McpNameValue { name: entry.name.trim().to_string(), value: entry.value.clone() }).filter(|entry| !entry.name.is_empty() || !entry.value.is_empty()).collect()
}

fn join_args(args: &[String]) -> String {
    args.iter().map(|arg| if arg.is_empty() || arg.contains(char::is_whitespace) { format!("\"{arg}\"") } else { arg.clone() }).collect::<Vec<_>>().join(" ")
}

impl AiSettingsView {
    /// The page with the keychain; in memory while a screenshot fixture is shown
    /// (`ATHAS_AGENT_FIXTURE`).
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let secrets: Arc<dyn SecretStore> =
            if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() { Arc::new(ai_providers::MemorySecrets::default()) } else { Arc::new(KeychainRef) };
        let mut this = Self::with_secrets(secrets, window, cx);
        this.fetch_remote = std::env::var_os("ATHAS_AGENT_FIXTURE").is_none();
        this
    }

    /// The page with `secrets` in place of the keychain (for headless renders and tests).
    pub fn with_secrets(secrets: Arc<dyn SecretStore>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let current = settings(cx);
        let input = |placeholder: &'static str, text: &str, window: &mut Window, cx: &mut Context<Self>| {
            let text = text.to_string();
            cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder(placeholder);
                if !text.is_empty() {
                    input.set_text(text, cx);
                }
                input
            })
        };
        let key_input = input("Paste the key; it is saved to the keychain", "", window, cx);
        key_input.update(cx, |input, cx| input.set_masked(true, cx));
        let custom_url = input("https://host/v1", &current.ai_custombase_url, window, cx);
        let custom_model = input("Model id", &current.ai_custom_model_id, window, cx);
        let ollama_url = input("http://localhost:11434", &current.ollama_base_url, window, cx);
        let rules = cx.new(Composer::new);
        rules.update(cx, |rules, cx| {
            rules.set_placeholder("Instructions for Athas Agent in every project… (Shift-Enter for a new line)", cx);
            rules.set_text(current.ai_user_rules.clone(), cx);
        });
        let registry = AgentRegistry::global(cx);
        let integration_query = cx.new(|cx| TextInput::new(window, cx).placeholder(Integration::Mcp.placeholder()).appearance(ui::InputAppearance::Bare));
        let mut subscriptions = vec![
            cx.subscribe(&integration_query, |_, input, event: &TextInputEvent, cx| match event {
                TextInputEvent::Changed(_) => cx.notify(),
                TextInputEvent::Cancelled => input.update(cx, |input, cx| input.set_text("", cx)),
                _ => {}
            }),
            cx.observe(&registry, |_, _, cx| cx.notify()),
            cx.subscribe(&key_input, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Confirmed => this.save_key(cx),
                TextInputEvent::Cancelled => {
                    this.editing_key = None;
                    cx.notify();
                }
                _ => {}
            }),
            cx.subscribe(&custom_url, |_, input, event: &TextInputEvent, cx| {
                if matches!(event, TextInputEvent::Confirmed | TextInputEvent::Blurred) {
                    let value = input.read(cx).text().trim().to_string();
                    update_settings(cx, |settings| settings.ai_custombase_url = value);
                }
            }),
            cx.subscribe(&custom_model, |_, input, event: &TextInputEvent, cx| {
                if matches!(event, TextInputEvent::Confirmed | TextInputEvent::Blurred) {
                    let value = input.read(cx).text().trim().to_string();
                    update_settings(cx, |settings| settings.ai_custom_model_id = value);
                }
            }),
            cx.subscribe(&ollama_url, |this, input, event: &TextInputEvent, cx| {
                if matches!(event, TextInputEvent::Confirmed | TextInputEvent::Blurred) {
                    let value = input.read(cx).text().trim().to_string();
                    let changed = settings(cx).ollama_base_url != value;
                    update_settings(cx, |settings| settings.ollama_base_url = value);
                    if changed || matches!(event, TextInputEvent::Confirmed) {
                        this.discover_ollama(cx);
                    }
                }
            }),
            cx.subscribe(&rules, |this, _, event: &ComposerEvent, cx| match event {
                ComposerEvent::Submit | ComposerEvent::SubmitNow => this.save_rules(cx),
                ComposerEvent::Changed => {
                    this.rules_dirty = true;
                    cx.notify();
                }
                _ => {}
            }),
        ];
        if cx.try_global::<settings::SettingsStore>().is_some() {
            subscriptions.push(cx.observe_global::<settings::SettingsStore>(|_, cx| cx.notify()));
        }
        if let Some(sync) = crate::intelligence_sync::global(cx) {
            subscriptions.push(cx.observe(&sync, |_, _, cx| cx.notify()));
        }
        if let Some(store) = account::AccountStore::global(cx) {
            subscriptions.push(cx.observe(&store, |_, _, cx| cx.notify()));
            store.update(cx, |store, cx| store.refresh_subscription(cx).detach());
        }
        let mut this = Self {
            secrets,
            keys: HashMap::new(),
            editing_key: None,
            key_input,
            custom_url,
            custom_model,
            ollama_url,
            ollama: OllamaModels::Idle,
            remote_models: HashMap::new(),
            fetch_remote: false,
            rules,
            rules_dirty: false,
            mcp_editor: None,
            registry,
            notice: None,
            open_menu: None,
            focus: cx.focus_handle(),
            loading_keys: None,
            codex: crate::codex::CodexSettings::load(),
            codex_installed: crate::codex::is_installed(),
            codex_connection: crate::codex::probe::last().unwrap_or_default(),
            codex_busy: None,
            features_open: None,
            integration: Integration::Mcp,
            integration_installed: HashSet::new(),
            revealed: None,
            reveal_scroll: std::rc::Rc::default(),
            page_scroll: None,
            integration_query,
            installing_skills: HashSet::new(),
            codex_skills: None,
            codex_skills_task: None,
            confirm: None,
            clear_history: None,
            _subscriptions: subscriptions,
        };
        this.load_keys(cx);
        this.read_codex_status(cx);
        if current.ai_provider_id == catalog::OLLAMA || current.ai_autocomplete_provider == catalog::OLLAMA {
            this.discover_ollama(cx);
        }
        this
    }

    /// Reads which keys are saved, off the main thread (a keychain read can block).
    fn load_keys(&mut self, cx: &mut Context<Self>) {
        let store = self.secrets.clone();
        self.loading_keys = Some(cx.spawn(async move |this, cx| {
            let keys = cx
                .background_spawn(async move {
                    keyed_providers()
                        .map(|provider| {
                            let status = match store.get(&secrets::provider_key_account(provider.id)) {
                                Some(key) => KeyStatus::Saved(secrets::mask(&key)),
                                None => provider
                                    .key_env
                                    .iter()
                                    .find(|name| std::env::var(name).is_ok_and(|value| !value.trim().is_empty()))
                                    .map_or(KeyStatus::Missing, |name| KeyStatus::Environment(name)),
                            };
                            (provider.id, status)
                        })
                        .collect::<HashMap<_, _>>()
                })
                .await;
            this.update(cx, |this, cx| {
                this.keys = keys;
                this.loading_keys = None;
                cx.notify();
            })
            .ok();
        }));
    }

    pub fn key_status(&self, provider: &str) -> KeyStatus {
        self.keys.get(provider).cloned().unwrap_or(KeyStatus::Missing)
    }

    fn edit_key(&mut self, provider: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        self.editing_key = Some(provider);
        self.key_input.update(cx, |input, cx| {
            input.set_text("", cx);
            input.focus(window, cx);
        });
        cx.notify();
    }

    /// Opens a provider's key field with `text` typed, as a screenshot shows it.
    pub fn show_key_entry(&mut self, provider: &'static str, text: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.edit_key(provider, window, cx);
        self.key_input.update(cx, |input, cx| input.set_text(text.to_string(), cx));
    }

    fn save_key(&mut self, cx: &mut Context<Self>) {
        let Some(provider) = self.editing_key else { return };
        let key = self.key_input.read(cx).text().trim().to_string();
        self.key_input.update(cx, |input, cx| input.set_text("", cx));
        self.editing_key = None;
        if key.is_empty() {
            cx.notify();
            return;
        }
        // Every key is checked before it is kept (`saveApiKey` → `validateApiKey`); an Ollama key
        // against Ollama Cloud.
        let ollama_base = settings(cx).ollama_base_url;
        cx.spawn(async move |this, cx| {
            let valid = if ai_providers::external::external_provider(provider).is_some() {
                ai_providers::external::validate_api_key(provider, &key).await != Some(false)
            } else if provider == catalog::OLLAMA {
                ai_providers::connection::validate_ollama_key(&ollama_base, &key).await
            } else if let Some(entry) = catalog::provider(provider).filter(|entry| !entry.url.is_empty()) {
                crate::provider_key_dialog::validate_key(entry, &key).await.unwrap_or(false)
            } else {
                true
            };
            this.update(cx, |this, cx| {
                if valid {
                    this.write_secret(provider, Some(key), cx);
                } else {
                    this.notice = Some("That key did not work".to_string());
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    fn remove_key(&mut self, provider: &'static str, cx: &mut Context<Self>) {
        self.write_secret(provider, None, cx);
    }

    fn write_secret(&mut self, provider: &'static str, key: Option<String>, cx: &mut Context<Self>) {
        let store = self.secrets.clone();
        let account = secrets::provider_key_account(provider);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move {
                    match &key {
                        Some(key) => store.set(&account, key),
                        None => store.delete(&account),
                    }
                })
                .await;
            this.update(cx, |this, cx| {
                this.notice = result.err();
                this.remote_models.remove(provider);
                this.load_keys(cx);
            })
            .ok();
        })
        .detach();
    }

    /// The row a model menu starts with while `provider`'s list loads or after it failed
    /// (`ModelSection` status): Loading…, or the error with Retry.
    fn model_status_entries(&self, provider: &str, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let state = if provider == catalog::OLLAMA { Some(&self.ollama) } else { self.remote_models.get(provider) };
        match state {
            Some(OllamaModels::Loading) => vec![MenuEntry::Item(MenuItem::new("Loading…").disabled(true).hidden_while_searching())],
            Some(OllamaModels::Failed(error)) => {
                let view = cx.entity();
                let provider = provider.to_string();
                vec![MenuEntry::Item(MenuItem::new(error.clone()).icon(IconName::Warning).trailing_text("Retry").hidden_while_searching().keep_open().on_select(move |_, cx| {
                    let provider = provider.clone();
                    view.update(cx, |this, cx| {
                        this.retry_models(&provider, cx);
                        let status = this.model_status_entries(&provider, cx);
                        if let Some(open) = &this.open_menu {
                            open.menu.update(cx, |menu, cx| menu.update_entries(|entries| { entries.splice(0..1, status); }, cx));
                        }
                    });
                }))]
            }
            _ => Vec::new(),
        }
    }

    /// Asks `provider` for its models again.
    fn retry_models(&mut self, provider: &str, cx: &mut Context<Self>) {
        if provider == catalog::OLLAMA {
            self.discover_ollama(cx);
        } else {
            self.remote_models.remove(provider);
            self.fetch_models(provider, cx);
        }
        cx.notify();
    }

    /// Asks `provider` which models it offers, with the saved key; the catalog's list stays when
    /// it cannot answer.
    fn fetch_models(&mut self, provider: &str, cx: &mut Context<Self>) {
        if !self.fetch_remote || self.remote_models.contains_key(provider) || matches!(provider, catalog::OLLAMA | catalog::CUSTOM) || catalog::provider(provider).is_none() {
            return;
        }
        let mut provider_settings = crate::builtin::provider_settings(&settings(cx));
        provider_settings.provider_id = provider.to_string();
        let store = self.secrets.clone();
        let provider = provider.to_string();
        self.remote_models.insert(provider.clone(), OllamaModels::Loading);
        cx.spawn(async move |this, cx| {
            let connection = cx.background_spawn(async move { ai_providers::Connection::resolve(&provider_settings, store.as_ref()) }).await;
            let result = match connection {
                Ok(connection) => connection.list_models().await.map(|models| ai_providers::chat_models(&provider, models)).map_err(|error| error.message),
                Err(error) => Err(format!("{error:?}")),
            };
            this.update(cx, |this, cx| {
                this.remote_models.insert(provider, match result {
                    Ok(models) => OllamaModels::Loaded(models),
                    Err(error) => OllamaModels::Failed(error),
                });
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Asks the Ollama server which models it has pulled.
    pub fn discover_ollama(&mut self, cx: &mut Context<Self>) {
        let base = settings(cx).ollama_base_url;
        let key = ai_providers::catalog::provider(ai_providers::catalog::OLLAMA)
            .filter(|_| std::env::var_os("ATHAS_AGENT_FIXTURE").is_none())
            .and_then(|provider| ai_providers::secrets::api_key(&KeychainRef, provider));
        self.ollama = OllamaModels::Loading;
        cx.spawn(async move |this, cx| {
            let result = ai_providers::discover_ollama_models(&base, key.as_deref()).await;
            this.update(cx, |this, cx| {
                this.ollama = match result {
                    Ok(models) => OllamaModels::Loaded(models),
                    Err(error) => OllamaModels::Failed(format!("Ollama is not answering at {base}: {}", error.message)),
                };
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    fn save_rules(&mut self, cx: &mut Context<Self>) {
        let rules = self.rules.read(cx).text().trim().to_string();
        update_settings(cx, |settings| settings.ai_user_rules = rules);
        self.rules_dirty = false;
        cx.notify();
    }

    /// The models to pick from for `provider`: the catalog's, or Ollama's pulled ones.
    fn models_for(&self, provider: &str, cx: &App) -> Vec<(String, String)> {
        if catalog::provider(provider).is_none()
            && let Some(extension) = crate::extension_hooks::extension_providers(cx).into_iter().find(|extension| extension.id == provider)
        {
            return extension.models;
        }
        if provider == catalog::OLLAMA
            && let OllamaModels::Loaded(models) = &self.ollama
        {
            return models.iter().map(|model| (model.id.clone(), model.name.clone())).collect();
        }
        if let Some(OllamaModels::Loaded(models)) = self.remote_models.get(provider)
            && !models.is_empty()
        {
            return models.iter().map(|model| (model.id.clone(), model.name.clone())).collect();
        }
        catalog::provider(provider).map(|provider| provider.models.iter().map(|model| (model.id.to_string(), model.name.to_string())).collect()).unwrap_or_default()
    }

    fn show_menu(&mut self, key: &str, entries: Vec<MenuEntry>, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.open_menu = Some(OpenMenu::new(key.to_string(), entries, event.position(), gpui::Anchor::TopRight, window, cx, |this, _| this.open_menu = None));
        cx.notify();
    }

    /// A picker button that opens a menu of `(id, name)` choices and saves the pick with `pick`.
    fn picker(
        &self,
        id: &'static str,
        label: String,
        choices: Vec<(String, String)>,
        current: String,
        pick: fn(&mut settings::Settings, String),
        icon: Option<Box<dyn Fn(&str) -> IconName>>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let icon: Option<std::rc::Rc<dyn Fn(&str) -> IconName>> = icon.map(std::rc::Rc::from);
        let mark = icon.as_ref().map(|icon| {
            let color = cx.theme().colors.muted_foreground;
            if id.ends_with("provider") { crate::model_vendor::provider_mark(&current, px(14.), color) } else { Icon::new(icon(&current)).size(IconSize::Small).color(color).into_any_element() }
        });
        Button::new(id, label)
            .when_some(mark, |button, mark| button.leading(mark))
            .variant(ButtonVariant::Outline)
            .size(ButtonSize::Small)
            .trailing_icon(IconName::ChevronDown)
            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                let long = crate::model_vendor::is_long(choices.len());
                let entries = if long {
                    let ids: Vec<String> = choices.iter().map(|(value, _)| value.clone()).collect();
                    crate::model_vendor::model_entries(&ids, |index| {
                        let (value, name) = choices[index].clone();
                        let mut item = MenuItem::new(name);
                        if let Some(icon) = &icon {
                            item = item.icon(icon(&value));
                        }
                        item.checked(value == current).on_select(move |_, cx| {
                            let value = value.clone();
                            update_settings(cx, move |settings| pick(settings, value));
                        })
                    })
                } else {
                    choices
                        .iter()
                        .map(|(value, name)| {
                            let value = value.clone();
                            let mut item = MenuItem::new(name.clone());
                            if let Some(icon) = &icon {
                                item = item.icon(icon(&value));
                            }
                            MenuEntry::Item(item.checked(value == current).on_select(move |_, cx| {
                                let value = value.clone();
                                update_settings(cx, move |settings| pick(settings, value));
                            }))
                        })
                        .collect()
                };
                let mut entries = entries;
                if id == "ai-model" {
                    entries.splice(0..0, this.model_status_entries(&settings(cx).ai_provider_id, cx));
                }
                this.show_menu(id, entries, event, window, cx);
                if long && let Some(menu) = this.open_menu.take() {
                    this.open_menu = Some(menu.searchable("Search…", "No matches", cx));
                }
            }))
            .into_any_element()
    }

    fn name_value_row(name: &str, value: &str, name_placeholder: &'static str, window: &mut Window, cx: &mut Context<Self>) -> NameValueRow {
        let (name, value) = (name.to_string(), value.to_string());
        NameValueRow {
            name: cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder(name_placeholder);
                input.set_text(name, cx);
                input
            }),
            value: cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder("Value").masked();
                input.set_text(value, cx);
                input
            }),
        }
    }

    fn name_value_rows(values: &[McpNameValue], header: bool, window: &mut Window, cx: &mut Context<Self>) -> Vec<NameValueRow> {
        let placeholder = if header { "Authorization" } else { "API_KEY" };
        values.iter().map(|entry| Self::name_value_row(&entry.name, &entry.value, placeholder, window, cx)).collect()
    }

    fn read_name_values(rows: &[NameValueRow], cx: &App) -> Vec<McpNameValue> {
        rows.iter().map(|row| McpNameValue { name: row.name.read(cx).text().to_string(), value: row.value.read(cx).text().to_string() }).collect()
    }

    /// Opens the MCP server dialog for `id`, or for a new server; for headless renders.
    pub fn open_mcp_server_editor(&mut self, id: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let server = id.and_then(|id| settings(cx).mcp_servers.iter().filter_map(|value| serde_json::from_value::<McpServerSetting>(value.clone()).ok()).find(|server| server.id == id));
        self.open_mcp_editor(server, window, cx);
    }

    fn open_mcp_editor(&mut self, server: Option<McpServerSetting>, window: &mut Window, cx: &mut Context<Self>) {
        let input = |placeholder: &'static str, text: String, window: &mut Window, cx: &mut Context<Self>| {
            cx.new(|cx| {
                let mut input = TextInput::new(window, cx).placeholder(placeholder);
                if !text.is_empty() {
                    input.set_text(text, cx);
                }
                input
            })
        };
        let existing = server.clone();
        let name = input("linear", existing.as_ref().map(|server| server.name.clone()).unwrap_or_default(), window, cx);
        let command = input("npx", existing.as_ref().map(|server| server.command.clone()).unwrap_or_default(), window, cx);
        let args_text = existing.as_ref().map(|server| server.args.join("\n")).unwrap_or_default();
        let args = cx.new(|cx| {
            let mut area = TextArea::new(cx).rows(3).mono().placeholder("-y\n@modelcontextprotocol/server-filesystem\n.");
            area.set_text(args_text, cx);
            area
        });
        let url = input("https://mcp.example.com/mcp", existing.as_ref().map(|server| server.url.clone()).unwrap_or_default(), window, cx);
        name.update(cx, |input, cx| input.focus(window, cx));
        self.mcp_editor = Some(McpEditor {
            id: existing.as_ref().map(|server| server.id.clone()),
            enabled: existing.as_ref().is_none_or(|server| server.enabled),
            name,
            transport: existing.as_ref().map_or(McpTransportKind::Stdio, |server| server.transport),
            command,
            args,
            url,
            env: Vec::new(),
            headers: Vec::new(),
            setup_note: None,
            errors: ai_mcp::DraftErrors::default(),
            focus: cx.focus_handle(),
        });
        // The saved secrets come from the keychain, off the main thread.
        if let Some(server) = existing
            && let Some(account) = ai_mcp::secrets_key(&server.id)
        {
            let store = self.secrets.clone();
            let id = server.id.clone();
            cx.spawn_in(window, async move |this, cx| {
                let saved = cx.background_spawn(async move { store.get(&account) }).await;
                let Some(saved) = saved.and_then(|json| serde_json::from_str::<McpServerSecrets>(&json).ok()) else { return };
                this.update_in(cx, |this, window, cx| {
                    let env = Self::name_value_rows(&saved.env, false, window, cx);
                    let headers = Self::name_value_rows(&saved.headers, true, window, cx);
                    if let Some(editor) = this.mcp_editor.as_mut().filter(|editor| editor.id.as_deref() == Some(id.as_str())) {
                        editor.env = env;
                        editor.headers = headers;
                        cx.notify();
                    }
                })
                .ok();
            })
            .detach();
        }
        cx.notify();
    }

    fn close_mcp_editor(&mut self, cx: &mut Context<Self>) {
        self.mcp_editor = None;
        cx.notify();
    }

    fn save_mcp(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = &mut self.mcp_editor else { return };
        let name = editor.name.read(cx).text().trim().to_string();
        let command = editor.command.read(cx).text().trim().to_string();
        let url = editor.url.read(cx).text().trim().to_string();
        let args = parse_args(editor.args.read(cx).text());
        let stdio = editor.transport == McpTransportKind::Stdio;
        let values = Self::read_name_values(if stdio { &editor.env } else { &editor.headers }, cx);
        let servers: Vec<McpServerSetting> = settings(cx).mcp_servers.iter().filter_map(|value| serde_json::from_value(value.clone()).ok()).collect();
        let draft = ai_mcp::Draft { id: editor.id.as_deref(), name: &name, transport: editor.transport, command: &command, url: &url, values: &values };
        let errors = ai_mcp::validate_draft(&draft, &servers);
        let has_errors = errors.any();
        editor.errors = errors;
        if has_errors {
            cx.notify();
            return;
        }
        let pairs = without_blank_rows(&values);
        let id = editor.id.clone().unwrap_or_else(|| format!("mcp-{:x}", web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map_or(0, |duration| duration.as_millis())));
        let setting = McpServerSetting {
            id: id.clone(),
            name,
            enabled: editor.enabled,
            transport: editor.transport,
            command: if stdio { command } else { String::new() },
            args: if stdio { args } else { Vec::new() },
            url: if stdio { String::new() } else { url },
        };
        let value = serde_json::to_value(&setting).unwrap_or_default();
        update_settings(cx, |settings| match settings.mcp_servers.iter().position(|server| server.get("id").and_then(serde_json::Value::as_str) == Some(id.as_str())) {
            Some(index) => settings.mcp_servers[index] = value,
            None => settings.mcp_servers.push(value),
        });
        let secrets = if stdio { McpServerSecrets { env: pairs, headers: Vec::new() } } else { McpServerSecrets { env: Vec::new(), headers: pairs } };
        self.write_mcp_secrets(&id, secrets, cx);
        self.close_mcp_editor(cx);
    }

    fn write_mcp_secrets(&mut self, id: &str, secrets: McpServerSecrets, cx: &mut Context<Self>) {
        let Some(account) = ai_mcp::secrets_key(id) else { return };
        let store = self.secrets.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move {
                    if secrets.env.is_empty() && secrets.headers.is_empty() {
                        store.delete(&account)
                    } else {
                        store.set(&account, &serde_json::to_string(&secrets).unwrap_or_default())
                    }
                })
                .await;
            this.update(cx, |this, cx| {
                this.notice = result.err();
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn remove_mcp(&mut self, id: String, cx: &mut Context<Self>) {
        update_settings(cx, |settings| settings.mcp_servers.retain(|server| server.get("id").and_then(serde_json::Value::as_str) != Some(id.as_str())));
        self.write_mcp_secrets(&id, McpServerSecrets::default(), cx);
    }

    fn toggle_mcp(id: String, enabled: bool, cx: &mut App) {
        update_settings(cx, |settings| {
            if let Some(server) = settings.mcp_servers.iter_mut().find(|server| server.get("id").and_then(serde_json::Value::as_str) == Some(id.as_str())) {
                server["enabled"] = serde_json::Value::Bool(enabled);
            }
        });
    }
}

/// The app's keychain behind an `Arc`.
pub(crate) struct KeychainRef;

impl SecretStore for KeychainRef {
    fn get(&self, account: &str) -> Option<String> {
        Keychain::shared().get(account)
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        Keychain::shared().set(account, value)
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        Keychain::shared().delete(account)
    }
}

fn row(label: impl Into<SharedString>, description: Option<SharedString>, control: impl IntoElement, first: bool, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .relative()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(24.))
        .min_h(px(44.))
        .py(px(10.))
        .px(px(12.))
        .when(!first, |this| this.child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider)))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(2.))
                .child(div().text_size(typography::TEXT_SM).text_color(colors.foreground).child(label.into()))
                .children(description.map(|description| div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(description))),
        )
        .child(div().flex().flex_none().items_center().gap(px(6.)).child(control))
        .into_any_element()
}

fn section(title: &'static str, rows: Vec<AnyElement>, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .child(div().px(px(12.)).text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.muted_foreground).child(title))
        .child(div().flex().flex_col().rounded(metrics::ISLAND_RADIUS).bg(colors.raised).shadow(cx.theme().shadows.raised.clone()).overflow_hidden().children(rows))
        .into_any_element()
}

fn caption(text: impl Into<SharedString>, cx: &App) -> gpui::Div {
    div().text_size(typography::TEXT_CAPTION).text_color(cx.theme().colors.subtle_foreground).child(text.into())
}

impl AiSettingsView {
    fn model_rows(&mut self, current: &settings::Settings, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let extension_providers = crate::extension_hooks::extension_providers(cx);
        let mut providers: Vec<(String, String)> = catalog::PROVIDERS.iter().map(|provider| (provider.id.to_string(), provider.name.to_string())).collect();
        providers.extend(extension_providers.iter().filter(|provider| catalog::provider(&provider.id).is_none()).map(|provider| (provider.id.clone(), provider.name.clone())));
        let provider_name = providers.iter().find(|(id, _)| *id == current.ai_provider_id).map_or(current.ai_provider_id.clone(), |(_, name)| name.clone());
        let provider_picker = self.picker(
            "ai-provider",
            provider_name,
            providers,
            current.ai_provider_id.clone(),
            |settings, value| {
                crate::intelligence::set_default_auto(settings, false);
                if settings.ai_provider_id != value {
                    settings.ai_model_id = catalog::provider(&value).and_then(|provider| provider.models.first()).map(|model| model.id.to_string()).unwrap_or_default();
                }
                settings.ai_provider_id = value;
            },
            Some(Box::new(crate::model_vendor::provider_icon)),
            cx,
        );
        let credit = (current.ai_provider_id == catalog::ATHAS)
            .then(|| account::AccountStore::global(cx))
            .flatten()
            .and_then(|store| store.read(cx).subscription().and_then(|subscription| subscription.credits.as_ref()).and_then(account::CreditUsage::from_credits));
        let description = match credit {
            Some(credit) => SharedString::from(match credit.detail {
                Some(detail) => format!("Included credit: {} · {detail}", credit.label),
                None => format!("Included credit: {}", credit.label),
            }),
            None => "Athas models, your own API key, or a local model".into(),
        };
        // An `auto` default runs on Athas while the account has it; the pickers keep the device's
        // own connection, which a pick here makes the default instead.
        let routed = crate::intelligence::default_provider_in(current, crate::intelligence::account_access(cx).0);
        let description = if routed.provider_id == catalog::ATHAS && current.ai_provider_id != catalog::ATHAS {
            SharedString::from("Automatic: Athas picks a model per request. Choose one here to use it instead")
        } else {
            description
        };
        let mut rows = vec![row("Provider", Some(description), provider_picker, true, cx)];
        if current.ai_provider_id == catalog::CUSTOM {
            rows.push(row("Server address", Some("Any OpenAI-compatible server".into()), div().w(px(280.)).child(self.custom_url.clone()), false, cx));
            rows.push(row("Model", None, div().w(px(280.)).child(self.custom_model.clone()), false, cx));
        } else {
            self.fetch_models(&current.ai_provider_id.clone(), cx);
            let models = self.models_for(&current.ai_provider_id, cx);
            let label = models.iter().find(|(id, _)| *id == current.ai_model_id).map_or_else(
                || if current.ai_model_id.is_empty() { "Choose a model".to_string() } else { current.ai_model_id.clone() },
                |(_, name)| name.clone(),
            );
            let description = (current.ai_provider_id == catalog::OLLAMA).then(|| match &self.ollama {
                OllamaModels::Loaded(models) => SharedString::from(format!("{} models pulled", models.len())),
                OllamaModels::Loading => "Asking Ollama…".into(),
                OllamaModels::Failed(error) => error.clone().into(),
                OllamaModels::Idle => "Find the models Ollama has pulled".into(),
            });
            let picker = self.picker("ai-model", label, models, current.ai_model_id.clone(), |settings, value| {
                crate::intelligence::set_default_auto(settings, false);
                settings.ai_model_id = value;
            }, Some(model_icons(&current.ai_provider_id)), cx);
            rows.push(row("Model", description, picker, false, cx));
        }
        rows
    }

    /// Plan, included credit and pay-as-you-go balance for Athas models (`athas-plan-section.tsx`).
    fn athas_rows(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let store = account::AccountStore::global(cx);
        let Some(store) = store.filter(|store| store.read(cx).is_signed_in()) else {
            let signing_in = account::AccountStore::global(cx).is_some_and(|store| store.read(cx).state().login_url().is_some());
            let sign_in = Button::new("athas-sign-in", if signing_in { "Signing in…" } else { "Sign in" })
                .variant(ButtonVariant::Accent)
                .size(ButtonSize::Small)
                .disabled(signing_in)
                .on_click(|_, _, cx| {
                    if let Some(store) = account::AccountStore::global(cx) {
                        store.update(cx, |store, cx| store.sign_in(cx));
                    }
                });
            return vec![row("Plan", Some("Sign in to use Athas models".into()), sign_in, true, cx)];
        };
        let (plan, intelligence, credits, policy, urls) = {
            let store = store.read(cx);
            let subscription = store.subscription();
            (
                store.plan_label(),
                store.features().allows(account::Capability::Intelligence),
                subscription.and_then(|subscription| subscription.credits.clone()),
                subscription.and_then(|subscription| subscription.enterprise.policy.clone()).filter(|policy| policy.managed_mode),
                store.urls().clone(),
            )
        };
        let usage = credits.as_ref().and_then(crate::hosted_usage::usage);
        let billing = urls.billing();
        let plan_badge = ui::Badge::new(plan).tone(if intelligence { ui::Tone::Accent } else { ui::Tone::Neutral });
        let plan_control = if intelligence {
            let billing = billing.clone();
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .children(usage.as_ref().map(|usage| {
                    let tone = match usage.level {
                        crate::hosted_usage::Level::Exhausted => ui::ProgressTone::Error,
                        crate::hosted_usage::Level::Low => ui::ProgressTone::Warning,
                        _ => ui::ProgressTone::Accent,
                    };
                    div().w(px(96.)).child(ui::Progress::new(usage.used_percent as f32).tone(tone))
                }))
                .child(Button::new("athas-manage", "Manage").variant(ButtonVariant::Outline).size(ButtonSize::Small).on_click(move |_, _, cx| cx.open_url(&billing)))
                .into_any_element()
        } else {
            let pricing = urls.pricing();
            Button::new("athas-upgrade", "Upgrade").variant(ButtonVariant::Accent).size(ButtonSize::Small).on_click(move |_, _, cx| cx.open_url(&pricing)).into_any_element()
        };
        let plan_description = if intelligence { usage.as_ref().map(crate::hosted_usage::describe_included_credit) } else { Some("Pro includes Athas credit every month".to_string()) };
        let plan_control = div().flex().items_center().gap(px(8.)).child(plan_badge).child(plan_control);
        let mut rows = vec![row("Plan", plan_description.map(SharedString::from), plan_control, true, cx)];
        let balance = usage.as_ref().and_then(|usage| usage.wallet_balance_cents).or_else(|| credits.as_ref().and_then(|credits| credits.wallet_balance_cents)).map(crate::hosted_usage::format_cents);
        let balance_control = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .children(balance.map(|balance| div().text_size(typography::TEXT_SM).text_color(cx.theme().colors.foreground).child(balance)))
            .child(Button::new("athas-add-credit", "Add Credit").variant(ButtonVariant::Outline).size(ButtonSize::Small).on_click(move |_, _, cx| cx.open_url(&billing)));
        let rate = crate::hosted_usage::usage_rate(credits.as_ref().and_then(|credits| credits.usage_markup));
        rows.push(row("Balance", Some(format!("Used after included credit, at {rate}").into()), balance_control, false, cx));
        if let Some(policy) = policy {
            let limits = [(!policy.ai_chat_enabled).then_some("Chat off"), (!policy.ai_completion_enabled).then_some("Tab completion off"), (!policy.allow_byok).then_some("No personal keys")]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
            rows.push(row("Managed by your organization", (!limits.is_empty()).then(|| limits.into()), ui::Badge::new("Managed").tone(ui::Tone::Accent), false, cx));
        }
        rows
    }

    fn key_rows(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        keyed_providers()
            .enumerate()
            .map(|(index, provider)| {
                let id = provider.id;
                let colors = cx.theme().colors.clone();
                let status = self.key_status(id);
                let description: SharedString = match &status {
                    KeyStatus::Saved(mask) => format!("Saved in the keychain · {mask}").into(),
                    KeyStatus::Environment(name) => format!("From ${name}").into(),
                    KeyStatus::Missing if self.loading_keys.is_some() => "Checking…".into(),
                    KeyStatus::Missing => "Not set".into(),
                };
                let control = if self.editing_key == Some(id) {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(div().w(px(260.)).child(self.key_input.clone()))
                        .child(Button::new(("key-save", index), "Save").variant(ButtonVariant::Accent).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.save_key(cx))))
                        .into_any_element()
                } else {
                    let saved = matches!(status, KeyStatus::Saved(_));
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .when_some(provider.key_url, |this, url| {
                            this.child(Button::icon(("key-url", index), IconName::OpenExternal).size(ButtonSize::Small).tooltip("Create a key").on_click(move |_, _, cx| cx.open_url(url)))
                        })
                        .when(saved, |this| {
                            this.child(Button::new(("key-remove", index), "Remove").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.remove_key(id, cx))))
                        })
                        .child(
                            Button::new(("key-edit", index), if saved { "Replace" } else { "Add key" })
                                .variant(ButtonVariant::Default)
                                .size(ButtonSize::Small)
                                .leading_icon(IconName::Key)
                                .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| this.edit_key(id, window, cx))),
                        )
                        .into_any_element()
                };
                let label = div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(provider.name)
                    .when(matches!(status, KeyStatus::Saved(_) | KeyStatus::Environment(_)), |this| this.child(Icon::new(IconName::CheckCircle).size(IconSize::XSmall).color(colors.success)));
                row_with_label(label, Some(description), control, index == 0, cx)
            })
            .collect()
    }

    /// "Other features": a model per feature, folded away until asked for
    /// (`settings/components/ai/feature-models-section.tsx`).
    fn feature_rows(&self, current: &settings::Settings, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let count = crate::intelligence::override_count(current);
        let open = self.features_open.unwrap_or(count > 0);
        let toggle = Button::new("features-toggle", if open { "Hide" } else { "Show" })
            .variant(ButtonVariant::Ghost)
            .size(ButtonSize::Small)
            .leading_icon(if open { IconName::ChevronDown } else { IconName::ChevronRight })
            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                this.features_open = Some(!open);
                cx.notify();
            }));
        let description: SharedString = if count > 0 { format!("{count} with their own model").into() } else { "All use the default model".into() };
        let mut rows = vec![row("Models per feature", Some(description), toggle, true, cx)];
        if !open {
            return rows;
        }
        if let Some(sync) = crate::intelligence_sync::global(cx).filter(|sync| sync.read(cx).is_signed_in()) {
            let (scope_name, scopes, error, can_edit) = {
                let sync = sync.read(cx);
                let name = sync.scopes().iter().find(|scope| scope.id == sync.scope()).map_or_else(|| "Personal".to_string(), |scope| scope.name.clone());
                (name, sync.scopes().to_vec(), sync.error().map(str::to_string), sync.can_edit())
            };
            let description: SharedString = if can_edit { "Synced with your Athas account".into() } else { "Set by the team's admins".into() };
            let picker = Button::new("feature-scope", scope_name)
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .trailing_icon(IconName::ChevronDown)
                .disabled(scopes.len() < 2)
                .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                    let current = sync.read(cx).scope().to_string();
                    let entries = scopes
                        .iter()
                        .map(|scope| {
                            let (sync, id) = (sync.clone(), scope.id.clone());
                            ui::MenuEntry::Item(ui::MenuItem::new(scope.name.clone()).checked(scope.id == current).on_select(move |_, cx| {
                                let id = id.clone();
                                sync.update(cx, |sync, cx| sync.set_scope(id, cx));
                            }))
                        })
                        .collect();
                    this.show_menu("feature-scope", entries, event, window, cx);
                }));
            rows.push(row("Scope", Some(description), picker, false, cx));
            if let Some(error) = error {
                let sync = crate::intelligence_sync::global(cx);
                let reload = Button::new("feature-sync-reload", "Reload saved settings").variant(ButtonVariant::Default).size(ButtonSize::Small).on_click(move |_, _, cx| {
                    if let Some(sync) = &sync {
                        sync.update(cx, |sync, cx| sync.refresh(true, cx));
                    }
                });
                rows.push(row("Couldn't sync", Some(error.into()), reload, false, cx));
            }
        }
        let choices = self.model_choices(cx);
        for (index, (task, label)) in crate::intelligence::TASK_OVERRIDES.iter().enumerate() {
            let name = crate::intelligence::connection_label(current, task, &choices);
            let connection = crate::intelligence::task_connection(current, task);
            // The model's name with its mark; the provider in the tooltip ("… via OpenAI").
            let (picker_label, tooltip) = match (&connection, name.split_once(" · ")) {
                (Some((provider, model)), _) if provider == catalog::ATHAS && (model.is_empty() || model == "auto") => ("Athas Automatic".to_string(), "Athas Automatic".to_string()),
                (Some(_), Some((provider_name, model_name))) => (model_name.to_string(), format!("{model_name} via {provider_name}")),
                _ => (name.clone(), name.clone()),
            };
            let choices = choices.clone();
            let task = *task;
            let mut picker = Button::new(("feature-model", index), picker_label)
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .tooltip(tooltip)
                .trailing_icon(IconName::ChevronDown);
            if let Some((provider, model)) = &connection {
                picker = picker.leading_icon(crate::model_vendor::model_icon(provider, model));
            }
            let picker = picker
                .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                    let entries = crate::intelligence::connection_entries(&settings(cx), task, &choices, |provider| this.is_connected(provider));
                    this.show_menu(&format!("feature-model-{task}"), entries, event, window, cx);
                    if let Some(menu) = this.open_menu.take() {
                        this.open_menu = Some(menu.searchable("Select a model…", "No matching models", cx));
                    }
                }));
            rows.push(row(*label, None, picker, false, cx));
        }
        rows
    }

    /// Every model a model menu can offer, as (`provider::model`, "Provider · Model"), with the
    /// models discovered on Ollama and the extensions' providers.
    fn model_choices(&self, cx: &App) -> Vec<(String, String)> {
        let mut choices: Vec<(String, String)> = Vec::new();
        let extension_providers = crate::extension_hooks::extension_providers(cx);
        let providers = catalog::PROVIDERS
            .iter()
            .filter(|provider| provider.id != catalog::CUSTOM)
            .map(|provider| (provider.id.to_string(), provider.name.to_string()))
            .chain(extension_providers.iter().filter(|provider| catalog::provider(&provider.id).is_none()).map(|provider| (provider.id.clone(), provider.name.clone())));
        for (provider_id, provider_name) in providers {
            for (model_id, model_name) in self.models_for(&provider_id, cx) {
                choices.push((format!("{provider_id}::{model_id}"), format!("{provider_name} · {model_name}")));
            }
        }
        choices
    }

    fn is_connected(&self, provider: &str) -> bool {
        match catalog::provider(provider) {
            Some(known) => known.id == catalog::ATHAS || !known.requires_api_key || self.key_status(provider) != KeyStatus::Missing,
            None => true,
        }
    }

    /// Buttons extensions add for the providers they register.
    fn extension_action_rows(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        crate::extension_hooks::extension_settings_actions(cx)
            .into_iter()
            .enumerate()
            .map(|(index, action)| {
                let id = action.id.clone();
                let button = Button::new(("extension-action", index), action.button_label)
                    .variant(ButtonVariant::Default)
                    .size(ButtonSize::Small)
                    .leading_icon(if action.icon == "sparkles" { IconName::Sparkle } else { IconName::Palette })
                    .on_click(move |_, _, cx| crate::extension_hooks::run_extension_settings_action(&id, cx));
                row(action.label, action.description.map(SharedString::from), button, index == 0, cx)
            })
            .collect()
    }

    fn ollama_rows(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let status: SharedString = match &self.ollama {
            OllamaModels::Idle => "Find the models this server has pulled".into(),
            OllamaModels::Loading => "Asking Ollama…".into(),
            OllamaModels::Loaded(models) if models.is_empty() => "No models yet. Pull one with `ollama pull qwen3:8b`.".into(),
            OllamaModels::Loaded(models) => {
                let names: Vec<&str> = models.iter().take(4).map(|model| model.name.as_str()).collect();
                let more = models.len().saturating_sub(names.len());
                if more > 0 { format!("{} and {more} more", names.join(", ")).into() } else { names.join(", ").into() }
            }
            OllamaModels::Failed(error) => error.clone().into(),
        };
        let base = catalog::normalize_ollama_base_url(&settings(cx).ollama_base_url);
        let cloud = base.contains("://ollama.com") || base.contains(".ollama.com");
        let address_hint: Option<SharedString> = match &self.ollama {
            OllamaModels::Failed(_) if cloud => Some("Could not reach Ollama Cloud. Check your key and connection.".into()),
            OllamaModels::Failed(_) => Some("Could not connect. Is Ollama running at this address?".into()),
            _ if cloud || ai_providers::local::is_local_endpoint_url(&base) => None,
            _ => Some("Runs outside your local network".into()),
        };
        vec![
            row("Server address", address_hint, div().w(px(280.)).child(self.ollama_url.clone()), true, cx),
            row(
                "Models",
                Some(status),
                Button::new("ollama-refresh", "Find models").variant(ButtonVariant::Default).size(ButtonSize::Small).leading_icon(IconName::ArrowClockwise).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.discover_ollama(cx))),
                false,
                cx,
            ),
        ]
    }

    /// Suggestions (`tab-completion-section.tsx`): the switch and Tab completion's own model, on
    /// Automatic Athas's Tab model or the default model when it runs locally or without Athas.
    fn completion_rows(&self, current: &settings::Settings, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let allowed = crate::intelligence::completion_allowed(cx);
        let enabled = current.ai_completion && allowed;
        let model = crate::tab_completion::completion_model(current, cx);
        let choice = crate::intelligence::autocomplete_choice(current);
        let tooltip = match &choice {
            Some((provider, _)) if provider != catalog::ATHAS => format!("{} via {}", model.label, catalog::provider(provider).map_or(provider.as_str(), |known| known.name)),
            _ => model.label.clone(),
        };
        let mut picker = Button::new("ac-model", model.label.clone())
            .variant(ButtonVariant::Outline)
            .size(ButtonSize::Small)
            .tooltip(tooltip)
            .trailing_icon(IconName::ChevronDown)
            .disabled(!enabled || !crate::intelligence_sync::can_edit(cx));
        if let Some((provider, model_id)) = &choice {
            picker = picker.leading_icon(crate::model_vendor::model_icon(provider, if model_id.is_empty() { "auto" } else { model_id }));
        }
        let picker = picker.on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
            let choices = this.model_choices(cx);
            let entries = crate::intelligence::completion_entries(&settings(cx), &choices, |provider| this.is_connected(provider));
            this.show_menu("ac-model", entries, event, window, cx);
            if let Some(menu) = this.open_menu.take() {
                this.open_menu = Some(menu.searchable("Select a model…", "No matching models", cx));
            }
        }));
        let label = div()
            .flex()
            .items_center()
            .gap(px(6.))
            .child("Model")
            .when(enabled && !model.resolved, |this| this.child(ui::Badge::new("Off until chosen").tone(ui::Tone::Warning)));
        vec![
            row(
                "Tab completion",
                Some(if allowed { "Ghost text at the cursor, accepted with Tab".into() } else { "Turned off by your organization".into() }),
                Switch::new("ai-completion", enabled).disabled(!allowed).on_change(|enabled, _, cx| update_settings(cx, |settings| settings.ai_completion = enabled)),
                true,
                cx,
            ),
            row_with_label(label, Some(model.description.into()), picker, false, cx),
        ]
    }

    fn agent_rows(&self, current: &settings::Settings, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let modes: Vec<(String, String)> = std::iter::once((String::new(), "Agent (default)".to_string())).chain(Mode::ALL.iter().map(|mode| (mode.id().to_string(), mode.name().to_string()))).collect();
        let mode_label = Mode::from_id(&current.aidefault_session_mode).map_or("Agent (default)".to_string(), |mode| mode.name().to_string());
        let rules_dirty = self.rules_dirty;
        let mode_picker = self.picker("ai-mode", mode_label, modes, current.aidefault_session_mode.clone(), |settings, value| settings.aidefault_session_mode = value, None, cx);
        vec![
            row("Default mode", Some("How new Athas Agent sessions start".into()), mode_picker, true, cx),
            div()
                .relative()
                .flex()
                .flex_col()
                .gap(px(8.))
                .py(px(10.))
                .px(px(12.))
                .child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .flex_col()
                                .gap(px(2.))
                                .child(div().text_size(typography::TEXT_SM).child("User rules"))
                                .child(caption("Instructions for Athas's built-in agent across projects. External agents use their own configuration.", cx)),
                        )
                        .child(Button::new("rules-save", "Save").variant(if rules_dirty { ButtonVariant::Accent } else { ButtonVariant::Default }).size(ButtonSize::Small).disabled(!rules_dirty).on_click(
                            cx.listener(|this, _: &ClickEvent, _, cx| this.save_rules(cx)),
                        )),
                )
                .child(div().min_h(px(72.)).p(px(8.)).rounded(metrics::RADIUS_LG).border_1().border_color(colors.border).bg(colors.field).child(self.rules.clone()))
                .into_any_element(),
        ]
    }

    fn notification_rows(&self, current: &settings::Settings, cx: &mut Context<Self>) -> Vec<AnyElement> {
        vec![
            row(
                "Agent needs you",
                Some("When an agent asks for approval, an answer or a sign-in".into()),
                Switch::new("ai-notify", current.ai_agent_notifications).on_change(|value, _, cx| update_settings(cx, |settings| settings.ai_agent_notifications = value)),
                true,
                cx,
            ),
            row(
                "Agent finished",
                None,
                Switch::new("ai-notify-finish", current.ai_agent_finish_notifications).on_change(|value, _, cx| update_settings(cx, |settings| settings.ai_agent_finish_notifications = value)),
                false,
                cx,
            ),
            row(
                "Sound",
                None,
                Switch::new("ai-notify-sound", current.ai_agent_notification_sound).on_change(|value, _, cx| update_settings(cx, |settings| settings.ai_agent_notification_sound = value)),
                false,
                cx,
            ),
        ]
    }

    fn mcp_rows(&self, current: &settings::Settings, query: &str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let catalog = catalog_mcp_servers(cx);
        let servers: Vec<McpServerSetting> = current
            .mcp_servers
            .iter()
            .filter_map(|value| serde_json::from_value::<McpServerSetting>(value.clone()).ok())
            .filter(|server| {
                let entry = catalog.iter().find(|entry| is_catalog_server(entry, server));
                let (name, description) = entry.map_or(("", ""), |entry| (entry.name.as_str(), entry.description.as_str()));
                matches_query(query, &[&server.name, name, description, &server.command, &server.url])
            })
            .collect();
        let mut rows: Vec<AnyElement> = servers
            .into_iter()
            .enumerate()
            .map(|(index, server)| {
                let target = match server.transport {
                    McpTransportKind::Stdio => format!("{} {}", server.command, join_args(&server.args)),
                    transport => format!("{} · {}", if transport == McpTransportKind::Sse { "SSE" } else { "HTTP" }, server.url),
                };
                let (toggle_id, remove_id, edit_server) = (server.id.clone(), server.id.clone(), server.clone());
                let control = div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(Button::new(("mcp-edit", index), "Edit").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                        this.open_mcp_editor(Some(edit_server.clone()), window, cx)
                    })))
                    .child(Button::icon(("mcp-remove", index), IconName::Trash).size(ButtonSize::Small).tooltip("Remove").on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.remove_mcp(remove_id.clone(), cx))))
                    .child(Switch::new(("mcp-enabled", index), server.enabled).on_change(move |enabled, _, cx| Self::toggle_mcp(toggle_id.clone(), enabled, cx)));
                let element = row(server.name.clone(), Some(target.trim().to_string().into()), control, index == 0, cx);
                self.revealed_row(&server.id, element, cx)
            })
            .collect();
        let first = rows.is_empty();
        if first && !query.trim().is_empty() {
            return vec![row("No MCP servers match", None, div(), true, cx)];
        }
        rows.push(row(
            if first { "No MCP servers" } else { "Add a server" },
            first.then(|| "Give agents tools: GitHub, a database, a browser…".into()),
            Button::new("mcp-add", "Add server").variant(ButtonVariant::Default).size(ButtonSize::Small).leading_icon(IconName::Plus).on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.open_mcp_editor(None, window, cx))),
            first,
            cx,
        ));
        rows
    }

    /// Opens the server editor filled in from a catalog server: its command or URL, and the
    /// variables or headers the user still has to fill in.
    fn add_catalog_mcp(&mut self, server: extensions::manifest::McpServerContribution, window: &mut Window, cx: &mut Context<Self>) {
        self.open_mcp_editor(None, window, cx);
        let Some(editor) = &mut self.mcp_editor else { return };
        editor.name.update(cx, |input, cx| input.set_text(server.id.clone(), cx));
        let (transport, names) = match &server.config {
            extensions::manifest::McpServerConfig::Stdio { command, args, env } => {
                editor.command.update(cx, |input, cx| input.set_text(command.clone(), cx));
                editor.args.update(cx, |area, cx| area.set_text(args.join("\n"), cx));
                (McpTransportKind::Stdio, env.clone())
            }
            extensions::manifest::McpServerConfig::Http { url, headers } => {
                editor.url.update(cx, |input, cx| input.set_text(url.clone(), cx));
                (McpTransportKind::Http, headers.clone())
            }
            extensions::manifest::McpServerConfig::Sse { url, headers } => {
                editor.url.update(cx, |input, cx| input.set_text(url.clone(), cx));
                (McpTransportKind::Sse, headers.clone())
            }
        };
        editor.transport = transport;
        let values: Vec<McpNameValue> = names.iter().map(|name| McpNameValue { name: name.clone(), value: String::new() }).collect();
        let rows = Self::name_value_rows(&values, transport != McpTransportKind::Stdio, window, cx);
        let Some(editor) = &mut self.mcp_editor else { return };
        if transport == McpTransportKind::Stdio {
            editor.env = rows;
        } else {
            editor.headers = rows;
        }
        editor.setup_note = server.setup_note.clone();
        cx.notify();
    }

    /// Opens the server editor filled in from an "Add to Athas" link, for the user to review.
    fn add_linked_mcp(&mut self, install: crate::mcp_install_link::McpInstall, window: &mut Window, cx: &mut Context<Self>) {
        self.open_mcp_editor(None, window, cx);
        let Some(editor) = &mut self.mcp_editor else { return };
        editor.name.update(cx, |input, cx| input.set_text(install.name.clone(), cx));
        editor.command.update(cx, |input, cx| input.set_text(install.command.clone(), cx));
        editor.args.update(cx, |area, cx| area.set_text(install.args.join("\n"), cx));
        editor.url.update(cx, |input, cx| input.set_text(install.url.clone(), cx));
        editor.transport = install.transport;
        let values: Vec<McpNameValue> = install.secrets.iter().map(|(name, value)| McpNameValue { name: name.clone(), value: value.clone() }).collect();
        let header = install.transport != McpTransportKind::Stdio;
        let rows = Self::name_value_rows(&values, header, window, cx);
        let Some(editor) = &mut self.mcp_editor else { return };
        if header {
            editor.headers = rows;
        } else {
            editor.env = rows;
        }
        editor.setup_note = Some("Added from a link. Check the command and values before saving.".into());
        cx.notify();
    }

    /// The catalog's MCP servers not added yet, by group, each one click from the editor.
    fn mcp_catalog_rows(&self, current: &settings::Settings, query: &str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let added: Vec<McpServerSetting> = current.mcp_servers.iter().filter_map(|value| serde_json::from_value(value.clone()).ok()).collect();
        let mut servers: Vec<extensions::manifest::McpServerContribution> = catalog_mcp_servers(cx)
            .into_iter()
            .filter(|server| !added.iter().any(|setting| is_catalog_server(server, setting)))
            .filter(|server| matches_query(query, &[&server.name, &server.description, &server.id]))
            .collect();
        const GROUPS: [&str; 4] = ["popular", "developer", "work", "data"];
        servers.sort_by_key(|server| (GROUPS.iter().position(|group| *group == server.group).unwrap_or(GROUPS.len()), server.name.to_lowercase()));
        servers.dedup_by(|a, b| a.id == b.id);
        servers
            .into_iter()
            .enumerate()
            .map(|(index, server)| {
                let group = match server.group.as_str() {
                    "popular" => "Popular",
                    "developer" => "Developer",
                    "work" => "Work",
                    "data" => "Data",
                    _ => "Other",
                };
                let description = format!("{group} · {}", server.description);
                let add = server.clone();
                let control = Button::new(("mcp-catalog-add", index), "Add").variant(ButtonVariant::Default).size(ButtonSize::Small).leading_icon(IconName::Plus).on_click(cx.listener(
                    move |this, _: &ClickEvent, window, cx| this.add_catalog_mcp(add.clone(), window, cx),
                ));
                row(server.name.clone(), Some(description.into()), control, index == 0, cx)
            })
            .collect()
    }

    /// Commands and MCP tools the user chose to always allow (`allowlist`), each removable.
    fn allowed_rows(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let allowlist = crate::allowlist::load();
        let mut entries: Vec<(String, String, Box<dyn Fn() + 'static>)> = Vec::new();
        for (root, prefixes) in &allowlist.commands {
            let folder = std::path::Path::new(root).file_name().map_or(root.clone(), |name| name.to_string_lossy().into_owned());
            for prefix in prefixes {
                let (root, prefix_owned) = (root.clone(), prefix.clone());
                entries.push((prefix.clone(), format!("Command in {folder}"), Box::new(move || crate::allowlist::remove_command(&root, &prefix_owned))));
            }
        }
        for (server, tools) in &allowlist.mcp_tools {
            for tool in tools {
                let (server_owned, tool_owned) = (server.clone(), tool.clone());
                entries.push((tool.clone(), format!("MCP tool from {server}"), Box::new(move || crate::allowlist::remove_mcp(&server_owned, &tool_owned))));
            }
        }
        if entries.is_empty() {
            return vec![row("Nothing yet", Some("Choose Always allow when asked.".into()), div(), true, cx)];
        }
        entries
            .into_iter()
            .enumerate()
            .map(|(index, (label, description, remove))| {
                let remove = std::rc::Rc::new(remove);
                let control = Button::icon(("allowed-remove", index), IconName::Trash).size(ButtonSize::Small).tooltip("Remove").on_click(cx.listener(move |_, _: &ClickEvent, _, cx| {
                    remove();
                    cx.notify();
                }));
                row(label, Some(description.into()), control, index == 0, cx)
            })
            .collect()
    }

    /// The rows of the dialog's Environment variables or Headers (`NameValueList`).
    fn render_name_values(&self, editor: &McpEditor, cx: &mut Context<Self>) -> AnyElement {
        let header = editor.transport != McpTransportKind::Stdio;
        let (label, add_label) = if header { ("Headers", "Add header") } else { ("Environment variables", "Add variable") };
        let rows = if header { &editor.headers } else { &editor.env };
        let colors = cx.theme().colors.clone();
        let mono = |input: &Entity<TextInput>| div().flex_1().min_w_0().font_family(typography::MONO_FONT).child(input.clone());
        let list = div().flex().flex_col().gap(px(8.)).children(rows.iter().enumerate().map(|(index, entry)| {
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(mono(&entry.name))
                .child(div().flex_1().min_w_0().child(entry.value.clone()))
                .child(Button::icon(("mcp-value-remove", index), IconName::Trash).tone(ButtonTone::Danger).tooltip("Remove").on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                    if let Some(editor) = &mut this.mcp_editor {
                        let rows = if editor.transport == McpTransportKind::Stdio { &mut editor.env } else { &mut editor.headers };
                        if index < rows.len() {
                            rows.remove(index);
                        }
                        cx.notify();
                    }
                })))
        }));
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).text_color(colors.foreground).child(label))
            .when(!rows.is_empty(), |this| this.child(list))
            .child(div().flex().child(Button::new("mcp-value-add", add_label).variant(ButtonVariant::Ghost).leading_icon(IconName::Plus).on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                let placeholder = if header { "Authorization" } else { "API_KEY" };
                let row = Self::name_value_row("", "", placeholder, window, cx);
                row.name.update(cx, |input, cx| input.focus(window, cx));
                if let Some(editor) = &mut this.mcp_editor {
                    if editor.transport == McpTransportKind::Stdio { editor.env.push(row) } else { editor.headers.push(row) }
                    cx.notify();
                }
            }))))
            .child(div().text_size(typography::TEXT_SM).text_color(colors.muted_foreground).child("Values are stored securely, not in settings."))
            .children(editor.errors.values.clone().map(|error| div().text_size(typography::TEXT_SM).text_color(colors.destructive).child(error)))
            .into_any_element()
    }

    /// The MCP server dialog over Settings (`McpServerDialog`): name, transport, the command and
    /// arguments or the URL, then the variables or headers as name/value rows.
    fn render_mcp_editor(&self, editor: &McpEditor, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let stdio = editor.transport == McpTransportKind::Stdio;
        let errors = &editor.errors;
        let transport_value = match editor.transport {
            McpTransportKind::Stdio => "stdio",
            McpTransportKind::Http => "http",
            McpTransportKind::Sse => "sse",
        };
        let transport = ToggleGroup::new("mcp-transport", vec![ToggleOption::new("stdio", "Stdio"), ToggleOption::new("http", "HTTP"), ToggleOption::new("sse", "SSE")], transport_value).on_change({
            let view = cx.weak_entity();
            move |value, _, cx| {
                let transport = match value.as_ref() {
                    "http" => McpTransportKind::Http,
                    "sse" => McpTransportKind::Sse,
                    _ => McpTransportKind::Stdio,
                };
                view.update(cx, |this, cx| {
                    if let Some(editor) = &mut this.mcp_editor {
                        editor.transport = transport;
                        editor.errors = ai_mcp::DraftErrors::default();
                    }
                    cx.notify();
                })
                .ok();
            }
        });
        let mono = |child: AnyElement| div().font_family(typography::MONO_FONT).child(child);
        let dialog = Dialog::new("mcp-server-dialog", if editor.id.is_some() { "Edit MCP server" } else { "Add MCP server" })
            .icon(IconName::PlugsConnected)
            .size(DialogSize::Md)
            .layout(DialogLayout::Form)
            .track_focus(&editor.focus)
            .on_close({
                let view = cx.weak_entity();
                move |_, cx| {
                    view.update(cx, |this, cx| this.close_mcp_editor(cx)).ok();
                }
            })
            .footer([
                Button::new("mcp-cancel", "Cancel").variant(ButtonVariant::Ghost).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.close_mcp_editor(cx))).into_any_element(),
                Button::new("mcp-save", if editor.id.is_some() { "Save changes" } else { "Add server" })
                    .variant(ButtonVariant::Default)
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.save_mcp(cx)))
                    .into_any_element(),
            ])
            .when_some(editor.setup_note.clone(), |this, note| this.child(Alert::new().tone(ui::Tone::Info).icon(IconName::Info).description(note)))
            .child(Field::new().label("Name").control(editor.name.clone()).error(errors.name.clone()))
            .child(Field::new().label("Transport").control(div().flex().child(transport)).description("Every agent can run stdio servers. HTTP and SSE servers are only passed to agents that support them."))
            .when(stdio, |this| {
                this.child(Field::new().label("Command").control(mono(editor.command.clone().into_any_element())).error(errors.command.clone()))
                    .child(Field::new().label("Arguments").control(editor.args.clone()).description("One argument per line."))
            })
            .when(!stdio, |this| this.child(Field::new().label("URL").control(mono(editor.url.clone().into_any_element())).error(errors.url.clone())))
            .child(self.render_name_values(editor, cx));
        let viewport = window.viewport_size();
        gpui::deferred(
            gpui::anchored().position(gpui::point(px(0.), px(0.))).child(
                div()
                    .id("mcp-dialog-layer")
                    .occlude()
                    .w(viewport.width)
                    .h(viewport.height)
                    .bg(colors.scrim)
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(16.))
                    .on_mouse_down(gpui::MouseButton::Left, cx.listener(|this, _, _, cx| this.close_mcp_editor(cx)))
                    .child(dialog),
            ),
        )
        .with_priority(3)
        .into_any_element()
    }

    /// The installed Codex's version, off the main thread, unless a Connect already said more.
    fn read_codex_status(&mut self, cx: &mut Context<Self>) {
        if !self.codex_installed || self.codex_connection.status.initialized {
            self.codex_connection.status.installed = self.codex_installed || self.codex_connection.status.installed;
            return;
        }
        self.codex_connection.status.installed = true;
        cx.spawn(async move |this, cx| {
            let status = cx.background_spawn(async move { crate::codex::probe::status() }).await;
            this.update(cx, |this, cx| {
                if !this.codex_connection.status.initialized {
                    this.codex_connection.status = status;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    fn codex_cwd(cx: &App) -> std::path::PathBuf {
        workbench_api::projects(cx).active.map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from("."))
    }

    /// Connect / Refresh (`CodexSettings connect`): starts the app-server, reads the account,
    /// the models and how many threads, skills and MCP servers Codex has.
    fn connect_codex(&mut self, cx: &mut Context<Self>) {
        let cwd = Self::codex_cwd(cx);
        let executor = cx.background_executor().clone();
        self.codex_connection.catalog_error = None;
        self.codex_busy = Some(cx.spawn(async move |this, cx| {
            let connection = cx.background_spawn(crate::codex::probe::connect(cwd, executor)).await;
            crate::codex::probe::remember(&connection);
            this.update(cx, |this, cx| {
                this.codex_connection = connection;
                this.codex_busy = None;
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    fn sign_in_to_codex(&mut self, cx: &mut Context<Self>) {
        let cwd = Self::codex_cwd(cx);
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = cx.background_spawn(crate::codex::probe::sign_in(cwd, executor)).await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(Some(url)) => cx.open_url(&url),
                    Ok(None) => {}
                    Err(error) => this.codex_connection.catalog_error = Some(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn sign_out_of_codex(&mut self, cx: &mut Context<Self>) {
        let cwd = Self::codex_cwd(cx);
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let result = cx.background_spawn(crate::codex::probe::sign_out(cwd, executor)).await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(()) => this.codex_connection.status.account = None,
                    Err(error) => this.codex_connection.catalog_error = Some(error),
                }
                // Whether or not the logout went through, the old account's catalog goes.
                crate::codex::clear_catalog();
                this.codex_connection.models.clear();
                this.codex_connection.capabilities = Default::default();
                crate::codex::probe::remember(&this.codex_connection);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// A Codex select: a menu of `(value, label)` choices, searchable for the models.
    #[allow(clippy::too_many_arguments)]
    fn codex_choice(
        &self,
        id: &'static str,
        label: String,
        choices: Vec<(String, String)>,
        current: String,
        disabled: bool,
        searchable: bool,
        pick: fn(&mut AiSettingsView, String),
        cx: &mut Context<Self>,
    ) -> AnyElement {
        Button::new(id, label)
            .variant(ButtonVariant::Outline)
            .size(ButtonSize::Small)
            .trailing_icon(IconName::ChevronDown)
            .disabled(disabled)
            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                let view = cx.entity();
                let entries = choices
                    .iter()
                    .map(|(value, name)| {
                        let view = view.clone();
                        let value = value.clone();
                        MenuEntry::Item(MenuItem::new(name.clone()).checked(value == current).on_select(move |_, cx| {
                            let value = value.clone();
                            view.update(cx, |this, cx| {
                                pick(this, value);
                                this.codex.save();
                                cx.notify();
                            });
                        }))
                    })
                    .collect();
                this.show_menu(id, entries, event, window, cx);
                if searchable && let Some(menu) = this.open_menu.take() {
                    this.open_menu = Some(menu.searchable("Search models…", "No matching models", cx));
                }
            }))
            .into_any_element()
    }

    fn codex_options(options: &[(&str, &str)]) -> Vec<(String, String)> {
        options.iter().map(|(value, name)| (value.to_string(), name.to_string())).collect()
    }

    /// The model the Reasoning select follows: the chosen one, else Codex's default.
    fn codex_model(&self) -> Option<&crate::codex::CodexModel> {
        let models = &self.codex_connection.models;
        match &self.codex.model {
            Some(id) => models.iter().find(|model| &model.id == id),
            None => models.iter().find(|model| model.is_default),
        }
    }

    fn codex_rows(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let connection = &self.codex_connection;
        let status = &connection.status;
        let busy = self.codex_busy.is_some();
        let installed = status.installed || self.codex_installed;
        let description: SharedString = if installed { status.description().into() } else { format!("Not installed. {}", crate::codex::INSTALL_HINT).into() };
        let badge = ui::Badge::new(status.badge()).tone(if status.initialized { ui::Tone::Success } else { ui::Tone::Neutral });
        let connect = if busy {
            div().px(px(8.)).child(ui::Spinner::new("codex-connecting").label("Connecting").compact()).into_any_element()
        } else {
            Button::new("codex-connect", if status.initialized { "Refresh" } else { "Connect" })
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Small)
                .disabled(!installed)
                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.connect_codex(cx)))
                .into_any_element()
        };

        let models = &connection.models;
        let model_label = match &self.codex.model {
            Some(id) => models.iter().find(|model| &model.id == id).map_or_else(|| id.clone(), |model| model.name.clone()),
            None => "Codex default".to_string(),
        };
        let mut model_choices = vec![(String::new(), "Codex default".to_string())];
        model_choices.extend(models.iter().map(|model| (model.id.clone(), model.name.clone())));
        let model_picker = self.codex_choice("codex-model", model_label, model_choices, self.codex.model.clone().unwrap_or_default(), false, true, |this, value| {
            let model_id = (!value.is_empty()).then_some(value);
            let model = this.codex_connection.models.iter().find(|model| match &model_id {
                Some(id) => &model.id == id,
                None => model.is_default,
            });
            if let Some(model) = model {
                this.codex.effort = crate::codex::effort_for_model(model, this.codex.effort.as_deref());
            }
            this.codex.model = model_id;
        }, cx);

        let efforts: Vec<(String, String)> = self.codex_model().map(|model| model.efforts.iter().map(|effort| (effort.clone(), effort.clone())).collect()).unwrap_or_default();
        let effort = self.codex.effort.clone().unwrap_or_else(|| "medium".into());
        let effort_picker = self.codex_choice("codex-effort", effort.clone(), efforts.clone(), effort, efforts.is_empty(), false, |this, value| this.codex.effort = Some(value), cx);

        let sandbox = self.codex.sandbox.clone().unwrap_or_else(|| "workspace-write".into());
        let sandbox_label = crate::codex::SANDBOX_OPTIONS.iter().find(|(value, _)| *value == sandbox).map_or(sandbox.clone(), |(_, name)| name.to_string());
        let sandbox_picker = self.codex_choice("codex-sandbox", sandbox_label, Self::codex_options(crate::codex::SANDBOX_OPTIONS), sandbox, false, false, |this, value| this.codex.sandbox = Some(value), cx);

        let approval = self.codex.approval_policy.clone().unwrap_or_else(|| "on-request".into());
        let approval_label = crate::codex::APPROVAL_OPTIONS.iter().find(|(value, _)| *value == approval).map_or(approval.clone(), |(_, name)| name.to_string());
        let approval_picker = self.codex_choice("codex-approvals", approval_label, Self::codex_options(crate::codex::APPROVAL_OPTIONS), approval, false, false, |this, value| this.codex.approval_policy = Some(value), cx);

        let capabilities = connection.capabilities;
        let capability_badges = div()
            .flex()
            .items_center()
            .gap(px(6.))
            .child(ui::Badge::new(format!("{} threads", capabilities.threads)))
            .child(ui::Badge::new(format!("{} skills", capabilities.skills)))
            .child(ui::Badge::new(format!("{} MCP", capabilities.mcp)));

        let account = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(Button::new("codex-sign-in", "Sign in").variant(ButtonVariant::Outline).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.sign_in_to_codex(cx))))
            .child(Button::new("codex-sign-out", "Sign out").variant(ButtonVariant::Outline).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.sign_out_of_codex(cx))));

        vec![
            row("Codex CLI", Some(description), div().flex().items_center().gap(px(8.)).child(badge).child(connect), true, cx),
            row("Model", None, model_picker, false, cx),
            row("Reasoning", None, effort_picker, false, cx),
            row("Workspace Access", None, sandbox_picker, false, cx),
            row("Approvals", None, approval_picker, false, cx),
            row("Capabilities", connection.catalog_error.clone().map(SharedString::from), capability_badges, false, cx),
            row("Account", status.account_label().map(SharedString::from), account, false, cx),
        ]
    }

    fn agents_rows(&self, query: &str, installed_only: bool, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let registry = self.registry.read(cx);
        let tools = registry.tools().clone();
        let agents: Vec<_> = registry
            .agents()
            .iter()
            .filter(|agent| matches_query(query, &[&agent.name, agent.description.as_deref().unwrap_or_default(), &agent.id]))
            .filter(|agent| !installed_only || registry.state(&agent.id).is_installed())
            .map(|agent| (agent.clone(), registry.state(&agent.id), registry.operation(&agent.id), registry.error(&agent.id).map(str::to_string))).collect();
        let loading = registry.is_loading();
        if agents.is_empty() {
            let message = if loading {
                "Loading agents…"
            } else if !query.trim().is_empty() {
                "No agents match"
            } else if installed_only {
                "No agents installed"
            } else {
                "No agents in the catalog"
            };
            return vec![row(message, None, div(), true, cx)];
        }
        agents
            .into_iter()
            .enumerate()
            .map(|(index, (agent, state, operation, error))| {
                let colors = cx.theme().colors.clone();
                let id = agent.id.clone();
                let registry = self.registry.clone();
                let missing = agent.install.as_ref().and_then(|install| tools.missing_for(&install.runtime));
                let description: SharedString = if let Some(error) = &error {
                    error.clone().into()
                } else {
                    match &state {
                        InstallState::Managed { version, update: Some(update) } => format!("Installed {} · {update} available", version.as_deref().unwrap_or("")).into(),
                        InstallState::Managed { version, .. } => format!("Installed{}", version.as_deref().map(|version| format!(" · {version}")).unwrap_or_default()).into(),
                        InstallState::External(path) => format!("Found at {}", path.display()).into(),
                        InstallState::NotInstalled => agent
                            .unavailable
                            .clone()
                            .or_else(|| missing.map(|missing| format!("{missing} to install")))
                            .or_else(|| agent.description.clone())
                            .unwrap_or_else(|| "Not installed".into())
                            .into(),
                    }
                };
                let control: AnyElement = match (operation, &state) {
                    (Some(Operation::Installing), _) => caption("Installing…", cx).into_any_element(),
                    (Some(Operation::Uninstalling), _) => caption("Removing…", cx).into_any_element(),
                    (None, InstallState::Managed { update, .. }) => {
                        let (update_registry, update_id) = (registry.clone(), id.clone());
                        div()
                            .flex()
                            .gap(px(6.))
                            .when(update.is_some(), |this| {
                                this.child(Button::new(("agent-update", index), "Update").variant(ButtonVariant::Default).size(ButtonSize::Small).on_click(move |_, _, cx| {
                                    update_registry.update(cx, |registry, cx| registry.install(&update_id, cx));
                                }))
                            })
                            .child(Button::new(("agent-uninstall", index), "Uninstall").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(move |_, _, cx| {
                                registry.update(cx, |registry, cx| registry.uninstall(&id, cx));
                            }))
                            .into_any_element()
                    }
                    // Found on PATH or in the Tauri app's folder: Athas runs it but cannot update
                    // it, so it offers to take over with its own copy, which it can.
                    (None, InstallState::External(_)) => div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(caption("Installed outside this app", cx))
                        .when(agent.install.is_some() && agent.unavailable.is_none() && missing.is_none(), |this| {
                            this.child(Button::new(("agent-adopt", index), "Install here").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(move |_, _, cx| {
                                registry.update(cx, |registry, cx| registry.install(&id, cx));
                            }))
                        })
                        .into_any_element(),
                    (None, InstallState::NotInstalled) => Button::new(("agent-install", index), "Install")
                        .variant(ButtonVariant::Default)
                        .size(ButtonSize::Small)
                        .leading_icon(IconName::Download)
                        .disabled(agent.unavailable.is_some() || missing.is_some() || agent.install.is_none())
                        .on_click(move |_, _, cx| registry.update(cx, |registry, cx| registry.install(&id, cx)))
                        .into_any_element(),
                };
                let label = div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(agent.name.clone())
                    .when(state.is_installed(), |this| this.child(Icon::new(IconName::CheckCircle).size(IconSize::XSmall).color(colors.success)))
                    .when(agent.source == crate::agent_registry::Source::Registry, |this| this.child(caption("ACP Registry", cx)));
                let element = row_with_label(label, Some(description), control, index == 0, cx);
                self.revealed_row(&agent.id, element, cx)
            })
            .collect()
    }
}

impl AiSettingsView {
    /// Shows one Integrations kind (`mcp`, `agents`, `skills`, `extensions`), its installed
    /// view or its catalog; for previews.
    pub fn show_integration(&mut self, kind: &str, installed: bool, cx: &mut Context<Self>) {
        let Some(kind) = Integration::ALL.into_iter().find(|candidate| candidate.id() == kind) else { return };
        self.set_integration(kind, cx);
        if installed {
            self.integration_installed.insert(kind);
        } else {
            self.integration_installed.remove(&kind);
        }
        cx.notify();
    }

    /// Shows an installed MCP server (`mcp`) or agent (`agents`) another surface points at: its
    /// kind's installed view, scrolled to the row, which keeps a quiet fill
    /// (`useCustomizeStore.reveal`).
    pub fn reveal(&mut self, kind: &str, item_id: &str, cx: &mut Context<Self>) {
        let Some(kind) = Integration::ALL.into_iter().find(|candidate| candidate.id() == kind) else { return };
        self.set_integration(kind, cx);
        self.integration_installed.insert(kind);
        self.integration_query.update(cx, |input, cx| input.set_text("", cx));
        self.revealed = Some(item_id.to_string());
        self.reveal_scroll.set(true);
        cx.notify();
    }

    /// The settings page's scroll, so a reveal can bring its row into view.
    pub fn set_page_scroll(&mut self, scroll: gpui::ScrollHandle) {
        self.page_scroll = Some(scroll);
    }

    /// A row of the revealed item: the muted fill, and the page scrolled so it sits in the
    /// middle once (`scrollIntoView({ block: "center" })`).
    fn revealed_row(&self, id: &str, row: AnyElement, cx: &App) -> AnyElement {
        if self.revealed.as_deref() != Some(id) {
            return row;
        }
        let pending = self.reveal_scroll.clone();
        let scroll = self.page_scroll.clone();
        // The original's `Item variant="muted"` sits on the page; here the row is inside the
        // raised Integrations card, where the hover fill reads as the same quiet mark.
        div()
            .relative()
            .bg(cx.theme().colors.accent)
            .child(row)
            .child(
                gpui::canvas(
                    move |bounds, window, _| {
                        if !pending.get() {
                            return;
                        }
                        pending.set(false);
                        let Some(scroll) = scroll.as_ref() else { return };
                        let viewport = scroll.bounds();
                        let offset = scroll.offset();
                        let shift = bounds.center().y - viewport.center().y;
                        let y = (offset.y - shift).min(px(0.)).max(-scroll.max_offset().y);
                        scroll.set_offset(gpui::point(offset.x, y));
                        window.refresh();
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0(),
            )
            .into_any_element()
    }

    fn set_integration(&mut self, integration: Integration, cx: &mut Context<Self>) {
        if self.integration == integration {
            return;
        }
        self.revealed = None;
        self.integration = integration;
        self.integration_query.update(cx, |input, cx| {
            input.set_text("", cx);
            input.set_placeholder(integration.placeholder(), cx);
        });
        cx.notify();
    }

    fn refresh_integrations(&mut self, cx: &mut Context<Self>) {
        self.registry.update(cx, |registry, cx| registry.refresh(cx));
        if cx.try_global::<extensions::Extensions>().is_some() {
            extensions::refresh_catalog(cx).detach();
        }
        self.codex_installed = crate::codex::is_installed();
        self.read_codex_status(cx);
        cx.notify();
    }

    fn open_add_menu(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.weak_entity();
        let entries = vec![
            MenuItem::new("MCP server…")
                .icon(IconName::PlugsConnected)
                .on_select(move |window, cx| {
                    this.update(cx, |this, cx| {
                        this.set_integration(Integration::Mcp, cx);
                        this.integration_installed.insert(Integration::Mcp);
                        this.open_mcp_editor(None, window, cx);
                    })
                    .ok();
                })
                .into(),
            MenuItem::new("Skill…").icon(IconName::MagicWand).on_select(|_, cx| workbench_api::open_resource(cx, crate::skills::RESOURCE_KIND, "", "Skills")).into(),
            MenuEntry::Separator,
            MenuItem::new("Browse integrations").icon(IconName::Package).on_select(|_, cx| workbench_api::open_resource(cx, "extensions", "", "Extensions")).into(),
        ];
        self.show_menu("integrations-add", entries, event, window, cx);
    }

    /// Settings > Integrations: MCP servers, agents and skills for the agents, extensions for the
    /// editor, each with its catalog and what is installed, filtered by one search.
    fn render_integrations(&mut self, current: &settings::Settings, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let kind = self.integration;
        let installed = self.integration_installed.contains(&kind);
        let query = self.integration_query.read(cx).text().to_string();
        let rows = match kind {
            Integration::Mcp if installed => self.mcp_rows(current, &query, cx),
            Integration::Mcp => {
                let rows = self.mcp_catalog_rows(current, &query, cx);
                if rows.is_empty() { vec![row(if query.trim().is_empty() { "No MCP servers to add" } else { "No MCP servers match" }, None, div(), true, cx)] } else { rows }
            }
            Integration::Agents => self.agents_rows(&query, installed, cx),
            Integration::Skills if installed => self.personal_skill_rows(current, &query, cx),
            Integration::Skills => self.catalog_skill_rows(current, &query, cx),
            Integration::Extensions => self.extension_rows(current, &query, installed, cx),
        };
        let sections = Integration::ALL.iter().map(|kind| ui::ToggleOption::new(kind.id(), kind.label())).collect();
        let tabs = vec![ui::ToggleOption::new("catalog", "Catalog"), ui::ToggleOption::new("installed", kind.installed_label())];
        let toolbar = div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .child(ui::ToggleGroup::new("integration-kinds", sections, kind.id()).on_change({
                let this = cx.weak_entity();
                move |value, _, cx| {
                    if let Some(kind) = Integration::ALL.into_iter().find(|kind| kind.id() == value.as_ref()) {
                        this.update(cx, |this, cx| this.set_integration(kind, cx)).ok();
                    }
                }
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().w(px(224.)).child(ui::InputGroup::new(self.integration_query.clone()).start(Icon::new(IconName::Search).size(IconSize::Small).color(colors.subtle_foreground))))
                    .child(Button::icon("integrations-refresh", IconName::ArrowClockwise).size(ButtonSize::Small).tooltip("Refresh").on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.refresh_integrations(cx))))
                    .child(
                        Button::new("integrations-add", "Add")
                            .variant(ButtonVariant::Accent)
                            .size(ButtonSize::Small)
                            .trailing_icon(IconName::ChevronDown)
                            .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_add_menu(event, window, cx))),
                    ),
            );
        let view_row = div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .child(caption(kind.description(), cx))
            .child(ui::ToggleGroup::new("integration-view", tabs, if installed { "installed" } else { "catalog" }).on_change({
                let this = cx.weak_entity();
                move |value, _, cx| {
                    this.update(cx, |this, cx| {
                        if value.as_ref() == "installed" {
                            this.integration_installed.insert(kind);
                        } else {
                            this.integration_installed.remove(&kind);
                        }
                        cx.notify();
                    })
                    .ok();
                }
            }));
        div().flex().flex_col().gap(px(12.)).child(toolbar).child(view_row).child(section("Integrations", rows, cx)).into_any_element()
    }

    fn personal_skill_rows(&mut self, current: &settings::Settings, query: &str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let catalog = self.catalog_skills(cx);
        let skills: Vec<_> = crate::skills::setting_skills(&current.ai_skills).into_iter().filter(|skill| matches_query(query, &[&skill.title, skill.description.as_deref().unwrap_or_default()])).collect();
        let codex = self.codex_skill_rows(query, cx);
        if skills.is_empty() && codex.is_empty() {
            let message = if current.ai_skills.is_empty() { "No skills yet" } else { "No skills match" };
            return vec![row(
                message,
                current.ai_skills.is_empty().then(|| "Skills are instructions you can hand to any agent from the composer. Plus SKILL.md files in .athas/skills and ~/.claude/skills.".into()),
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(Button::new("skills-browse", "Browse the catalog").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                        this.integration_installed.remove(&Integration::Skills);
                        cx.notify();
                    })))
                    .child(Button::new("skills-manage", "Write a skill").variant(ButtonVariant::Default).size(ButtonSize::Small).leading_icon(IconName::Plus).on_click(|_, _, cx| {
                        workbench_api::open_resource(cx, crate::skills::RESOURCE_KIND, "", "Skills")
                    })),
                true,
                cx,
            )];
        }
        let mut rows: Vec<AnyElement> = skills
            .into_iter()
            .enumerate()
            .map(|(index, skill)| {
                // `skillPreview`: the description, else the instructions on one line.
                let preview = skill.description.clone().filter(|text| !text.trim().is_empty()).unwrap_or_else(|| {
                    let content = skill.content.split_whitespace().collect::<Vec<_>>().join(" ");
                    if content.is_empty() { "No instructions yet".to_string() } else { content }
                });
                let source = skill.other.get("sourceId").and_then(serde_json::Value::as_str).unwrap_or(&skill.id).to_string();
                let marketplace = catalog.iter().find(|candidate| candidate.id == source).cloned();
                let edited = crate::skills::marketplace::has_local_override(&skill);
                let control = div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .when(edited, |this| this.child(ui::Badge::new("Edited")))
                    .child(self.skill_actions(("skill-actions", index), skill.clone(), marketplace, cx));
                row(skill.title.clone(), Some(preview.into()), control, index == 0, cx)
            })
            .collect();
        if !codex.is_empty() {
            rows.extend(codex);
        }
        rows
    }

    /// Codex's skills under the personal ones (`useCodexSkills`), listed once Codex is installed.
    fn codex_skill_rows(&mut self, query: &str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        if !self.codex_installed {
            return Vec::new();
        }
        if self.codex_skills.is_none() && self.codex_skills_task.is_none() {
            #[cfg(not(target_family = "wasm"))]
            {
                let cwd = Self::codex_cwd(cx);
                let executor = cx.background_executor().clone();
                self.codex_skills_task = Some(cx.spawn(async move |this, cx| {
                    let skills = cx.background_spawn(crate::codex::probe::list_skills(cwd, executor)).await;
                    this.update(cx, |this, cx| {
                        this.codex_skills = Some(skills);
                        this.codex_skills_task = None;
                        cx.notify();
                    })
                    .ok();
                }));
            }
        }
        let skills: Vec<_> = self.codex_skills.iter().flatten().filter(|skill| matches_query(query, &[&skill.name, &skill.description])).cloned().collect();
        skills
            .into_iter()
            .map(|skill| {
                let description = if skill.description.is_empty() { skill.path.clone() } else { skill.description.clone() };
                let control = div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .when(!skill.enabled, |this| this.child(ui::Badge::new("Off")))
                    .child(ui::Badge::new("Codex").tone(ui::Tone::Neutral));
                row(skill.name.clone(), Some(description.into()), control, false, cx)
            })
            .collect()
    }

    /// The catalog's skills, from the extension catalog.
    fn catalog_skills(&self, cx: &App) -> Vec<crate::skills::marketplace::MarketplaceSkill> {
        cx.try_global::<extensions::Extensions>()
            .map(|extensions| crate::skills::marketplace::from_catalog(&extensions.entries(), extensions.cdn_base_url().unwrap_or(extensions::CDN_BASE_URL)))
            .unwrap_or_default()
    }

    /// A saved skill's actions menu (`skillMenuItems`): Edit…, Update when the catalog has a newer
    /// version, Reset to catalog version after a local edit, and Remove (catalog) or Delete.
    fn skill_actions(
        &self,
        id: impl Into<gpui::ElementId>,
        skill: crate::skills::SettingSkill,
        marketplace: Option<crate::skills::marketplace::MarketplaceSkill>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let menu_key = format!("skill-actions-{}", skill.id);
        Button::icon(id, IconName::Dots)
            .size(ButtonSize::Small)
            .tooltip(format!("{} actions", skill.title))
            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                let view = cx.weak_entity();
                let skill_id = skill.id.clone();
                let mut entries: Vec<MenuEntry> =
                    vec![MenuItem::new("Edit…").icon(IconName::Pencil).on_select(move |_, cx| workbench_api::open_skill(cx, None, &skill_id)).into()];
                if let Some(marketplace) = marketplace.clone().filter(|marketplace| crate::skills::marketplace::has_update(&skill, marketplace)) {
                    let view = view.clone();
                    entries.push(MenuItem::new("Update").icon(IconName::ArrowUp).on_select(move |_, cx| {
                        view.update(cx, |this, cx| this.install_skill(marketplace.clone(), cx)).ok();
                    }).into());
                }
                if crate::skills::marketplace::has_local_override(&skill) {
                    let reset = crate::skills::marketplace::reset_local_override(&skill);
                    entries.push(MenuItem::new("Reset to catalog version").icon(IconName::ArrowCounterClockwise).on_select(move |_, cx| {
                        let values = settings(cx).ai_skills;
                        let updated = crate::skills::upsert_setting(&values, reset.clone());
                        update_settings(cx, |settings| settings.ai_skills = updated);
                    }).into());
                }
                entries.push(MenuEntry::Separator);
                let marketplace_skill = crate::skills::marketplace::from_marketplace(&skill);
                let doomed = skill.clone();
                entries.push(MenuItem::new(if marketplace_skill { "Remove" } else { "Delete" }).icon(IconName::Trash).destructive().on_select(move |window, cx| {
                    let doomed = doomed.clone();
                    view.update(cx, |this, cx| this.confirm_remove_skill(doomed, window, cx)).ok();
                }).into());
                this.show_menu(&menu_key, entries, event, window, cx);
            }))
            .into_any_element()
    }

    /// Asks before removing a saved skill (`showConfirmDialog`).
    fn confirm_remove_skill(&mut self, skill: crate::skills::SettingSkill, window: &mut Window, cx: &mut Context<Self>) {
        let marketplace = crate::skills::marketplace::from_marketplace(&skill);
        let id = skill.id.clone();
        let dialog = ui::AlertDialog::confirm(
            if marketplace { "Remove skill" } else { "Delete skill" },
            format!("Delete {}?", skill.title),
            ui::ConfirmOptions { confirm_label: if marketplace { "Remove" } else { "Delete" }.into(), cancel_label: "Cancel".into(), destructive: true },
            move |_, cx| {
                let values = settings(cx).ai_skills;
                let updated = crate::skills::remove_setting(&values, &id);
                update_settings(cx, |settings| settings.ai_skills = updated);
            },
            cx,
        );
        let subscription = cx.subscribe_in(&dialog, window, |this, _, _: &gpui::DismissEvent, _, cx| {
            this.confirm = None;
            cx.notify();
        });
        window.focus(&dialog.focus_handle(cx), cx);
        self.confirm = Some((dialog, subscription));
        cx.notify();
    }

    fn catalog_skill_rows(&self, current: &settings::Settings, query: &str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let skills = self.catalog_skills(cx);
        let saved = crate::skills::setting_skills(&current.ai_skills);
        let skills: Vec<_> = skills.into_iter().filter(|skill| matches_query(query, &[&skill.title, &skill.description])).collect();
        if skills.is_empty() {
            // `skills-section.tsx`: an empty state with Write a skill, not a bare row.
            let empty = ui::EmptyState::new(if query.trim().is_empty() { "No published skills yet" } else { "No skills match" })
                .icon(IconName::MagicWand)
                .action(
                    Button::new("catalog-write-skill", "Write a skill")
                        .leading_icon(IconName::Plus)
                        .on_click(|_, _, cx| workbench_api::open_resource(cx, crate::skills::RESOURCE_KIND, "", "Skills")),
                );
            return vec![div().min_h(px(256.)).flex().items_center().justify_center().child(empty).into_any_element()];
        }
        skills
            .into_iter()
            .enumerate()
            .map(|(index, skill)| {
                let installed = crate::skills::marketplace::installed(&saved, &skill.id);
                let update = installed.is_some_and(|installed| crate::skills::marketplace::has_update(installed, &skill));
                let busy = self.installing_skills.contains(&skill.id);
                let description: Option<SharedString> = (!skill.description.is_empty()).then(|| skill.description.clone().into());
                // An installed skill gets its actions menu, with an Update badge when the catalog
                // has a newer version (`SkillsSection` catalog rows).
                let control: AnyElement = if let Some(installed) = installed {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .when(update, |this| this.child(ui::Badge::new("Update").tone(ui::Tone::Accent)))
                        .when(busy, |this| this.child(caption("Updating…", cx)))
                        .child(self.skill_actions(("catalog-skill-actions", index), installed.clone(), Some(skill.clone()), cx))
                        .into_any_element()
                } else {
                    let label = if busy { "Installing…" } else { "Install" };
                    let install = skill.clone();
                    Button::new(("skill-install", index), label)
                        .variant(ButtonVariant::Default)
                        .size(ButtonSize::Small)
                        .disabled(busy)
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.install_skill(install.clone(), cx)))
                        .into_any_element()
                };
                row(skill.title.clone(), description, control, index == 0, cx)
            })
            .collect()
    }

    /// Settings > AI > Chat history (`ChatHistorySection`): Clear All asks for "yes" in a field
    /// beside it, then every session, transcript and checkpoint goes.
    fn clear_history_row(&self, cx: &mut Context<Self>) -> AnyElement {
        const WORD: &str = "yes";
        let control: AnyElement = match &self.clear_history {
            Some((input, _)) => {
                let typed = input.read(cx).text().trim().eq_ignore_ascii_case(WORD);
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().w(px(112.)).child(input.clone()))
                    .child(
                        Button::new("clear-history-confirm", "Clear All")
                            .variant(ButtonVariant::Outline)
                            .tone(ui::ButtonTone::Danger)
                            .size(ButtonSize::Small)
                            .disabled(!typed)
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.clear_history(cx))),
                    )
                    .child(
                        Button::new("clear-history-cancel", "Cancel")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                                this.clear_history = None;
                                cx.notify();
                            })),
                    )
                    .into_any_element()
            }
            None => Button::new("clear-history", "Clear All")
                .variant(ButtonVariant::Outline)
                .tone(ui::ButtonTone::Danger)
                .size(ButtonSize::Small)
                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| {
                    let input = cx.new(|cx| TextInput::new(window, cx).placeholder(format!("Type '{WORD}'")));
                    let subscription = cx.subscribe(&input, |this, input, event: &TextInputEvent, cx| match event {
                        TextInputEvent::Confirmed if input.read(cx).text().trim().eq_ignore_ascii_case(WORD) => this.clear_history(cx),
                        TextInputEvent::Cancelled => {
                            this.clear_history = None;
                            cx.notify();
                        }
                        TextInputEvent::Changed(_) => cx.notify(),
                        _ => {}
                    });
                    window.focus(&input.focus_handle(cx), cx);
                    this.clear_history = Some((input, subscription));
                    cx.notify();
                }))
                .into_any_element(),
        };
        row("Clear chat history", None, control, true, cx)
    }

    fn clear_history(&mut self, cx: &mut Context<Self>) {
        self.clear_history = None;
        crate::persistence::clear_chat_history(cx);
        notifications::notify(cx, notifications::NotificationKind::Success, notifications::NotificationCategory::Athas, "Chat history cleared", None, None);
        cx.notify();
    }

    fn install_skill(&mut self, skill: crate::skills::marketplace::MarketplaceSkill, cx: &mut Context<Self>) {
        if !self.installing_skills.insert(skill.id.clone()) {
            return;
        }
        let id = skill.id.clone();
        // `useSkillActions`: "Couldn't add …" for an install, "Couldn't update …" for an update.
        let installed = crate::skills::marketplace::installed(&crate::skills::setting_skills(&settings(cx).ai_skills), &skill.id).is_some();
        let title = format!("Couldn't {} {}", if installed { "update" } else { "add" }, skill.title);
        let task = crate::skills::marketplace::install(skill, cx);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.installing_skills.remove(&id);
                if let Err(error) = result {
                    notifications::error(cx, title, Some(error.into()));
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn extension_rows(&self, current: &settings::Settings, query: &str, installed_only: bool, cx: &mut Context<Self>) -> Vec<AnyElement> {
        use extensions::ExtensionKind;
        let Some(extensions) = cx.try_global::<extensions::Extensions>() else { return vec![row("Extensions are not available", None, div(), true, cx)] };
        let mut entries: Vec<(extensions::CatalogEntry, extensions::ExtensionStatus)> = extensions
            .entries()
            .into_iter()
            .filter(|entry| matches!(entry.kind, ExtensionKind::Language | ExtensionKind::Theme | ExtensionKind::IconTheme | ExtensionKind::Database))
            .filter(|entry| matches_query(query, &[&entry.manifest.display_name, &entry.manifest.description]))
            .map(|entry| {
                let status = extensions.status(&entry.manifest.id, current);
                (entry, status)
            })
            .filter(|(_, status)| !installed_only || status.installed)
            .collect();
        entries.sort_by_key(|(entry, _)| (ExtensionKind::ALL.iter().position(|kind| *kind == entry.kind), entry.manifest.display_name.to_lowercase()));
        if entries.is_empty() {
            return vec![row("No extensions match", None, div(), true, cx)];
        }
        entries
            .into_iter()
            .enumerate()
            .map(|(index, (entry, status))| {
                let id = entry.manifest.id.clone();
                let description = format!("{} · {}", entry.kind.label(), entry.manifest.description);
                let control: AnyElement = if status.operation.is_some() {
                    caption("Working…", cx).into_any_element()
                } else if status.installed {
                    div()
                        .flex()
                        .gap(px(6.))
                        .when(status.update_available, |this| {
                            let id = id.clone();
                            this.child(Button::new(("extension-update", index), "Update").variant(ButtonVariant::Default).size(ButtonSize::Small).on_click(move |_, _, cx| {
                                extensions::install(&id, cx).detach();
                            }))
                        })
                        .child(Button::new(("extension-uninstall", index), "Uninstall").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(move |_, _, cx| {
                            extensions::uninstall(&id, cx).detach();
                        }))
                        .into_any_element()
                } else {
                    Button::new(("extension-install", index), "Install")
                        .variant(ButtonVariant::Default)
                        .size(ButtonSize::Small)
                        .leading_icon(IconName::Download)
                        .disabled(status.blocked)
                        .on_click(move |_, _, cx| extensions::install(&id, cx).detach())
                        .into_any_element()
                };
                row(entry.manifest.display_name.clone(), Some(description.into()), control, index == 0, cx)
            })
            .collect()
    }
}

fn row_with_label(label: impl IntoElement, description: Option<SharedString>, control: impl IntoElement, first: bool, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .relative()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(24.))
        .min_h(px(44.))
        .py(px(10.))
        .px(px(12.))
        .when(!first, |this| this.child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider)))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(2.))
                .child(div().text_size(typography::TEXT_SM).text_color(colors.foreground).child(label))
                .children(description.map(|description| div().truncate().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(description))),
        )
        .child(div().flex().flex_none().items_center().gap(px(6.)).child(control))
        .into_any_element()
}

impl Render for AiSettingsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(install) = cx.try_global::<crate::mcp_install_link::PendingMcpInstall>().is_some().then(|| cx.global_mut::<crate::mcp_install_link::PendingMcpInstall>().0.take()).flatten() {
            self.add_linked_mcp(install, window, cx);
        }
        let current = settings(cx);
        let colors = cx.theme().colors.clone();
        let athas = self.athas_rows(cx);
        let model = self.model_rows(&current, cx);
        let keys = self.key_rows(cx);
        let extension_actions = self.extension_action_rows(cx);
        let ollama = self.ollama_rows(cx);
        let completion = self.completion_rows(&current, cx);
        let features = self.feature_rows(&current, cx);
        let agent = self.agent_rows(&current, cx);
        let notifications = self.notification_rows(&current, cx);
        let allowed = self.allowed_rows(cx);
        let codex = self.codex_rows(cx);
        let history = vec![self.clear_history_row(cx)];
        let integrations = self.render_integrations(&current, cx);
        let mcp_dialog = self.mcp_editor.as_ref().map(|editor| self.render_mcp_editor(editor, window, cx));
        div()
            .id("ai-settings")
            .track_focus(&self.focus)
            .w_full()
            .flex()
            .flex_col()
            .gap(px(24.))
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground)
            .when_some(self.notice.clone(), |this, notice| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .px(px(12.))
                        .py(px(8.))
                        .rounded(metrics::RADIUS_LG)
                        .bg(colors.destructive_soft)
                        .text_size(typography::TEXT_SM)
                        .child(Icon::new(IconName::WarningCircle).size(IconSize::XSmall).color(colors.destructive))
                        .child(notice),
                )
            })
            .child(section("Athas", athas, cx))
            .child(section("Default model", model, cx))
            .child(section("Other features", features, cx))
            .child(section("API keys", keys, cx))
            .when(!extension_actions.is_empty(), |this| this.child(section("From extensions", extension_actions, cx)))
            .child(section("Ollama", ollama, cx))
            .child(section("Suggestions", completion, cx))
            .child(section("Athas Agent", agent, cx))
            .child(section("Notifications", notifications, cx))
            .child(integrations)
            .child(section("Allowed Commands", allowed, cx))
            .child(section("Codex", codex, cx))
            .child(section("Chat history", history, cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
            .children(mcp_dialog)
            .children(self.confirm.as_ref().map(|(dialog, _)| {
                gpui::deferred(div().id("ai-settings-confirm").absolute().inset_0().bg(colors.scrim).flex().items_center().justify_center().occlude().child(dialog.clone())).with_priority(1)
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_arguments_and_rows_parse() {
        assert_eq!(parse_args("-y\n  @mcp/server  \n\na b\r\n"), ["-y", "@mcp/server", "a b"]);
        let value = |name: &str, value: &str| McpNameValue { name: name.into(), value: value.into() };
        let rows = without_blank_rows(&[value(" TOKEN ", "x"), value("", ""), value("  ", ""), value("", "orphan")]);
        assert_eq!(rows.iter().map(|row| (row.name.as_str(), row.value.as_str())).collect::<Vec<_>>(), [("TOKEN", "x"), ("", "orphan")]);
        assert_eq!(join_args(&["-y".into(), "a b".into()]), r#"-y "a b""#);
    }

    #[test]
    fn catalog_servers_match_by_name_url_or_package() {
        use extensions::manifest::{McpServerConfig, McpServerContribution};
        let stdio = McpServerContribution {
            id: "github".into(),
            name: "GitHub".into(),
            description: String::new(),
            group: "popular".into(),
            setup_note: None,
            config: McpServerConfig::Stdio { command: "npx".into(), args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()], env: Vec::new() },
        };
        let remote = McpServerContribution { id: "linear".into(), name: "Linear".into(), config: McpServerConfig::Http { url: "https://mcp.linear.app/mcp".into(), headers: Vec::new() }, ..stdio.clone() };
        let server = |name: &str, transport, command: &str, args: &[&str], url: &str| McpServerSetting {
            id: "x".into(),
            name: name.into(),
            enabled: true,
            transport,
            command: command.into(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            url: url.into(),
        };
        assert!(is_catalog_server(&stdio, &server("GitHub", McpTransportKind::Stdio, "", &[], "")));
        assert!(is_catalog_server(&stdio, &server("Work repos", McpTransportKind::Stdio, "npx", &["-y", "@modelcontextprotocol/server-github@1.2.0"], "")));
        assert!(!is_catalog_server(&stdio, &server("Work repos", McpTransportKind::Stdio, "npx", &["-y", "@modelcontextprotocol/server-gitlab"], "")));
        assert!(is_catalog_server(&remote, &server("Tickets", McpTransportKind::Sse, "", &[], "HTTPS://mcp.linear.app/mcp/")));
        assert!(!is_catalog_server(&remote, &server("Tickets", McpTransportKind::Stdio, "", &[], "https://mcp.linear.app/mcp")));
        assert_eq!(package_of(&["-y".into(), "@scope/pkg@1.0".into()]), Some("@scope/pkg"));
        assert_eq!(package_of(&["mcp-server-fetch".into()]), Some("mcp-server-fetch"));
    }
}
