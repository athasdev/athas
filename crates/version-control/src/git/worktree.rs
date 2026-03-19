use crate::git::{GitWorktree, IntoStringError};
use anyhow::{Context, Result, bail};
use std::{
   fs,
   path::{Path, PathBuf},
   process::Command,
};

pub fn git_get_worktrees(repo_path: String) -> Result<Vec<GitWorktree>, String> {
   _git_get_worktrees(repo_path).into_string_error()
}

fn _git_get_worktrees(repo_path: String) -> Result<Vec<GitWorktree>> {
   let repo_dir = Path::new(&repo_path);
   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(["worktree", "list", "--porcelain"])
      .output()
      .context("Failed to execute git worktree list")?;

   if !output.status.success() {
      bail!(
         "Git worktree list failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   let current_path = normalize_path(repo_dir);
   let stdout = String::from_utf8(output.stdout).context("Invalid git worktree output")?;
   let mut worktrees = Vec::new();
   let mut current: Option<GitWorktree> = None;

   for line in stdout.lines() {
      if line.is_empty() {
         if let Some(worktree) = current.take() {
            worktrees.push(worktree);
         }
         continue;
      }

      if let Some(path) = line.strip_prefix("worktree ") {
         if let Some(worktree) = current.take() {
            worktrees.push(worktree);
         }

         let normalized_worktree_path = normalize_path(Path::new(path));
         current = Some(GitWorktree {
            is_current: normalized_worktree_path == current_path,
            path: normalized_worktree_path,
            branch: None,
            head: String::new(),
            is_bare: false,
            is_detached: false,
            locked_reason: None,
            prunable_reason: None,
         });
         continue;
      }

      let Some(worktree) = current.as_mut() else {
         continue;
      };

      if let Some(head) = line.strip_prefix("HEAD ") {
         worktree.head = head.to_string();
      } else if let Some(branch) = line.strip_prefix("branch ") {
         worktree.branch = Some(
            branch
               .strip_prefix("refs/heads/")
               .unwrap_or(branch)
               .to_string(),
         );
      } else if line == "bare" {
         worktree.is_bare = true;
      } else if line == "detached" {
         worktree.is_detached = true;
      } else if let Some(reason) = line.strip_prefix("locked") {
         worktree.locked_reason = parse_optional_reason(reason);
      } else if let Some(reason) = line.strip_prefix("prunable") {
         worktree.prunable_reason = parse_optional_reason(reason);
      }
   }

   if let Some(worktree) = current {
      worktrees.push(worktree);
   }

   Ok(worktrees)
}

pub fn git_add_worktree(
   repo_path: String,
   path: String,
   branch: Option<String>,
   create_branch: bool,
) -> Result<(), String> {
   _git_add_worktree(repo_path, path, branch, create_branch).into_string_error()
}

fn _git_add_worktree(
   repo_path: String,
   path: String,
   branch: Option<String>,
   create_branch: bool,
) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let target_path = PathBuf::from(path.trim());

   if target_path.as_os_str().is_empty() {
      bail!("Worktree path is required");
   }

   let branch = branch
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty());
   let mut args: Vec<String> = vec!["worktree".into(), "add".into()];

   if create_branch {
      let Some(branch_name) = branch.as_ref() else {
         bail!("Branch name is required when creating a new worktree branch");
      };
      args.push("-b".into());
      args.push(branch_name.clone());
   }

   args.push(target_path.to_string_lossy().to_string());

   if let Some(branch_name) = branch
      && !create_branch
   {
      args.push(branch_name);
   }

   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(&args)
      .output()
      .context("Failed to execute git worktree add")?;

   if !output.status.success() {
      bail!(
         "Git worktree add failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}

pub fn git_remove_worktree(repo_path: String, path: String, force: bool) -> Result<(), String> {
   _git_remove_worktree(repo_path, path, force).into_string_error()
}

fn _git_remove_worktree(repo_path: String, path: String, force: bool) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let mut args: Vec<String> = vec!["worktree".into(), "remove".into()];
   if force {
      args.push("--force".into());
   }
   args.push(path);

   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(&args)
      .output()
      .context("Failed to execute git worktree remove")?;

   if !output.status.success() {
      bail!(
         "Git worktree remove failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}

pub fn git_prune_worktrees(repo_path: String) -> Result<(), String> {
   _git_prune_worktrees(repo_path).into_string_error()
}

fn _git_prune_worktrees(repo_path: String) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let output = Command::new("git")
      .current_dir(repo_dir)
      .args(["worktree", "prune"])
      .output()
      .context("Failed to execute git worktree prune")?;

   if !output.status.success() {
      bail!(
         "Git worktree prune failed: {}",
         String::from_utf8_lossy(&output.stderr)
      );
   }

   Ok(())
}

fn normalize_path(path: &Path) -> String {
   fs::canonicalize(path)
      .unwrap_or_else(|_| path.to_path_buf())
      .to_string_lossy()
      .to_string()
}

fn parse_optional_reason(value: &str) -> Option<String> {
   let reason = value.trim();
   if reason.is_empty() {
      None
   } else {
      Some(reason.to_string())
   }
}
