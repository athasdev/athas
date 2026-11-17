//! What the ACP bridge needs from the app hosting it: somewhere to send the events the frontend
//! listens for, how many editor windows can answer a buffer read, and the app's version and data
//! directory. The desktop app implements [`AcpEventSink`] over its Tauri `AppHandle`; tests record
//! what would have been sent.

use super::{
   file_access::FileChangeEvent,
   traffic::TrafficEvent,
   types::{ACP_BUFFER_READ_EVENT, AcpBufferReadRequest, AcpEvent},
};
use serde::{Serialize, Serializer};
use std::{path::PathBuf, sync::Arc};

/// The event chats listen to for everything an agent does.
pub const ACP_EVENT: &str = "acp-event";
/// The event the ACP inspector listens to for the traffic of every agent process.
pub const ACP_TRAFFIC_EVENT: &str = "acp-traffic";
/// The event the file tree and editors listen to for files an agent wrote.
pub const FILE_CHANGED_EVENT: &str = "file-changed";

/// Something the ACP bridge tells the frontend. It serializes as its payload alone and goes out
/// under [`AcpEmit::name`].
#[derive(Debug, Clone, Copy)]
pub enum AcpEmit<'a> {
   Event(&'a AcpEvent),
   Traffic(&'a TrafficEvent),
   BufferRead(&'a AcpBufferReadRequest),
   FileChanged(&'a FileChangeEvent),
}

impl AcpEmit<'_> {
   /// The event name the frontend listens on.
   pub fn name(&self) -> &'static str {
      match self {
         Self::Event(_) => ACP_EVENT,
         Self::Traffic(_) => ACP_TRAFFIC_EVENT,
         Self::BufferRead(_) => ACP_BUFFER_READ_EVENT,
         Self::FileChanged(_) => FILE_CHANGED_EVENT,
      }
   }
}

impl Serialize for AcpEmit<'_> {
   fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
      match self {
         Self::Event(event) => event.serialize(serializer),
         Self::Traffic(event) => event.serialize(serializer),
         Self::BufferRead(request) => request.serialize(serializer),
         Self::FileChanged(event) => event.serialize(serializer),
      }
   }
}

/// Where the ACP bridge sends what the frontend must hear.
pub trait AcpEventSink: Send + Sync + 'static {
   /// Sends `emit` to every window as [`AcpEmit::name`].
   fn emit(&self, emit: AcpEmit<'_>) -> anyhow::Result<()>;

   /// How many open windows run the editor and so answer buffer reads. Detached windows, such as
   /// a chat popped out on its own, hold no editor buffers and do not count.
   fn editor_window_count(&self) -> usize;
}

impl dyn AcpEventSink {
   /// Sends an `acp-event`.
   pub(super) fn acp_event(&self, event: &AcpEvent) -> anyhow::Result<()> {
      self.emit(AcpEmit::Event(event))
   }
}

/// The sink shared by the worker, every agent connection and its client.
pub type SharedAcpEventSink = Arc<dyn AcpEventSink>;

/// Facts about the app the bridge reads once, at startup.
#[derive(Debug, Clone, Default)]
pub struct AcpHostInfo {
   /// The app's version, handed to agent terminals as `TERM_PROGRAM_VERSION`.
   pub app_version: String,
   /// The app's data directory, where managed agent installs live; `None` when it is unknown.
   pub data_dir: Option<PathBuf>,
}

// Only the worker tests use it, and they need unix processes.
#[cfg(all(test, unix))]
pub(super) mod recording {
   //! A sink that keeps what it was sent, for tests.

   use super::{AcpEmit, AcpEventSink};
   use serde_json::Value;
   use std::{
      sync::{
         Mutex,
         atomic::{AtomicUsize, Ordering},
      },
      time::Duration,
   };

   #[derive(Default)]
   pub(in crate::acp) struct RecordingSink {
      emitted: Mutex<Vec<(String, Value)>>,
      editor_windows: AtomicUsize,
   }

   impl RecordingSink {
      pub fn set_editor_windows(&self, windows: usize) {
         self.editor_windows.store(windows, Ordering::SeqCst);
      }

      /// Every event sent so far, as the event name and the JSON payload a window would get.
      pub fn emitted(&self) -> Vec<(String, Value)> {
         self.emitted.lock().unwrap().clone()
      }

      /// The payloads sent as `acp-event`, in order.
      pub fn acp_events(&self) -> Vec<Value> {
         self
            .emitted()
            .into_iter()
            .filter(|(name, _)| name == super::ACP_EVENT)
            .map(|(_, payload)| payload)
            .collect()
      }

      /// The `acp-event` payloads of type `kind`, in order.
      pub fn of_type(&self, kind: &str) -> Vec<Value> {
         self
            .acp_events()
            .into_iter()
            .filter(|event| event["type"] == kind)
            .collect()
      }

      /// Waits for the first event sent as `name` that matches `matches`, failing the test when
      /// none arrives within a few seconds.
      pub async fn wait_for_named(&self, name: &str, matches: impl Fn(&Value) -> bool) -> Value {
         let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
         loop {
            if let Some((_, payload)) = self
               .emitted()
               .into_iter()
               .find(|(emitted, payload)| emitted == name && matches(payload))
            {
               return payload;
            }
            assert!(
               tokio::time::Instant::now() < deadline,
               "no `{name}` event matched; sent: {:#?}",
               self.emitted()
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
         }
      }

      /// Waits for the first `acp-event` of type `kind` that matches `matches`.
      pub async fn wait_for(&self, kind: &str, matches: impl Fn(&Value) -> bool) -> Value {
         self
            .wait_for_named(super::ACP_EVENT, |event| {
               event["type"] == kind && matches(event)
            })
            .await
      }
   }

   impl AcpEventSink for RecordingSink {
      fn emit(&self, emit: AcpEmit<'_>) -> anyhow::Result<()> {
         let payload = serde_json::to_value(emit)?;
         self
            .emitted
            .lock()
            .unwrap()
            .push((emit.name().to_string(), payload));
         Ok(())
      }

      fn editor_window_count(&self) -> usize {
         self.editor_windows.load(Ordering::SeqCst)
      }
   }
}
