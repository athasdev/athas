use ssh2::Session;
use std::{
   env, fs,
   io::Read,
   net::TcpStream,
   path::{Path, PathBuf},
};

#[derive(Debug, Clone, Default)]
struct SshConfig {
   hostname: Option<String>,
   user: Option<String>,
   identity_file: Option<String>,
   port: Option<u16>,
}

pub(super) fn shell_quote(value: &str) -> String {
   format!("'{}'", value.replace('\'', "'\\''"))
}

pub(super) fn exec_remote_command(session: &Session, command: &str) -> Result<String, String> {
   let mut channel = session
      .channel_session()
      .map_err(|e| format!("Failed to create channel: {}", e))?;

   channel
      .exec(command)
      .map_err(|e| format!("Failed to execute command: {}", e))?;

   let mut stdout = String::new();
   let mut stderr = String::new();

   channel
      .read_to_string(&mut stdout)
      .map_err(|e| format!("Failed to read command output: {}", e))?;
   channel
      .stderr()
      .read_to_string(&mut stderr)
      .map_err(|e| format!("Failed to read command error output: {}", e))?;

   channel.close().ok();
   channel.wait_close().ok();

   let exit_status = channel.exit_status().unwrap_or_default();
   if exit_status != 0 {
      let details = if stderr.trim().is_empty() {
         stdout.trim().to_string()
      } else {
         stderr.trim().to_string()
      };
      return Err(if details.is_empty() {
         format!("Remote command failed with exit status {}", exit_status)
      } else {
         details
      });
   }

   Ok(stdout)
}

fn expand_identity_path(key_path: &str, home_dir: &Path) -> PathBuf {
   if key_path == "~" {
      home_dir.to_path_buf()
   } else if let Some(relative_path) = key_path.strip_prefix("~/") {
      home_dir.join(relative_path)
   } else {
      PathBuf::from(key_path)
   }
}

fn get_ssh_config(host: &str) -> SshConfig {
   let mut config = SshConfig {
      hostname: None,
      user: None,
      identity_file: None,
      port: None,
   };

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

pub(super) fn create_ssh_session(
   host: &str,
   port: u16,
   username: &str,
   password: Option<&str>,
   key_path: Option<&str>,
) -> Result<Session, String> {
   let ssh_config = get_ssh_config(host);
   let home_dir = env::var("HOME").unwrap_or_default();
   create_ssh_session_with_config(
      host,
      port,
      username,
      password,
      key_path,
      &ssh_config,
      Path::new(&home_dir),
   )
}

fn create_ssh_session_with_config(
   host: &str,
   port: u16,
   username: &str,
   password: Option<&str>,
   key_path: Option<&str>,
   ssh_config: &SshConfig,
   home_dir: &Path,
) -> Result<Session, String> {
   log::info!(
      "SSH config lookup for '{}': hostname={:?}, user={:?}, identity={:?}",
      host,
      ssh_config.hostname,
      ssh_config.user,
      ssh_config.identity_file
   );

   let actual_host = ssh_config.hostname.as_deref().unwrap_or(host);
   let actual_port = ssh_config.port.unwrap_or(port);
   let actual_username = ssh_config.user.as_deref().unwrap_or(username);

   let tcp = TcpStream::connect((actual_host, actual_port)).map_err(|e| {
      format!(
         "Failed to connect to {}:{}: {}",
         actual_host, actual_port, e
      )
   })?;

   let mut sess = Session::new().map_err(|e| format!("Failed to create session: {}", e))?;
   sess.set_tcp_stream(tcp);
   sess.handshake().map_err(|e| {
      format!(
         "SSH handshake with {}:{} failed before authentication: {}. No private key has been read \
          yet; check the server SSH logs and network connection.",
         actual_host, actual_port, e
      )
   })?;

   let default_key_paths = [
      home_dir.join(".ssh/id_ed25519"),
      home_dir.join(".ssh/id_rsa"),
      home_dir.join(".ssh/id_ecdsa"),
   ];

   let configured_key_path = key_path
      .filter(|path| !path.is_empty())
      .or(ssh_config.identity_file.as_deref())
      .map(|path| expand_identity_path(path, home_dir));

   let mut keys_to_try = Vec::new();
   if let Some(key_path) = configured_key_path {
      keys_to_try.push(key_path);
   }

   for default_key in &default_key_paths {
      if !home_dir.as_os_str().is_empty()
         && default_key.is_file()
         && !keys_to_try.contains(default_key)
      {
         keys_to_try.push(default_key.clone());
      }
   }

   let mut authentication_errors = Vec::new();
   for key in &keys_to_try {
      log::info!("Attempting key authentication with: {}", key.display());
      match sess.userauth_pubkey_file(actual_username, None, key, None) {
         Ok(()) => {
            if sess.authenticated() {
               log::info!("Key authentication successful with: {}", key.display());
               return Ok(sess);
            }
         }
         Err(e) => {
            let key_error = format!("Key {} failed: {}", key.display(), e);
            log::debug!("{}", key_error);
            authentication_errors.push(key_error);
         }
      }
   }

   if keys_to_try.is_empty() {
      log::info!("No key files found to try");
   }

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
         authentication_errors.push(format!("SSH agent authentication failed: {}", e));
         log::warn!(
            "SSH agent authentication failed: {} (try running: ssh-add ~/.ssh/id_rsa)",
            e
         );
      }
   }

   if let Some(pass) = password {
      log::debug!("Trying password authentication...");
      sess
         .userauth_password(actual_username, pass)
         .map_err(|e| format!("Password authentication failed: {}", e))?;
   } else {
      return Err(format!(
         "No valid authentication method available. {}. For an encrypted private key, unlock it \
          with ssh-add and retry using the SSH agent.",
         authentication_errors.join("; ")
      ));
   }

   if !sess.authenticated() {
      return Err("Authentication failed with all available methods".to_string());
   }

   log::info!("Authentication successful!");
   Ok(sess)
}

#[cfg(test)]
#[path = "../tests/ssh/session.rs"]
mod session_tests;

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn shell_quotes_empty_and_plain_values() {
      assert_eq!(shell_quote(""), "''");
      assert_eq!(shell_quote("workspace/file.rs"), "'workspace/file.rs'");
      assert_eq!(shell_quote("path with spaces"), "'path with spaces'");
   }

   #[test]
   fn shell_quotes_single_quotes() {
      assert_eq!(shell_quote("it's safe"), "'it'\\''s safe'");
      assert_eq!(shell_quote("'"), "''\\'''");
   }
}
