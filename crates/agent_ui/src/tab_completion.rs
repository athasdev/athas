//! Tab autocomplete's model side (`intelligence-completion-service.ts`): the editor's ghost text
//! asks [`complete`], which runs Tab completion's model (`intelligence::resolve_autocomplete`). Account and billing errors pause it
//! (with one notice per message) until the settings change, so it stops retrying on every pause in
//! typing; [`CompletionStatusItem`] shows the [`status`] beside the editor's breadcrumbs.

use std::sync::Arc;

use ai_providers::{CompletionError, CompletionRequest, InlineCompletionProvider, SecretStore};
use gpui::{App, AppContext as _, ClickEvent, Context, Global, IntoElement, Render, Subscription, Task, Window, div, prelude::*};
use ui::{Button, ButtonSize, ButtonTone, ButtonVariant, IconName, MenuEntry, MenuItem, OpenMenu};

/// What Tab autocomplete is doing.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum CompletionStatus {
    #[default]
    Idle,
    Requesting,
    /// Stopped until the settings change: sign in, add a key, credit, policy.
    Paused(String),
    /// The last request failed; the next one may work.
    Failed(String),
}

#[derive(Default)]
struct State {
    status: CompletionStatus,
    notified: Vec<String>,
    /// The settings the pause was for; a change resumes.
    paused_for: Option<String>,
    secrets: Option<Arc<dyn SecretStore>>,
}

impl Global for State {}

/// Reads keys from `secrets` instead of the keychain (headless renders and tests).
pub fn set_secrets(secrets: Arc<dyn SecretStore>, cx: &mut App) {
    cx.default_global::<State>().secrets = Some(secrets);
}

pub fn status(cx: &App) -> CompletionStatus {
    cx.try_global::<State>().map(|state| state.status.clone()).unwrap_or_default()
}

/// Lifts a pause or failure so the next pause in typing asks again ("Retry now").
pub fn resume(cx: &mut App) {
    let state = cx.default_global::<State>();
    state.status = CompletionStatus::Idle;
    state.paused_for = None;
}

/// The status item's title and the detail under it (`describeStatus`).
pub fn describe_status(enabled: bool, status: &CompletionStatus) -> (&'static str, Option<String>, ButtonTone) {
    if !enabled {
        return ("Tab autocomplete off", None, ButtonTone::Default);
    }
    match status {
        CompletionStatus::Requesting => ("Tab autocomplete: thinking", None, ButtonTone::Default),
        CompletionStatus::Paused(message) => ("Tab autocomplete paused", Some(message.clone()), ButtonTone::Warning),
        CompletionStatus::Failed(message) => ("Tab autocomplete error", Some(message.clone()), ButtonTone::Danger),
        CompletionStatus::Idle => ("Tab autocomplete on", None, ButtonTone::Default),
    }
}

/// Tab completion's model as menus and settings show it (`useTabCompletionModel`).
pub fn completion_model(settings: &settings::Settings, cx: &App) -> crate::intelligence::CompletionModel {
    let (has_intelligence, signed_in) = crate::intelligence::account_access(cx);
    let choices = crate::intelligence::connection_choices(cx);
    crate::intelligence::completion_model(settings, has_intelligence, signed_in, |provider, model| {
        let value = format!("{provider}::{model}");
        choices.iter().find(|(id, _)| *id == value).map(|(_, name)| name.split_once(" · ").map_or(name.clone(), |(_, model)| model.to_string()))
    })
}

/// Tab autocomplete's status item beside the editor's breadcrumbs
/// (`intelligence-completion-status.tsx`): what it is doing, and a menu to retry, pick the model,
/// open its settings or turn it off.
pub struct CompletionStatusItem {
    open_menu: Option<OpenMenu>,
    /// Providers with a key, read when the menu first opens.
    connected: Option<std::collections::HashSet<String>>,
    _subscriptions: Vec<Subscription>,
}

impl CompletionStatusItem {
    pub fn new(cx: &mut Context<Self>) -> Self {
        cx.default_global::<State>();
        let mut subscriptions = vec![cx.observe_global::<State>(|_, cx| cx.notify())];
        if cx.try_global::<settings::SettingsStore>().is_some() {
            subscriptions.push(cx.observe_global::<settings::SettingsStore>(|_, cx| cx.notify()));
        }
        Self { open_menu: None, connected: None, _subscriptions: subscriptions }
    }

    fn open(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.open_at(event.position(), window, cx);
    }

    /// Opens the menu at `position` (the click, or a fixed point for screenshots).
    pub fn open_at(&mut self, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        if self.connected.is_none() {
            let secrets = secrets(cx);
            cx.spawn(async move |this, cx| {
                let connected = cx.background_spawn(async move { crate::intelligence::connected_providers(secrets.as_ref()) }).await;
                this.update(cx, |this, _| this.connected = Some(connected)).ok();
            })
            .detach();
        }
        let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
        let enabled = settings.ai_completion;
        let status = status(cx);
        let (title, detail, _) = describe_status(enabled, &status);
        let model = completion_model(&settings, cx);
        let detail = detail.unwrap_or_else(|| if enabled { model.description.clone() } else { "Turn it on to get suggestions as you type".to_string() });
        let mut entries = vec![MenuEntry::Label(title.into()), MenuEntry::Item(MenuItem::new(detail).disabled(true))];
        if enabled {
            // Keys are read off the main thread when the menu opens; until then every provider shows.
            let connected = self.connected.clone();
            let choices = crate::intelligence::connection_choices(cx);
            let models = crate::intelligence::completion_entries(&settings, &choices, |provider| connected.as_ref().is_none_or(|connected| crate::intelligence::is_connected(connected, provider)));
            let via = (!model.provider_name.is_empty()).then(|| format!("{} via {}", model.short_name, model.provider_name));
            let value = if model.automatic && model.resolved { format!("Auto · {}", model.short_name) } else { model.short_name };
            // Team members who cannot edit the team's AI settings see the model but cannot change
            // it (`model.locked`).
            let locked = !crate::intelligence_sync::can_edit(cx);
            let mut item = MenuItem::new("Model").trailing_text(value).disabled(locked);
            if let Some(via) = via {
                item = item.tooltip(via);
            }
            entries.push(MenuEntry::Item(item.searchable_submenu("Search models…", "No matching models").submenu(models)));
        }
        entries.push(MenuEntry::Separator);
        if enabled && matches!(status, CompletionStatus::Paused(_) | CompletionStatus::Failed(_)) {
            entries.push(MenuEntry::Item(MenuItem::new("Retry now").on_select(|_, cx| resume(cx))));
        }
        entries.push(MenuEntry::Item(MenuItem::new("Tab completion settings").on_select(|_, cx| workbench_api::open_settings(cx, Some("ai"), Some("Tab completion")))));
        entries.push(MenuEntry::Item(MenuItem::new("Tab autocomplete").checked(enabled).on_select(move |_, cx| {
            resume(cx);
            if cx.try_global::<settings::SettingsStore>().is_some() {
                settings::update(cx, |settings| settings.ai_completion = !enabled);
            }
        })));
        self.open_menu = Some(OpenMenu::new("tab-completion", entries, position, gpui::Anchor::TopRight, window, cx, |this, _| this.open_menu = None));
        cx.notify();
    }
}

impl Render for CompletionStatusItem {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let enabled = cx.try_global::<settings::SettingsStore>().is_some_and(|_| settings::get(cx).ai_completion);
        let status = status(cx);
        let (title, _, tone) = describe_status(enabled, &status);
        let icon = match (&status, enabled) {
            (CompletionStatus::Requesting, true) => IconName::CircleDotted,
            (CompletionStatus::Paused(_), true) => IconName::Pause,
            (CompletionStatus::Failed(_), true) => IconName::WarningCircle,
            _ => IconName::Sparkle,
        };
        div()
            .flex()
            .flex_none()
            .items_center()
            .when(!enabled, |this| this.opacity(0.5))
            .child(
                Button::icon("tab-completion-status", icon)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::XSmall)
                    .tone(tone)
                    .tooltip(title)
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open(event, window, cx))),
            )
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

fn settings_key(provider: &ai_providers::ProviderSettings) -> String {
    format!("{}|{}|{}|{}|{}", provider.provider_id, provider.model_id, provider.custom_base_url, provider.custom_model_id, provider.ollama_base_url)
}

fn secrets(cx: &mut App) -> Arc<dyn SecretStore> {
    cx.default_global::<State>().secrets.clone().unwrap_or_else(|| Arc::new(crate::ai_settings::KeychainRef))
}

/// Asks the autocomplete model for ghost text at the caret. `None` when Tab autocomplete is off,
/// paused, or the file is sensitive.
pub fn complete(request: CompletionRequest, cx: &mut App) -> Option<Task<Option<String>>> {
    let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default();
    if !settings.ai_completion || request.before_cursor.trim().is_empty() || !crate::intelligence::completion_allowed(cx) {
        return None;
    }
    // No model to run on (Automatic without Athas access or a default model): Tab stays off
    // until one is chosen, as Settings says ("Off until chosen").
    let (has_intelligence, _) = crate::intelligence::account_access(cx);
    let provider = crate::intelligence::resolve_autocomplete(&settings, has_intelligence)?;
    let key = settings_key(&provider);
    let hosted = provider.provider_id == ai_providers::catalog::ATHAS;
    if let Err(problem) = crate::intelligence::connection_allowed(&provider.provider_id, cx) {
        cx.default_global::<State>().status = CompletionStatus::Failed(problem.to_string());
        return None;
    }
    let state = cx.default_global::<State>();
    if matches!(state.status, CompletionStatus::Paused(_)) {
        if state.paused_for.as_deref() == Some(key.as_str()) {
            return None;
        }
        state.status = CompletionStatus::Idle;
        state.paused_for = None;
    }
    let secrets: Arc<dyn SecretStore> = state.secrets.clone().unwrap_or_else(|| Arc::new(crate::ai_settings::KeychainRef));
    state.status = CompletionStatus::Requesting;
    let mut request = request;
    request.recent_edits = crate::completion_context::take_recent_edits(cx, &request.file_path, &request.before_cursor, &request.after_cursor);
    let line = request.before_cursor.matches('\n').count() as u32 + 1;
    request.diagnostics = crate::completion_context::nearby_diagnostics(&crate::context_refs::current_problems(cx), std::path::Path::new(&request.file_path), line);
    let open_files: Vec<std::path::PathBuf> = workbench_api::open_tabs(cx).into_iter().filter_map(|tab| tab.path).collect();
    // The project holding the file, whose AI ignore files and credential rules decide whether
    // its text may go to the model (`loadAgentContextPolicy`).
    let projects = workbench_api::projects(cx);
    let root = projects
        .open
        .iter()
        .chain(projects.active.iter())
        .map(std::path::PathBuf::from)
        .filter(|root| std::path::Path::new(&request.file_path).starts_with(root))
        .max_by_key(|root| root.as_os_str().len());
    let work = cx.background_spawn(async move {
        if let Some(root) = root
            && !ai_tools::context_policy(Some(&root)).is_ok_and(|policy| policy.allows(std::path::Path::new(&request.file_path), false))
        {
            return Ok(String::new());
        }
        request.related_files = related_files(&request, &open_files);
        let provider = InlineCompletionProvider::resolve(&provider, secrets.as_ref())?;
        provider.complete(&request).await
    });
    Some(cx.spawn(async move |cx| {
        let result = work.await;
        cx.update(|cx| finished(result, key, hosted, cx))
    }))
}

/// Summaries of the other open files, read from disk (`getRelatedFileSnippets`).
fn related_files(request: &CompletionRequest, open: &[std::path::PathBuf]) -> Vec<ai_providers::ContextSnippet> {
    let candidates: Vec<crate::completion_context::RelatedCandidate> = open
        .iter()
        .filter(|path| path.to_string_lossy() != request.file_path)
        .filter(|path| std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file() && metadata.len() <= crate::completion_context::MAX_RELATED_FILE_BYTES))
        .filter_map(|path| {
            let path_text = path.to_string_lossy().into_owned();
            if crate::completion_context::is_sensitive(&path_text) {
                return None;
            }
            std::fs::read_to_string(path).ok().map(|content| crate::completion_context::RelatedCandidate { path: path_text, content })
        })
        .collect();
    crate::completion_context::related_file_snippets(&request.file_path, &request.before_cursor, &candidates)
}

/// The notice a pause raises once per reason (`getPauseNotice`); `None` for a signed-out user,
/// who only sees the status item, since the notice is for lost sessions.
fn pause_notice(error: &CompletionError, hosted: bool, cx: &App) -> Option<(&'static str, String)> {
    match error {
        CompletionError::NeedsAccount(_) if hosted => {
            let signed_in = crate::intelligence::account_access(cx).1;
            signed_in.then(|| ("sign-in", "Tab autocomplete is paused. Sign in to use Athas AI.".to_string()))
        }
        CompletionError::NeedsAccount(_) => Some(("api-key", "Tab autocomplete is paused because the selected provider needs an API key.".to_string())),
        CompletionError::NotAllowed(_) => {
            let markup = account::AccountStore::global(cx).and_then(|store| store.read(cx).subscription().and_then(|subscription| subscription.credits.as_ref()).and_then(|credits| credits.usage_markup));
            Some((
                "credits",
                format!(
                    "Tab autocomplete is paused: there is no Athas AI credit left. Pro includes Athas credit every month, then pay as you go at {}.",
                    crate::hosted_usage::usage_rate(markup)
                ),
            ))
        }
        CompletionError::Disabled(_) => Some(("policy", "Tab autocomplete is disabled by your organization.".to_string())),
        CompletionError::Failed(_) => None,
    }
}

fn finished(result: Result<String, CompletionError>, key: String, hosted: bool, cx: &mut App) -> Option<String> {
    let notice = result.as_ref().err().and_then(|error| pause_notice(error, hosted, cx));
    let state = cx.default_global::<State>();
    match result {
        Ok(text) => {
            state.status = CompletionStatus::Idle;
            (!text.trim().is_empty()).then_some(text)
        }
        Err(CompletionError::Failed(message)) => {
            state.status = CompletionStatus::Failed(first_line(&message));
            None
        }
        Err(CompletionError::NeedsAccount(message) | CompletionError::NotAllowed(message) | CompletionError::Disabled(message)) => {
            state.status = CompletionStatus::Paused(first_line(&message));
            state.paused_for = Some(key);
            if let Some((reason, notice)) = notice
                && !state.notified.iter().any(|notified| notified == reason)
            {
                state.notified.push(reason.to_string());
                notifications::notify(cx, notifications::NotificationKind::Warning, notifications::NotificationCategory::Athas, notice, None, None);
            }
            None
        }
    }
}

fn first_line(message: &str) -> String {
    let line = message.trim().lines().next().unwrap_or_default();
    if line.chars().count() > 240 { format!("{}…", line.chars().take(239).collect::<String>()) } else { line.to_string() }
}
