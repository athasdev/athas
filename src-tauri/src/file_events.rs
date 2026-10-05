use crate::commands::FffSearchState;
use athas_fff_search::FffFsChange;
use athas_project::{
   Subscriber, WORKSPACE_FILE_CHANGES_EVENT, WorkspaceChangeSink, WorkspaceFileChangeKind,
   WorkspaceFileChanges,
};
use std::{
   path::PathBuf,
   sync::{Mutex, mpsc},
};
use tauri::{AppHandle, Emitter, Manager};

/// Sends each batch to the windows that watch its root, and feeds the search index on a thread
/// of its own so a slow git status refresh never holds up the next batch.
pub struct TauriWorkspaceChangeSink {
   app_handle: AppHandle,
   search_index: Mutex<Option<mpsc::Sender<WorkspaceFileChanges>>>,
}

impl TauriWorkspaceChangeSink {
   pub fn new(app_handle: AppHandle) -> Self {
      Self {
         app_handle,
         search_index: Mutex::new(None),
      }
   }

   fn feed_search_index(&self, changes: &WorkspaceFileChanges) {
      let mut sender = self
         .search_index
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner());
      let sender = sender.get_or_insert_with(|| spawn_search_index_feeder(self.app_handle.clone()));
      if sender.send(changes.clone()).is_err() {
         log::warn!("[FileWatcher] Search index feeder stopped");
      }
   }
}

impl WorkspaceChangeSink for TauriWorkspaceChangeSink {
   fn deliver(&self, changes: &WorkspaceFileChanges, subscribers: &[Subscriber]) {
      for subscriber in subscribers {
         match subscriber {
            Subscriber::Window(label) => {
               if let Err(error) =
                  self
                     .app_handle
                     .emit_to(label.as_str(), WORKSPACE_FILE_CHANGES_EVENT, changes)
               {
                  log::warn!("[FileWatcher] Could not notify window {label}: {error}");
               }
            }
            Subscriber::SearchIndex => self.feed_search_index(changes),
         }
      }
   }
}

fn spawn_search_index_feeder(app_handle: AppHandle) -> mpsc::Sender<WorkspaceFileChanges> {
   let (sender, receiver) = mpsc::channel::<WorkspaceFileChanges>();
   let spawned = std::thread::Builder::new()
      .name("athas-search-index-feeder".into())
      .spawn(move || {
         while let Ok(batch) = receiver.recv() {
            let state = app_handle.state::<FffSearchState>();
            let Some(fff) = state.get() else {
               continue;
            };
            let changes: Vec<FffFsChange> = batch
               .changes
               .iter()
               .map(|change| FffFsChange {
                  path: PathBuf::from(&change.path),
                  removed: change.kind == WorkspaceFileChangeKind::Removed,
                  is_dir: change.is_dir,
               })
               .collect();
            if let Err(error) = fff.apply_changes(
               &PathBuf::from(&batch.root),
               &changes,
               batch.rescan,
               batch.git_changed,
            ) {
               log::warn!(
                  "[FileWatcher] Could not update the search index for {}: {error}",
                  batch.root
               );
            }
         }
      });
   if let Err(error) = spawned {
      log::error!("[FileWatcher] Could not start the search index feeder: {error}");
   }
   sender
}
