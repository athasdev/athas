use athas_remote::{
   RemoteFileEntry, SshConnection, ssh_connect as remote_ssh_connect,
   ssh_disconnect as remote_ssh_disconnect, ssh_disconnect_only as remote_ssh_disconnect_only,
   ssh_read_directory as remote_ssh_read_directory, ssh_read_file as remote_ssh_read_file,
   ssh_write_file as remote_ssh_write_file,
};

#[tauri::command]
pub async fn ssh_connect(
   connection_id: String,
   host: String,
   port: u16,
   username: String,
   password: Option<String>,
   key_path: Option<String>,
   use_sftp: bool,
) -> Result<SshConnection, String> {
   remote_ssh_connect(
      connection_id,
      host,
      port,
      username,
      password,
      key_path,
      use_sftp,
   )
   .await
}

#[tauri::command]
pub async fn ssh_disconnect(app: tauri::AppHandle, connection_id: String) -> Result<(), String> {
   remote_ssh_disconnect(app, connection_id).await
}

#[tauri::command]
pub async fn ssh_disconnect_only(connection_id: String) -> Result<(), String> {
   remote_ssh_disconnect_only(connection_id).await
}

#[tauri::command]
pub async fn ssh_write_file(
   connection_id: String,
   file_path: String,
   content: String,
) -> Result<(), String> {
   remote_ssh_write_file(connection_id, file_path, content).await
}

#[tauri::command]
pub async fn ssh_read_directory(
   connection_id: String,
   path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
   remote_ssh_read_directory(connection_id, path).await
}

#[tauri::command]
pub async fn ssh_read_file(connection_id: String, file_path: String) -> Result<String, String> {
   remote_ssh_read_file(connection_id, file_path).await
}
