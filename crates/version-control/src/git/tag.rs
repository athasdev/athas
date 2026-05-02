use crate::git::{
   CheckoutResult, GitTag, IntoStringError, execute_remote_git_command, format_git_time,
};
use anyhow::{Context, Result};
use git2::{Repository, Status};
use std::{
   path::Path,
   process::{Command, Stdio},
};

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
         let (commit_id, message, date, is_annotated) = match obj.as_tag() {
            Some(tag) => (
               tag.target_id().to_string(),
               tag.message().map(|m| m.to_string()),
               format_git_time(tag.tagger().map(|t| t.when().seconds())),
               true,
            ),
            None => match obj.peel_to_commit() {
               Ok(commit) => (
                  commit.id().to_string(),
                  None,
                  format_git_time(Some(commit.time().seconds())),
                  false,
               ),
               Err(_) => (obj.id().to_string(), None, String::new(), false),
            },
         };

         GitTag {
            name: name.to_string(),
            commit: commit_id,
            message,
            date,
            is_annotated,
         }
      })
      .collect();

   tags.sort_by(|a, b| b.date.cmp(&a.date));

   Ok(tags)
}

pub fn git_create_tag(
   repo_path: String,
   name: String,
   message: Option<String>,
   commit: Option<String>,
   signed: bool,
) -> Result<(), String> {
   _git_create_tag(repo_path, name, message, commit, signed).into_string_error()
}

fn _git_create_tag(
   repo_path: String,
   name: String,
   message: Option<String>,
   commit: Option<String>,
   signed: bool,
) -> Result<()> {
   if signed {
      return create_signed_tag(repo_path, name, message, commit);
   }

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

fn create_signed_tag(
   repo_path: String,
   name: String,
   message: Option<String>,
   commit: Option<String>,
) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   let tag_message = message.unwrap_or_else(|| name.clone());
   let mut args = vec!["tag", "-s", &name, "-m", &tag_message];

   let commit_ref;
   if let Some(commit) = commit {
      commit_ref = commit;
      args.push(&commit_ref);
   }

   let output = Command::new("git")
      .current_dir(repo_dir)
      .env("GIT_TERMINAL_PROMPT", "0")
      .stdin(Stdio::null())
      .args(args)
      .output()
      .context("Failed to execute git tag -s")?;

   if output.status.success() {
      return Ok(());
   }

   let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
   let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
   let details = if !stderr.is_empty() {
      stderr
   } else if !stdout.is_empty() {
      stdout
   } else {
      "Git returned a non-zero exit status without output.".to_string()
   };

   anyhow::bail!("Git signed tag failed: {details}");
}

pub fn git_delete_tag(repo_path: String, name: String) -> Result<(), String> {
   _git_delete_tag(repo_path, name).into_string_error()
}

fn _git_delete_tag(repo_path: String, name: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   repo.tag_delete(&name).context("Failed to delete tag")?;

   Ok(())
}

pub fn git_push_tag(repo_path: String, name: String, remote: String) -> Result<(), String> {
   _git_push_tag(repo_path, name, remote).into_string_error()
}

fn _git_push_tag(repo_path: String, name: String, remote: String) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   execute_remote_git_command(
      repo_dir,
      &["push", &remote, &format!("refs/tags/{name}")],
      "push tag",
   )
}

pub fn git_delete_remote_tag(
   repo_path: String,
   name: String,
   remote: String,
) -> Result<(), String> {
   _git_delete_remote_tag(repo_path, name, remote).into_string_error()
}

fn _git_delete_remote_tag(repo_path: String, name: String, remote: String) -> Result<()> {
   let repo_dir = Path::new(&repo_path);
   execute_remote_git_command(
      repo_dir,
      &["push", &remote, &format!(":refs/tags/{name}")],
      "delete remote tag",
   )
}

pub fn git_checkout_tag(repo_path: String, name: String) -> Result<CheckoutResult, String> {
   _git_checkout_tag(repo_path, name).into_string_error()
}

fn _git_checkout_tag(repo_path: String, name: String) -> Result<CheckoutResult> {
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
         message: "You have unstaged changes. Please stash or commit them before checking out a \
                   tag."
            .to_string(),
      });
   }

   let obj = repo
      .revparse_single(&format!("refs/tags/{name}"))
      .context("Failed to find tag")?;
   let commit = obj
      .peel_to_commit()
      .context("Failed to peel tag to commit")?;
   let commit_obj = commit.clone().into_object();

   repo
      .checkout_tree(&commit_obj, None)
      .context("Failed to checkout tag tree")?;
   repo
      .set_head_detached(commit.id())
      .context("Failed to detach HEAD at tag")?;

   Ok(CheckoutResult {
      success: true,
      has_changes: false,
      message: format!("Checked out tag '{name}' in detached HEAD."),
   })
}
