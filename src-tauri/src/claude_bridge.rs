use anyhow::{Context, Result, bail};
use interceptor::{
    InterceptorMessage, start_proxy_server_with_ws, websocket::create_ws_broadcaster,
};
use serde::Serialize;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, mpsc};

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeStatus {
    pub running: bool,
    pub connected: bool,
    pub interceptor_running: bool,
}

pub struct ClaudeCodeBridge {
    claude_process: Option<Child>,
    pub claude_stdin: Option<tokio::process::ChildStdin>,
    interceptor_handle: Option<tokio::task::JoinHandle<()>>,
    server_handle: Option<tokio::task::JoinHandle<()>>,
    ws_connected: bool,
    app_handle: AppHandle,
}

impl ClaudeCodeBridge {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            claude_process: None,
            claude_stdin: None,
            interceptor_handle: None,
            server_handle: None,
            ws_connected: false,
            app_handle,
        }
    }

    pub async fn start_interceptor(&mut self) -> Result<()> {
        if self.interceptor_handle.is_some() {
            bail!("Interceptor is already running");
        }

        log::info!("Starting interceptor as embedded service...");

        let proxy_port = 3456;

        // Start the interceptor proxy server
        let (rx, ws_state, server_handle) = start_proxy_server_with_ws(proxy_port).await?;

        // Create channels for message distribution
        let (broadcast_tx, broadcast_rx) = mpsc::unbounded_channel::<InterceptorMessage>();
        let app_handle = self.app_handle.clone();

        // Spawn WebSocket broadcaster
        tokio::spawn(create_ws_broadcaster(ws_state, broadcast_rx));

        // Spawn message handler that forwards to frontend
        let message_handler = tokio::spawn(async move {
            let mut rx = rx;
            while let Some(message) = rx.recv().await {
                // Forward to WebSocket clients
                let _ = broadcast_tx.send(message.clone());

                // Emit to frontend
                let _ = app_handle.emit("claude-message", message);
            }
        });

        self.interceptor_handle = Some(message_handler);
        self.server_handle = Some(server_handle);
        self.ws_connected = true;

        log::info!("Interceptor started successfully on port {}", proxy_port);
        Ok(())
    }

    pub async fn start_claude_code(&mut self, workspace_path: Option<String>) -> Result<()> {
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

        // Set the working directory if workspace path is provided
        if let Some(path) = workspace_path {
            cmd.current_dir(&path);
            log::info!("Starting Claude Code in workspace: {}", path);
        }

        let mut child = cmd.spawn().map_err(|e| {
            anyhow::anyhow!(
                "Failed to spawn Claude process: {}. Make sure 'claude' is in your PATH",
                e
            )
        })?;

        // Get stdin handle
        let stdin = child.stdin.take().context("Failed to get stdin")?;
        self.claude_stdin = Some(stdin);

        // Consume stdout and stderr to prevent broken pipe errors, but discard the output
        // since all communication goes through the interceptor
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                // Just consume and discard
                while let Ok(Some(_)) = lines.next_line().await {}
            });
        }

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                // Just consume and discard
                while let Ok(Some(_)) = lines.next_line().await {}
            });
        }

        self.claude_process = Some(child);

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
        if let Some(handle) = self.interceptor_handle.take() {
            handle.abort();
        }

        // Stop the server
        if let Some(handle) = self.server_handle.take() {
            handle.abort();
        }

        Ok(())
    }

    pub fn get_status(&self) -> ClaudeStatus {
        ClaudeStatus {
            running: self.claude_process.is_some(),
            connected: self.ws_connected,
            interceptor_running: self.interceptor_handle.is_some(),
        }
    }
}

pub fn init_claude_bridge(app: &AppHandle) -> Arc<Mutex<ClaudeCodeBridge>> {
    let bridge = ClaudeCodeBridge::new(app.clone());
    Arc::new(Mutex::new(bridge))
}
