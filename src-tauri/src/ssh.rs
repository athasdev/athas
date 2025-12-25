use serde::{Deserialize, Serialize};
use ssh2::{Session, Sftp};
use std::{
   collections::HashMap,
   env, fs,
   io::prelude::*,
   net::TcpStream,
   path::Path,
   sync::{Arc, Mutex},
};
use tauri::{Manager, command};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnection {
   pub id: String,
   pub name: String,
   pub host: String,
   pub port: u16,
   pub username: String,
   pub connected: bool,
}

// Global connection storage
type ConnectionStorage = Arc<Mutex<HashMap<String, (Session, Option<Sftp>)>>>;

lazy_static::lazy_static! {
    static ref CONNECTIONS: ConnectionStorage = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Debug, Clone)]
struct SshConfig {
   hostname: Option<String>,
   user: Option<String>,
   identity_file: Option<String>,
   port: Option<u16>,
}

fn get_ssh_config(host: &str) -> SshConfig {
   let mut config = SshConfig {
      hostname: None,
      user: None,
      identity_file: None,
      port: None,
   };

   // Try to read SSH config file
   if let Ok(home_dir) = env::var("HOME") {
      let ssh_config_path = format!("{}/.ssh/config", home_dir);
      if let Ok(content) = fs::read_to_string(&ssh_config_path) {
         let mut in_host_section = false;

         for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
               continue;
            }

            if line.to_lowercase().starts_with("host ") {
               let current_host_pattern = line[5..].trim();
               in_host_section = current_host_pattern == host || current_host_pattern == "*";
               continue;
            }

            if in_host_section {
               let parts: Vec<&str> = line.splitn(2, ' ').collect();
               if parts.len() == 2 {
                  let key = parts[0].to_lowercase();
                  let value = parts[1].trim();

                  match key.as_str() {
                     "hostname" => config.hostname = Some(value.to_string()),
                     "user" => config.user = Some(value.to_string()),
                     "identityfile" => {
                        let expanded_path = if let Some(stripped) = value.strip_prefix("~/") {
                           format!("{}/{}", home_dir, stripped)
                        } else {
                           value.to_string()
                        };
                        config.identity_file = Some(expanded_path);
                     }
                     "port" => {
                        if let Ok(port) = value.parse::<u16>() {
                           config.port = Some(port);
                        }
                     }
                     _ => {}
                  }
               }
            }
         }
      }
   }

   config
}

pub fn create_ssh_session(
   host: &str,
   port: u16,
   username: &str,
   password: Option<&str>,
   key_path: Option<&str>,
) -> Result<Session, String> {
   // Get SSH config for this host
   let ssh_config = get_ssh_config(host);
   log::info!(
      "SSH config lookup for '{}': hostname={:?}, user={:?}, identity={:?}",
      host,
      ssh_config.hostname,
      ssh_config.user,
      ssh_config.identity_file
   );

   // Use SSH config values if available, otherwise use provided values
   let actual_host = ssh_config.hostname.as_deref().unwrap_or(host);
   let actual_port = ssh_config.port.unwrap_or(port);
   let actual_username = ssh_config.user.as_deref().unwrap_or(username);

   let tcp = TcpStream::connect(format!("{}:{}", actual_host, actual_port)).map_err(|e| {
      format!(
         "Failed to connect to {}:{}: {}",
         actual_host, actual_port, e
      )
   })?;

   let mut sess = Session::new().map_err(|e| format!("Failed to create session: {}", e))?;
   sess.set_tcp_stream(tcp);
   sess
      .handshake()
      .map_err(|e| format!("Failed to handshake: {}", e))?;

   // Determine key file to use (prefer SSH config, then provided, then check common defaults)
   let home_dir = env::var("HOME").unwrap_or_default();
   let default_key_paths = [
      format!("{}/.ssh/id_ed25519", home_dir),
      format!("{}/.ssh/id_rsa", home_dir),
      format!("{}/.ssh/id_ecdsa", home_dir),
   ];

   let key_file = key_path
      .or(ssh_config.identity_file.as_deref())
      .filter(|path| !path.is_empty() && Path::new(path).exists())
      .or_else(|| {
         default_key_paths
            .iter()
            .find(|path| Path::new(path).exists())
            .map(|s| s.as_str())
      })
      .unwrap_or("");

   // Build list of key files to try
   let mut keys_to_try: Vec<String> = Vec::new();

   // First priority: explicitly provided key or from SSH config
   if !key_file.is_empty() && Path::new(key_file).exists() {
      keys_to_try.push(key_file.to_string());
   }

   // Also try all default keys as fallback
   for default_key in &default_key_paths {
      if Path::new(default_key).exists() && !keys_to_try.contains(default_key) {
         keys_to_try.push(default_key.clone());
      }
   }

   // Try each key file
   for key in &keys_to_try {
      log::info!("Attempting key authentication with: {}", key);
      match sess.userauth_pubkey_file(actual_username, None, Path::new(key), None) {
         Ok(()) => {
            if sess.authenticated() {
               log::info!("Key authentication successful with: {}", key);
               return Ok(sess);
            }
         }
         Err(e) => {
            log::debug!("Key {} failed: {}", key, e);
            // Continue to try next key
         }
      }
   }

   if keys_to_try.is_empty() {
      log::info!("No key files found to try");
   }

   // Try agent authentication (for loaded SSH keys)
   log::info!(
      "Trying SSH agent authentication for user '{}'...",
      actual_username
   );
   match sess.userauth_agent(actual_username) {
      Ok(()) => {
         if sess.authenticated() {
            log::info!("SSH agent authentication successful");
            return Ok(sess);
         }
         log::warn!("SSH agent auth returned Ok but not authenticated");
      }
      Err(e) => {
         log::warn!(
            "SSH agent authentication failed: {} (try running: ssh-add ~/.ssh/id_rsa)",
            e
         );
         // Continue to try password
      }
   }

   // Finally try password authentication if provided
   if let Some(pass) = password {
      log::debug!("Trying password authentication...");
      sess
         .userauth_password(actual_username, pass)
         .map_err(|e| format!("Password authentication failed: {}", e))?;
   } else {
      return Err(
         "No valid authentication method available. Please provide a password or ensure your SSH \
          key is properly configured."
            .to_string(),
      );
   }

   if !sess.authenticated() {
      return Err("Authentication failed with all available methods".to_string());
   }

   log::info!("Authentication successful!");
   Ok(sess)
}

#[command]
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

#[command]
pub async fn ssh_disconnect(app: tauri::AppHandle, connection_id: String) -> Result<(), String> {
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

#[command]
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

#[command]
pub async fn ssh_write_file(
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
      // Use SFTP for file writing
      let remote_path = std::path::Path::new(&file_path);
      let mut file = sftp
         .create(remote_path)
         .map_err(|e| format!("Failed to create file: {}", e))?;

      file
         .write_all(content.as_bytes())
         .map_err(|e| format!("Failed to write file: {}", e))?;

      Ok(())
   } else {
      // Use SSH command for writing (more complex, using echo or heredoc)
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("cat > '{}'", file_path.replace("'", "\\'"));
      channel
         .exec(&command)
         .map_err(|e| format!("Failed to execute command: {}", e))?;

      channel
         .write_all(content.as_bytes())
         .map_err(|e| format!("Failed to write content: {}", e))?;

      channel
         .send_eof()
         .map_err(|e| format!("Failed to send EOF: {}", e))?;

      // Explicitly close the channel and wait for it to close
      channel.close().ok();
      channel.wait_close().ok();
      Ok(())
   }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileEntry {
   pub name: String,
   pub path: String,
   pub is_dir: bool,
   pub size: u64,
}

#[command]
pub async fn ssh_read_directory(
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
      // Use SFTP for directory listing
      let remote_path = std::path::Path::new(dir_path);
      let entries = sftp
         .readdir(remote_path)
         .map_err(|e| format!("Failed to read directory: {}", e))?;

      let mut result: Vec<RemoteFileEntry> = entries
         .into_iter()
         .filter_map(|(path_buf, stat)| {
            let name = path_buf.file_name()?.to_string_lossy().to_string();
            // Skip hidden files starting with .
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

      // Sort: directories first, then by name
      result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
         (true, false) => std::cmp::Ordering::Less,
         (false, true) => std::cmp::Ordering::Greater,
         _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
      });

      Ok(result)
   } else {
      // Use SSH command for listing (fallback)
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("ls -la '{}'", dir_path.replace("'", "\\'"));
      channel
         .exec(&command)
         .map_err(|e| format!("Failed to execute command: {}", e))?;

      let mut output = String::new();
      channel
         .read_to_string(&mut output)
         .map_err(|e| format!("Failed to read output: {}", e))?;

      channel.close().ok();
      channel.wait_close().ok();

      // Parse ls -la output (simplified)
      let entries: Vec<RemoteFileEntry> = output
         .lines()
         .skip(1) // Skip total line
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

#[command]
pub async fn ssh_read_file(connection_id: String, file_path: String) -> Result<String, String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, sftp_opt) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   if let Some(sftp) = sftp_opt {
      // Use SFTP for file reading
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
      // Use SSH command for reading
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("cat '{}'", file_path.replace("'", "\\'"));
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
