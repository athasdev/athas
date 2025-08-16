use crate::shell::Shell;
use anyhow::{Result, anyhow};
use portable_pty::{CommandBuilder, PtyPair, PtySize};
use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   io::{Read, Write},
   sync::{Arc, Mutex},
   thread,
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XtermConfig {
   pub working_directory: Option<String>,
   pub shell: Option<Shell>,
   pub environment: Option<HashMap<String, String>>,
   pub rows: u16,
   pub cols: u16,
}

pub struct XtermConnection {
   pub id: String,
   pub pty_pair: PtyPair,
   pub app_handle: AppHandle,
   pub writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
}

impl XtermConnection {
   pub fn new(id: String, config: XtermConfig, app_handle: AppHandle) -> Result<Self> {
      let pty_system = portable_pty::native_pty_system();

      let pty_pair = pty_system.openpty(PtySize {
         rows: config.rows,
         cols: config.cols,
         pixel_width: 0,
         pixel_height: 0,
      })?;

      let cmd = Self::build_command(&config)?;
      let _child = pty_pair.slave.spawn_command(cmd)?;
      let writer = Arc::new(Mutex::new(Some(pty_pair.master.take_writer()?)));

      Ok(Self {
         id,
         pty_pair,
         app_handle,
         writer,
      })
   }

   fn build_command(config: &XtermConfig) -> Result<CommandBuilder> {
      let default_shell = if cfg!(target_os = "windows") {
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
      };

      let shell_path = if let Some(shell) = &config.shell {
         if cfg!(target_os = "windows") {
            shell.exec_win.clone().unwrap_or(default_shell.clone())
         } else {
            shell.exec_unix.clone().unwrap_or(default_shell.clone())
         }
      } else {
         default_shell.clone()
      };

      let mut cmd = CommandBuilder::new(&shell_path);

      if let Some(working_dir) = &config.working_directory {
         cmd.cwd(working_dir);
      }

      // Set up proper terminal environment
      cmd.env("TERM", "xterm-256color");
      cmd.env("COLORTERM", "truecolor");
      cmd.env("TERM_PROGRAM", "athas");
      cmd.env("TERM_PROGRAM_VERSION", "1.0.0");
      cmd.env("SHELL", &shell_path);
      cmd.env("FORCE_COLOR", "1");
      cmd.env("CLICOLOR", "1");
      cmd.env("CLICOLOR_FORCE", "1");

      // Copy over custom environment variables
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
      let mut reader = self
         .pty_pair
         .master
         .try_clone_reader()
         .expect("Failed to clone reader");

      thread::spawn(move || {
         let mut buffer = vec![0u8; 65536]; // 64KB buffer for better performance

         loop {
            match reader.read(&mut buffer) {
               Ok(0) => {
                  // End of stream
                  let _ = app_handle.emit(&format!("pty-closed-{}", id), ());
                  break;
               }
               Ok(n) => {
                  // Send raw bytes to frontend
                  let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                  let _ = app_handle.emit(
                     &format!("pty-output-{}", id),
                     serde_json::json!({ "data": data }),
                  );
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
}

pub struct XtermManager {
   connections: Arc<Mutex<HashMap<String, XtermConnection>>>,
}

impl XtermManager {
   pub fn new() -> Self {
      Self {
         connections: Arc::new(Mutex::new(HashMap::new())),
      }
   }

   pub fn create_terminal(&self, config: XtermConfig, app_handle: AppHandle) -> Result<String> {
      let id = Uuid::new_v4().to_string();
      let connection = XtermConnection::new(id.clone(), config, app_handle)?;

      // Start the reader thread
      connection.start_reader_thread();

      // Store the connection
      let mut connections = self.connections.lock().unwrap();
      connections.insert(id.clone(), connection);

      Ok(id)
   }

   pub fn write_to_terminal(&self, id: &str, data: &str) -> Result<()> {
      let connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.get(id) {
         connection.write(data)
      } else {
         Err(anyhow!("Terminal connection not found"))
      }
   }

   pub fn resize_terminal(&self, id: &str, rows: u16, cols: u16) -> Result<()> {
      let connections = self.connections.lock().unwrap();
      if let Some(connection) = connections.get(id) {
         connection.resize(rows, cols)
      } else {
         Err(anyhow!("Terminal connection not found"))
      }
   }

   pub fn close_terminal(&self, id: &str) -> Result<()> {
      let mut connections = self.connections.lock().unwrap();
      connections.remove(id);
      Ok(())
   }
}
