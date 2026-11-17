//! Inline edit (Cmd-K / `editor.inlineEdit`): the selected text and an instruction in, the
//! replacement out. The editor sends an [`InlineEditRequest`], shows the replacement as it streams
//! and applies it when the user accepts.
//!
//! Ported from Athas's `intelligence/services/intelligence-text-service.ts` (`requestInlineEdit`):
//! Athas's hosted endpoint (`/api/ai/inline-edit`) for the `athas` provider, otherwise one chat
//! request to the configured model, streamed.

use std::time::Duration;

use futures::{FutureExt as _, StreamExt as _};
use serde_json::{Value, json};

use crate::{
    completion::{CompletionError, ContextSnippet},
    connection::Connection,
    http::{self, HttpRequest},
    message::{Event, FinishReason, Message, Request},
    secrets::SecretStore,
};

pub const DEFAULT_INSTRUCTION: &str = "Improve this code while preserving behavior.";
/// Text before and after the selection sent as context, at most; the hosted endpoint takes no
/// more, and the selection itself may not be longer.
pub const CONTEXT_CHARS: usize = 12_000;
pub const TIMED_OUT: &str = "The model took too long to respond. Try again.";

/// Which AI feature a text request is for (`InlineEditRequest["feature"]`): each has its own
/// instructions, output limit and timeout, and its own model in the AI settings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextFeature {
    #[default]
    InlineEdit,
    CommitMessage,
    GithubDraft,
    ChatTitle,
    TerminalTitle,
    ReviewSummary,
    ReviewInsight,
    SessionOverview,
}

impl TextFeature {
    /// The task's id in the AI settings (`intelligence.rs TASK_OVERRIDES`).
    pub fn id(self) -> &'static str {
        match self {
            TextFeature::InlineEdit => "inline-edit",
            TextFeature::CommitMessage => "commit-message",
            TextFeature::GithubDraft => "github-draft",
            TextFeature::ChatTitle => "chat-title",
            TextFeature::TerminalTitle => "terminal-title",
            TextFeature::ReviewSummary => "review-summary",
            TextFeature::ReviewInsight => "review-insight",
            TextFeature::SessionOverview => "session-overview",
        }
    }

    /// How long the model may take before the request gives up (`DEFAULT_TIMEOUT_MS`).
    pub fn timeout(self) -> Duration {
        Duration::from_secs(match self {
            TextFeature::InlineEdit | TextFeature::GithubDraft => 60,
            TextFeature::CommitMessage | TextFeature::SessionOverview => 45,
            TextFeature::ChatTitle | TextFeature::TerminalTitle => 20,
            TextFeature::ReviewSummary | TextFeature::ReviewInsight => 90,
        })
    }

    fn max_tokens(self) -> u64 {
        match self {
            TextFeature::ChatTitle | TextFeature::TerminalTitle => 128,
            TextFeature::SessionOverview => 1024,
            _ => 4096,
        }
    }

    fn instructions(self) -> &'static str {
        match self {
            TextFeature::InlineEdit => {
                "Rewrite only the selected code. Return replacement code without markdown fences or explanations. Preserve the surrounding code."
            }
            TextFeature::CommitMessage => {
                "Write a Git commit message from the supplied staged diff. Follow the requested format and repository style. Return only the message."
            }
            TextFeature::GithubDraft => {
                "Write the requested GitHub draft using the supplied context and output format. Do not claim unperformed tests or actions."
            }
            TextFeature::ChatTitle => {
                "Write a short concrete title for the conversation. Return only the title, not an answer to the conversation."
            }
            TextFeature::TerminalTitle => "Write a short concrete title for the terminal task. Return only the title.",
            TextFeature::ReviewSummary => {
                "Explain the supplied code-review changes, grounded in the patch. Follow the requested JSON format without markdown fences."
            }
            TextFeature::SessionOverview => {
                "Summarize the supplied coding-agent session for someone catching up on it. Be brief and concrete, ground every point in the session, and follow the requested JSON format without markdown fences."
            }
            TextFeature::ReviewInsight => {
                "Review the supplied code changes for the requested insight. Ground claims in the patch and follow the requested JSON format."
            }
        }
    }
}

/// What the editor sends for an inline edit.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct InlineEditRequest {
    pub path: String,
    pub language_id: String,
    /// The selected text the model rewrites.
    pub selection_text: String,
    /// The buffer's text before the selection; only its last [`CONTEXT_CHARS`] are sent.
    pub before: String,
    /// The buffer's text after the selection; only its first [`CONTEXT_CHARS`] are sent.
    pub after: String,
    /// What the user asked for; empty asks for a general improvement.
    pub instruction: String,
    pub feature: TextFeature,
    /// Summaries of other open files, such as modules this file imports.
    pub related_files: Vec<ContextSnippet>,
}

impl InlineEditRequest {
    fn instruction(&self) -> &str {
        if self.instruction.trim().is_empty() { DEFAULT_INSTRUCTION } else { self.instruction.trim() }
    }

    fn body(&self) -> Value {
        let mut body = json!({
            "file": self.path,
            "language": self.language_id,
            "instruction": self.instruction(),
            "before": tail(&self.before, CONTEXT_CHARS),
            "selection": self.selection_text,
            "after": head(&self.after, CONTEXT_CHARS),
        });
        if !self.related_files.is_empty() {
            body["relatedFiles"] = json!(self.related_files);
        }
        body
    }
}

fn tail(text: &str, chars: usize) -> &str {
    let start = text.char_indices().rev().nth(chars.saturating_sub(1)).map_or(0, |(index, _)| index);
    if text.chars().count() <= chars { text } else { &text[start..] }
}

fn head(text: &str, chars: usize) -> &str {
    let end = text.char_indices().nth(chars).map_or(text.len(), |(index, _)| index);
    &text[..end]
}

/// Asks a model to rewrite a selection. Cheap to clone.
#[derive(Clone, Debug)]
pub struct InlineEditor {
    connection: Connection,
}

impl InlineEditor {
    /// The editor for the AI settings' model (`aiProviderId`, `aiModelId`, ...), refused when the
    /// team's settings are unavailable or the organization does not allow personal keys
    /// ([`crate::gate`]), so every AI task (commit messages, titles, drafts) checks them.
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

    /// The replacement for the selection. `on_text` gets the replacement so far each time more
    /// arrives (once, at the end, for Athas's hosted endpoint, which does not stream). Drop the
    /// future to cancel.
    pub async fn edit(&self, request: &InlineEditRequest, mut on_text: impl FnMut(&str)) -> Result<String, CompletionError> {
        if request.selection_text.chars().count() > CONTEXT_CHARS {
            return Err(CompletionError::Failed(format!("The selection is too large. Select at most {CONTEXT_CHARS} characters.")));
        }
        if !self.connection.provider.is_hosted() && self.connection.model.trim().is_empty() {
            return Err(CompletionError::Failed("Choose a model for this AI feature.".into()));
        }
        let text = if self.connection.provider.is_hosted() {
            let text = self.hosted(request).await?;
            on_text(&text);
            text
        } else {
            self.chat(request, &mut on_text).await?
        };
        Ok(clean(&text))
    }

    /// [`Self::edit`], given up with [`TIMED_OUT`] once `timer` fires (the feature's
    /// [`TextFeature::timeout`] on the caller's executor).
    pub async fn edit_within(
        &self,
        request: &InlineEditRequest,
        timer: impl std::future::Future<Output = ()>,
        on_text: impl FnMut(&str),
    ) -> Result<String, CompletionError> {
        let work = std::pin::pin!(self.edit(request, on_text).fuse());
        let timer = std::pin::pin!(timer.fuse());
        match futures::future::select(timer, work).await {
            futures::future::Either::Left(_) => Err(CompletionError::Failed(TIMED_OUT.into())),
            futures::future::Either::Right((result, _)) => result,
        }
    }

    async fn hosted(&self, request: &InlineEditRequest) -> Result<String, CompletionError> {
        let mut body = json!({
            "feature": request.feature.id(),
            "filePath": request.path,
            "languageId": request.language_id,
            "instruction": request.instruction(),
            "beforeSelection": tail(&request.before, CONTEXT_CHARS),
            "selectedText": request.selection_text,
            "afterSelection": head(&request.after, CONTEXT_CHARS),
        });
        if !request.related_files.is_empty() {
            body["relatedFiles"] = json!(request.related_files);
        }
        if self.connection.model != "auto" {
            body["model"] = json!(self.connection.model);
        }
        let url = self.connection.url.replace("/chat/completions", "/inline-edit");
        let (_, value) = http::json(HttpRequest { url, headers: self.connection.headers(), body: Some(body) }).await?;
        Ok(value.get("editedText").and_then(Value::as_str).unwrap_or_default().to_string())
    }

    async fn chat(&self, request: &InlineEditRequest, on_text: &mut impl FnMut(&str)) -> Result<String, CompletionError> {
        let chat = Request {
            system: request.feature.instructions().to_string(),
            messages: vec![Message::user(request.body().to_string())],
            tools: Vec::new(),
            max_tokens: request.feature.max_tokens(),
            temperature: Some(0.2),
        };
        let mut stream = self.connection.stream(&chat).await?;
        let mut text = String::new();
        while let Some(event) = stream.next().await {
            match event? {
                Event::Text(delta) => {
                    text.push_str(&delta);
                    on_text(&clean(&text));
                }
                Event::Finish(FinishReason::Length) => {
                    return Err(CompletionError::Failed("The result exceeded its limit. Try a smaller selection.".into()));
                }
                Event::Finish(FinishReason::Refusal) => return Err(CompletionError::Failed("The model refused the edit.".into())),
                _ => {}
            }
        }
        Ok(text)
    }
}

/// Strips a Markdown fence the model wrapped its answer in, also one still streaming in.
pub fn clean(text: &str) -> String {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else { return text.to_string() };
    let Some((_, body)) = rest.split_once('\n') else { return String::new() };
    let body = body.strip_suffix("```").unwrap_or(body);
    body.strip_suffix('\n').unwrap_or(body).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        catalog,
        test_support::{MockResponse, MockServer},
    };

    #[test]
    fn fences_are_stripped_while_streaming_and_at_the_end() {
        assert_eq!(clean("```rust\nlet a = 1;\n```"), "let a = 1;");
        assert_eq!(clean("```rust\nlet a"), "let a");
        assert_eq!(clean("```"), "");
        assert_eq!(clean("  plain\n"), "  plain\n");
    }

    #[test]
    fn context_is_cut_around_the_selection() {
        assert_eq!(tail("abcdef", 3), "def");
        assert_eq!(tail("ab", 3), "ab");
        assert_eq!(head("abcdef", 2), "ab");
        assert_eq!(tail("ééé", 2), "éé");
    }

    #[test]
    fn streams_the_replacement_from_a_chat_model() {
        let server = MockServer::start();
        server.push(MockResponse::openai(&[
            json!({ "choices": [{ "index": 0, "delta": { "content": "```rust\nfn add(a: i32, b: i32) -> i32 {" } }] }),
            json!({ "choices": [{ "index": 0, "delta": { "content": " a + b }\n```" } }] }),
            json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }] }),
        ]));
        let provider = catalog::provider("openai").unwrap();
        let editor = InlineEditor::new(Connection::new(provider, "gpt-test", format!("{}/v1/chat/completions", server.url), Some("sk".into())));
        let request = InlineEditRequest {
            path: "src/lib.rs".into(),
            language_id: "rust".into(),
            selection_text: "fn add(a, b) { a + b }".into(),
            before: "// math\n".into(),
            after: "\n".into(),
            instruction: "Add types".into(),
            related_files: vec![ContextSnippet { file_path: "src/math.rs".into(), snippet: "pub fn sub".into() }],
            ..Default::default()
        };
        let mut partials = Vec::new();
        let result = futures::executor::block_on(editor.edit(&request, |text| partials.push(text.to_string()))).unwrap();
        assert_eq!(result, "fn add(a: i32, b: i32) -> i32 { a + b }");
        assert_eq!(partials.first().map(String::as_str), Some("fn add(a: i32, b: i32) -> i32 {"));
        let sent = &server.requests()[0];
        let user = sent.body["messages"].as_array().unwrap().iter().find(|message| message["role"] == "user").unwrap();
        let content: Value = serde_json::from_str(user["content"].as_str().unwrap()).unwrap();
        assert_eq!(content["instruction"], "Add types");
        assert_eq!(content["selection"], "fn add(a, b) { a + b }");
        assert_eq!(content["relatedFiles"][0]["filePath"], "src/math.rs");
        assert!(sent.body.to_string().contains("Rewrite only the selected code"));
    }

    #[test]
    fn each_feature_has_its_instructions_limit_and_timeout() {
        assert_eq!(TextFeature::CommitMessage.timeout(), Duration::from_secs(45));
        assert_eq!(TextFeature::ReviewSummary.timeout(), Duration::from_secs(90));
        assert_eq!(TextFeature::ChatTitle.max_tokens(), 128);
        assert!(TextFeature::CommitMessage.instructions().contains("commit message"));
        assert_eq!(TextFeature::default().id(), "inline-edit");
    }

    #[test]
    fn a_missing_model_or_a_slow_one_is_reported() {
        let provider = catalog::provider("openai").unwrap();
        let editor = InlineEditor::new(Connection::new(provider, " ", "http://127.0.0.1:9/v1/chat/completions", None));
        let request = InlineEditRequest { selection_text: "x".into(), ..Default::default() };
        let error = futures::executor::block_on(editor.edit(&request, |_| {})).unwrap_err();
        assert_eq!(error.to_string(), "Choose a model for this AI feature.");
        let editor = InlineEditor::new(Connection::new(provider, "m", "http://127.0.0.1:9/v1/chat/completions", None));
        let error = futures::executor::block_on(editor.edit_within(&request, futures::future::ready(()), |_| {})).unwrap_err();
        assert_eq!(error.to_string(), TIMED_OUT);
    }

    #[test]
    fn oversized_selections_are_refused_before_any_request() {
        let provider = catalog::provider("openai").unwrap();
        let editor = InlineEditor::new(Connection::new(provider, "m", "http://127.0.0.1:9/v1/chat/completions", None));
        let request = InlineEditRequest { selection_text: "x".repeat(CONTEXT_CHARS + 1), ..Default::default() };
        assert!(matches!(futures::executor::block_on(editor.edit(&request, |_| {})), Err(CompletionError::Failed(_))));
    }
}
