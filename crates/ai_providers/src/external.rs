//! AI providers UI extensions register (`services/providers/external-ai-provider.ts`): the
//! extension builds each request's URL, headers and payload, and the answer streams back in the
//! OpenAI format. This crate does not know the extension host; the app installs a bridge.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, PoisonError, RwLock},
};

use futures::future::BoxFuture;
use serde_json::{Value, json};

use crate::{
    catalog::{Model, Provider, WireFormat},
    http::{HttpRequest, ProviderError},
    message::{Request, Role},
};

/// A provider as its extension's manifest describes it.
#[derive(Clone, Debug, PartialEq)]
pub struct ExternalProvider {
    pub id: String,
    pub name: String,
    pub requires_api_key: bool,
    /// (id, name)
    pub models: Vec<(String, String)>,
    /// The extension's icon (a URL or a file), drawn as the provider's mark.
    pub icon: Option<String>,
}

/// How the app reaches extension providers.
pub trait ExternalProviders: Send + Sync {
    fn providers(&self) -> Vec<ExternalProvider>;
    /// Calls `aiProvider.<method>` with the provider id first, then `args`.
    fn request(&self, provider_id: &str, method: &str, args: Vec<Value>) -> BoxFuture<'static, Result<Value, String>>;
}

static BRIDGE: RwLock<Option<Arc<dyn ExternalProviders>>> = RwLock::new(None);

pub fn set_external_providers(bridge: Option<Arc<dyn ExternalProviders>>) {
    *BRIDGE.write().unwrap_or_else(PoisonError::into_inner) = bridge;
}

pub(crate) fn bridge() -> Option<Arc<dyn ExternalProviders>> {
    BRIDGE.read().unwrap_or_else(PoisonError::into_inner).clone()
}

/// The extension providers registered now, as catalog providers (kept for the app's life, so a
/// connection can hold them like the built-in ones).
pub fn external_providers() -> Vec<&'static Provider> {
    bridge().map(|bridge| bridge.providers().iter().map(catalog_entry).collect()).unwrap_or_default()
}

/// The icon an extension gave the provider `id`, when one did.
pub fn external_provider_icon(id: &str) -> Option<String> {
    bridge()?.providers().into_iter().find(|provider| provider.id == id)?.icon
}

pub fn external_provider(id: &str) -> Option<&'static Provider> {
    let bridge = bridge()?;
    bridge.providers().iter().find(|provider| provider.id == id).map(catalog_entry)
}

fn catalog_entry(provider: &ExternalProvider) -> &'static Provider {
    static ENTRIES: Mutex<Option<HashMap<String, (ExternalProvider, &'static Provider)>>> = Mutex::new(None);
    let mut entries = ENTRIES.lock().unwrap_or_else(PoisonError::into_inner);
    let entries = entries.get_or_insert_with(HashMap::new);
    if let Some((described, entry)) = entries.get(&provider.id)
        && described == provider
    {
        return entry;
    }
    let leak = |text: &str| -> &'static str { Box::leak(text.to_string().into_boxed_str()) };
    let models: Vec<Model> = provider
        .models
        .iter()
        .map(|(id, name)| Model { id: leak(id), name: leak(name), context_window: 0, max_output_tokens: 4096, supports_images: false })
        .collect();
    let entry: &'static Provider = Box::leak(Box::new(Provider {
        id: leak(&provider.id),
        name: leak(&provider.name),
        format: WireFormat::OpenAi,
        url: "",
        requires_api_key: provider.requires_api_key,
        key_env: &[],
        key_url: None,
        models: Box::leak(models.into_boxed_slice()),
    }));
    entries.insert(provider.id.clone(), (provider.clone(), entry));
    entry
}

/// The `StreamRequest` the extension builds from: text messages, the system prompt first.
pub(crate) fn stream_request(model: &str, request: &Request, api_key: Option<&str>) -> Value {
    let mut messages = Vec::new();
    if !request.system.is_empty() {
        messages.push(json!({ "role": "system", "content": request.system }));
    }
    for message in &request.messages {
        let role = match message.role {
            Role::User | Role::Tool => "user",
            Role::Assistant => "assistant",
        };
        let content = message.text();
        if !content.is_empty() {
            messages.push(json!({ "role": role, "content": content }));
        }
    }
    let mut value = json!({
        "modelId": model,
        "messages": messages,
        "maxTokens": request.max_tokens,
        "temperature": request.temperature.unwrap_or(0.7),
    });
    if let Some(key) = api_key {
        value["apiKey"] = json!(key);
    }
    value
}

/// Asks the extension for the request's URL, headers and payload.
pub(crate) async fn build_request(provider: &Provider, model: &str, request: &Request, api_key: Option<String>) -> Result<HttpRequest, ProviderError> {
    let error = |message: String| ProviderError { status: None, message: format!("{}: {message}", provider.name) };
    let bridge = bridge().ok_or_else(|| error("its extension is not running".into()))?;
    let stream_request = stream_request(model, request, api_key.as_deref());
    let key = api_key.map_or(Value::Null, Value::String);
    let (headers, payload, url) = futures::join!(
        bridge.request(provider.id, "buildHeaders", vec![key]),
        bridge.request(provider.id, "buildPayload", vec![stream_request.clone()]),
        bridge.request(provider.id, "buildUrl", vec![stream_request]),
    );
    let headers = match headers.map_err(error)? {
        Value::Object(map) => map
            .into_iter()
            .map(|(name, value)| (name.to_lowercase(), value.as_str().map_or_else(|| value.to_string(), str::to_string)))
            .collect::<Vec<_>>(),
        _ => return Err(error("the extension returned invalid headers".into())),
    };
    let url = match url {
        Ok(Value::String(url)) if !url.trim().is_empty() => url,
        _ => return Err(error("the extension gave no request URL".into())),
    };
    Ok(HttpRequest { url, headers, body: Some(payload.map_err(error)?) })
}

/// The models the extension lists now, or `None` when it has no list.
pub async fn list_models(provider_id: &str, api_key: Option<String>) -> Option<Vec<(String, String)>> {
    let bridge = bridge()?;
    let value = bridge.request(provider_id, "getModels", vec![api_key.map_or(Value::Null, Value::String)]).await.ok()?;
    let models: Vec<(String, String)> = value
        .as_array()?
        .iter()
        .filter_map(|model| {
            let id = model.get("id")?.as_str()?.trim();
            let name = model.get("name").and_then(Value::as_str).map(str::trim).filter(|name| !name.is_empty()).unwrap_or(id);
            (!id.is_empty()).then(|| (id.to_string(), name.to_string()))
        })
        .collect();
    Some(models)
}

/// What the extension adds to the system prompt (`aiProvider.getSystemPromptContext`); `None`
/// for a provider no extension registered, or when it adds nothing.
pub async fn system_prompt_context(provider_id: &str) -> Option<String> {
    let bridge = bridge()?;
    if !bridge.providers().iter().any(|provider| provider.id == provider_id) {
        return None;
    }
    match bridge.request(provider_id, "getSystemPromptContext", Vec::new()).await {
        Ok(Value::String(context)) if !context.trim().is_empty() => Some(context),
        _ => None,
    }
}

/// Whether the extension accepts `api_key` (`aiProvider.validateApiKey`); `None` for a provider
/// no extension registered. An extension that fails to answer rejects the key, as Athas does.
pub async fn validate_api_key(provider_id: &str, api_key: &str) -> Option<bool> {
    let bridge = bridge()?;
    if !bridge.providers().iter().any(|provider| provider.id == provider_id) {
        return None;
    }
    Some(matches!(bridge.request(provider_id, "validateApiKey", vec![Value::String(api_key.to_string())]).await, Ok(Value::Bool(true))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::Message;

    #[test]
    fn the_stream_request_carries_text_messages_after_the_system_prompt() {
        let request = Request { system: "Be brief".into(), messages: vec![Message::user("Hi"), Message::assistant("Hello")], max_tokens: 100, ..Default::default() };
        let value = stream_request("m1", &request, Some("k"));
        assert_eq!(value["messages"][0], json!({ "role": "system", "content": "Be brief" }));
        assert_eq!(value["messages"][2], json!({ "role": "assistant", "content": "Hello" }));
        assert_eq!(value["modelId"], "m1");
        assert_eq!(value["apiKey"], "k");
    }
}
