use crate::commands::git::{GitStash, IntoStringError};
use anyhow::{Context, Result, bail};
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
      .args(["stash", "list", "--format=%gd|%s|%ai"])
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
) -> Result<(), String> {
   _git_create_stash(repo_path, message, include_untracked).into_string_error()
}

fn _git_create_stash(
   repo_path: String,
   message: Option<String>,
   include_untracked: bool,
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
