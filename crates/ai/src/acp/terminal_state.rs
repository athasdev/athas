use agent_client_protocol::schema::v1 as acp;
use athas_terminal::TerminalEvent;
use std::collections::HashMap;
use tokio::sync::oneshot;

/// What a terminal event changed, for the chat to show.
#[derive(Debug, PartialEq)]
pub(super) enum TerminalChange {
   /// Output text that arrived, decoded.
   Output(String),
   /// The command's exit, reported once.
   Exit(acp::TerminalExitStatus),
}

/// Tracks state for an ACP terminal session
pub(super) struct AcpTerminalState {
   pub athas_terminal_id: String,
   /// The session that created the terminal; it is released when that session closes.
   pub session_id: String,
   pub output_buffer: String,
   pub max_output_bytes: usize,
   pub truncated: bool,
   pub exit_status: Option<acp::TerminalExitStatus>,
   pub exit_waiters: Vec<oneshot::Sender<acp::TerminalExitStatus>>,
   pending_utf8: Vec<u8>,
}

impl AcpTerminalState {
   pub fn new(athas_terminal_id: String, max_output_bytes: Option<u32>) -> Self {
      Self {
         athas_terminal_id,
         session_id: String::new(),
         output_buffer: String::new(),
         max_output_bytes: max_output_bytes.unwrap_or(1_000_000) as usize,
         truncated: false,
         exit_status: None,
         exit_waiters: Vec::new(),
         pending_utf8: Vec::new(),
      }
   }

   /// Builds a `terminal/output` response. Per the ACP spec this returns all
   /// output retained so far (not only what arrived since the last read), so
   /// the buffer is copied rather than drained. `truncated` stays set once any
   /// output has been dropped to respect the byte limit.
   pub fn output_response(&self) -> acp::TerminalOutputResponse {
      acp::TerminalOutputResponse::new(self.output_buffer.clone(), self.truncated)
         .exit_status(self.exit_status.clone())
   }

   pub fn append_output(&mut self, data: &str) {
      self.output_buffer.push_str(data);
      self.truncate_from_beginning_to_limit();
   }

   /// Appends PTY bytes, holding back a character split across reads. Returns the text that
   /// was appended.
   pub fn append_output_bytes(&mut self, data: &[u8]) -> String {
      self.pending_utf8.extend_from_slice(data);
      let mut appended = String::new();

      loop {
         match std::str::from_utf8(&self.pending_utf8) {
            Ok(text) => {
               appended.push_str(text);
               self.pending_utf8.clear();
               break;
            }
            Err(error) => {
               let valid_up_to = error.valid_up_to();
               if valid_up_to > 0 {
                  appended.push_str(&String::from_utf8_lossy(&self.pending_utf8[..valid_up_to]));
                  self.pending_utf8.drain(..valid_up_to);
               }

               let Some(invalid_length) = error.error_len() else {
                  break;
               };

               self.pending_utf8.drain(..invalid_length);
               appended.push('\u{fffd}');
            }
         }
      }
      self.append_output(&appended);
      appended
   }

   /// Applies a PTY event and returns what changed for the chat.
   pub fn handle_event(&mut self, event: TerminalEvent) -> Vec<TerminalChange> {
      let mut changes = Vec::new();
      let exit = match event {
         TerminalEvent::Output { data } => {
            let text = self.append_output_bytes(&data);
            if !text.is_empty() {
               changes.push(TerminalChange::Output(text));
            }
            return changes;
         }
         TerminalEvent::Error { .. } => Some((Some(1), Some("pty_error".to_string()))),
         // The PTY reports code 1 alongside a signal; ACP has no exit code for a process a
         // signal ended.
         TerminalEvent::Exit { exit_code, signal } => {
            Some((if signal.is_some() { None } else { exit_code }, signal))
         }
         TerminalEvent::Closed => self.exit_status.is_none().then_some((Some(0), None)),
      };
      if let Some(text) = self.flush_pending_utf8() {
         changes.push(TerminalChange::Output(text));
      }
      if let Some((exit_code, signal)) = exit
         && let Some(status) = self.set_exit_status(exit_code, signal)
      {
         changes.push(TerminalChange::Exit(status));
      }
      changes
   }

   fn flush_pending_utf8(&mut self) -> Option<String> {
      if self.pending_utf8.is_empty() {
         return None;
      }

      let text = String::from_utf8_lossy(&self.pending_utf8).to_string();
      self.pending_utf8.clear();
      self.append_output(&text);
      Some(text)
   }

   fn truncate_from_beginning_to_limit(&mut self) {
      if self.output_buffer.len() <= self.max_output_bytes {
         return;
      }

      let overflow = self
         .output_buffer
         .len()
         .saturating_sub(self.max_output_bytes);
      let mut drain_end = overflow.min(self.output_buffer.len());

      while drain_end < self.output_buffer.len() && !self.output_buffer.is_char_boundary(drain_end)
      {
         drain_end += 1;
      }

      if drain_end > 0 {
         self.output_buffer.drain(..drain_end);
         self.truncated = true;
      }

      while self.output_buffer.len() > self.max_output_bytes {
         if let Some(first_char) = self.output_buffer.chars().next() {
            self.output_buffer.drain(..first_char.len_utf8());
            self.truncated = true;
         } else {
            break;
         }
      }
   }

   pub fn for_session(mut self, session_id: String) -> Self {
      self.session_id = session_id;
      self
   }

   /// Records how the command ended and answers everyone waiting on it. Returns the status
   /// when this call set it; a terminal that already exited keeps its first status.
   pub fn set_exit_status(
      &mut self,
      exit_code: Option<u32>,
      signal: Option<String>,
   ) -> Option<acp::TerminalExitStatus> {
      if self.exit_status.is_some() {
         return None;
      }

      let status = acp::TerminalExitStatus::new()
         .exit_code(exit_code)
         .signal(signal);
      self.exit_status = Some(status.clone());

      for waiter in self.exit_waiters.drain(..) {
         let _ = waiter.send(status.clone());
      }
      Some(status)
   }
}

/// A terminal taken out of the client's table.
pub(super) struct ReleasedTerminal {
   pub terminal_id: String,
   pub state: AcpTerminalState,
   /// The exit the release gave a command that was still running.
   pub exit: Option<acp::TerminalExitStatus>,
}

/// Removes the terminals `session_id` created (every terminal with `None`), marking any still
/// running as released so their `terminal/wait_for_exit` callers are answered. The caller closes
/// the returned terminals.
pub(super) fn take_session_terminals(
   states: &mut HashMap<String, AcpTerminalState>,
   session_id: Option<&str>,
) -> Vec<ReleasedTerminal> {
   let terminal_ids: Vec<String> = states
      .iter()
      .filter(|(_, state)| session_id.is_none_or(|session_id| state.session_id == session_id))
      .map(|(terminal_id, _)| terminal_id.clone())
      .collect();
   terminal_ids
      .into_iter()
      .filter_map(|terminal_id| {
         let mut state = states.remove(&terminal_id)?;
         let exit = state.set_exit_status(Some(1), Some("released".to_string()));
         Some(ReleasedTerminal {
            terminal_id,
            state,
            exit,
         })
      })
      .collect()
}

#[cfg(test)]
mod tests {
   use super::{AcpTerminalState, take_session_terminals};
   use std::collections::HashMap;

   #[test]
   fn releases_only_the_closed_sessions_terminals() {
      let mut states = HashMap::new();
      let mut waiting = AcpTerminalState::new("athas-1".to_string(), None).for_session("a".into());
      let (exit_tx, mut exit_rx) = tokio::sync::oneshot::channel();
      waiting.exit_waiters.push(exit_tx);
      states.insert("t1".to_string(), waiting);
      states.insert(
         "t2".to_string(),
         AcpTerminalState::new("athas-2".to_string(), None).for_session("b".into()),
      );

      let released = take_session_terminals(&mut states, Some("a"));

      assert_eq!(released.len(), 1);
      assert_eq!(released[0].state.athas_terminal_id, "athas-1");
      assert_eq!(released[0].terminal_id, "t1");
      assert!(
         released[0].exit.is_some(),
         "the release ends a running command"
      );
      assert!(exit_rx.try_recv().is_ok(), "a waiting caller is answered");
      assert!(states.contains_key("t2"));

      let rest = take_session_terminals(&mut states, None);
      assert_eq!(rest.len(), 1);
      assert!(states.is_empty());
   }

   #[test]
   fn append_output_truncates_from_beginning() {
      let mut state = AcpTerminalState::new("terminal-1".to_string(), Some(5));
      state.append_output("hello");
      state.append_output("world");

      assert_eq!(state.output_buffer, "world");
      assert!(state.truncated);
   }

   #[test]
   fn append_output_preserves_utf8_boundaries_when_truncating() {
      let mut state = AcpTerminalState::new("terminal-2".to_string(), Some(5));
      state.append_output("a🙂b");

      assert_eq!(state.output_buffer, "🙂b");
      assert!(state.truncated);
   }

   #[test]
   fn output_response_retains_output_across_reads() {
      let mut state = AcpTerminalState::new("terminal-5".to_string(), None);
      state.append_output("first ");

      let first = state.output_response();
      assert_eq!(first.output, "first ");
      assert!(!first.truncated);

      state.append_output("second");
      let second = state.output_response();
      assert_eq!(second.output, "first second");

      state.set_exit_status(Some(0), None);
      let last = state.output_response();
      assert_eq!(last.output, "first second");
      assert_eq!(
         last.exit_status.and_then(|status| status.exit_code),
         Some(0)
      );
   }

   #[test]
   fn output_response_truncates_from_start_at_char_boundary() {
      let mut state = AcpTerminalState::new("terminal-6".to_string(), Some(5));
      state.append_output("ab🙂cd");

      let response = state.output_response();
      // Dropping 3 bytes would split the emoji, so the whole char goes.
      assert_eq!(response.output, "cd");
      assert!(response.truncated);
   }

   #[test]
   fn output_response_truncated_flag_is_sticky() {
      let mut state = AcpTerminalState::new("terminal-7".to_string(), Some(4));
      state.append_output("123456");
      assert!(state.output_response().truncated);

      let again = state.output_response();
      assert_eq!(again.output, "3456");
      assert!(again.truncated);

      state.append_output("7");
      let later = state.output_response();
      assert_eq!(later.output, "4567");
      assert!(later.truncated);
   }

   #[test]
   fn exit_status_preserves_none_exit_code_for_signal_termination() {
      let mut state = AcpTerminalState::new("terminal-3".to_string(), None);
      state.set_exit_status(None, Some("SIGTERM".to_string()));

      let status = state.exit_status.expect("exit status should be set");
      assert_eq!(status.exit_code, None);
      assert_eq!(status.signal.as_deref(), Some("SIGTERM"));
   }

   #[test]
   fn events_report_decoded_output_and_the_exit_once() {
      use super::TerminalChange;
      use athas_terminal::TerminalEvent;

      let mut state = AcpTerminalState::new("terminal-10".to_string(), None);
      let emoji = "🙂".as_bytes();
      assert_eq!(
         state.handle_event(TerminalEvent::Output {
            data: [b"ok ".as_slice(), &emoji[..2]].concat(),
         }),
         vec![TerminalChange::Output("ok ".to_string())]
      );
      assert_eq!(
         state.handle_event(TerminalEvent::Output {
            data: emoji[2..].to_vec(),
         }),
         vec![TerminalChange::Output("🙂".to_string())]
      );

      let changes = state.handle_event(TerminalEvent::Exit {
         exit_code: Some(0),
         signal: None,
      });
      assert!(
         matches!(&changes[..], [TerminalChange::Exit(status)] if status.exit_code == Some(0))
      );
      assert!(state.handle_event(TerminalEvent::Closed).is_empty());
      assert_eq!(state.output_buffer, "ok 🙂");
   }

   #[test]
   fn a_signal_exit_reports_the_signal_without_an_exit_code() {
      let mut state = AcpTerminalState::new("terminal-8".to_string(), None);
      state.handle_event(athas_terminal::TerminalEvent::Exit {
         exit_code: Some(1),
         signal: Some("Killed".to_string()),
      });
      let status = state.exit_status.expect("exit status should be set");
      assert_eq!(status.exit_code, None);
      assert_eq!(status.signal.as_deref(), Some("Killed"));

      let mut state = AcpTerminalState::new("terminal-9".to_string(), None);
      state.handle_event(athas_terminal::TerminalEvent::Exit {
         exit_code: Some(2),
         signal: None,
      });
      assert_eq!(
         state.exit_status.and_then(|status| status.exit_code),
         Some(2)
      );
   }

   #[test]
   fn append_output_bytes_preserves_split_utf8_sequences() {
      let mut state = AcpTerminalState::new("terminal-4".to_string(), None);
      let emoji = "🙂".as_bytes();

      state.append_output_bytes(&emoji[..2]);
      assert_eq!(state.output_buffer, "");

      state.append_output_bytes(&emoji[2..]);
      assert_eq!(state.output_buffer, "🙂");
   }
}
