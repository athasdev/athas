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

   pub(super) fn get_workspace_server(
      &self,
      workspace_path: &Path,
      server_name: &str,
      owner: Option<&str>,
   ) -> Option<LspClient> {
      let mut clients = self.inner.lock().unwrap();
      Self::prune_dead_instances(&mut clients);
      let key = (workspace_path.to_path_buf(), server_name.to_string());
      Self::remove_previous_owner(&mut clients, &key, owner);
      clients.get(&key).map(|instance| instance.client.clone())
   }

   pub(super) fn track_file(
      &self,
      workspace_path: &Path,
      server_name: &str,
      file_path: &Path,
      owner: Option<&str>,
   ) -> Option<usize> {
      let mut clients = self.inner.lock().unwrap();
      Self::prune_dead_instances(&mut clients);
      let key = (workspace_path.to_path_buf(), server_name.to_string());
      Self::remove_previous_owner(&mut clients, &key, owner);
      let instance = clients.get_mut(&key)?;
      // stop_file releases a file once, so a file that is already tracked
      // must not add another reference or the count can never reach zero.
      if !instance.files.iter().any(|tracked| tracked == file_path) {
         instance.files.push(file_path.to_path_buf());
         instance.ref_count += 1;
      }
      Some(instance.ref_count)
   }

   fn remove_previous_owner(
      clients: &mut HashMap<WorkspaceKey, LspInstance>,
      key: &WorkspaceKey,
      owner: Option<&str>,
   ) {
      if clients
         .get(key)
         .is_some_and(|instance| !instance.client.workspace_edit_owner_is(owner))
         && let Some(mut instance) = clients.remove(key)
         && let Err(error) = instance
            .child
            .kill()
            .and_then(|()| instance.child.wait().map(|_| ()))
      {
         log::warn!("Failed to stop language server for retired workspace owner: {error}");
      }
   }

   pub(super) fn stop_file(&self, file_path: &Path) {
      let mut clients = self.inner.lock().unwrap();
      Self::prune_dead_instances(&mut clients);
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
      let mut clients = self.inner.lock().unwrap();
      Self::prune_dead_instances(&mut clients);

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

   pub(super) fn get_clients_for_workspace(&self, workspace_path: &Path) -> Vec<LspClient> {
      let mut clients = self.inner.lock().unwrap();
      Self::prune_dead_instances(&mut clients);
      clients
         .iter()
         .filter(|((ws, _), _)| ws == workspace_path)
         .map(|(_, instance)| instance.client.clone())
         .collect()
   }

   pub(super) fn get_client_by_id(&self, client_id: &str) -> Option<LspClient> {
      let mut clients = self.inner.lock().unwrap();
      Self::prune_dead_instances(&mut clients);
      clients
         .values()
         .find(|instance| instance.client.id() == client_id)
         .map(|instance| instance.client.clone())
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
      Self::prune_dead_instances(&mut clients);
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

   fn prune_dead_instances(clients: &mut HashMap<WorkspaceKey, LspInstance>) {
      let mut dead_keys = Vec::new();

      for (key, instance) in clients.iter_mut() {
         let child_exited = match instance.child.try_wait() {
            Ok(Some(status)) => {
               log::warn!(
                  "Removing exited LSP '{}' for workspace {:?} with status {}",
                  instance.server_name,
                  key.0,
                  status
               );
               true
            }
            Ok(None) => false,
            Err(error) => {
               log::warn!(
                  "Failed to inspect LSP '{}' for workspace {:?}: {}",
                  instance.server_name,
                  key.0,
                  error
               );
               true
            }
         };

         if child_exited || !instance.client.is_running() {
            dead_keys.push(key.clone());
         }
      }

      for key in dead_keys {
         clients.remove(&key);
      }
   }
}

#[cfg(all(test, unix))]
mod owner_tests {
   use super::*;
   use std::process::Command;

   fn clients(owner: &str) -> WorkspaceClients {
      let child = Command::new("sleep").arg("30").spawn().unwrap();
      let clients = WorkspaceClients::new();
      clients.insert(
         PathBuf::from("/workspace"),
         "server".into(),
         LspInstance {
            client: LspClient::workspace_edit_test_client(Some(owner)),
            child,
            server_name: "server".into(),
            ref_count: 1,
            files: vec![PathBuf::from("/workspace/a.ts")],
         },
      );
      clients
   }

   #[test]
   fn same_owner_reuses_server_without_duplicating_file_references() {
      let clients = clients("owner-1");
      assert!(
         clients
            .get_workspace_server(Path::new("/workspace"), "server", Some("owner-1"))
            .is_some()
      );
      assert_eq!(
         clients.track_file(
            Path::new("/workspace"),
            "server",
            Path::new("/workspace/a.ts"),
            Some("owner-1")
         ),
         Some(1)
      );
      assert_eq!(
         clients.track_file(
            Path::new("/workspace"),
            "server",
            Path::new("/workspace/b.ts"),
            Some("owner-1")
         ),
         Some(2)
      );
      clients.stop_file(Path::new("/workspace/a.ts"));
      assert!(
         clients
            .get_workspace_server(Path::new("/workspace"), "server", Some("owner-1"))
            .is_some()
      );
      clients.stop_file(Path::new("/workspace/b.ts"));
      assert!(
         clients
            .get_workspace_server(Path::new("/workspace"), "server", Some("owner-1"))
            .is_none()
      );
   }

   #[test]
   fn reopened_workspace_cannot_rebind_an_old_server_to_the_new_owner() {
      let clients = clients("owner-1");
      assert!(
         clients
            .get_workspace_server(Path::new("/workspace"), "server", Some("owner-2"))
            .is_none()
      );
      assert!(clients.get_client_by_id("test-client").is_none());
      assert!(
         clients
            .get_workspace_server(Path::new("/workspace"), "server", Some("owner-1"))
            .is_none()
      );
   }

   #[test]
   fn starting_a_file_for_a_reopened_owner_retires_the_old_server() {
      let clients = clients("owner-1");
      assert_eq!(
         clients.track_file(
            Path::new("/workspace"),
            "server",
            Path::new("/workspace/b.ts"),
            Some("owner-2")
         ),
         None
      );
      assert!(clients.get_client_by_id("test-client").is_none());
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::test_support::spawn_fake_server;

   struct ShutdownOnDrop(WorkspaceClients);

   impl Drop for ShutdownOnDrop {
      fn drop(&mut self) {
         self.0.shutdown_all();
      }
   }

   async fn instance(workspace: &Path, server_name: &str, files: &[PathBuf]) -> LspInstance {
      let (client, child) = spawn_fake_server(workspace).await;
      LspInstance {
         client,
         child,
         server_name: server_name.to_string(),
         ref_count: files.len(),
         files: files.to_vec(),
      }
   }

   fn contains_workspace_server(
      clients: &WorkspaceClients,
      workspace: &Path,
      server_name: &str,
   ) -> bool {
      clients
         .get_workspace_server(workspace, server_name, None)
         .is_some()
   }

   fn instance_count(clients: &WorkspaceClients) -> usize {
      clients.inner.lock().unwrap().len()
   }

   #[tokio::test]
   async fn reference_counts_files_and_stops_the_server_after_the_last_one() {
      let temp = tempfile::tempdir().unwrap();
      let workspace = temp.path().to_path_buf();
      let first = workspace.join("a.ts");
      let second = workspace.join("b.ts");
      let clients = WorkspaceClients::new();
      let _guard = ShutdownOnDrop(clients.clone());
      clients.insert(
         workspace.clone(),
         "typescript".to_string(),
         instance(&workspace, "typescript", std::slice::from_ref(&first)).await,
      );

      assert!(contains_workspace_server(
         &clients,
         &workspace,
         "typescript"
      ));
      assert!(!contains_workspace_server(
         &clients,
         &workspace,
         "rust-analyzer"
      ));
      assert_eq!(
         clients.track_file(&workspace, "rust-analyzer", &second, None),
         None
      );
      assert_eq!(
         clients.track_file(&workspace, "typescript", &second, None),
         Some(2)
      );

      clients.stop_file(&first);
      assert!(contains_workspace_server(
         &clients,
         &workspace,
         "typescript"
      ));
      clients.stop_file(&workspace.join("never-opened.ts"));
      assert!(contains_workspace_server(
         &clients,
         &workspace,
         "typescript"
      ));

      clients.stop_file(&second);
      assert!(!contains_workspace_server(
         &clients,
         &workspace,
         "typescript"
      ));
      assert_eq!(instance_count(&clients), 0);
   }

   #[tokio::test]
   async fn routes_files_to_the_server_tracking_their_extension() {
      let temp = tempfile::tempdir().unwrap();
      let workspace = temp.path().to_path_buf();
      let other_workspace = temp.path().join("other");
      let clients = WorkspaceClients::new();
      let _guard = ShutdownOnDrop(clients.clone());
      let ts = instance(&workspace, "typescript", &[workspace.join("index.ts")]).await;
      let rust = instance(&workspace, "rust-analyzer", &[workspace.join("main.rs")]).await;
      let ts_id = ts.client.id().to_string();
      let rust_id = rust.client.id().to_string();
      clients.insert(workspace.clone(), "typescript".to_string(), ts);
      clients.insert(workspace.clone(), "rust-analyzer".to_string(), rust);

      let for_ts = clients
         .get_client_for_file(&workspace.join("src").join("app.ts"))
         .unwrap();
      assert_eq!(for_ts.id(), ts_id);
      let for_rust = clients
         .get_client_for_file(&workspace.join("lib.rs"))
         .unwrap();
      assert_eq!(for_rust.id(), rust_id);
      assert!(
         clients
            .get_client_for_file(&workspace.join("notes.md"))
            .is_none()
      );
      assert!(
         clients
            .get_client_for_file(&temp.path().parent().unwrap().join("elsewhere.ts"))
            .is_none()
      );

      assert_eq!(clients.get_clients_for_workspace(&workspace).len(), 2);
      assert!(
         clients
            .get_clients_for_workspace(&other_workspace)
            .is_empty()
      );
      assert_eq!(clients.get_client_by_id(&rust_id).unwrap().id(), rust_id);
      assert!(clients.get_client_by_id("lsp-missing").is_none());

      clients.shutdown_workspace(&workspace).unwrap();
      assert_eq!(instance_count(&clients), 0);
   }

   #[tokio::test]
   async fn reopening_a_tracked_file_does_not_leak_the_server() {
      let temp = tempfile::tempdir().unwrap();
      let workspace = temp.path().to_path_buf();
      let file = workspace.join("a.ts");
      let clients = WorkspaceClients::new();
      let _guard = ShutdownOnDrop(clients.clone());
      clients.insert(
         workspace.clone(),
         "typescript".to_string(),
         instance(&workspace, "typescript", std::slice::from_ref(&file)).await,
      );

      assert_eq!(
         clients.track_file(&workspace, "typescript", &file, None),
         Some(1)
      );
      clients.stop_file(&file);

      assert!(!contains_workspace_server(
         &clients,
         &workspace,
         "typescript"
      ));
   }

   #[tokio::test]
   async fn prunes_instances_whose_server_process_exited() {
      let temp = tempfile::tempdir().unwrap();
      let workspace = temp.path().to_path_buf();
      let file = workspace.join("main.rs");
      let clients = WorkspaceClients::new();
      let _guard = ShutdownOnDrop(clients.clone());
      let mut dead = instance(&workspace, "rust-analyzer", std::slice::from_ref(&file)).await;
      dead.child.kill().unwrap();
      dead.child.wait().unwrap();
      clients.insert(workspace.clone(), "rust-analyzer".to_string(), dead);

      assert!(clients.get_client_for_file(&file).is_none());
      assert!(!contains_workspace_server(
         &clients,
         &workspace,
         "rust-analyzer"
      ));
      assert_eq!(instance_count(&clients), 0);
   }
}
