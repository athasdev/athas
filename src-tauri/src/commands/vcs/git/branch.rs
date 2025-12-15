use crate::commands::git::IntoStringError;
use anyhow::{Context, Result};
use git2::{BranchType, Repository, Status};
use serde::Serialize;
use tauri::command;

#[derive(Serialize)]
pub struct CheckoutResult {
   pub success: bool,
   pub has_changes: bool,
   pub message: String,
}

#[command]
pub fn git_branches(repo_path: String) -> Result<Vec<String>, String> {
   _git_branches(repo_path).into_string_error()
}

fn _git_branches(repo_path: String) -> Result<Vec<String>> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let branches = repo
      .branches(Some(BranchType::Local))
      .context("Failed to list branches")?;

   let mut branch_names = Vec::new();
   for branch in branches {
      let (branch, _) = branch.context("Failed to get branch")?;
      if let Some(name) = branch.name().context("Failed to get branch name")? {
         branch_names.push(name.to_string());
      }
   }

   Ok(branch_names)
}

#[command]
pub fn git_checkout(repo_path: String, branch_name: String) -> Result<CheckoutResult, String> {
   _git_checkout(repo_path, branch_name).into_string_error()
}

fn _git_checkout(repo_path: String, branch_name: String) -> Result<CheckoutResult> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let statuses = repo
      .statuses(None)
      .context("Failed to get repository status")?;

   let has_changes = statuses.iter().any(|entry| {
      let flags = entry.status();
      flags.contains(Status::WT_NEW)
         || flags.contains(Status::WT_MODIFIED)
         || flags.contains(Status::WT_DELETED)
         || flags.contains(Status::WT_RENAMED)
         || flags.contains(Status::WT_TYPECHANGE)
   });

   if has_changes {
      return Ok(CheckoutResult {
         success: false,
         has_changes: true,
         message: "You have unstaged changes. Please stash or commit them before switching \
                   branches."
            .to_string(),
      });
   }

   let obj = repo
      .revparse_single(&format!("refs/heads/{}", branch_name))
      .context("Failed to find branch")?;

   repo
      .checkout_tree(&obj, None)
      .context("Failed to checkout tree")?;

   repo
      .set_head(&format!("refs/heads/{}", branch_name))
      .context("Failed to update HEAD")?;

   Ok(CheckoutResult {
      success: true,
      has_changes: false,
      message: format!("Successfully checked out to branch '{}'", branch_name),
   })
}

#[command]
pub fn git_create_branch(
   repo_path: String,
   branch_name: String,
   from_branch: Option<String>,
) -> Result<(), String> {
   _git_create_branch(repo_path, branch_name, from_branch).into_string_error()
}

fn _git_create_branch(
   repo_path: String,
   branch_name: String,
   from_branch: Option<String>,
) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let target = if let Some(from) = from_branch {
      repo
         .revparse_single(&from)
         .context("Failed to find source branch")?
         .peel_to_commit()
         .context("Failed to peel to commit")?
   } else {
      repo
         .head()
         .context("Failed to get HEAD")?
         .peel_to_commit()
         .context("Failed to peel HEAD to commit")?
   };

   let branch = repo
      .branch(&branch_name, &target, false)
      .context("Failed to create branch")?;

   let refname = branch
      .get()
      .name()
      .context("Failed to get branch reference name")?;

   repo
      .set_head(refname)
      .context("Failed to set HEAD to new branch")?;

   repo
      .checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
      .context("Failed to checkout new branch")?;

   Ok(())
}

#[command]
pub fn git_delete_branch(repo_path: String, branch_name: String) -> Result<(), String> {
   _git_delete_branch(repo_path, branch_name).into_string_error()
}

fn _git_delete_branch(repo_path: String, branch_name: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let mut branch = repo
      .find_branch(&branch_name, BranchType::Local)
      .context("Failed to find branch")?;

   branch.delete().context("Failed to delete branch")?;

   Ok(())
}
