use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedMessage {
    pub role: Role,
    pub content: MessageContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedRequest {
    pub model: String,
    pub messages: Vec<ParsedMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<SystemPrompt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Tool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SystemPrompt {
    Text(String),
    Blocks(Vec<SystemBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub response_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<ContentBlock>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sequence: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingChunk {
    #[serde(rename = "type")]
    pub chunk_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<Delta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_block: Option<ContentBlock>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<StreamMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delta {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub delta_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_json: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sequence: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamMessage {
    pub id: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub role: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sequence: Option<String>,
    pub usage: Usage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterceptedRequest {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub method: String,
    pub path: String,
    pub parsed_request: ParsedRequest,
    pub raw_request: String,
    pub headers: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_response: Option<ParsedResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming_chunks: Option<Vec<StreamingChunk>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl fmt::Display for InterceptedRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "[{}] {} {} - Model: {}",
            self.timestamp.format("%Y-%m-%d %H:%M:%S"),
            self.method,
            self.path,
            self.parsed_request.model
        )
    }
}

impl fmt::Display for StreamingChunk {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.chunk_type.as_str() {
            &"content_block_delta" => {
                if let Some(delta) = &self.delta {
                    if let Some(text) = &delta.text {
                        write!(f, "text: {}", text)
                    } else if let Some(json) = &delta.partial_json {
                        write!(f, "json: {}", json)
                    } else {
                        write!(f, "delta: {:?}", delta)
                    }
                } else {
                    write!(f, "{}", self.chunk_type)
                }
            }
            &"message_start" => {
                if let Some(message) = &self.message {
                    write!(f, "message_start: {}", message.id)
                } else {
                    write!(f, "message_start")
                }
            }
            &"message_stop" => write!(f, "message_stop"),
            &"content_block_start" => {
                if let Some(block) = &self.content_block {
                    write!(f, "content_block_start: {:?}", block.content_type)
                } else {
                    write!(f, "content_block_start")
                }
            }
            &"content_block_stop" => write!(f, "content_block_stop"),
            _ => write!(f, "{}", self.chunk_type),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InterceptorMessage {
    Request {
        data: InterceptedRequest,
    },
    Response {
        data: InterceptedRequest,
    },
    StreamChunk {
        request_id: Uuid,
        chunk: StreamingChunk,
    },
    Error {
        request_id: Uuid,
        error: String,
    },
}
impl InterceptorMessage {
    pub fn type_name(&self) -> &'static str {
        match self {
            InterceptorMessage::Request { .. } => "Request",
            InterceptorMessage::Response { .. } => "Response",
            InterceptorMessage::StreamChunk { .. } => "StreamChunk",
            InterceptorMessage::Error { .. } => "Error",
        }
    }
}

impl fmt::Display for InterceptorMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InterceptorMessage::Request { data } => {
                write!(f, "REQUEST: {}", data)
            }
            InterceptorMessage::Response { data } => {
                write!(f, "RESPONSE: {}", data)
            }
            InterceptorMessage::StreamChunk { request_id, chunk } => {
                let short_id = request_id.to_string()[..8].to_string();
                write!(f, "STREAM_CHUNK[{}]: {}", short_id, chunk)
            }
            InterceptorMessage::Error { request_id, error } => {
                let short_id = request_id.to_string()[..8].to_string();
                write!(f, "ERROR[{}]: {}", short_id, error)
            }
        }
    }
}
