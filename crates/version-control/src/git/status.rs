use crate::git::{FileStatus, GitFile, GitStatus, IntoStringError, get_ahead_behind_counts};
use anyhow::{Context, Result};
use git2::{ErrorCode, Repository};
use std::fs;

pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
   _git_status(repo_path).into_string_error()
}

fn _git_status(repo_path: String) -> Result<GitStatus> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let branch = current_branch_name(&repo);

   let (ahead, behind) = get_ahead_behind_counts(&repo, &branch);

   let mut status_opts = git2::StatusOptions::new();
   status_opts
      .include_untracked(true)
      .recurse_untracked_dirs(false)
      .include_ignored(false)
      .include_unmodified(false)
      .renames_head_to_index(false)
      .renames_index_to_workdir(false);

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

pub fn git_init(repo_path: String) -> Result<(), String> {
   _git_init(repo_path).into_string_error()
}

fn _git_init(repo_path: String) -> Result<()> {
   Repository::init(&repo_path).context("Failed to initialize repository")?;
   Ok(())
}

pub fn git_discover_repo(path: String) -> Result<Option<String>, String> {
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

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn current_branch_name_uses_unborn_head_name_for_empty_repositories() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let repo = Repository::init(temp_dir.path()).expect("repo init");

      let branch = current_branch_name(&repo);

      assert_ne!(branch, "unknown");
      assert!(!branch.is_empty());
   }
}
