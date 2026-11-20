//! OpenAI's chat completions, which most providers speak: the request body and the streamed
//! chunks.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    http::ProviderError,
    message::{Event, FinishReason, Message, Part, Request, Role, ToolCall, Usage},
    sse::SseEvent,
};

/// How one provider's dialect differs.
#[derive(Clone, Copy, Debug, Default)]
pub struct Dialect {
    /// Newer OpenAI models reject `max_tokens` and want `max_completion_tokens`.
    pub max_completion_tokens: bool,
    /// Ask for token usage in a final chunk (`stream_options.include_usage`).
    pub include_usage: bool,
    /// OpenRouter reports the request's cost when asked.
    pub openrouter_cost: bool,
}

pub fn body(model: &str, request: &Request, dialect: Dialect) -> Value {
    let mut messages = Vec::new();
    if !request.system.is_empty() {
        messages.push(json!({ "role": "system", "content": request.system }));
    }
    for message in &request.messages {
        messages.extend(convert(message));
    }
    let mut body = json!({ "model": model, "messages": messages, "stream": true });
    if request.max_tokens > 0 {
        let field = if dialect.max_completion_tokens { "max_completion_tokens" } else { "max_tokens" };
        body[field] = json!(request.max_tokens);
    }
    if dialect.include_usage {
        body["stream_options"] = json!({ "include_usage": true });
    }
    if dialect.openrouter_cost {
        body["usage"] = json!({ "include": true });
    }
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(
            request
                .tools
                .iter()
                .map(|tool| {
                    json!({ "type": "function", "function": { "name": tool.name, "description": tool.description, "parameters": tool.input_schema } })
                })
                .collect(),
        );
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    body
}

fn convert(message: &Message) -> Vec<Value> {
    match message.role {
        Role::User => {
            let has_images = message.content.iter().any(|part| matches!(part, Part::Image { .. }));
            if !has_images {
                return vec![json!({ "role": "user", "content": message.text() })];
            }
            let parts: Vec<Value> = message
                .content
                .iter()
                .filter_map(|part| match part {
                    Part::Text { text } if !text.is_empty() => Some(json!({ "type": "text", "text": text })),
                    Part::Image { media_type, data } => {
                        Some(json!({ "type": "image_url", "image_url": { "url": format!("data:{media_type};base64,{data}") } }))
                    }
                    _ => None,
                })
                .collect();
            vec![json!({ "role": "user", "content": parts })]
        }
        Role::Assistant => {
            let text = message.text();
            let calls: Vec<Value> = message
                .tool_calls()
                .map(|call| {
                    json!({
                        "id": call.id,
                        "type": "function",
                        "function": { "name": call.name, "arguments": call.input.to_string() },
                    })
                })
                .collect();
            let mut value = json!({ "role": "assistant", "content": if text.is_empty() { Value::Null } else { Value::String(text) } });
            if !calls.is_empty() {
                value["tool_calls"] = Value::Array(calls);
            }
            vec![value]
        }
        Role::Tool => message
            .content
            .iter()
            .filter_map(|part| match part {
                Part::ToolResult { id, content, is_error, .. } => {
                    let content = if *is_error { format!("Error: {content}") } else { content.clone() };
                    Some(json!({ "role": "tool", "tool_call_id": id, "content": content }))
                }
                _ => None,
            })
            .collect(),
    }
}

/// Turns the stream's chunks into [`Event`]s.
#[derive(Default)]
pub struct Parser {
    /// Tool calls being streamed, by index: id, name and the arguments so far.
    tools: BTreeMap<u64, (String, String, String)>,
    finish: Option<FinishReason>,
    done: bool,
}

impl Parser {
    pub fn event(&mut self, event: &SseEvent) -> Result<Vec<Event>, ProviderError> {
        if event.data.trim() == "[DONE]" {
            return self.finish();
        }
        let Ok(data) = serde_json::from_str::<Value>(&event.data) else { return Ok(Vec::new()) };
        if let Some(error) = data.get("error") {
            let message = error.get("message").and_then(Value::as_str).or(error.as_str()).unwrap_or("The provider failed");
            let status = error.get("code").and_then(Value::as_u64).map(|code| code as u16);
            return Err(ProviderError { status, message: message.to_string() });
        }
        let mut events = Vec::new();
        if let Some(model) = data.get("model").and_then(Value::as_str)
            && !model.is_empty()
        {
            events.push(Event::Model(model.to_string()));
        }
        for choice in data.get("choices").and_then(Value::as_array).into_iter().flatten() {
            let delta = choice.get("delta").cloned().unwrap_or_default();
            for key in ["reasoning_content", "reasoning"] {
                if let Some(text) = delta.get(key).and_then(Value::as_str)
                    && !text.is_empty()
                {
                    events.push(Event::Thinking(text.to_string()));
                }
            }
            if let Some(text) = delta.get("content").and_then(Value::as_str)
                && !text.is_empty()
            {
                events.push(Event::Text(text.to_string()));
            }
            for call in delta.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
                let index = call.get("index").and_then(Value::as_u64).unwrap_or(self.tools.len() as u64);
                let entry = self.tools.entry(index).or_default();
                if let Some(id) = call.get("id").and_then(Value::as_str) {
                    entry.0 = id.to_string();
                }
                if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) {
                    entry.1.push_str(name);
                }
                if let Some(arguments) = call.pointer("/function/arguments").and_then(Value::as_str) {
                    entry.2.push_str(arguments);
                }
            }
            if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                self.finish = Some(match reason {
                    "tool_calls" | "function_call" => FinishReason::ToolCalls,
                    "length" => FinishReason::Length,
                    "content_filter" => FinishReason::Refusal,
                    _ => FinishReason::Stop,
                });
                events.extend(self.take_tool_calls()?);
            }
        }
        if let Some(usage) = data.get("usage").filter(|usage| usage.is_object()) {
            let prompt = number(usage, "prompt_tokens");
            let cached = usage.pointer("/prompt_tokens_details/cached_tokens").and_then(Value::as_u64).unwrap_or_default().min(prompt);
            events.push(Event::Usage(Usage {
                input_tokens: prompt - cached,
                output_tokens: number(usage, "completion_tokens"),
                cache_read_tokens: cached,
                cache_write_tokens: 0,
            }));
            let cost = usage.get("cost").and_then(|cost| cost.as_f64().or_else(|| cost.as_str().and_then(|cost| cost.parse().ok())));
            if let Some(cost) = cost.filter(|cost| cost.is_finite() && *cost >= 0.) {
                events.push(Event::Cost(cost));
            }
        }
        Ok(events)
    }

    /// Ends the stream: tool calls still open and the finish reason.
    /// The stream closed: neither `[DONE]` nor a finish reason means it broke mid-answer.
    pub fn end(&mut self) -> Result<Vec<Event>, ProviderError> {
        if !self.done && self.finish.is_none() {
            return Err(ProviderError::new("The connection to the provider broke before the answer finished. Try again."));
        }
        self.finish()
    }

    pub fn finish(&mut self) -> Result<Vec<Event>, ProviderError> {
        if self.done {
            return Ok(Vec::new());
        }
        self.done = true;
        let mut events = self.take_tool_calls()?;
        let reason = match self.finish {
            Some(reason) => reason,
            None if events.is_empty() => FinishReason::Stop,
            None => FinishReason::ToolCalls,
        };
        events.push(Event::Finish(reason));
        Ok(events)
    }

    fn take_tool_calls(&mut self) -> Result<Vec<Event>, ProviderError> {
        std::mem::take(&mut self.tools)
            .into_values()
            .filter(|(_, name, _)| !name.is_empty())
            .enumerate()
            .map(|(index, (id, name, arguments))| {
                let input = if arguments.trim().is_empty() {
                    json!({})
                } else {
                    serde_json::from_str(&arguments).map_err(|_| ProviderError::new(format!("The model sent unreadable input for {name}")))?
                };
                // Some local servers leave ids out; the conversation still needs one per call.
                let id = if id.is_empty() { format!("call_{index}") } else { id };
                Ok(Event::ToolCall(ToolCall { id, name, input }))
            })
            .collect()
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
    fn requests_carry_images_tool_calls_and_results() {
        let request = Request {
            system: "Rules".into(),
            messages: vec![
                Message {
                    role: Role::User,
                    content: vec![Part::Text { text: "What is this?".into() }, Part::Image { media_type: "image/png".into(), data: "AAAA".into() }],
                },
                Message {
                    role: Role::Assistant,
                    content: vec![Part::ToolCall { id: "c1".into(), name: "read_file".into(), input: json!({ "path": "a" }) }],
                },
                Message {
                    role: Role::Tool,
                    content: vec![Part::ToolResult { id: "c1".into(), name: "read_file".into(), content: "denied".into(), is_error: true }],
                },
            ],
            tools: vec![ToolSpec { name: "read_file".into(), description: "Read".into(), input_schema: json!({ "type": "object" }) }],
            max_tokens: 50,
            temperature: Some(0.2),
        };
        let body = body("gpt", &request, Dialect { max_completion_tokens: true, include_usage: true, openrouter_cost: false });
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["content"][1]["image_url"]["url"], "data:image/png;base64,AAAA");
        assert_eq!(messages[2]["content"], Value::Null);
        assert_eq!(messages[2]["tool_calls"][0]["function"]["arguments"], "{\"path\":\"a\"}");
        assert_eq!(messages[3]["content"], "Error: denied");
        assert_eq!(body["max_completion_tokens"], 50);
        assert_eq!(body["stream_options"]["include_usage"], true);
        assert_eq!(body["tools"][0]["function"]["name"], "read_file");
    }

    #[test]
    fn parses_streamed_tool_calls_usage_and_cost() {
        let mut parser = Parser::default();
        let chunks = [
            r#"{"model":"m","choices":[{"index":0,"delta":{"content":"Let me look"}}]}"#,
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search_files","arguments":"{\"qu"}}]}}]}"#,
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ery\":\"x\"}"}}]}}]}"#,
            r#"{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}"#,
            r#"{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":40},"cost":0.0021}}"#,
            "[DONE]",
        ];
        let events: Vec<Event> = chunks
            .iter()
            .flat_map(|data| parser.event(&SseEvent { event: None, data: data.to_string() }).unwrap())
            .filter(|event| !matches!(event, Event::Model(_)))
            .collect();
        assert_eq!(
            events,
            vec![
                Event::Text("Let me look".into()),
                Event::ToolCall(ToolCall { id: "c1".into(), name: "search_files".into(), input: json!({ "query": "x" }) }),
                Event::Usage(Usage { input_tokens: 60, output_tokens: 7, cache_read_tokens: 40, cache_write_tokens: 0 }),
                Event::Cost(0.0021),
                Event::Finish(FinishReason::ToolCalls),
            ]
        );
        assert_eq!(parser.finish().unwrap(), Vec::new());
    }

    #[test]
    fn a_stream_without_done_still_finishes() {
        let mut parser = Parser::default();
        parser.event(&SseEvent { event: None, data: r#"{"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}"#.into() }).unwrap();
        assert_eq!(parser.finish().unwrap(), vec![Event::Finish(FinishReason::Stop)]);
        let error = Parser::default().event(&SseEvent { event: None, data: r#"{"error":{"message":"bad","code":429}}"#.into() }).unwrap_err();
        assert_eq!(error, ProviderError::status(429, "bad"));
    }
}
