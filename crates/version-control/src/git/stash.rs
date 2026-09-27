use crate::git::{
   GitDiff, GitStash, IntoStringError, RepositoryHost, diff::parse_diff_to_lines, is_image_file,
};
use anyhow::{Context, Result, bail};
use git2::Repository;

pub fn git_get_stashes(repo_path: String) -> Result<Vec<GitStash>, String> {
   _git_get_stashes(repo_path).into_string_error()
}

fn clean_stash_subject(subject: &str) -> String {
   let trimmed = subject.trim();
   let without_context = if let Some((_, message)) = trimmed.split_once(": ") {
      if trimmed.starts_with("On ")
         || trimmed.starts_with("WIP on ")
         || trimmed.starts_with("index on ")
      {
         message
      } else {
         trimmed
      }
   } else {
      trimmed
   };

   let mut message_parts = without_context.splitn(2, ' ');
   if let Some(first_part) = message_parts.next()
      && first_part.len() >= 7
      && first_part.len() <= 40
      && first_part.chars().all(|c| c.is_ascii_hexdigit())
   {
      return message_parts
         .next()
         .unwrap_or(without_context)
         .trim()
         .to_string();
   }

   without_context.trim().to_string()
}

fn _git_get_stashes(repo_path: String) -> Result<Vec<GitStash>> {
   let host = RepositoryHost::detect(&repo_path);

   if !host.native_path().join(".git").exists() {
      bail!("Not a git repository");
   }

   let output = host
      .git()
      .args(["stash", "list", "--format=%gd|%s|%aI"])
      .output()
      .context("Failed to execute git stash list")?;

   let mut stashes = Vec::new();
   if output.status.success() {
      let stash_text = String::from_utf8_lossy(&output.stdout);
      for (index, line) in stash_text.lines().enumerate() {
         let parts: Vec<&str> = line.split('|').collect();
         if parts.len() >= 3 {
            stashes.push(GitStash {
               index,
               message: clean_stash_subject(parts[1]),
               date: parts[2].to_string(),
            });
         }
      }
   }

   Ok(stashes)
}

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
   let host = RepositoryHost::detect(&repo_path);
   let mut args = vec!["stash", "push"];
   if include_untracked {
      args.push("-u");
   }
   if let Some(msg) = &message {
      args.push("-m");
      args.push(msg);
   }

   if let Some(ref file_list) = files
      && !file_list.is_empty()
   {
      args.push("--");
      for file in file_list {
         args.push(file);
      }
   }

   host.git().args(&args).run("stash create")?;

   Ok(())
}

pub fn git_apply_stash(repo_path: String, stash_index: usize) -> Result<(), String> {
   _git_apply_stash(repo_path, stash_index).into_string_error()
}

fn _git_apply_stash(repo_path: String, stash_index: usize) -> Result<()> {
   RepositoryHost::detect(&repo_path)
      .git()
      .args(["stash", "apply", &format!("stash@{{{stash_index}}}")])
      .run("stash apply")?;

   Ok(())
}

pub fn git_pop_stash(repo_path: String, stash_index: Option<usize>) -> Result<(), String> {
   _git_pop_stash(repo_path, stash_index).into_string_error()
}

fn _git_pop_stash(repo_path: String, stash_index: Option<usize>) -> Result<()> {
   let mut args = vec!["stash", "pop"];
   let index_str;
   if let Some(idx) = stash_index {
      index_str = format!("stash@{{{idx}}}");
      args.push(&index_str);
   }

   RepositoryHost::detect(&repo_path)
      .git()
      .args(&args)
      .run("stash pop")?;

   Ok(())
}

pub fn git_drop_stash(repo_path: String, stash_index: usize) -> Result<(), String> {
   _git_drop_stash(repo_path, stash_index).into_string_error()
}

fn _git_drop_stash(repo_path: String, stash_index: usize) -> Result<()> {
   RepositoryHost::detect(&repo_path)
      .git()
      .args(["stash", "drop", &format!("stash@{{{stash_index}}}")])
      .run("stash drop")?;

   Ok(())
}

pub fn git_stash_diff(repo_path: String, stash_index: usize) -> Result<Vec<GitDiff>, String> {
   _git_stash_diff(repo_path, stash_index).map_err(|e| e.to_string())
}

fn _git_stash_diff(repo_path: String, stash_index: usize) -> Result<Vec<GitDiff>> {
   let stash_ref = format!("stash@{{{stash_index}}}");

   // Get the list of files changed in the stash using git stash show
   let output = RepositoryHost::detect(&repo_path)
      .git()
      .args(["stash", "show", "--name-status", &stash_ref])
      .run("stash show")?;

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

      let (lines, is_binary, old_blob_base64, new_blob_base64, is_truncated) = if is_image {
         (Vec::new(), true, None, None, false)
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

         let parsed = parse_diff_to_lines(&mut diff).unwrap_or_default();
         let is_truncated = parsed.is_truncated;
         let lines = parsed.lines;
         (lines, false, None, None, is_truncated)
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
         raw_patch: None,
         additions: None,
         deletions: None,
         is_truncated: is_truncated.then_some(true),
      });
   }

   Ok(results)
}
