//! Anthropic's Messages API: the request body and the streamed events.

use std::collections::HashMap;

use serde_json::{Value, json};

use crate::{
    http::ProviderError,
    message::{Event, FinishReason, Message, Part, Request, Role, ToolCall, Usage},
    sse::SseEvent,
};

pub const API_VERSION: &str = "2023-06-01";

pub fn headers(api_key: &str) -> Vec<(String, String)> {
    vec![
        ("x-api-key".into(), api_key.into()),
        ("anthropic-version".into(), API_VERSION.into()),
        ("content-type".into(), "application/json".into()),
        ("accept".into(), "text/event-stream".into()),
    ]
}

pub fn body(model: &str, request: &Request) -> Value {
    let mut body = json!({
        "model": model,
        "max_tokens": request.max_tokens.max(1),
        "messages": messages(&request.messages),
        "stream": true,
    });
    if !request.system.is_empty() {
        // The instructions and tools repeat on every step of a turn, so they are cached.
        body["system"] = json!([{ "type": "text", "text": request.system, "cache_control": { "type": "ephemeral" } }]);
    }
    if !request.tools.is_empty() {
        let mut tools: Vec<Value> = request
            .tools
            .iter()
            .map(|tool| json!({ "name": tool.name, "description": tool.description, "input_schema": tool.input_schema }))
            .collect();
        if let Some(last) = tools.last_mut() {
            last["cache_control"] = json!({ "type": "ephemeral" });
        }
        body["tools"] = Value::Array(tools);
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    body
}

/// Anthropic takes tool results in user turns and wants turns to alternate, so neighbouring
/// user and tool messages merge into one.
fn messages(messages: &[Message]) -> Vec<Value> {
    let mut out: Vec<(String, Vec<Value>)> = Vec::new();
    for message in messages {
        let role = match message.role {
            Role::Assistant => "assistant",
            Role::User | Role::Tool => "user",
        };
        let blocks: Vec<Value> = message.content.iter().filter_map(block).collect();
        if blocks.is_empty() {
            continue;
        }
        match out.last_mut() {
            Some((last, existing)) if last == role => existing.extend(blocks),
            _ => out.push((role.to_string(), blocks)),
        }
    }
    out.into_iter().map(|(role, content)| json!({ "role": role, "content": content })).collect()
}

fn block(part: &Part) -> Option<Value> {
    Some(match part {
        Part::Text { text } if text.is_empty() => return None,
        Part::Text { text } => json!({ "type": "text", "text": text }),
        Part::Image { media_type, data } => {
            json!({ "type": "image", "source": { "type": "base64", "media_type": media_type, "data": data } })
        }
        Part::ToolCall { id, name, input } => json!({ "type": "tool_use", "id": id, "name": name, "input": input }),
        Part::ToolResult { id, content, is_error, .. } => {
            json!({ "type": "tool_result", "tool_use_id": id, "content": content, "is_error": is_error })
        }
    })
}

/// Turns the stream's events into [`Event`]s.
#[derive(Default)]
pub struct Parser {
    /// Tool calls being streamed, by content block index: id, name and the input JSON so far.
    tools: HashMap<u64, (String, String, String)>,
    usage: Usage,
    /// `message_delta` (with the stop reason) arrived: the answer is whole.
    finished: bool,
}

impl Parser {
    /// The stream closed: without a stop reason the connection broke mid-answer, which must not
    /// pass for a finished (and maybe half-written) reply.
    pub fn end(&self) -> Result<Vec<Event>, ProviderError> {
        if self.finished {
            Ok(Vec::new())
        } else {
            Err(ProviderError::new("The connection to the provider broke before the answer finished. Try again."))
        }
    }

    pub fn event(&mut self, event: &SseEvent) -> Result<Vec<Event>, ProviderError> {
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else { return Ok(Vec::new()) };
        let kind = data.get("type").and_then(Value::as_str).or(event.event.as_deref()).unwrap_or_default();
        let mut events = Vec::new();
        match kind {
            "message_start" => {
                if let Some(usage) = data.pointer("/message/usage") {
                    self.usage.input_tokens = number(usage, "input_tokens");
                    self.usage.cache_read_tokens = number(usage, "cache_read_input_tokens");
                    self.usage.cache_write_tokens = number(usage, "cache_creation_input_tokens");
                    self.usage.output_tokens = number(usage, "output_tokens");
                }
            }
            "content_block_start" => {
                let index = data.get("index").and_then(Value::as_u64).unwrap_or_default();
                let block = data.get("content_block").cloned().unwrap_or_default();
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    let id = block.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                    let name = block.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
                    self.tools.insert(index, (id, name, String::new()));
                }
            }
            "content_block_delta" => {
                let index = data.get("index").and_then(Value::as_u64).unwrap_or_default();
                let delta = data.get("delta").cloned().unwrap_or_default();
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        let text = delta.get("text").and_then(Value::as_str).unwrap_or_default();
                        if !text.is_empty() {
                            events.push(Event::Text(text.to_string()));
                        }
                    }
                    Some("thinking_delta") => {
                        let text = delta.get("thinking").and_then(Value::as_str).unwrap_or_default();
                        if !text.is_empty() {
                            events.push(Event::Thinking(text.to_string()));
                        }
                    }
                    Some("input_json_delta") => {
                        if let Some((_, _, input)) = self.tools.get_mut(&index) {
                            input.push_str(delta.get("partial_json").and_then(Value::as_str).unwrap_or_default());
                        }
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                let index = data.get("index").and_then(Value::as_u64).unwrap_or_default();
                if let Some((id, name, input)) = self.tools.remove(&index) {
                    let input = if input.trim().is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str(&input).map_err(|_| ProviderError::new(format!("The model sent unreadable input for {name}")))?
                    };
                    events.push(Event::ToolCall(ToolCall { id, name, input }));
                }
            }
            "message_delta" => {
                if let Some(usage) = data.get("usage") {
                    self.usage.output_tokens = number(usage, "output_tokens").max(self.usage.output_tokens);
                }
                events.push(Event::Usage(self.usage));
                let reason = match data.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    Some("tool_use") => FinishReason::ToolCalls,
                    Some("max_tokens") => FinishReason::Length,
                    Some("refusal") => FinishReason::Refusal,
                    _ => FinishReason::Stop,
                };
                self.finished = true;
                events.push(Event::Finish(reason));
            }
            "error" => {
                let message = data.pointer("/error/message").and_then(Value::as_str).unwrap_or("The provider failed");
                let status = match data.pointer("/error/type").and_then(Value::as_str) {
                    Some("overloaded_error") => Some(529),
                    Some("rate_limit_error") => Some(429),
                    _ => None,
                };
                return Err(ProviderError { status, message: message.to_string() });
            }
            _ => {}
        }
        Ok(events)
    }
}

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::ToolSpec;

    #[test]
    fn requests_merge_tool_results_into_user_turns() {
        let request = Request {
            system: "Be brief".into(),
            messages: vec![
                Message::user("Read it"),
                Message {
                    role: Role::Assistant,
                    content: vec![
                        Part::Text { text: String::new() },
                        Part::ToolCall { id: "t1".into(), name: "read_file".into(), input: json!({ "path": "a" }) },
                    ],
                },
                Message {
                    role: Role::Tool,
                    content: vec![Part::ToolResult { id: "t1".into(), name: "read_file".into(), content: "x".into(), is_error: false }],
                },
                Message {
                    role: Role::User,
                    content: vec![Part::Image { media_type: "image/png".into(), data: "AAAA".into() }],
                },
            ],
            tools: vec![ToolSpec { name: "read_file".into(), description: "Read".into(), input_schema: json!({ "type": "object" }) }],
            max_tokens: 100,
            temperature: None,
        };
        let body = body("claude-sonnet-5", &request);
        assert_eq!(body["system"][0]["text"], "Be brief");
        assert_eq!(body["tools"][0]["cache_control"]["type"], "ephemeral");
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["content"].as_array().unwrap().len(), 1, "empty text is left out");
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");
        assert_eq!(messages[2]["content"][1]["source"]["media_type"], "image/png");
    }

    #[test]
    fn parses_text_tool_calls_and_usage() {
        let mut parser = Parser::default();
        let lines = [
            r#"{"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_input_tokens":3,"output_tokens":1}}}"#,
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu1","name":"list_files","input":{}}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"src\"}"}}"#,
            r#"{"type":"content_block_stop","index":1}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}"#,
        ];
        let events: Vec<Event> = lines
            .iter()
            .flat_map(|data| parser.event(&SseEvent { event: None, data: data.to_string() }).unwrap())
            .collect();
        assert_eq!(events[0], Event::Text("Hi".into()));
        assert_eq!(events[1], Event::ToolCall(ToolCall { id: "tu1".into(), name: "list_files".into(), input: json!({ "path": "src" }) }));
        assert_eq!(
            events[2],
            Event::Usage(Usage { input_tokens: 12, output_tokens: 20, cache_read_tokens: 3, cache_write_tokens: 0 })
        );
        assert_eq!(events[3], Event::Finish(FinishReason::ToolCalls));
        let error = parser
            .event(&SseEvent { event: None, data: r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#.into() })
            .unwrap_err();
        assert_eq!(error.status, Some(529));
    }
}
