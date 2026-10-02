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
   let Ok(home_dir) = env::var("HOME") else {
      return SshConfig::default();
   };
   let home_dir = PathBuf::from(home_dir);
   match fs::read_to_string(home_dir.join(".ssh").join("config")) {
      Ok(content) => parse_ssh_config(&content, host, &home_dir),
      Err(_) => SshConfig::default(),
   }
}

/// Matches an ssh_config pattern supporting `*` and `?` wildcards.
fn ssh_pattern_matches(pattern: &str, value: &str) -> bool {
   let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
   let value: Vec<char> = value.to_lowercase().chars().collect();
   let (mut p, mut v) = (0, 0);
   let mut backtrack: Option<(usize, usize)> = None;

   while v < value.len() {
      if p < pattern.len() && (pattern[p] == '?' || pattern[p] == value[v]) {
         p += 1;
         v += 1;
      } else if p < pattern.len() && pattern[p] == '*' {
         backtrack = Some((p, v));
         p += 1;
      } else if let Some((star, matched)) = backtrack {
         p = star + 1;
         v = matched + 1;
         backtrack = Some((star, matched + 1));
      } else {
         return false;
      }
   }

   pattern[p..].iter().all(|ch| *ch == '*')
}

/// A `Host` line applies when any pattern matches and no negated pattern does.
fn host_line_matches(patterns: &str, host: &str) -> bool {
   let mut matched = false;
   for pattern in patterns.split_whitespace() {
      if let Some(negated) = pattern.strip_prefix('!') {
         if ssh_pattern_matches(negated, host) {
            return false;
         }
      } else if ssh_pattern_matches(pattern, host) {
         matched = true;
      }
   }
   matched
}

fn split_config_line(line: &str) -> Option<(String, &str)> {
   let separator = line.find(|ch: char| ch == '=' || ch.is_whitespace())?;
   let key = line[..separator].to_lowercase();
   let rest = line[separator..].trim_start();
   let value = rest.strip_prefix('=').unwrap_or(rest).trim();
   let value = value
      .strip_prefix('"')
      .and_then(|inner| inner.strip_suffix('"'))
      .unwrap_or(value);
   (!value.is_empty()).then_some((key, value))
}

/// Resolves the options that apply to `host`. Like OpenSSH, the first value
/// obtained for each option wins, so specific `Host` blocks placed before a
/// trailing `Host *` block keep their values.
fn parse_ssh_config(content: &str, host: &str, home_dir: &Path) -> SshConfig {
   let mut config = SshConfig::default();
   let mut in_matching_section = true;

   for line in content.lines() {
      let line = line.trim();
      if line.is_empty() || line.starts_with('#') {
         continue;
      }
      let Some((key, value)) = split_config_line(line) else {
         continue;
      };

      match key.as_str() {
         "host" => in_matching_section = host_line_matches(value, host),
         // Match criteria are not evaluated; never apply their options.
         "match" => in_matching_section = false,
         _ if !in_matching_section => {}
         "hostname" => {
            config.hostname.get_or_insert_with(|| value.to_string());
         }
         "user" => {
            config.user.get_or_insert_with(|| value.to_string());
         }
         "identityfile" => {
            config.identity_file.get_or_insert_with(|| {
               expand_identity_path(value, home_dir)
                  .to_string_lossy()
                  .into_owned()
            });
         }
         "port" if config.port.is_none() => {
            config.port = value.parse::<u16>().ok();
         }
         _ => {}
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

   const CONFIG: &str = "\
# global defaults apply to every host
ServerAliveInterval 30

Host dev staging
  HostName 10.0.0.5
  User deploy
  Port 2222
  IdentityFile ~/.ssh/dev_ed25519

Host *.internal !secret.internal
  User ops

Host=equals
  HostName\tequals.example.com
  User = \"quoted user\"

Match host matched
  User should-not-apply

Host *
  User fallback
  Port 22
  IdentityFile ~/.ssh/id_default
";

   fn parse(host: &str) -> SshConfig {
      parse_ssh_config(CONFIG, host, Path::new("/home/me"))
   }

   #[test]
   fn first_matching_value_wins_over_trailing_wildcard_block() {
      let config = parse("staging");

      assert_eq!(config.hostname.as_deref(), Some("10.0.0.5"));
      assert_eq!(config.user.as_deref(), Some("deploy"));
      assert_eq!(config.port, Some(2222));
      let expected_key = Path::new("/home/me").join(".ssh/dev_ed25519");
      assert_eq!(
         config.identity_file.as_deref(),
         Some(expected_key.to_string_lossy().as_ref())
      );
   }

   #[test]
   fn matches_wildcards_and_honors_negated_patterns() {
      assert_eq!(parse("db.internal").user.as_deref(), Some("ops"));
      assert_eq!(parse("DB.Internal").user.as_deref(), Some("ops"));
      assert_eq!(parse("secret.internal").user.as_deref(), Some("fallback"));

      let unknown = parse("example.org");
      assert_eq!(unknown.hostname, None);
      assert_eq!(unknown.user.as_deref(), Some("fallback"));
      assert_eq!(unknown.port, Some(22));
   }

   #[test]
   fn accepts_equals_tabs_and_quoted_values_and_skips_match_blocks() {
      let config = parse("equals");
      assert_eq!(config.hostname.as_deref(), Some("equals.example.com"));
      assert_eq!(config.user.as_deref(), Some("quoted user"));

      assert_eq!(parse("matched").user.as_deref(), Some("fallback"));
   }

   #[test]
   fn ignores_invalid_ports_and_returns_defaults_for_empty_config() {
      let config = parse_ssh_config(
         "Host box\n  Port not-a-port\n",
         "box",
         Path::new("/home/me"),
      );
      assert_eq!(config.port, None);

      let empty = parse_ssh_config("", "box", Path::new("/home/me"));
      assert!(empty.hostname.is_none() && empty.user.is_none());
      assert!(empty.identity_file.is_none() && empty.port.is_none());
   }

   #[test]
   fn wildcard_matching_handles_question_marks_and_backtracking() {
      assert!(ssh_pattern_matches("web-??", "web-01"));
      assert!(!ssh_pattern_matches("web-??", "web-1"));
      assert!(ssh_pattern_matches("*.a.*.com", "x.a.b.a.c.com"));
      assert!(ssh_pattern_matches("*", ""));
      assert!(!ssh_pattern_matches("prod*", "staging-prod"));
   }

   #[cfg(unix)]
   #[test]
   fn shell_quoted_values_reach_the_shell_verbatim() {
      for value in [
         "plain",
         "it's a 'quoted' name",
         "$(touch /tmp/athas-pwned) `id` $HOME",
         "semi; rm -rf / && echo | cat > out",
         "line\nbreak\ttab *glob?",
      ] {
         let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(format!("printf %s {}", shell_quote(value)))
            .output()
            .unwrap();
         assert!(output.status.success());
         assert_eq!(String::from_utf8(output.stdout).unwrap(), value);
      }
   }
}
