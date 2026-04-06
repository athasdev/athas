use crate::{ssh_helpers::shell_quote, state::CONNECTIONS};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileEntry {
   pub name: String,
   pub path: String,
   pub is_dir: bool,
   pub size: u64,
}

pub(super) async fn write_file(
   connection_id: String,
   file_path: String,
   content: String,
) -> Result<(), String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, sftp_opt) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   if let Some(sftp) = sftp_opt {
      let remote_path = std::path::Path::new(&file_path);
      let mut file = sftp
         .create(remote_path)
         .map_err(|e| format!("Failed to create file: {}", e))?;

      file
         .write_all(content.as_bytes())
         .map_err(|e| format!("Failed to write file: {}", e))?;

      Ok(())
   } else {
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("cat > '{}'", file_path.replace('\'', "'\\''"));
      channel
         .exec(&command)
         .map_err(|e| format!("Failed to execute command: {}", e))?;

      channel
         .write_all(content.as_bytes())
         .map_err(|e| format!("Failed to write content: {}", e))?;

      channel
         .send_eof()
         .map_err(|e| format!("Failed to send EOF: {}", e))?;

      channel.close().ok();
      channel.wait_close().ok();
      Ok(())
   }
}

pub(super) async fn read_directory(
   connection_id: String,
   path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, sftp_opt) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   let dir_path = if path.is_empty() { "/" } else { &path };

   if let Some(sftp) = sftp_opt {
      let remote_path = std::path::Path::new(dir_path);
      let entries = sftp
         .readdir(remote_path)
         .map_err(|e| format!("Failed to read directory: {}", e))?;

      let mut result: Vec<RemoteFileEntry> = entries
         .into_iter()
         .filter_map(|(path_buf, stat)| {
            let name = path_buf.file_name()?.to_string_lossy().to_string();
            if name.starts_with('.') {
               return None;
            }
            let full_path = path_buf.to_string_lossy().to_string();
            Some(RemoteFileEntry {
               name,
               path: full_path,
               is_dir: stat.is_dir(),
               size: stat.size.unwrap_or(0),
            })
         })
         .collect();

      result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
         (true, false) => std::cmp::Ordering::Less,
         (false, true) => std::cmp::Ordering::Greater,
         _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
      });

      Ok(result)
   } else {
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("ls -la {}", shell_quote(dir_path));
      channel
         .exec(&command)
         .map_err(|e| format!("Failed to execute command: {}", e))?;

      let mut output = String::new();
      channel
         .read_to_string(&mut output)
         .map_err(|e| format!("Failed to read output: {}", e))?;

      channel.close().ok();
      channel.wait_close().ok();

      let entries: Vec<RemoteFileEntry> = output
         .lines()
         .skip(1)
         .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 9 {
               return None;
            }
            let name = parts[8..].join(" ");
            if name == "." || name == ".." || name.starts_with('.') {
               return None;
            }
            let is_dir = parts[0].starts_with('d');
            let size: u64 = parts[4].parse().unwrap_or(0);
            let full_path = if dir_path == "/" {
               format!("/{}", name)
            } else {
               format!("{}/{}", dir_path, name)
            };
            Some(RemoteFileEntry {
               name,
               path: full_path,
               is_dir,
               size,
            })
         })
         .collect();

      Ok(entries)
   }
}

pub(super) async fn read_file(connection_id: String, file_path: String) -> Result<String, String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, sftp_opt) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   if let Some(sftp) = sftp_opt {
      let remote_path = std::path::Path::new(&file_path);
      let mut file = sftp
         .open(remote_path)
         .map_err(|e| format!("Failed to open file: {}", e))?;

      let mut content = String::new();
      file
         .read_to_string(&mut content)
         .map_err(|e| format!("Failed to read file: {}", e))?;

      Ok(content)
   } else {
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("cat '{}'", file_path.replace('\'', "'\\''"));
      channel
         .exec(&command)
         .map_err(|e| format!("Failed to execute command: {}", e))?;

      let mut content = String::new();
      channel
         .read_to_string(&mut content)
         .map_err(|e| format!("Failed to read file: {}", e))?;

      channel.close().ok();
      channel.wait_close().ok();

      Ok(content)
   }
}
