use crate::commands::git::{GitTag, IntoStringError, format_git_time};
use anyhow::{Context, Result};
use git2::Repository;
use tauri::command;

#[command]
pub fn git_get_tags(repo_path: String) -> Result<Vec<GitTag>, String> {
   _git_get_tags(repo_path).into_string_error()
}

fn _git_get_tags(repo_path: String) -> Result<Vec<GitTag>> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let tag_names = repo.tag_names(None).context("Failed to get tag names")?;

   let mut tags: Vec<GitTag> = tag_names
      .iter()
      .flatten()
      .filter_map(|name| {
         repo
            .revparse_single(&format!("refs/tags/{}", name))
            .ok()
            .map(|obj| (name, obj))
      })
      .map(|(name, obj)| {
         let (commit_id, message, date) = match obj.as_tag() {
            Some(tag) => (
               tag.target_id().to_string(),
               tag.message().map(|m| m.to_string()),
               format_git_time(tag.tagger().map(|t| t.when().seconds())),
            ),
            None => match obj.peel_to_commit() {
               Ok(commit) => (
                  commit.id().to_string(),
                  None,
                  format_git_time(Some(commit.time().seconds())),
               ),
               Err(_) => (obj.id().to_string(), None, String::new()),
            },
         };

         GitTag {
            name: name.to_string(),
            commit: commit_id,
            message,
            date,
         }
      })
      .collect();

   tags.sort_by(|a, b| b.date.cmp(&a.date));

   Ok(tags)
}

#[command]
pub fn git_create_tag(
   repo_path: String,
   name: String,
   message: Option<String>,
   commit: Option<String>,
) -> Result<(), String> {
   _git_create_tag(repo_path, name, message, commit).into_string_error()
}

fn _git_create_tag(
   repo_path: String,
   name: String,
   message: Option<String>,
   commit: Option<String>,
) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let target = if let Some(commit_ref) = commit {
      repo
         .revparse_single(&commit_ref)
         .context("Failed to find commit")?
   } else {
      repo
         .head()
         .context("Failed to get HEAD")?
         .peel_to_commit()
         .context("Failed to peel HEAD to commit")?
         .into_object()
   };

   if let Some(msg) = message {
      let signature = repo.signature().context("Failed to get signature")?;
      repo
         .tag(&name, &target, &signature, &msg, false)
         .context("Failed to create annotated tag")?;
   } else {
      repo
         .tag_lightweight(&name, &target, false)
         .context("Failed to create lightweight tag")?;
   }

   Ok(())
}

#[command]
pub fn git_delete_tag(repo_path: String, name: String) -> Result<(), String> {
   _git_delete_tag(repo_path, name).into_string_error()
}

fn _git_delete_tag(repo_path: String, name: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   repo.tag_delete(&name).context("Failed to delete tag")?;

   Ok(())
}
