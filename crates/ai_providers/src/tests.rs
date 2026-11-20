//! End-to-end tests against a local server that answers like the providers do.

use std::sync::{Arc, Mutex};

use futures::{FutureExt as _, StreamExt as _, executor::block_on, future::BoxFuture};
use serde_json::json;

use crate::{
    agent::{AgentConfig, AgentEvent, AgentHost, StepLimits, StopReason, run_turn},
    cancel::CancelToken,
    catalog,
    completion::{CompletionError, CompletionRequest, InlineCompletionProvider},
    http::ProviderError,
    connection::Connection,
    message::{Event, FinishReason, Message, Part, Request, Role, ToolCall, ToolResult, ToolSpec},
    test_support::{MockResponse, MockServer},
};

fn openai_connection(server: &MockServer) -> Connection {
    Connection::new(catalog::provider("openrouter").unwrap(), "test/model", format!("{}/v1/chat/completions", server.url), Some("sk-test".into()))
}

#[derive(Default)]
struct RecordingHost {
    events: Mutex<Vec<AgentEvent>>,
    calls: Mutex<Vec<ToolCall>>,
    cancel_on_call: Option<CancelToken>,
}

impl AgentHost for RecordingHost {
    fn event(&self, event: AgentEvent) {
        self.events.lock().unwrap().push(event);
    }

    fn call_tool(&self, call: ToolCall) -> BoxFuture<'static, ToolResult> {
        self.calls.lock().unwrap().push(call.clone());
        if let Some(cancel) = &self.cancel_on_call {
            cancel.cancel();
        }
        async move { ToolResult::ok(format!("listed {}", call.input["path"].as_str().unwrap_or("."))) }.boxed()
    }
}

fn config(max_steps: usize) -> AgentConfig {
    AgentConfig {
        system: "You are a test".into(),
        tools: vec![ToolSpec { name: "list_files".into(), description: "List".into(), input_schema: json!({ "type": "object" }) }],
        max_steps,
        max_tokens: 1000,
        limits: StepLimits::for_provider("openrouter"),
    }
}

#[test]
fn the_agent_runs_tools_until_the_model_answers() {
    let server = MockServer::start();
    server.push(MockResponse::openai_tool_call("c1", "list_files", json!({ "path": "src" })));
    server.push(MockResponse::openai(&[
        json!({ "choices": [{ "index": 0, "delta": { "content": "Two files." } }] }),
        json!({ "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }] }),
        json!({ "choices": [], "usage": { "prompt_tokens": 30, "completion_tokens": 3, "cost": 0.5 } }),
    ]));
    let connection = openai_connection(&server);
    let host = RecordingHost::default();
    let mut history = vec![Message::user("What is in src?")];
    let outcome = block_on(run_turn(&connection, &config(5), &mut history, &host, &CancelToken::default())).unwrap();

    assert_eq!(outcome.stop, StopReason::EndTurn);
    assert_eq!(outcome.steps, 2);
    assert_eq!(outcome.usage.input_tokens, 50);
    assert_eq!(outcome.cost, Some(0.5));
    assert_eq!(host.calls.lock().unwrap()[0].name, "list_files");
    assert_eq!(history.len(), 4);
    assert_eq!(history[1].role, Role::Assistant);
    assert!(matches!(&history[2].content[0], Part::ToolResult { content, .. } if content == "listed src"));
    assert_eq!(history[3], Message::assistant("Two files."));
    assert!(host.events.lock().unwrap().contains(&AgentEvent::Text("Two files.".into())));

    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].path, "/v1/chat/completions");
    assert_eq!(requests[0].header("authorization"), Some("Bearer sk-test"));
    assert_eq!(requests[0].body["usage"]["include"], true, "OpenRouter is asked for the cost");
    let second = requests[1].body["messages"].as_array().unwrap();
    assert_eq!(second.last().unwrap()["role"], "tool");
    assert_eq!(second.last().unwrap()["content"], "listed src");
}

#[test]
fn the_step_budget_stops_a_turn_that_still_wants_tools() {
    let server = MockServer::start();
    server.push(MockResponse::openai_tool_call("c1", "list_files", json!({})));
    let host = RecordingHost::default();
    let mut history = vec![Message::user("Loop")];
    let outcome = block_on(run_turn(&openai_connection(&server), &config(1), &mut history, &host, &CancelToken::default())).unwrap();
    assert_eq!(outcome.stop, StopReason::MaxSteps);
    assert_eq!(history.last().unwrap().role, Role::Tool, "every call keeps its result");
}

#[test]
fn stopping_during_a_tool_ends_the_turn_with_a_valid_history() {
    let server = MockServer::start();
    server.push(MockResponse::openai_tool_call("c1", "list_files", json!({})));
    let cancel = CancelToken::default();
    let host = RecordingHost { cancel_on_call: Some(cancel.clone()), ..Default::default() };
    let mut history = vec![Message::user("Go")];
    let outcome = block_on(run_turn(&openai_connection(&server), &config(5), &mut history, &host, &cancel)).unwrap();
    assert_eq!(outcome.stop, StopReason::Cancelled);
    assert_eq!(server.requests().len(), 1);
    assert_eq!(history.last().unwrap().role, Role::Tool);
}

#[test]
fn provider_errors_carry_their_message() {
    let server = MockServer::start();
    server.push(MockResponse::json(401, json!({ "error": { "message": "Invalid API key" } })));
    let host = RecordingHost::default();
    let mut history = vec![Message::user("Hi")];
    let error = block_on(run_turn(&openai_connection(&server), &config(5), &mut history, &host, &CancelToken::default())).unwrap_err();
    assert_eq!(error.status, Some(401));
    assert_eq!(error.message, "OpenRouter rejected the API key: Invalid API key");
}

#[test]
fn anthropic_streams_end_to_end() {
    let server = MockServer::start();
    server.push(MockResponse::sse(&[
        json!({ "type": "message_start", "message": { "usage": { "input_tokens": 9, "output_tokens": 1 } } }),
        json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }),
        json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "Hello" } }),
        json!({ "type": "content_block_stop", "index": 0 }),
        json!({ "type": "message_delta", "delta": { "stop_reason": "end_turn" }, "usage": { "output_tokens": 4 } }),
        json!({ "type": "message_stop" }),
    ]));
    let connection =
        Connection::new(catalog::provider("anthropic").unwrap(), "claude-haiku-4-5", format!("{}/v1/messages", server.url), Some("sk-ant".into()));
    let request = Request { system: "Hi".into(), messages: vec![Message::user("Say hello")], max_tokens: 64, ..Default::default() };
    let events: Vec<Event> = block_on(async { connection.stream(&request).await.unwrap().map(Result::unwrap).collect().await });
    assert_eq!(events[0], Event::Text("Hello".into()));
    assert_eq!(events.last(), Some(&Event::Finish(FinishReason::Stop)));
    let sent = &server.requests()[0];
    assert_eq!(sent.header("x-api-key"), Some("sk-ant"));
    assert_eq!(sent.header("anthropic-version"), Some(crate::anthropic::API_VERSION));
    assert_eq!(sent.body["model"], "claude-haiku-4-5");
    assert_eq!(sent.body["stream"], true);
}

#[test]
fn inline_completion_through_a_chat_model_and_athas() {
    let server = MockServer::start();
    server.push(MockResponse::openai_text("```rust\na + b\n```"));
    let provider = InlineCompletionProvider::new(openai_connection(&server));
    let request = CompletionRequest {
        file_path: "src/lib.rs".into(),
        language_id: "rust".into(),
        before_cursor: "fn add(a: i32, b: i32) -> i32 {\n    ".into(),
        after_cursor: "\n}".into(),
        ..Default::default()
    };
    assert_eq!(block_on(provider.complete(&request)).unwrap(), "a + b");
    let sent = &server.requests()[0];
    assert_eq!(sent.body["max_tokens"], 256);
    assert!(sent.body["messages"][1]["content"].as_str().unwrap().contains("\"before\""));

    let athas = Connection::new(catalog::provider(catalog::ATHAS).unwrap(), "auto", format!("{}/api/ai/chat/completions", server.url), Some("tok".into()));
    let hosted = InlineCompletionProvider::new(athas);
    server.push(MockResponse::json(200, json!({ "completion": "a + b" })));
    assert_eq!(block_on(hosted.complete(&request)).unwrap(), "a + b");
    let sent = &server.requests()[1];
    assert_eq!(sent.path, "/api/ai/autocomplete");
    assert_eq!(sent.header("authorization"), Some("Bearer tok"));
    assert_eq!(sent.body["beforeCursor"], "fn add(a: i32, b: i32) -> i32 {\n    ");

    server.push(MockResponse::json(402, json!({ "error": "No credit" })));
    assert!(matches!(block_on(hosted.complete(&request)), Err(CompletionError::NotAllowed(_))));
    server.push(MockResponse::json(403, json!({ "error": "Disabled" })));
    assert!(matches!(block_on(hosted.complete(&request)), Err(CompletionError::Disabled(_))));
    assert!(matches!(CompletionError::from_provider(ProviderError { status: Some(403), message: "no".into() }, false), CompletionError::Failed(_)));
    assert!(matches!(CompletionError::from_provider(ProviderError { status: Some(402), message: "no".into() }, false), CompletionError::NeedsAccount(_)));
}

#[test]
fn lists_models_from_the_provider() {
    let server = MockServer::start();
    server.push(MockResponse::json(200, json!({ "data": [{ "id": "qwen3:8b" }, { "id": "llama", "name": "Llama", "context_length": 8192 }] })));
    let connection = Connection::new(catalog::provider("ollama").unwrap(), "qwen3:8b", format!("{}/v1/chat/completions", server.url), None);
    let models = block_on(connection.list_models()).unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!((models[1].name.as_str(), models[1].context_window), ("Llama", 8192));
    assert_eq!(server.requests()[0].path, "/v1/models");
    assert_eq!(server.requests()[0].method, "GET");
}

#[test]
fn hosted_requests_are_stamped_and_report_the_chosen_model() {
    let server = MockServer::start();
    server.push(MockResponse::openai_text("ok"));
    let athas = Arc::new(Connection::new(
        catalog::provider(catalog::ATHAS).unwrap(),
        "auto",
        format!("{}/api/ai/chat/completions", server.url),
        Some("tok".into()),
    ));
    let request = Request { messages: vec![Message::user("hi")], max_tokens: 10, ..Default::default() };
    let events: Vec<Event> = block_on(async { athas.stream(&request).await.unwrap().map(Result::unwrap).collect().await });
    assert!(events.contains(&Event::Text("ok".into())));
    let sent = &server.requests()[0];
    assert_eq!(sent.header("x-athas-intelligence-scope"), Some("personal"));
    assert!(sent.header("idempotency-key").is_some());
    assert_eq!(sent.body["max_completion_tokens"], 10);
    assert_eq!(sent.body["stream_options"]["include_usage"], true);
}

#[test]
fn extension_providers_build_the_request_and_stream_openai_chunks() {
    struct Bridge(String);
    impl crate::ExternalProviders for Bridge {
        fn providers(&self) -> Vec<crate::ExternalProvider> {
            vec![crate::ExternalProvider { id: "acme".into(), name: "Acme AI".into(), requires_api_key: true, models: vec![("acme-1".into(), "Acme One".into())], icon: None }]
        }
        fn request(&self, _: &str, method: &str, args: Vec<serde_json::Value>) -> futures::future::BoxFuture<'static, Result<serde_json::Value, String>> {
            let answer = match method {
                "buildHeaders" => Ok(json!({ "Authorization": format!("Bearer {}", args[0].as_str().unwrap_or_default()) })),
                "buildPayload" => Ok(json!({ "model": args[0]["modelId"], "prompt": args[0]["messages"][1]["content"], "stream": true })),
                "buildUrl" => Ok(json!(format!("{}/acme/chat", self.0))),
                _ => Err("unknown".into()),
            };
            Box::pin(async move { answer })
        }
    }
    let server = MockServer::start();
    server.push(MockResponse::openai_text("Hi from Acme"));
    crate::set_external_providers(Some(std::sync::Arc::new(Bridge(server.url.clone()))));
    let secrets = crate::MemorySecrets::with(&[("ai_token_acme", "acme-key")]);
    let settings = crate::ProviderSettings { provider_id: "acme".into(), ..Default::default() };
    let connection = Connection::resolve(&settings, &secrets).unwrap();
    assert_eq!(connection.model, "acme-1");
    assert!(connection.is_external());
    let request = Request { system: "Be brief".into(), messages: vec![Message::user("Hello")], max_tokens: 64, ..Default::default() };
    let events: Vec<Event> = block_on(async { connection.stream(&request).await.unwrap().map(Result::unwrap).collect().await });
    assert_eq!(events[0], Event::Text("Hi from Acme".into()));
    let sent = &server.requests()[0];
    assert_eq!(sent.path, "/acme/chat");
    assert_eq!(sent.header("authorization"), Some("Bearer acme-key"));
    assert_eq!(sent.body, json!({ "model": "acme-1", "prompt": "Hello", "stream": true }));
    assert!(Connection::resolve(&settings, &crate::MemorySecrets::default()).is_err());
    crate::set_external_providers(None);
}
