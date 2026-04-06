use athas_project::{FileChangeEmitter, FileChangeEvent};
use tauri::{AppHandle, Emitter};

pub struct TauriFileChangeEmitter {
   app_handle: AppHandle,
}

impl TauriFileChangeEmitter {
   pub fn new(app_handle: AppHandle) -> Self {
      Self { app_handle }
   }
}

impl FileChangeEmitter for TauriFileChangeEmitter {
   fn emit_file_change(&self, event: &FileChangeEvent) {
      let _ = self.app_handle.emit("file-changed", event);
   }
}
