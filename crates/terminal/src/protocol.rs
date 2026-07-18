use serde::{Deserialize, Serialize};
use std::sync::{Arc, Condvar, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSize {
   pub rows: u16,
   pub cols: u16,
   pub pixel_width: u16,
   pub pixel_height: u16,
}

impl Default for TerminalSize {
   fn default() -> Self {
      Self {
         rows: 24,
         cols: 80,
         pixel_width: 0,
         pixel_height: 0,
      }
   }
}

impl TerminalSize {
   pub fn normalized(self) -> Self {
      Self {
         rows: self.rows.max(1),
         cols: self.cols.max(1),
         ..self
      }
   }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalInput {
   Text { data: String },
   Binary { data: Vec<u8> },
}

impl TerminalInput {
   pub fn into_bytes(self) -> Vec<u8> {
      match self {
         Self::Text { data } => data.into_bytes(),
         Self::Binary { data } => data,
      }
   }
}

#[derive(Debug, Clone, Serialize)]
#[serde(
   tag = "event",
   rename_all = "camelCase",
   rename_all_fields = "camelCase"
)]
pub enum TerminalEvent {
   Output {
      data: Vec<u8>,
   },
   Error {
      message: String,
   },
   Exit {
      exit_code: Option<u32>,
      signal: Option<String>,
   },
   Closed,
}

pub type TerminalEventHandler = Arc<dyn Fn(&str, TerminalEvent) -> bool + Send + Sync>;

#[derive(Default)]
pub struct TerminalReaderControl {
   paused: Mutex<bool>,
   resumed: Condvar,
}

impl TerminalReaderControl {
   pub fn set_paused(&self, paused: bool) {
      if let Ok(mut current) = self.paused.lock() {
         *current = paused;
         if !paused {
            self.resumed.notify_all();
         }
      }
   }

   pub fn wait_until_resumed(&self) -> bool {
      let Ok(mut paused) = self.paused.lock() else {
         return false;
      };

      while *paused {
         let Ok(next) = self.resumed.wait(paused) else {
            return false;
         };
         paused = next;
      }

      true
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::{sync::mpsc, thread, time::Duration};

   #[test]
   fn serializes_terminal_events_with_camel_case_wire_fields() {
      let event = TerminalEvent::Exit {
         exit_code: Some(2),
         signal: None,
      };

      assert_eq!(
         serde_json::to_value(event).unwrap(),
         serde_json::json!({
            "event": "exit",
            "exitCode": 2,
            "signal": null
         })
      );
   }

   #[test]
   fn deserializes_binary_input_without_utf8_conversion() {
      let input: TerminalInput = serde_json::from_value(serde_json::json!({
         "kind": "binary",
         "data": [255, 0, 27]
      }))
      .unwrap();

      assert_eq!(input.into_bytes(), vec![255, 0, 27]);
   }

   #[test]
   fn deserializes_pixel_aware_terminal_size() {
      let size: TerminalSize = serde_json::from_value(serde_json::json!({
         "rows": 40,
         "cols": 120,
         "pixelWidth": 960,
         "pixelHeight": 800
      }))
      .unwrap();

      assert_eq!(
         size,
         TerminalSize {
            rows: 40,
            cols: 120,
            pixel_width: 960,
            pixel_height: 800,
         }
      );
   }

   #[test]
   fn normalizes_zero_grid_dimensions_for_pty_backends() {
      let size = TerminalSize {
         rows: 0,
         cols: 0,
         pixel_width: 800,
         pixel_height: 600,
      }
      .normalized();

      assert_eq!(size.rows, 1);
      assert_eq!(size.cols, 1);
      assert_eq!(size.pixel_width, 800);
      assert_eq!(size.pixel_height, 600);
   }

   #[test]
   fn reader_control_blocks_until_output_is_resumed() {
      let control = Arc::new(TerminalReaderControl::default());
      control.set_paused(true);
      let worker_control = control.clone();
      let (sender, receiver) = mpsc::channel();

      let worker = thread::spawn(move || {
         sender.send(worker_control.wait_until_resumed()).unwrap();
      });

      assert!(receiver.recv_timeout(Duration::from_millis(20)).is_err());
      control.set_paused(false);
      assert!(receiver.recv_timeout(Duration::from_secs(1)).unwrap());
      worker.join().unwrap();
   }
}
