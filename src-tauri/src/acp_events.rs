use athas_ai::{AcpEmit, AcpEventSink, AcpHostInfo};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, Wry};

/// Sends what the ACP bridge tells the frontend to every window, under the event name it names.
pub struct TauriAcpEventSink<R: Runtime = Wry> {
   app_handle: AppHandle<R>,
}

impl<R: Runtime> TauriAcpEventSink<R> {
   pub fn new(app_handle: AppHandle<R>) -> Self {
      Self { app_handle }
   }
}

impl<R: Runtime> AcpEventSink for TauriAcpEventSink<R> {
   fn emit(&self, emit: AcpEmit<'_>) -> anyhow::Result<()> {
      self.app_handle.emit(emit.name(), emit)?;
      Ok(())
   }

   fn editor_window_count(&self) -> usize {
      self
         .app_handle
         .webview_windows()
         .values()
         .filter(|window| is_editor_window(window))
         .count()
   }
}

/// The app's version and data directory, as the ACP bridge needs them.
pub fn acp_host_info<R: Runtime>(app_handle: &AppHandle<R>) -> AcpHostInfo {
   AcpHostInfo {
      app_version: app_handle.package_info().version.to_string(),
      data_dir: app_handle.path().app_data_dir().ok(),
   }
}

/// Whether a window runs the editor workbench, which answers buffer reads. Detached windows (a
/// chat popped out on its own) hold no editor buffers.
fn is_editor_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
   window.url().is_ok_and(|url| {
      !url
         .query_pairs()
         .any(|(key, value)| key == "view" && value == "detached")
   })
}

#[cfg(test)]
mod tests {
   use super::*;
   use athas_ai::acp::{
      ACP_EVENT,
      types::{ACP_BUFFER_READ_EVENT, AcpBufferReadRequest, AcpEvent},
   };
   use std::sync::{Arc, Mutex};
   use tauri::Listener;

   #[test]
   fn events_go_out_under_their_names_with_their_own_payloads() {
      let app = tauri::test::mock_app();
      let received = Arc::new(Mutex::new(Vec::new()));
      for name in [ACP_EVENT, ACP_BUFFER_READ_EVENT] {
         let received = received.clone();
         app.listen_any(name, move |event| {
            received
               .lock()
               .unwrap()
               .push((name, event.payload().to_string()));
         });
      }
      let sink = TauriAcpEventSink::new(app.handle().clone());

      let event = AcpEvent::SessionComplete {
         session_id: "s1".to_string(),
      };
      let request = AcpBufferReadRequest {
         request_id: "r1".to_string(),
         path: "/work/a.rs".to_string(),
      };
      sink.emit(AcpEmit::Event(&event)).unwrap();
      sink.emit(AcpEmit::BufferRead(&request)).unwrap();

      assert_eq!(
         *received.lock().unwrap(),
         vec![
            (ACP_EVENT, serde_json::to_string(&event).unwrap()),
            (
               ACP_BUFFER_READ_EVENT,
               serde_json::to_string(&request).unwrap()
            ),
         ]
      );
      assert_eq!(sink.editor_window_count(), 0);
   }

   #[test]
   fn host_info_carries_the_app_version() {
      let app = tauri::test::mock_app();
      let info = acp_host_info(app.handle());
      assert_eq!(
         info.app_version,
         app.handle().package_info().version.to_string()
      );
   }
}
