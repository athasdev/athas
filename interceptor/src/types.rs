use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt;
use strum::{Display, EnumString};
use uuid::Uuid;

// Base enums and simple types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
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

// Basic structs used by others
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ContentBlock {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
    pub id: Option<String>,
    pub name: Option<String>,
    pub input: Option<Value>,
    pub content: Option<Value>,
    pub tool_use_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    #[serde(default)]
    pub cache_creation_input_tokens: u32,
    #[serde(default)]
    pub cache_read_input_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ErrorResponse {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SystemBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    pub text: String,
}

// Enums that use the basic structs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SystemPrompt {
    Text(String),
    Blocks(Vec<SystemBlock>),
}

// Structs that use the enums and basic structs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedMessage {
    pub role: Role,
    pub content: MessageContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedRequest {
    pub model: ClaudeModel,
    pub messages: Vec<ParsedMessage>,
    pub system: Option<SystemPrompt>,
    pub tools: Vec<Tool>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedResponse {
    pub id: String,
    #[serde(rename = "type")]
    pub response_type: String,
    pub role: String,
    pub content: Vec<ContentBlock>,
    pub model: String,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
    pub usage: Usage,
    pub error: Option<ErrorResponse>,
}

// Streaming-related types
/// Represents the different types of chunks in Claude's streaming response format.
/// These chunks follow the Server-Sent Events (SSE) protocol and arrive sequentially
/// to build up the complete response.
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
#[serde(rename_all = "snake_case")]
pub struct Delta {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub delta_type: Option<String>,
    pub text: Option<String>,
    pub partial_json: Option<String>,
    pub stop_reason: Option<String>,
    pub stop_sequence: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
#[serde(rename_all = "snake_case")]
pub struct StreamingChunk {
    #[serde(rename = "type")]
    pub chunk_type: ChunkType,
    pub index: Option<u32>,
    pub delta: Option<Delta>,
    pub content_block: Option<ContentBlock>,
    pub message: Option<StreamMessage>,
    pub error: Option<ErrorResponse>,
}

// Top-level types that use all the above
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
    pub streaming_chunks: Vec<StreamingChunk>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
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

// Display implementations
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
                write!(f, "STREAM_CHUNK[{}]: {}", short_id, chunk.chunk_type)
            }
            InterceptorMessage::Error { request_id, error } => {
                let short_id = request_id.to_string()[..8].to_string();
                write!(f, "ERROR[{}]: {}", short_id, error)
            }
        }
    }
}
