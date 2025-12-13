use crate::commands::git::{GitCommit, IntoStringError};
use anyhow::{Context, Result};
use git2::{Repository, Sort};
use tauri::command;

#[command]
pub fn git_commit(repo_path: String, message: String) -> Result<(), String> {
   _git_commit(repo_path, message).into_string_error()
}

fn _git_commit(repo_path: String, message: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let mut index = repo.index().context("Failed to get index")?;

   let tree_id = index.write_tree().context("Failed to write tree")?;
   let tree = repo.find_tree(tree_id).context("Failed to find tree")?;
   let sig = repo.signature().context("Failed to get signature")?;
   let head = repo.head().context("Failed to get HEAD")?;
   let parent_commit = head
      .peel_to_commit()
      .context("Failed to get parent commit")?;

   repo
      .commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&parent_commit])
      .context("Failed to create commit")?;

   Ok(())
}

#[command]
pub fn git_log(
   repo_path: String,
   limit: Option<u32>,
   skip: Option<u32>,
) -> Result<Vec<GitCommit>, String> {
   _git_log(repo_path, limit, skip).into_string_error()
}

fn _git_log(repo_path: String, limit: Option<u32>, skip: Option<u32>) -> Result<Vec<GitCommit>> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let mut revwalk = repo.revwalk().context("Failed to create revwalk")?;

   revwalk.push_head().context("Failed to push HEAD")?;
   revwalk
      .set_sorting(Sort::TIME)
      .context("Failed to set sorting")?;

   let skip = skip.unwrap_or(0) as usize;
   let limit = limit.unwrap_or(50) as usize;
   let mut commits = Vec::new();

   for (_idx, oid) in revwalk.enumerate().skip(skip).take(limit) {
      let oid = oid.context("Failed to get commit oid")?;
      let commit = repo.find_commit(oid).context("Failed to find commit")?;

      let author = commit.author();
      let time = chrono::DateTime::<chrono::Utc>::from_timestamp(author.when().seconds(), 0)
         .map(|dt| dt.format("%Y-%m-%d").to_string())
         .unwrap_or_default();

      commits.push(GitCommit {
         hash: oid.to_string(),
         message: commit.summary().unwrap_or("").to_string(),
         author: author.name().unwrap_or("Unknown").to_string(),
         date: time,
      });
   }

   Ok(commits)
}
