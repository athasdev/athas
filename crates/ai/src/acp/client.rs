use super::{
   AcpConnection,
   file_access::{self, FileAccess, OutsideAccess},
   terminal_state::{AcpTerminalState, take_session_terminals},
   types::{
      ACP_BUFFER_READ_EVENT, AcpBufferReadRequest, AcpContentBlock, AcpEvent,
      AcpPermissionToolCall, AcpPlanEntry, AcpPlanEntryPriority, AcpPlanEntryStatus,
      AcpToolCallLocation, AcpToolCallStatus, AcpToolKind, AcpUsageUpdate, SessionConfigOption,
      SessionConfigOptionKind, SessionConfigOptionValue, UiAction,
   },
   workspace_path::{is_inside_roots, path_to_string, real_path, resolve_path_against_workspace},
};
use crate::runtime::AthasAppHandle as AppHandle;
use agent_client_protocol::{self as acp_sdk, schema::v1 as acp};
use athas_terminal::{
   TerminalConfig, TerminalEvent, TerminalEventHandler, TerminalManager, TerminalSize,
};
use std::{
   collections::{HashMap, HashSet},
   path::{Path, PathBuf},
   sync::{Arc, Mutex as StdMutex},
};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, oneshot};

/// Response for permission requests
pub struct PermissionResponse {
   pub approved: bool,
   pub cancelled: bool,
   pub option_id: Option<String>,
}

/// An agent request waiting on the user, with the session it belongs to so a cancelled prompt
/// turn can resolve it. `None` for request-scoped questions that belong to no session.
pub struct PendingEntry<T> {
   session_id: Option<String>,
   tx: oneshot::Sender<T>,
}

impl<T> PendingEntry<T> {
   pub fn new(session_id: Option<String>, tx: oneshot::Sender<T>) -> Self {
      Self { session_id, tx }
   }
}

/// Agent requests waiting on the user, keyed by the request id sent to the frontend.
pub type Pending<T> = Arc<StdMutex<HashMap<String, PendingEntry<T>>>>;

/// Where the bridge delivers the user's answers to waiting agent requests. Elicitation answers are
/// ACP `CreateElicitationResponse` JSON.
#[derive(Clone)]
pub struct ClientResponders {
   pub permissions: Pending<PermissionResponse>,
   pub elicitations: Pending<serde_json::Value>,
   pub buffer_reads: BufferReads,
}

impl ClientResponders {
   /// Hands the user's answer to the request waiting for it. False when nothing waits anymore: the
   /// agent cancelled it, it timed out, or it was already answered.
   pub fn answer_permission(&self, request_id: &str, response: PermissionResponse) -> bool {
      take_pending(&self.permissions, request_id)
         .is_some_and(|entry| entry.tx.send(response).is_ok())
   }

   pub fn answer_elicitation(&self, request_id: &str, response: serde_json::Value) -> bool {
      take_pending(&self.elicitations, request_id)
         .is_some_and(|entry| entry.tx.send(response).is_ok())
   }

   /// Takes one editor window's answer to a buffer read. The first window with the file open
   /// answers the read; once every window said it is not open, the read goes to the disk.
   pub fn answer_buffer_read(&self, request_id: &str, content: Option<String>) -> bool {
      let mut reads = self
         .buffer_reads
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner());
      let Some(read) = reads.get_mut(request_id) else {
         return false;
      };
      if content.is_none() && read.unanswered_windows > 1 {
         read.unanswered_windows -= 1;
         return true;
      }
      reads
         .remove(request_id)
         .is_some_and(|read| read.tx.send(content).is_ok())
   }

   pub fn has_permission(&self, request_id: &str) -> bool {
      is_pending(&self.permissions, request_id)
   }

   pub fn has_elicitation(&self, request_id: &str) -> bool {
      is_pending(&self.elicitations, request_id)
   }

   pub fn has_buffer_read(&self, request_id: &str) -> bool {
      self
         .buffer_reads
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
         .contains_key(request_id)
   }

   /// Whether the agent is waiting on the user for anything: a permission or a question.
   pub fn has_pending(&self) -> bool {
      fn waiting<T>(pending: &Pending<T>) -> bool {
         !pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty()
      }
      waiting(&self.permissions) || waiting(&self.elicitations)
   }

   /// Resolves what a cancelled prompt turn leaves waiting on the user: the session's permission
   /// requests get the `cancelled` outcome and its questions a `cancel` action, as ACP requires
   /// after `session/cancel`. Request-scoped questions are cancelled too, since the frontend shows
   /// them with the running prompt. Returns the request ids so the UI can withdraw them.
   pub fn cancel_session(&self, session_id: &str) -> Vec<String> {
      let mut closed = Vec::new();
      for (request_id, entry) in drain_session(&self.permissions, session_id, false) {
         let _ = entry.tx.send(PermissionResponse {
            approved: false,
            cancelled: true,
            option_id: None,
         });
         closed.push(request_id);
      }
      for (request_id, entry) in drain_session(&self.elicitations, session_id, true) {
         let _ = entry.tx.send(serde_json::json!({ "action": "cancel" }));
         closed.push(request_id);
      }
      closed
   }
}

fn is_pending<T>(pending: &Pending<T>, request_id: &str) -> bool {
   pending
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
      .contains_key(request_id)
}

fn take_pending<T>(pending: &Pending<T>, request_id: &str) -> Option<PendingEntry<T>> {
   pending
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
      .remove(request_id)
}

/// Removes the entries that belong to `session_id` (and, with `include_unscoped`, those that
/// belong to no session).
fn drain_session<T>(
   pending: &Pending<T>,
   session_id: &str,
   include_unscoped: bool,
) -> Vec<(String, PendingEntry<T>)> {
   let mut pending = pending
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
   let request_ids: Vec<String> = pending
      .iter()
      .filter(|(_, entry)| match entry.session_id.as_deref() {
         Some(owner) => owner == session_id,
         None => include_unscoped,
      })
      .map(|(request_id, _)| request_id.clone())
      .collect();
   request_ids
      .into_iter()
      .filter_map(|request_id| pending.remove(&request_id).map(|entry| (request_id, entry)))
      .collect()
}

/// A `fs/read_text_file` waiting to hear from the editor windows whether they have the file open.
pub struct BufferReadWait {
   unanswered_windows: usize,
   tx: oneshot::Sender<Option<String>>,
}

/// Buffer reads waiting on the editor windows, keyed by the request id sent with them.
pub type BufferReads = Arc<StdMutex<HashMap<String, BufferReadWait>>>;

/// Frees a buffer read's slot however the read ends.
struct PendingBufferRead {
   reads: BufferReads,
   request_id: String,
}

impl PendingBufferRead {
   fn open(reads: &BufferReads, windows: usize) -> (Self, oneshot::Receiver<Option<String>>) {
      let request_id = uuid::Uuid::new_v4().to_string();
      let (tx, rx) = oneshot::channel();
      reads
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
         .insert(
            request_id.clone(),
            BufferReadWait {
               unanswered_windows: windows,
               tx,
            },
         );
      let read = Self {
         reads: reads.clone(),
         request_id,
      };
      (read, rx)
   }
}

impl Drop for PendingBufferRead {
   fn drop(&mut self) {
      self
         .reads
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
         .remove(&self.request_id);
   }
}

/// A request the frontend is showing the user. However its handler ends (answered, timed out, or
/// dropped because the agent sent `$/cancel_request`), the slot is freed, and a prompt nobody
/// answered is withdrawn from the UI with a `request_closed` event.
struct PendingRequest<T> {
   pending: Pending<T>,
   request_id: String,
   app_handle: AppHandle,
}

impl<T> PendingRequest<T> {
   fn open(
      pending: &Pending<T>,
      app_handle: &AppHandle,
      session_id: Option<String>,
   ) -> (Self, oneshot::Receiver<T>) {
      let request_id = uuid::Uuid::new_v4().to_string();
      let (tx, rx) = oneshot::channel();
      pending
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
         .insert(request_id.clone(), PendingEntry::new(session_id, tx));
      let request = Self {
         pending: pending.clone(),
         request_id,
         app_handle: app_handle.clone(),
      };
      (request, rx)
   }
}

impl<T> Drop for PendingRequest<T> {
   fn drop(&mut self) {
      if take_pending(&self.pending, &self.request_id).is_some() {
         let event = AcpEvent::RequestClosed {
            request_id: self.request_id.clone(),
         };
         if let Err(e) = self.app_handle.emit("acp-event", &event) {
            log::error!("Failed to emit ACP event: {}", e);
         }
      }
   }
}

/// How long a permission prompt waits for the user before the request is refused.
const PERMISSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// How long a read waits for the editor to hand over an open file before it reads the disk.
const BUFFER_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// How long an agent question waits for the user before it is cancelled.
const ELICITATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

/// Athas ACP Client implementation
/// Handles requests from the agent (file access, terminals, permissions)
pub struct AthasAcpClient {
   app_handle: AppHandle,
   workspace_path: Option<PathBuf>,
   /// Where the workspace really is on disk; agent file access outside these asks the user.
   workspace_roots: Vec<PathBuf>,
   /// Folders outside the workspace the user let each session read from, by session id.
   outside_read_grants: StdMutex<HashMap<String, HashSet<PathBuf>>>,
   pending_permissions: Pending<PermissionResponse>,
   pending_elicitations: Pending<serde_json::Value>,
   pending_buffer_reads: BufferReads,
   current_session_id: Arc<Mutex<Option<String>>>,
   terminal_manager: Arc<TerminalManager>,
   /// Maps ACP terminal IDs to terminal state (uses StdMutex for sync access from event listeners)
   terminal_states: Arc<StdMutex<HashMap<String, AcpTerminalState>>>,
}

impl AthasAcpClient {
   pub fn new(
      app_handle: AppHandle,
      workspace_path: Option<PathBuf>,
      terminal_manager: Arc<TerminalManager>,
   ) -> Self {
      let workspace_roots = workspace_path
         .as_deref()
         .and_then(|path| std::fs::canonicalize(path).ok())
         .into_iter()
         .collect();
      Self {
         app_handle,
         workspace_path,
         workspace_roots,
         outside_read_grants: StdMutex::default(),
         pending_permissions: Arc::default(),
         pending_elicitations: Arc::default(),
         pending_buffer_reads: Arc::default(),
         current_session_id: Arc::new(Mutex::new(None)),
         terminal_manager,
         terminal_states: Arc::new(StdMutex::new(HashMap::new())),
      }
   }

   pub fn responders(&self) -> ClientResponders {
      ClientResponders {
         permissions: self.pending_permissions.clone(),
         elicitations: self.pending_elicitations.clone(),
         buffer_reads: self.pending_buffer_reads.clone(),
      }
   }

   /// Records the session that most recently opened or received a prompt. Extension requests
   /// carry no session, so ones without a `sessionId` param are attributed to it.
   pub async fn set_session_id(&self, session_id: String) {
      let mut current = self.current_session_id.lock().await;
      *current = Some(session_id);
   }

   /// Frees what a closed session held: its terminals and the folders outside the workspace the
   /// user let it read. `None` frees everything, for when the agent itself stops.
   pub async fn release_session(&self, session_id: Option<&str>) {
      let released = {
         let mut states = self
            .terminal_states
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
         take_session_terminals(&mut states, session_id)
      };
      for state in released {
         if let Err(e) = self
            .terminal_manager
            .close_terminal(&state.athas_terminal_id)
         {
            log::warn!(
               "Failed to close terminal {}: {}",
               state.athas_terminal_id,
               e
            );
         }
      }

      {
         let mut grants = self
            .outside_read_grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
         match session_id {
            Some(session_id) => {
               grants.remove(session_id);
            }
            None => grants.clear(),
         }
      }

      let mut current = self.current_session_id.lock().await;
      if session_id.is_none() || current.as_deref() == session_id {
         *current = None;
      }
   }

   fn emit_event(&self, event: AcpEvent) {
      if let Err(e) = self.app_handle.emit("acp-event", &event) {
         log::error!("Failed to emit ACP event: {}", e);
      }
   }

   fn resolve_path(&self, path: &str) -> PathBuf {
      resolve_path_against_workspace(self.workspace_path.as_deref(), path)
   }

   fn map_plan_priority(priority: acp::PlanEntryPriority) -> AcpPlanEntryPriority {
      match priority {
         acp::PlanEntryPriority::High => AcpPlanEntryPriority::High,
         acp::PlanEntryPriority::Medium => AcpPlanEntryPriority::Medium,
         acp::PlanEntryPriority::Low => AcpPlanEntryPriority::Low,
         _ => AcpPlanEntryPriority::Medium,
      }
   }

   fn map_plan_status(status: acp::PlanEntryStatus) -> AcpPlanEntryStatus {
      match status {
         acp::PlanEntryStatus::Pending => AcpPlanEntryStatus::Pending,
         acp::PlanEntryStatus::InProgress => AcpPlanEntryStatus::InProgress,
         acp::PlanEntryStatus::Completed => AcpPlanEntryStatus::Completed,
         _ => AcpPlanEntryStatus::Pending,
      }
   }

   fn map_content_block(content: acp::ContentBlock) -> Option<AcpContentBlock> {
      match content {
         acp::ContentBlock::Text(text) => Some(AcpContentBlock::Text { text: text.text }),
         acp::ContentBlock::Image(img) => Some(AcpContentBlock::Image {
            data: img.data,
            media_type: img.mime_type,
         }),
         acp::ContentBlock::Audio(audio) => Some(AcpContentBlock::Audio {
            data: audio.data,
            media_type: audio.mime_type,
         }),
         acp::ContentBlock::ResourceLink(link) => Some(AcpContentBlock::Resource {
            uri: link.uri,
            name: Some(link.name),
            mime_type: link.mime_type,
            text: None,
            blob: None,
            title: link.title,
            description: link.description,
            size: link.size,
         }),
         acp::ContentBlock::Resource(resource) => match resource.resource {
            acp::EmbeddedResourceResource::TextResourceContents(text) => {
               Some(AcpContentBlock::Resource {
                  uri: text.uri,
                  name: None,
                  mime_type: text.mime_type,
                  text: Some(text.text),
                  blob: None,
                  title: None,
                  description: None,
                  size: None,
               })
            }
            acp::EmbeddedResourceResource::BlobResourceContents(blob) => {
               Some(AcpContentBlock::Resource {
                  uri: blob.uri,
                  name: None,
                  mime_type: blob.mime_type,
                  text: None,
                  blob: Some(blob.blob),
                  title: None,
                  description: None,
                  size: None,
               })
            }
            _ => None,
         },
         _ => None,
      }
   }

   /// Serializes ACP tool call content for the frontend. An empty collection
   /// stays an empty array so an update can clear previously shown content.
   fn map_tool_content(content: Vec<acp::ToolCallContent>) -> Option<serde_json::Value> {
      serde_json::to_value(content).ok()
   }

   fn failure_message(status: acp::ToolCallStatus) -> Option<String> {
      matches!(status, acp::ToolCallStatus::Failed).then(|| "Tool call failed".to_string())
   }

   /// Events for a new `tool_call`. The call's content (diffs, terminals,
   /// text) is the displayed output; `rawOutput` travels separately so the
   /// frontend can fall back to it only when there is no content.
   fn tool_call_events(session_id: String, tool_call: acp::ToolCall) -> Vec<AcpEvent> {
      let tool_id = tool_call.tool_call_id.to_string();
      let status = tool_call.status;
      let output = if tool_call.content.is_empty() {
         None
      } else {
         Self::map_tool_content(tool_call.content)
      };

      let mut events = vec![AcpEvent::ToolStart {
         session_id: session_id.clone(),
         tool_name: tool_call.title,
         tool_id: tool_id.clone(),
         input: tool_call.raw_input.unwrap_or(serde_json::Value::Null),
         output: output.clone(),
         raw_output: tool_call.raw_output,
         kind: Self::map_tool_kind(tool_call.kind),
         status: Self::map_tool_status(status),
         locations: Self::map_tool_locations(tool_call.locations),
      }];

      if matches!(
         status,
         acp::ToolCallStatus::Completed | acp::ToolCallStatus::Failed
      ) {
         events.push(AcpEvent::ToolComplete {
            session_id,
            tool_id,
            success: matches!(status, acp::ToolCallStatus::Completed),
            output,
            error: Self::failure_message(status),
         });
      }

      events
   }

   /// Events for a `tool_call_update`. Per ACP, only fields that are present
   /// change the call; `content`, when present, replaces the whole collection.
   fn tool_call_update_events(session_id: String, update: acp::ToolCallUpdate) -> Vec<AcpEvent> {
      let tool_id = update.tool_call_id.to_string();
      let fields = update.fields;
      let status = fields.status;
      let output = fields.content.and_then(Self::map_tool_content);
      let error = status.and_then(Self::failure_message);

      let mut events = vec![AcpEvent::ToolUpdate {
         session_id: session_id.clone(),
         tool_id: tool_id.clone(),
         tool_name: fields.title,
         input: fields.raw_input,
         output: output.clone(),
         raw_output: fields.raw_output,
         kind: fields.kind.map(Self::map_tool_kind),
         status: status.map(Self::map_tool_status),
         locations: fields.locations.map(Self::map_tool_locations),
         error: error.clone(),
      }];

      if let Some(status @ (acp::ToolCallStatus::Completed | acp::ToolCallStatus::Failed)) = status
      {
         events.push(AcpEvent::ToolComplete {
            session_id,
            tool_id,
            success: matches!(status, acp::ToolCallStatus::Completed),
            output,
            error,
         });
      }

      events
   }

   /// What a permission request's `toolCall` shows the prompt, mapped with
   /// the same helpers as tool call updates so the shapes match tool cards.
   fn permission_tool_call(update: &acp::ToolCallUpdate) -> AcpPermissionToolCall {
      let fields = &update.fields;
      AcpPermissionToolCall {
         tool_id: update.tool_call_id.to_string(),
         title: fields.title.clone(),
         kind: fields.kind.map(Self::map_tool_kind),
         content: fields.content.clone().and_then(Self::map_tool_content),
         locations: fields.locations.clone().map(Self::map_tool_locations),
         raw_input: fields.raw_input.clone(),
      }
   }

   fn map_tool_kind(kind: acp::ToolKind) -> AcpToolKind {
      match kind {
         acp::ToolKind::Read => AcpToolKind::Read,
         acp::ToolKind::Edit => AcpToolKind::Edit,
         acp::ToolKind::Delete => AcpToolKind::Delete,
         acp::ToolKind::Move => AcpToolKind::Move,
         acp::ToolKind::Search => AcpToolKind::Search,
         acp::ToolKind::Execute => AcpToolKind::Execute,
         acp::ToolKind::Think => AcpToolKind::Think,
         acp::ToolKind::Fetch => AcpToolKind::Fetch,
         acp::ToolKind::SwitchMode => AcpToolKind::SwitchMode,
         _ => AcpToolKind::Other,
      }
   }

   fn map_tool_status(status: acp::ToolCallStatus) -> AcpToolCallStatus {
      match status {
         acp::ToolCallStatus::Pending => AcpToolCallStatus::Pending,
         acp::ToolCallStatus::InProgress => AcpToolCallStatus::InProgress,
         acp::ToolCallStatus::Completed => AcpToolCallStatus::Completed,
         acp::ToolCallStatus::Failed => AcpToolCallStatus::Failed,
         _ => AcpToolCallStatus::Pending,
      }
   }

   fn map_tool_locations(locations: Vec<acp::ToolCallLocation>) -> Vec<AcpToolCallLocation> {
      locations
         .into_iter()
         .map(|location| AcpToolCallLocation {
            path: location.path.display().to_string(),
            line: location.line,
         })
         .collect()
   }

   pub(crate) fn map_session_config_option(
      option: acp::SessionConfigOption,
   ) -> Option<SessionConfigOption> {
      let kind = match option.kind {
         acp::SessionConfigKind::Select(select) => SessionConfigOptionKind::Select {
            current_value: select.current_value.to_string(),
            options: match select.options {
               acp::SessionConfigSelectOptions::Ungrouped(options) => options,
               acp::SessionConfigSelectOptions::Grouped(groups) => {
                  groups.into_iter().flat_map(|group| group.options).collect()
               }
               _ => Vec::new(),
            }
            .into_iter()
            .map(|value| SessionConfigOptionValue {
               id: value.value.to_string(),
               name: value.name,
               description: value.description,
            })
            .collect(),
         },
         acp::SessionConfigKind::Boolean(boolean) => SessionConfigOptionKind::Boolean {
            current_value: boolean.current_value,
         },
         _ => return None,
      };

      Some(SessionConfigOption {
         id: option.id.to_string(),
         name: option.name,
         description: option.description,
         category: option.category.map(|category| match category {
            acp::SessionConfigOptionCategory::Mode => "mode".to_string(),
            acp::SessionConfigOptionCategory::Model => "model".to_string(),
            acp::SessionConfigOptionCategory::ModelConfig => "model_config".to_string(),
            acp::SessionConfigOptionCategory::ThoughtLevel => "thought_level".to_string(),
            acp::SessionConfigOptionCategory::Other(category) => category,
            _ => "other".to_string(),
         }),
         kind,
      })
   }
}

impl AthasAcpClient {
   pub async fn handle_agent_request(
      &self,
      request: acp::AgentRequest,
   ) -> acp_sdk::Result<acp::ClientResponse> {
      match request {
         acp::AgentRequest::WriteTextFileRequest(request) => self
            .write_text_file(request)
            .await
            .map(acp::ClientResponse::WriteTextFileResponse),
         acp::AgentRequest::ReadTextFileRequest(request) => self
            .read_text_file(request)
            .await
            .map(acp::ClientResponse::ReadTextFileResponse),
         acp::AgentRequest::RequestPermissionRequest(request) => self
            .request_permission(request)
            .await
            .map(acp::ClientResponse::RequestPermissionResponse),
         acp::AgentRequest::CreateTerminalRequest(request) => self
            .create_terminal(request)
            .await
            .map(acp::ClientResponse::CreateTerminalResponse),
         acp::AgentRequest::TerminalOutputRequest(request) => self
            .terminal_output(request)
            .await
            .map(acp::ClientResponse::TerminalOutputResponse),
         acp::AgentRequest::ReleaseTerminalRequest(request) => self
            .release_terminal(request)
            .await
            .map(acp::ClientResponse::ReleaseTerminalResponse),
         acp::AgentRequest::WaitForTerminalExitRequest(request) => self
            .wait_for_terminal_exit(request)
            .await
            .map(acp::ClientResponse::WaitForTerminalExitResponse),
         acp::AgentRequest::KillTerminalRequest(request) => self
            .kill_terminal_command(request)
            .await
            .map(acp::ClientResponse::KillTerminalResponse),
         acp::AgentRequest::CreateElicitationRequest(request) => self
            .create_elicitation(request)
            .await
            .map(acp::ClientResponse::CreateElicitationResponse),
         acp::AgentRequest::ExtMethodRequest(request) => self
            .ext_method(request)
            .await
            .map(acp::ClientResponse::ExtMethodResponse),
         request => {
            log::warn!("Unsupported ACP client request: {}", request.method());
            Err(acp_sdk::Error::method_not_found())
         }
      }
   }

   pub async fn handle_agent_notification(
      &self,
      notification: acp::AgentNotification,
      _connection: AcpConnection,
   ) -> acp_sdk::Result<()> {
      match notification {
         acp::AgentNotification::SessionNotification(notification) => {
            self.session_notification(notification).await
         }
         acp::AgentNotification::ExtNotification(notification) => {
            self.ext_notification(notification).await
         }
         // The out-of-band flow behind an accepted URL elicitation finished.
         acp::AgentNotification::CompleteElicitationNotification(notification) => {
            self.emit_event(AcpEvent::ElicitationComplete {
               elicitation_id: notification.elicitation_id.to_string(),
            });
            Ok(())
         }
         notification => {
            log::warn!("Unhandled ACP agent notification: {:?}", notification);
            Ok(())
         }
      }
   }

   async fn request_permission(
      &self,
      args: acp::RequestPermissionRequest,
   ) -> acp::Result<acp::RequestPermissionResponse> {
      let session_id = args.session_id.to_string();
      let (pending, response_rx) = PendingRequest::open(
         &self.pending_permissions,
         &self.app_handle,
         Some(session_id.clone()),
      );
      let request_id = pending.request_id.clone();

      let tool_call_id = args.tool_call.tool_call_id.clone();
      let tool_title = args
         .tool_call
         .fields
         .title
         .as_deref()
         .unwrap_or("Tool call");
      let tool_call = Self::permission_tool_call(&args.tool_call);
      // Per ACP the request's tool call is a `tool_call_update`. Apply it to
      // the transcript first, so the card shows what the prompt asks about.
      for event in Self::tool_call_update_events(session_id.clone(), args.tool_call.clone()) {
         self.emit_event(event);
      }
      self.emit_event(AcpEvent::PermissionRequest {
         session_id,
         request_id: request_id.clone(),
         permission_type: "tool_call".to_string(),
         resource: tool_call_id.to_string(),
         description: format!("{} ({})", tool_title, tool_call_id),
         tool_call,
         options: args
            .options
            .iter()
            .map(|option| super::types::AcpPermissionOption {
               id: option.option_id.to_string(),
               name: option.name.clone(),
               kind: match option.kind {
                  acp::PermissionOptionKind::AllowOnce => {
                     super::types::AcpPermissionOptionKind::AllowOnce
                  }
                  acp::PermissionOptionKind::AllowAlways => {
                     super::types::AcpPermissionOptionKind::AllowAlways
                  }
                  acp::PermissionOptionKind::RejectOnce => {
                     super::types::AcpPermissionOptionKind::RejectOnce
                  }
                  acp::PermissionOptionKind::RejectAlways => {
                     super::types::AcpPermissionOptionKind::RejectAlways
                  }
                  _ => super::types::AcpPermissionOptionKind::RejectOnce,
               },
            })
            .collect(),
      });

      // Wait for user response with timeout
      let answer = tokio::time::timeout(PERMISSION_TIMEOUT, response_rx).await;
      drop(pending);
      match answer {
         Ok(Ok(response)) => {
            if response.cancelled {
               return Ok(acp::RequestPermissionResponse::new(
                  acp::RequestPermissionOutcome::Cancelled,
               ));
            }

            if let Some(option_id) = response.option_id {
               return Ok(acp::RequestPermissionResponse::new(
                  acp::RequestPermissionOutcome::Selected(acp::SelectedPermissionOutcome::new(
                     option_id,
                  )),
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

   /// Handles `elicitation/create`: the agent asks the user a structured question (form mode) or
   /// asks them to open a URL (url mode). The full request, including `_meta`, goes to the
   /// frontend, and its answer comes back as a `CreateElicitationResponse`. Modes Athas does not
   /// know are rejected with invalid params, as the spec requires.
   async fn create_elicitation(
      &self,
      args: acp::CreateElicitationRequest,
   ) -> acp::Result<acp::CreateElicitationResponse> {
      if !matches!(
         args.mode,
         acp::ElicitationMode::Form(_) | acp::ElicitationMode::Url(_)
      ) {
         return Err(acp_sdk::Error::invalid_params());
      }
      let session_id = match args.scope() {
         acp::ElicitationScope::Session(scope) => Some(scope.session_id.to_string()),
         _ => None,
      };

      let (pending, answer_rx) = PendingRequest::open(
         &self.pending_elicitations,
         &self.app_handle,
         session_id.clone(),
      );
      let request = serde_json::to_value(&args).map_err(|_| acp_sdk::Error::internal_error())?;
      self.emit_event(AcpEvent::ElicitationRequest {
         session_id,
         request_id: pending.request_id.clone(),
         request,
      });

      let answer = tokio::time::timeout(ELICITATION_TIMEOUT, answer_rx).await;
      drop(pending);
      Ok(elicitation_response(answer.ok().and_then(Result::ok)))
   }

   async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
      let session_id = args.session_id.to_string();

      match args.update {
         acp::SessionUpdate::UserMessageChunk(chunk) => {
            let Some(content) = Self::map_content_block(chunk.content) else {
               return Ok(());
            };

            self.emit_event(AcpEvent::UserMessageChunk {
               session_id,
               content,
               is_complete: false,
            });
         }
         acp::SessionUpdate::AgentMessageChunk(chunk) => {
            let Some(content) = Self::map_content_block(chunk.content) else {
               return Ok(());
            };

            self.emit_event(AcpEvent::ContentChunk {
               session_id,
               content,
               is_complete: false,
            });
         }
         acp::SessionUpdate::AgentThoughtChunk(chunk) => {
            let Some(content) = Self::map_content_block(chunk.content) else {
               return Ok(());
            };

            self.emit_event(AcpEvent::ThoughtChunk {
               session_id,
               content,
               is_complete: false,
            });
         }
         acp::SessionUpdate::ToolCall(tool_call) => {
            for event in Self::tool_call_events(session_id, tool_call) {
               self.emit_event(event);
            }
         }
         acp::SessionUpdate::ToolCallUpdate(update) => {
            for event in Self::tool_call_update_events(session_id, update) {
               self.emit_event(event);
            }
         }
         acp::SessionUpdate::CurrentModeUpdate(update) => {
            // Handle current mode change
            self.emit_event(AcpEvent::CurrentModeUpdate {
               session_id,
               current_mode_id: update.current_mode_id.to_string(),
            });
         }
         acp::SessionUpdate::ConfigOptionUpdate(update) => {
            self.emit_event(AcpEvent::ConfigOptionsUpdate {
               session_id,
               config_options: update
                  .config_options
                  .into_iter()
                  .filter_map(Self::map_session_config_option)
                  .collect(),
            });
         }
         acp::SessionUpdate::SessionInfoUpdate(update) => {
            self.emit_event(AcpEvent::SessionInfoUpdate {
               session_id,
               title: update.title.take(),
               updated_at: update.updated_at.take(),
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
         acp::SessionUpdate::Plan(plan) => {
            self.emit_event(AcpEvent::PlanUpdate {
               session_id,
               entries: plan
                  .entries
                  .into_iter()
                  .map(|entry| AcpPlanEntry {
                     content: entry.content,
                     priority: Self::map_plan_priority(entry.priority),
                     status: Self::map_plan_status(entry.status),
                  })
                  .collect(),
            });
         }
         acp::SessionUpdate::UsageUpdate(usage) => {
            log::info!(
               "ACP usage update: session={}, used={}, size={}",
               session_id,
               usage.used,
               usage.size
            );
            self.emit_event(AcpEvent::UsageUpdate {
               session_id,
               usage: AcpUsageUpdate {
                  used: usage.used,
                  size: usage.size,
               },
            });
         }
         update => {
            log::warn!(
               "Unhandled ACP session update for {}: {:?}",
               session_id,
               update
            );
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
      self
         .ensure_file_access(&args.session_id.to_string(), &path, FileAccess::Read, None)
         .await?;
      let content = match self.read_open_buffer(&path).await {
         Some(content) => content,
         None => tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| file_access::read_error(&path, &e))?,
      };
      file_access::slice_lines(content, args.line, args.limit).map(acp::ReadTextFileResponse::new)
   }

   /// What the editor holds for `path`, unsaved changes included, when a window has the file
   /// open. The frontend owns the buffers, so each editor window is asked at the moment of the
   /// read and answers with the buffer's current text, or `None` when it does not have the file
   /// open. With no editor window, or none answering in time, the read goes to the disk.
   async fn read_open_buffer(&self, path: &Path) -> Option<String> {
      let windows = self
         .app_handle
         .webview_windows()
         .values()
         .filter(|window| is_editor_window(window))
         .count();
      if windows == 0 {
         return None;
      }
      let (pending, answer_rx) = PendingBufferRead::open(&self.pending_buffer_reads, windows);
      let request = AcpBufferReadRequest {
         request_id: pending.request_id.clone(),
         path: path_to_string(path),
      };
      if let Err(e) = self.app_handle.emit(ACP_BUFFER_READ_EVENT, &request) {
         log::warn!("Failed to ask the editor for {}: {}", request.path, e);
         return None;
      }
      let answer = tokio::time::timeout(BUFFER_READ_TIMEOUT, answer_rx).await;
      drop(pending);
      answer.ok().and_then(Result::ok).flatten()
   }

   async fn write_text_file(
      &self,
      args: acp::WriteTextFileRequest,
   ) -> acp::Result<acp::WriteTextFileResponse> {
      let path_str = args.path.to_string_lossy();
      let path = self.resolve_path(&path_str);
      self
         .ensure_file_access(
            &args.session_id.to_string(),
            &path,
            FileAccess::Write,
            Some(&args.content),
         )
         .await?;
      self.apply_agent_write(&path, &args.content).await?;
      Ok(acp::WriteTextFileResponse::new())
   }

   /// Lets the agent at `path` when it lies inside the workspace. Anything outside asks the user
   /// first, with the permission prompt the agent's own permission requests use; a write shows the
   /// change it would make. Reads in a folder the user allowed for the session go ahead.
   async fn ensure_file_access(
      &self,
      session_id: &str,
      path: &Path,
      access: FileAccess,
      new_content: Option<&str>,
   ) -> acp::Result<()> {
      if is_inside_roots(path, &self.workspace_roots) {
         return Ok(());
      }
      let folder = real_path(path).and_then(|real| real.parent().map(Path::to_path_buf));
      if access == FileAccess::Read
         && let Some(folder) = &folder
         && self.has_outside_read_grant(session_id, folder)
      {
         return Ok(());
      }

      let old_text = match access {
         FileAccess::Write => tokio::fs::read_to_string(path).await.ok(),
         FileAccess::Read => None,
      };
      let (pending, answer_rx) = PendingRequest::open(
         &self.pending_permissions,
         &self.app_handle,
         Some(session_id.to_string()),
      );
      let request_id = pending.request_id.clone();
      let tool_call =
         file_access::outside_access_tool_call(&request_id, access, path, old_text, new_content);
      self.emit_event(AcpEvent::PermissionRequest {
         session_id: session_id.to_string(),
         request_id,
         permission_type: match access {
            FileAccess::Read => "file_read",
            FileAccess::Write => "file_write",
         }
         .to_string(),
         resource: path_to_string(path),
         description: tool_call.title.clone().unwrap_or_default(),
         options: file_access::outside_access_options(access),
         tool_call,
      });

      let answer = tokio::time::timeout(PERMISSION_TIMEOUT, answer_rx)
         .await
         .ok()
         .and_then(Result::ok);
      drop(pending);
      match file_access::outside_access_answer(access, answer.as_ref()) {
         OutsideAccess::Once => Ok(()),
         OutsideAccess::FolderForSession => {
            if let Some(folder) = folder {
               self
                  .outside_read_grants
                  .lock()
                  .unwrap_or_else(|poisoned| poisoned.into_inner())
                  .entry(session_id.to_string())
                  .or_default()
                  .insert(folder);
            }
            Ok(())
         }
         OutsideAccess::Denied => Err(file_access::access_denied(path)),
         OutsideAccess::Cancelled => Err(acp::Error::request_cancelled()),
      }
   }

   fn has_outside_read_grant(&self, session_id: &str, folder: &Path) -> bool {
      self
         .outside_read_grants
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
         .get(session_id)
         .is_some_and(|folders| folders.contains(folder))
   }

   /// Applies an agent's write to `path`, the one place agent writes land: the file is written,
   /// then the frontend hears about it through `file-changed` so the file tree and any open editor
   /// catch up. An editor without unsaved changes reloads; one with unsaved changes keeps them and
   /// offers a reload, so an agent write never discards what the user typed.
   async fn apply_agent_write(&self, path: &Path, content: &str) -> acp::Result<()> {
      let existed = tokio::fs::try_exists(path).await.unwrap_or(false);
      if let Some(parent) = path.parent()
         && let Err(e) = tokio::fs::create_dir_all(parent).await
      {
         log::warn!("Failed to create parent directories: {}", e);
      }

      tokio::fs::write(path, content)
         .await
         .map_err(|e| acp::Error::new(-32603, format!("Failed to write file: {}", e)))?;

      let event = file_access::FileChangeEvent {
         path: path_to_string(path),
         event_type: if existed {
            file_access::FileChangeType::Reloaded
         } else {
            file_access::FileChangeType::Opened
         },
      };
      if let Err(e) = self.app_handle.emit("file-changed", &event) {
         log::warn!("Failed to emit file change: {}", e);
      }
      Ok(())
   }

   async fn create_terminal(
      &self,
      args: acp::CreateTerminalRequest,
   ) -> acp::Result<acp::CreateTerminalResponse> {
      if args.command.trim().is_empty() {
         return Err(acp::Error::new(
            -32602,
            "terminal/create command must not be empty".to_string(),
         ));
      }

      let working_dir = args
         .cwd
         .as_ref()
         .map(|p| p.to_string_lossy().to_string())
         .or_else(|| self.workspace_path.as_deref().map(path_to_string));

      let env_map: Option<HashMap<String, String>> = if args.env.is_empty() {
         None
      } else {
         Some(
            args
               .env
               .iter()
               .map(|e| (e.name.clone(), e.value.clone()))
               .collect(),
         )
      };
      let command = args.command.clone();
      let command_args = if args.args.is_empty() {
         None
      } else {
         Some(args.args.clone())
      };

      let config = TerminalConfig {
         working_directory: working_dir,
         shell: None,
         wsl_distribution: None,
         wsl_working_directory: None,
         environment: env_map,
         command: Some(command),
         args: command_args,
         size: TerminalSize::default(),
         term_program_version: Some(self.app_handle.package_info().version.to_string()),
         shell_integration: Some(false),
         shell_integration_dir: None,
      };

      let states_for_events = self.terminal_states.clone();
      let pending_events = Arc::new(StdMutex::new(Vec::<(String, TerminalEvent)>::new()));
      let pending_events_for_handler = pending_events.clone();
      let event_handler: TerminalEventHandler = Arc::new(move |terminal_id, event| {
         let Ok(mut states) = states_for_events.lock() else {
            return false;
         };

         if let Some(state) = states.get_mut(terminal_id) {
            state.handle_event(event);
         } else if let Ok(mut pending) = pending_events_for_handler.lock() {
            pending.push((terminal_id.to_string(), event));
         }
         true
      });

      match self.terminal_manager.create_terminal(config, event_handler) {
         Ok(athas_terminal_id) => {
            let terminal_id = athas_terminal_id.clone();
            let output_limit = args.output_byte_limit.map(|l| l as u32);
            let state = AcpTerminalState::new(athas_terminal_id.clone(), output_limit)
               .for_session(args.session_id.to_string());
            {
               let mut states = self.terminal_states.lock().unwrap();
               states.insert(terminal_id.clone(), state);
               if let Ok(mut pending) = pending_events.lock() {
                  for (_, event) in pending.drain(..).filter(|(id, _)| id == &terminal_id) {
                     if let Some(state) = states.get_mut(&terminal_id) {
                        state.handle_event(event);
                     }
                  }
               }
            }

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
      let states = self
         .terminal_states
         .lock()
         .map_err(|_| acp::Error::new(-32603, "Lock poisoned".to_string()))?;

      let state = states
         .get(&terminal_id)
         .ok_or_else(|| acp::Error::new(-32603, "Terminal not found".to_string()))?;

      Ok(state.output_response())
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
         if let Some(state) = states.get_mut(&terminal_id)
            && state.exit_status.is_none()
         {
            state.set_exit_status(Some(1), Some("released".to_string()));
         }
         states.remove(&terminal_id)
      };

      if let Some(state) = removed_state
         && let Err(e) = self
            .terminal_manager
            .close_terminal(&state.athas_terminal_id)
      {
         log::warn!("Failed to close terminal {}: {}", terminal_id, e);
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
      args: acp::KillTerminalRequest,
   ) -> acp::Result<acp::KillTerminalResponse> {
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

      if let Some(athas_terminal_id) = athas_id
         && let Err(e) = self.terminal_manager.kill_terminal(&athas_terminal_id)
      {
         log::warn!("Failed to kill terminal {}: {}", terminal_id, e);
      }

      {
         let mut states = self
            .terminal_states
            .lock()
            .map_err(|_| acp::Error::new(-32603, "Lock poisoned".to_string()))?;
         if let Some(state) = states.get_mut(&terminal_id) {
            state.set_exit_status(Some(1), Some("killed".to_string()));
         }
      }

      Ok(acp::KillTerminalResponse::new())
   }

   async fn ext_method(&self, args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
      // Parse params from RawValue to Value for easier access
      let params: serde_json::Value =
         serde_json::from_str(args.params.get()).unwrap_or(serde_json::Value::Null);
      let session_id =
         ext_request_session_id(&params, self.current_session_id.lock().await.as_deref());

      match &*args.method {
         "_athas/open_terminal" => {
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
         "_athas/set_chat_title" => {
            let title = params
               .get("title")
               .and_then(|v| v.as_str())
               .map(str::trim)
               .filter(|title| !title.is_empty())
               .ok_or_else(|| {
                  acp::Error::new(-32602, "_athas/set_chat_title requires a title".to_string())
               })?
               .to_string();

            self.emit_event(AcpEvent::UiAction {
               session_id,
               action: UiAction::SetChatTitle { title },
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

/// Whether a window runs the editor workbench, which answers buffer reads. Detached windows (a
/// chat popped out on its own) hold no editor buffers.
fn is_editor_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> bool {
   window.url().is_ok_and(|url| {
      !url
         .query_pairs()
         .any(|(key, value)| key == "view" && value == "detached")
   })
}

/// The session an extension request is about: its `sessionId` param when the agent sent one,
/// otherwise the session that last opened or received a prompt on this connection.
fn ext_request_session_id(params: &serde_json::Value, current: Option<&str>) -> String {
   params
      .get("sessionId")
      .and_then(serde_json::Value::as_str)
      .or(current)
      .unwrap_or_default()
      .to_string()
}

/// Turns the frontend's answer into an ACP response. A missing or malformed answer cancels.
fn elicitation_response(answer: Option<serde_json::Value>) -> acp::CreateElicitationResponse {
   answer
      .and_then(|value| serde_json::from_value(value).ok())
      .unwrap_or_else(|| acp::CreateElicitationResponse::new(acp::ElicitationAction::Cancel))
}

#[cfg(test)]
mod tests {
   use super::{
      AthasAcpClient, ClientResponders, PendingBufferRead, PendingEntry, PermissionResponse,
      SessionConfigOptionKind, acp, elicitation_response, ext_request_session_id,
   };
   use crate::acp::types::{AcpBufferReadRequest, AcpEvent};
   use serde_json::json;
   use tokio::sync::oneshot;

   fn diff_content() -> acp::ToolCallContent {
      acp::ToolCallContent::Diff(acp::Diff::new("/repo/a.txt", "new").old_text("old".to_string()))
   }

   #[test]
   fn tool_call_start_carries_content_as_output_and_raw_output_apart() {
      let tool_call = acp::ToolCall::new("call-1", "Edit a.txt")
         .content(vec![diff_content()])
         .raw_output(json!({ "ok": true }));

      let events = AthasAcpClient::tool_call_events("s".to_string(), tool_call);
      let [
         AcpEvent::ToolStart {
            input,
            output,
            raw_output,
            ..
         },
      ] = events.as_slice()
      else {
         panic!("expected a single tool start, got {events:?}");
      };

      assert_eq!(input, &serde_json::Value::Null);
      let output = output.as_ref().expect("content should be the output");
      assert_eq!(output[0]["type"], "diff");
      assert_eq!(output[0]["path"], "/repo/a.txt");
      assert_eq!(raw_output, &Some(json!({ "ok": true })));
   }

   #[test]
   fn completed_tool_call_keeps_content_when_raw_output_is_present() {
      let tool_call = acp::ToolCall::new("call-2", "Edit a.txt")
         .status(acp::ToolCallStatus::Completed)
         .content(vec![diff_content()])
         .raw_output(json!("done"));

      let events = AthasAcpClient::tool_call_events("s".to_string(), tool_call);
      let Some(AcpEvent::ToolComplete {
         output, success, ..
      }) = events.last()
      else {
         panic!("expected a completion, got {events:?}");
      };

      assert!(success);
      assert_eq!(output.as_ref().unwrap()[0]["type"], "diff");
   }

   #[test]
   fn tool_call_update_separates_content_from_raw_output() {
      let update = acp::ToolCallUpdate::new(
         "call-3",
         acp::ToolCallUpdateFields::new()
            .status(acp::ToolCallStatus::Completed)
            .content(vec![diff_content()])
            .raw_output(json!({ "stdout": "x" })),
      );

      let events = AthasAcpClient::tool_call_update_events("s".to_string(), update);
      let [
         AcpEvent::ToolUpdate {
            output: update_output,
            raw_output,
            ..
         },
         AcpEvent::ToolComplete {
            output: complete_output,
            ..
         },
      ] = events.as_slice()
      else {
         panic!("expected an update and a completion, got {events:?}");
      };

      assert_eq!(update_output.as_ref().unwrap()[0]["type"], "diff");
      assert_eq!(complete_output, update_output);
      assert_eq!(raw_output, &Some(json!({ "stdout": "x" })));
   }

   #[test]
   fn permission_tool_call_carries_content_locations_and_raw_input() {
      let update = acp::ToolCallUpdate::new(
         "call-p",
         acp::ToolCallUpdateFields::new()
            .title("Edit a.txt")
            .kind(acp::ToolKind::Edit)
            .content(vec![diff_content()])
            .locations(vec![acp::ToolCallLocation::new("/repo/a.txt").line(3)])
            .raw_input(json!({ "path": "/repo/a.txt" })),
      );

      let event = AcpEvent::PermissionRequest {
         session_id: "s".to_string(),
         request_id: "r".to_string(),
         permission_type: "tool_call".to_string(),
         resource: "call-p".to_string(),
         description: "Edit a.txt (call-p)".to_string(),
         options: Vec::new(),
         tool_call: AthasAcpClient::permission_tool_call(&update),
      };
      let event = serde_json::to_value(event).unwrap();
      let tool_call = &event["toolCall"];

      assert_eq!(tool_call["toolId"], "call-p");
      assert_eq!(tool_call["title"], "Edit a.txt");
      assert_eq!(tool_call["kind"], "edit");
      assert_eq!(tool_call["content"][0]["type"], "diff");
      assert_eq!(tool_call["content"][0]["oldText"], "old");
      assert_eq!(tool_call["content"][0]["newText"], "new");
      assert_eq!(tool_call["locations"][0]["path"], "/repo/a.txt");
      assert_eq!(tool_call["locations"][0]["line"], 3);
      assert_eq!(tool_call["rawInput"], json!({ "path": "/repo/a.txt" }));

      // The same request also reaches the transcript as a tool update.
      let events = AthasAcpClient::tool_call_update_events("s".to_string(), update);
      let [AcpEvent::ToolUpdate { output, .. }] = events.as_slice() else {
         panic!("expected a single tool update, got {events:?}");
      };
      assert_eq!(output.as_ref(), tool_call.get("content"));
   }

   #[test]
   fn tool_call_update_distinguishes_missing_and_cleared_content() {
      let missing = AthasAcpClient::tool_call_update_events(
         "s".to_string(),
         acp::ToolCallUpdate::new(
            "call-4",
            acp::ToolCallUpdateFields::new().status(acp::ToolCallStatus::Completed),
         ),
      );
      let Some(AcpEvent::ToolComplete { output, .. }) = missing.last() else {
         panic!("expected a completion");
      };
      assert_eq!(output, &None);

      let cleared = AthasAcpClient::tool_call_update_events(
         "s".to_string(),
         acp::ToolCallUpdate::new(
            "call-4",
            acp::ToolCallUpdateFields::new().content(Vec::new()),
         ),
      );
      let [AcpEvent::ToolUpdate { output, .. }] = cleared.as_slice() else {
         panic!("expected a single update");
      };
      assert_eq!(output, &Some(json!([])));
   }

   #[test]
   fn delivers_answers_only_to_requests_still_waiting() {
      let responders = ClientResponders {
         permissions: Default::default(),
         elicitations: Default::default(),
         buffer_reads: Default::default(),
      };
      let (tx, mut rx) = oneshot::channel();
      responders
         .elicitations
         .lock()
         .unwrap()
         .insert("q1".to_string(), PendingEntry::new(None, tx));

      assert!(!responders.answer_elicitation("q2", json!({ "action": "decline" })));
      assert!(responders.answer_elicitation("q1", json!({ "action": "decline" })));
      assert_eq!(rx.try_recv().unwrap(), json!({ "action": "decline" }));
      // Answered once; a second answer finds nothing waiting.
      assert!(!responders.answer_elicitation("q1", json!({ "action": "cancel" })));

      let (tx, mut rx) = oneshot::channel();
      responders.permissions.lock().unwrap().insert(
         "p1".to_string(),
         PendingEntry::new(Some("s".to_string()), tx),
      );
      let answer = PermissionResponse {
         approved: true,
         cancelled: false,
         option_id: Some("allow".to_string()),
      };
      assert!(responders.answer_permission("p1", answer));
      assert_eq!(rx.try_recv().unwrap().option_id.as_deref(), Some("allow"));
   }

   #[test]
   fn hands_open_editor_contents_to_the_waiting_read() {
      let responders = ClientResponders {
         permissions: Default::default(),
         elicitations: Default::default(),
         buffer_reads: Default::default(),
      };

      // Two editor windows: the one with the file open answers, whichever answers first.
      let (read, mut open_rx) = PendingBufferRead::open(&responders.buffer_reads, 2);
      assert!(responders.answer_buffer_read(&read.request_id, None));
      assert!(open_rx.try_recv().is_err());
      assert!(responders.answer_buffer_read(&read.request_id, Some("unsaved\n".to_string())));
      assert_eq!(open_rx.try_recv().unwrap().as_deref(), Some("unsaved\n"));
      // Answered; a late window finds nothing waiting.
      assert!(!responders.answer_buffer_read(&read.request_id, None));

      // No window has it open: the read goes to the disk once all of them said so.
      let (read, mut closed_rx) = PendingBufferRead::open(&responders.buffer_reads, 2);
      assert!(responders.answer_buffer_read(&read.request_id, None));
      assert!(closed_rx.try_recv().is_err());
      assert!(responders.answer_buffer_read(&read.request_id, None));
      assert_eq!(closed_rx.try_recv().unwrap(), None);

      // A read that gave up frees its slot. Buffer reads belong to no prompt, so cancelling a
      // turn leaves them alone.
      let (read, _rx) = PendingBufferRead::open(&responders.buffer_reads, 1);
      let request_id = read.request_id.clone();
      assert!(responders.cancel_session("s").is_empty());
      drop(read);
      assert!(!responders.answer_buffer_read(&request_id, Some("late".to_string())));

      let request = AcpBufferReadRequest {
         request_id: "b3".to_string(),
         path: "/repo/a.txt".to_string(),
      };
      assert_eq!(
         serde_json::to_value(request).unwrap(),
         json!({ "requestId": "b3", "path": "/repo/a.txt" })
      );
   }

   #[test]
   fn cancelling_a_session_resolves_only_what_it_waits_on() {
      let responders = ClientResponders {
         permissions: Default::default(),
         elicitations: Default::default(),
         buffer_reads: Default::default(),
      };
      let permission = |id: &str, session: &str| {
         let (tx, rx) = oneshot::channel();
         responders.permissions.lock().unwrap().insert(
            id.to_string(),
            PendingEntry::new(Some(session.to_string()), tx),
         );
         rx
      };
      let question = |id: &str, session: Option<&str>| {
         let (tx, rx) = oneshot::channel();
         responders.elicitations.lock().unwrap().insert(
            id.to_string(),
            PendingEntry::new(session.map(str::to_string), tx),
         );
         rx
      };
      let mut own_permission = permission("p-a", "session-a");
      let mut other_permission = permission("p-b", "session-b");
      let mut own_question = question("q-a", Some("session-a"));
      let mut other_question = question("q-b", Some("session-b"));
      let mut unscoped_question = question("q-none", None);

      let mut closed = responders.cancel_session("session-a");
      closed.sort();
      assert_eq!(closed, ["p-a", "q-a", "q-none"]);

      let answer = own_permission.try_recv().unwrap();
      assert!(answer.cancelled && !answer.approved && answer.option_id.is_none());
      assert_eq!(
         own_question.try_recv().unwrap(),
         json!({ "action": "cancel" })
      );
      assert_eq!(
         unscoped_question.try_recv().unwrap(),
         json!({ "action": "cancel" })
      );
      assert!(other_permission.try_recv().is_err());
      assert!(other_question.try_recv().is_err());

      // The other session's requests still wait and can be answered.
      assert!(responders.answer_permission(
         "p-b",
         PermissionResponse {
            approved: true,
            cancelled: false,
            option_id: None,
         }
      ));
      assert!(responders.answer_elicitation("q-b", json!({ "action": "decline" })));
      assert!(responders.cancel_session("session-a").is_empty());
   }

   #[test]
   fn forwards_url_elicitations_and_accepts_without_content() {
      let request: acp::CreateElicitationRequest = serde_json::from_value(json!({
         "sessionId": "sess_1",
         "mode": "url",
         "elicitationId": "mcp-oauth-1",
         "url": "https://auth.example.com/authorize?state=abc",
         "message": "Authenticate with MCP server linear"
      }))
      .expect("valid url elicitation");
      assert!(matches!(request.mode, acp::ElicitationMode::Url(_)));

      let forwarded = serde_json::to_value(&request).unwrap();
      assert_eq!(forwarded["mode"], "url");
      assert_eq!(forwarded["sessionId"], "sess_1");
      assert_eq!(forwarded["elicitationId"], "mcp-oauth-1");
      assert_eq!(
         forwarded["url"],
         "https://auth.example.com/authorize?state=abc"
      );

      let accepted =
         serde_json::to_value(elicitation_response(Some(json!({ "action": "accept" })))).unwrap();
      assert_eq!(accepted, json!({ "action": "accept" }));
   }

   #[test]
   fn forwards_form_elicitations_in_their_wire_shape() {
      let request: acp::CreateElicitationRequest = serde_json::from_value(json!({
         "sessionId": "sess_1",
         "toolCallId": "call_1",
         "mode": "form",
         "message": "Which scope?",
         "requestedSchema": {
            "type": "object",
            "properties": {
               "scope": {
                  "type": "string",
                  "oneOf": [{ "const": "package", "title": "Package" }]
               }
            },
            "required": ["scope"]
         },
         "_meta": { "source": "test" }
      }))
      .expect("valid form elicitation");

      let forwarded = serde_json::to_value(&request).unwrap();
      assert_eq!(forwarded["mode"], "form");
      assert_eq!(forwarded["sessionId"], "sess_1");
      assert_eq!(forwarded["toolCallId"], "call_1");
      assert_eq!(forwarded["requestedSchema"]["required"], json!(["scope"]));
      assert_eq!(
         forwarded["requestedSchema"]["properties"]["scope"]["oneOf"][0]["const"],
         "package"
      );
      assert_eq!(forwarded["_meta"]["source"], "test");
   }

   #[test]
   fn attributes_extension_requests_to_their_own_session() {
      let params = json!({ "sessionId": "b", "title": "Fix" });
      assert_eq!(ext_request_session_id(&params, Some("a")), "b");
      assert_eq!(ext_request_session_id(&json!({}), Some("a")), "a");
      assert_eq!(ext_request_session_id(&json!(null), None), "");
   }

   #[test]
   fn maps_frontend_answers_to_elicitation_responses() {
      let accepted = serde_json::to_value(elicitation_response(Some(json!({
         "action": "accept",
         "content": { "scope": "package", "checks": ["tests", "types"] }
      }))))
      .unwrap();
      assert_eq!(accepted["action"], "accept");
      assert_eq!(accepted["content"]["checks"], json!(["tests", "types"]));

      for action in ["decline", "cancel"] {
         let response =
            serde_json::to_value(elicitation_response(Some(json!({ "action": action })))).unwrap();
         assert_eq!(response["action"], action);
      }

      let missing = serde_json::to_value(elicitation_response(None)).unwrap();
      assert_eq!(missing["action"], "cancel");
      let malformed =
         serde_json::to_value(elicitation_response(Some(json!({ "answer": 1 })))).unwrap();
      assert_eq!(malformed["action"], "cancel");
   }

   #[test]
   fn maps_boolean_model_configuration_options() {
      let option = acp::SessionConfigOption::boolean("streaming", "Streaming", true)
         .description("Stream partial responses")
         .category(acp::SessionConfigOptionCategory::ModelConfig);

      let mapped = AthasAcpClient::map_session_config_option(option).expect("mapped option");

      assert_eq!(mapped.id, "streaming");
      assert_eq!(mapped.category.as_deref(), Some("model_config"));
      assert!(matches!(
         mapped.kind,
         SessionConfigOptionKind::Boolean {
            current_value: true
         }
      ));
   }
}
