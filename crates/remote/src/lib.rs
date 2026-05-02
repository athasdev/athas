mod file_ops;
mod runtime;
mod ssh_helpers;
mod state;
mod terminal;

use crate::{
   file_ops::{
      read_directory as read_directory_inner, read_file as read_file_inner,
      write_file as write_file_inner,
   },
   runtime::AthasAppHandle as AppHandle,
   ssh_helpers::{create_ssh_session, exec_remote_command, shell_quote},
   state::CONNECTIONS,
   terminal::{
      close_remote_terminal as close_remote_terminal_inner,
      create_remote_terminal as create_remote_terminal_inner, resize_remote_terminal,
      write_remote_terminal,
   },
};
pub use file_ops::RemoteFileEntry;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnection {
   pub id: String,
   pub name: String,
   pub host: String,
   pub port: u16,
   pub username: String,
   pub connected: bool,
}

pub async fn ssh_connect(
   connection_id: String,
   host: String,
   port: u16,
   username: String,
   password: Option<String>,
   key_path: Option<String>,
   use_sftp: bool,
) -> Result<SshConnection, String> {
   let session = create_ssh_session(
      &host,
      port,
      &username,
      password.as_deref(),
      key_path.as_deref(),
   )?;

   let sftp = if use_sftp {
      Some(
         session
            .sftp()
            .map_err(|e| format!("Failed to create SFTP session: {}", e))?,
      )
   } else {
      None
   };

   let connection = SshConnection {
      id: connection_id.clone(),
      name: format!("{}@{}", username, host),
      host,
      port,
      username,
      connected: true,
   };

   // Store the session
   {
      let mut connections = CONNECTIONS
         .lock()
         .map_err(|e| format!("Failed to lock connections: {}", e))?;
      connections.insert(connection_id, (session, sftp));
   }

   Ok(connection)
}

pub async fn ssh_disconnect(app: AppHandle, connection_id: String) -> Result<(), String> {
   let mut connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   if let Some((session, sftp_opt)) = connections.remove(&connection_id) {
      // Explicitly close SFTP handle before disconnecting session
      if let Some(sftp) = sftp_opt {
         drop(sftp);
      }
      let _ = session.disconnect(None, "Disconnecting", None);
   }

   // Close the remote window if it exists
   let window_label = format!("remote-{}", connection_id);
   if let Some(window) = app.get_webview_window(&window_label) {
      let _ = window.close();
   }

   Ok(())
}

pub async fn ssh_disconnect_only(connection_id: String) -> Result<(), String> {
   let mut connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   if let Some((session, sftp_opt)) = connections.remove(&connection_id) {
      // Explicitly close SFTP handle before disconnecting session
      if let Some(sftp) = sftp_opt {
         drop(sftp);
      }
      let _ = session.disconnect(None, "Disconnecting", None);
   }

   Ok(())
}

pub async fn ssh_get_connected_ids() -> Result<Vec<String>, String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;

   Ok(connections.keys().cloned().collect())
}

pub async fn ssh_create_file(connection_id: String, file_path: String) -> Result<(), String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, _) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   let command = format!(
      "mkdir -p \"$(dirname {0})\" && : > {0}",
      shell_quote(&file_path)
   );
   exec_remote_command(session, &command).map(|_| ())
}

pub async fn ssh_create_directory(
   connection_id: String,
   directory_path: String,
) -> Result<(), String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, _) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   let command = format!("mkdir -p {}", shell_quote(&directory_path));
   exec_remote_command(session, &command).map(|_| ())
}

pub async fn ssh_delete_path(
   connection_id: String,
   target_path: String,
   is_directory: bool,
) -> Result<(), String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, _) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   let command = if is_directory {
      format!("rm -rf {}", shell_quote(&target_path))
   } else {
      format!("rm -f {}", shell_quote(&target_path))
   };
   exec_remote_command(session, &command).map(|_| ())
}

pub async fn ssh_rename_path(
   connection_id: String,
   source_path: String,
   target_path: String,
) -> Result<(), String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, _) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   let command = format!(
      "mkdir -p \"$(dirname {target})\" && mv {source} {target}",
      source = shell_quote(&source_path),
      target = shell_quote(&target_path),
   );
   exec_remote_command(session, &command).map(|_| ())
}

pub async fn ssh_copy_path(
   connection_id: String,
   source_path: String,
   target_path: String,
   is_directory: bool,
) -> Result<(), String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, _) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   let copy_flag = if is_directory { "-R" } else { "" };
   let command = format!(
      "mkdir -p \"$(dirname {target})\" && cp {flag} {source} {target}",
      flag = copy_flag,
      source = shell_quote(&source_path),
      target = shell_quote(&target_path),
   );
   exec_remote_command(session, &command).map(|_| ())
}

#[allow(clippy::too_many_arguments)]
pub async fn create_remote_terminal(
   app: AppHandle,
   host: String,
   port: u16,
   username: String,
   password: Option<String>,
   key_path: Option<String>,
   working_directory: Option<String>,
   rows: u16,
   cols: u16,
) -> Result<String, String> {
   create_remote_terminal_inner(
      app,
      host,
      port,
      username,
      password,
      key_path,
      working_directory,
      rows,
      cols,
   )
   .await
}

pub async fn remote_terminal_write(id: String, data: String) -> Result<(), String> {
   write_remote_terminal(id, data).await
}

pub async fn remote_terminal_resize(id: String, rows: u16, cols: u16) -> Result<(), String> {
   resize_remote_terminal(id, rows, cols).await
}

pub async fn close_remote_terminal(id: String) -> Result<(), String> {
   close_remote_terminal_inner(id).await
}

pub async fn ssh_write_file(
   connection_id: String,
   file_path: String,
   content: String,
) -> Result<(), String> {
   write_file_inner(connection_id, file_path, content).await
}

pub async fn ssh_read_directory(
   connection_id: String,
   path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
   read_directory_inner(connection_id, path).await
}

pub async fn ssh_read_file(connection_id: String, file_path: String) -> Result<String, String> {
   read_file_inner(connection_id, file_path).await
}
