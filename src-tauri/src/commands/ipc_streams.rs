//! Cancellation for commands that stream results to the webview over a
//! `tauri::ipc::Channel`. The webview names each stream with an id and cancels it
//! by that id when the results are no longer wanted.

use std::{
   collections::HashMap,
   sync::{
      Arc, Mutex,
      atomic::{AtomicBool, Ordering},
   },
};
use tauri::State;

/// Cancelled ids are remembered so a cancel that arrives before its stream starts
/// still stops it; this bounds how many such early cancels are kept.
const MAX_PENDING_CANCELS: usize = 64;

#[derive(Clone, Debug, Default)]
pub struct IpcStreamToken(Arc<AtomicBool>);

impl IpcStreamToken {
   pub fn is_cancelled(&self) -> bool {
      self.0.load(Ordering::Relaxed)
   }

   fn cancel(&self) {
      self.0.store(true, Ordering::Relaxed);
   }
}

#[derive(Default)]
pub struct IpcStreams {
   active: Mutex<HashMap<String, IpcStreamToken>>,
}

impl IpcStreams {
   /// Registers a stream. A stream that was cancelled before it started comes back
   /// already cancelled; a still-running stream with the same id is cancelled.
   pub fn start(&self, id: &str) -> IpcStreamToken {
      let Ok(mut active) = self.active.lock() else {
         return IpcStreamToken::default();
      };
      if let Some(existing) = active.get(id) {
         if existing.is_cancelled() {
            return existing.clone();
         }
         existing.cancel();
      }
      let token = IpcStreamToken::default();
      active.insert(id.to_string(), token.clone());
      token
   }

   pub fn cancel(&self, id: &str) {
      let Ok(mut active) = self.active.lock() else {
         return;
      };
      if let Some(token) = active.get(id) {
         token.cancel();
         return;
      }
      if active.len() >= MAX_PENDING_CANCELS {
         active.retain(|_, token| !token.is_cancelled());
      }
      let token = IpcStreamToken::default();
      token.cancel();
      active.insert(id.to_string(), token);
   }

   /// Forgets a finished stream unless a newer stream has taken over its id.
   pub fn finish(&self, id: &str, token: &IpcStreamToken) {
      if let Ok(mut active) = self.active.lock()
         && active
            .get(id)
            .is_some_and(|current| Arc::ptr_eq(&current.0, &token.0))
      {
         active.remove(id);
      }
   }
}

#[tauri::command]
#[specta::specta]
pub fn cancel_ipc_stream(streams: State<'_, IpcStreams>, stream_id: String) {
   streams.cancel(&stream_id);
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn cancels_a_running_stream_by_id() {
      let streams = IpcStreams::default();
      let token = streams.start("search-1");
      assert!(!token.is_cancelled());
      streams.cancel("search-1");
      assert!(token.is_cancelled());
      streams.finish("search-1", &token);
      assert!(streams.active.lock().unwrap().is_empty());
   }

   #[test]
   fn a_cancel_that_arrives_first_stops_the_stream_when_it_starts() {
      let streams = IpcStreams::default();
      streams.cancel("search-1");
      let token = streams.start("search-1");
      assert!(token.is_cancelled());
      streams.finish("search-1", &token);
      assert!(streams.active.lock().unwrap().is_empty());
   }

   #[test]
   fn a_restarted_id_cancels_the_old_stream_and_keeps_the_new_one() {
      let streams = IpcStreams::default();
      let first = streams.start("search-1");
      let second = streams.start("search-1");
      assert!(first.is_cancelled());
      assert!(!second.is_cancelled());
      streams.finish("search-1", &first);
      assert!(streams.active.lock().unwrap().contains_key("search-1"));
   }

   #[test]
   fn bounds_the_number_of_early_cancels_it_remembers() {
      let streams = IpcStreams::default();
      for index in 0..(MAX_PENDING_CANCELS * 2) {
         streams.cancel(&format!("stream-{index}"));
      }
      assert!(streams.active.lock().unwrap().len() <= MAX_PENDING_CANCELS);
   }
}
