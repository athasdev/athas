use athas_project::{FileChangeEmitter, FileChangeEvent};
use tauri::{AppHandle, Emitter, Runtime};

pub struct TauriFileChangeEmitter<R: Runtime> {
   app_handle: AppHandle<R>,
}

impl<R: Runtime> TauriFileChangeEmitter<R> {
   pub fn new(app_handle: AppHandle<R>) -> Self {
      Self { app_handle }
   }
}

impl<R: Runtime> FileChangeEmitter for TauriFileChangeEmitter<R> {
   fn emit_file_change(&self, event: &FileChangeEvent) {
      let _ = self.app_handle.emit("file-changed", event);
   }
}
