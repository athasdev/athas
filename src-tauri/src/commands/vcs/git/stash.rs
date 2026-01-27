use crate::commands::git::{
   GitDiff, GitStash, IntoStringError, diff::parse_diff_to_lines, is_image_file,
};
use anyhow::{Context, Result, bail};
use git2::Repository;
use std::{path::Path, process::Command};
use tauri::command;

#[command]
pub fn git_get_stashes(repo_path: String) -> Result<Vec<GitStash>, String> {
   _git_get_stashes(repo_path).into_string_error()
}

fn _git_get_stashes(repo_path: String) -> Result<Vec<GitStash>> {
   let repo_dir = Path::new(&repo_path);

   if !repo_dir.join(".git").exists() {
      bail!("Not a git repository");
   }

   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(["stash", "list", "--format=%gd|%s|%aI"])
      .output()
      .context("Failed to execute git stash list")?;

   let mut stashes = Vec::new();
   if output.status.success() {
      let stash_text = String::from_utf8_lossy(&output.stdout);
      for (index, line) in stash_text.lines().enumerate() {
         let parts: Vec<&str> = line.split('|').collect();
         if parts.len() >= 3 {
            let message = if parts[1].starts_with("On ") && parts[1].contains(": ") {
               parts[1].split(": ").nth(1).unwrap_or(parts[1]).to_string()
            } else {
               parts[1].to_string()
            };
            stashes.push(GitStash {
               index,
               message,
               date: parts[2].to_string(),
            });
         }
      }
   }

   Ok(stashes)
}

#[command]
pub fn git_create_stash(
   repo_path: String,
   message: Option<String>,
   include_untracked: bool,
   files: Option<Vec<String>>,
) -> Result<(), String> {
   _git_create_stash(repo_path, message, include_untracked, files).into_string_error()
}

fn _git_create_stash(
   repo_path: String,
   message: Option<String>,
   include_untracked: bool,
   files: Option<Vec<String>>,
) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let mut args = vec!["stash", "push"];
   if include_untracked {
      args.push("-u");
   }
   if let Some(msg) = &message {
      args.push("-m");
      args.push(msg);
   }

   if let Some(ref file_list) = files {
      if !file_list.is_empty() {
         args.push("--");
         for file in file_list {
            args.push(file);
         }
      }
   }

   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(&args)
      .output()
      .context("Failed to execute git stash push")?;

   if !output.status.success() {
      bail!(
         "Git stash create failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}

#[command]
pub fn git_apply_stash(repo_path: String, stash_index: usize) -> Result<(), String> {
   _git_apply_stash(repo_path, stash_index).into_string_error()
}

fn _git_apply_stash(repo_path: String, stash_index: usize) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(["stash", "apply", &format!("stash@{{{stash_index}}}")])
      .output()
      .context("Failed to execute git stash apply")?;

   if !output.status.success() {
      bail!(
         "Git stash apply failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}

#[command]
pub fn git_pop_stash(repo_path: String, stash_index: Option<usize>) -> Result<(), String> {
   _git_pop_stash(repo_path, stash_index).into_string_error()
}

fn _git_pop_stash(repo_path: String, stash_index: Option<usize>) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let mut args = vec!["stash", "pop"];
   let index_str;
   if let Some(idx) = stash_index {
      index_str = format!("stash@{{{idx}}}");
      args.push(&index_str);
   }

   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(&args)
      .output()
      .context("Failed to execute git stash pop")?;

   if !output.status.success() {
      bail!(
         "Git stash pop failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}

#[command]
pub fn git_drop_stash(repo_path: String, stash_index: usize) -> Result<(), String> {
   _git_drop_stash(repo_path, stash_index).into_string_error()
}

fn _git_drop_stash(repo_path: String, stash_index: usize) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(["stash", "drop", &format!("stash@{{{stash_index}}}")])
      .output()
      .context("Failed to execute git stash drop")?;

   if !output.status.success() {
      bail!(
         "Git stash drop failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}

#[command]
pub fn git_stash_diff(repo_path: String, stash_index: usize) -> Result<Vec<GitDiff>, String> {
   _git_stash_diff(repo_path, stash_index).map_err(|e| e.to_string())
}

fn _git_stash_diff(repo_path: String, stash_index: usize) -> Result<Vec<GitDiff>> {
   let repo_dir = Path::new(&repo_path);
   let stash_ref = format!("stash@{{{stash_index}}}");

   // Get the list of files changed in the stash using git stash show
   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(["stash", "show", "--name-status", &stash_ref])
      .output()
      .context("Failed to execute git stash show")?;

   if !output.status.success() {
      bail!(
         "Git stash show failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   let file_list = String::from_utf8_lossy(&output.stdout);
   let mut results: Vec<GitDiff> = Vec::new();

   // Open repo with git2 for getting the actual diffs
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   // Get stash commit hash
   let stash_commit = repo
      .revparse_single(&stash_ref)
      .context("Failed to find stash")?
      .peel_to_commit()
      .context("Failed to peel stash to commit")?;

   let stash_tree = stash_commit.tree().context("Failed to get stash tree")?;

   // Get parent tree
   let parent_tree = if stash_commit.parent_count() > 0 {
      Some(
         stash_commit
            .parent(0)
            .context("Failed to get parent")?
            .tree()
            .context("Failed to get parent tree")?,
      )
   } else {
      None
   };

   for line in file_list.lines() {
      let parts: Vec<&str> = line.split('\t').collect();
      if parts.len() < 2 {
         continue;
      }

      let status_char = parts[0].chars().next().unwrap_or(' ');
      let file_path = parts.last().unwrap_or(&"").to_string();

      if file_path.is_empty() {
         continue;
      }

      let is_new = status_char == 'A';
      let is_deleted = status_char == 'D';
      let is_renamed = status_char == 'R';
      let is_image = is_image_file(&file_path);

      let old_path = if is_renamed && parts.len() >= 3 {
         Some(parts[1].to_string())
      } else if !is_new {
         Some(file_path.clone())
      } else {
         None
      };

      let new_path = if !is_deleted {
         Some(file_path.clone())
      } else {
         None
      };

      let (lines, is_binary, old_blob_base64, new_blob_base64) = if is_image {
         (Vec::new(), true, None, None)
      } else {
         // Get diff for this specific file
         let mut diff_opts = git2::DiffOptions::new();
         diff_opts.pathspec(&file_path);

         let mut diff = repo
            .diff_tree_to_tree(
               parent_tree.as_ref(),
               Some(&stash_tree),
               Some(&mut diff_opts),
            )
            .context("Failed to create diff")?;

         let lines = parse_diff_to_lines(&mut diff).unwrap_or_default();
         (lines, false, None, None)
      };

      results.push(GitDiff {
         file_path,
         old_path,
         new_path,
         is_new,
         is_deleted,
         is_renamed,
         is_binary,
         is_image,
         old_blob_base64,
         new_blob_base64,
         lines,
      });
   }

   Ok(results)
}
