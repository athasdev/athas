use super::client::LspClient;
use std::{
   collections::HashMap,
   path::{Path, PathBuf},
   process::Child,
   sync::{Arc, Mutex},
};

type WorkspaceKey = (PathBuf, String);

pub(super) struct LspInstance {
   pub client: LspClient,
   pub child: Child,
   pub server_name: String,
   pub ref_count: usize,
   pub files: Vec<PathBuf>,
}

#[derive(Clone)]
pub(super) struct WorkspaceClients {
   inner: Arc<Mutex<HashMap<WorkspaceKey, LspInstance>>>,
}

impl WorkspaceClients {
   pub(super) fn new() -> Self {
      Self {
         inner: Arc::new(Mutex::new(HashMap::new())),
      }
   }

   pub(super) fn contains_workspace_server(
      &self,
      workspace_path: &Path,
      server_name: &str,
   ) -> bool {
      self
         .inner
         .lock()
         .unwrap()
         .contains_key(&(workspace_path.to_path_buf(), server_name.to_string()))
   }

   pub(super) fn insert(
      &self,
      workspace_path: PathBuf,
      server_name: String,
      instance: LspInstance,
   ) {
      self
         .inner
         .lock()
         .unwrap()
         .insert((workspace_path, server_name), instance);
   }

   pub(super) fn track_file(
      &self,
      workspace_path: &Path,
      server_name: &str,
      file_path: &Path,
   ) -> Option<usize> {
      let mut clients = self.inner.lock().unwrap();
      let key = (workspace_path.to_path_buf(), server_name.to_string());
      let instance = clients.get_mut(&key)?;
      instance.ref_count += 1;
      if !instance.files.iter().any(|tracked| tracked == file_path) {
         instance.files.push(file_path.to_path_buf());
      }
      Some(instance.ref_count)
   }

   pub(super) fn stop_file(&self, file_path: &Path) {
      let mut clients = self.inner.lock().unwrap();
      let mut to_remove: Option<WorkspaceKey> = None;

      for (key, instance) in clients.iter_mut() {
         if instance.files.iter().any(|tracked| tracked == file_path) {
            instance.files.retain(|tracked| tracked != file_path);
            instance.ref_count = instance.ref_count.saturating_sub(1);

            log::info!(
               "Decremented ref_count for LSP '{}' (now: {})",
               instance.server_name,
               instance.ref_count
            );

            if instance.ref_count == 0 {
               log::info!(
                  "LSP '{}' ref_count reached 0, shutting down",
                  instance.server_name
               );
               to_remove = Some(key.clone());
            }

            break;
         }
      }

      if let Some(key) = to_remove
         && let Some(mut instance) = clients.remove(&key)
      {
         log::info!("Shutting down LSP '{}'", instance.server_name);
         let _ = instance.child.kill();
      }
   }

   pub(super) fn get_client_for_file(&self, file_path: &Path) -> Option<LspClient> {
      let file_ext = file_path.extension().and_then(|ext| ext.to_str());
      let clients = self.inner.lock().unwrap();

      log::debug!(
         "get_client_for_file: looking for client for {:?} (ext: {:?})",
         file_path,
         file_ext
      );

      for ((workspace_path, server_name), instance) in clients.iter() {
         if file_path.starts_with(workspace_path) {
            let has_matching_ext = instance
               .files
               .iter()
               .any(|tracked| tracked.extension() == file_path.extension());

            log::debug!(
               "  checking server '{}': has_matching_ext={}",
               server_name,
               has_matching_ext
            );

            if has_matching_ext {
               log::info!(
                  "get_client_for_file: selected server '{}' for {:?} (matched extension)",
                  server_name,
                  file_path
               );
               return Some(instance.client.clone());
            }
         }
      }

      for ((workspace_path, server_name), instance) in clients.iter() {
         if file_path.starts_with(workspace_path)
            && instance.files.iter().any(|tracked| tracked == file_path)
         {
            log::info!(
               "get_client_for_file: selected server '{}' for {:?} (exact file match)",
               server_name,
               file_path
            );
            return Some(instance.client.clone());
         }
      }

      log::warn!("get_client_for_file: no client found for {:?}", file_path);
      None
   }

   pub(super) fn shutdown_all(&self) {
      let mut clients = self.inner.lock().unwrap();
      for ((workspace, server_name), mut instance) in clients.drain() {
         log::info!(
            "Shutting down LSP '{}' for workspace {:?}",
            server_name,
            workspace
         );
         let _ = instance.child.kill();
      }
   }

   pub(super) fn shutdown_workspace(&self, workspace_path: &Path) -> std::io::Result<()> {
      let mut clients = self.inner.lock().unwrap();
      let keys_to_remove: Vec<_> = clients
         .keys()
         .filter(|(ws, _)| ws == workspace_path)
         .cloned()
         .collect();

      for key in keys_to_remove {
         if let Some(mut instance) = clients.remove(&key) {
            log::info!(
               "Shutting down LSP '{}' for workspace {:?}",
               instance.server_name,
               workspace_path
            );
            instance.child.kill()?;
         }
      }

      Ok(())
   }
}
