use crate::terminal::FrontendTerminalSessions;
use athas_remote::{
   RemoteFileEntry, SshConnection, close_remote_terminal as remote_close_terminal,
   create_remote_terminal as remote_create_terminal,
   remote_terminal_resize as remote_terminal_resize_impl,
   remote_terminal_set_paused as remote_terminal_set_paused_impl,
   remote_terminal_write as remote_terminal_write_impl, ssh_connect as remote_ssh_connect,
   ssh_copy_path as remote_ssh_copy_path, ssh_create_directory as remote_ssh_create_directory,
   ssh_create_file as remote_ssh_create_file, ssh_delete_path as remote_ssh_delete_path,
   ssh_disconnect as remote_ssh_disconnect, ssh_disconnect_only as remote_ssh_disconnect_only,
   ssh_get_connected_ids as remote_ssh_get_connected_ids,
   ssh_read_directory as remote_ssh_read_directory, ssh_read_file as remote_ssh_read_file,
   ssh_rename_path as remote_ssh_rename_path, ssh_write_file as remote_ssh_write_file,
};
use athas_terminal::{TerminalChannelMessage, TerminalInput, TerminalSize};
use serde::Deserialize;
use tauri::{Emitter, State, ipc::Channel};

#[tauri::command]
#[specta::specta]
pub async fn ssh_trust_host(host: String, port: u16, fingerprint: String) -> Result<(), String> {
   athas_remote::ssh_trust_host(host, port, fingerprint).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_connect(
   app: tauri::AppHandle,
   connection_id: String,
   host: String,
   port: u16,
   username: String,
   password: Option<String>,
   key_path: Option<String>,
   use_sftp: bool,
) -> Result<SshConnection, String> {
   let connection = remote_ssh_connect(
      connection_id,
      host,
      port,
      username,
      password,
      key_path,
      use_sftp,
   )
   .await?;

   let _ = app.emit(
      "ssh_connection_status",
      serde_json::json!({
         "connectionId": connection.id,
         "connected": true
      }),
   );

   Ok(connection)
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_disconnect(app: tauri::AppHandle, connection_id: String) -> Result<(), String> {
   remote_ssh_disconnect(app.clone(), connection_id.clone()).await?;

   let _ = app.emit(
      "ssh_connection_status",
      serde_json::json!({
         "connectionId": connection_id,
         "connected": false
      }),
   );

   Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_disconnect_only(
   app: tauri::AppHandle,
   connection_id: String,
) -> Result<(), String> {
   remote_ssh_disconnect_only(connection_id.clone()).await?;

   let _ = app.emit(
      "ssh_connection_status",
      serde_json::json!({
         "connectionId": connection_id,
         "connected": false
      }),
   );

   Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_write_file(
   connection_id: String,
   file_path: String,
   content: String,
) -> Result<(), String> {
   remote_ssh_write_file(connection_id, file_path, content).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_write_file_checked(
   connection_id: String,
   file_path: String,
   content: String,
   expected_content: Option<String>,
) -> Result<(), String> {
   athas_remote::ssh_write_file_checked(connection_id, file_path, content, expected_content).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_delete_file_checked(
   connection_id: String,
   file_path: String,
   expected_content: String,
) -> Result<(), String> {
   athas_remote::ssh_delete_file_checked(connection_id, file_path, expected_content).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_read_directory(
   connection_id: String,
   path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
   remote_ssh_read_directory(connection_id, path).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_read_file(connection_id: String, file_path: String) -> Result<String, String> {
   remote_ssh_read_file(connection_id, file_path).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_get_connected_ids() -> Result<Vec<String>, String> {
   remote_ssh_get_connected_ids().await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_create_file(connection_id: String, file_path: String) -> Result<(), String> {
   remote_ssh_create_file(connection_id, file_path).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_create_directory(
   connection_id: String,
   directory_path: String,
) -> Result<(), String> {
   remote_ssh_create_directory(connection_id, directory_path).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_delete_path(
   connection_id: String,
   target_path: String,
   is_directory: bool,
) -> Result<(), String> {
   remote_ssh_delete_path(connection_id, target_path, is_directory).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_rename_path(
   connection_id: String,
   source_path: String,
   target_path: String,
) -> Result<(), String> {
   remote_ssh_rename_path(connection_id, source_path, target_path).await
}

#[tauri::command]
#[specta::specta]
pub async fn ssh_copy_path(
   connection_id: String,
   source_path: String,
   target_path: String,
   is_directory: bool,
) -> Result<(), String> {
   remote_ssh_copy_path(connection_id, source_path, target_path, is_directory).await
}

/// Where a remote terminal connects and starts.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTerminalTarget {
   pub host: String,
   pub port: u16,
   pub username: String,
   pub password: Option<String>,
   pub key_path: Option<String>,
   pub working_directory: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn create_remote_terminal(
   app_handle: tauri::AppHandle,
   target: RemoteTerminalTarget,
   size: TerminalSize,
   on_event: Channel<TerminalChannelMessage>,
   window_label: String,
   frontend_session_id: String,
   frontend_sessions: State<'_, FrontendTerminalSessions>,
) -> Result<String, String> {
   let connection_id = remote_create_terminal(
      target.host,
      target.port,
      target.username,
      target.password,
      target.key_path,
      target.working_directory,
      size,
      app_handle.package_info().version.to_string(),
      on_event,
   )
   .await?;

   if let Err(error) =
      frontend_sessions.register_remote(&window_label, &frontend_session_id, connection_id.clone())
   {
      let _ = remote_close_terminal(connection_id).await;
      return Err(error);
   }

   Ok(connection_id)
}

#[tauri::command]
#[specta::specta]
pub async fn remote_terminal_write(id: String, input: TerminalInput) -> Result<(), String> {
   remote_terminal_write_impl(id, input).await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_terminal_resize(id: String, size: TerminalSize) -> Result<(), String> {
   remote_terminal_resize_impl(id, size).await
}

#[tauri::command]
#[specta::specta]
pub async fn remote_terminal_set_paused(id: String, paused: bool) -> Result<(), String> {
   remote_terminal_set_paused_impl(id, paused).await
}

#[tauri::command]
#[specta::specta]
pub async fn close_remote_terminal(
   id: String,
   frontend_sessions: State<'_, FrontendTerminalSessions>,
) -> Result<(), String> {
   frontend_sessions.unregister(&id);
   remote_close_terminal(id).await
}
