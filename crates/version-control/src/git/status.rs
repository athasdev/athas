use crate::git::{
   FileStatus, GitFile, GitStatus, IntoStringError, RepositoryHost, describe_failure,
   get_ahead_behind_counts,
};
use anyhow::{Context, Result};
use git2::{ErrorCode, Repository};
use std::fs;

pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
   _git_status(repo_path).into_string_error()
}

fn _git_status(repo_path: String) -> Result<GitStatus> {
   let host = RepositoryHost::detect(&repo_path);
   if host.uses_distro_git() {
      return git_status_with_cli(&host);
   }

   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let branch = current_branch_name(&repo);

   let (ahead, behind) = get_ahead_behind_counts(&repo, &branch);

   let mut status_opts = git2::StatusOptions::new();
   status_opts
      .include_untracked(true)
      .recurse_untracked_dirs(false)
      .include_ignored(false)
      .include_unmodified(false)
      .renames_head_to_index(true)
      .renames_index_to_workdir(true);

   let statuses = repo
      .statuses(Some(&mut status_opts))
      .context("Failed to get status")?;

   let mut files = Vec::new();
   for entry in statuses.iter() {
      let status_flags = entry.status();

      if status_flags == git2::Status::CURRENT {
         continue;
      }

      let path = entry.path().context("Invalid path")?.to_string();

      let has_staged = status_flags.intersects(
         git2::Status::INDEX_NEW
            | git2::Status::INDEX_MODIFIED
            | git2::Status::INDEX_DELETED
            | git2::Status::INDEX_RENAMED
            | git2::Status::INDEX_TYPECHANGE,
      );

      let has_unstaged = status_flags.intersects(
         git2::Status::WT_NEW
            | git2::Status::WT_MODIFIED
            | git2::Status::WT_DELETED
            | git2::Status::WT_RENAMED
            | git2::Status::WT_TYPECHANGE,
      );

      if has_staged {
         let status = if status_flags.contains(git2::Status::INDEX_NEW) {
            FileStatus::Added
         } else if status_flags.contains(git2::Status::INDEX_DELETED) {
            FileStatus::Deleted
         } else if status_flags.contains(git2::Status::INDEX_RENAMED) {
            FileStatus::Renamed
         } else {
            FileStatus::Modified
         };

         files.push(GitFile {
            path: path.clone(),
            status,
            staged: true,
         });
      }

      if has_unstaged {
         let status = if status_flags.contains(git2::Status::WT_NEW) && !has_staged {
            FileStatus::Untracked
         } else if status_flags.contains(git2::Status::WT_DELETED) {
            FileStatus::Deleted
         } else if status_flags.contains(git2::Status::WT_RENAMED) {
            FileStatus::Renamed
         } else if status_flags.contains(git2::Status::WT_NEW) {
            FileStatus::Added
         } else {
            FileStatus::Modified
         };

         files.push(GitFile {
            path,
            status,
            staged: false,
         });
      }
   }

   Ok(GitStatus {
      branch,
      ahead,
      behind,
      files,
   })
}

fn current_branch_name(repo: &Repository) -> String {
   match repo.head() {
      Ok(head) => {
         if head.is_branch() {
            head
               .shorthand()
               .map(|name| name.to_string())
               .unwrap_or_else(|| "unknown".to_string())
         } else {
            "HEAD".to_string()
         }
      }
      Err(error) if error.code() == ErrorCode::UnbornBranch => unborn_head_branch_name(repo),
      Err(_) => "unknown".to_string(),
   }
}

fn unborn_head_branch_name(repo: &Repository) -> String {
   fs::read_to_string(repo.path().join("HEAD"))
      .ok()
      .and_then(|head| {
         head
            .trim()
            .strip_prefix("ref: refs/heads/")
            .map(|name| name.to_string())
      })
      .or_else(|| {
         repo
            .config()
            .ok()
            .and_then(|config| config.get_string("init.defaultBranch").ok())
      })
      .unwrap_or_else(|| "main".to_string())
}

fn git_status_with_cli(host: &RepositoryHost) -> Result<GitStatus> {
   let output = host
      .git()
      .args([
         "status",
         "--porcelain=v2",
         "--branch",
         "-z",
         "--untracked-files=normal",
      ])
      .run("status")?;

   parse_porcelain_status(&output.stdout)
}

pub(crate) fn has_unstaged_changes_with_cli(host: &RepositoryHost) -> Result<bool> {
   let status = git_status_with_cli(host)?;
   Ok(status.files.iter().any(|file| !file.staged))
}

/// Parses `git status --porcelain=v2 --branch -z` output into the same shape
/// the libgit2 path produces.
pub(crate) fn parse_porcelain_status(stdout: &[u8]) -> Result<GitStatus> {
   let mut status = GitStatus {
      branch: "unknown".to_string(),
      ahead: 0,
      behind: 0,
      files: Vec::new(),
   };
   let mut records = stdout
      .split(|byte| *byte == 0)
      .filter(|record| !record.is_empty())
      .map(String::from_utf8_lossy);

   while let Some(record) = records.next() {
      if let Some(header) = record.strip_prefix("# ") {
         parse_status_header(header, &mut status);
      } else if let Some(entry) = record.strip_prefix("1 ") {
         let mut fields = entry.splitn(8, ' ');
         let codes = fields.next().unwrap_or_default();
         let Some(path) = fields.nth(6) else {
            continue;
         };
         push_status_entry(&mut status.files, codes, path);
      } else if let Some(entry) = record.strip_prefix("2 ") {
         let mut fields = entry.splitn(9, ' ');
         let codes = fields.next().unwrap_or_default();
         let path = fields.nth(7);
         // The original path follows as its own record.
         records.next();
         if let Some(path) = path {
            push_status_entry(&mut status.files, codes, path);
         }
      } else if let Some(entry) = record.strip_prefix("u ") {
         if let Some(path) = entry.splitn(10, ' ').nth(9) {
            status.files.push(GitFile {
               path: path.to_string(),
               status: FileStatus::Modified,
               staged: false,
            });
         }
      } else if let Some(path) = record.strip_prefix("? ") {
         status.files.push(GitFile {
            path: path.to_string(),
            status: FileStatus::Untracked,
            staged: false,
         });
      }
   }

   Ok(status)
}

fn parse_status_header(header: &str, status: &mut GitStatus) {
   if let Some(head) = header.strip_prefix("branch.head ") {
      status.branch = if head == "(detached)" {
         "HEAD".to_string()
      } else {
         head.to_string()
      };
   } else if let Some(counts) = header.strip_prefix("branch.ab ") {
      for count in counts.split_whitespace() {
         if let Some(ahead) = count.strip_prefix('+') {
            status.ahead = ahead.parse().unwrap_or(0);
         } else if let Some(behind) = count.strip_prefix('-') {
            status.behind = behind.parse().unwrap_or(0);
         }
      }
   }
}

fn push_status_entry(files: &mut Vec<GitFile>, codes: &str, path: &str) {
   let mut codes = codes.chars();
   let index_code = codes.next().unwrap_or('.');
   let worktree_code = codes.next().unwrap_or('.');

   let staged = match index_code {
      'A' | 'C' => Some(FileStatus::Added),
      'D' => Some(FileStatus::Deleted),
      'R' => Some(FileStatus::Renamed),
      'M' | 'T' | 'U' => Some(FileStatus::Modified),
      _ => None,
   };
   if let Some(status) = staged {
      files.push(GitFile {
         path: path.to_string(),
         status,
         staged: true,
      });
   }

   let unstaged = match worktree_code {
      'A' => Some(FileStatus::Added),
      'D' => Some(FileStatus::Deleted),
      'R' => Some(FileStatus::Renamed),
      'M' | 'T' | 'U' => Some(FileStatus::Modified),
      _ => None,
   };
   if let Some(status) = unstaged {
      files.push(GitFile {
         path: path.to_string(),
         status,
         staged: false,
      });
   }
}

pub fn git_init(repo_path: String) -> Result<(), String> {
   _git_init(repo_path).into_string_error()
}

fn _git_init(repo_path: String) -> Result<()> {
   let host = RepositoryHost::detect(&repo_path);
   if host.uses_distro_git() {
      host.git().args(["init", "-q"]).run("init")?;
      return Ok(());
   }

   let repo = Repository::init(&repo_path).context("Failed to initialize repository")?;
   if host.is_wsl() {
      apply_linux_repository_defaults(&repo)?;
   }
   Ok(())
}

/// libgit2 writes Windows filesystem assumptions into a new repository's
/// config. A repository that lives inside a WSL distribution is used by Linux
/// git, so it gets the Linux defaults back.
fn apply_linux_repository_defaults(repo: &Repository) -> Result<()> {
   let mut config = repo.config().context("Failed to open repository config")?;
   config
      .set_bool("core.filemode", true)
      .context("Failed to set core.filemode")?;
   for key in ["core.symlinks", "core.ignorecase"] {
      if let Err(error) = config.remove(key)
         && error.code() != ErrorCode::NotFound
      {
         return Err(error).with_context(|| format!("Failed to reset {key}"));
      }
   }
   Ok(())
}

pub fn git_discover_repo(path: String) -> Result<Option<String>, String> {
   let host = RepositoryHost::detect(&path);
   if host.uses_distro_git()
      && let Some(discovered) = discover_repo_with_cli(&host)
   {
      return Ok(discovered);
   }

   let discovered = match Repository::discover(&path) {
      Ok(repo) => {
         if let Some(workdir) = repo.workdir() {
            Some(workdir.to_string_lossy().to_string())
         } else {
            repo
               .path()
               .parent()
               .map(|parent| parent.to_string_lossy().to_string())
         }
      }
      Err(_) => None,
   };

   Ok(discovered)
}

/// Asks the distribution's git for the working tree root. Returns `None` when
/// git could not answer, so the caller can fall back to libgit2. The result is
/// a Linux path.
fn discover_repo_with_cli(host: &RepositoryHost) -> Option<Option<String>> {
   let directory = if host.native_path().is_file() {
      host.parent()
   } else {
      host.clone()
   };
   let output = directory
      .git()
      .args(["rev-parse", "--show-toplevel"])
      .output()
      .ok()?;

   if output.status.success() {
      let toplevel = String::from_utf8_lossy(&output.stdout).trim().to_string();
      return Some((!toplevel.is_empty()).then_some(toplevel));
   }

   let details = describe_failure(&output).to_ascii_lowercase();
   if details.contains("not a git repository") || details.contains("cannot change to") {
      return Some(None);
   }

   None
}

#[cfg(test)]
mod tests {
   use super::*;
   use git2::{IndexAddOption, Signature};
   use std::path::Path;

   #[test]
   fn current_branch_name_uses_unborn_head_name_for_empty_repositories() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");

      let branch = current_branch_name(&repo);

      assert_ne!(branch, "unknown");
      assert!(!branch.is_empty());
   }

   #[test]
   fn porcelain_status_matches_the_libgit2_shape() {
      let output = [
         "# branch.oid 1234567890abcdef",
         "# branch.head feature/wsl",
         "# branch.upstream origin/feature/wsl",
         "# branch.ab +2 -1",
         "1 M. N... 100644 100644 100644 abc def staged only.rs",
         "1 .M N... 100644 100644 100644 abc def unstaged.rs",
         "1 MM N... 100644 100644 100644 abc def both.rs",
         "1 A. N... 000000 100644 100644 000 def added.rs",
         "1 .D N... 100644 100644 000000 abc abc deleted.rs",
         "2 R. N... 100644 100644 100644 abc abc R100 new name.rs",
         "old name.rs",
         "u UU N... 100644 100644 100644 100644 a b c conflict.rs",
         "? untracked dir/",
         "! ignored.log",
      ]
      .join("\0");

      let status = parse_porcelain_status(output.as_bytes()).expect("parse");

      assert_eq!(status.branch, "feature/wsl");
      assert_eq!((status.ahead, status.behind), (2, 1));
      let files: Vec<(String, FileStatus, bool)> = status
         .files
         .into_iter()
         .map(|file| (file.path, file.status, file.staged))
         .collect();
      assert_eq!(
         files,
         vec![
            ("staged only.rs".to_string(), FileStatus::Modified, true),
            ("unstaged.rs".to_string(), FileStatus::Modified, false),
            ("both.rs".to_string(), FileStatus::Modified, true),
            ("both.rs".to_string(), FileStatus::Modified, false),
            ("added.rs".to_string(), FileStatus::Added, true),
            ("deleted.rs".to_string(), FileStatus::Deleted, false),
            ("new name.rs".to_string(), FileStatus::Renamed, true),
            ("conflict.rs".to_string(), FileStatus::Modified, false),
            ("untracked dir/".to_string(), FileStatus::Untracked, false),
         ]
      );
   }

   #[test]
   fn porcelain_status_handles_detached_and_unborn_heads() {
      let detached =
         parse_porcelain_status(b"# branch.oid abc\0# branch.head (detached)\0").expect("parse");
      assert_eq!(detached.branch, "HEAD");
      assert_eq!(detached.files.len(), 0);

      let unborn =
         parse_porcelain_status(b"# branch.oid (initial)\0# branch.head main\0? file.rs\0")
            .expect("parse");
      assert_eq!(unborn.branch, "main");
      assert_eq!(unborn.files.len(), 1);
   }

   #[test]
   fn wsl_fallback_init_restores_linux_repository_defaults() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");
      {
         let mut config = repo.config().expect("config");
         config.set_bool("core.filemode", false).expect("set");
         config.set_bool("core.symlinks", false).expect("set");
         config.set_bool("core.ignorecase", true).expect("set");
      }

      apply_linux_repository_defaults(&repo).expect("defaults");

      let config = repo.config().expect("config");
      let local = config
         .open_level(git2::ConfigLevel::Local)
         .expect("local config");
      assert!(local.get_bool("core.filemode").expect("filemode"));
      assert!(local.get_bool("core.symlinks").is_err());
      assert!(local.get_bool("core.ignorecase").is_err());
   }

   #[test]
   fn staged_renames_are_reported_as_a_single_renamed_file() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");
      fs::write(temp_dir.path().join("before.txt"), "same content\n").expect("write file");

      let tree_id = {
         let mut index = repo.index().expect("index");
         index
            .add_all(["before.txt"], IndexAddOption::DEFAULT, None)
            .expect("stage initial file");
         index.write().expect("write index");
         index.write_tree().expect("write tree")
      };
      let tree = repo.find_tree(tree_id).expect("tree");
      let signature = Signature::now("Athas Test", "athas@example.com").expect("signature");
      repo
         .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
         .expect("commit");
      drop(tree);

      fs::rename(
         temp_dir.path().join("before.txt"),
         temp_dir.path().join("after.txt"),
      )
      .expect("rename file");
      let mut index = repo.index().expect("index");
      index
         .remove_path(Path::new("before.txt"))
         .expect("remove old path");
      index
         .add_path(Path::new("after.txt"))
         .expect("add new path");
      index.write().expect("write renamed index");

      let status = _git_status(temp_dir.path().to_string_lossy().into_owned()).expect("status");

      assert_eq!(status.files.len(), 1);
      assert!(status.files[0].staged);
      assert!(matches!(status.files[0].status, FileStatus::Renamed));
   }
}
