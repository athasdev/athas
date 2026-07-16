use agent_client_protocol::schema as acp;
use athas_terminal::TerminalEvent;
use tokio::sync::oneshot;

/// Tracks state for an ACP terminal session
pub(super) struct AcpTerminalState {
   pub athas_terminal_id: String,
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
         output_buffer: String::new(),
         max_output_bytes: max_output_bytes.unwrap_or(1_000_000) as usize,
         truncated: false,
         exit_status: None,
         exit_waiters: Vec::new(),
         pending_utf8: Vec::new(),
      }
   }

   pub fn append_output(&mut self, data: &str) {
      self.output_buffer.push_str(data);
      self.truncate_from_beginning_to_limit();
   }

   pub fn append_output_bytes(&mut self, data: &[u8]) {
      self.pending_utf8.extend_from_slice(data);

      loop {
         match std::str::from_utf8(&self.pending_utf8) {
            Ok(text) => {
               let text = text.to_string();
               self.pending_utf8.clear();
               self.append_output(&text);
               break;
            }
            Err(error) => {
               let valid_up_to = error.valid_up_to();
               if valid_up_to > 0 {
                  let text = String::from_utf8_lossy(&self.pending_utf8[..valid_up_to]).to_string();
                  self.pending_utf8.drain(..valid_up_to);
                  self.append_output(&text);
               }

               let Some(invalid_length) = error.error_len() else {
                  break;
               };

               self.pending_utf8.drain(..invalid_length);
               self.append_output("\u{fffd}");
            }
         }
      }
   }

   pub fn handle_event(&mut self, event: TerminalEvent) {
      match event {
         TerminalEvent::Output { data } => self.append_output_bytes(&data),
         TerminalEvent::Error { .. } => {
            self.flush_pending_utf8();
            self.set_exit_status(Some(1), Some("pty_error".to_string()));
         }
         TerminalEvent::Exit { exit_code, signal } => {
            self.flush_pending_utf8();
            self.set_exit_status(exit_code, signal);
         }
         TerminalEvent::Closed => {
            self.flush_pending_utf8();
            if self.exit_status.is_none() {
               self.set_exit_status(Some(0), None);
            }
         }
      }
   }

   fn flush_pending_utf8(&mut self) {
      if self.pending_utf8.is_empty() {
         return;
      }

      let text = String::from_utf8_lossy(&self.pending_utf8).to_string();
      self.pending_utf8.clear();
      self.append_output(&text);
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

   pub fn set_exit_status(&mut self, exit_code: Option<u32>, signal: Option<String>) {
      if self.exit_status.is_some() {
         return;
      }

      let status = acp::TerminalExitStatus::new()
         .exit_code(exit_code)
         .signal(signal);
      self.exit_status = Some(status.clone());

      for waiter in self.exit_waiters.drain(..) {
         let _ = waiter.send(status.clone());
      }
   }
}

#[cfg(test)]
mod tests {
   use super::AcpTerminalState;

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
   fn exit_status_preserves_none_exit_code_for_signal_termination() {
      let mut state = AcpTerminalState::new("terminal-3".to_string(), None);
      state.set_exit_status(None, Some("SIGTERM".to_string()));

      let status = state.exit_status.expect("exit status should be set");
      assert_eq!(status.exit_code, None);
      assert_eq!(status.signal.as_deref(), Some("SIGTERM"));
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
