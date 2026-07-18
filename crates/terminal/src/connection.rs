use crate::{
   config::TerminalConfig,
   protocol::{TerminalEvent, TerminalEventHandler, TerminalReaderControl, TerminalSize},
   shell::get_shell_by_id,
};
use anyhow::{Result, anyhow};
use portable_pty::{Child, CommandBuilder, PtyPair, PtySize};
use std::{
   collections::HashMap,
   io::{Read, Write},
   path::Path,
   sync::{Arc, Mutex, OnceLock},
   thread,
};
static USER_ENVIRONMENT_CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();

pub struct TerminalConnection {
   pub id: String,
   pub pty_pair: PtyPair,
   pub event_handler: TerminalEventHandler,
   pub writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
   pub child: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
   pub reader_control: Arc<TerminalReaderControl>,
}

impl TerminalConnection {
   pub fn new(
      id: String,
      config: TerminalConfig,
      event_handler: TerminalEventHandler,
   ) -> Result<Self> {
      let pty_system = portable_pty::native_pty_system();

      let size = config.size.normalized();
      let pty_pair = pty_system.openpty(PtySize {
         rows: size.rows,
         cols: size.cols,
         pixel_width: size.pixel_width,
         pixel_height: size.pixel_height,
      })?;

      let cmd = Self::build_command(&config)?;
      let child = pty_pair.slave.spawn_command(cmd)?;
      let writer = Arc::new(Mutex::new(Some(pty_pair.master.take_writer()?)));
      let child = Arc::new(Mutex::new(Some(child)));

      Ok(Self {
         id,
         pty_pair,
         event_handler,
         writer,
         child,
         reader_control: Arc::new(TerminalReaderControl::default()),
      })
   }

   /// Get the user's shell environment by sourcing their login shell profile.
   /// This is critical for production builds on macOS where GUI apps don't inherit
   /// the user's shell environment when launched from Finder/Launchpad.
   #[cfg(not(target_os = "windows"))]
   fn get_user_environment() -> HashMap<String, String> {
      USER_ENVIRONMENT_CACHE
         .get_or_init(Self::load_user_environment)
         .clone()
   }

   #[cfg(not(target_os = "windows"))]
   fn load_user_environment() -> HashMap<String, String> {
      use std::{
         io::{BufRead, BufReader},
         process::Command,
      };

      let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

      // Run the shell as an interactive login shell to source user's profile,
      // then print all environment variables
      let output = Command::new(&shell).args(["-ilc", "env"]).output();

      let mut env_map = HashMap::new();

      if let Ok(output) = output {
         let reader = BufReader::new(output.stdout.as_slice());
         for line in reader.lines() {
            if let Ok(line) = line
               && let Some((key, value)) = line.split_once('=')
            {
               env_map.insert(key.to_string(), value.to_string());
            }
         }
      }

      // Ensure critical variables have fallback values
      if !env_map.contains_key("HOME") {
         if let Ok(home) = std::env::var("HOME") {
            env_map.insert("HOME".to_string(), home);
         } else if let Some(home_dir) = dirs::home_dir() {
            env_map.insert("HOME".to_string(), home_dir.to_string_lossy().to_string());
         }
      }

      if !env_map.contains_key("USER")
         && let Ok(user) = std::env::var("USER")
      {
         env_map.insert("USER".to_string(), user);
      }

      if !env_map.contains_key("PATH") {
         // Fallback PATH with common locations
         env_map.insert(
            "PATH".to_string(),
            "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
         );
      }

      if !env_map.contains_key("LANG") {
         env_map.insert("LANG".to_string(), "en_US.UTF-8".to_string());
      }

      env_map
   }

   #[cfg(target_os = "windows")]
   fn get_user_environment() -> HashMap<String, String> {
      let mut env_map: HashMap<String, String> = std::env::vars().collect();
      Self::ensure_windows_profile_environment(&mut env_map);
      env_map
   }

   #[cfg(not(target_os = "windows"))]
   pub fn warm_user_environment() {
      let _ = thread::Builder::new()
         .name("terminal-env-prewarm".to_string())
         .spawn(|| {
            let _ = USER_ENVIRONMENT_CACHE.get_or_init(Self::load_user_environment);
         });
   }

   #[cfg(target_os = "windows")]
   pub fn warm_user_environment() {
   }

   fn build_command(config: &TerminalConfig) -> Result<CommandBuilder> {
      let default_shell = || {
         if cfg!(target_os = "windows") {
            "cmd.exe".to_string()
         } else {
            std::env::var("SHELL").unwrap_or_else(|_| {
               if std::path::Path::new("/bin/zsh").exists() {
                  "/bin/zsh".to_string()
               } else if std::path::Path::new("/bin/bash").exists() {
                  "/bin/bash".to_string()
               } else {
                  "/bin/sh".to_string()
               }
            })
         }
      };

      let selected_shell_id = config.shell.as_deref();
      let (mut cmd, shell_path): (CommandBuilder, Option<String>) =
         if let Some(command) = &config.command {
            let mut builder = CommandBuilder::new(command);
            if let Some(args) = &config.args {
               builder.args(args);
            }
            (builder, None)
         } else {
            let default_shell = default_shell();
            let shell_path = Self::resolve_shell_path(selected_shell_id, &default_shell);
            let mut builder = CommandBuilder::new(&shell_path);
            Self::configure_shell_startup(&mut builder, config, selected_shell_id, &shell_path);

            (builder, Some(shell_path))
         };

      let selected_shell_path = shell_path.as_deref();
      let should_set_host_cwd = !Self::is_wsl_shell(selected_shell_id, selected_shell_path)
         || config
            .working_directory
            .as_deref()
            .is_some_and(|path| !athas_wsl::is_wsl_path(path));

      if let Some(working_dir) = &config.working_directory
         && should_set_host_cwd
      {
         Self::ensure_working_directory_access(working_dir)?;
         cmd.cwd(working_dir);
      }

      // First, inherit user's full shell environment
      // This ensures PATH, HOME, USER, LANG, and other critical vars are available
      let user_env = Self::get_user_environment();
      for (key, value) in &user_env {
         cmd.env(key, value);
      }

      let custom_no_color_requested = Self::custom_env_has_key(config, "NO_COLOR");

      // Then override with terminal-specific environment variables
      cmd.env("TERM", "xterm-256color");
      cmd.env("COLORTERM", "truecolor");
      cmd.env("TERM_PROGRAM", "athas");
      cmd.env(
         "TERM_PROGRAM_VERSION",
         config
            .term_program_version
            .as_deref()
            .unwrap_or(env!("CARGO_PKG_VERSION")),
      );
      if let Some(shell_path) = shell_path {
         cmd.env("SHELL", shell_path);
      }
      cmd.env("CLICOLOR", "1");

      Self::remove_inherited_terminal_markers(&mut cmd, &user_env);

      if !custom_no_color_requested {
         cmd.env_remove("NO_COLOR");
      }
      cmd.env_remove("FORCE_COLOR");
      cmd.env_remove("CLICOLOR_FORCE");

      // Copy over custom environment variables (highest priority)
      if let Some(env_vars) = &config.environment {
         for (key, value) in env_vars {
            cmd.env(key, value);
         }
      }

      Ok(cmd)
   }

   fn remove_inherited_terminal_markers(
      cmd: &mut CommandBuilder,
      environment: &HashMap<String, String>,
   ) {
      const EXACT_MARKERS: &[&str] = &[
         "WT_SESSION",
         "TERM_SESSION_ID",
         "VTE_VERSION",
         "TMUX",
         "TMUX_PANE",
      ];
      const PREFIX_MARKERS: &[&str] = &["KITTY_", "GHOSTTY_", "WEZTERM_", "ITERM_"];

      for key in environment.keys() {
         let upper = key.to_ascii_uppercase();
         if EXACT_MARKERS.contains(&upper.as_str())
            || PREFIX_MARKERS
               .iter()
               .any(|prefix| upper.starts_with(prefix))
         {
            cmd.env_remove(key);
         }
      }
   }

   fn resolve_shell_path(shell_id: Option<&str>, default_shell: &str) -> String {
      let Some(shell_id) = shell_id else {
         return default_shell.to_string();
      };

      if let Some(shell) = get_shell_by_id(shell_id) {
         if cfg!(target_os = "windows") {
            return shell
               .exec_win
               .or_else(|| Self::windows_builtin_shell_executable(shell_id).map(str::to_string))
               .unwrap_or_else(|| default_shell.to_string());
         }

         return shell.exec_unix.unwrap_or_else(|| default_shell.to_string());
      }

      if cfg!(target_os = "windows")
         && let Some(executable) = Self::windows_builtin_shell_executable(shell_id)
      {
         return executable.to_string();
      }

      default_shell.to_string()
   }

   fn configure_shell_startup(
      cmd: &mut CommandBuilder,
      config: &TerminalConfig,
      shell_id: Option<&str>,
      shell_path: &str,
   ) {
      if cfg!(target_os = "windows") {
         cmd.args(Self::shell_startup_args(config, shell_id, shell_path));
      }
   }

   fn shell_startup_args(
      config: &TerminalConfig,
      shell_id: Option<&str>,
      shell_path: &str,
   ) -> Vec<String> {
      if Self::is_powershell_shell(shell_id, shell_path) {
         return vec!["-NoLogo".to_string()];
      }

      if Self::is_wsl_shell(shell_id, Some(shell_path)) {
         return Self::wsl_startup_args(config, shell_id);
      }

      Vec::new()
   }

   fn wsl_startup_args(config: &TerminalConfig, shell_id: Option<&str>) -> Vec<String> {
      let mut args = Vec::new();
      let mut distribution = config.wsl_distribution.clone().or_else(|| {
         shell_id
            .and_then(athas_wsl::parse_wsl_shell_id)
            .map(str::to_string)
      });
      let mut working_directory = config.wsl_working_directory.clone();

      if let Some(working_dir) = config.working_directory.as_deref() {
         if athas_wsl::is_wsl_path(working_dir) {
            if let Ok(parsed) = athas_wsl::parse_wsl_uri(working_dir) {
               distribution = Some(parsed.distro);
               working_directory = Some(parsed.linux_path);
            }
         } else if working_directory.is_none() {
            working_directory = athas_wsl::windows_path_to_wsl_path(working_dir);
         }
      }

      if let Some(distribution) = distribution.filter(|value| !value.trim().is_empty()) {
         args.push("--distribution".to_string());
         args.push(distribution);
      }

      if let Some(working_directory) = working_directory.filter(|value| !value.trim().is_empty()) {
         args.push("--cd".to_string());
         args.push(working_directory);
      }

      args
   }

   fn is_wsl_shell(shell_id: Option<&str>, shell_path: Option<&str>) -> bool {
      if shell_id.is_some_and(|id| {
         id.eq_ignore_ascii_case("wsl") || athas_wsl::parse_wsl_shell_id(id).is_some()
      }) {
         true
      } else {
         shell_path.is_some_and(|path| {
            Self::executable_name(path).is_some_and(|name| name.eq_ignore_ascii_case("wsl.exe"))
         })
      }
   }

   fn is_powershell_shell(shell_id: Option<&str>, shell_path: &str) -> bool {
      shell_id
         .is_some_and(|id| id.eq_ignore_ascii_case("powershell") || id.eq_ignore_ascii_case("pwsh"))
         || Self::executable_name(shell_path).is_some_and(|name| {
            name.eq_ignore_ascii_case("powershell.exe") || name.eq_ignore_ascii_case("pwsh.exe")
         })
   }

   fn executable_name(path: &str) -> Option<&str> {
      path
         .rsplit(['/', '\\'])
         .next()
         .filter(|name| !name.is_empty())
         .or_else(|| Path::new(path).file_name().and_then(|name| name.to_str()))
   }

   fn windows_builtin_shell_executable(shell_id: &str) -> Option<&'static str> {
      if shell_id.eq_ignore_ascii_case("cmd") {
         Some("cmd.exe")
      } else if shell_id.eq_ignore_ascii_case("powershell") {
         Some("powershell.exe")
      } else if shell_id.eq_ignore_ascii_case("pwsh") {
         Some("pwsh.exe")
      } else if shell_id.eq_ignore_ascii_case("nu") {
         Some("nu.exe")
      } else if shell_id.eq_ignore_ascii_case("wsl") {
         Some("wsl.exe")
      } else if athas_wsl::parse_wsl_shell_id(shell_id).is_some() {
         Some("wsl.exe")
      } else if shell_id.eq_ignore_ascii_case("bash") {
         Some("bash.exe")
      } else {
         None
      }
   }

   #[cfg(target_os = "windows")]
   fn ensure_windows_profile_environment(env_map: &mut HashMap<String, String>) {
      if !Self::has_env_key(env_map, "USERPROFILE")
         && let Some(home_dir) = dirs::home_dir()
      {
         env_map.insert(
            "USERPROFILE".to_string(),
            home_dir.to_string_lossy().to_string(),
         );
      }

      let user_profile = env_map
         .iter()
         .find(|(key, _)| key.eq_ignore_ascii_case("USERPROFILE"))
         .map(|(_, value)| value.clone());

      if !Self::has_env_key(env_map, "HOME")
         && let Some(user_profile) = &user_profile
      {
         env_map.insert("HOME".to_string(), user_profile.clone());
      }

      if let Some(user_profile) = user_profile
         && !Self::has_env_key(env_map, "HOMEDRIVE")
         && !Self::has_env_key(env_map, "HOMEPATH")
         && user_profile.len() > 2
         && user_profile.as_bytes().get(1) == Some(&b':')
      {
         let (drive, path) = user_profile.split_at(2);
         env_map.insert("HOMEDRIVE".to_string(), drive.to_string());
         env_map.insert("HOMEPATH".to_string(), path.to_string());
      }
   }

   fn custom_env_has_key(config: &TerminalConfig, key: &str) -> bool {
      config
         .environment
         .as_ref()
         .is_some_and(|env| Self::has_env_key(env, key))
   }

   fn has_env_key(env: &HashMap<String, String>, key: &str) -> bool {
      env.keys().any(|env_key| env_key.eq_ignore_ascii_case(key))
   }

   fn ensure_working_directory_access(working_dir: &str) -> Result<()> {
      let path = Path::new(working_dir);
      let metadata = path.metadata().map_err(|err| {
         Self::working_directory_error(working_dir, err, "inspect the terminal working directory")
      })?;

      if !metadata.is_dir() {
         return Err(anyhow!(
            "Terminal working directory is not a directory: {}",
            working_dir
         ));
      }

      path.read_dir().map_err(|err| {
         Self::working_directory_error(working_dir, err, "read the terminal working directory")
      })?;

      Ok(())
   }

   fn working_directory_error(
      working_dir: &str,
      err: std::io::Error,
      operation: &str,
   ) -> anyhow::Error {
      if err.kind() == std::io::ErrorKind::PermissionDenied {
         return anyhow!(
            "Athas does not have permission to {operation}: {working_dir}. On macOS, allow Athas \
             in System Settings > Privacy & Security > Files and Folders, or grant Full Disk \
             Access for developer tools that need broad project access."
         );
      }

      anyhow!("Failed to {operation}: {working_dir}: {err}")
   }

   pub fn start_reader_thread(&self) {
      let id = self.id.clone();
      let event_handler = self.event_handler.clone();
      let child = self.child.clone();
      let reader_control = self.reader_control.clone();
      let mut reader = self
         .pty_pair
         .master
         .try_clone_reader()
         .expect("Failed to clone reader");

      thread::spawn(move || {
         let mut buffer = vec![0u8; 65536]; // 64KB buffer for better performance
         loop {
            if !reader_control.wait_until_resumed() {
               break;
            }

            match reader.read(&mut buffer) {
               Ok(0) => {
                  let (exit_code, signal) = Self::child_exit_status(&child, true);
                  event_handler(&id, TerminalEvent::Exit { exit_code, signal });
                  event_handler(&id, TerminalEvent::Closed);
                  break;
               }
               Ok(n) => {
                  if !event_handler(
                     &id,
                     TerminalEvent::Output {
                        data: buffer[..n].to_vec(),
                     },
                  ) {
                     break;
                  }
               }
               Err(e) => {
                  let should_wait_for_status = e.raw_os_error() == Some(5)
                     || matches!(
                        e.kind(),
                        std::io::ErrorKind::BrokenPipe | std::io::ErrorKind::UnexpectedEof
                     );
                  let (exit_code, signal) = Self::child_exit_status(&child, should_wait_for_status);
                  if exit_code.is_some() || signal.is_some() {
                     event_handler(&id, TerminalEvent::Exit { exit_code, signal });
                  } else {
                     eprintln!("Error reading from PTY: {}", e);
                     event_handler(
                        &id,
                        TerminalEvent::Error {
                           message: e.to_string(),
                        },
                     );
                  }
                  event_handler(&id, TerminalEvent::Closed);
                  break;
               }
            }
         }
      });
   }

   fn child_exit_status(
      child: &Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
      wait: bool,
   ) -> (Option<u32>, Option<String>) {
      let Ok(mut child_guard) = child.lock() else {
         return (None, None);
      };
      let Some(child) = child_guard.as_mut() else {
         return (None, None);
      };

      let status = child
         .try_wait()
         .ok()
         .flatten()
         .or_else(|| wait.then(|| child.wait().ok()).flatten());

      status.map_or((None, None), |status| {
         (
            Some(status.exit_code()),
            status.signal().map(str::to_string),
         )
      })
   }

   pub fn write(&self, data: &[u8]) -> Result<()> {
      let mut writer_guard = self.writer.lock().unwrap();
      if let Some(writer) = writer_guard.as_mut() {
         writer.write_all(data)?;
         writer.flush()?;
         Ok(())
      } else {
         Err(anyhow!("Terminal writer is not available"))
      }
   }

   pub fn resize(&self, size: TerminalSize) -> Result<()> {
      let size = size.normalized();
      self.pty_pair.master.resize(PtySize {
         rows: size.rows,
         cols: size.cols,
         pixel_width: size.pixel_width,
         pixel_height: size.pixel_height,
      })?;
      Ok(())
   }

   pub fn set_paused(&self, paused: bool) {
      self.reader_control.set_paused(paused);
   }

   pub fn kill(&self) -> Result<()> {
      self.reader_control.set_paused(false);
      let mut child_guard = self.child.lock().unwrap();
      if let Some(child) = child_guard.as_mut() {
         if child.try_wait()?.is_some() {
            return Ok(());
         }
         child.kill()?;
      }
      Ok(())
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::ffi::OsStr;

   fn config_with_env(environment: HashMap<String, String>) -> TerminalConfig {
      TerminalConfig {
         working_directory: None,
         shell: None,
         wsl_distribution: None,
         wsl_working_directory: None,
         environment: Some(environment),
         command: Some("node".to_string()),
         args: None,
         size: TerminalSize::default(),
         term_program_version: Some("0.9.0-test".to_string()),
      }
   }

   #[test]
   fn powershell_startup_args_keep_profiles_enabled() {
      let args = TerminalConnection::shell_startup_args(
         &config_with_env(HashMap::new()),
         Some("powershell"),
         "powershell.exe",
      );

      assert_eq!(args, vec!["-NoLogo".to_string()]);
      assert!(
         !args
            .iter()
            .any(|arg| arg.eq_ignore_ascii_case("-NoProfile"))
      );
      assert!(
         !args
            .iter()
            .any(|arg| arg.eq_ignore_ascii_case("-NonInteractive"))
      );
   }

   #[test]
   fn pwsh_startup_args_keep_profiles_enabled() {
      let args = TerminalConnection::shell_startup_args(
         &config_with_env(HashMap::new()),
         Some("pwsh"),
         "pwsh.exe",
      );

      assert_eq!(args, vec!["-NoLogo".to_string()]);
      assert!(
         !args
            .iter()
            .any(|arg| arg.eq_ignore_ascii_case("-NoProfile"))
      );
      assert!(
         !args
            .iter()
            .any(|arg| arg.eq_ignore_ascii_case("-NonInteractive"))
      );
   }

   #[test]
   fn powershell_detection_accepts_shell_id_and_executable_name() {
      assert!(TerminalConnection::is_powershell_shell(
         Some("PowerShell"),
         "cmd.exe"
      ));
      assert!(TerminalConnection::is_powershell_shell(
         None,
         r"C:\Program Files\PowerShell\7\pwsh.exe"
      ));
      assert!(TerminalConnection::is_powershell_shell(
         None,
         r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
      ));
   }

   #[test]
   fn non_powershell_shells_do_not_get_powershell_args() {
      assert_eq!(
         TerminalConnection::shell_startup_args(
            &config_with_env(HashMap::new()),
            Some("cmd"),
            "cmd.exe"
         ),
         Vec::<String>::new()
      );
      assert_eq!(
         TerminalConnection::shell_startup_args(
            &config_with_env(HashMap::new()),
            Some("bash"),
            "bash.exe"
         ),
         Vec::<String>::new()
      );
   }

   #[test]
   fn windows_builtin_shell_fallbacks_preserve_selected_shell() {
      assert_eq!(
         TerminalConnection::windows_builtin_shell_executable("powershell"),
         Some("powershell.exe")
      );
      assert_eq!(
         TerminalConnection::windows_builtin_shell_executable("PWSH"),
         Some("pwsh.exe")
      );
      assert_eq!(
         TerminalConnection::windows_builtin_shell_executable("unknown"),
         None
      );
   }

   #[test]
   fn wsl_startup_args_include_distribution_and_linux_cwd() {
      let mut config = config_with_env(HashMap::new());
      config.command = None;
      config.shell = Some("wsl:Ubuntu".to_string());
      config.working_directory = Some("wsl://Ubuntu/home/me/project".to_string());

      let args = TerminalConnection::shell_startup_args(&config, Some("wsl:Ubuntu"), "wsl.exe");

      assert_eq!(
         args,
         vec![
            "--distribution".to_string(),
            "Ubuntu".to_string(),
            "--cd".to_string(),
            "/home/me/project".to_string()
         ]
      );
   }

   #[test]
   fn wsl_startup_args_convert_windows_cwd_to_mount_path() {
      let mut config = config_with_env(HashMap::new());
      config.command = None;
      config.shell = Some("wsl:Ubuntu".to_string());
      config.working_directory = Some(r"C:\Users\me\project".to_string());

      let args = TerminalConnection::shell_startup_args(&config, Some("wsl:Ubuntu"), "wsl.exe");

      assert_eq!(
         args,
         vec![
            "--distribution".to_string(),
            "Ubuntu".to_string(),
            "--cd".to_string(),
            "/mnt/c/Users/me/project".to_string()
         ]
      );
   }

   #[test]
   fn keeps_custom_no_color_without_forced_color() {
      let mut environment = HashMap::new();
      environment.insert("NO_COLOR".to_string(), "1".to_string());

      let cmd = TerminalConnection::build_command(&config_with_env(environment)).unwrap();

      assert_eq!(cmd.get_env("NO_COLOR"), Some(OsStr::new("1")));
      assert_eq!(cmd.get_env("CLICOLOR"), Some(OsStr::new("1")));
      assert!(cmd.get_env("FORCE_COLOR").is_none());
      assert!(cmd.get_env("CLICOLOR_FORCE").is_none());
   }

   #[test]
   fn removes_inherited_no_color_for_interactive_terminal_color() {
      let cmd = TerminalConnection::build_command(&config_with_env(HashMap::new())).unwrap();

      assert!(cmd.get_env("NO_COLOR").is_none());
      assert_eq!(cmd.get_env("CLICOLOR"), Some(OsStr::new("1")));
      assert!(cmd.get_env("FORCE_COLOR").is_none());
      assert!(cmd.get_env("CLICOLOR_FORCE").is_none());
   }

   #[test]
   fn removes_inherited_host_terminal_markers() {
      let mut environment = HashMap::new();
      environment.insert("KITTY_WINDOW_ID".to_string(), "1".to_string());
      environment.insert("GHOSTTY_RESOURCES_DIR".to_string(), "/tmp".to_string());
      environment.insert("WEZTERM_PANE".to_string(), "3".to_string());
      environment.insert("ITERM_SESSION_ID".to_string(), "session".to_string());
      environment.insert("TERM_SESSION_ID".to_string(), "term-session".to_string());
      environment.insert("TMUX".to_string(), "/tmp/tmux".to_string());

      let mut config = config_with_env(HashMap::new());
      let mut command = CommandBuilder::new("node");
      for (key, value) in &environment {
         command.env(key, value);
      }
      TerminalConnection::remove_inherited_terminal_markers(&mut command, &environment);

      for key in environment.keys() {
         assert!(
            command.get_env(key).is_none(),
            "expected {key} to be removed"
         );
      }

      config
         .environment
         .as_mut()
         .unwrap()
         .insert("KITTY_WINDOW_ID".to_string(), "custom".to_string());
      let command = TerminalConnection::build_command(&config).unwrap();
      assert_eq!(
         command.get_env("KITTY_WINDOW_ID"),
         Some(OsStr::new("custom"))
      );
      assert_eq!(
         command.get_env("TERM_PROGRAM_VERSION"),
         Some(OsStr::new("0.9.0-test"))
      );
   }
}
