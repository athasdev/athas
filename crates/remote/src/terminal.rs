use crate::{
   ssh_helpers::{create_ssh_session, shell_quote},
   state::{REMOTE_TERMINALS, RemoteTerminal},
};
use std::{
   io::{Read, Write},
   sync::{Arc, Mutex},
   thread,
   time::Duration,
};
use tauri::Emitter;
use uuid::Uuid;

#[allow(clippy::too_many_arguments)]
pub(super) async fn create_remote_terminal(
   app: tauri::AppHandle,
   host: String,
   port: u16,
   username: String,
   password: Option<String>,
   key_path: Option<String>,
   working_directory: Option<String>,
   rows: u16,
   cols: u16,
) -> Result<String, String> {
   let session = create_ssh_session(
      &host,
      port,
      &username,
      password.as_deref(),
      key_path.as_deref(),
   )?;
   session.set_blocking(false);

   let mut channel = session
      .channel_session()
      .map_err(|e| format!("Failed to create remote terminal channel: {}", e))?;
   channel
      .request_pty(
         "xterm-256color",
         None,
         Some((cols as u32, rows as u32, 0, 0)),
      )
      .map_err(|e| format!("Failed to request PTY: {}", e))?;
   channel
      .shell()
      .map_err(|e| format!("Failed to start remote shell: {}", e))?;

   if let Some(path) = working_directory.as_deref()
      && path != "/"
   {
      channel
         .write_all(format!("cd {}\n", shell_quote(path)).as_bytes())
         .map_err(|e| format!("Failed to set remote working directory: {}", e))?;
      channel.flush().ok();
   }

   let id = Uuid::new_v4().to_string();
   let session = Arc::new(Mutex::new(session));
   let channel = Arc::new(Mutex::new(channel));

   {
      let mut terminals = REMOTE_TERMINALS
         .lock()
         .map_err(|e| format!("Failed to lock remote terminals: {}", e))?;
      terminals.insert(
         id.clone(),
         RemoteTerminal {
            _session: session.clone(),
            channel: channel.clone(),
         },
      );
   }

   spawn_terminal_reader(app, id.clone(), channel);
   Ok(id)
}

pub(super) async fn write_remote_terminal(id: String, data: String) -> Result<(), String> {
   let terminals = REMOTE_TERMINALS
      .lock()
      .map_err(|e| format!("Failed to lock remote terminals: {}", e))?;
   let terminal = terminals
      .get(&id)
      .ok_or("Remote terminal connection not found")?;
   let mut channel = terminal
      .channel
      .lock()
      .map_err(|e| format!("Failed to lock remote terminal channel: {}", e))?;
   channel
      .write_all(data.as_bytes())
      .map_err(|e| format!("Failed to write to remote terminal: {}", e))?;
   channel
      .flush()
      .map_err(|e| format!("Failed to flush remote terminal: {}", e))?;
   Ok(())
}

pub(super) async fn resize_remote_terminal(id: String, rows: u16, cols: u16) -> Result<(), String> {
   let terminals = REMOTE_TERMINALS
      .lock()
      .map_err(|e| format!("Failed to lock remote terminals: {}", e))?;
   let terminal = terminals
      .get(&id)
      .ok_or("Remote terminal connection not found")?;
   let mut channel = terminal
      .channel
      .lock()
      .map_err(|e| format!("Failed to lock remote terminal channel: {}", e))?;
   channel
      .request_pty_size(cols as u32, rows as u32, None, None)
      .map_err(|e| format!("Failed to resize remote terminal: {}", e))?;
   Ok(())
}

pub(super) async fn close_remote_terminal(id: String) -> Result<(), String> {
   let mut terminals = REMOTE_TERMINALS
      .lock()
      .map_err(|e| format!("Failed to lock remote terminals: {}", e))?;
   if let Some(terminal) = terminals.remove(&id)
      && let Ok(mut channel) = terminal.channel.lock()
   {
      let _ = channel.close();
      let _ = channel.wait_close();
   }
   Ok(())
}

fn spawn_terminal_reader(app: tauri::AppHandle, id: String, channel: Arc<Mutex<ssh2::Channel>>) {
   thread::spawn(move || {
      let mut buffer = vec![0u8; 65536];

      loop {
         let read_result = {
            let mut channel = match channel.lock() {
               Ok(channel) => channel,
               Err(_) => break,
            };

            match channel.read(&mut buffer) {
               Ok(n) => Ok((n, channel.eof())),
               Err(error) => Err((error.kind(), channel.eof(), error.to_string())),
            }
         };

         match read_result {
            Ok((0, _)) | Ok((_, true)) => {
               emit_terminal_exit(&app, &id);
               let _ = app.emit(&format!("pty-closed-{}", id), ());
               break;
            }
            Ok((n, false)) => {
               let data = String::from_utf8_lossy(&buffer[..n]).to_string();
               let _ = app.emit(
                  &format!("pty-output-{}", id),
                  serde_json::json!({ "data": data }),
               );
            }
            Err((std::io::ErrorKind::WouldBlock, eof, _)) => {
               if eof {
                  emit_terminal_exit(&app, &id);
                  let _ = app.emit(&format!("pty-closed-{}", id), ());
                  break;
               }
               thread::sleep(Duration::from_millis(10));
            }
            Err((_, _, error)) => {
               let _ = app.emit(
                  &format!("pty-error-{}", id),
                  serde_json::json!({ "error": error }),
               );
               let _ = app.emit(&format!("pty-closed-{}", id), ());
               break;
            }
         }
      }

      if let Ok(mut terminals) = REMOTE_TERMINALS.lock() {
         terminals.remove(&id);
      }
   });
}

fn emit_terminal_exit(app: &tauri::AppHandle, id: &str) {
   let _ = app.emit(
      &format!("pty-exit-{}", id),
      serde_json::json!({
         "exitCode": Option::<u32>::None,
         "signal": Option::<String>::None
      }),
   );
}
