//! Tells the chat what the terminals Athas runs for agents print and how they end. Output is
//! coalesced per terminal: a busy command's PTY reads come in small pieces, and one event per
//! read would flood the frontend, so what arrives within [`OUTPUT_FLUSH_DELAY`] goes out as one
//! event. An exit sends the output still waiting first, so the chat never sees them reversed.

use super::{terminal_state::TerminalChange, types::AcpEvent};
use crate::runtime::AthasAppHandle as AppHandle;
use std::{
   collections::HashMap,
   sync::{Arc, Mutex},
   time::Duration,
};
use tauri::Emitter;

/// How long output waits for more before it is sent.
pub(super) const OUTPUT_FLUSH_DELAY: Duration = Duration::from_millis(75);

/// The output each terminal printed since its last event, with its session.
#[derive(Default)]
struct PendingOutput {
   by_terminal: HashMap<String, (String, String)>,
}

impl PendingOutput {
   /// Adds `data` to what `terminal_id` has waiting. Returns whether this starts a new batch,
   /// which the caller must flush after [`OUTPUT_FLUSH_DELAY`].
   fn push(&mut self, session_id: &str, terminal_id: &str, data: &str) -> bool {
      match self.by_terminal.get_mut(terminal_id) {
         Some((_, pending)) => {
            pending.push_str(data);
            false
         }
         None => {
            self.by_terminal.insert(
               terminal_id.to_string(),
               (session_id.to_string(), data.to_string()),
            );
            true
         }
      }
   }

   /// The event for what `terminal_id` has waiting, if anything.
   fn take(&mut self, terminal_id: &str) -> Option<AcpEvent> {
      let (session_id, data) = self.by_terminal.remove(terminal_id)?;
      Some(AcpEvent::TerminalOutput {
         session_id,
         terminal_id: terminal_id.to_string(),
         data,
      })
   }
}

fn exit_event(
   session_id: &str,
   terminal_id: &str,
   status: agent_client_protocol::schema::v1::TerminalExitStatus,
) -> AcpEvent {
   AcpEvent::TerminalExit {
      session_id: session_id.to_string(),
      terminal_id: terminal_id.to_string(),
      exit_code: status.exit_code,
      signal: status.signal,
   }
}

/// Sends terminal changes to the chat as `acp-event`s. Cheap to clone.
#[derive(Clone)]
pub(super) struct TerminalEvents {
   app_handle: AppHandle,
   pending: Arc<Mutex<PendingOutput>>,
}

impl TerminalEvents {
   pub(super) fn new(app_handle: AppHandle) -> Self {
      Self {
         app_handle,
         pending: Arc::default(),
      }
   }

   pub(super) fn emit_changes(
      &self,
      session_id: &str,
      terminal_id: &str,
      changes: Vec<TerminalChange>,
   ) {
      for change in changes {
         match change {
            TerminalChange::Output(data) => {
               if self.lock().push(session_id, terminal_id, &data) {
                  self.flush_later(terminal_id.to_string());
               }
            }
            TerminalChange::Exit(status) => {
               self.flush(terminal_id);
               self.emit(&exit_event(session_id, terminal_id, status));
            }
         }
      }
   }

   fn lock(&self) -> std::sync::MutexGuard<'_, PendingOutput> {
      self
         .pending
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
   }

   fn flush(&self, terminal_id: &str) {
      let event = self.lock().take(terminal_id);
      if let Some(event) = event {
         self.emit(&event);
      }
   }

   fn flush_later(&self, terminal_id: String) {
      let events = self.clone();
      tauri::async_runtime::spawn(async move {
         tokio::time::sleep(OUTPUT_FLUSH_DELAY).await;
         events.flush(&terminal_id);
      });
   }

   fn emit(&self, event: &AcpEvent) {
      if let Err(error) = self.app_handle.emit("acp-event", event) {
         log::error!("Failed to emit ACP terminal event: {}", error);
      }
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use serde_json::json;

   #[test]
   fn coalesces_output_per_terminal_until_taken() {
      let mut pending = PendingOutput::default();
      assert!(pending.push("s1", "t1", "a"));
      assert!(!pending.push("s1", "t1", "b"));
      assert!(pending.push("s1", "t2", "x"));
      assert_eq!(
         serde_json::to_value(pending.take("t1").unwrap()).unwrap(),
         json!({ "type": "terminal_output", "sessionId": "s1", "terminalId": "t1", "data": "ab" })
      );
      assert!(pending.take("t1").is_none());
      // A new batch starts once the last one was sent.
      assert!(pending.push("s1", "t1", "c"));
      assert!(pending.take("t2").is_some());
   }

   #[test]
   fn exits_become_chat_events() {
      let status =
         agent_client_protocol::schema::v1::TerminalExitStatus::new().signal("Killed".to_string());
      assert_eq!(
         serde_json::to_value(exit_event("s1", "t1", status)).unwrap(),
         json!({
            "type": "terminal_exit",
            "sessionId": "s1",
            "terminalId": "t1",
            "exitCode": null,
            "signal": "Killed",
         })
      );
   }
}
