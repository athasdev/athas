//! Everything the tree asks of the disk, behind one trait, so a remote (web) backend can take the
//! place of the native one. Calls block; the view runs them on the background executor.

use std::{
    any::Any,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Result;

/// One entry of a directory listing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DirEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    /// Symlinks are listed as files, as Athas lists them, whatever they point at.
    pub is_symlink: bool,
}

/// What changed on disk during one debounce window.
#[derive(Clone, Debug, Default)]
pub struct Changes {
    pub paths: Vec<PathBuf>,
    /// Events were lost: re-read everything that is loaded.
    pub rescan: bool,
}

pub type ChangeCallback = Box<dyn Fn(Changes) + Send + Sync>;

pub trait Fs: Send + Sync {
    fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>>;
    fn read_to_string(&self, path: &Path) -> Result<String>;
    fn is_dir(&self, path: &Path) -> bool;
    fn exists(&self, path: &Path) -> bool;
    /// Creates an empty file; fails when something is already there.
    fn create_file(&self, path: &Path) -> Result<()>;
    fn create_dir(&self, path: &Path) -> Result<()>;
    /// Writes `contents` to a file, creating it when missing.
    fn write(&self, path: &Path, _contents: &str) -> Result<()> {
        anyhow::bail!("{} cannot be written here", path.display())
    }
    /// Renames within a folder; the target must not exist (a case-only rename may).
    fn rename(&self, from: &Path, to: &Path) -> Result<()>;
    /// Moves to a new, not yet existing path, across filesystems if it has to.
    fn move_path(&self, from: &Path, to: &Path) -> Result<()>;
    fn copy(&self, from: &Path, to: &Path) -> Result<()>;
    fn trash(&self, path: &Path) -> Result<()>;
    /// Moves to the Trash and returns where the item landed when the platform says (macOS), so
    /// Undo can put it back.
    fn trash_with_location(&self, path: &Path) -> Result<Option<PathBuf>> {
        self.trash(path).map(|()| None)
    }
    /// Puts an item trashed from `original` back: from `trashed` when known, else the newest
    /// item the Trash holds from that path. Fails when something already sits at `original`.
    fn restore_from_trash(&self, original: &Path, _trashed: Option<&Path>) -> Result<()> {
        anyhow::bail!("{} cannot be put back automatically; restore it from the Trash", original.display())
    }
    fn remove(&self, path: &Path) -> Result<()>;
    /// The size of a file in bytes.
    fn file_size(&self, _path: &Path) -> Result<u64> {
        anyhow::bail!("file sizes are unavailable here")
    }
    /// The bytes of every file under a folder, symlinks not followed.
    fn directory_size(&self, _path: &Path) -> Result<u64> {
        anyhow::bail!("folder sizes are unavailable here")
    }
    /// Where a symlink points, relative to `root` when inside it; `None` for a broken link or a
    /// backend that cannot tell.
    fn symlink_target(&self, _path: &Path, _root: &Path) -> Option<String> {
        None
    }
    /// Watches `root` until the returned guard is dropped.
    ///
    /// Setting a watch up reads the tree on Linux (one watch per directory), so callers run this
    /// off the main thread; the guard is `Send` so it can come back from there.
    fn watch(&self, root: &Path, on_change: ChangeCallback) -> Result<Box<dyn Any + Send>>;
}

/// The local disk.
pub fn local() -> Arc<dyn Fs> {
    #[cfg(not(target_family = "wasm"))]
    {
        Arc::new(native::NativeFs)
    }
    #[cfg(target_family = "wasm")]
    {
        Arc::new(unsupported::Unsupported)
    }
}

#[cfg(not(target_family = "wasm"))]
mod native {
    use super::*;
    use anyhow::{Context as _, anyhow, bail};
    use athas_project::{
        FileWatcher, Subscriber, WorkspaceChangeSink, WorkspaceFileChanges, local_fs,
    };
    use std::fs;

    pub struct NativeFs;

    struct Sink(ChangeCallback);

    impl WorkspaceChangeSink for Sink {
        fn deliver(&self, changes: &WorkspaceFileChanges, _: &[Subscriber]) {
            (self.0)(Changes {
                paths: changes.changes.iter().map(|change| PathBuf::from(&change.path)).collect(),
                rescan: changes.rescan,
            });
        }
    }

    impl Fs for NativeFs {
        fn read_dir(&self, path: &Path) -> Result<Vec<DirEntry>> {
            let mut entries = Vec::new();
            for entry in fs::read_dir(path).with_context(|| format!("reading {}", path.display()))? {
                let Ok(entry) = entry else { continue };
                let Ok(file_type) = entry.file_type() else { continue };
                entries.push(DirEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: entry.path(),
                    is_dir: file_type.is_dir(),
                    is_symlink: file_type.is_symlink(),
                });
            }
            Ok(entries)
        }

        fn read_to_string(&self, path: &Path) -> Result<String> {
            Ok(fs::read_to_string(path)?)
        }

        fn is_dir(&self, path: &Path) -> bool {
            path.is_dir()
        }

        fn exists(&self, path: &Path) -> bool {
            fs::symlink_metadata(path).is_ok()
        }

        fn write(&self, path: &Path, contents: &str) -> Result<()> {
            fs::write(path, contents).with_context(|| format!("writing {}", path.display()))
        }

        fn create_file(&self, path: &Path) -> Result<()> {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .with_context(|| format!("creating {}", path.display()))?;
            Ok(())
        }

        fn create_dir(&self, path: &Path) -> Result<()> {
            if self.exists(path) {
                bail!("{} already exists", path.display());
            }
            fs::create_dir_all(path).with_context(|| format!("creating {}", path.display()))
        }

        fn rename(&self, from: &Path, to: &Path) -> Result<()> {
            local_fs::rename_path(from, to).map_err(|error| anyhow!(error))
        }

        fn move_path(&self, from: &Path, to: &Path) -> Result<()> {
            local_fs::move_path(from, to).map_err(|error| anyhow!(error))
        }

        fn copy(&self, from: &Path, to: &Path) -> Result<()> {
            if self.exists(to) {
                bail!("{} already exists", to.display());
            }
            if from.is_dir() {
                local_fs::copy_dir_all(from, to).map_err(|error| anyhow!(error))
            } else {
                fs::copy(from, to).map(|_| ()).with_context(|| format!("copying {}", from.display()))
            }
        }

        fn trash(&self, path: &Path) -> Result<()> {
            trash::delete(path).with_context(|| format!("moving {} to the trash", path.display()))
        }

        fn trash_with_location(&self, path: &Path) -> Result<Option<PathBuf>> {
            if fs::symlink_metadata(path).is_err() {
                bail!("{} no longer exists", path.display());
            }
            trash_returning_location(path)
        }

        fn restore_from_trash(&self, original: &Path, trashed: Option<&Path>) -> Result<()> {
            if fs::symlink_metadata(original).is_ok() {
                bail!("Cannot put back {}: an item with that name already exists", original.display());
            }
            match trashed {
                Some(trashed) => {
                    fs::rename(trashed, original).with_context(|| format!("Failed to put back {}", original.display()))
                }
                None => restore_latest(original),
            }
        }

        fn remove(&self, path: &Path) -> Result<()> {
            let metadata = fs::symlink_metadata(path)?;
            if metadata.is_dir() {
                local_fs::remove_dir_all(path).map_err(|error| anyhow!(error))
            } else {
                fs::remove_file(path).with_context(|| format!("deleting {}", path.display()))
            }
        }

        fn file_size(&self, path: &Path) -> Result<u64> {
            Ok(fs::metadata(path).with_context(|| format!("reading {}", path.display()))?.len())
        }

        fn directory_size(&self, path: &Path) -> Result<u64> {
            local_fs::directory_size(path).map_err(|error| anyhow!(error))
        }

        fn symlink_target(&self, path: &Path, root: &Path) -> Option<String> {
            local_fs::symlink_info(path, Some(root.to_string_lossy().into_owned())).ok()?.target
        }

        fn watch(&self, root: &Path, on_change: ChangeCallback) -> Result<Box<dyn Any + Send>> {
            let watcher = FileWatcher::new(Arc::new(Sink(on_change)));
            watcher.watch_root(root, Subscriber::Window("file-tree".into()))?;
            Ok(Box::new(watcher))
        }
    }

    #[cfg(target_os = "macos")]
    fn trash_returning_location(path: &Path) -> Result<Option<PathBuf>> {
        use objc2::rc::Retained;
        use objc2_foundation::{NSFileManager, NSString, NSURL};

        let Some(path_string) = path.to_str() else {
            // Names that are not UTF-8 still go to the Trash, without a record for Undo.
            return trash::delete(path).map(|()| None).with_context(|| format!("Failed to move {} to the Trash", path.display()));
        };
        let url = NSURL::fileURLWithPath(&NSString::from_str(path_string));
        let mut resulting: Option<Retained<NSURL>> = None;
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, Some(&mut resulting))
            .map_err(|error| anyhow!("Failed to move {} to the Trash: {}", path.display(), error.localizedDescription()))?;
        Ok(resulting.and_then(|url| url.path()).map(|path| PathBuf::from(path.to_string())))
    }

    #[cfg(not(target_os = "macos"))]
    fn trash_returning_location(path: &Path) -> Result<Option<PathBuf>> {
        trash::delete(path).map(|()| None).with_context(|| format!("Failed to move {} to the Trash", path.display()))
    }

    #[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))))]
    fn restore_latest(original: &Path) -> Result<()> {
        let latest = trash::os_limited::list()
            .context("Failed to read the Trash")?
            .into_iter()
            .filter(|item| item.original_path() == original)
            .max_by_key(|item| item.time_deleted)
            .ok_or_else(|| anyhow!("{} is no longer in the Trash", original.display()))?;
        trash::os_limited::restore_all([latest]).with_context(|| format!("Failed to put back {}", original.display()))
    }

    #[cfg(not(any(target_os = "windows", all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android")))))]
    fn restore_latest(original: &Path) -> Result<()> {
        bail!("{} cannot be put back automatically; restore it from the Trash", original.display())
    }
}

#[cfg(target_family = "wasm")]
mod unsupported {
    use super::*;
    use anyhow::bail;

    /// Stands in until the web build has a remote backend.
    pub struct Unsupported;

    impl Fs for Unsupported {
        fn read_dir(&self, _: &Path) -> Result<Vec<DirEntry>> {
            bail!("no file system in this build")
        }
        fn read_to_string(&self, _: &Path) -> Result<String> {
            bail!("no file system in this build")
        }
        fn is_dir(&self, _: &Path) -> bool {
            false
        }
        fn exists(&self, _: &Path) -> bool {
            false
        }
        fn create_file(&self, _: &Path) -> Result<()> {
            bail!("no file system in this build")
        }
        fn create_dir(&self, _: &Path) -> Result<()> {
            bail!("no file system in this build")
        }
        fn rename(&self, _: &Path, _: &Path) -> Result<()> {
            bail!("no file system in this build")
        }
        fn move_path(&self, _: &Path, _: &Path) -> Result<()> {
            bail!("no file system in this build")
        }
        fn copy(&self, _: &Path, _: &Path) -> Result<()> {
            bail!("no file system in this build")
        }
        fn trash(&self, _: &Path) -> Result<()> {
            bail!("no file system in this build")
        }
        fn remove(&self, _: &Path) -> Result<()> {
            bail!("no file system in this build")
        }
        fn watch(&self, _: &Path, _: ChangeCallback) -> Result<Box<dyn Any + Send>> {
            bail!("no file system in this build")
        }
    }
}

#[cfg(all(test, not(target_family = "wasm")))]
mod tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn native_operations() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let fs = local();
        fs.create_file(&root.join("a.txt")).unwrap();
        assert!(fs.create_file(&root.join("a.txt")).is_err());
        fs.create_dir(&root.join("sub")).unwrap();
        fs.rename(&root.join("a.txt"), &root.join("b.txt")).unwrap();
        fs.copy(&root.join("b.txt"), &root.join("sub/c.txt")).unwrap();
        fs.copy(&root.join("sub"), &root.join("sub2")).unwrap();
        fs.move_path(&root.join("sub2"), &root.join("sub/inner")).unwrap();

        let mut names: Vec<_> = fs.read_dir(root).unwrap().into_iter().map(|entry| (entry.name, entry.is_dir)).collect();
        names.sort();
        assert_eq!(names, [("b.txt".to_string(), false), ("sub".to_string(), true)]);
        assert!(fs.exists(&root.join("sub/inner/c.txt")));

        fs.remove(&root.join("sub")).unwrap();
        fs.remove(&root.join("b.txt")).unwrap();
        assert!(fs.read_dir(root).unwrap().is_empty());
    }

    #[test]
    fn watching_reports_new_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let fs = local();
        let (sender, receiver) = mpsc::channel();
        let sender = std::sync::Mutex::new(sender);
        let _guard = fs
            .watch(&root, Box::new(move |changes| sender.lock().unwrap().send(changes).unwrap()))
            .unwrap();
        // FSEvents can start a moment after the watch is registered.
        std::thread::sleep(Duration::from_millis(200));
        fs.create_file(&root.join("new.rs")).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let changes = receiver.recv_timeout(remaining).expect("no change reported");
            if changes.rescan || changes.paths.iter().any(|path| path.ends_with("new.rs")) {
                break;
            }
        }
    }

    #[test]
    fn putting_back_a_trashed_item_from_where_it_landed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let fs = local();
        std::fs::create_dir(root.join("trash")).unwrap();
        std::fs::write(root.join("trash/a.txt"), "a").unwrap();
        fs.restore_from_trash(&root.join("a.txt"), Some(&root.join("trash/a.txt"))).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "a");

        std::fs::write(root.join("trash/a.txt"), "again").unwrap();
        let error = fs.restore_from_trash(&root.join("a.txt"), Some(&root.join("trash/a.txt"))).unwrap_err();
        assert!(error.to_string().contains("already exists"));
        assert!(fs.trash_with_location(&root.join("missing.txt")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn sizes_and_symlink_targets() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let fs = local();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("node_modules/a.js"), "12345").unwrap();
        std::fs::write(root.join("node_modules/pkg/b.js"), "123").unwrap();
        std::os::unix::fs::symlink(root.join("node_modules/a.js"), root.join("link.js")).unwrap();
        std::os::unix::fs::symlink("/elsewhere/c.js", root.join("outside.js")).unwrap();

        assert_eq!(fs.directory_size(&root.join("node_modules")).unwrap(), 8);
        assert_eq!(fs.file_size(&root.join("node_modules/a.js")).unwrap(), 5);
        assert_eq!(fs.symlink_target(&root.join("link.js"), root).as_deref(), Some("node_modules/a.js"));
        assert_eq!(fs.symlink_target(&root.join("outside.js"), root).as_deref(), Some("/elsewhere/c.js"));
        assert_eq!(fs.symlink_target(&root.join("node_modules/a.js"), root), None);
    }
}
