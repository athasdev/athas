use crate::commands::git::{
   FileStatus, GitFile, GitStatus, IntoStringError, get_ahead_behind_counts,
};
use anyhow::{Context, Result};
use git2::Repository;
use tauri::command;

#[command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
   _git_status(repo_path).into_string_error()
}

fn _git_status(repo_path: String) -> Result<GitStatus> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let branch = repo
      .head()
      .ok()
      .and_then(|head| {
         if head.is_branch() {
            head.shorthand().map(|s| s.to_string())
         } else {
            Some("HEAD".to_string())
         }
      })
      .unwrap_or_else(|| "unknown".to_string());

   let (ahead, behind) = get_ahead_behind_counts(&repo, &branch);

   let mut status_opts = git2::StatusOptions::new();
   status_opts
      .include_untracked(true)
      .include_ignored(false)
      .include_unmodified(false);

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

#[command]
pub fn git_init(repo_path: String) -> Result<(), String> {
   _git_init(repo_path).into_string_error()
}

fn _git_init(repo_path: String) -> Result<()> {
   Repository::init(&repo_path).context("Failed to initialize repository")?;
   Ok(())
}
