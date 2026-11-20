use super::{
   ignore_rules::{IgnoreRules, PathClass, classify, is_ignore_file},
   types::{WorkspaceFileChange, WorkspaceFileChangeKind, WorkspaceFileChanges},
};
use notify::{Event, EventKind, event::ModifyKind};
use std::{
   collections::HashMap,
   path::{Path, PathBuf},
   sync::mpsc::{Receiver, RecvTimeoutError},
   time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, Default)]
struct PathHint {
   created: bool,
   removed: bool,
}

/// Raw OS events collected during one debounce window, one entry per path in arrival order.
#[derive(Debug)]
pub struct PendingEvents {
   order: Vec<PathBuf>,
   hints: HashMap<PathBuf, PathHint>,
   limit: usize,
   overflowed: bool,
   rescan: bool,
}

impl PendingEvents {
   pub fn new(limit: usize) -> Self {
      Self {
         order: Vec::new(),
         hints: HashMap::new(),
         limit,
         overflowed: false,
         rescan: false,
      }
   }

   pub fn is_empty(&self) -> bool {
      self.order.is_empty() && !self.rescan && !self.overflowed
   }

   #[cfg(test)]
   pub fn len(&self) -> usize {
      self.order.len()
   }

   pub fn record(&mut self, event: &Event) {
      if event.need_rescan() {
         self.rescan = true;
      }

      // Reads and metadata-only changes (chmod, atime, xattrs) never change what the editor
      // shows.
      if matches!(
         event.kind,
         EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_))
      ) {
         return;
      }

      let created = matches!(
         event.kind,
         EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_))
      );
      let removed = matches!(event.kind, EventKind::Remove(_));

      for path in &event.paths {
         if let Some(hint) = self.hints.get_mut(path) {
            hint.created |= created;
            hint.removed |= removed;
            continue;
         }
         if self.order.len() >= self.limit {
            self.overflowed = true;
            continue;
         }
         self.order.push(path.clone());
         self
            .hints
            .insert(path.clone(), PathHint { created, removed });
      }
   }

   pub fn paths(&self) -> impl Iterator<Item = &Path> {
      self.order.iter().map(PathBuf::as_path)
   }
}

/// Blocks for the first event, then keeps collecting until the stream has been quiet for
/// `quiet` or `max_latency` has passed since the first event. Returns `None` once every sender
/// is gone and nothing is left to flush.
pub fn collect_window(
   receiver: &Receiver<notify::Result<Event>>,
   quiet: Duration,
   max_latency: Duration,
   limit: usize,
) -> Option<PendingEvents> {
   let mut pending = PendingEvents::new(limit);
   let first = receiver.recv().ok()?;
   record_result(&mut pending, first);

   let started = Instant::now();
   loop {
      let remaining = max_latency.saturating_sub(started.elapsed());
      if remaining.is_zero() {
         break;
      }
      match receiver.recv_timeout(quiet.min(remaining)) {
         Ok(result) => record_result(&mut pending, result),
         Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
      }
   }

   Some(pending)
}

fn record_result(pending: &mut PendingEvents, result: notify::Result<Event>) {
   match result {
      Ok(event) => pending.record(&event),
      Err(error) => {
         log::warn!("[FileWatcher] Watch error, rescanning: {error}");
         pending.rescan = true;
      }
   }
}

/// The part of `path` below a workspace root. Event paths come back canonical on macOS
/// (`/private/var/...`) and as registered elsewhere, so both spellings are tried.
fn relative_to<'a>(path: &'a Path, root: &Path, canonical_root: &Path) -> Option<&'a Path> {
   path
      .strip_prefix(canonical_root)
      .or_else(|_| path.strip_prefix(root))
      .ok()
}

/// Whether any event in the window touched something under `root`.
pub fn touches_root(pending: &PendingEvents, root: &Path, canonical_root: &Path) -> bool {
   pending.rescan
      || pending.overflowed
      || pending
         .paths()
         .any(|path| relative_to(path, root, canonical_root).is_some())
}

/// Builds the batch for one root out of a debounce window. Paths are reported under `root` as
/// the caller spelled it, so the frontend can match them against its own paths.
pub fn build_batch(
   pending: &PendingEvents,
   root: &Path,
   canonical_root: &Path,
   rules: &mut IgnoreRules,
   max_changes: usize,
) -> WorkspaceFileChanges {
   let mut batch = WorkspaceFileChanges {
      root: root.to_string_lossy().into_owned(),
      changes: Vec::new(),
      git_changed: false,
      rescan: pending.rescan || pending.overflowed,
   };

   let relevant: Vec<(&Path, &Path)> = pending
      .paths()
      .filter_map(|path| relative_to(path, root, canonical_root).map(|rel| (path, rel)))
      .collect();

   // New ignore rules apply to the rest of this window too.
   if relevant
      .iter()
      .any(|(_, relative)| classify(relative) == PathClass::Worktree && is_ignore_file(relative))
   {
      rules.invalidate();
   }

   for (path, relative) in relevant {
      match classify(relative) {
         PathClass::Dropped => continue,
         PathClass::GitState => {
            batch.git_changed = true;
            continue;
         }
         PathClass::Worktree => {}
      }

      let hint = pending.hints.get(path).copied().unwrap_or_default();
      let metadata = std::fs::symlink_metadata(path).ok();
      let is_dir = metadata.as_ref().is_some_and(|meta| meta.is_dir());
      if rules.is_ignored(relative, is_dir) {
         continue;
      }

      let kind = match metadata {
         None => WorkspaceFileChangeKind::Removed,
         Some(_) if hint.created || hint.removed => WorkspaceFileChangeKind::Created,
         Some(_) => WorkspaceFileChangeKind::Modified,
      };

      batch.changes.push(WorkspaceFileChange {
         path: root.join(relative).to_string_lossy().into_owned(),
         kind,
         is_dir,
      });
   }

   if batch.changes.len() > max_changes {
      batch.changes.clear();
      batch.rescan = true;
   }

   batch
}

#[cfg(test)]
mod tests {
   use super::*;
   use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind, RemoveKind};
   use std::sync::mpsc;

   fn event(kind: EventKind, paths: &[&Path]) -> Event {
      let mut event = Event::new(kind);
      for path in paths {
         event = event.add_path(path.to_path_buf());
      }
      event
   }

   fn modified(path: &Path) -> Event {
      event(
         EventKind::Modify(ModifyKind::Data(DataChange::Content)),
         &[path],
      )
   }

   fn canonical_tempdir() -> (tempfile::TempDir, PathBuf) {
      let temp = tempfile::tempdir().unwrap();
      let root = dunce::canonicalize(temp.path()).unwrap();
      (temp, root)
   }

   fn summary(batch: &WorkspaceFileChanges) -> Vec<(String, WorkspaceFileChangeKind)> {
      batch
         .changes
         .iter()
         .map(|change| (change.path.clone(), change.kind))
         .collect()
   }

   #[test]
   fn coalesces_repeated_events_per_path_and_skips_reads() {
      let mut pending = PendingEvents::new(100);
      let file = Path::new("/w/a.rs");
      pending.record(&event(EventKind::Create(CreateKind::File), &[file]));
      pending.record(&modified(file));
      pending.record(&modified(file));
      pending.record(&event(
         EventKind::Access(AccessKind::Read),
         &[Path::new("/w/b.rs")],
      ));
      pending.record(&event(
         EventKind::Modify(ModifyKind::Metadata(MetadataKind::Permissions)),
         &[Path::new("/w/c.rs")],
      ));

      assert_eq!(pending.len(), 1);
      assert!(pending.hints[file].created);
   }

   #[test]
   fn overflowing_the_window_turns_into_a_rescan() {
      let (_temp, root) = canonical_tempdir();
      let mut pending = PendingEvents::new(2);
      for name in ["a", "b", "c"] {
         pending.record(&modified(&root.join(name)));
      }
      assert_eq!(pending.len(), 2);

      let batch = build_batch(&pending, &root, &root, &mut IgnoreRules::new(&root), 100);
      assert!(batch.rescan);
   }

   #[test]
   fn too_many_changes_collapse_into_a_rescan() {
      let (_temp, root) = canonical_tempdir();
      let mut pending = PendingEvents::new(100);
      for index in 0..5 {
         let path = root.join(format!("f{index}.rs"));
         std::fs::write(&path, "x").unwrap();
         pending.record(&modified(&path));
      }

      let batch = build_batch(&pending, &root, &root, &mut IgnoreRules::new(&root), 3);
      assert!(batch.rescan);
      assert!(batch.changes.is_empty());
   }

   #[test]
   fn builds_one_filtered_batch_with_kinds_and_a_git_signal() {
      let (_temp, root) = canonical_tempdir();
      std::fs::create_dir_all(root.join("src")).unwrap();
      std::fs::create_dir_all(root.join("node_modules/react")).unwrap();
      std::fs::create_dir_all(root.join(".git/objects/ab")).unwrap();
      std::fs::write(root.join(".gitignore"), "*.log\n").unwrap();
      let edited = root.join("src/lib.rs");
      let created = root.join("src/new.rs");
      let new_dir = root.join("docs");
      std::fs::write(&edited, "a").unwrap();
      std::fs::write(&created, "b").unwrap();
      std::fs::create_dir(&new_dir).unwrap();
      std::fs::write(root.join("debug.log"), "noise").unwrap();
      std::fs::write(root.join("node_modules/react/index.js"), "x").unwrap();
      std::fs::write(root.join(".git/HEAD"), "ref: refs/heads/main").unwrap();
      let removed = root.join("src/old.rs");

      let mut pending = PendingEvents::new(100);
      pending.record(&modified(&edited));
      pending.record(&event(EventKind::Create(CreateKind::File), &[&created]));
      pending.record(&event(EventKind::Create(CreateKind::Folder), &[&new_dir]));
      pending.record(&event(EventKind::Remove(RemoveKind::File), &[&removed]));
      pending.record(&modified(&root.join("debug.log")));
      pending.record(&modified(&root.join("node_modules/react/index.js")));
      pending.record(&modified(&root.join(".git/objects/ab/cd")));
      pending.record(&modified(&root.join(".git/HEAD")));
      pending.record(&modified(Path::new("/somewhere/else.rs")));

      let batch = build_batch(&pending, &root, &root, &mut IgnoreRules::new(&root), 100);

      let path = |p: &PathBuf| p.to_string_lossy().into_owned();
      assert_eq!(
         summary(&batch),
         vec![
            (path(&edited), WorkspaceFileChangeKind::Modified),
            (path(&created), WorkspaceFileChangeKind::Created),
            (path(&new_dir), WorkspaceFileChangeKind::Created),
            (path(&removed), WorkspaceFileChangeKind::Removed),
         ]
      );
      assert!(batch.changes[2].is_dir);
      assert!(batch.git_changed);
      assert!(!batch.rescan);
   }

   #[test]
   fn reports_paths_under_the_root_as_spelled_by_the_caller() {
      let (_temp, canonical) = canonical_tempdir();
      let file = canonical.join("a.rs");
      std::fs::write(&file, "a").unwrap();
      let spelled = Path::new("/alias/workspace");

      let mut pending = PendingEvents::new(100);
      pending.record(&modified(&file));
      let batch = build_batch(
         &pending,
         spelled,
         &canonical,
         &mut IgnoreRules::new(&canonical),
         100,
      );

      assert_eq!(batch.root, spelled.to_string_lossy());
      assert_eq!(
         batch.changes[0].path,
         spelled.join("a.rs").to_string_lossy()
      );
   }

   #[test]
   fn a_changed_ignore_file_applies_within_the_same_window() {
      let (_temp, root) = canonical_tempdir();
      let mut rules = IgnoreRules::new(&root);
      let generated = root.join("generated.ts");
      std::fs::write(&generated, "x").unwrap();
      assert!(!rules.is_ignored(Path::new("generated.ts"), false));

      std::fs::write(root.join(".gitignore"), "generated.ts\n").unwrap();
      let mut pending = PendingEvents::new(100);
      pending.record(&modified(&generated));
      pending.record(&modified(&root.join(".gitignore")));

      let batch = build_batch(&pending, &root, &root, &mut rules, 100);
      assert_eq!(
         summary(&batch),
         vec![(
            root.join(".gitignore").to_string_lossy().into_owned(),
            WorkspaceFileChangeKind::Modified
         )]
      );
   }

   #[test]
   fn collects_a_burst_into_one_window() {
      let (sender, receiver) = mpsc::channel();
      for index in 0..50 {
         sender
            .send(Ok(modified(Path::new(&format!("/w/{index}.rs")))))
            .unwrap();
      }
      sender.send(Ok(modified(Path::new("/w/0.rs")))).unwrap();

      let pending = collect_window(
         &receiver,
         Duration::from_millis(20),
         Duration::from_secs(1),
         1000,
      )
      .unwrap();
      assert_eq!(pending.len(), 50);

      drop(sender);
      assert!(
         collect_window(
            &receiver,
            Duration::from_millis(20),
            Duration::from_secs(1),
            1000
         )
         .is_none()
      );
   }

   #[test]
   fn a_window_never_outlives_its_max_latency() {
      let (sender, receiver) = mpsc::channel();
      let producer = std::thread::spawn(move || {
         for index in 0..40 {
            if sender
               .send(Ok(modified(Path::new(&format!("/w/{index}.rs")))))
               .is_err()
            {
               break;
            }
            std::thread::sleep(Duration::from_millis(10));
         }
      });

      let started = Instant::now();
      let pending = collect_window(
         &receiver,
         Duration::from_millis(100),
         Duration::from_millis(150),
         1000,
      )
      .unwrap();
      assert!(started.elapsed() < Duration::from_millis(400));
      assert!(pending.len() < 40);
      drop(receiver);
      producer.join().unwrap();
   }

   #[test]
   fn watch_errors_request_a_rescan() {
      let (sender, receiver) = mpsc::channel();
      sender
         .send(Err(notify::Error::generic("queue overflow")))
         .unwrap();
      let pending = collect_window(
         &receiver,
         Duration::from_millis(10),
         Duration::from_millis(50),
         10,
      )
      .unwrap();
      assert!(!pending.is_empty());
      let root = Path::new("/w");
      assert!(build_batch(&pending, root, root, &mut IgnoreRules::new(root), 10).rescan);
   }
}
