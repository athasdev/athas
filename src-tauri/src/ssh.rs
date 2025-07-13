use serde::{Deserialize, Serialize};
use ssh2::{Session, Sftp};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::prelude::*;
use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
}

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
                                let expanded_path = if let Some(stripped) = value.strip_prefix("~/")
                                {
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
    sess.handshake()
        .map_err(|e| format!("Failed to handshake: {}", e))?;

    // Determine key file to use (prefer SSH config, then provided, then default)
    let default_key_path = if let Ok(home_dir) = env::var("HOME") {
        format!("{}/.ssh/id_rsa", home_dir)
    } else {
        String::new()
    };

    let key_file = key_path
        .or(ssh_config.identity_file.as_deref())
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| {
            if Path::new(&default_key_path).exists() {
                &default_key_path
            } else {
                ""
            }
        });

    // Try key authentication first (most secure and common for SSH configs)
    if !key_file.is_empty() && Path::new(key_file).exists() {
        log::debug!("Attempting key authentication with: {}", key_file);
        match sess.userauth_pubkey_file(actual_username, None, Path::new(key_file), None) {
            Ok(()) => {
                if sess.authenticated() {
                    log::info!("Key authentication successful");
                    return Ok(sess);
                }
            }
            Err(e) => {
                log::debug!("Key authentication failed: {}", e);
                // Continue to try other methods
            }
        }
    }

    // Try agent authentication (for loaded SSH keys)
    log::debug!("Trying SSH agent authentication...");
    match sess.userauth_agent(actual_username) {
        Ok(()) => {
            if sess.authenticated() {
                log::info!("SSH agent authentication successful");
                return Ok(sess);
            }
        }
        Err(e) => {
            log::debug!("SSH agent authentication failed: {}", e);
            // Continue to try password
        }
    }

    // Finally try password authentication if provided
    if let Some(pass) = password {
        log::debug!("Trying password authentication...");
        sess.userauth_password(actual_username, pass)
            .map_err(|e| format!("Password authentication failed: {}", e))?;
    } else {
        return Err("No valid authentication method available. Please provide a password or ensure your SSH key is properly configured.".to_string());
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
        let mut connections = CONNECTIONS.lock().unwrap();
        connections.insert(connection_id, (session, sftp));
    }

    Ok(connection)
}

#[command]
pub async fn ssh_disconnect(connection_id: String) -> Result<(), String> {
    let mut connections = CONNECTIONS.lock().unwrap();
    if let Some((session, _)) = connections.remove(&connection_id) {
        let _ = session.disconnect(None, "Disconnecting", None);
    }
    Ok(())
}

#[command]
pub async fn ssh_list_directory(
    connection_id: String,
    path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
    let connections = CONNECTIONS.lock().unwrap();
    let (session, sftp_opt) = connections
        .get(&connection_id)
        .ok_or("Connection not found")?;

    if let Some(sftp) = sftp_opt {
        // Use SFTP for file listing
        let remote_path = std::path::Path::new(&path);
        let dir = sftp
            .readdir(remote_path)
            .map_err(|e| format!("Failed to read directory: {}", e))?;

        let mut entries = Vec::new();
        for (path, stat) in dir {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let full_path = path.to_string_lossy().to_string();
            let is_directory = stat.is_dir();
            let size = stat.size.unwrap_or(0);

            entries.push(RemoteFileEntry {
                name,
                path: full_path,
                is_dir: is_directory,
                size,
                modified: None, // Could add mtime parsing here
            });
        }

        // Sort: directories first, then files
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
    } else {
        // Use SSH command for listing
        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        let command = format!("ls -la '{}'", path.replace("'", "\\'"));
        channel
            .exec(&command)
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let mut output = String::new();
        channel
            .read_to_string(&mut output)
            .map_err(|e| format!("Failed to read output: {}", e))?;

        channel.wait_close().ok();

        // Parse ls output (simplified)
        let mut entries = Vec::new();
        for line in output.lines().skip(1) {
            // Skip "total" line
            if line.trim().is_empty() || line.starts_with("total") {
                continue;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 9 {
                let permissions = parts[0];
                let is_directory = permissions.starts_with('d');
                let name = parts[8..].join(" ");

                if name == "." || name == ".." {
                    continue;
                }

                let full_path = if path.ends_with('/') {
                    format!("{}{}", path, name)
                } else {
                    format!("{}/{}", path, name)
                };

                entries.push(RemoteFileEntry {
                    name,
                    path: full_path,
                    is_dir: is_directory,
                    size: parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0),
                    modified: None,
                });
            }
        }

        Ok(entries)
    }
}

#[command]
pub async fn ssh_read_file(connection_id: String, file_path: String) -> Result<String, String> {
    let connections = CONNECTIONS.lock().unwrap();
    let (session, sftp_opt) = connections
        .get(&connection_id)
        .ok_or("Connection not found")?;

    if let Some(sftp) = sftp_opt {
        // Use SFTP for file reading
        let remote_path = std::path::Path::new(&file_path);
        let mut file = sftp
            .open(remote_path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        Ok(contents)
    } else {
        // Use SSH command for reading
        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Failed to create channel: {}", e))?;

        let command = format!("cat '{}'", file_path.replace("'", "\\'"));
        channel
            .exec(&command)
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let mut contents = String::new();
        channel
            .read_to_string(&mut contents)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        channel.wait_close().ok();
        Ok(contents)
    }
}

#[command]
pub async fn ssh_write_file(
    connection_id: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let connections = CONNECTIONS.lock().unwrap();
    let (session, sftp_opt) = connections
        .get(&connection_id)
        .ok_or("Connection not found")?;

    if let Some(sftp) = sftp_opt {
        // Use SFTP for file writing
        let remote_path = std::path::Path::new(&file_path);
        let mut file = sftp
            .create(remote_path)
            .map_err(|e| format!("Failed to create file: {}", e))?;

        file.write_all(content.as_bytes())
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

        channel.wait_close().ok();
        Ok(())
    }
}

#[command]
pub async fn ssh_execute_command(connection_id: String, command: String) -> Result<String, String> {
    let connections = CONNECTIONS.lock().unwrap();
    let (session, _) = connections
        .get(&connection_id)
        .ok_or("Connection not found")?;

    let mut channel = session
        .channel_session()
        .map_err(|e| format!("Failed to create channel: {}", e))?;

    channel
        .exec(&command)
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|e| format!("Failed to read output: {}", e))?;

    channel.wait_close().ok();
    Ok(output)
}
