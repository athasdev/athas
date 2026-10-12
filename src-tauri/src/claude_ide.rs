use athas_claude_ide::{
   BridgeEvent, EditorSelection, FrontendBridge, IdeServer, IdeServerConfig, ToolAnswer,
   ToolRequest, default_lock_dir,
};
use serde::Serialize;
use std::{
   collections::HashMap,
   sync::{Arc, Mutex, MutexGuard},
   time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_store::StoreExt;

const REQUEST_EVENT: &str = "claude-ide-request";
const CANCEL_EVENT: &str = "claude-ide-cancel";
const ENABLED_SETTING: &str = "claudeCodeIdeIntegration";
const TOOL_TIMEOUT: Duration = Duration::from_secs(15);

/// The Claude Code IDE server for this app process, shared by every window.
#[derive(Default)]
pub struct ClaudeIdeState {
   inner: Mutex<ClaudeIdeInner>,
}

#[derive(Default)]
struct ClaudeIdeInner {
   server: Option<IdeServer>,
   bridge: Option<Arc<FrontendBridge>>,
   folders_by_window: HashMap<String, Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestEvent<'a> {
   #[serde(flatten)]
   request: &'a ToolRequest,
   window_label: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelEvent<'a> {
   request_id: &'a str,
}

impl ClaudeIdeState {
   fn lock(&self) -> MutexGuard<'_, ClaudeIdeInner> {
      self
         .inner
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
   }

   /// What a new terminal needs so `claude` connects to Athas, when the server is running.
   pub fn terminal_env(&self) -> Vec<(&'static str, String)> {
      self
         .lock()
         .server
         .as_ref()
         .map(|server| server.terminal_env().to_vec())
         .unwrap_or_default()
   }

   async fn start(&self, app: &AppHandle) -> Result<(), String> {
      let running = self.lock().server.is_some();
      if running {
         return Ok(());
      }
      let lock_dir = default_lock_dir().ok_or("Could not find the home directory")?;
      let emitter_app = app.clone();
      let bridge = Arc::new(FrontendBridge::new(
         TOOL_TIMEOUT,
         Box::new(move |event| emit_bridge_event(&emitter_app, event)),
      ));
      let server = IdeServer::start(
         IdeServerConfig {
            ide_name: "Athas".to_string(),
            server_version: app.package_info().version.to_string(),
            lock_dir,
            workspace_folders: self.workspace_folders(),
         },
         bridge.clone(),
      )
      .await
      .map_err(|error| format!("Failed to start the Claude Code IDE server: {error}"))?;

      let mut inner = self.lock();
      if inner.server.is_none() {
         log::info!("Claude Code IDE server listening on port {}", server.port());
         inner.server = Some(server);
         inner.bridge = Some(bridge);
      }
      Ok(())
   }

   pub fn stop(&self) {
      let server = {
         let mut inner = self.lock();
         inner.bridge = None;
         inner.server.take()
      };
      drop(server);
   }

   fn workspace_folders(&self) -> Vec<String> {
      let inner = self.lock();
      let mut labels: Vec<&String> = inner.folders_by_window.keys().collect();
      labels.sort();
      let mut folders: Vec<String> = Vec::new();
      for label in labels {
         for folder in &inner.folders_by_window[label] {
            if !folders.contains(folder) {
               folders.push(folder.clone());
            }
         }
      }
      folders
   }

   fn set_window_folders(&self, label: &str, folders: Option<Vec<String>>) {
      {
         let mut inner = self.lock();
         match folders {
            Some(folders) => inner.folders_by_window.insert(label.to_string(), folders),
            None => inner.folders_by_window.remove(label),
         };
      }
      let folders = self.workspace_folders();
      if let Some(server) = self.lock().server.as_ref()
         && let Err(error) = server.set_workspace_folders(folders)
      {
         log::warn!("Failed to update the Claude Code lock file: {error}");
      }
   }
}

/// Picks the window that answers a tool call: the focused workbench, else any workbench.
fn emit_bridge_event(app: &AppHandle, event: &BridgeEvent) -> Result<(), String> {
   match event {
      BridgeEvent::Request(request) => {
         let window = crate::app_setup::get_workbench_window(app)
            .ok_or_else(|| "No editor window is open".to_string())?;
         app.emit(
            REQUEST_EVENT,
            RequestEvent {
               request,
               window_label: window.label().to_string(),
            },
         )
         .map_err(|error| error.to_string())
      }
      BridgeEvent::Cancel { request_id } => app
         .emit(CANCEL_EVENT, CancelEvent { request_id })
         .map_err(|error| error.to_string()),
   }
}

fn integration_enabled(app: &AppHandle) -> bool {
   app.store("settings.json")
      .ok()
      .and_then(|store| store.get(ENABLED_SETTING))
      .and_then(|value| value.as_bool())
      .unwrap_or(true)
}

/// Starts the server at launch unless the user turned the integration off.
pub fn start_on_launch(app: &AppHandle) {
   if !integration_enabled(app) {
      return;
   }
   let app = app.clone();
   tauri::async_runtime::spawn(async move {
      let state = app.state::<ClaudeIdeState>();
      if let Err(error) = state.start(&app).await {
         log::warn!("{error}");
      }
   });
}

pub fn shutdown(app: &AppHandle) {
   if let Some(state) = app.try_state::<ClaudeIdeState>() {
      state.stop();
   }
}

pub fn forget_window(app: &AppHandle, label: &str) {
   if let Some(state) = app.try_state::<ClaudeIdeState>() {
      state.set_window_folders(label, None);
   }
}

/// Turns the Claude Code IDE server on or off.
#[tauri::command]
#[specta::specta]
pub async fn claude_ide_set_enabled(
   enabled: bool,
   app: AppHandle,
   state: State<'_, ClaudeIdeState>,
) -> Result<(), String> {
   if enabled {
      state.start(&app).await
   } else {
      state.stop();
      Ok(())
   }
}

/// Reports the calling window's workspace folders, which the lock file advertises to Claude.
#[tauri::command]
#[specta::specta]
pub fn claude_ide_set_workspace_folders(
   folders: Vec<String>,
   window: WebviewWindow,
   state: State<'_, ClaudeIdeState>,
) {
   state.set_window_folders(window.label(), Some(folders));
}

/// Reports the active editor's selection, or null when no editor is active.
#[tauri::command]
#[specta::specta]
pub fn claude_ide_update_selection(
   selection: Option<EditorSelection>,
   state: State<'_, ClaudeIdeState>,
) {
   if let Some(server) = state.lock().server.as_ref() {
      server.update_selection(selection);
   }
}

/// Sends a file, or a zero-based line range in it, to Claude as context.
#[tauri::command]
#[specta::specta]
pub fn claude_ide_at_mention(
   file_path: String,
   line_start: Option<u32>,
   line_end: Option<u32>,
   state: State<'_, ClaudeIdeState>,
) -> Result<(), String> {
   let inner = state.lock();
   let server = inner
      .server
      .as_ref()
      .ok_or("The Claude Code integration is off")?;
   if !server.has_clients() {
      return Err("Claude Code is not connected".to_string());
   }
   server.at_mention(&file_path, line_start, line_end);
   Ok(())
}

/// Answers a `claude-ide-request` event with the tool's result.
#[tauri::command]
#[specta::specta]
pub fn respond_claude_ide_request(
   request_id: String,
   answer: ToolAnswer,
   state: State<'_, ClaudeIdeState>,
) {
   let bridge = state.lock().bridge.clone();
   if let Some(bridge) = bridge {
      bridge.respond(&request_id, answer);
   }
}
