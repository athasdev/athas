use serde::Serialize;
use std::{
   fs, io,
   io::Write,
   path::{Path, PathBuf},
   time::{SystemTime, UNIX_EPOCH},
};

/// What Claude Code reads from `~/.claude/ide/<port>.lock` to find and authenticate to the IDE.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LockFileContent {
   pub pid: u32,
   pub workspace_folders: Vec<String>,
   pub ide_name: String,
   pub transport: String,
   pub auth_token: String,
}

/// Where Claude Code looks for lock files: `$CLAUDE_CONFIG_DIR/ide`, else `~/.claude/ide`.
pub fn default_lock_dir() -> Option<PathBuf> {
   if let Some(config_dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|dir| !dir.is_empty()) {
      return Some(PathBuf::from(config_dir).join("ide"));
   }
   dirs::home_dir().map(|home| home.join(".claude").join("ide"))
}

/// A written lock file. Dropping it removes the file, so Claude stops offering a dead IDE.
#[derive(Debug)]
pub struct LockFile {
   path: PathBuf,
   content: LockFileContent,
}

impl LockFile {
   pub fn create(dir: &Path, port: u16, content: LockFileContent) -> io::Result<Self> {
      ensure_private_dir(dir)?;
      let lock = Self {
         path: dir.join(format!("{port}.lock")),
         content,
      };
      lock.write()?;
      Ok(lock)
   }

   pub fn path(&self) -> &Path {
      &self.path
   }

   pub fn content(&self) -> &LockFileContent {
      &self.content
   }

   pub fn set_workspace_folders(&mut self, folders: Vec<String>) -> io::Result<()> {
      if self.content.workspace_folders == folders {
         return Ok(());
      }
      self.content.workspace_folders = folders;
      self.write()
   }

   /// Writes through a fresh temp file opened with `create_new` and mode 0600, then renames it
   /// into place, so the token is never readable by other users and a reader never sees half a
   /// file.
   fn write(&self) -> io::Result<()> {
      let json = serde_json::to_vec(&self.content).map_err(io::Error::other)?;
      let nanos = SystemTime::now()
         .duration_since(UNIX_EPOCH)
         .map(|elapsed| elapsed.as_nanos())
         .unwrap_or_default();
      let tmp_path = self
         .path
         .with_extension(format!("lock.tmp.{}.{nanos}", std::process::id()));

      let result = (|| {
         let mut file = private_file_options().open(&tmp_path)?;
         file.write_all(&json)?;
         file.sync_all()?;
         drop(file);
         fs::rename(&tmp_path, &self.path)
      })();
      if result.is_err() {
         let _ = fs::remove_file(&tmp_path);
      }
      result
   }
}

impl Drop for LockFile {
   fn drop(&mut self) {
      if let Err(error) = fs::remove_file(&self.path)
         && error.kind() != io::ErrorKind::NotFound
      {
         log::warn!(
            "Failed to remove Claude Code lock file {}: {error}",
            self.path.display()
         );
      }
   }
}

#[cfg(unix)]
fn ensure_private_dir(dir: &Path) -> io::Result<()> {
   use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

   fs::DirBuilder::new()
      .recursive(true)
      .mode(0o700)
      .create(dir)?;
   // `mode` only applies to directories this call created; tighten one that already existed.
   fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn ensure_private_dir(dir: &Path) -> io::Result<()> {
   fs::create_dir_all(dir)
}

#[cfg(unix)]
fn private_file_options() -> fs::OpenOptions {
   use std::os::unix::fs::OpenOptionsExt;

   let mut options = fs::OpenOptions::new();
   options.write(true).create_new(true).mode(0o600);
   options
}

#[cfg(not(unix))]
fn private_file_options() -> fs::OpenOptions {
   let mut options = fs::OpenOptions::new();
   options.write(true).create_new(true);
   options
}

#[cfg(test)]
mod tests {
   use super::*;

   fn content(folders: &[&str]) -> LockFileContent {
      LockFileContent {
         pid: 42,
         workspace_folders: folders.iter().map(|folder| folder.to_string()).collect(),
         ide_name: "Athas".to_string(),
         transport: "ws".to_string(),
         auth_token: "0123456789abcdef0123456789abcdef".to_string(),
      }
   }

   fn read_json(path: &Path) -> serde_json::Value {
      serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
   }

   #[test]
   fn writes_the_fields_claude_reads() {
      let dir = tempfile::tempdir().unwrap();
      let lock_dir = dir.path().join("ide");
      let lock = LockFile::create(&lock_dir, 4321, content(&["/work/app"])).unwrap();

      assert_eq!(lock.path(), lock_dir.join("4321.lock"));
      assert_eq!(
         read_json(lock.path()),
         serde_json::json!({
            "pid": 42,
            "workspaceFolders": ["/work/app"],
            "ideName": "Athas",
            "transport": "ws",
            "authToken": "0123456789abcdef0123456789abcdef",
         })
      );
   }

   #[cfg(unix)]
   #[test]
   fn lock_dir_and_file_are_private() {
      use std::os::unix::fs::PermissionsExt;

      let dir = tempfile::tempdir().unwrap();
      let lock_dir = dir.path().join("ide");
      fs::create_dir(&lock_dir).unwrap();
      fs::set_permissions(&lock_dir, fs::Permissions::from_mode(0o755)).unwrap();

      let lock = LockFile::create(&lock_dir, 1, content(&[])).unwrap();
      let dir_mode = fs::metadata(&lock_dir).unwrap().permissions().mode() & 0o777;
      let file_mode = fs::metadata(lock.path()).unwrap().permissions().mode() & 0o777;
      assert_eq!(dir_mode, 0o700);
      assert_eq!(file_mode, 0o600);
   }

   #[test]
   fn updating_folders_rewrites_the_file_and_leaves_no_temp_files() {
      let dir = tempfile::tempdir().unwrap();
      let mut lock = LockFile::create(dir.path(), 7, content(&["/a"])).unwrap();
      lock
         .set_workspace_folders(vec!["/a".to_string(), "/b".to_string()])
         .unwrap();

      assert_eq!(
         read_json(lock.path())["workspaceFolders"],
         serde_json::json!(["/a", "/b"])
      );
      let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
      assert_eq!(entries.len(), 1);
   }

   #[test]
   fn dropping_the_lock_removes_the_file() {
      let dir = tempfile::tempdir().unwrap();
      let lock = LockFile::create(dir.path(), 9, content(&[])).unwrap();
      let path = lock.path().to_path_buf();
      assert!(path.exists());
      drop(lock);
      assert!(!path.exists());
   }
}
