use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeStatus {
    pub running: bool,
    pub connected: bool,
    pub interceptor_running: bool,
}

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
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedMessage {
    pub role: Role,
    pub content: MessageContent,
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

pub struct ClaudeCodeBridge {
    claude_process: Option<Child>,
    pub claude_stdin: Option<tokio::process::ChildStdin>,
    interceptor_process: Option<Child>,
    ws_connected: bool,
    app_handle: AppHandle,
}

impl ClaudeCodeBridge {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            claude_process: None,
            claude_stdin: None,
            interceptor_process: None,
            ws_connected: false,
            app_handle,
        }
    }

    pub async fn start_interceptor(&mut self) -> Result<()> {
        if self.interceptor_process.is_some() {
            bail!("Interceptor is already running");
        }

        // The interceptor binary is in the workspace target directory
        let interceptor_path = if cfg!(debug_assertions) {
            // In development, use the workspace target directory
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .context("Failed to get parent directory")?
                .join("target")
                .join("debug")
                .join("interceptor")
        } else {
            // In production, use release build
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .context("Failed to get parent directory")?
                .join("target")
                .join("release")
                .join("interceptor")
        };

        if !interceptor_path.exists() {
            bail!(
                "Interceptor binary not found at {:?}. Please build the interceptor first.",
                interceptor_path
            );
        }

        let mut cmd = Command::new(&interceptor_path);
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to spawn interceptor at {:?}: {}",
                    interceptor_path,
                    e
                )
            })?;

        // Spawn stdout reader for interceptor
        if let Some(stdout) = child.stdout.take() {
            let app_handle = self.app_handle.clone();
            tokio::spawn(async move {
                let mut reader = tokio::io::BufReader::new(stdout);
                let mut line = String::new();
                loop {
                    use tokio::io::AsyncBufReadExt;
                    match reader.read_line(&mut line).await {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                log::info!("[Interceptor] {}", trimmed);
                                let _ = app_handle.emit("interceptor-log", trimmed);
                            }
                            line.clear();
                        }
                        Err(e) => {
                            log::error!("[Interceptor] Error reading stdout: {}", e);
                            break;
                        }
                    }
                }
            });
        }

        // Spawn stderr reader for interceptor
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut reader = tokio::io::BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    use tokio::io::AsyncBufReadExt;
                    match reader.read_line(&mut line).await {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                log::error!("[Interceptor Error] {}", trimmed);
                            }
                            line.clear();
                        }
                        Err(e) => {
                            log::error!("[Interceptor] Error reading stderr: {}", e);
                            break;
                        }
                    }
                }
            });
        }

        self.interceptor_process = Some(child);

        // Give the interceptor time to start
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Connect to WebSocket
        self.connect_websocket().await?;

        Ok(())
    }

    async fn connect_websocket(&mut self) -> Result<()> {
        let url = Url::parse("ws://localhost:3456/ws")?;
        let (ws_stream, _) = connect_async(url)
            .await
            .context("Failed to connect to interceptor WebSocket")?;

        let app_handle = self.app_handle.clone();
        let (write, read) = ws_stream.split();

        // Create shared state for write half (if needed later)
        let write_arc = Arc::new(Mutex::new(write));
        self.app_handle.manage(write_arc.clone());

        // Spawn reader task
        tokio::spawn(async move {
            let mut read = read;
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        log::info!(
                            "Received WebSocket message: {}",
                            &text[..text.len().min(100)]
                        );
                        if let Ok(interceptor_msg) =
                            serde_json::from_str::<InterceptorMessage>(&text)
                        {
                            log::info!("Emitting claude-message event");
                            let _ = app_handle.emit("claude-message", interceptor_msg);
                        } else {
                            log::error!(
                                "Failed to parse interceptor message: {}",
                                &text[..text.len().min(200)]
                            );
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Err(e) => {
                        log::error!("WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
        });

        self.ws_connected = true;
        Ok(())
    }

    pub async fn start_claude_code(&mut self) -> Result<()> {
        if self.claude_process.is_some() {
            bail!("Claude Code is already running");
        }

        let mut cmd = Command::new("claude");
        cmd.arg("--dangerously-skip-permissions")
            .arg("--print")
            .arg("--verbose")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--input-format")
            .arg("stream-json")
            .env("ANTHROPIC_BASE_URL", "http://localhost:3456")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            anyhow::anyhow!(
                "Failed to spawn Claude process: {}. Make sure 'claude' is in your PATH",
                e
            )
        })?;

        // Get stdin handle
        let stdin = child.stdin.take().context("Failed to get stdin")?;
        self.claude_stdin = Some(stdin);
        self.claude_process = Some(child);

        // Spawn stdout reader for stream-json format
        if let Some(stdout) = self.claude_process.as_mut().unwrap().stdout.take() {
            let app_handle = self.app_handle.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();

                while let Ok(Some(line)) = lines.next_line().await {
                    // Parse each line as JSON
                    if let Ok(json_msg) = serde_json::from_str::<serde_json::Value>(&line) {
                        // Check if it's a message chunk
                        if let Some(msg_type) = json_msg.get("type").and_then(|v| v.as_str()) {
                            match msg_type {
                                "content_block_delta" => {
                                    if let Some(text) = json_msg
                                        .get("delta")
                                        .and_then(|d| d.get("text"))
                                        .and_then(|t| t.as_str())
                                    {
                                        let _ = app_handle.emit("claude-chunk", text);
                                    }
                                }
                                "message_stop" => {
                                    let _ = app_handle.emit("claude-complete", ());
                                }
                                _ => {
                                    // Emit raw JSON for other message types
                                    let _ = app_handle.emit("claude-message", json_msg);
                                }
                            }
                        }
                    } else {
                        // If not JSON, emit as regular stdout
                        let _ = app_handle.emit("claude-stdout", &line);
                    }
                }
            });
        }

        // Spawn stderr reader
        if let Some(mut stderr) = self.claude_process.as_mut().unwrap().stderr.take() {
            let app_handle = self.app_handle.clone();
            tokio::spawn(async move {
                let mut buf = vec![0; 1024];
                loop {
                    match stderr.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                            let _ = app_handle.emit("claude-stderr", text);
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        Ok(())
    }

    pub async fn stop(&mut self) -> Result<()> {
        // Stop Claude Code
        if let Some(mut child) = self.claude_process.take() {
            let _ = child.kill().await;
        }

        // Drop stdin handle
        self.claude_stdin = None;

        // WebSocket will close automatically when process stops
        self.ws_connected = false;

        // Stop interceptor
        if let Some(mut child) = self.interceptor_process.take() {
            let _ = child.kill().await;
        }

        Ok(())
    }

    pub fn get_status(&self) -> ClaudeStatus {
        ClaudeStatus {
            running: self.claude_process.is_some(),
            connected: self.ws_connected,
            interceptor_running: self.interceptor_process.is_some(),
        }
    }
}

pub fn init_claude_bridge(app: &AppHandle) -> Arc<Mutex<ClaudeCodeBridge>> {
    let bridge = ClaudeCodeBridge::new(app.clone());
    Arc::new(Mutex::new(bridge))
}
