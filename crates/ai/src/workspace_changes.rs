//! Finds the files a shell command changed, so the agent's commands land in the same review log
//! and checkpoints as its own file writes.
//!
//! Before the command runs, [`snapshot_workspace`] records the size and modification time of
//! every workspace file `.gitignore` does not exclude. It keeps the text of files whose earlier
//! version cannot be recovered afterwards: in a Git repository only files that differ from
//! `HEAD` (the rest are read back from that commit when they change), elsewhere every small
//! text file up to a total cap. [`diff_workspace`] walks again and reports what changed.

use crate::workspace_tools::{MAX_FILE_BYTES, display_path, walk_workspace};
use serde::Serialize;
use std::{
   collections::{HashMap, HashSet},
   fs,
   io::Read,
   path::{Path, PathBuf},
   process::{Command, Stdio},
   time::SystemTime,
};

/// Text kept from before a command in a workspace without Git, across all files.
const MAX_CAPTURED_BYTES: u64 = 32 * 1024 * 1024;
/// Changes reported for one command; a build that rewrites thousands of files is not reviewed.
const MAX_REPORTED_CHANGES: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
   len: u64,
   modified: Option<SystemTime>,
   #[cfg(unix)]
   inode: u64,
}

impl Stamp {
   fn of(path: &Path) -> Option<Self> {
      let metadata = fs::symlink_metadata(path).ok()?;
      metadata.is_file().then(|| Stamp {
         len: metadata.len(),
         modified: metadata.modified().ok(),
         #[cfg(unix)]
         inode: {
            use std::os::unix::fs::MetadataExt;
            metadata.ino()
         },
      })
   }
}

/// The Git commit the workspace's unchanged files match, and the files that differ from it.
struct GitBase {
   head: String,
   differs: HashSet<String>,
}

pub struct WorkspaceSnapshot {
   root: String,
   files: HashMap<String, Stamp>,
   captured: HashMap<String, String>,
   git: Option<GitBase>,
   truncated: bool,
}

/// One file the command changed. `previous_content` is `None` when the command created the file,
/// `content` is `None` when it deleted it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChange {
   /// The file's path as the workspace root spells it, like agent writes report it.
   pub path: String,
   pub previous_content: Option<String>,
   pub content: Option<String>,
}

/// A change that cannot be offered for review, and why.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkippedWorkspaceChange {
   pub path: String,
   pub reason: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChanges {
   pub changes: Vec<WorkspaceChange>,
   pub skipped: Vec<SkippedWorkspaceChange>,
   /// Some changes were not looked at: the workspace is too large to walk, or the command
   /// changed more files than are reported.
   pub incomplete: bool,
}

fn git_output(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
   let output = Command::new("git")
      .args(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false"])
      .args(args)
      .current_dir(root)
      .env("GIT_OPTIONAL_LOCKS", "0")
      .stdin(Stdio::null())
      .stderr(Stdio::null())
      .output()
      .ok()?;
   output.status.success().then_some(output.stdout)
}

fn nul_separated(bytes: &[u8]) -> impl Iterator<Item = String> + '_ {
   bytes
      .split(|byte| *byte == 0)
      .filter(|part| !part.is_empty())
      .map(|part| String::from_utf8_lossy(part).replace('\\', "/"))
}

fn git_base(root: &Path) -> Option<GitBase> {
   let head = String::from_utf8(git_output(root, &["rev-parse", "--verify", "-q", "HEAD"])?)
      .ok()?
      .trim()
      .to_string();
   let mut differs = HashSet::new();
   // Paths come back relative to the workspace, which may be a folder inside the repository.
   let changed = git_output(root, &["diff", "--name-only", "-z", "--relative", "HEAD"])?;
   differs.extend(nul_separated(&changed));
   let untracked = git_output(root, &["ls-files", "-z", "--others", "--exclude-standard"])?;
   differs.extend(nul_separated(&untracked));
   Some(GitBase { head, differs })
}

/// The file as text, or why it cannot be reviewed.
fn read_text(path: &Path) -> Result<String, &'static str> {
   let mut bytes = Vec::new();
   fs::File::open(path)
      .map_err(|_| "It could not be read.")?
      .take(MAX_FILE_BYTES + 1)
      .read_to_end(&mut bytes)
      .map_err(|_| "It could not be read.")?;
   text_from(bytes)
}

fn text_from(bytes: Vec<u8>) -> Result<String, &'static str> {
   if bytes.len() as u64 > MAX_FILE_BYTES {
      return Err("It is larger than 256 KiB.");
   }
   if bytes.contains(&0) {
      return Err("It is a binary file.");
   }
   String::from_utf8(bytes).map_err(|_| "It is a binary file.")
}

/// Records the workspace before a command runs.
pub fn snapshot_workspace(root: &str) -> Result<WorkspaceSnapshot, String> {
   let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
   let walk = walk_workspace(root, None, None)?;
   let git = git_base(&canonical_root);
   let mut files = HashMap::with_capacity(walk.files.len());
   let mut captured = HashMap::new();
   let mut captured_bytes = 0_u64;
   for (path, relative) in walk.files {
      let Some(stamp) = Stamp::of(&path) else {
         continue;
      };
      let keep = match &git {
         Some(git) => git.differs.contains(&relative),
         None => captured_bytes + stamp.len <= MAX_CAPTURED_BYTES,
      };
      if keep
         && stamp.len <= MAX_FILE_BYTES
         && let Ok(text) = read_text(&path)
      {
         captured_bytes += text.len() as u64;
         captured.insert(relative.clone(), text);
      }
      files.insert(relative, stamp);
   }
   Ok(WorkspaceSnapshot {
      root: root.to_string(),
      files,
      captured,
      git,
      truncated: walk.truncated,
   })
}

impl WorkspaceSnapshot {
   /// What `relative` held when the snapshot was taken, or why that is unknown.
   fn previous_content(&self, relative: &str) -> Result<String, &'static str> {
      if let Some(text) = self.captured.get(relative) {
         return Ok(text.clone());
      }
      match &self.git {
         Some(git) if !git.differs.contains(relative) => {
            let object = format!("{}:./{relative}", git.head);
            let root = fs::canonicalize(&self.root).map_err(|_| "It could not be read.")?;
            // `--filters` gives the file as checked out, line endings included.
            let bytes = git_output(&root, &["cat-file", "--filters", &object])
               .ok_or("Its earlier version could not be read from Git.")?;
            text_from(bytes)
         }
         _ => Err("Its earlier version was too large or not text."),
      }
   }
}

/// Compares the workspace with `snapshot` after the command finished.
pub fn diff_workspace(snapshot: &WorkspaceSnapshot) -> Result<WorkspaceChanges, String> {
   let walk = walk_workspace(&snapshot.root, None, None)?;
   let mut result = WorkspaceChanges {
      incomplete: snapshot.truncated || walk.truncated,
      ..WorkspaceChanges::default()
   };
   let mut seen = HashSet::with_capacity(walk.files.len());
   let mut changed: Vec<(Option<PathBuf>, String)> = Vec::new();
   for (path, relative) in walk.files {
      let stamp = Stamp::of(&path);
      if stamp.is_none() || snapshot.files.get(&relative).copied() != stamp {
         changed.push((Some(path), relative.clone()));
      }
      seen.insert(relative);
   }
   if !walk.truncated {
      let mut deleted = snapshot
         .files
         .keys()
         .filter(|relative| !seen.contains(*relative))
         .collect::<Vec<_>>();
      deleted.sort();
      changed.extend(deleted.into_iter().map(|relative| (None, relative.clone())));
   }
   for (path, relative) in changed {
      if result.changes.len() + result.skipped.len() >= MAX_REPORTED_CHANGES {
         result.incomplete = true;
         break;
      }
      let display = display_path(&snapshot.root, &relative);
      let skip = |reason: &str| SkippedWorkspaceChange {
         path: display.clone(),
         reason: reason.to_string(),
      };
      let existed = snapshot.files.contains_key(&relative);
      let previous = if existed {
         match snapshot.previous_content(&relative) {
            Ok(text) => Some(text),
            Err(reason) => {
               result.skipped.push(skip(reason));
               continue;
            }
         }
      } else {
         None
      };
      let content = match path.filter(|path| path.exists()) {
         Some(path) => match read_text(&path) {
            Ok(text) => Some(text),
            Err(reason) => {
               result.skipped.push(skip(reason));
               continue;
            }
         },
         None => None,
      };
      if previous == content {
         continue;
      }
      result.changes.push(WorkspaceChange {
         path: display,
         previous_content: previous,
         content,
      });
   }
   Ok(result)
}

#[cfg(test)]
mod tests {
   use super::*;

   fn change<'a>(changes: &'a WorkspaceChanges, name: &str) -> Option<&'a WorkspaceChange> {
      changes
         .changes
         .iter()
         .find(|change| change.path.ends_with(name))
   }

   /// Lets the modification time move on, since the edits below keep file sizes equal.
   fn pause() {
      std::thread::sleep(std::time::Duration::from_millis(20));
   }

   #[test]
   fn reports_files_a_command_changed_created_and_deleted_without_git() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join("edited.txt"), "one\n").unwrap();
      fs::write(dir.path().join("removed.txt"), "gone\n").unwrap();
      fs::write(dir.path().join("kept.txt"), "same\n").unwrap();
      fs::write(dir.path().join(".gitignore"), "ignored.txt\n").unwrap();
      let snapshot = snapshot_workspace(root).unwrap();
      pause();
      fs::write(dir.path().join("edited.txt"), "two\n").unwrap();
      fs::remove_file(dir.path().join("removed.txt")).unwrap();
      fs::write(dir.path().join("created.txt"), "new\n").unwrap();
      fs::write(dir.path().join("ignored.txt"), "build output\n").unwrap();
      fs::write(dir.path().join("kept.txt"), "same\n").unwrap();
      fs::write(dir.path().join("image.bin"), [0_u8, 1, 2]).unwrap();

      let changes = diff_workspace(&snapshot).unwrap();
      assert_eq!(
         change(&changes, "edited.txt").unwrap(),
         &WorkspaceChange {
            path: display_path(root, "edited.txt"),
            previous_content: Some("one\n".into()),
            content: Some("two\n".into()),
         }
      );
      let removed = change(&changes, "removed.txt").unwrap();
      assert_eq!(removed.previous_content.as_deref(), Some("gone\n"));
      assert_eq!(removed.content, None);
      let created = change(&changes, "created.txt").unwrap();
      assert_eq!(created.previous_content, None);
      assert_eq!(created.content.as_deref(), Some("new\n"));
      assert!(change(&changes, "ignored.txt").is_none());
      // Rewritten with the same text: nothing to review.
      assert!(change(&changes, "kept.txt").is_none());
      assert_eq!(changes.skipped.len(), 1);
      assert!(changes.skipped[0].path.ends_with("image.bin"));
      assert!(!changes.incomplete);
   }

   fn run_git(dir: &Path, args: &[&str]) {
      let status = Command::new("git")
         .args([
            "-c",
            "user.email=test@example.com",
            "-c",
            "user.name=Test",
            "-c",
            "commit.gpgsign=false",
         ])
         .args(args)
         .current_dir(dir)
         .stdout(Stdio::null())
         .stderr(Stdio::null())
         .status()
         .unwrap();
      assert!(status.success(), "git {args:?}");
   }

   #[test]
   fn reads_earlier_versions_of_unchanged_files_from_git() {
      if Command::new("git").arg("--version").output().is_err() {
         return;
      }
      let dir = tempfile::tempdir().unwrap();
      run_git(dir.path(), &["init", "-q"]);
      fs::create_dir(dir.path().join("app")).unwrap();
      fs::write(dir.path().join("app/clean.txt"), "committed\n").unwrap();
      fs::write(dir.path().join("app/dirty.txt"), "committed\n").unwrap();
      run_git(dir.path(), &["add", "."]);
      run_git(dir.path(), &["commit", "-q", "-m", "initial"]);
      fs::write(dir.path().join("app/dirty.txt"), "unsaved work\n").unwrap();
      fs::write(dir.path().join("app/untracked.txt"), "draft\n").unwrap();

      // The workspace is a folder inside the repository.
      let workspace = dir.path().join("app");
      let root = workspace.to_str().unwrap();
      let snapshot = snapshot_workspace(root).unwrap();
      assert!(snapshot.git.is_some());
      assert!(!snapshot.captured.contains_key("clean.txt"));
      pause();
      fs::write(workspace.join("clean.txt"), "changed by command\n").unwrap();
      fs::write(workspace.join("dirty.txt"), "rewritten\n").unwrap();
      fs::remove_file(workspace.join("untracked.txt")).unwrap();
      // A command that commits what it changed still shows up.
      run_git(dir.path(), &["commit", "-q", "-am", "command"]);

      let changes = diff_workspace(&snapshot).unwrap();
      assert_eq!(
         change(&changes, "clean.txt")
            .unwrap()
            .previous_content
            .as_deref(),
         Some("committed\n")
      );
      assert_eq!(
         change(&changes, "dirty.txt")
            .unwrap()
            .previous_content
            .as_deref(),
         Some("unsaved work\n")
      );
      let untracked = change(&changes, "untracked.txt").unwrap();
      assert_eq!(untracked.previous_content.as_deref(), Some("draft\n"));
      assert_eq!(untracked.content, None);
   }
}
