use crate::app_runtime::AppHandle;
use athas_terminal::{
   TerminalConfig, TerminalEvent, TerminalEventHandler, TerminalInput, TerminalManager,
   TerminalSize, shell::Shell,
};
use std::{
   collections::{HashMap, HashSet},
   sync::{Arc, Mutex},
};
use tauri::{State, ipc::Channel};

#[derive(Default)]
pub(crate) struct FrontendTerminalSessions {
   windows: Mutex<HashMap<String, FrontendTerminalSession>>,
}

#[derive(Default)]
struct FrontendTerminalSession {
   session_id: String,
   local_connection_ids: HashSet<String>,
   remote_connection_ids: HashSet<String>,
}

#[derive(Default)]
struct StaleTerminalConnections {
   local_connection_ids: Vec<String>,
   remote_connection_ids: Vec<String>,
}

impl FrontendTerminalSessions {
   fn begin_session(
      &self,
      window_label: String,
      session_id: String,
   ) -> Result<StaleTerminalConnections, String> {
      let mut windows = self
         .windows
         .lock()
         .map_err(|error| format!("Failed to lock frontend terminal sessions: {error}"))?;

      if windows
         .get(&window_label)
         .is_some_and(|session| session.session_id == session_id)
      {
         return Ok(StaleTerminalConnections::default());
      }

      let stale = windows
         .remove(&window_label)
         .map(|session| StaleTerminalConnections {
            local_connection_ids: session.local_connection_ids.into_iter().collect(),
            remote_connection_ids: session.remote_connection_ids.into_iter().collect(),
         })
         .unwrap_or_default();

      windows.insert(
         window_label,
         FrontendTerminalSession {
            session_id,
            ..FrontendTerminalSession::default()
         },
      );

      Ok(stale)
   }

   pub(crate) fn register_local(
      &self,
      window_label: &str,
      session_id: &str,
      connection_id: String,
   ) -> Result<(), String> {
      self.register(window_label, session_id, connection_id, false)
   }

   pub(crate) fn register_remote(
      &self,
      window_label: &str,
      session_id: &str,
      connection_id: String,
   ) -> Result<(), String> {
      self.register(window_label, session_id, connection_id, true)
   }

   fn register(
      &self,
      window_label: &str,
      session_id: &str,
      connection_id: String,
      remote: bool,
   ) -> Result<(), String> {
      let mut windows = self
         .windows
         .lock()
         .map_err(|error| format!("Failed to lock frontend terminal sessions: {error}"))?;
      let session = windows
         .get_mut(window_label)
         .filter(|session| session.session_id == session_id)
         .ok_or_else(|| "Frontend terminal session is no longer active".to_string())?;

      if remote {
         session.remote_connection_ids.insert(connection_id);
      } else {
         session.local_connection_ids.insert(connection_id);
      }

      Ok(())
   }

   pub(crate) fn unregister(&self, connection_id: &str) {
      let Ok(mut windows) = self.windows.lock() else {
         return;
      };

      for session in windows.values_mut() {
         session.local_connection_ids.remove(connection_id);
         session.remote_connection_ids.remove(connection_id);
      }
   }
}

#[tauri::command]
pub async fn begin_frontend_terminal_session(
   window_label: String,
   session_id: String,
   frontend_sessions: State<'_, FrontendTerminalSessions>,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   let stale = frontend_sessions.begin_session(window_label, session_id)?;

   for connection_id in stale.local_connection_ids {
      terminal_manager
         .close_terminal(&connection_id)
         .map_err(|error| error.to_string())?;
   }

   for connection_id in stale.remote_connection_ids {
      athas_remote::close_remote_terminal(connection_id).await?;
   }

   Ok(())
}

#[tauri::command]
pub fn warm_terminal_environment(terminal_manager: State<'_, Arc<TerminalManager>>) {
   terminal_manager.warm_user_environment();
}

#[tauri::command]
pub async fn create_terminal(
   mut config: TerminalConfig,
   on_event: Channel<TerminalEvent>,
   window_label: String,
   frontend_session_id: String,
   app_handle: AppHandle,
   frontend_sessions: State<'_, FrontendTerminalSessions>,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<String, String> {
   config.term_program_version = Some(app_handle.package_info().version.to_string());
   let event_handler: TerminalEventHandler = Arc::new(move |_, event| on_event.send(event).is_ok());
   let connection_id = terminal_manager
      .create_terminal(config, event_handler)
      .map_err(|e| e.to_string())?;

   if let Err(error) =
      frontend_sessions.register_local(&window_label, &frontend_session_id, connection_id.clone())
   {
      let _ = terminal_manager.close_terminal(&connection_id);
      return Err(error);
   }

   Ok(connection_id)
}

#[tauri::command]
pub async fn terminal_write(
   id: String,
   input: TerminalInput,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .write_to_terminal(&id, input)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_resize(
   id: String,
   size: TerminalSize,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .resize_terminal(&id, size)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn terminal_set_paused(
   id: String,
   paused: bool,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   terminal_manager
      .set_terminal_paused(&id, paused)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_terminal(
   id: String,
   frontend_sessions: State<'_, FrontendTerminalSessions>,
   terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
   frontend_sessions.unregister(&id);
   terminal_manager
      .close_terminal(&id)
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_shells() -> Vec<Shell> {
   athas_terminal::get_shells()
}

pub use athas_terminal::TerminalManager as ManagedTerminalManager;

#[cfg(test)]
mod tests {
   use super::FrontendTerminalSessions;

   #[test]
   fn replaces_only_the_reloaded_windows_terminal_session() {
      let sessions = FrontendTerminalSessions::default();

      sessions
         .begin_session("main".to_string(), "session-1".to_string())
         .unwrap();
      sessions
         .register_local("main", "session-1", "local-1".to_string())
         .unwrap();
      sessions
         .register_remote("main", "session-1", "remote-1".to_string())
         .unwrap();

      sessions
         .begin_session("secondary".to_string(), "session-2".to_string())
         .unwrap();
      sessions
         .register_local("secondary", "session-2", "local-2".to_string())
         .unwrap();

      let unchanged = sessions
         .begin_session("main".to_string(), "session-1".to_string())
         .unwrap();
      assert!(unchanged.local_connection_ids.is_empty());
      assert!(unchanged.remote_connection_ids.is_empty());

      let stale = sessions
         .begin_session("main".to_string(), "session-3".to_string())
         .unwrap();
      assert_eq!(stale.local_connection_ids, vec!["local-1"]);
      assert_eq!(stale.remote_connection_ids, vec!["remote-1"]);

      let secondary = sessions
         .begin_session("secondary".to_string(), "session-4".to_string())
         .unwrap();
      assert_eq!(secondary.local_connection_ids, vec!["local-2"]);
   }
}
