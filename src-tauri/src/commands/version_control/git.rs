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

fn resolve_backend_path(path: String) -> String {
   athas_wsl::resolve_windows_path(&path).unwrap_or(path)
}

/// Maps a path reported by the git backend back into the form the frontend
/// used for the repository. Backends answer with a `\\wsl$` share path when
/// libgit2 handled the request and with a Linux path when the distribution's
/// own git did, so both are folded back into a `wsl://` URI or a share path
/// matching the original.
fn restore_provider_path(original_path: &str, backend_path: String) -> String {
   let Some(location) = athas_wsl::parse_wsl_location(original_path) else {
      return backend_path;
   };

   let linux_path = if let Some((parsed, _)) = athas_wsl::parse_windows_unc_path(&backend_path) {
      parsed.linux_path
   } else if athas_wsl::is_wsl_path(&backend_path) {
      return backend_path;
   } else if backend_path.starts_with('/') {
      athas_wsl::normalize_linux_path(&backend_path)
   } else {
      return backend_path;
   };

   if athas_wsl::is_wsl_path(original_path) {
      return athas_wsl::build_wsl_uri(&location.distro, &linux_path);
   }

   let flavor = athas_wsl::parse_windows_unc_path(original_path)
      .map(|(_, flavor)| flavor)
      .unwrap_or(athas_wsl::WslUncFlavor::Localhost);
   athas_wsl::wsl_path_to_windows_unc(&location.distro, &linux_path, flavor)
}

#[tauri::command]
pub async fn git_clone(repository_url: String, destination_path: String) -> Result<(), String> {
   run_blocking(move || {
      git_backend::git_clone(repository_url, resolve_backend_path(destination_path))
   })
   .await
}

#[tauri::command]
pub async fn git_status(repo_path: String) -> Result<git_backend::GitStatus, String> {
   let started_at = Instant::now();
   let short = short_repo_path(&repo_path);
   log::info!("[git] git_status:start {}", short);
   let result =
      run_blocking(move || git_backend::git_status(resolve_backend_path(repo_path))).await;

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
pub async fn git_init(repo_path: String) -> Result<(), String> {
   run_blocking(move || git_backend::git_init(resolve_backend_path(repo_path))).await
}

#[tauri::command]
pub async fn git_discover_repo(path: String) -> Result<Option<String>, String> {
   run_blocking(move || {
      let backend_path = resolve_backend_path(path.clone());
      git_backend::git_discover_repo(backend_path)
         .map(|path_opt| path_opt.map(|repo_path| restore_provider_path(&path, repo_path)))
   })
   .await
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<(), String> {
   git_backend::git_commit(resolve_backend_path(repo_path), message)
}

#[tauri::command]
pub fn git_log(
   repo_path: String,
   limit: Option<u32>,
   skip: Option<u32>,
) -> Result<Vec<git_backend::GitCommit>, String> {
   git_backend::git_log(resolve_backend_path(repo_path), limit, skip)
}

#[tauri::command]
pub async fn git_diff_file(
   repo_path: String,
   file_path: String,
   staged: bool,
) -> Result<git_backend::GitDiff, String> {
   run_blocking(move || {
      git_backend::git_diff_file(resolve_backend_path(repo_path), file_path, staged)
   })
   .await
}

#[tauri::command]
pub async fn git_diff_file_with_content(
   repo_path: String,
   file_path: String,
   content: String,
   base: String,
) -> Result<git_backend::GitDiff, String> {
   run_blocking(move || {
      git_backend::git_diff_file_with_content(
         resolve_backend_path(repo_path),
         file_path,
         content,
         base,
      )
   })
   .await
}

#[tauri::command]
pub async fn git_status_diff_stats(
   repo_path: String,
) -> Result<Vec<git_backend::GitDiffStat>, String> {
   run_blocking(move || git_backend::git_status_diff_stats(resolve_backend_path(repo_path))).await
}

#[tauri::command]
pub async fn git_commit_diff(
   repo_path: String,
   commit_hash: String,
   file_path: Option<String>,
) -> Result<Vec<git_backend::GitDiff>, String> {
   run_blocking(move || {
      git_backend::git_commit_diff(resolve_backend_path(repo_path), commit_hash, file_path)
   })
   .await
}

#[tauri::command]
pub async fn git_file_at_commit(
   repo_path: String,
   commit_hash: String,
   file_path: String,
) -> Result<String, String> {
   run_blocking(move || {
      git_backend::git_file_at_commit(resolve_backend_path(repo_path), commit_hash, file_path)
   })
   .await
}

#[tauri::command]
pub async fn git_ref_diff(
   repo_path: String,
   base_ref: String,
   target_ref: String,
) -> Result<Vec<git_backend::GitDiff>, String> {
   run_blocking(move || {
      git_backend::git_ref_diff(resolve_backend_path(repo_path), base_ref, target_ref)
   })
   .await
}

#[tauri::command]
pub async fn git_blame_file(
   root_path: String,
   file_path: String,
   content: String,
) -> Result<git_backend::GitBlame, String> {
   run_blocking(move || {
      git_backend::git_blame_file(&resolve_backend_path(root_path), &file_path, &content)
   })
   .await
}

#[tauri::command]
pub fn git_branches(repo_path: String) -> Result<Vec<String>, String> {
   git_backend::git_branches(resolve_backend_path(repo_path))
}

#[tauri::command]
pub fn git_checkout(
   repo_path: String,
   branch_name: String,
) -> Result<git_backend::CheckoutResult, String> {
   git_backend::git_checkout(resolve_backend_path(repo_path), branch_name)
}

#[tauri::command]
pub fn git_create_branch(
   repo_path: String,
   branch_name: String,
   from_branch: Option<String>,
) -> Result<(), String> {
   git_backend::git_create_branch(resolve_backend_path(repo_path), branch_name, from_branch)
}

#[tauri::command]
pub fn git_delete_branch(repo_path: String, branch_name: String) -> Result<(), String> {
   git_backend::git_delete_branch(resolve_backend_path(repo_path), branch_name)
}

#[tauri::command]
pub async fn git_push(
   repo_path: String,
   branch: Option<String>,
   remote: String,
) -> Result<(), String> {
   run_blocking(move || git_backend::git_push(resolve_backend_path(repo_path), branch, remote))
      .await
}

#[tauri::command]
pub async fn git_pull(
   repo_path: String,
   branch: Option<String>,
   remote: String,
) -> Result<(), String> {
   run_blocking(move || git_backend::git_pull(resolve_backend_path(repo_path), branch, remote))
      .await
}

#[tauri::command]
pub async fn git_fetch(repo_path: String, remote: Option<String>) -> Result<(), String> {
   run_blocking(move || git_backend::git_fetch(resolve_backend_path(repo_path), remote)).await
}

#[tauri::command]
pub fn git_get_remotes(repo_path: String) -> Result<Vec<git_backend::GitRemote>, String> {
   git_backend::git_get_remotes(resolve_backend_path(repo_path))
}

#[tauri::command]
pub fn git_add_remote(repo_path: String, name: String, url: String) -> Result<(), String> {
   git_backend::git_add_remote(resolve_backend_path(repo_path), name, url)
}

#[tauri::command]
pub fn git_remove_remote(repo_path: String, name: String) -> Result<(), String> {
   git_backend::git_remove_remote(resolve_backend_path(repo_path), name)
}

#[tauri::command]
pub async fn git_add(repo_path: String, file_path: String) -> Result<(), String> {
   run_blocking(move || git_backend::git_add(resolve_backend_path(repo_path), file_path)).await
}

#[tauri::command]
pub async fn git_reset(repo_path: String, file_path: String) -> Result<(), String> {
   run_blocking(move || git_backend::git_reset(resolve_backend_path(repo_path), file_path)).await
}

#[tauri::command]
pub async fn git_add_all(repo_path: String) -> Result<(), String> {
   run_blocking(move || git_backend::git_add_all(resolve_backend_path(repo_path))).await
}

#[tauri::command]
pub async fn git_reset_all(repo_path: String) -> Result<(), String> {
   run_blocking(move || git_backend::git_reset_all(resolve_backend_path(repo_path))).await
}

#[tauri::command]
pub fn git_discard_file_changes(repo_path: String, file_path: String) -> Result<(), String> {
   git_backend::git_discard_file_changes(resolve_backend_path(repo_path), file_path)
}

#[tauri::command]
pub fn git_discard_all_changes(repo_path: String) -> Result<(), String> {
   git_backend::git_discard_all_changes(resolve_backend_path(repo_path))
}

#[tauri::command]
pub fn git_get_stashes(repo_path: String) -> Result<Vec<git_backend::GitStash>, String> {
   git_backend::git_get_stashes(resolve_backend_path(repo_path))
}

#[tauri::command]
pub fn git_create_stash(
   repo_path: String,
   message: Option<String>,
   include_untracked: bool,
   files: Option<Vec<String>>,
) -> Result<(), String> {
   git_backend::git_create_stash(
      resolve_backend_path(repo_path),
      message,
      include_untracked,
      files,
   )
}

#[tauri::command]
pub fn git_apply_stash(repo_path: String, stash_index: usize) -> Result<(), String> {
   git_backend::git_apply_stash(resolve_backend_path(repo_path), stash_index)
}

#[tauri::command]
pub fn git_pop_stash(repo_path: String, stash_index: Option<usize>) -> Result<(), String> {
   git_backend::git_pop_stash(resolve_backend_path(repo_path), stash_index)
}

#[tauri::command]
pub fn git_drop_stash(repo_path: String, stash_index: usize) -> Result<(), String> {
   git_backend::git_drop_stash(resolve_backend_path(repo_path), stash_index)
}

#[tauri::command]
pub async fn git_stash_diff(
   repo_path: String,
   stash_index: usize,
) -> Result<Vec<git_backend::GitDiff>, String> {
   run_blocking(move || git_backend::git_stash_diff(resolve_backend_path(repo_path), stash_index))
      .await
}

#[tauri::command]
pub fn git_get_tags(repo_path: String) -> Result<Vec<git_backend::GitTag>, String> {
   git_backend::git_get_tags(resolve_backend_path(repo_path))
}

#[tauri::command]
pub fn git_create_tag(
   repo_path: String,
   name: String,
   message: Option<String>,
   commit: Option<String>,
   signed: bool,
) -> Result<(), String> {
   git_backend::git_create_tag(
      resolve_backend_path(repo_path),
      name,
      message,
      commit,
      signed,
   )
}

#[tauri::command]
pub fn git_delete_tag(repo_path: String, name: String) -> Result<(), String> {
   git_backend::git_delete_tag(resolve_backend_path(repo_path), name)
}

#[tauri::command]
pub async fn git_push_tag(repo_path: String, name: String, remote: String) -> Result<(), String> {
   run_blocking(move || git_backend::git_push_tag(resolve_backend_path(repo_path), name, remote))
      .await
}

#[tauri::command]
pub async fn git_delete_remote_tag(
   repo_path: String,
   name: String,
   remote: String,
) -> Result<(), String> {
   run_blocking(move || {
      git_backend::git_delete_remote_tag(resolve_backend_path(repo_path), name, remote)
   })
   .await
}

#[tauri::command]
pub fn git_checkout_tag(
   repo_path: String,
   name: String,
) -> Result<git_backend::CheckoutResult, String> {
   git_backend::git_checkout_tag(resolve_backend_path(repo_path), name)
}

#[tauri::command]
pub fn git_get_worktrees(repo_path: String) -> Result<Vec<git_backend::GitWorktree>, String> {
   let worktrees = git_backend::git_get_worktrees(resolve_backend_path(repo_path.clone()))?;
   Ok(worktrees
      .into_iter()
      .map(|mut worktree| {
         worktree.path = restore_provider_path(&repo_path, worktree.path);
         worktree
      })
      .collect())
}

#[tauri::command]
pub fn git_add_worktree(
   repo_path: String,
   path: String,
   branch: Option<String>,
   create_branch: bool,
) -> Result<(), String> {
   git_backend::git_add_worktree(resolve_backend_path(repo_path), path, branch, create_branch)
}

#[tauri::command]
pub fn git_remove_worktree(repo_path: String, path: String, force: bool) -> Result<(), String> {
   git_backend::git_remove_worktree(resolve_backend_path(repo_path), path, force)
}

#[tauri::command]
pub fn git_prune_worktrees(repo_path: String) -> Result<(), String> {
   git_backend::git_prune_worktrees(resolve_backend_path(repo_path))
}

#[tauri::command]
pub fn git_stage_hunk(repo_path: String, hunk: git_backend::GitHunk) -> Result<(), String> {
   git_backend::git_stage_hunk(resolve_backend_path(repo_path), hunk)
}

#[tauri::command]
pub fn git_unstage_hunk(repo_path: String, hunk: git_backend::GitHunk) -> Result<(), String> {
   git_backend::git_unstage_hunk(resolve_backend_path(repo_path), hunk)
}

#[cfg(test)]
mod tests {
   use super::restore_provider_path;

   #[test]
   fn restores_wsl_uris_from_share_and_linux_paths() {
      assert_eq!(
         restore_provider_path(
            "wsl://Ubuntu/home/me/repo/src",
            "//wsl.localhost/Ubuntu/home/me/repo/".to_string()
         ),
         "wsl://Ubuntu/home/me/repo"
      );
      assert_eq!(
         restore_provider_path(
            "wsl://Ubuntu/home/me/repo",
            r"\\wsl$\Ubuntu\home\me\repo".to_string()
         ),
         "wsl://Ubuntu/home/me/repo"
      );
      assert_eq!(
         restore_provider_path("wsl://Ubuntu/home/me/repo", "/home/me/repo\n".to_string()),
         "wsl://Ubuntu/home/me/repo"
      );
      assert_eq!(
         restore_provider_path(
            "wsl://Ubuntu/home/me/repo",
            "wsl://Ubuntu/home/me/repo".to_string()
         ),
         "wsl://Ubuntu/home/me/repo"
      );
   }

   #[test]
   fn restores_share_paths_in_the_flavor_the_frontend_used() {
      assert_eq!(
         restore_provider_path(
            r"\\wsl$\Ubuntu\home\me\repo",
            "/home/me/repo/worktree".to_string()
         ),
         r"\\wsl$\Ubuntu\home\me\repo\worktree"
      );
      assert_eq!(
         restore_provider_path(
            "//wsl.localhost/Ubuntu/home/me/repo",
            "//wsl.localhost/Ubuntu/home/me/repo/".to_string()
         ),
         r"\\wsl.localhost\Ubuntu\home\me\repo"
      );
   }

   #[test]
   fn leaves_local_and_unrelated_paths_alone() {
      assert_eq!(
         restore_provider_path("/home/me/repo", "/home/me/repo/".to_string()),
         "/home/me/repo/"
      );
      assert_eq!(
         restore_provider_path("wsl://Ubuntu/home/me/repo", "relative/path".to_string()),
         "relative/path"
      );
   }
}
