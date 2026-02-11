use super::types::{AcpContentBlock, AcpEvent, AcpToolStatus};
use agent_client_protocol as acp;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, mpsc};

/// Response for permission requests
pub struct PermissionResponse {
   pub request_id: String,
   pub approved: bool,
   pub cancelled: bool,
}

#[derive(Clone)]
struct ActiveToolState {
   name: String,
   input: serde_json::Value,
   kind: Option<String>,
}

/// Athas ACP Client implementation
/// Handles requests from the agent (file access, terminals, permissions)
pub struct AthasAcpClient {
   app_handle: AppHandle,
   agent_id: String,
   workspace_path: Option<String>,
   permission_tx: mpsc::Sender<PermissionResponse>,
   permission_rx: Arc<Mutex<mpsc::Receiver<PermissionResponse>>>,
   current_session_id: Arc<Mutex<Option<String>>>,
   active_tools: Arc<Mutex<HashMap<String, ActiveToolState>>>,
}

impl AthasAcpClient {
   pub fn new(app_handle: AppHandle, agent_id: String, workspace_path: Option<String>) -> Self {
      let (permission_tx, permission_rx) = mpsc::channel(32);
      Self {
         app_handle,
         agent_id,
         workspace_path,
         permission_tx,
         permission_rx: Arc::new(Mutex::new(permission_rx)),
         current_session_id: Arc::new(Mutex::new(None)),
         active_tools: Arc::new(Mutex::new(HashMap::new())),
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

   fn map_tool_status(status: acp::ToolCallStatus) -> AcpToolStatus {
      match status {
         acp::ToolCallStatus::Pending => AcpToolStatus::Pending,
         acp::ToolCallStatus::InProgress => AcpToolStatus::InProgress,
         acp::ToolCallStatus::Completed => AcpToolStatus::Completed,
         acp::ToolCallStatus::Failed => AcpToolStatus::Failed,
         _ => AcpToolStatus::InProgress,
      }
   }

   fn map_tool_kind(kind: acp::ToolKind) -> String {
      match kind {
         acp::ToolKind::Read => "read".to_string(),
         acp::ToolKind::Edit => "edit".to_string(),
         acp::ToolKind::Delete => "delete".to_string(),
         acp::ToolKind::Move => "move".to_string(),
         acp::ToolKind::Search => "search".to_string(),
         acp::ToolKind::Execute => "execute".to_string(),
         acp::ToolKind::Think => "think".to_string(),
         acp::ToolKind::Fetch => "fetch".to_string(),
         acp::ToolKind::SwitchMode => "switch_mode".to_string(),
         _ => "other".to_string(),
      }
   }

   fn extract_error(raw_output: &Option<serde_json::Value>) -> Option<String> {
      let Some(raw) = raw_output else {
         return None;
      };

      if let Some(error) = raw.get("error").and_then(|v| v.as_str()) {
         return Some(error.to_string());
      }

      if let Some(message) = raw.get("message").and_then(|v| v.as_str()) {
         return Some(message.to_string());
      }

      None
   }
}

#[async_trait(?Send)]
impl acp::Client for AthasAcpClient {
   async fn request_permission(
      &self,
      args: acp::RequestPermissionRequest,
   ) -> acp::Result<acp::RequestPermissionResponse> {
      let request_id = uuid::Uuid::new_v4().to_string();

      // Extract tool call info for the permission request
      let tool_call_id = args.tool_call.tool_call_id.clone();

      // Emit permission request to frontend
      self.emit_event(AcpEvent::PermissionRequest {
         request_id: request_id.clone(),
         permission_type: "tool_call".to_string(),
         resource: tool_call_id.to_string(),
         description: format!("Tool call: {}", tool_call_id),
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
            let tool_id = tool_call.tool_call_id.to_string();
            let input = tool_call
               .raw_input
               .clone()
               .unwrap_or(serde_json::Value::Null);
            let kind = Some(Self::map_tool_kind(tool_call.kind));
            let status = Some(Self::map_tool_status(tool_call.status));
            let content = serde_json::to_value(&tool_call.content).ok();
            let locations = serde_json::to_value(&tool_call.locations).ok();
            {
               let mut active_tools = self.active_tools.lock().await;
               active_tools.insert(
                  tool_id.clone(),
                  ActiveToolState {
                     name: tool_call.title.clone(),
                     input: input.clone(),
                     kind: kind.clone(),
                  },
               );
            }
            self.emit_event(AcpEvent::ToolStart {
               session_id,
               tool_name: tool_call.title.clone(),
               tool_id: tool_id.clone(),
               input,
               status,
               kind,
               content,
               locations,
            });
         }
         acp::SessionUpdate::ToolCallUpdate(update) => {
            let tool_id = update.tool_call_id.to_string();
            let fields = update.fields.clone();
            let status_raw = fields.status.unwrap_or(acp::ToolCallStatus::Completed);
            let status = Some(Self::map_tool_status(status_raw));
            let success = !matches!(status_raw, acp::ToolCallStatus::Failed);
            let kind = fields.kind.map(Self::map_tool_kind);
            let content = fields
               .content
               .as_ref()
               .and_then(|items| serde_json::to_value(items).ok());
            let locations = fields
               .locations
               .as_ref()
               .and_then(|items| serde_json::to_value(items).ok());

            let (tool_name, input, fallback_kind) = {
               let mut active_tools = self.active_tools.lock().await;
               let previous = active_tools.get(&tool_id).cloned();

               let tool_name = fields
                  .title
                  .clone()
                  .or_else(|| previous.as_ref().map(|t| t.name.clone()))
                  .unwrap_or_else(|| "unknown".to_string());

               let input = fields
                  .raw_input
                  .clone()
                  .or_else(|| previous.as_ref().map(|t| t.input.clone()));

               let fallback_kind = previous.and_then(|t| t.kind);

               if matches!(
                  status_raw,
                  acp::ToolCallStatus::Completed | acp::ToolCallStatus::Failed
               ) {
                  active_tools.remove(&tool_id);
               } else {
                  active_tools.insert(
                     tool_id.clone(),
                     ActiveToolState {
                        name: tool_name.clone(),
                        input: input.clone().unwrap_or(serde_json::Value::Null),
                        kind: kind.clone().or(fallback_kind.clone()),
                     },
                  );
               }

               (tool_name, input, fallback_kind)
            };

            let output = fields.raw_output.clone();
            let error = if success {
               None
            } else {
               Self::extract_error(&output).or_else(|| Some("Tool execution failed".to_string()))
            };

            self.emit_event(AcpEvent::ToolComplete {
               session_id,
               tool_id,
               success,
               tool_name: Some(tool_name),
               input,
               output,
               error,
               status,
               kind: kind.or(fallback_kind),
               content,
               locations,
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

   async fn ext_method(&self, _args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
      Err(acp::Error::method_not_found())
   }

   async fn ext_notification(&self, _args: acp::ExtNotification) -> acp::Result<()> {
      Ok(())
   }
}
