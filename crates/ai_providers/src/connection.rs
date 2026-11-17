//! A ready connection to one model: its provider, endpoint and credential, and the streamed
//! request in the provider's own format.
//!
//! Ported from Athas's `intelligence/services/intelligence-sdk-model.ts` and the provider classes
//! in `services/providers`.

use std::{
    fmt,
    sync::atomic::{AtomicU64, Ordering},
};

use futures::{StreamExt, stream::BoxStream};
use serde_json::Value;

use crate::{
    anthropic,
    catalog::{self, Model, Provider, WireFormat},
    http::{self, HttpRequest, ProviderError},
    message::{Event, Request},
    openai,
    secrets::{self, SecretStore},
    sse::SseDecoder,
};

/// The AI settings that pick a model (`aiProviderId`, `aiModelId` and the endpoints).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProviderSettings {
    pub provider_id: String,
    pub model_id: String,
    pub custom_base_url: String,
    pub custom_model_id: String,
    pub ollama_base_url: String,
}

/// Why no connection could be made.
#[derive(Clone, Debug, PartialEq)]
pub enum ConnectError {
    UnknownProvider(String),
    /// The provider needs an API key and none is saved or in the environment.
    MissingKey { provider: &'static str, env: Option<&'static str>, key_url: Option<&'static str> },
    /// Athas's hosted models need a signed-in account.
    NotSignedIn,
    /// The custom provider has no endpoint, or no model was chosen.
    NotConfigured(String),
}

impl fmt::Display for ConnectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConnectError::UnknownProvider(id) => write!(f, "The provider \"{id}\" is not available"),
            ConnectError::MissingKey { provider, env, .. } => match env {
                Some(env) => write!(f, "{provider} needs an API key. Add one in Settings > AI, or set {env}."),
                None => write!(f, "{provider} needs an API key. Add one in Settings > AI."),
            },
            ConnectError::NotSignedIn => f.write_str("Sign in to Athas to use hosted models, or pick another provider in Settings > AI."),
            ConnectError::NotConfigured(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ConnectError {}

#[derive(Clone)]
enum Credential {
    None,
    ApiKey(String),
    /// The Athas account's token.
    Account(String),
}

#[derive(Clone)]
pub struct Connection {
    pub provider: &'static Provider,
    pub model: String,
    pub url: String,
    credential: Credential,
    /// Gives each request of an Athas run its own `Idempotency-Key`, so a retried step is never
    /// billed twice.
    run_id: String,
    requests: std::sync::Arc<AtomicU64>,
}

impl fmt::Debug for Connection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never the credential.
        f.debug_struct("Connection").field("provider", &self.provider.id).field("model", &self.model).field("url", &self.url).finish()
    }
}

pub type EventStream = BoxStream<'static, Result<Event, ProviderError>>;

impl Connection {
    /// The connection the settings describe, with its key from `secrets`.
    pub fn resolve(settings: &ProviderSettings, secrets: &dyn SecretStore) -> Result<Self, ConnectError> {
        let provider = catalog::provider(&settings.provider_id)
            .or_else(|| crate::external::external_provider(&settings.provider_id))
            .ok_or_else(|| ConnectError::UnknownProvider(settings.provider_id.clone()))?;
        let model = if provider.id == catalog::CUSTOM && !settings.custom_model_id.trim().is_empty() {
            settings.custom_model_id.trim().to_string()
        } else {
            settings.model_id.trim().to_string()
        };
        let model = if model.is_empty() { provider.models.first().map(|model| model.id.to_string()).unwrap_or_default() } else { model };
        if model.is_empty() {
            return Err(ConnectError::NotConfigured(format!("Choose a {} model in Settings > AI.", provider.name)));
        }
        let url = match provider.id {
            catalog::ATHAS => format!("{}{}", catalog::api_base(), provider.url),
            catalog::OLLAMA => format!("{}/v1/chat/completions", catalog::normalize_ollama_base_url(&settings.ollama_base_url)),
            catalog::CUSTOM => {
                if settings.custom_base_url.trim().is_empty() {
                    return Err(ConnectError::NotConfigured("Add the custom provider's base URL in Settings > AI.".into()));
                }
                catalog::chat_completions_url(&settings.custom_base_url)
            }
            _ => provider.url.to_string(),
        };
        let credential = if provider.is_hosted() {
            Credential::Account(secrets::auth_token(secrets).ok_or(ConnectError::NotSignedIn)?)
        } else {
            match secrets::api_key(secrets, provider) {
                Some(key) => Credential::ApiKey(key),
                None if provider.requires_api_key => {
                    return Err(ConnectError::MissingKey { provider: provider.name, env: provider.key_env.first().copied(), key_url: provider.key_url });
                }
                None => Credential::None,
            }
        };
        Ok(Self::with_credential(provider, model, url, credential))
    }

    /// A connection to `url` with an explicit key, for tests and one-off endpoints.
    pub fn new(provider: &'static Provider, model: impl Into<String>, url: impl Into<String>, api_key: Option<String>) -> Self {
        let credential = match api_key {
            Some(key) if provider.is_hosted() => Credential::Account(key),
            Some(key) => Credential::ApiKey(key),
            None => Credential::None,
        };
        Self::with_credential(provider, model.into(), url.into(), credential)
    }

    fn with_credential(provider: &'static Provider, model: String, url: String, credential: Credential) -> Self {
        static RUNS: AtomicU64 = AtomicU64::new(0);
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_nanos()).unwrap_or_default();
        let run_id = format!("{nanos:x}-{}", RUNS.fetch_add(1, Ordering::Relaxed));
        Self { provider, model, url, credential, run_id, requests: Default::default() }
    }

    /// Whether an extension's provider serves the model.
    pub fn is_external(&self) -> bool {
        catalog::provider(self.provider.id).is_none()
    }

    /// What the catalog knows about the model.
    pub fn model_info(&self) -> Option<&'static Model> {
        self.provider.model(&self.model)
    }

    pub fn context_window(&self) -> u64 {
        self.model_info().map_or(0, |model| model.context_window)
    }

    /// Whether the model reads images. Models the catalog does not list are assumed to.
    pub fn supports_images(&self) -> bool {
        self.model_info().is_none_or(|model| model.supports_images)
    }

    /// The output budget for one request when the caller has none.
    pub fn default_max_tokens(&self) -> u64 {
        match self.model_info() {
            Some(model) if self.provider.is_hosted() => model.max_output_tokens,
            Some(model) => model.max_output_tokens.min(16_384),
            None => 4096,
        }
    }

    pub(crate) fn headers(&self) -> Vec<(String, String)> {
        match (&self.credential, self.provider.format) {
            (Credential::ApiKey(key), WireFormat::Anthropic) => anthropic::headers(key),
            (credential, _) => {
                let mut headers = vec![
                    ("content-type".to_string(), "application/json".to_string()),
                    ("accept".to_string(), "text/event-stream, application/json".to_string()),
                ];
                match credential {
                    Credential::ApiKey(key) => headers.push(("authorization".into(), format!("Bearer {key}"))),
                    Credential::Account(token) => {
                        headers.push(("authorization".into(), format!("Bearer {token}")));
                        headers.push(("x-athas-intelligence-scope".into(), "personal".into()));
                        let index = self.requests.fetch_add(1, Ordering::Relaxed);
                        headers.push(("idempotency-key".into(), format!("{}-{index}", self.run_id)));
                    }
                    Credential::None => {}
                }
                if self.provider.id == "openrouter" {
                    headers.push(("http-referer".into(), "https://athas.dev".into()));
                    headers.push(("x-title".into(), "Athas".into()));
                }
                headers
            }
        }
    }

    pub fn body(&self, request: &Request) -> Value {
        match self.provider.format {
            WireFormat::Anthropic => anthropic::body(&self.model, request),
            WireFormat::OpenAi => {
                let id = self.provider.id;
                let dialect = openai::Dialect {
                    max_completion_tokens: matches!(id, "openai" | catalog::ATHAS),
                    include_usage: matches!(id, catalog::ATHAS | "openai" | "openrouter" | catalog::OLLAMA),
                    openrouter_cost: id == "openrouter",
                };
                openai::body(&self.model, request, dialect)
            }
        }
    }

    /// Sends `request` and streams what the model answers.
    pub async fn stream(&self, request: &Request) -> Result<EventStream, ProviderError> {
        let http_request = if self.is_external() {
            let key = match &self.credential {
                Credential::ApiKey(key) => Some(key.clone()),
                _ => None,
            };
            crate::external::build_request(self.provider, &self.model, request, key).await?
        } else {
            HttpRequest { url: self.url.clone(), headers: self.headers(), body: Some(self.body(request)) }
        };
        let (head, lines) = http::stream_lines(http_request).await.map_err(|error| self.explain(error))?;
        let chosen = head.header("x-athas-model").map(str::to_string);
        let format = self.provider.format;
        enum Parser {
            Anthropic(anthropic::Parser),
            OpenAi(openai::Parser),
        }
        struct State {
            lines: http::Lines,
            decoder: SseDecoder,
            parser: Parser,
            pending: std::collections::VecDeque<Result<Event, ProviderError>>,
            ended: bool,
        }
        let parser = match format {
            WireFormat::Anthropic => Parser::Anthropic(anthropic::Parser::default()),
            WireFormat::OpenAi => Parser::OpenAi(openai::Parser::default()),
        };
        let mut pending = std::collections::VecDeque::new();
        if let Some(model) = chosen {
            pending.push_back(Ok(Event::Model(model)));
        }
        let state = State { lines, decoder: SseDecoder::default(), parser, pending, ended: false };
        let stream = futures::stream::unfold(state, |mut state| async move {
            loop {
                if let Some(next) = state.pending.pop_front() {
                    return Some((next, state));
                }
                if state.ended {
                    return None;
                }
                let event = match state.lines.next().await {
                    Some(Ok(line)) => state.decoder.line(&line),
                    Some(Err(error)) => {
                        state.ended = true;
                        state.pending.push_back(Err(error));
                        continue;
                    }
                    None => {
                        state.ended = true;
                        let last = state.decoder.finish();
                        let mut results = Vec::new();
                        match &mut state.parser {
                            Parser::Anthropic(parser) => {
                                if let Some(event) = last {
                                    results.push(parser.event(&event));
                                }
                                results.push(parser.end());
                            }
                            Parser::OpenAi(parser) => {
                                if let Some(event) = last {
                                    results.push(parser.event(&event));
                                }
                                results.push(parser.end());
                            }
                        }
                        for result in results {
                            match result {
                                Ok(events) => state.pending.extend(events.into_iter().map(Ok)),
                                Err(error) => state.pending.push_back(Err(error)),
                            }
                        }
                        continue;
                    }
                };
                let Some(event) = event else { continue };
                let parsed = match &mut state.parser {
                    Parser::Anthropic(parser) => parser.event(&event),
                    Parser::OpenAi(parser) => parser.event(&event),
                };
                match parsed {
                    Ok(events) => state.pending.extend(events.into_iter().map(Ok)),
                    Err(error) => {
                        state.ended = true;
                        state.pending.push_back(Err(error));
                    }
                }
            }
        });
        Ok(stream.boxed())
    }

    /// Says what an HTTP failure means for this provider.
    fn explain(&self, error: ProviderError) -> ProviderError {
        let message = match (error.status, self.provider.is_hosted()) {
            (Some(401), true) => "Your Athas session has expired. Sign out and sign in again.".to_string(),
            (Some(402), true) => {
                "Athas models need Pro or pay-as-you-go credit. Upgrade or add credit in billing to use them.".to_string()
            }
            (Some(401), false) => format!("{} rejected the API key: {}", self.provider.name, error.message),
            (Some(404), false) if self.provider.id == catalog::OLLAMA => {
                format!("Ollama does not have {}. Pull it with `ollama pull {}`.", self.model, self.model)
            }
            (Some(400), false) if self.provider.id == catalog::OLLAMA && error.message.contains("does not support tools") => {
                format!("{} cannot use tools, so it cannot work in your project. Pick a model that supports tools.", self.model)
            }
            _ => return error,
        };
        ProviderError { status: error.status, message }
    }

    /// Asks the provider which models it offers: Athas's catalog, or an OpenAI-style `/models`.
    pub async fn list_models(&self) -> Result<Vec<RemoteModel>, ProviderError> {
        let url = if self.provider.is_hosted() {
            format!("{}/api/ai/chat", catalog::api_base())
        } else {
            let base = self.url.trim_end_matches("/chat/completions").trim_end_matches("/messages");
            format!("{base}/models")
        };
        let request = HttpRequest { url, headers: self.headers(), body: None };
        let (_, value) = http::json(request).await.map_err(|error| self.explain(error))?;
        if self.provider.is_hosted() && value.get("enabled").and_then(Value::as_bool) == Some(false) {
            return Err(ProviderError::status(402, "Athas models need Pro or pay-as-you-go credit."));
        }
        let models = value.get("data").or_else(|| value.get("models")).and_then(Value::as_array).cloned().unwrap_or_default();
        Ok(models
            .iter()
            .filter_map(|model| {
                let id = model.get("id").or_else(|| model.get("name")).and_then(Value::as_str)?.to_string();
                let name = model.get("display_name").or_else(|| model.get("name")).and_then(Value::as_str).unwrap_or(&id).to_string();
                let context_window = model
                    .get("contextWindow")
                    .or_else(|| model.get("context_length"))
                    // OpenAI-compatible servers such as LM Studio and vLLM (`max_context_length`).
                    .or_else(|| model.get("max_context_length"))
                    .and_then(Value::as_u64)
                    .unwrap_or_default();
                Some(RemoteModel { id, name, context_window })
            })
            .collect())
    }
}

/// The models of a provider's `/models` answer that chat: OpenAI lists audio, image and
/// embedding models too, and Gemini names its models `models/<id>`.
pub fn chat_models(provider_id: &str, models: Vec<RemoteModel>) -> Vec<RemoteModel> {
    match provider_id {
        "openai" => {
            let mut chat: Vec<RemoteModel> = models
                .into_iter()
                .filter(|model| {
                    let id = model.id.as_str();
                    let family = id.starts_with("gpt-") || (id.starts_with('o') && id[1..].starts_with(|c: char| c.is_ascii_digit()));
                    family && !["audio", "realtime", "search-preview", "transcribe", "tts", "chatgpt", "image", "moderation"].iter().any(|word| id.contains(word))
                })
                .collect();
            chat.sort_by(|a, b| a.id.cmp(&b.id));
            chat
        }
        "gemini" => models
            .into_iter()
            .map(|mut model| {
                model.id = model.id.trim_start_matches("models/").to_string();
                if model.name.starts_with("models/") {
                    model.name = model.id.clone();
                }
                model
            })
            .filter(|model| model.id.starts_with("gemini-") || model.id.starts_with("learnlm-"))
            .collect(),
        _ => models,
    }
}

/// The models an Ollama server has pulled (`<base>/api/tags`), for the model picker. Ollama
/// Cloud wants its API key as a bearer token (`buildAuthHeaders`); a model's parameter size goes
/// after its name, as "qwen3:8b (8.2B)".
pub async fn discover_ollama_models(base_url: &str, api_key: Option<&str>) -> Result<Vec<RemoteModel>, ProviderError> {
    let url = format!("{}/api/tags", catalog::normalize_ollama_base_url(base_url));
    let (_, value) = http::json_with_timeout(HttpRequest { url, headers: ollama_headers(api_key), body: None }, OLLAMA_TIMEOUT).await?;
    let models = value.get("models").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut found: Vec<RemoteModel> = models
        .iter()
        .filter_map(|model| {
            let id = model.get("model").or_else(|| model.get("name")).and_then(Value::as_str)?.to_string();
            let name = model.get("name").and_then(Value::as_str).unwrap_or(&id).to_string();
            let name = match model.pointer("/details/parameter_size").and_then(Value::as_str).filter(|size| !size.is_empty()) {
                Some(size) => format!("{name} ({size})"),
                None => name,
            };
            Some(RemoteModel { id, name, context_window: 0 })
        })
        .collect();
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found.dedup_by(|a, b| a.id == b.id);
    Ok(found)
}

/// How long Ollama's model list, capability and key probes wait (`OLLAMA_TIMEOUT_MS`).
pub const OLLAMA_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Ollama Cloud's address, where a key is checked when the server in use is local.
pub const OLLAMA_CLOUD_BASE_URL: &str = "https://ollama.com";

/// Local models known to call tools well enough to drive the agent.
pub const OLLAMA_TOOL_MODEL_SUGGESTIONS: [&str; 5] = ["qwen3-coder", "gpt-oss", "llama3.1", "llama3.3", "devstral"];

fn ollama_headers(api_key: Option<&str>) -> Vec<(String, String)> {
    api_key.filter(|key| !key.is_empty()).map(|key| vec![("authorization".to_string(), format!("Bearer {key}"))]).unwrap_or_default()
}

/// The `capabilities` Ollama reports for a model through `/api/show`, such as `tools` or
/// `vision`; `None` when the server is unreachable or too old to report them.
pub async fn ollama_model_capabilities(base_url: &str, model: &str, api_key: Option<&str>) -> Option<Vec<String>> {
    let url = format!("{}/api/show", catalog::normalize_ollama_base_url(base_url));
    let request = HttpRequest { url, headers: ollama_headers(api_key), body: Some(serde_json::json!({ "model": model })) };
    let (_, value) = http::json_with_timeout(request, OLLAMA_TIMEOUT).await.ok()?;
    let capabilities = value.get("capabilities")?.as_array()?;
    Some(capabilities.iter().filter_map(Value::as_str).map(str::to_string).collect())
}

/// Whether a model can call tools, from its `/api/show` capabilities (`getOllamaToolSupport`).
/// Older servers do not send the list, so a missing one is unknown and tools are tried anyway.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OllamaToolSupport {
    Supported,
    Unsupported,
    Unknown,
}

impl OllamaToolSupport {
    pub fn from_capabilities(capabilities: Option<&[String]>) -> Self {
        match capabilities {
            None => Self::Unknown,
            Some(list) if list.iter().any(|capability| capability == "tools") => Self::Supported,
            Some(_) => Self::Unsupported,
        }
    }
}

/// Why an Agent-mode turn with a model that cannot call tools stops (`getOllamaNoToolsMessage`).
pub fn ollama_no_tools_message(model: &str) -> String {
    let suggestions = OLLAMA_TOOL_MODEL_SUGGESTIONS.join(", ");
    format!(
        "The Ollama model \"{model}\" does not support tools, so the agent cannot read, create or edit files or run commands with it. Pick a tool-capable model such as {suggestions} (for example `ollama pull qwen3-coder`)."
    )
}

/// The note an Ask or Plan turn shows when it answers without tools (`getOllamaReadOnlyNoToolsNotice`).
pub fn ollama_read_only_no_tools_notice(model: &str) -> String {
    format!("{model} does not support tools, so it answered without reading the workspace.")
}

/// Whether the Ollama server answers `/api/tags`, with `api_key` for Ollama Cloud
/// (`checkOllamaConnection`); any network or auth failure is `false`.
pub async fn check_ollama_connection(base_url: &str, api_key: Option<&str>) -> bool {
    let url = format!("{}/api/tags", catalog::normalize_ollama_base_url(base_url));
    http::json_with_timeout(HttpRequest { url, headers: ollama_headers(api_key), body: None }, OLLAMA_TIMEOUT).await.is_ok()
}

/// Whether Ollama Cloud takes `api_key`: users only enter a key for the cloud, so it is checked
/// there unless `base_url` already is a cloud address (`OllamaProvider.validateApiKey`).
pub async fn validate_ollama_key(base_url: &str, api_key: &str) -> bool {
    let target = if crate::local::is_ollama_cloud_url(&catalog::normalize_ollama_base_url(base_url)) { base_url } else { OLLAMA_CLOUD_BASE_URL };
    check_ollama_connection(target, Some(api_key)).await
}

#[derive(Clone, Debug, PartialEq)]
pub struct RemoteModel {
    pub id: String,
    pub name: String,
    pub context_window: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;

    fn settings(provider: &str, model: &str) -> ProviderSettings {
        ProviderSettings { provider_id: provider.into(), model_id: model.into(), ..Default::default() }
    }

    #[test]
    fn discovers_the_models_ollama_pulled() {
        let server = crate::test_support::MockServer::start();
        server.push(crate::test_support::MockResponse::json(
            200,
            serde_json::json!({ "models": [{ "name": "qwen3:8b", "model": "qwen3:8b", "details": { "parameter_size": "8.2B" } }, { "name": "llama3.2:latest", "model": "llama3.2:latest" }] }),
        ));
        let models = futures::executor::block_on(discover_ollama_models(&format!("{}/", server.url), Some("tok"))).unwrap();
        assert_eq!(models.iter().map(|model| model.id.as_str()).collect::<Vec<_>>(), ["llama3.2:latest", "qwen3:8b"]);
        assert_eq!(models[1].name, "qwen3:8b (8.2B)");
        assert_eq!(server.requests()[0].path, "/api/tags");
        assert_eq!(server.requests()[0].header("authorization"), Some("Bearer tok"));
    }

    #[test]
    fn reads_ollama_capabilities_and_checks_keys() {
        let server = crate::test_support::MockServer::start();
        server.push(crate::test_support::MockResponse::json(200, serde_json::json!({ "capabilities": ["completion", "tools"] })));
        let capabilities = futures::executor::block_on(ollama_model_capabilities(&server.url, "qwen3-coder", Some("tok"))).unwrap();
        assert_eq!(OllamaToolSupport::from_capabilities(Some(&capabilities)), OllamaToolSupport::Supported);
        let request = &server.requests()[0];
        assert_eq!(request.path, "/api/show");
        assert_eq!(request.body["model"], "qwen3-coder");
        server.push(crate::test_support::MockResponse::json(200, serde_json::json!({ "modelfile": "" })));
        assert_eq!(futures::executor::block_on(ollama_model_capabilities(&server.url, "llama3", None)), None);
        assert_eq!(OllamaToolSupport::from_capabilities(None), OllamaToolSupport::Unknown);
        assert_eq!(OllamaToolSupport::from_capabilities(Some(&["completion".to_string(), "vision".to_string()])), OllamaToolSupport::Unsupported);
        assert!(ollama_no_tools_message("phi").contains("qwen3-coder, gpt-oss"));

        server.push(crate::test_support::MockResponse::json(200, serde_json::json!({ "models": [] })));
        assert!(futures::executor::block_on(check_ollama_connection(&server.url, Some("k"))));
        server.push(crate::test_support::MockResponse::json(401, serde_json::json!({ "error": "unauthorized" })));
        assert!(!futures::executor::block_on(check_ollama_connection(&server.url, Some("k"))));
    }

    #[test]
    fn resolves_keys_endpoints_and_sign_in() {
        let secrets = MemorySecrets::with(&[("ai_token_anthropic", "sk-a"), ("ai_token_openrouter", "sk-o")]);
        let anthropic = Connection::resolve(&settings("anthropic", "claude-sonnet-5"), &secrets).unwrap();
        assert_eq!(anthropic.url, "https://api.anthropic.com/v1/messages");
        assert!(anthropic.headers().iter().any(|(name, value)| name == "x-api-key" && value == "sk-a"));
        assert_eq!(anthropic.context_window(), 1_000_000);

        let ollama = Connection::resolve(
            &ProviderSettings { ollama_base_url: "http://gpu:11434/".into(), ..settings("ollama", "qwen3:8b") },
            &secrets,
        )
        .unwrap();
        assert_eq!(ollama.url, "http://gpu:11434/v1/chat/completions");
        assert!(ollama.supports_images());

        let custom = Connection::resolve(
            &ProviderSettings { custom_base_url: "https://llm.local/v1".into(), custom_model_id: "mine".into(), ..settings("custom", "") },
            &secrets,
        )
        .unwrap();
        assert_eq!((custom.url.as_str(), custom.model.as_str()), ("https://llm.local/v1/chat/completions", "mine"));
        assert!(matches!(Connection::resolve(&settings("custom", "x"), &secrets), Err(ConnectError::NotConfigured(_))));

        // Only fails when the user's environment has no key either.
        if std::env::var("XAI_API_KEY").is_err() {
            assert!(matches!(Connection::resolve(&settings("grok", "grok-4.6"), &secrets), Err(ConnectError::MissingKey { .. })));
        }
        if std::env::var(secrets::AUTH_TOKEN_ENV).is_err() {
            assert_eq!(Connection::resolve(&settings("athas", "auto"), &secrets).unwrap_err(), ConnectError::NotSignedIn);
        }
        let signed_in = MemorySecrets::with(&[(secrets::AUTH_TOKEN_ACCOUNT, "tok")]);
        let athas = Connection::resolve(&settings("athas", "auto"), &signed_in).unwrap();
        let headers = athas.headers();
        assert!(headers.iter().any(|(name, value)| name == "authorization" && value == "Bearer tok"));
        let keys: Vec<_> = (0..2)
            .map(|_| athas.headers().into_iter().find(|(name, _)| name == "idempotency-key").unwrap().1)
            .collect();
        assert_ne!(keys[0], keys[1]);
        assert!(format!("{athas:?}").contains("athas") && !format!("{athas:?}").contains("tok\""));
    }
}
