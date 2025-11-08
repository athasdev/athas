use crate::commands::git::IntoStringError;
use anyhow::{Context, Result};
use git2::{ErrorCode, Repository};
use std::path::Path;
use tauri::command;

#[command]
pub fn git_add(repo_path: String, file_path: String) -> Result<(), String> {
   _git_add(repo_path, file_path).into_string_error()
}

fn _git_add(repo_path: String, file_path: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let mut index = repo.index().context("Failed to get index")?;

   let relative_path = Path::new(&file_path);
   let absolute_path = Path::new(&repo_path).join(relative_path);

   if absolute_path.is_dir() {
      index
         .add_all(
            [file_path.as_str()].iter(),
            git2::IndexAddOption::DEFAULT,
            None,
         )
         .with_context(|| format!("Failed to add directory {}", file_path))?;
   } else {
      match index.add_path(relative_path) {
         Ok(_) => {}
         Err(err) => {
            if err.code() == ErrorCode::NotFound {
               index
                  .add_all(
                     [file_path.as_str()].iter(),
                     git2::IndexAddOption::DEFAULT,
                     None,
                  )
                  .with_context(|| format!("Failed to add path {}", file_path))?;
            } else {
               return Err(err).with_context(|| format!("Failed to add file {}", file_path));
            }
         }
      }
   }

   index.write().context("Failed to write index")?;

   Ok(())
}

#[command]
pub fn git_reset(repo_path: String, file_path: String) -> Result<(), String> {
   _git_reset(repo_path, file_path).into_string_error()
}

fn _git_reset(repo_path: String, file_path: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let head = repo.head().context("Failed to get HEAD")?;
   let head_commit = head.peel_to_commit().context("Failed to get HEAD commit")?;
   let head_tree = head_commit.tree().context("Failed to get HEAD tree")?;
   let mut index = repo.index().context("Failed to get index")?;

   let path = Path::new(&file_path);
   match head_tree.get_path(path) {
      Ok(entry) => {
         let object = entry.to_object(&repo).context("Failed to get object")?;
         let blob = object.as_blob().context("Object is not a blob")?;

         let index_entry = git2::IndexEntry {
            ctime: git2::IndexTime::new(0, 0),
            mtime: git2::IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: entry.filemode() as u32,
            uid: 0,
            gid: 0,
            file_size: blob.size() as u32,
            id: entry.id(),
            flags: 0,
            flags_extended: 0,
            path: file_path.as_bytes().to_vec(),
         };

         index.add(&index_entry).context("Failed to update index")?;
      }
      Err(_) => {
         index
            .remove_path(path)
            .context("Failed to remove from index")?;
      }
   }

   index.write().context("Failed to write index")?;
   Ok(())
}

#[command]
pub fn git_add_all(repo_path: String) -> Result<(), String> {
   _git_add_all(repo_path).into_string_error()
}

fn _git_add_all(repo_path: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;
   let mut index = repo.index().context("Failed to get index")?;

   index
      .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
      .context("Failed to add all files")?;
   index.write().context("Failed to write index")?;

   Ok(())
}

#[command]
pub fn git_reset_all(repo_path: String) -> Result<(), String> {
   _git_reset_all(repo_path).into_string_error()
}

fn _git_reset_all(repo_path: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let head = repo.head().context("Failed to get HEAD")?;
   let head_commit = head.peel_to_commit().context("Failed to get HEAD commit")?;
   let head_tree = head_commit.tree().context("Failed to get HEAD tree")?;
   let mut index = repo.index().context("Failed to get index")?;

   index
      .read_tree(&head_tree)
      .context("Failed to reset index to HEAD")?;
   index.write().context("Failed to write index")?;

   Ok(())
}

#[command]
pub fn git_discard_file_changes(repo_path: String, file_path: String) -> Result<(), String> {
   _git_discard_file_changes(repo_path, file_path).into_string_error()
}

fn _git_discard_file_changes(repo_path: String, file_path: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let head = repo
      .head()
      .context("Failed to get HEAD")?
      .peel_to_tree()
      .context("Failed to get HEAD tree")?;

   let mut checkout_opts = git2::build::CheckoutBuilder::new();
   checkout_opts.force().update_index(true).path(&file_path);

   repo
      .checkout_tree(head.as_object(), Some(&mut checkout_opts))
      .context("Failed to checkout file")?;

   Ok(())
}

#[command]
pub fn git_discard_all_changes(repo_path: String) -> Result<(), String> {
   _git_discard_all_changes(repo_path).into_string_error()
}

fn _git_discard_all_changes(repo_path: String) -> Result<()> {
   let repo = Repository::open(&repo_path).context("Failed to open repository")?;

   let head = repo
      .head()
      .context("Failed to get HEAD")?
      .peel_to_commit()
      .context("Failed to get HEAD commit")?;

   repo
      .reset(head.as_object(), git2::ResetType::Hard, None)
      .context("Failed to reset to HEAD")?;

   Ok(())
}
