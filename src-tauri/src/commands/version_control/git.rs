use athas_version_control::git as git_backend;
use std::{path::Path, time::Instant};

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
   T: Send + 'static,
   F: FnOnce() -> Result<T, String> + Send + 'static,
{
   tauri::async_runtime::spawn_blocking(operation)
      .await
      .map_err(|error| format!("Git command task failed: {}", error))?
}

fn short_repo_path(path: &str) -> String {
   Path::new(path)
      .file_name()
      .and_then(|name| name.to_str())
      .unwrap_or(path)
      .to_string()
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<git_backend::GitStatus, String> {
   let started_at = Instant::now();
   let short = short_repo_path(&repo_path);
   log::info!("[git] git_status:start {}", short);
   let result = git_backend::git_status(repo_path.clone());

   match &result {
      Ok(status) => {
         log::info!(
            "[git] git_status:end {} {}ms files={}",
            short,
            started_at.elapsed().as_millis(),
            status.files.len()
         );
      }
      Err(error) => {
         log::error!(
            "[git] git_status:error {} {}ms {}",
            short,
            started_at.elapsed().as_millis(),
            error
         );
      }
   }

   result
}

#[tauri::command]
pub fn git_init(repo_path: String) -> Result<(), String> {
   git_backend::git_init(repo_path)
}

#[tauri::command]
pub fn git_discover_repo(path: String) -> Result<Option<String>, String> {
   git_backend::git_discover_repo(path)
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<(), String> {
   git_backend::git_commit(repo_path, message)
}

#[tauri::command]
pub fn git_log(
   repo_path: String,
   limit: Option<u32>,
   skip: Option<u32>,
) -> Result<Vec<git_backend::GitCommit>, String> {
   git_backend::git_log(repo_path, limit, skip)
}

#[tauri::command]
pub fn git_diff_file(
   repo_path: String,
   file_path: String,
   staged: bool,
) -> Result<git_backend::GitDiff, String> {
   git_backend::git_diff_file(repo_path, file_path, staged)
}

#[tauri::command]
pub fn git_diff_file_with_content(
   repo_path: String,
   file_path: String,
   content: String,
   base: String,
) -> Result<git_backend::GitDiff, String> {
   git_backend::git_diff_file_with_content(repo_path, file_path, content, base)
}

#[tauri::command]
pub async fn git_commit_diff(
   repo_path: String,
   commit_hash: String,
   file_path: Option<String>,
) -> Result<Vec<git_backend::GitDiff>, String> {
   run_blocking(move || git_backend::git_commit_diff(repo_path, commit_hash, file_path)).await
}

#[tauri::command]
pub async fn git_ref_diff(
   repo_path: String,
   base_ref: String,
   target_ref: String,
) -> Result<Vec<git_backend::GitDiff>, String> {
   run_blocking(move || git_backend::git_ref_diff(repo_path, base_ref, target_ref)).await
}

#[tauri::command]
pub fn git_blame_file(root_path: &str, file_path: &str) -> Result<git_backend::GitBlame, String> {
   git_backend::git_blame_file(root_path, file_path)
}

#[tauri::command]
pub fn git_branches(repo_path: String) -> Result<Vec<String>, String> {
   git_backend::git_branches(repo_path)
}

#[tauri::command]
pub fn git_checkout(
   repo_path: String,
   branch_name: String,
) -> Result<git_backend::CheckoutResult, String> {
   git_backend::git_checkout(repo_path, branch_name)
}

#[tauri::command]
pub fn git_create_branch(
   repo_path: String,
   branch_name: String,
   from_branch: Option<String>,
) -> Result<(), String> {
   git_backend::git_create_branch(repo_path, branch_name, from_branch)
}

#[tauri::command]
pub fn git_delete_branch(repo_path: String, branch_name: String) -> Result<(), String> {
   git_backend::git_delete_branch(repo_path, branch_name)
}

#[tauri::command]
pub async fn git_push(
   repo_path: String,
   branch: Option<String>,
   remote: String,
) -> Result<(), String> {
   run_blocking(move || git_backend::git_push(repo_path, branch, remote)).await
}

#[tauri::command]
pub async fn git_pull(
   repo_path: String,
   branch: Option<String>,
   remote: String,
) -> Result<(), String> {
   run_blocking(move || git_backend::git_pull(repo_path, branch, remote)).await
}

#[tauri::command]
pub async fn git_fetch(repo_path: String, remote: Option<String>) -> Result<(), String> {
   run_blocking(move || git_backend::git_fetch(repo_path, remote)).await
}

#[tauri::command]
pub fn git_get_remotes(repo_path: String) -> Result<Vec<git_backend::GitRemote>, String> {
   git_backend::git_get_remotes(repo_path)
}

#[tauri::command]
pub fn git_add_remote(repo_path: String, name: String, url: String) -> Result<(), String> {
   git_backend::git_add_remote(repo_path, name, url)
}

#[tauri::command]
pub fn git_remove_remote(repo_path: String, name: String) -> Result<(), String> {
   git_backend::git_remove_remote(repo_path, name)
}

#[tauri::command]
pub fn git_add(repo_path: String, file_path: String) -> Result<(), String> {
   git_backend::git_add(repo_path, file_path)
}

#[tauri::command]
pub fn git_reset(repo_path: String, file_path: String) -> Result<(), String> {
   git_backend::git_reset(repo_path, file_path)
}

#[tauri::command]
pub fn git_add_all(repo_path: String) -> Result<(), String> {
   git_backend::git_add_all(repo_path)
}

#[tauri::command]
pub fn git_reset_all(repo_path: String) -> Result<(), String> {
   git_backend::git_reset_all(repo_path)
}

#[tauri::command]
pub fn git_discard_file_changes(repo_path: String, file_path: String) -> Result<(), String> {
   git_backend::git_discard_file_changes(repo_path, file_path)
}

#[tauri::command]
pub fn git_discard_all_changes(repo_path: String) -> Result<(), String> {
   git_backend::git_discard_all_changes(repo_path)
}

#[tauri::command]
pub fn git_get_stashes(repo_path: String) -> Result<Vec<git_backend::GitStash>, String> {
   git_backend::git_get_stashes(repo_path)
}

#[tauri::command]
pub fn git_create_stash(
   repo_path: String,
   message: Option<String>,
   include_untracked: bool,
   files: Option<Vec<String>>,
) -> Result<(), String> {
   git_backend::git_create_stash(repo_path, message, include_untracked, files)
}

#[tauri::command]
pub fn git_apply_stash(repo_path: String, stash_index: usize) -> Result<(), String> {
   git_backend::git_apply_stash(repo_path, stash_index)
}

#[tauri::command]
pub fn git_pop_stash(repo_path: String, stash_index: Option<usize>) -> Result<(), String> {
   git_backend::git_pop_stash(repo_path, stash_index)
}

#[tauri::command]
pub fn git_drop_stash(repo_path: String, stash_index: usize) -> Result<(), String> {
   git_backend::git_drop_stash(repo_path, stash_index)
}

#[tauri::command]
pub fn git_stash_diff(
   repo_path: String,
   stash_index: usize,
) -> Result<Vec<git_backend::GitDiff>, String> {
   git_backend::git_stash_diff(repo_path, stash_index)
}

#[tauri::command]
pub fn git_get_tags(repo_path: String) -> Result<Vec<git_backend::GitTag>, String> {
   git_backend::git_get_tags(repo_path)
}

#[tauri::command]
pub fn git_create_tag(
   repo_path: String,
   name: String,
   message: Option<String>,
   commit: Option<String>,
   signed: bool,
) -> Result<(), String> {
   git_backend::git_create_tag(repo_path, name, message, commit, signed)
}

#[tauri::command]
pub fn git_delete_tag(repo_path: String, name: String) -> Result<(), String> {
   git_backend::git_delete_tag(repo_path, name)
}

#[tauri::command]
pub async fn git_push_tag(repo_path: String, name: String, remote: String) -> Result<(), String> {
   run_blocking(move || git_backend::git_push_tag(repo_path, name, remote)).await
}

#[tauri::command]
pub async fn git_delete_remote_tag(
   repo_path: String,
   name: String,
   remote: String,
) -> Result<(), String> {
   run_blocking(move || git_backend::git_delete_remote_tag(repo_path, name, remote)).await
}

#[tauri::command]
pub fn git_checkout_tag(
   repo_path: String,
   name: String,
) -> Result<git_backend::CheckoutResult, String> {
   git_backend::git_checkout_tag(repo_path, name)
}

#[tauri::command]
pub fn git_get_worktrees(repo_path: String) -> Result<Vec<git_backend::GitWorktree>, String> {
   git_backend::git_get_worktrees(repo_path)
}

#[tauri::command]
pub fn git_add_worktree(
   repo_path: String,
   path: String,
   branch: Option<String>,
   create_branch: bool,
) -> Result<(), String> {
   git_backend::git_add_worktree(repo_path, path, branch, create_branch)
}

#[tauri::command]
pub fn git_remove_worktree(repo_path: String, path: String, force: bool) -> Result<(), String> {
   git_backend::git_remove_worktree(repo_path, path, force)
}

#[tauri::command]
pub fn git_prune_worktrees(repo_path: String) -> Result<(), String> {
   git_backend::git_prune_worktrees(repo_path)
}

#[tauri::command]
pub fn git_stage_hunk(repo_path: String, hunk: git_backend::GitHunk) -> Result<(), String> {
   git_backend::git_stage_hunk(repo_path, hunk)
}

#[tauri::command]
pub fn git_unstage_hunk(repo_path: String, hunk: git_backend::GitHunk) -> Result<(), String> {
   git_backend::git_unstage_hunk(repo_path, hunk)
}
