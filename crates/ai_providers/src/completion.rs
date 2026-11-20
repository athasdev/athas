//! Inline completion ("Tab autocomplete", `aiCompletion`): the text before and after the cursor
//! in, ghost text out. The editor debounces typing, sends a [`CompletionRequest`] and shows what
//! comes back after the cursor until the user accepts it with Tab or types on.
//!
//! Ported from Athas's `intelligence/services/intelligence-completion-service.ts` and
//! `intelligence-text-service.ts`: Athas's hosted endpoint (`/api/ai/autocomplete`) for the
//! `athas` provider, otherwise one short chat request to the configured model.

use futures::StreamExt as _;
use serde::Serialize;
use serde_json::{Value, json};

use crate::{
    catalog,
    connection::Connection,
    http::{self, HttpRequest, ProviderError},
    message::{Event, Message, Request},
    secrets::SecretStore,
};

/// How long typing should pause before the editor asks for a completion.
pub const DEBOUNCE_MS: u64 = 350;
/// Text before the cursor sent as context.
pub const PREFIX_CHARS: usize = 12_000;
/// Text after the cursor sent as context.
pub const SUFFIX_CHARS: usize = 4_000;
const MAX_TOKENS: u64 = 256;

const INSTRUCTIONS: &str = "Complete the code at the cursor between before and after. Return only the new text to insert, preserving indentation. The completion may span several lines when the next logical step does, such as finishing a function body. Use recentEdits, diagnostics and relatedFiles (summaries of other open files, such as modules this file imports), when present, as hints for what the user is doing and which APIs exist. Do not repeat surrounding code, use markdown fences, or explain. Return nothing when a completion is not useful.";

/// What the editor knows at the cursor.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRequest {
    pub file_path: String,
    pub language_id: String,
    /// The buffer's text before the cursor; only its last [`PREFIX_CHARS`] are sent.
    pub before_cursor: String,
    /// The buffer's text after the cursor; only its first [`SUFFIX_CHARS`] are sent.
    pub after_cursor: String,
    /// The lines around the user's latest edits elsewhere, oldest first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub recent_edits: Vec<ContextSnippet>,
    /// Errors and warnings near the cursor, closest first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<NearbyDiagnostic>,
    /// Summaries of other open files, such as modules this file imports.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub related_files: Vec<ContextSnippet>,
}

/// A short piece of another place in the code (`AutocompleteRecentEdit`, `AutocompleteRelatedFile`).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnippet {
    pub file_path: String,
    pub snippet: String,
}

/// A diagnostic near the cursor (`AutocompleteDiagnostic`), its line 1-based.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct NearbyDiagnostic {
    pub line: u32,
    pub severity: String,
    pub message: String,
}

/// Why no completion came, so the editor can pause instead of retrying on every keystroke.
#[derive(Clone, Debug, PartialEq)]
pub enum CompletionError {
    /// Sign in to Athas, or add the provider's key: pause until settings change.
    NeedsAccount(String),
    /// Out of Athas credit: pause.
    NotAllowed(String),
    /// Athas says the organization turned Tab completion off (a hosted 403): pause.
    Disabled(String),
    /// Anything else; the next request may work.
    Failed(String),
}

impl std::fmt::Display for CompletionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CompletionError::NeedsAccount(message) | CompletionError::NotAllowed(message) | CompletionError::Disabled(message) | CompletionError::Failed(message) => {
                f.write_str(message)
            }
        }
    }
}

impl From<ProviderError> for CompletionError {
    fn from(error: ProviderError) -> Self {
        match error.status {
            Some(401) => CompletionError::NeedsAccount(error.message),
            Some(402 | 403) => CompletionError::NotAllowed(error.message),
            _ => CompletionError::Failed(error.message),
        }
    }
}

impl CompletionError {
    /// Tab completion's reading of a failed request (`getPauseReason`): a 401 wants the account
    /// or the key, a 402 Athas credit (or, from a provider, its key); only Athas enforces
    /// organization policy, so a provider's own 403 is an ordinary failure.
    pub fn from_provider(error: ProviderError, hosted: bool) -> Self {
        match (error.status, hosted) {
            (Some(401), _) | (Some(402), false) => CompletionError::NeedsAccount(error.message),
            (Some(402), true) => CompletionError::NotAllowed(error.message),
            (Some(403), true) => CompletionError::Disabled(error.message),
            _ => CompletionError::Failed(error.message),
        }
    }
}

/// Asks a model for ghost text. Cheap to clone; one per editor, rebuilt when the AI settings
/// change.
#[derive(Clone, Debug)]
pub struct InlineCompletionProvider {
    connection: Connection,
}

impl InlineCompletionProvider {
    /// The provider for the autocomplete settings (`aiAutocompleteProvider`,
    /// `aiAutocompleteModelId`, ...), with keys from `secrets`; refused when the team's settings
    /// are unavailable or the organization turns Tab completion or personal keys off
    /// ([`crate::gate`]).
    pub fn resolve(settings: &crate::ProviderSettings, secrets: &dyn SecretStore) -> Result<Self, CompletionError> {
        crate::gate::check_connection(&settings.provider_id).map_err(|message| CompletionError::Disabled(message.to_string()))?;
        Connection::resolve(settings, secrets).map(Self::new).map_err(|error| CompletionError::NeedsAccount(error.to_string()))
    }

    pub fn new(connection: Connection) -> Self {
        Self { connection }
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// The text to show after the cursor; empty when the model has nothing useful. Drop the
    /// future to cancel (the editor does when the user types on).
    pub async fn complete(&self, request: &CompletionRequest) -> Result<String, CompletionError> {
        let request = trimmed(request);
        let hosted = self.connection.provider.is_hosted();
        let text = if hosted { self.hosted(&request).await } else { self.chat(&request).await };
        let text = text.map_err(|error| CompletionError::from_provider(error, hosted))?;
        Ok(clean(&text, &request))
    }

    async fn hosted(&self, request: &CompletionRequest) -> Result<String, ProviderError> {
        let mut body = serde_json::to_value(request).unwrap_or_default();
        if self.connection.model != "auto" {
            body["model"] = json!(self.connection.model);
        }
        let url = self.connection.url.replace("/chat/completions", "/autocomplete");
        let (_, value) = http::json(HttpRequest { url, headers: self.connection.headers(), body: Some(body) }).await?;
        Ok(value.get("completion").and_then(Value::as_str).unwrap_or_default().to_string())
    }

    async fn chat(&self, request: &CompletionRequest) -> Result<String, ProviderError> {
        let content = json!({
            "file": request.file_path,
            "language": request.language_id,
            "before": request.before_cursor,
            "after": request.after_cursor,
            "recentEdits": request.recent_edits,
            "diagnostics": request.diagnostics,
            "relatedFiles": request.related_files,
        });
        let chat = Request {
            system: INSTRUCTIONS.to_string(),
            messages: vec![Message::user(content.to_string())],
            tools: Vec::new(),
            max_tokens: MAX_TOKENS,
            temperature: Some(0.2),
        };
        let mut stream = self.connection.stream(&chat).await?;
        let mut text = String::new();
        while let Some(event) = stream.next().await {
            if let Event::Text(delta) = event? {
                text.push_str(&delta);
            }
        }
        Ok(text)
    }
}

fn trimmed(request: &CompletionRequest) -> CompletionRequest {
    let before_start = request.before_cursor.char_indices().rev().nth(PREFIX_CHARS.saturating_sub(1)).map_or(0, |(index, _)| index);
    let after_end = request.after_cursor.char_indices().nth(SUFFIX_CHARS).map_or(request.after_cursor.len(), |(index, _)| index);
    CompletionRequest {
        before_cursor: request.before_cursor[before_start..].to_string(),
        after_cursor: request.after_cursor[..after_end].to_string(),
        ..request.clone()
    }
}

/// Strips a Markdown fence the model wrapped its answer in, and text that only repeats what
/// already follows the cursor.
fn clean(text: &str, request: &CompletionRequest) -> String {
    let trimmed = text.trim();
    let unfenced = trimmed
        .strip_prefix("```")
        .and_then(|rest| rest.split_once('\n'))
        .and_then(|(_, body)| body.strip_suffix("```"))
        .map(|body| body.strip_suffix('\n').unwrap_or(body));
    let text = unfenced.unwrap_or(text);
    let after = request.after_cursor.trim_start();
    if !text.trim().is_empty() && !after.is_empty() && after.starts_with(text.trim()) {
        return String::new();
    }
    text.to_string()
}

/// The `aiAutocomplete*` settings as provider settings.
pub fn autocomplete_settings(
    provider_id: &str,
    model_id: &str,
    custom_base_url: &str,
    custom_model_id: &str,
    ollama_base_url: &str,
) -> crate::ProviderSettings {
    crate::ProviderSettings {
        provider_id: if provider_id.is_empty() { catalog::ATHAS.to_string() } else { provider_id.to_string() },
        model_id: model_id.to_string(),
        custom_base_url: custom_base_url.to_string(),
        custom_model_id: custom_model_id.to_string(),
        ollama_base_url: ollama_base_url.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_context_is_cut_at_the_cursor() {
        let request = CompletionRequest {
            before_cursor: format!("{}é", "a".repeat(PREFIX_CHARS + 10)),
            after_cursor: "b".repeat(SUFFIX_CHARS + 10),
            ..Default::default()
        };
        let trimmed = trimmed(&request);
        assert_eq!(trimmed.before_cursor.chars().count(), PREFIX_CHARS);
        assert!(trimmed.before_cursor.ends_with('é'));
        assert_eq!(trimmed.after_cursor.len(), SUFFIX_CHARS);
    }

    #[test]
    fn fences_and_repeats_are_cleaned() {
        let request = CompletionRequest { after_cursor: "\n}\n".into(), ..Default::default() };
        assert_eq!(clean("```rust\n    x + 1\n```", &request), "    x + 1");
        assert_eq!(clean("}", &request), "");
        assert_eq!(clean("  return 1;", &request), "  return 1;");
    }
}
