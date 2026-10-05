//! The workspace file watcher: one OS watcher for the whole app, one recursive watch per
//! workspace root, ignore rules applied before anything leaves Rust, and one batch per root per
//! debounce window.

mod batch;
mod ignore_rules;
mod types;

use anyhow::{Context, Result, bail};
use batch::{PendingEvents, build_batch, collect_window, touches_root};
pub use ignore_rules::ALWAYS_IGNORED_DIRS;
use ignore_rules::{IgnoreRules, PathClass, classify};
use notify::{Config, EventKindMask, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
   collections::{BTreeMap, BTreeSet},
   path::{Path, PathBuf},
   sync::{Arc, Mutex, MutexGuard, Weak, mpsc},
   time::Duration,
};
pub use types::*;

#[derive(Debug, Clone)]
pub struct WatcherConfig {
   /// A window closes once events have been quiet this long.
   pub quiet: Duration,
   /// A window never stays open longer than this, so a constant trickle still gets delivered.
   pub max_latency: Duration,
   /// Distinct raw paths kept per window before the window turns into a rescan.
   pub max_pending_paths: usize,
   /// Changes listed per batch before the batch turns into a rescan.
   pub max_changes: usize,
}

impl Default for WatcherConfig {
   fn default() -> Self {
      Self {
         quiet: Duration::from_millis(150),
         max_latency: Duration::from_millis(500),
         max_pending_paths: 20_000,
         max_changes: 2_000,
      }
   }
}

/// inotify cannot watch a tree, so a "recursive" watch there is one watch per directory,
/// node_modules and target included. On Linux the watcher registers non-recursive watches for
/// the directories the ignore rules keep instead. FSEvents and ReadDirectoryChangesW watch a
/// tree with a single stream.
const PER_DIRECTORY_WATCHES: bool = cfg!(target_os = "linux");

struct RootEntry {
   canonical: PathBuf,
   subscribers: BTreeSet<Subscriber>,
   rules: IgnoreRules,
   /// OS-level watches registered for this root. Empty while an enclosing root covers it.
   os_watches: Vec<PathBuf>,
}

#[derive(Default)]
struct State {
   watcher: Option<RecommendedWatcher>,
   roots: BTreeMap<PathBuf, RootEntry>,
}

struct Inner {
   sink: Arc<dyn WorkspaceChangeSink>,
   config: WatcherConfig,
   state: Mutex<State>,
}

impl Inner {
   fn state(&self) -> MutexGuard<'_, State> {
      self
         .state
         .lock()
         .unwrap_or_else(|poisoned| poisoned.into_inner())
   }
}

pub struct FileWatcher {
   inner: Arc<Inner>,
}

impl FileWatcher {
   pub fn new(sink: Arc<dyn WorkspaceChangeSink>) -> Self {
      Self::with_config(sink, WatcherConfig::default())
   }

   pub fn with_config(sink: Arc<dyn WorkspaceChangeSink>, config: WatcherConfig) -> Self {
      Self {
         inner: Arc::new(Inner {
            sink,
            config,
            state: Mutex::new(State::default()),
         }),
      }
   }

   /// Starts delivering batches for `root` to `subscriber`. Watching a root that is already
   /// watched only adds the subscriber.
   pub fn watch_root(&self, root: impl AsRef<Path>, subscriber: Subscriber) -> Result<()> {
      let root = root.as_ref();
      if !root.is_dir() {
         bail!("Not a directory: {}", root.display());
      }

      let mut state = self.inner.state();
      if let Some(entry) = state.roots.get_mut(root) {
         entry.subscribers.insert(subscriber);
         return Ok(());
      }

      if state.watcher.is_none() {
         state.watcher = Some(self.spawn_watcher()?);
      }

      let canonical = dunce::canonicalize(root)
         .with_context(|| format!("Resolving watched root {}", root.display()))?;
      state.roots.insert(
         root.to_path_buf(),
         RootEntry {
            rules: IgnoreRules::new(&canonical),
            canonical,
            subscribers: BTreeSet::from([subscriber]),
            os_watches: Vec::new(),
         },
      );
      reconcile_os_watches(&mut state);
      log::info!("[FileWatcher] Watching {}", root.display());
      Ok(())
   }

   /// Stops delivering batches for `root` to `subscriber`; the root is unwatched once nobody is
   /// left. Returns whether the subscriber was registered.
   pub fn unwatch_root(&self, root: impl AsRef<Path>, subscriber: &Subscriber) -> bool {
      let mut state = self.inner.state();
      let root = root.as_ref();
      let Some(entry) = state.roots.get_mut(root) else {
         return false;
      };
      let removed = entry.subscribers.remove(subscriber);
      if entry.subscribers.is_empty() {
         remove_root(&mut state, root);
      }
      removed
   }

   /// Drops every subscription `subscriber` holds, e.g. when its window closes.
   pub fn forget_subscriber(&self, subscriber: &Subscriber) {
      let mut state = self.inner.state();
      let emptied: Vec<PathBuf> = state
         .roots
         .iter_mut()
         .filter_map(|(root, entry)| {
            entry.subscribers.remove(subscriber);
            entry.subscribers.is_empty().then(|| root.clone())
         })
         .collect();
      for root in emptied {
         remove_root(&mut state, &root);
      }
   }

   pub fn watched_roots(&self) -> Vec<PathBuf> {
      self.inner.state().roots.keys().cloned().collect()
   }

   /// The paths registered with the OS, for diagnostics and tests.
   pub fn os_watch_count(&self) -> usize {
      self
         .inner
         .state()
         .roots
         .values()
         .map(|entry| entry.os_watches.len())
         .sum()
   }

   fn spawn_watcher(&self) -> Result<RecommendedWatcher> {
      let (sender, receiver) = mpsc::channel();
      let watcher = RecommendedWatcher::new(
         sender,
         Config::default()
            .with_follow_symlinks(false)
            .with_event_kinds(EventKindMask::CORE),
      )
      .context("Creating the file watcher")?;

      let inner = Arc::downgrade(&self.inner);
      let config = self.inner.config.clone();
      std::thread::Builder::new()
         .name("athas-file-watcher".into())
         .spawn(move || run_event_loop(receiver, inner, config))
         .context("Starting the file watcher thread")?;
      Ok(watcher)
   }
}

fn run_event_loop(
   receiver: mpsc::Receiver<notify::Result<notify::Event>>,
   inner: Weak<Inner>,
   config: WatcherConfig,
) {
   while let Some(pending) = collect_window(
      &receiver,
      config.quiet,
      config.max_latency,
      config.max_pending_paths,
   ) {
      let Some(inner) = inner.upgrade() else {
         break;
      };
      deliver_window(&inner, &pending);
   }
   log::debug!("[FileWatcher] Event loop stopped");
}

fn deliver_window(inner: &Inner, pending: &PendingEvents) {
   if pending.is_empty() {
      return;
   }

   let max_changes = inner.config.max_changes;
   let deliveries: Vec<(WorkspaceFileChanges, Vec<Subscriber>)> = {
      let mut state = inner.state();
      let mut deliveries = Vec::new();
      let mut created_dirs = Vec::new();

      for (root, entry) in state.roots.iter_mut() {
         if !touches_root(pending, root, &entry.canonical) {
            continue;
         }
         let batch = build_batch(
            pending,
            root,
            &entry.canonical,
            &mut entry.rules,
            max_changes,
         );
         if PER_DIRECTORY_WATCHES && !entry.os_watches.is_empty() {
            created_dirs.extend(
               batch
                  .changes
                  .iter()
                  .filter(|change| change.is_dir && change.kind == WorkspaceFileChangeKind::Created)
                  .map(|change| (root.clone(), PathBuf::from(&change.path))),
            );
         }
         if !batch.is_empty() {
            deliveries.push((batch, entry.subscribers.iter().cloned().collect()));
         }
      }

      for (root, directory) in created_dirs {
         watch_new_directory(&mut state, &root, &directory);
      }
      deliveries
   };

   for (batch, subscribers) in deliveries {
      log::debug!(
         "[FileWatcher] {} changes under {} (git: {}, rescan: {})",
         batch.changes.len(),
         batch.root,
         batch.git_changed,
         batch.rescan
      );
      inner.sink.deliver(&batch, &subscribers);
   }
}

fn remove_root(state: &mut State, root: &Path) {
   let Some(entry) = state.roots.remove(root) else {
      return;
   };
   if let Some(watcher) = state.watcher.as_mut() {
      for path in &entry.os_watches {
         let _ = watcher.unwatch(path);
      }
   }
   reconcile_os_watches(state);
   log::info!("[FileWatcher] Stopped watching {}", root.display());
}

/// Gives every root that no other root encloses its own OS watch, and takes the watch away from
/// roots that became enclosed, so no part of the disk is ever watched twice.
fn reconcile_os_watches(state: &mut State) {
   let State { watcher, roots } = state;
   let Some(watcher) = watcher.as_mut() else {
      return;
   };

   let canonicals: Vec<(PathBuf, PathBuf)> = roots
      .iter()
      .map(|(root, entry)| (root.clone(), entry.canonical.clone()))
      .collect();
   let is_covered = |root: &Path, canonical: &Path| {
      canonicals.iter().any(|(other_root, other)| {
         other_root != root
            && canonical.starts_with(other)
            && (canonical != other || other_root < &root.to_path_buf())
      })
   };

   for (root, entry) in roots.iter_mut() {
      let covered = is_covered(root, &entry.canonical);
      if covered && !entry.os_watches.is_empty() {
         for path in entry.os_watches.drain(..) {
            let _ = watcher.unwatch(&path);
         }
      } else if !covered && entry.os_watches.is_empty() {
         for (path, mode) in watch_targets(&entry.canonical, &mut entry.rules) {
            match watcher.watch(&path, mode) {
               Ok(()) => entry.os_watches.push(path),
               Err(error) => {
                  log::warn!("[FileWatcher] Could not watch {}: {error}", path.display())
               }
            }
         }
      }
   }
}

/// On Linux, a directory created after the root was watched needs its own watch, and so does
/// every directory inside it when it was moved in whole.
fn watch_new_directory(state: &mut State, root: &Path, directory: &Path) {
   let State { watcher, roots } = state;
   let (Some(watcher), Some(entry)) = (watcher.as_mut(), roots.get_mut(root)) else {
      return;
   };
   let Ok(canonical_dir) = dunce::canonicalize(directory) else {
      return;
   };
   for path in worktree_directories(&entry.canonical, &canonical_dir, &mut entry.rules) {
      if entry.os_watches.contains(&path) {
         continue;
      }
      if watcher.watch(&path, RecursiveMode::NonRecursive).is_ok() {
         entry.os_watches.push(path);
      }
   }
}

fn watch_targets(canonical_root: &Path, rules: &mut IgnoreRules) -> Vec<(PathBuf, RecursiveMode)> {
   if !PER_DIRECTORY_WATCHES {
      return vec![(canonical_root.to_path_buf(), RecursiveMode::Recursive)];
   }
   per_directory_targets(canonical_root, rules)
}

fn per_directory_targets(
   canonical_root: &Path,
   rules: &mut IgnoreRules,
) -> Vec<(PathBuf, RecursiveMode)> {
   let mut targets: Vec<(PathBuf, RecursiveMode)> =
      worktree_directories(canonical_root, canonical_root, rules)
         .into_iter()
         .map(|path| (path, RecursiveMode::NonRecursive))
         .collect();

   let git_dir = canonical_root.join(".git");
   if git_dir.is_dir() {
      targets.push((git_dir.clone(), RecursiveMode::NonRecursive));
      let logs = git_dir.join("logs");
      if logs.is_dir() {
         targets.push((logs, RecursiveMode::NonRecursive));
      }
      let mut stack = vec![git_dir.join("refs")];
      while let Some(directory) = stack.pop() {
         let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
         };
         stack.extend(
            entries
               .flatten()
               .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
               .map(|entry| entry.path()),
         );
         targets.push((directory, RecursiveMode::NonRecursive));
      }
   }
   targets
}

/// `start` and every directory under it that the ignore rules keep.
fn worktree_directories(
   canonical_root: &Path,
   start: &Path,
   rules: &mut IgnoreRules,
) -> Vec<PathBuf> {
   let mut directories = Vec::new();
   let mut stack = vec![start.to_path_buf()];
   while let Some(directory) = stack.pop() {
      let Ok(entries) = std::fs::read_dir(&directory) else {
         continue;
      };
      for entry in entries.flatten() {
         if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
         }
         let path = entry.path();
         let Ok(relative) = path.strip_prefix(canonical_root) else {
            continue;
         };
         if classify(relative) == PathClass::Worktree && !rules.is_ignored(relative, true) {
            stack.push(path);
         }
      }
      directories.push(directory);
   }
   directories
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::time::Instant;

   #[derive(Default)]
   struct RecordingSink {
      batches: Mutex<Vec<(WorkspaceFileChanges, Vec<Subscriber>)>>,
   }

   impl RecordingSink {
      fn take(&self) -> Vec<(WorkspaceFileChanges, Vec<Subscriber>)> {
         std::mem::take(&mut *self.batches.lock().unwrap())
      }
   }

   impl WorkspaceChangeSink for RecordingSink {
      fn deliver(&self, changes: &WorkspaceFileChanges, subscribers: &[Subscriber]) {
         self
            .batches
            .lock()
            .unwrap()
            .push((changes.clone(), subscribers.to_vec()));
      }
   }

   fn window(label: &str) -> Subscriber {
      Subscriber::Window(label.to_string())
   }

   fn canonical_tempdir() -> (tempfile::TempDir, PathBuf) {
      let temp = tempfile::tempdir().unwrap();
      let root = dunce::canonicalize(temp.path()).unwrap();
      (temp, root)
   }

   fn fast_config() -> WatcherConfig {
      WatcherConfig {
         quiet: Duration::from_millis(50),
         max_latency: Duration::from_millis(200),
         ..WatcherConfig::default()
      }
   }

   #[test]
   fn rejects_missing_roots() {
      let (_temp, root) = canonical_tempdir();
      let watcher = FileWatcher::new(Arc::new(RecordingSink::default()));
      let error = watcher
         .watch_root(root.join("missing"), window("main"))
         .unwrap_err();
      assert!(error.to_string().contains("Not a directory"));
      assert!(watcher.watched_roots().is_empty());
   }

   #[test]
   fn keeps_a_root_until_its_last_subscriber_leaves() {
      let (_temp, root) = canonical_tempdir();
      let watcher = FileWatcher::new(Arc::new(RecordingSink::default()));

      watcher.watch_root(&root, window("main")).unwrap();
      watcher.watch_root(&root, window("main")).unwrap();
      watcher.watch_root(&root, Subscriber::SearchIndex).unwrap();
      assert_eq!(watcher.watched_roots(), vec![root.clone()]);

      assert!(watcher.unwatch_root(&root, &window("main")));
      assert!(!watcher.unwatch_root(&root, &window("main")));
      assert_eq!(watcher.watched_roots(), vec![root.clone()]);

      watcher.forget_subscriber(&Subscriber::SearchIndex);
      assert!(watcher.watched_roots().is_empty());
      assert_eq!(watcher.os_watch_count(), 0);
   }

   #[test]
   fn nested_roots_share_the_enclosing_watch() {
      if PER_DIRECTORY_WATCHES {
         return;
      }
      let (_temp, root) = canonical_tempdir();
      let nested = root.join("packages/app");
      std::fs::create_dir_all(&nested).unwrap();
      let watcher = FileWatcher::new(Arc::new(RecordingSink::default()));

      watcher
         .watch_root(&nested, Subscriber::SearchIndex)
         .unwrap();
      assert_eq!(watcher.os_watch_count(), 1);
      watcher.watch_root(&root, window("main")).unwrap();
      assert_eq!(
         watcher.os_watch_count(),
         1,
         "the outer root replaces the inner watch"
      );

      watcher.unwatch_root(&root, &window("main"));
      assert_eq!(
         watcher.os_watch_count(),
         1,
         "the inner root gets its watch back"
      );
   }

   #[test]
   fn per_directory_targets_skip_ignored_trees_but_keep_git_state() {
      let (_temp, root) = canonical_tempdir();
      for dir in [
         "src/nested",
         "node_modules/react",
         "coverage/html",
         ".git/objects/ab",
         ".git/refs/heads/feature",
         ".git/logs",
      ] {
         std::fs::create_dir_all(root.join(dir)).unwrap();
      }
      std::fs::write(root.join(".gitignore"), "coverage/\n").unwrap();

      let targets: BTreeSet<PathBuf> = per_directory_targets(&root, &mut IgnoreRules::new(&root))
         .into_iter()
         .map(|(path, mode)| {
            assert_eq!(mode, RecursiveMode::NonRecursive);
            path.strip_prefix(&root).unwrap().to_path_buf()
         })
         .collect();

      let expected: BTreeSet<PathBuf> = [
         "",
         "src",
         "src/nested",
         ".git",
         ".git/logs",
         ".git/refs",
         ".git/refs/heads",
         ".git/refs/heads/feature",
      ]
      .into_iter()
      .map(PathBuf::from)
      .collect();
      assert_eq!(targets, expected);
   }

   #[test]
   fn delivers_one_filtered_batch_per_root_to_its_subscribers() {
      let (_temp, root) = canonical_tempdir();
      let other = root.join("other");
      let workspace = root.join("workspace");
      std::fs::create_dir_all(workspace.join("src")).unwrap();
      std::fs::create_dir_all(workspace.join("node_modules/pkg")).unwrap();
      std::fs::create_dir_all(workspace.join(".git/refs/heads")).unwrap();
      std::fs::create_dir_all(&other).unwrap();
      std::fs::write(workspace.join(".gitignore"), "*.log\n").unwrap();

      let sink = Arc::new(RecordingSink::default());
      let watcher = FileWatcher::with_config(sink.clone(), fast_config());
      watcher.watch_root(&workspace, window("main")).unwrap();
      watcher.watch_root(&other, window("second")).unwrap();
      // FSEvents can replay a few events from just before the stream started.
      std::thread::sleep(Duration::from_millis(300));
      sink.take();

      let first = workspace.join("src/a.rs");
      let second = workspace.join("src/b.rs");
      std::fs::write(&first, "a").unwrap();
      std::fs::write(&second, "b").unwrap();
      std::fs::write(workspace.join("debug.log"), "noise").unwrap();
      std::fs::write(workspace.join("node_modules/pkg/index.js"), "noise").unwrap();
      std::fs::write(workspace.join(".git/refs/heads/main"), "0000").unwrap();

      let expected: BTreeSet<String> = [&first, &second]
         .iter()
         .map(|path| path.to_string_lossy().into_owned())
         .collect();
      let deadline = Instant::now() + Duration::from_secs(15);
      let mut changed = BTreeSet::new();
      let mut git_changed = false;
      let mut batches = Vec::new();
      while Instant::now() < deadline && !(expected.is_subset(&changed) && git_changed) {
         std::thread::sleep(Duration::from_millis(50));
         for (batch, subscribers) in sink.take() {
            assert_eq!(batch.root, workspace.to_string_lossy());
            assert_eq!(subscribers, vec![window("main")]);
            git_changed |= batch.git_changed;
            changed.extend(batch.changes.iter().map(|change| change.path.clone()));
            batches.push(batch);
         }
      }

      assert!(expected.is_subset(&changed), "batches: {batches:?}");
      assert!(
         changed
            .iter()
            .all(|path| !path.contains("node_modules") && !path.ends_with(".log")),
         "ignored paths stay out: {batches:?}"
      );
      assert!(git_changed, "batches: {batches:?}");
      assert!(
         batches.len() <= 3,
         "writes in one burst arrive in few batches: {batches:?}"
      );
   }
}
