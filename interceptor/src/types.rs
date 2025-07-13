use bon::Builder;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use strum::{Display, EnumString};
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
    pub text: Option<String>,
    pub id: Option<String>,
    pub name: Option<String>,
    pub input: Option<serde_json::Value>,
    pub content: Option<serde_json::Value>,
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
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Display, EnumString)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ClaudeModel {
    #[serde(rename = "claude-opus-4-20250514")]
    #[strum(serialize = "claude-opus-4-20250514")]
    Opus,
    #[serde(rename = "claude-sonnet-4-20250514")]
    #[strum(serialize = "claude-sonnet-4-20250514")]
    Sonnet,
    #[serde(rename = "claude-3-5-haiku-20241022")]
    #[strum(serialize = "claude-3-5-haiku-20241022")]
    Haiku,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedRequest {
    pub model: ClaudeModel,
    pub messages: Vec<ParsedMessage>,
    pub system: Option<SystemPrompt>,
    pub tools: Option<Vec<Tool>>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
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

#[derive(Debug, Clone, Serialize, Deserialize, Builder)]
#[builder(on(String, into))]
pub struct ParsedResponse {
    pub id: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub response_type: Option<String>,
    pub role: Option<String>,
    pub content: Option<Vec<ContentBlock>>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub usage: Option<Usage>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Display, EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ChunkType {
    MessageStart,
    MessageDelta,
    MessageStop,
    ContentBlockStart,
    ContentBlockDelta,
    ContentBlockStop,
    Error,
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamingChunk {
    #[serde(rename = "type")]
    pub chunk_type: ChunkType,
    pub index: Option<u32>,
    pub delta: Option<Delta>,
    pub content_block: Option<ContentBlock>,
    pub message: Option<StreamMessage>,
    pub error: Option<ErrorResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delta {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub delta_type: Option<String>,
    pub text: Option<String>,
    pub partial_json: Option<String>,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamMessage {
    pub id: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub role: String,
    pub model: String,
    pub stop_reason: Option<String>,
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
    pub parsed_response: Option<ParsedResponse>,
    pub raw_response: Option<String>,
    pub streaming_chunks: Option<Vec<StreamingChunk>>,
    pub duration_ms: Option<u64>,
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
        match self.chunk_type {
            ChunkType::ContentBlockDelta => {
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
            ChunkType::MessageStart => {
                if let Some(message) = &self.message {
                    write!(f, "message_start: {}", message.id)
                } else {
                    write!(f, "message_start")
                }
            }
            ChunkType::MessageStop => write!(f, "message_stop"),
            ChunkType::ContentBlockStart => {
                if let Some(block) = &self.content_block {
                    write!(f, "content_block_start: {:?}", block.content_type)
                } else {
                    write!(f, "content_block_start")
                }
            }
            ChunkType::ContentBlockStop => write!(f, "content_block_stop"),
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
