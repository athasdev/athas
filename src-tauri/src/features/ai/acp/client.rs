use super::types::{AcpContentBlock, AcpEvent, UiAction};
use crate::terminal::{TerminalManager, config::TerminalConfig};
use agent_client_protocol as acp;
use async_trait::async_trait;
use std::{
   collections::HashMap,
   sync::{Arc, Mutex as StdMutex},
};
use tauri::{AppHandle, Emitter, Listener};
use tokio::sync::{Mutex, mpsc, oneshot};

/// Response for permission requests
pub struct PermissionResponse {
   pub request_id: String,
   pub approved: bool,
   pub cancelled: bool,
}

/// Tracks state for an ACP terminal session
struct AcpTerminalState {
   athas_terminal_id: String,
   output_buffer: String,
   max_output_bytes: usize,
   truncated: bool,
   exit_status: Option<acp::TerminalExitStatus>,
   exit_waiters: Vec<oneshot::Sender<acp::TerminalExitStatus>>,
}

impl AcpTerminalState {
   fn new(athas_terminal_id: String, max_output_bytes: Option<u32>) -> Self {
      Self {
         athas_terminal_id,
         output_buffer: String::new(),
         max_output_bytes: max_output_bytes.unwrap_or(1_000_000) as usize,
         truncated: false,
         exit_status: None,
         exit_waiters: Vec::new(),
      }
   }

   fn append_output(&mut self, data: &str) {
      if self.output_buffer.len() + data.len() > self.max_output_bytes {
         let remaining = self
            .max_output_bytes
            .saturating_sub(self.output_buffer.len());
         if remaining > 0 {
            self
               .output_buffer
               .push_str(&data[..remaining.min(data.len())]);
         }
         self.truncated = true;
      } else {
         self.output_buffer.push_str(data);
      }
   }

   fn set_exit_status(&mut self, exit_code: Option<u32>, signal: Option<String>) {
      let status = acp::TerminalExitStatus::new()
         .exit_code(exit_code.unwrap_or(0))
         .signal(signal);
      self.exit_status = Some(status.clone());

      // Notify all waiters
      for waiter in self.exit_waiters.drain(..) {
         let _ = waiter.send(status.clone());
      }
   }
}

/// Athas ACP Client implementation
/// Handles requests from the agent (file access, terminals, permissions)
pub struct AthasAcpClient {
   app_handle: AppHandle,
   workspace_path: Option<String>,
   permission_tx: mpsc::Sender<PermissionResponse>,
   permission_rx: Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
   current_session_id: Arc<Mutex<Option<String>>>,
   terminal_manager: Arc<TerminalManager>,
   /// Maps ACP terminal IDs to terminal state (uses StdMutex for sync access from event listeners)
   terminal_states: Arc<StdMutex<HashMap<String, AcpTerminalState>>>,
}

impl AthasAcpClient {
   pub fn new(
      app_handle: AppHandle,
      workspace_path: Option<String>,
      terminal_manager: Arc<TerminalManager>,
   ) -> Self {
      let (permission_tx, permission_rx) = mpsc::channel(32);
      Self {
         app_handle,
         workspace_path,
         permission_tx,
         permission_rx: Arc::new(Mutex::new(permission_rx)),
         current_session_id: Arc::new(Mutex::new(None)),
         terminal_manager,
         terminal_states: Arc::new(StdMutex::new(HashMap::new())),
      }
   }

   pub fn permission_sender(&self) -> mpsc::Sender<PermissionResponse> {
      self.permission_tx.clone()
   }

   pub async fn set_session_id(&self, session_id: String) {
      let mut current = self.current_session_id.lock().await;
      *current = Some(session_id);
   }

   fn emit_event(&self, event: AcpEvent) {
      if let Err(e) = self.app_handle.emit("acp-event", &event) {
         log::error!("Failed to emit ACP event: {}", e);
      }
   }

   fn resolve_path(&self, path: &str) -> String {
      if let Some(ref workspace) = self.workspace_path
         && !path.starts_with('/')
         && !path.starts_with(workspace)
      {
         return format!("{}/{}", workspace, path);
      }
      path.to_string()
   }

   fn extract_first_url(text: &str) -> Option<String> {
      for scheme in ["https://", "http://"] {
         if let Some(start) = text.find(scheme) {
            let rest = &text[start..];
            let end = rest
               .find(|c: char| {
                  c.is_whitespace()
                     || matches!(c, '"' | '\'' | '`' | ')' | '}' | ']' | '|' | '<' | '>')
               })
               .unwrap_or(rest.len());
            let url = rest[..end].trim_end_matches(['.', ',', ';']);
            if !url.is_empty() {
               return Some(url.to_string());
            }
         }
      }
      None
   }

   fn extract_json_string_fields(text: &str, field: &str) -> Vec<String> {
      let mut values = Vec::new();
      let needle = format!("\"{}\"", field);
      let mut offset = 0usize;

      while let Some(rel_idx) = text[offset..].find(&needle) {
         let start = offset + rel_idx + needle.len();
         let Some(colon_rel) = text[start..].find(':') else {
            break;
         };
         let after_colon = start + colon_rel + 1;
         let rest = &text[after_colon..];
         let trimmed = rest.trim_start();
         let ws = rest.len().saturating_sub(trimmed.len());
         if !trimmed.starts_with('"') {
            offset = after_colon + ws + 1;
            continue;
         }

         let mut escaped = false;
         let mut end = None;
         for (i, ch) in trimmed[1..].char_indices() {
            if escaped {
               escaped = false;
               continue;
            }
            if ch == '\\' {
               escaped = true;
               continue;
            }
            if ch == '"' {
               end = Some(1 + i);
               break;
            }
         }

         if let Some(end_idx) = end {
            let value = &trimmed[1..end_idx];
            values.push(value.to_string());
            offset = after_colon + ws + end_idx + 1;
         } else {
            break;
         }
      }

      values
   }

   fn extract_webviewer_fallback_url(
      tool_title: &str,
      raw_input: Option<&serde_json::Value>,
   ) -> Option<String> {
      let raw_input_text = raw_input
         .and_then(|value| serde_json::to_string(value).ok())
         .unwrap_or_default();

      let references_webviewer = tool_title.contains("athas.openWebViewer")
         || raw_input_text.contains("athas.openWebViewer")
         || (raw_input_text.contains("openWebViewer") && raw_input_text.contains("ext_method"));

      if !references_webviewer {
         return None;
      }

      Self::extract_first_url(tool_title).or_else(|| Self::extract_first_url(&raw_input_text))
   }

   fn extract_terminal_fallback_command(
      tool_title: &str,
      raw_input: Option<&serde_json::Value>,
   ) -> Option<String> {
      let raw_input_text = raw_input
         .and_then(|value| serde_json::to_string(value).ok())
         .unwrap_or_default();

      let references_terminal = tool_title.contains("athas.openTerminal")
         || raw_input_text.contains("athas.openTerminal")
         || (raw_input_text.contains("openTerminal") && raw_input_text.contains("ext_method"));

      if !references_terminal {
         return None;
      }

      let candidates = Self::extract_json_string_fields(&raw_input_text, "command");
      for candidate in candidates {
         let candidate = candidate.trim();
         if candidate.is_empty() {
            continue;
         }
         if candidate.contains("ext_method") || candidate.contains("athas.openTerminal") {
            continue;
         }
         return Some(candidate.to_string());
      }

      if raw_input_text.contains("lazygit") || tool_title.contains("lazygit") {
         return Some("lazygit".to_string());
      }

      None
   }

   fn fallback_permission_response(
      args: &acp::RequestPermissionRequest,
   ) -> acp::RequestPermissionResponse {
      let selected_option = args
         .options
         .iter()
         .find(|opt| {
            matches!(
               opt.kind,
               acp::PermissionOptionKind::RejectOnce | acp::PermissionOptionKind::RejectAlways
            )
         })
         .or_else(|| args.options.first())
         .map(|opt| acp::SelectedPermissionOutcome::new(opt.option_id.clone()));

      if let Some(selected) = selected_option {
         acp::RequestPermissionResponse::new(acp::RequestPermissionOutcome::Selected(selected))
      } else {
         acp::RequestPermissionResponse::new(acp::RequestPermissionOutcome::Cancelled)
      }
   }
}

#[async_trait(?Send)]
impl acp::Client for AthasAcpClient {
   async fn request_permission(
      &self,
      args: acp::RequestPermissionRequest,
   ) -> acp::Result<acp::RequestPermissionResponse> {
      let request_id = uuid::Uuid::new_v4().to_string();
      let session_id = args.session_id.to_string();

      // Extract tool call info for the permission request
      let tool_call_id = args.tool_call.tool_call_id.clone();
      let tool_title = args
         .tool_call
         .fields
         .title
         .as_deref()
         .unwrap_or("Tool call");
      let fallback_webviewer_url =
         Self::extract_webviewer_fallback_url(tool_title, args.tool_call.fields.raw_input.as_ref());
      let fallback_terminal_command = Self::extract_terminal_fallback_command(
         tool_title,
         args.tool_call.fields.raw_input.as_ref(),
      );

      // Emit permission request to frontend
      self.emit_event(AcpEvent::PermissionRequest {
         request_id: request_id.clone(),
         permission_type: "tool_call".to_string(),
         resource: tool_call_id.to_string(),
         description: format!("{} ({})", tool_title, tool_call_id),
      });

      // Wait for user response with timeout
      let mut rx = self.permission_rx.lock().await;
      match tokio::time::timeout(std::time::Duration::from_secs(300), async {
         while let Some(response) = rx.recv().await {
            if response.request_id == request_id {
               return Some(response);
            }
         }
         None
      })
      .await
      {
         Ok(Some(response)) => {
            if response.cancelled {
               return Ok(acp::RequestPermissionResponse::new(
                  acp::RequestPermissionOutcome::Cancelled,
               ));
            }

            if response.approved {
               if let Some(url) = fallback_webviewer_url.clone() {
                  // Claude Code adapters may try to invoke ext_method via shell command.
                  // Execute the equivalent Athas UI action directly and reject the shell tool call.
                  self.emit_event(AcpEvent::UiAction {
                     session_id: session_id.clone(),
                     action: UiAction::OpenWebViewer { url },
                  });
                  return Ok(Self::fallback_permission_response(&args));
               }

               if let Some(command) = fallback_terminal_command.clone() {
                  // Same fallback for athas.openTerminal misuse through shell commands.
                  self.emit_event(AcpEvent::UiAction {
                     session_id: session_id.clone(),
                     action: UiAction::OpenTerminal {
                        command: Some(command),
                     },
                  });
                  return Ok(Self::fallback_permission_response(&args));
               }

               // Prefer allow-once/allow-always options if available
               let selected_option = args
                  .options
                  .iter()
                  .find(|opt| {
                     matches!(
                        opt.kind,
                        acp::PermissionOptionKind::AllowOnce
                           | acp::PermissionOptionKind::AllowAlways
                     )
                  })
                  .or_else(|| args.options.first())
                  .map(|opt| acp::SelectedPermissionOutcome::new(opt.option_id.clone()));

               if let Some(selected) = selected_option {
                  Ok(acp::RequestPermissionResponse::new(
                     acp::RequestPermissionOutcome::Selected(selected),
                  ))
               } else {
                  Ok(acp::RequestPermissionResponse::new(
                     acp::RequestPermissionOutcome::Cancelled,
                  ))
               }
            } else {
               // Prefer reject-once/reject-always options if available
               let selected_option = args
                  .options
                  .iter()
                  .find(|opt| {
                     matches!(
                        opt.kind,
                        acp::PermissionOptionKind::RejectOnce
                           | acp::PermissionOptionKind::RejectAlways
                     )
                  })
                  .or_else(|| args.options.first())
                  .map(|opt| acp::SelectedPermissionOutcome::new(opt.option_id.clone()));

               if let Some(selected) = selected_option {
                  Ok(acp::RequestPermissionResponse::new(
                     acp::RequestPermissionOutcome::Selected(selected),
                  ))
               } else {
                  Ok(acp::RequestPermissionResponse::new(
                     acp::RequestPermissionOutcome::Cancelled,
                  ))
               }
            }
         }
         _ => Ok(acp::RequestPermissionResponse::new(
            acp::RequestPermissionOutcome::Cancelled,
         )),
      }
   }

   async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
      let session_id = args.session_id.to_string();

      match args.update {
         acp::SessionUpdate::AgentMessageChunk(chunk) => {
            let content = match chunk.content {
               acp::ContentBlock::Text(text) => AcpContentBlock::Text { text: text.text },
               acp::ContentBlock::Image(img) => AcpContentBlock::Image {
                  data: img.data,
                  media_type: img.mime_type,
               },
               acp::ContentBlock::ResourceLink(link) => AcpContentBlock::Resource {
                  uri: link.uri,
                  name: Some(link.name),
               },
               _ => return Ok(()),
            };

            self.emit_event(AcpEvent::ContentChunk {
               session_id,
               content,
               is_complete: false,
            });
         }
         acp::SessionUpdate::ToolCall(tool_call) => {
            // ToolCall has: tool_call_id, title, kind, status, content, etc.
            // Content may contain the input; we serialize the whole content for display
            let input = if tool_call.content.is_empty() {
               serde_json::Value::Null
            } else {
               serde_json::to_value(&tool_call.content).unwrap_or(serde_json::Value::Null)
            };

            self.emit_event(AcpEvent::ToolStart {
               session_id,
               tool_name: tool_call.title.clone(),
               tool_id: tool_call.tool_call_id.to_string(),
               input,
            });
         }
         acp::SessionUpdate::ToolCallUpdate(update) => {
            // Check tool status to determine success
            // ToolCallUpdate has fields: kind, status, title, content, etc.
            let success = matches!(
               update.fields.status,
               None
                  | Some(
                     acp::ToolCallStatus::Pending
                        | acp::ToolCallStatus::InProgress
                        | acp::ToolCallStatus::Completed
                  )
            );

            self.emit_event(AcpEvent::ToolComplete {
               session_id,
               tool_id: update.tool_call_id.to_string(),
               success,
            });
         }
         acp::SessionUpdate::CurrentModeUpdate(update) => {
            // Handle current mode change
            self.emit_event(AcpEvent::CurrentModeUpdate {
               session_id,
               current_mode_id: update.current_mode_id.to_string(),
            });
         }
         acp::SessionUpdate::AvailableCommandsUpdate(commands_update) => {
            self.emit_event(AcpEvent::SlashCommandsUpdate {
               session_id,
               commands: commands_update
                  .available_commands
                  .iter()
                  .map(|c| super::types::SlashCommand {
                     name: c.name.clone(),
                     description: c.description.clone(),
                     input: c.input.as_ref().and_then(|input| {
                        // Extract hint from unstructured command input
                        if let acp::AvailableCommandInput::Unstructured(unstructured) = input {
                           Some(super::types::SlashCommandInput {
                              hint: unstructured.hint.clone(),
                           })
                        } else {
                           None
                        }
                     }),
                  })
                  .collect(),
            });
         }
         _ => {
            // Handle other session updates as needed
         }
      }
      Ok(())
   }

   async fn read_text_file(
      &self,
      args: acp::ReadTextFileRequest,
   ) -> acp::Result<acp::ReadTextFileResponse> {
      let path_str = args.path.to_string_lossy();
      let path = self.resolve_path(&path_str);
      match tokio::fs::read_to_string(&path).await {
         Ok(content) => {
            // Handle line and limit parameters for partial file reading
            let result = if args.line.is_some() || args.limit.is_some() {
               let lines: Vec<&str> = content.lines().collect();
               let start_line = args.line.unwrap_or(1).saturating_sub(1) as usize;
               let limit = args.limit.map(|l| l as usize).unwrap_or(lines.len());

               lines
                  .iter()
                  .skip(start_line)
                  .take(limit)
                  .copied()
                  .collect::<Vec<_>>()
                  .join("\n")
            } else {
               content
            };
            Ok(acp::ReadTextFileResponse::new(result))
         }
         Err(e) => Err(acp::Error::new(
            -32603,
            format!("Failed to read file: {}", e),
         )),
      }
   }

   async fn write_text_file(
      &self,
      args: acp::WriteTextFileRequest,
   ) -> acp::Result<acp::WriteTextFileResponse> {
      let path_str = args.path.to_string_lossy();
      let path = self.resolve_path(&path_str);

      // Create parent directories if needed
      if let Some(parent) = std::path::Path::new(&path).parent()
         && let Err(e) = tokio::fs::create_dir_all(parent).await
      {
         log::warn!("Failed to create parent directories: {}", e);
      }

      match tokio::fs::write(&path, &args.content).await {
         Ok(_) => {
            // Emit file change event so frontend can refresh
            let _ = self.app_handle.emit("file-changed", &path);
            Ok(acp::WriteTextFileResponse::new())
         }
         Err(e) => Err(acp::Error::new(
            -32603,
            format!("Failed to write file: {}", e),
         )),
      }
   }

   async fn create_terminal(
      &self,
      args: acp::CreateTerminalRequest,
   ) -> acp::Result<acp::CreateTerminalResponse> {
      let working_dir = args
         .cwd
         .map(|p| p.to_string_lossy().to_string())
         .or_else(|| self.workspace_path.clone());

      let env_map: Option<HashMap<String, String>> = if args.env.is_empty() {
         None
      } else {
         Some(args.env.into_iter().map(|e| (e.name, e.value)).collect())
      };

      // Build the full command with arguments
      let full_command = if args.args.is_empty() {
         args.command.clone()
      } else {
         // Quote arguments that contain spaces or special characters
         let quoted_args: Vec<String> = args
            .args
            .iter()
            .map(|arg| {
               if arg.contains(' ') || arg.contains('"') || arg.contains('\'') {
                  format!("'{}'", arg.replace('\'', "'\\''"))
               } else {
                  arg.clone()
               }
            })
            .collect();
         format!("{} {}", args.command, quoted_args.join(" "))
      };

      let config = TerminalConfig {
         working_directory: working_dir,
         shell: None,
         environment: env_map,
         rows: 24,
         cols: 80,
      };

      match self
         .terminal_manager
         .create_terminal(config, self.app_handle.clone())
      {
         Ok(athas_terminal_id) => {
            let terminal_id = athas_terminal_id.clone();
            let output_limit = args.output_byte_limit.map(|l| l as u32);
            let state = AcpTerminalState::new(athas_terminal_id.clone(), output_limit);

            // Execute the command in the terminal
            if let Err(e) = self
               .terminal_manager
               .write_to_terminal(&athas_terminal_id, &format!("{}\n", full_command))
            {
               log::warn!("Failed to write command to terminal: {}", e);
            }
            {
               let mut states = self.terminal_states.lock().unwrap();
               states.insert(terminal_id.clone(), state);
            }

            // Set up output listener
            let output_event = format!("pty-output-{}", athas_terminal_id);
            let states_clone = self.terminal_states.clone();
            let terminal_id_clone = terminal_id.clone();
            self.app_handle.listen(output_event, move |event| {
               let payload = event.payload();
               if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(payload) {
                  if let Some(data) = parsed.get("data").and_then(|d| d.as_str()) {
                     if let Ok(mut states) = states_clone.lock() {
                        if let Some(state) = states.get_mut(&terminal_id_clone) {
                           state.append_output(data);
                        }
                     }
                  }
               }
            });

            // Set up close listener
            let close_event = format!("pty-closed-{}", athas_terminal_id);
            let states_clone = self.terminal_states.clone();
            let terminal_id_clone = terminal_id.clone();
            self.app_handle.listen(close_event, move |_| {
               if let Ok(mut states) = states_clone.lock() {
                  if let Some(state) = states.get_mut(&terminal_id_clone) {
                     state.set_exit_status(Some(0), None);
                  }
               }
            });

            log::info!("ACP terminal created: {}", terminal_id);
            Ok(acp::CreateTerminalResponse::new(terminal_id))
         }
         Err(e) => {
            log::error!("Failed to create ACP terminal: {}", e);
            Err(acp::Error::new(
               -32603,
               format!("Failed to create terminal: {}", e),
            ))
         }
      }
   }

   async fn terminal_output(
      &self,
      args: acp::TerminalOutputRequest,
   ) -> acp::Result<acp::TerminalOutputResponse> {
      let terminal_id = args.terminal_id.to_string();
      let mut states = self
         .terminal_states
         .lock()
         .map_err(|_| acp::Error::new(-32603, "Lock poisoned".to_string()))?;

      let state = states
         .get_mut(&terminal_id)
         .ok_or_else(|| acp::Error::new(-32603, "Terminal not found".to_string()))?;

      let output = std::mem::take(&mut state.output_buffer);
      let truncated = state.truncated;
      state.truncated = false;

      Ok(acp::TerminalOutputResponse::new(output, truncated))
   }

   async fn release_terminal(
      &self,
      args: acp::ReleaseTerminalRequest,
   ) -> acp::Result<acp::ReleaseTerminalResponse> {
      let terminal_id = args.terminal_id.to_string();
      let removed_state = {
         let mut states = self
            .terminal_states
            .lock()
            .map_err(|_| acp::Error::new(-32603, "Lock poisoned".to_string()))?;
         states.remove(&terminal_id)
      };

      if let Some(state) = removed_state {
         if let Err(e) = self
            .terminal_manager
            .close_terminal(&state.athas_terminal_id)
         {
            log::warn!("Failed to close terminal {}: {}", terminal_id, e);
         }
      }

      Ok(acp::ReleaseTerminalResponse::new())
   }

   async fn wait_for_terminal_exit(
      &self,
      args: acp::WaitForTerminalExitRequest,
   ) -> acp::Result<acp::WaitForTerminalExitResponse> {
      let terminal_id = args.terminal_id.to_string();

      let receiver = {
         let mut states = self
            .terminal_states
            .lock()
            .map_err(|_| acp::Error::new(-32603, "Lock poisoned".to_string()))?;

         let state = states
            .get_mut(&terminal_id)
            .ok_or_else(|| acp::Error::new(-32603, "Terminal not found".to_string()))?;

         if let Some(status) = state.exit_status.clone() {
            return Ok(acp::WaitForTerminalExitResponse::new(status));
         }

         let (tx, rx) = oneshot::channel();
         state.exit_waiters.push(tx);
         rx
      };

      match receiver.await {
         Ok(status) => Ok(acp::WaitForTerminalExitResponse::new(status)),
         Err(_) => {
            let exit_status = acp::TerminalExitStatus::new().exit_code(1);
            Ok(acp::WaitForTerminalExitResponse::new(exit_status))
         }
      }
   }

   async fn kill_terminal_command(
      &self,
      args: acp::KillTerminalCommandRequest,
   ) -> acp::Result<acp::KillTerminalCommandResponse> {
      let terminal_id = args.terminal_id.to_string();
      let athas_id = {
         let states = self
            .terminal_states
            .lock()
            .map_err(|_| acp::Error::new(-32603, "Lock poisoned".to_string()))?;
         states
            .get(&terminal_id)
            .map(|s| s.athas_terminal_id.clone())
      };

      if let Some(athas_terminal_id) = athas_id {
         if let Err(e) = self.terminal_manager.close_terminal(&athas_terminal_id) {
            log::warn!("Failed to kill terminal {}: {}", terminal_id, e);
         }
      }

      Ok(acp::KillTerminalCommandResponse::new())
   }

   async fn ext_method(&self, args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
      let session_id = self
         .current_session_id
         .lock()
         .await
         .clone()
         .unwrap_or_default();

      // Parse params from RawValue to Value for easier access
      let params: serde_json::Value =
         serde_json::from_str(args.params.get()).unwrap_or(serde_json::Value::Null);

      match &*args.method {
         "athas.openWebViewer" => {
            let url = params
               .get("url")
               .and_then(|v| v.as_str())
               .unwrap_or("about:blank")
               .to_string();

            self.emit_event(AcpEvent::UiAction {
               session_id,
               action: UiAction::OpenWebViewer { url },
            });

            let response = serde_json::json!({ "success": true });
            Ok(acp::ExtResponse::new(
               serde_json::value::to_raw_value(&response).unwrap().into(),
            ))
         }
         "athas.openTerminal" => {
            let command = params
               .get("command")
               .and_then(|v| v.as_str())
               .map(|s| s.to_string());

            self.emit_event(AcpEvent::UiAction {
               session_id,
               action: UiAction::OpenTerminal { command },
            });

            let response = serde_json::json!({ "success": true });
            Ok(acp::ExtResponse::new(
               serde_json::value::to_raw_value(&response).unwrap().into(),
            ))
         }
         _ => Err(acp::Error::method_not_found()),
      }
   }

   async fn ext_notification(&self, args: acp::ExtNotification) -> acp::Result<()> {
      // Log extension notifications for debugging
      log::debug!(
         "ACP extension notification: method={}, params={}",
         args.method,
         args.params.get()
      );
      Ok(())
   }
}
