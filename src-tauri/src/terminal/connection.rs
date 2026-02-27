use crate::terminal::config::TerminalConfig;
use anyhow::{Result, anyhow};
use portable_pty::{Child, CommandBuilder, PtyPair, PtySize};
use std::{
   collections::HashMap,
   io::{Read, Write},
   sync::{Arc, Mutex},
   thread,
};
use tauri::{AppHandle, Emitter};

pub struct TerminalConnection {
   pub id: String,
   pub pty_pair: PtyPair,
   pub app_handle: AppHandle,
   pub writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
   pub child: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
}

impl TerminalConnection {
   pub fn new(id: String, config: TerminalConfig, app_handle: AppHandle) -> Result<Self> {
      let pty_system = portable_pty::native_pty_system();

      let pty_pair = pty_system.openpty(PtySize {
         rows: config.rows,
         cols: config.cols,
         pixel_width: 0,
         pixel_height: 0,
      })?;

      let cmd = Self::build_command(&config)?;
      let child = pty_pair.slave.spawn_command(cmd)?;
      let writer = Arc::new(Mutex::new(Some(pty_pair.master.take_writer()?)));
      let child = Arc::new(Mutex::new(Some(child)));

      Ok(Self {
         id,
         pty_pair,
         app_handle,
         writer,
         child,
      })
   }

   /// Get the user's shell environment by sourcing their login shell profile.
   /// This is critical for production builds on macOS where GUI apps don't inherit
   /// the user's shell environment when launched from Finder/Launchpad.
   #[cfg(not(target_os = "windows"))]
   fn get_user_environment() -> HashMap<String, String> {
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
      // On Windows, inherit current process environment
      std::env::vars().collect()
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

      let (mut cmd, shell_path): (CommandBuilder, Option<String>) =
         if let Some(command) = &config.command {
            let mut builder = CommandBuilder::new(command);
            if let Some(args) = &config.args {
               builder.args(args);
            }
            (builder, None)
         } else {
            let default_shell = default_shell();
            let shell_path = if let Some(shell) = &config.shell {
               if cfg!(target_os = "windows") {
                  shell.exec_win.clone().unwrap_or(default_shell.clone())
               } else {
                  shell.exec_unix.clone().unwrap_or(default_shell.clone())
               }
            } else {
               default_shell.clone()
            };

            (CommandBuilder::new(&shell_path), Some(shell_path))
         };

      if let Some(working_dir) = &config.working_directory {
         cmd.cwd(working_dir);
      }

      // First, inherit user's full shell environment
      // This ensures PATH, HOME, USER, LANG, and other critical vars are available
      let user_env = Self::get_user_environment();
      for (key, value) in &user_env {
         cmd.env(key, value);
      }

      // Then override with terminal-specific environment variables
      cmd.env("TERM", "xterm-256color");
      cmd.env("COLORTERM", "truecolor");
      cmd.env("TERM_PROGRAM", "athas");
      cmd.env("TERM_PROGRAM_VERSION", "1.0.0");
      if let Some(shell_path) = shell_path {
         cmd.env("SHELL", shell_path);
      }
      cmd.env("FORCE_COLOR", "1");
      cmd.env("CLICOLOR", "1");
      cmd.env("CLICOLOR_FORCE", "1");

      // Copy over custom environment variables (highest priority)
      if let Some(env_vars) = &config.environment {
         for (key, value) in env_vars {
            cmd.env(key, value);
         }
      }

      Ok(cmd)
   }

   pub fn start_reader_thread(&self) {
      let id = self.id.clone();
      let app_handle = self.app_handle.clone();
      let child = self.child.clone();
      let mut reader = self
         .pty_pair
         .master
         .try_clone_reader()
         .expect("Failed to clone reader");

      thread::spawn(move || {
         let mut buffer = vec![0u8; 65536]; // 64KB buffer for better performance
         let mut incomplete_utf8: Vec<u8> = Vec::new();

         loop {
            match reader.read(&mut buffer) {
               Ok(0) => {
                  let mut exit_code: Option<u32> = None;
                  let mut signal: Option<String> = None;

                  if let Ok(mut child_guard) = child.lock()
                     && let Some(child) = child_guard.as_mut()
                  {
                     let status = child
                        .try_wait()
                        .ok()
                        .flatten()
                        .or_else(|| child.wait().ok());

                     if let Some(status) = status {
                        exit_code = Some(status.exit_code());
                        signal = status.signal().map(str::to_string);
                     }
                  }

                  let _ = app_handle.emit(
                     &format!("pty-exit-{}", id),
                     serde_json::json!({
                        "exitCode": exit_code,
                        "signal": signal
                     }),
                  );

                  // End of stream
                  let _ = app_handle.emit(&format!("pty-closed-{}", id), ());
                  break;
               }
               Ok(n) => {
                  // Prepend any incomplete UTF-8 bytes from previous read
                  let mut data_to_process = if incomplete_utf8.is_empty() {
                     buffer[..n].to_vec()
                  } else {
                     let mut combined = std::mem::take(&mut incomplete_utf8);
                     combined.extend_from_slice(&buffer[..n]);
                     combined
                  };

                  // Find the last valid UTF-8 boundary
                  let valid_up_to = Self::find_utf8_boundary(&data_to_process);

                  // Save incomplete bytes for next iteration
                  if valid_up_to < data_to_process.len() {
                     incomplete_utf8 = data_to_process[valid_up_to..].to_vec();
                     data_to_process.truncate(valid_up_to);
                  }

                  // Only emit if we have valid data
                  if !data_to_process.is_empty() {
                     // Safe to use from_utf8 since we validated the boundary
                     let data = String::from_utf8_lossy(&data_to_process).to_string();
                     let _ = app_handle.emit(
                        &format!("pty-output-{}", id),
                        serde_json::json!({ "data": data }),
                     );
                  }
               }
               Err(e) => {
                  eprintln!("Error reading from PTY: {}", e);
                  let _ = app_handle.emit(
                     &format!("pty-error-{}", id),
                     serde_json::json!({ "error": e.to_string() }),
                  );
                  break;
               }
            }
         }
      });
   }

   /// Find the last valid UTF-8 boundary in a byte slice.
   /// Returns the index up to which the bytes form valid UTF-8.
   fn find_utf8_boundary(bytes: &[u8]) -> usize {
      if bytes.is_empty() {
         return 0;
      }

      // Check from the end for incomplete multi-byte sequences
      let len = bytes.len();

      // Check the last 1-4 bytes for incomplete sequences
      for i in 1..=4.min(len) {
         let check_from = len - i;
         let byte = bytes[check_from];

         // Check if this is a leading byte of a multi-byte sequence
         if byte & 0b1000_0000 == 0 {
            // ASCII byte - valid boundary after this
            return len;
         } else if byte & 0b1100_0000 == 0b1100_0000 {
            // This is a leading byte (starts with 11)
            let expected_len = if byte & 0b1111_0000 == 0b1111_0000 {
               4
            } else if byte & 0b1110_0000 == 0b1110_0000 {
               3
            } else {
               2
            };

            let actual_len = i;
            if actual_len >= expected_len {
               // Complete sequence
               return len;
            } else {
               // Incomplete sequence - boundary is before this byte
               return check_from;
            }
         }
         // Continuation byte (10xxxxxx) - keep looking for the leading byte
      }

      // If we get here, try to validate the whole thing
      match std::str::from_utf8(bytes) {
         Ok(_) => len,
         Err(e) => e.valid_up_to(),
      }
   }

   pub fn write(&self, data: &str) -> Result<()> {
      let mut writer_guard = self.writer.lock().unwrap();
      if let Some(writer) = writer_guard.as_mut() {
         writer.write_all(data.as_bytes())?;
         writer.flush()?;
         Ok(())
      } else {
         Err(anyhow!("Terminal writer is not available"))
      }
   }

   pub fn resize(&self, rows: u16, cols: u16) -> Result<()> {
      self.pty_pair.master.resize(PtySize {
         rows,
         cols,
         pixel_width: 0,
         pixel_height: 0,
      })?;
      Ok(())
   }

   pub fn kill(&self) -> Result<()> {
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
