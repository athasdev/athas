//! Which model each AI feature runs on (`intelligence/types/intelligence.types.ts`,
//! `services/ai-model-preferences.ts`): the default model, or a feature's own choice. The choices
//! live in settings under `aiTaskModels`, as `{ task: { providerId, modelId } }`.

use ai_providers::ProviderSettings;
use serde_json::{Value, json};

const SETTINGS_KEY: &str = "aiTaskModels";

/// Features that can use a model other than the default, in the order Settings lists them. Tab
/// completion has its own page.
pub const TASK_OVERRIDES: &[(&str, &str)] = &[
    ("agent", "New chats"),
    ("inline-edit", "Inline edits"),
    ("commit-message", "Commit messages"),
    ("chat-title", "Chat titles"),
    ("terminal-title", "Terminal titles"),
    ("github-draft", "GitHub drafts"),
    ("review-summary", "Review summaries"),
    ("review-insight", "Review assistance"),
    ("session-overview", "Session overviews"),
];

pub const SAME_AS_DEFAULT: &str = "Same as default";

/// Whether the default connection is still Athas's `auto` placeholder (`false` once the user
/// picks a default model; absent means `auto`, as `defaultIntelligencePreferences` starts).
const DEFAULT_AUTO_KEY: &str = "aiDefaultConnectionAuto";

/// Whether the signed-in account has Athas intelligence, kept from the account store so callers
/// without an `App` (`task_provider`) resolve `auto` as the original does.
static HAS_INTELLIGENCE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn note_intelligence_access(has_intelligence: bool) {
    HAS_INTELLIGENCE.store(has_intelligence, std::sync::atomic::Ordering::Relaxed);
}

pub fn has_intelligence_access() -> bool {
    HAS_INTELLIGENCE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Whether the default model is still `auto`: the device's own provider when it is local, Athas
/// with Pro, and the device's own provider otherwise.
pub fn default_is_auto(settings: &settings::Settings) -> bool {
    settings.extra.get(DEFAULT_AUTO_KEY).and_then(Value::as_bool).unwrap_or(true)
}

/// Marks the default as `auto` again, or as the user's own pick (`withDefaultConnection`).
pub fn set_default_auto(settings: &mut settings::Settings, auto: bool) {
    if auto {
        settings.extra.remove(DEFAULT_AUTO_KEY);
    } else {
        settings.extra.insert(DEFAULT_AUTO_KEY.to_string(), Value::Bool(false));
    }
}

/// The model the default actually runs on (`getEffectiveDefaultConnection`): the user's pick, or
/// for `auto` the personal connection when it is local, Athas's automatic model with Athas
/// access, else the personal connection.
pub fn default_provider_in(settings: &settings::Settings, has_intelligence: bool) -> ProviderSettings {
    let personal = crate::builtin::provider_settings(settings);
    if !default_is_auto(settings) || ai_providers::local::is_local_provider(&personal) || !has_intelligence {
        return personal;
    }
    ProviderSettings { provider_id: ai_providers::catalog::ATHAS.into(), model_id: "auto".into(), ..personal }
}

/// `default_provider_in` with the account's current access.
pub fn default_provider(settings: &settings::Settings) -> ProviderSettings {
    default_provider_in(settings, has_intelligence_access())
}

fn valid_provider(id: &str) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
        && id.len() <= 100
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c))
}

/// A feature's own (provider, model), when it has one.
pub fn task_connection(settings: &settings::Settings, task: &str) -> Option<(String, String)> {
    let entry = settings.extra.get(SETTINGS_KEY)?.get(task)?;
    let provider = entry.get("providerId")?.as_str()?;
    let model = entry.get("modelId")?.as_str()?.trim();
    (valid_provider(provider) && provider != "auto" && model.len() <= 200).then(|| (provider.to_string(), model.to_string()))
}

/// Sets a feature's model, or clears it back to the default with `None`.
pub fn set_task_connection(settings: &mut settings::Settings, task: &str, connection: Option<(String, String)>) {
    let mut tasks = match settings.extra.remove(SETTINGS_KEY) {
        Some(Value::Object(tasks)) => tasks,
        _ => serde_json::Map::new(),
    };
    match connection {
        Some((provider, model)) => {
            tasks.insert(task.to_string(), json!({ "providerId": provider, "modelId": model }));
        }
        None => {
            tasks.remove(task);
        }
    }
    if !tasks.is_empty() {
        settings.extra.insert(SETTINGS_KEY.to_string(), Value::Object(tasks));
    }
}

/// Every model of the catalog's providers and the extensions', as (`provider::model`, label).
pub fn connection_choices(cx: &gpui::App) -> Vec<(String, String)> {
    let mut choices = Vec::new();
    for provider in ai_providers::catalog::PROVIDERS.iter().filter(|provider| provider.id != ai_providers::catalog::CUSTOM) {
        for model in provider.models {
            choices.push((format!("{}::{}", provider.id, model.id), format!("{} · {}", provider.name, model.name)));
        }
    }
    for provider in crate::extension_hooks::extension_providers(cx).into_iter().filter(|provider| ai_providers::catalog::provider(&provider.id).is_none()) {
        for (model_id, model_name) in &provider.models {
            choices.push((format!("{}::{model_id}", provider.id), format!("{} · {model_name}", provider.name)));
        }
    }
    choices
}

/// What a feature's picker shows: its own model's label, or "Same as default".
pub fn connection_label(settings: &settings::Settings, task: &str, choices: &[(String, String)]) -> String {
    match task_connection(settings, task) {
        Some((provider, model)) => {
            let value = format!("{provider}::{model}");
            choices.iter().find(|(id, _)| *id == value).map_or_else(|| value.replace("::", " · "), |(_, name)| name.clone())
        }
        None => SAME_AS_DEFAULT.to_string(),
    }
}

/// A feature's model menu (`model-connection-picker.tsx`): "Same as default" (hidden while
/// searching), then a section per connection, each named by its provider. Only providers
/// `connected` keeps are offered, plus the one the feature uses now so its choice never
/// disappears from its own menu.
pub fn connection_entries(settings: &settings::Settings, task: &'static str, choices: &[(String, String)], connected: impl Fn(&str) -> bool) -> Vec<ui::MenuEntry> {
    model_menu(task_connection(settings, task), task, SAME_AS_DEFAULT, false, choices, connected)
}

/// Tab completion's model menu (`purpose="completion"`): Automatic, then Athas's one Tab model
/// instead of the Athas chat catalog (hosted completions always run on it), then the connected
/// providers' models.
pub fn completion_entries(settings: &settings::Settings, choices: &[(String, String)], connected: impl Fn(&str) -> bool) -> Vec<ui::MenuEntry> {
    model_menu(autocomplete_choice(settings), AUTOCOMPLETE, AUTOMATIC, true, choices, connected)
}

fn model_menu(current: Option<(String, String)>, task: &'static str, inherit_label: &'static str, completion: bool, choices: &[(String, String)], connected: impl Fn(&str) -> bool) -> Vec<ui::MenuEntry> {
    use ui::{MenuEntry, MenuItem};
    let current_provider = current.as_ref().map(|(provider, _)| provider.clone());
    let current = current.map(|(provider, model)| if provider == ai_providers::catalog::ATHAS && model.is_empty() { format!("{provider}::auto") } else { format!("{provider}::{model}") });
    let pick = move |value: Option<(String, String)>| {
        move |_: &mut gpui::Window, cx: &mut gpui::App| {
            let value = value.clone();
            if !crate::intelligence_sync::can_edit(cx) {
                notifications::info(cx, "Only the team's admins can change its models.");
                return;
            }
            if cx.try_global::<settings::SettingsStore>().is_some() {
                settings::update(cx, move |settings| set_task_connection(settings, task, value));
                crate::intelligence_sync::changed(cx);
            }
        }
    };
    let pick_model = |provider: String, model: String| pick(Some((provider, model)));
    let mut entries = vec![MenuEntry::Item(MenuItem::new(inherit_label).checked(current.is_none()).hidden_while_searching().on_select(pick(None))), MenuEntry::Separator];
    if completion {
        let value = format!("{}::auto", ai_providers::catalog::ATHAS);
        entries.push(MenuEntry::Label("Athas".into()));
        entries.push(
            MenuItem::new(ATHAS_TAB_MODEL_LABEL)
                .icon(crate::model_vendor::model_icon(ai_providers::catalog::ATHAS, "auto"))
                .keywords("athas automatic tab")
                .checked(current.as_deref() == Some(value.as_str()))
                .on_select(pick(Some((ai_providers::catalog::ATHAS.to_string(), "auto".to_string()))))
                .into(),
        );
    }
    if !completion {
        // `AthasModelSections`: a short Recommended pick of the Athas catalog above it, hidden
        // while searching since every model is then listed.
        let athas: Vec<(&str, &str)> = choices
            .iter()
            .filter_map(|(value, name)| {
                let model = value.strip_prefix(ai_providers::catalog::ATHAS)?.strip_prefix("::")?;
                Some((model, name.split_once(" · ").map_or(name.as_str(), |(_, model_name)| model_name)))
            })
            .collect();
        let picks = crate::model_vendor::recommended(athas.iter().map(|(model, _)| *model));
        if !picks.is_empty() {
            entries.push(MenuEntry::Label("Recommended".into()));
            for pick in picks {
                let name = athas.iter().find(|(model, _)| *model == pick).map_or(pick, |(_, name)| *name);
                let label = if pick == "auto" { "Athas Automatic" } else { name };
                let value = format!("{}::{pick}", ai_providers::catalog::ATHAS);
                entries.push(
                    MenuItem::new(label.to_string())
                        .icon(crate::model_vendor::model_icon(ai_providers::catalog::ATHAS, pick))
                        .checked(current.as_deref() == Some(value.as_str()))
                        .hidden_while_searching()
                        .on_select(pick_model(ai_providers::catalog::ATHAS.to_string(), pick.to_string()))
                        .into(),
                );
            }
        }
    }
    let mut section: Option<String> = None;
    for (value, name) in choices {
        let (provider, model) = value.split_once("::").map(|(provider, model)| (provider.to_string(), model.to_string())).unwrap_or_default();
        if completion && provider == ai_providers::catalog::ATHAS {
            continue;
        }
        if !connected(&provider) && current_provider.as_deref() != Some(provider.as_str()) {
            continue;
        }
        let (provider_name, model_name) = name.split_once(" · ").map_or((provider.as_str(), name.as_str()), |(provider_name, model_name)| (provider_name, model_name));
        if section.as_deref() != Some(provider.as_str()) {
            entries.push(MenuEntry::Label(provider_name.to_string().into()));
            section = Some(provider.clone());
        }
        let label = if provider == ai_providers::catalog::ATHAS && (model.is_empty() || model == "auto") { "Athas Automatic".to_string() } else { model_name.to_string() };
        entries.push(
            MenuItem::new(label)
                .icon(crate::model_vendor::model_icon(&provider, &model))
                .keywords(format!("{value} {provider_name}"))
                .checked(current.as_deref() == Some(value.as_str()))
                .on_select(pick(Some((provider, model))))
                .into(),
        );
    }
    entries
}

/// Providers a model menu offers (`useConnectedModelProviders`): Athas, providers that need no
/// key, and those with a saved or environment key; extension providers count as connected. Reads
/// the keychain, so call it off the main thread.
pub fn connected_providers(store: &dyn ai_providers::SecretStore) -> std::collections::HashSet<String> {
    ai_providers::catalog::PROVIDERS
        .iter()
        .filter(|provider| provider.id == ai_providers::catalog::ATHAS || !provider.requires_api_key || ai_providers::secrets::api_key(store, provider).is_some())
        .map(|provider| provider.id.to_string())
        .collect()
}

/// Whether a menu built from [`connected_providers`] offers `provider`.
pub fn is_connected(connected: &std::collections::HashSet<String>, provider: &str) -> bool {
    ai_providers::catalog::provider(provider).is_none() || connected.contains(provider)
}

pub const AUTOCOMPLETE: &str = "autocomplete";
pub const AUTOMATIC: &str = "Automatic";
pub const ATHAS_TAB_MODEL_LABEL: &str = "Athas Tab model";
const ATHAS_TAB_MODEL_NAME: &str = "Athas Tab";
/// The legacy autocomplete model every install started with; keeping it is no choice.
const LEGACY_AUTOCOMPLETE_MODEL: &str = "mistralai/devstral-small";

/// Tab completion's own model, `None` on Automatic (`preferences.tasks.autocomplete`). A model
/// picked on the earlier provider and model rows still counts, as
/// `migrateLegacyIntelligencePreferences` carries it over.
pub fn autocomplete_choice(settings: &settings::Settings) -> Option<(String, String)> {
    if settings.extra.get(SETTINGS_KEY).and_then(|tasks| tasks.get(AUTOCOMPLETE)).is_some() {
        return task_connection(settings, AUTOCOMPLETE);
    }
    let custom = settings.ai_autocomplete_custom_model_id.trim();
    if settings.ai_autocomplete_provider == ai_providers::catalog::CUSTOM && !custom.is_empty() {
        return Some((ai_providers::catalog::CUSTOM.into(), custom.to_string()));
    }
    let model = settings.ai_autocomplete_model_id.trim();
    (!model.is_empty() && model != LEGACY_AUTOCOMPLETE_MODEL && settings.ai_autocomplete_provider != ai_providers::catalog::CUSTOM).then(|| {
        let provider = if settings.ai_autocomplete_provider.is_empty() { "openrouter".to_string() } else { settings.ai_autocomplete_provider.clone() };
        (provider, model.to_string())
    })
}

/// What Tab completion runs on right now (`resolveAutocompleteConnection`): its own choice; on
/// Automatic the default model when that runs locally (code typed in the editor never leaves the
/// machine), else Athas's Tab model with Athas access, else the default model on the user's own
/// key. `None` leaves Tab off until a model is chosen.
pub fn resolve_autocomplete(settings: &settings::Settings, has_intelligence: bool) -> Option<ProviderSettings> {
    let mut provider = crate::builtin::provider_settings(settings);
    if !settings.ai_autocomplete_custombase_url.trim().is_empty() {
        provider.custom_base_url = settings.ai_autocomplete_custombase_url.clone();
    }
    if let Some((provider_id, model_id)) = autocomplete_choice(settings) {
        provider.model_id = if provider_id == ai_providers::catalog::ATHAS && model_id.is_empty() { "auto".into() } else { model_id };
        provider.provider_id = provider_id;
        return Some(provider);
    }
    // The default model itself, not the "New chats" override, decides whether Tab stays local.
    let default = default_provider_in(settings, has_intelligence);
    if ai_providers::local::is_local_provider(&default) {
        return (!default.model_id.trim().is_empty()).then_some(default);
    }
    if has_intelligence {
        return Some(ProviderSettings { provider_id: ai_providers::catalog::ATHAS.into(), model_id: "auto".into(), ..default });
    }
    (default.provider_id != ai_providers::catalog::ATHAS && !default.model_id.trim().is_empty()).then_some(default)
}

/// Tab completion's model for every place that shows it (`useTabCompletionModel`): a short name
/// for compact places and the line that explains it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompletionModel {
    pub automatic: bool,
    pub resolved: bool,
    /// The picker's label: Automatic, Athas Tab model, or the chosen model's name.
    pub label: String,
    /// "Athas Tab", the model's name, or "Choose a model".
    pub short_name: String,
    /// The resolved provider's name, for "… via Provider"; empty when nothing resolves.
    pub provider_name: String,
    pub description: String,
}

pub fn completion_model(settings: &settings::Settings, has_intelligence: bool, signed_in: bool, model_name: impl Fn(&str, &str) -> Option<String>) -> CompletionModel {
    let choice = autocomplete_choice(settings);
    let resolved = resolve_autocomplete(settings, has_intelligence);
    let default_is_local = ai_providers::local::is_local_provider(&crate::builtin::provider_settings(settings));
    let short_name = match &resolved {
        None => "Choose a model".to_string(),
        Some(provider) if provider.provider_id == ai_providers::catalog::ATHAS => ATHAS_TAB_MODEL_NAME.to_string(),
        Some(provider) => model_name(&provider.provider_id, &provider.model_id).unwrap_or_else(|| provider.model_id.clone()),
    };
    let description = match &resolved {
        None if default_is_local => "Choose a local model; Automatic never uses Athas here".to_string(),
        None if signed_in => "Athas Tab needs Pro, or choose your own model".to_string(),
        None => "Sign in for Athas Tab, or choose your own model".to_string(),
        Some(provider) => {
            let prefix = if choice.is_some() { "" } else { "Automatic: " };
            let provider_name = ai_providers::catalog::provider(&provider.provider_id).map_or(provider.provider_id.clone(), |known| known.name.to_string());
            if provider.provider_id == ai_providers::catalog::ATHAS {
                format!("{prefix}Athas Tab, included in Pro")
            } else if ai_providers::local::is_local_provider(provider) {
                format!("{prefix}{short_name}, runs locally")
            } else {
                format!("{prefix}{short_name} on your {provider_name} key{}", if default_is_local { ", sends code off your network" } else { "" })
            }
        }
    };
    let label = match &choice {
        None => AUTOMATIC.to_string(),
        Some((provider, model)) if provider == ai_providers::catalog::ATHAS && (model.is_empty() || model == "auto") => ATHAS_TAB_MODEL_LABEL.to_string(),
        Some((provider, model)) => model_name(provider, model).unwrap_or_else(|| model.clone()),
    };
    let provider_name = resolved.as_ref().map_or_else(String::new, |provider| ai_providers::catalog::provider(&provider.provider_id).map_or(provider.provider_id.clone(), |known| known.name.to_string()));
    CompletionModel { automatic: choice.is_none(), resolved: resolved.is_some(), label, short_name, provider_name, description }
}

/// Whether the organization lets Tab completion run (`policy.aiCompletionEnabled` in managed
/// mode); always for everyone else.
pub fn completion_allowed(cx: &gpui::App) -> bool {
    account::AccountStore::global(cx)
        .and_then(|store| store.read(cx).subscription().and_then(|subscription| subscription.enterprise.policy.clone()))
        .filter(|policy| policy.managed_mode)
        .is_none_or(|policy| policy.ai_completion_enabled)
}

/// Whether a task may run on `provider_id` (`getIntelligenceConnection`,
/// `assertIntelligenceConnectionAllowed`): a team's settings must be readable, and in managed
/// mode the task's switch must be on and personal keys need `allowByok`. The errors are the
/// original's wording.
pub fn connection_allowed(provider_id: &str, cx: &gpui::App) -> Result<(), &'static str> {
    connection_gate(cx).check(provider_id)
}

/// What the team scope and the account's policy allow right now (`getIntelligenceConnection`).
pub fn connection_gate(cx: &gpui::App) -> ai_providers::ConnectionGate {
    // Team models that could not be read are not swapped for personal ones.
    let team_unavailable = crate::intelligence_sync::global(cx).is_some_and(|sync| {
        let sync = sync.read(cx);
        sync.scope() != crate::intelligence_sync::PERSONAL && (sync.is_loading() || sync.error().is_some())
    });
    let policy = account::AccountStore::global(cx)
        .and_then(|store| store.read(cx).subscription().and_then(|subscription| subscription.enterprise.policy.clone()))
        .filter(|policy| policy.managed_mode);
    ai_providers::ConnectionGate {
        team_unavailable,
        byok_disabled: policy.as_ref().is_some_and(|policy| !policy.allow_byok),
        chat_disabled: policy.as_ref().is_some_and(|policy| !policy.ai_chat_enabled),
        completion_disabled: policy.as_ref().is_some_and(|policy| !policy.ai_completion_enabled),
    }
}

/// Publishes [`connection_gate`] for tasks that only hold settings (commit messages, drafts,
/// titles), and again whenever the team scope or the account changes.
pub fn publish_connection_gate(cx: &mut gpui::App) {
    ai_providers::set_connection_gate(connection_gate(cx));
    if let Some(sync) = crate::intelligence_sync::global(cx) {
        cx.observe(&sync, |_, cx| ai_providers::set_connection_gate(connection_gate(cx))).detach();
    }
    if let Some(store) = account::AccountStore::global(cx) {
        cx.observe(&store, |_, cx| ai_providers::set_connection_gate(connection_gate(cx))).detach();
    }
}

/// Whether the signed-in account has Athas intelligence, and whether anyone is signed in.
pub fn account_access(cx: &gpui::App) -> (bool, bool) {
    account::AccountStore::global(cx).map_or((false, false), |store| {
        let store = store.read(cx);
        (store.features().intelligence, store.is_signed_in())
    })
}

pub fn override_count(settings: &settings::Settings) -> usize {
    TASK_OVERRIDES.iter().filter(|(task, _)| task_connection(settings, task).is_some()).count()
}

/// The connection `task` runs on: its own choice, else the default model.
pub fn task_provider(settings: &settings::Settings, task: &str) -> ProviderSettings {
    let mut provider = default_provider(settings);
    if let Some((provider_id, model_id)) = task_connection(settings, task) {
        provider.model_id = if provider_id == ai_providers::catalog::ATHAS && model_id.is_empty() { "auto".into() } else { model_id };
        provider.provider_id = provider_id;
    }
    provider
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_feature_uses_its_own_model_or_the_default() {
        let mut settings = settings::Settings { ai_provider_id: "openai".into(), ai_model_id: "gpt-5".into(), ..Default::default() };
        assert_eq!(task_provider(&settings, "chat-title").model_id, "gpt-5");
        set_task_connection(&mut settings, "chat-title", Some(("anthropic".into(), "claude-haiku-4-5".into())));
        set_task_connection(&mut settings, "inline-edit", Some(("athas".into(), String::new())));
        let title = task_provider(&settings, "chat-title");
        assert_eq!((title.provider_id.as_str(), title.model_id.as_str()), ("anthropic", "claude-haiku-4-5"));
        assert_eq!(task_provider(&settings, "inline-edit").model_id, "auto");
        assert_eq!(task_provider(&settings, "commit-message").provider_id, "openai");
        assert_eq!(override_count(&settings), 2);
        set_task_connection(&mut settings, "chat-title", None);
        set_task_connection(&mut settings, "inline-edit", None);
        assert!(!settings.extra.contains_key(SETTINGS_KEY));
    }

    #[test]
    fn tab_completion_resolves_like_the_original() {
        let names = |_: &str, model: &str| (model == "gpt-5-mini").then(|| "GPT-5 mini".to_string());
        let mut settings = settings::Settings { ai_provider_id: "openai".into(), ai_model_id: "gpt-5".into(), ..Default::default() };
        // The legacy default autocomplete model is no choice: Automatic.
        assert_eq!(autocomplete_choice(&settings), None);
        assert_eq!(resolve_autocomplete(&settings, true).map(|provider| (provider.provider_id, provider.model_id)), Some(("athas".into(), "auto".into())));
        assert_eq!(resolve_autocomplete(&settings, false).map(|provider| provider.model_id), Some("gpt-5".into()));
        let model = completion_model(&settings, true, true, names);
        assert_eq!((model.label.as_str(), model.short_name.as_str(), model.description.as_str()), ("Automatic", "Athas Tab", "Automatic: Athas Tab, included in Pro"));
        assert_eq!(completion_model(&settings, false, true, names).description, "Automatic: gpt-5 on your OpenAI key");

        settings.ai_provider_id = "athas".into();
        settings.ai_model_id = "auto".into();
        assert_eq!(resolve_autocomplete(&settings, false), None);
        assert_eq!(completion_model(&settings, false, false, names).description, "Sign in for Athas Tab, or choose your own model");

        settings.ai_provider_id = "ollama".into();
        settings.ai_model_id = "qwen3".into();
        settings.ollama_base_url = "http://localhost:11434".into();
        assert_eq!(resolve_autocomplete(&settings, true).map(|provider| provider.provider_id), Some("ollama".into()));
        assert_eq!(completion_model(&settings, true, true, names).description, "Automatic: qwen3, runs locally");

        set_task_connection(&mut settings, AUTOCOMPLETE, Some(("openai".into(), "gpt-5-mini".into())));
        let model = completion_model(&settings, true, true, names);
        assert_eq!((model.label.as_str(), model.description.as_str()), ("GPT-5 mini", "GPT-5 mini on your OpenAI key, sends code off your network"));
        set_task_connection(&mut settings, AUTOCOMPLETE, Some(("athas".into(), "auto".into())));
        assert_eq!(completion_model(&settings, false, true, names).label, ATHAS_TAB_MODEL_LABEL);

        let legacy = settings::Settings { ai_autocomplete_provider: "openrouter".into(), ai_autocomplete_model_id: "qwen/qwen3-coder".into(), ..Default::default() };
        assert_eq!(autocomplete_choice(&legacy), Some(("openrouter".into(), "qwen/qwen3-coder".into())));
    }

    #[test]
    fn auto_default_routes_to_athas_with_access() {
        let mut settings = settings::Settings { ai_provider_id: "openai".into(), ai_model_id: "gpt-5".into(), ..Default::default() };
        assert!(default_is_auto(&settings));
        let routed = default_provider_in(&settings, true);
        assert_eq!((routed.provider_id.as_str(), routed.model_id.as_str()), ("athas", "auto"));
        assert_eq!(default_provider_in(&settings, false).provider_id, "openai");
        set_default_auto(&mut settings, false);
        assert_eq!(default_provider_in(&settings, true).provider_id, "openai");
        set_default_auto(&mut settings, true);
        settings.ai_provider_id = "ollama".into();
        settings.ai_model_id = "qwen3".into();
        settings.ollama_base_url = "http://localhost:11434".into();
        assert_eq!(default_provider_in(&settings, true).provider_id, "ollama");
    }

    #[test]
    fn ignores_malformed_choices() {
        let mut settings = settings::Settings::default();
        settings.extra.insert(SETTINGS_KEY.into(), json!({ "agent": { "providerId": "Bad Id", "modelId": "x" }, "chat-title": { "providerId": "auto", "modelId": "" } }));
        assert_eq!(task_connection(&settings, "agent"), None);
        assert_eq!(task_connection(&settings, "chat-title"), None);
    }
}
