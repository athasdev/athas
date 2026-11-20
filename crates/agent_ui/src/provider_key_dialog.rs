//! The API key dialog (`ai.setProviderApiKey`, and a notice's Add API key): providers that need a
//! key on the left with whether one is saved, the picked one's key on the right. A key is checked
//! with the provider before it is kept.
//!
//! Ported from Athas's `components/provider-api-key-command.tsx` and the providers'
//! `validateApiKey`.

use std::{collections::HashMap, sync::Arc};

use ai_providers::{Connection, SecretStore, catalog, secrets};
use gpui::{
    AnyElement, App, AppContext as _, ClickEvent, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, IntoElement,
    ParentElement, Render, SharedString, Styled, Subscription, Task, Window, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{Button, ButtonTone, ButtonVariant, Dialog, DialogLayout, DialogSize, Icon, IconName, IconSize, TextInput, TextInputEvent, typography};

const MASKED_API_KEY: &str = "••••••••••••••••••••";

/// What a provider's key field suggests typing.
pub fn placeholder(provider: &str) -> &'static str {
    match provider {
        "openrouter" => "sk-or-v1-xxxxxxxxxxxxxxxxxxxx",
        "grok" => "xai-xxxxxxxxxxxxxxxxxxxx",
        "openai" => "sk-xxxxxxxxxxxxxxxxxxxx",
        "mistral" => "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        _ => "API key",
    }
}

/// The providers the dialog lists: those that need a key, extensions' included.
fn providers() -> Vec<&'static catalog::Provider> {
    catalog::PROVIDERS
        .iter()
        .filter(|provider| provider.requires_api_key && provider.id != catalog::CUSTOM)
        .chain(ai_providers::external_providers().into_iter().filter(|provider| provider.requires_api_key))
        .collect()
}

/// Providers whose name or id contains `query`, ignoring case.
pub fn filter<'a>(providers: &[&'a catalog::Provider], query: &str) -> Vec<&'a catalog::Provider> {
    let query = query.trim().to_lowercase();
    providers.iter().copied().filter(|provider| query.is_empty() || provider.name.to_lowercase().contains(&query) || provider.id.contains(&query)).collect()
}

/// Whether the provider takes `key`: it lists its models with it. Only a refusal (401, 403, or
/// Gemini's 400 for a bad key) rejects it; `Err` when the provider could not be reached.
pub async fn validate_key(provider: &'static catalog::Provider, key: &str) -> Result<bool, String> {
    if let Some(valid) = ai_providers::external::validate_api_key(provider.id, key).await {
        return Ok(valid);
    }
    // Users only enter an Ollama key for Ollama Cloud, so it is checked there.
    if provider.id == catalog::OLLAMA {
        return Ok(ai_providers::connection::validate_ollama_key(ai_providers::connection::OLLAMA_CLOUD_BASE_URL, key).await);
    }
    let model = provider.models.first().map(|model| model.id).unwrap_or_default();
    let connection = Connection::new(provider, model, provider.url, Some(key.to_string()));
    match connection.list_models().await {
        Ok(_) => Ok(true),
        Err(error) => match error.status {
            Some(401 | 403) => Ok(false),
            Some(400) if provider.id == "gemini" => Ok(false),
            Some(_) => Ok(true),
            None => Err(error.message),
        },
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Status {
    Idle,
    Validating,
    Saved,
    Invalid(String),
}

pub struct ProviderKeyDialog {
    providers: Vec<&'static catalog::Provider>,
    selected: Option<&'static str>,
    search: Entity<TextInput>,
    key: Entity<TextInput>,
    /// Providers with a saved key, once read.
    saved: HashMap<&'static str, bool>,
    status: Status,
    secrets: Arc<dyn SecretStore>,
    focus_handle: FocusHandle,
    _loading: Option<Task<()>>,
    _saving: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for ProviderKeyDialog {}

impl Focusable for ProviderKeyDialog {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.search.focus_handle(cx)
    }
}

impl ProviderKeyDialog {
    /// The dialog on `provider`, or the first provider, with the keychain (in memory while a
    /// screenshot fixture is shown).
    pub fn new(provider: Option<&str>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let secrets: Arc<dyn SecretStore> =
            if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() { Arc::new(ai_providers::MemorySecrets::default()) } else { Arc::new(crate::ai_settings::KeychainRef) };
        Self::with_secrets(provider, secrets, window, cx)
    }

    pub fn with_secrets(provider: Option<&str>, secrets: Arc<dyn SecretStore>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let providers = providers();
        let selected = provider.and_then(|id| providers.iter().find(|candidate| candidate.id == id)).or(providers.first()).map(|provider| provider.id);
        let search = cx.new(|cx| TextInput::new(window, cx).placeholder("Search API key providers…").leading_icon(IconName::Search));
        let key = cx.new(|cx| TextInput::new(window, cx).masked().placeholder(selected.map_or("API key", placeholder)));
        let subscriptions = vec![
            cx.subscribe(&search, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Changed(_) => {
                    let visible = filter(&this.providers, this.search.read(cx).text());
                    if let Some(first) = visible.first()
                        && !visible.iter().any(|provider| Some(provider.id) == this.selected)
                    {
                        this.selected = Some(first.id);
                    }
                    cx.notify();
                }
                TextInputEvent::Cancelled => cx.emit(DismissEvent),
                _ => {}
            }),
            cx.subscribe(&key, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Changed(_) => {
                    if !matches!(this.status, Status::Validating) {
                        this.status = Status::Idle;
                    }
                    cx.notify();
                }
                TextInputEvent::Confirmed => this.save(cx),
                TextInputEvent::Cancelled => cx.emit(DismissEvent),
                _ => {}
            }),
        ];
        let mut this = Self {
            providers,
            selected,
            search,
            key,
            saved: HashMap::new(),
            status: Status::Idle,
            secrets,
            focus_handle: cx.focus_handle(),
            _loading: None,
            _saving: None,
            _subscriptions: subscriptions,
        };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let store = self.secrets.clone();
        let ids: Vec<&'static str> = self.providers.iter().map(|provider| provider.id).collect();
        self._loading = Some(cx.spawn(async move |this, cx| {
            let saved = cx
                .background_spawn(async move { ids.into_iter().map(|id| (id, store.get(&secrets::provider_key_account(id)).is_some())).collect::<HashMap<_, _>>() })
                .await;
            this.update(cx, |this, cx| {
                this.saved = saved;
                this.show_selected(cx);
            })
            .ok();
        }));
    }

    fn has_key(&self, provider: &str) -> bool {
        self.saved.get(provider).copied().unwrap_or(false)
    }

    /// The key field for the provider picked: masked when it has a key.
    fn show_selected(&mut self, cx: &mut Context<Self>) {
        let (text, hint) = match self.selected {
            Some(id) => (if self.has_key(id) { MASKED_API_KEY } else { "" }, placeholder(id)),
            None => ("", "API key"),
        };
        self.key.update(cx, |input, cx| {
            input.set_text(text, cx);
            input.set_placeholder(hint, cx);
        });
        cx.notify();
    }

    fn select(&mut self, provider: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        self.selected = Some(provider);
        self.status = Status::Idle;
        self.show_selected(cx);
        self.key.update(cx, |input, cx| input.focus(window, cx));
    }

    fn save(&mut self, cx: &mut Context<Self>) {
        let Some(provider) = self.selected.and_then(|id| self.providers.iter().copied().find(|provider| provider.id == id)) else { return };
        let key = self.key.read(cx).text().trim().to_string();
        if matches!(self.status, Status::Validating) || key.starts_with('•') {
            return;
        }
        if key.is_empty() {
            self.status = Status::Invalid("Please enter an API key.".into());
            cx.notify();
            return;
        }
        self.status = Status::Validating;
        let store = self.secrets.clone();
        self._saving = Some(cx.spawn(async move |this, cx| {
            let status = match validate_key(provider, &key).await {
                Ok(true) => {
                    let account = secrets::provider_key_account(provider.id);
                    match cx.background_spawn(async move { store.set(&account, &key) }).await {
                        Ok(()) => Status::Saved,
                        Err(_) => Status::Invalid("Failed to save API key.".into()),
                    }
                }
                Ok(false) => Status::Invalid("Invalid API key.".into()),
                Err(_) => Status::Invalid("Failed to validate API key.".into()),
            };
            this.update(cx, |this, cx| {
                if status == Status::Saved {
                    this.saved.insert(provider.id, true);
                    this.key.update(cx, |input, cx| input.set_text(MASKED_API_KEY, cx));
                }
                this.status = status;
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    fn remove(&mut self, cx: &mut Context<Self>) {
        let Some(provider) = self.selected else { return };
        let store = self.secrets.clone();
        self._saving = Some(cx.spawn(async move |this, cx| {
            let account = secrets::provider_key_account(provider);
            let result = cx.background_spawn(async move { store.delete(&account) }).await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(()) => {
                        this.saved.insert(provider, false);
                        this.status = Status::Idle;
                        this.key.update(cx, |input, cx| input.set_text("", cx));
                    }
                    Err(_) => this.status = Status::Invalid("Failed to remove API key.".into()),
                }
                cx.notify();
            })
            .ok();
        }));
    }

    fn render_list(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let visible = filter(&self.providers, self.search.read(cx).text());
        let rows: Vec<AnyElement> = visible
            .iter()
            .map(|provider| {
                let id = provider.id;
                let selected = self.selected == Some(id);
                let has_key = self.has_key(id);
                div()
                    .id(SharedString::from(format!("key-provider-{id}")))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(28.))
                    .px(px(8.))
                    .rounded(ui::metrics::RADIUS_MD)
                    .text_size(typography::TEXT_SM)
                    .when(selected, |this| this.bg(colors.accent))
                    .when(!selected, |this| this.hover(|style| style.bg(colors.accent)))
                    .child(crate::model_vendor::provider_mark(id, px(14.), colors.subtle_foreground))
                    .child(div().flex_1().min_w_0().truncate().child(provider.name))
                    .child(
                        Icon::new(if has_key { IconName::CheckCircle } else { IconName::WarningCircle })
                            .size(IconSize::XSmall)
                            .color(if has_key { colors.success } else { colors.warning }),
                    )
                    .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| this.select(id, window, cx)))
                    .into_any_element()
            })
            .collect();
        div()
            .id("key-providers")
            .w(px(200.))
            .flex_none()
            .overflow_y_scroll()
            .p(px(4.))
            .flex()
            .flex_col()
            .gap(px(1.))
            .when(rows.is_empty(), |this| this.child(div().p(px(8.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("No providers found")))
            .children(rows)
            .into_any_element()
    }

    fn render_detail(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(provider) = self.selected.and_then(|id| self.providers.iter().copied().find(|provider| provider.id == id)) else {
            return div().flex_1().p(px(12.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("Select a provider").into_any_element();
        };
        let has_key = self.has_key(provider.id);
        let typed = self.key.read(cx).text().trim().to_string();
        let validating = self.status == Status::Validating;
        let status: Option<AnyElement> = match &self.status {
            Status::Saved => Some(
                div().flex().items_center().gap(px(6.)).text_color(colors.success).child(Icon::new(IconName::CheckCircle).size(IconSize::Small).color(colors.success)).child("API key saved.").into_any_element(),
            ),
            Status::Invalid(message) => Some(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .text_color(colors.destructive)
                    .child(Icon::new(IconName::WarningCircle).size(IconSize::Small).color(colors.destructive))
                    .child(message.clone())
                    .into_any_element(),
            ),
            _ => None,
        };
        div()
            .flex_1()
            .min_w_0()
            .border_l_1()
            .border_color(colors.divider)
            .p(px(12.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .text_size(typography::TEXT_SM)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(crate::model_vendor::provider_mark(provider.id, px(16.), colors.subtle_foreground))
                    .child(
                        div()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(div().truncate().text_color(colors.foreground).child(provider.name))
                            .child(div().text_color(colors.subtle_foreground).child(if has_key { "API key saved" } else { "API key required" })),
                    ),
            )
            .child(self.key.clone())
            .children(status)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .pt(px(4.))
                    .child(match provider.key_url {
                        Some(url) => div()
                            .id("key-dashboard")
                            .text_color(colors.subtle_foreground)
                            .hover(|style| style.text_color(colors.foreground))
                            .child("Open dashboard")
                            .on_click(move |_, _, cx| cx.open_url(url))
                            .into_any_element(),
                        None => div().into_any_element(),
                    })
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .when(has_key, |this| {
                                this.child(
                                    Button::new("key-remove", "Remove")
                                        .variant(ButtonVariant::Ghost)
                                        .tone(ButtonTone::Danger)
                                        .leading_icon(IconName::Trash)
                                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.remove(cx))),
                                )
                            })
                            .child(
                                Button::new("key-save", if validating { "Validating" } else { "Save key" })
                                    .variant(ButtonVariant::Accent)
                                    .disabled(typed.is_empty() || validating || typed.starts_with('•'))
                                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.save(cx))),
                            ),
                    ),
            )
            .into_any_element()
    }
}

impl Render for ProviderKeyDialog {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let list = self.render_list(cx);
        let detail = self.render_detail(cx);
        Dialog::new("provider-api-keys", "API keys")
            .icon(IconName::Key)
            .size(DialogSize::Custom(px(560.)))
            .layout(DialogLayout::Flush)
            .scrollable(false)
            .track_focus(&self.focus_handle)
            .on_close({
                let view = cx.weak_entity();
                move |_, cx| {
                    view.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
                }
            })
            .child(div().p(px(8.)).border_b_1().border_color(cx.theme().colors.divider).child(self.search.clone()))
            .child(div().flex().h(px(340.)).child(list).child(detail))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_by_name_or_id() {
        let all = providers();
        assert!(all.iter().all(|provider| provider.requires_api_key));
        let open = filter(&all, "OPENAI");
        assert!(open.iter().any(|provider| provider.id == "openai"));
        assert!(open.iter().all(|provider| provider.name.to_lowercase().contains("openai") || provider.id.contains("openai")));
        assert_eq!(filter(&all, "").len(), all.len());
    }

    #[test]
    fn placeholders_follow_the_provider() {
        assert_eq!(placeholder("openrouter"), "sk-or-v1-xxxxxxxxxxxxxxxxxxxx");
        assert_eq!(placeholder("anthropic"), "API key");
    }
}
