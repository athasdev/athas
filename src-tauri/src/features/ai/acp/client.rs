use super::types::{AcpContentBlock, AcpEvent, UiAction};
use agent_client_protocol as acp;
use async_trait::async_trait;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, mpsc};

/// Response for permission requests
pub struct PermissionResponse {
   pub request_id: String,
   pub approved: bool,
   pub cancelled: bool,
}

/// Athas ACP Client implementation
/// Handles requests from the agent (file access, terminals, permissions)
pub struct AthasAcpClient {
   app_handle: AppHandle,
   workspace_path: Option<String>,
   permission_tx: mpsc::Sender<PermissionResponse>,
   permission_rx: Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
   current_session_id: Arc<Mutex<Option<String>>>,
}

impl AthasAcpClient {
   pub fn new(app_handle: AppHandle, workspace_path: Option<String>) -> Self {
      let (permission_tx, permission_rx) = mpsc::channel(32);
      Self {
         app_handle,
         workspace_path,
         permission_tx,
         permission_rx: Arc::new(Mutex::new(permission_rx)),
         current_session_id: Arc::new(Mutex::new(None)),
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
            self.emit_event(AcpEvent::ToolStart {
               session_id,
               tool_name: tool_call.title.clone(),
               tool_id: tool_call.tool_call_id.to_string(),
               input: serde_json::Value::Null, // Input is in content blocks now
            });
         }
         acp::SessionUpdate::ToolCallUpdate(update) => {
            // Check for completion via fields
            self.emit_event(AcpEvent::ToolComplete {
               session_id,
               tool_id: update.tool_call_id.to_string(),
               success: true,
            });
         }
         acp::SessionUpdate::CurrentModeUpdate(update) => {
            // Handle current mode change
            self.emit_event(AcpEvent::CurrentModeUpdate {
               session_id,
               current_mode_id: update.current_mode_id.to_string(),
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
         Ok(content) => Ok(acp::ReadTextFileResponse::new(content)),
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
      _args: acp::CreateTerminalRequest,
   ) -> acp::Result<acp::CreateTerminalResponse> {
      // TODO: Integrate with existing TerminalManager
      Err(acp::Error::method_not_found())
   }

   async fn terminal_output(
      &self,
      _args: acp::TerminalOutputRequest,
   ) -> acp::Result<acp::TerminalOutputResponse> {
      Err(acp::Error::method_not_found())
   }

   async fn release_terminal(
      &self,
      _args: acp::ReleaseTerminalRequest,
   ) -> acp::Result<acp::ReleaseTerminalResponse> {
      Err(acp::Error::method_not_found())
   }

   async fn wait_for_terminal_exit(
      &self,
      _args: acp::WaitForTerminalExitRequest,
   ) -> acp::Result<acp::WaitForTerminalExitResponse> {
      Err(acp::Error::method_not_found())
   }

   async fn kill_terminal_command(
      &self,
      _args: acp::KillTerminalCommandRequest,
   ) -> acp::Result<acp::KillTerminalCommandResponse> {
      Err(acp::Error::method_not_found())
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

   async fn ext_notification(&self, _args: acp::ExtNotification) -> acp::Result<()> {
      Ok(())
   }
}
