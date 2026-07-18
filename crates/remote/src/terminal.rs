use crate::{
   ssh_helpers::{create_ssh_session, shell_quote},
   state::{REMOTE_TERMINALS, RemoteTerminal},
};
use athas_terminal::{TerminalEvent, TerminalInput, TerminalReaderControl, TerminalSize};
use std::{
   io::{Read, Write},
   sync::{Arc, Mutex},
   thread,
   time::Duration,
};
use tauri::ipc::Channel as TauriChannel;
use uuid::Uuid;

#[allow(clippy::too_many_arguments)]
pub(super) async fn create_remote_terminal(
   host: String,
   port: u16,
   username: String,
   password: Option<String>,
   key_path: Option<String>,
   working_directory: Option<String>,
   size: TerminalSize,
   term_program_version: String,
   on_event: TauriChannel<TerminalEvent>,
) -> Result<String, String> {
   let size = size.normalized();
   let session = create_ssh_session(
      &host,
      port,
      &username,
      password.as_deref(),
      key_path.as_deref(),
   )?;

   let mut channel = session
      .channel_session()
      .map_err(|e| format!("Failed to create remote terminal channel: {}", e))?;
   for (name, value) in [
      ("COLORTERM", "truecolor"),
      ("TERM_PROGRAM", "athas"),
      ("TERM_PROGRAM_VERSION", term_program_version.as_str()),
   ] {
      if let Err(error) = channel.setenv(name, value) {
         log::debug!("Remote terminal rejected {name}: {error}");
      }
   }
   channel
      .request_pty(
         "xterm-256color",
         None,
         Some((
            size.cols as u32,
            size.rows as u32,
            size.pixel_width as u32,
            size.pixel_height as u32,
         )),
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

   session.set_blocking(false);
   let id = Uuid::new_v4().to_string();
   let session = Arc::new(Mutex::new(session));
   let channel = Arc::new(Mutex::new(channel));
   let reader_control = Arc::new(TerminalReaderControl::default());

   {
      let mut terminals = REMOTE_TERMINALS
         .lock()
         .map_err(|e| format!("Failed to lock remote terminals: {}", e))?;
      terminals.insert(
         id.clone(),
         RemoteTerminal {
            _session: session.clone(),
            channel: channel.clone(),
            reader_control: reader_control.clone(),
         },
      );
   }

   spawn_terminal_reader(id.clone(), channel, reader_control, on_event);
   Ok(id)
}

pub(super) async fn write_remote_terminal(id: String, input: TerminalInput) -> Result<(), String> {
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
      .write_all(&input.into_bytes())
      .map_err(|e| format!("Failed to write to remote terminal: {}", e))?;
   channel
      .flush()
      .map_err(|e| format!("Failed to flush remote terminal: {}", e))?;
   Ok(())
}

pub(super) async fn resize_remote_terminal(id: String, size: TerminalSize) -> Result<(), String> {
   let size = size.normalized();
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
      .request_pty_size(
         size.cols as u32,
         size.rows as u32,
         Some(size.pixel_width as u32),
         Some(size.pixel_height as u32),
      )
      .map_err(|e| format!("Failed to resize remote terminal: {}", e))?;
   Ok(())
}

pub(super) async fn set_remote_terminal_paused(id: String, paused: bool) -> Result<(), String> {
   let terminals = REMOTE_TERMINALS
      .lock()
      .map_err(|e| format!("Failed to lock remote terminals: {}", e))?;
   let terminal = terminals
      .get(&id)
      .ok_or("Remote terminal connection not found")?;
   terminal.reader_control.set_paused(paused);
   Ok(())
}

pub(super) async fn close_remote_terminal(id: String) -> Result<(), String> {
   let mut terminals = REMOTE_TERMINALS
      .lock()
      .map_err(|e| format!("Failed to lock remote terminals: {}", e))?;
   if let Some(terminal) = terminals.remove(&id)
      && let Ok(mut channel) = terminal.channel.lock()
   {
      terminal.reader_control.set_paused(false);
      let _ = channel.close();
      let _ = channel.wait_close();
   }
   Ok(())
}

fn spawn_terminal_reader(
   id: String,
   channel: Arc<Mutex<ssh2::Channel>>,
   reader_control: Arc<TerminalReaderControl>,
   on_event: TauriChannel<TerminalEvent>,
) {
   thread::spawn(move || {
      let mut buffer = vec![0u8; 65536];

      loop {
         if !reader_control.wait_until_resumed() {
            break;
         }

         let read_result = {
            let mut channel = match channel.lock() {
               Ok(channel) => channel,
               Err(_) => break,
            };

            match channel.read(&mut buffer) {
               Ok(n) => {
                  let eof = channel.eof();
                  let (exit_code, signal) = if eof || n == 0 {
                     remote_exit_status(&channel)
                  } else {
                     (None, None)
                  };
                  Ok((n, eof, exit_code, signal))
               }
               Err(error) => {
                  let eof = channel.eof();
                  let (exit_code, signal) = if eof {
                     remote_exit_status(&channel)
                  } else {
                     (None, None)
                  };
                  Err((error.kind(), eof, exit_code, signal, error.to_string()))
               }
            }
         };

         match read_result {
            Ok((0, _, exit_code, signal)) | Ok((_, true, exit_code, signal)) => {
               let _ = on_event.send(TerminalEvent::Exit { exit_code, signal });
               let _ = on_event.send(TerminalEvent::Closed);
               break;
            }
            Ok((n, false, _, _)) => {
               if on_event
                  .send(TerminalEvent::Output {
                     data: buffer[..n].to_vec(),
                  })
                  .is_err()
               {
                  break;
               }
            }
            Err((std::io::ErrorKind::WouldBlock, eof, exit_code, signal, _)) => {
               if eof {
                  let _ = on_event.send(TerminalEvent::Exit { exit_code, signal });
                  let _ = on_event.send(TerminalEvent::Closed);
                  break;
               }
               thread::sleep(Duration::from_millis(10));
            }
            Err((_, _, _, _, error)) => {
               let _ = on_event.send(TerminalEvent::Error { message: error });
               let _ = on_event.send(TerminalEvent::Closed);
               break;
            }
         }
      }

      if let Ok(mut terminals) = REMOTE_TERMINALS.lock() {
         terminals.remove(&id);
      }
   });
}

fn remote_exit_status(channel: &ssh2::Channel) -> (Option<u32>, Option<String>) {
   let exit_code = channel
      .exit_status()
      .ok()
      .and_then(|code| u32::try_from(code).ok());
   let signal = channel
      .exit_signal()
      .ok()
      .and_then(|details| details.exit_signal);
   (exit_code, signal)
}
