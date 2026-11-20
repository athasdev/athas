//! Model providers for Athas's built-in agent and inline completion: Anthropic's Messages API and
//! OpenAI-compatible chat completions (OpenAI, OpenRouter, Ollama, Mistral, xAI, DeepSeek, Qwen,
//! Gemini's OpenAI endpoint, Vercel's gateway, a custom endpoint and Athas's hosted models),
//! streamed, with tool calls, keys from the OS keychain, and the agent loop that drives them.
//!
//! Ported from Athas's `features/ai/services/providers`, `features/ai/intelligence` and
//! `crates/ai/src/intelligence.rs`. Nothing here depends on GPUI: requests run on threads of
//! their own and stream back over channels, so any executor can await them.

pub mod agent;
pub mod anthropic;
pub mod cancel;
pub mod catalog;
pub mod completion;
pub mod connection;
pub mod external;
pub mod gate;
pub mod http;
pub mod inline_edit;
pub mod local;
pub mod message;
pub mod openai;
pub mod secrets;
pub mod sse;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use agent::{AgentConfig, AgentEvent, AgentHost, RequestLimits, StepLimits, fit_request_to_limits, StopReason, TurnOutcome, run_turn};
pub use cancel::CancelToken;
pub use catalog::{Model, PROVIDERS, Provider, WireFormat};
pub use completion::{CompletionError, CompletionRequest, ContextSnippet, InlineCompletionProvider, NearbyDiagnostic};
pub use connection::{ConnectError, Connection, EventStream, ProviderSettings, OllamaToolSupport, RemoteModel, chat_models, discover_ollama_models};
pub use gate::{ConnectionGate, GateTask, check_connection, check_task_connection, connection_gate, set_connection_gate};
pub use external::{ExternalProvider, ExternalProviders, external_providers, set_external_providers};
pub use inline_edit::{InlineEditRequest, InlineEditor, TextFeature};
pub use http::ProviderError;
pub use message::{Event, FinishReason, Message, Part, Request, Role, ToolCall, ToolResult, ToolSpec, Usage, current_image_count, fit_hosted_images, images_omitted_notice, strip_images};
pub use secrets::{Keychain, MemorySecrets, SecretStore};

#[cfg(test)]
mod tests;
