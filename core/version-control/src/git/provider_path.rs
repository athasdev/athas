//! Translates between the repository paths the frontend uses (local paths, `wsl://` URIs, and
//! `\\wsl$` share paths) and the paths the git backend operates on.

use super::{GitWorktree, git_discover_repo, git_get_worktrees};

/// The path the git backend should open for a frontend repository path: WSL URIs become the
/// Windows share path libgit2 can read, everything else is used as is.
pub fn backend_path(path: String) -> String {
   athas_wsl::resolve_windows_path(&path).unwrap_or(path)
}

/// Maps a path reported by the git backend back into the form the frontend
/// used for the repository. Backends answer with a `\\wsl$` share path when
/// libgit2 handled the request and with a Linux path when the distribution's
/// own git did, so both are folded back into a `wsl://` URI or a share path
/// matching the original.
pub fn restore_provider_path(original_path: &str, backend_path: String) -> String {
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

/// Discovers the repository containing `path`, answering in the path form the caller used.
pub fn git_discover_provider_repo(path: String) -> Result<Option<String>, String> {
   let discovered = git_discover_repo(backend_path(path.clone()))?;
   Ok(discovered.map(|repo_path| restore_provider_path(&path, repo_path)))
}

/// Lists the repository's worktrees with paths in the form the caller used for `repo_path`.
pub fn git_provider_worktrees(repo_path: String) -> Result<Vec<GitWorktree>, String> {
   let worktrees = git_get_worktrees(backend_path(repo_path.clone()))?;
   Ok(worktrees
      .into_iter()
      .map(|mut worktree| {
         worktree.path = restore_provider_path(&repo_path, worktree.path);
         worktree
      })
      .collect())
}

#[cfg(test)]
mod tests {
   use super::*;

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

   fn path_string(path: &std::path::Path) -> String {
      path.to_string_lossy().into_owned()
   }

   fn init_repo_with_commit() -> (tempfile::TempDir, std::path::PathBuf) {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().canonicalize().unwrap().join("repo");
      let repo = git2::Repository::init(&root).unwrap();
      std::fs::write(root.join("README.md"), "hello\n").unwrap();
      let mut index = repo.index().unwrap();
      index.add_path(std::path::Path::new("README.md")).unwrap();
      index.write().unwrap();
      let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
      let signature = git2::Signature::now("Athas", "athas@example.com").unwrap();
      repo
         .commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
         .unwrap();
      (dir, root)
   }

   #[test]
   fn discovers_the_repository_root_from_a_nested_directory() {
      let (_dir, root) = init_repo_with_commit();
      let nested = root.join("src").join("deep");
      std::fs::create_dir_all(&nested).unwrap();

      let discovered = git_discover_provider_repo(path_string(&nested)).unwrap();

      let discovered = discovered.expect("repository");
      assert_eq!(
         std::path::Path::new(&discovered).canonicalize().unwrap(),
         root
      );
   }

   #[test]
   fn reports_no_repository_outside_one() {
      let dir = tempfile::tempdir().unwrap();

      assert_eq!(
         git_discover_provider_repo(path_string(dir.path())).unwrap(),
         None
      );
   }

   #[test]
   fn lists_worktrees_with_local_paths_unchanged() {
      let (_dir, root) = init_repo_with_commit();
      let linked = root.parent().unwrap().join("linked");
      let status = std::process::Command::new("git")
         .arg("-C")
         .arg(&root)
         .args(["worktree", "add", "-b", "feature"])
         .arg(&linked)
         .output()
         .expect("git worktree add");
      assert!(status.status.success(), "{status:?}");

      let worktrees = git_provider_worktrees(path_string(&root)).unwrap();

      let paths = worktrees
         .iter()
         .map(|worktree| {
            std::path::Path::new(worktree.path.trim_end_matches('/'))
               .canonicalize()
               .unwrap()
         })
         .collect::<Vec<_>>();
      assert!(paths.contains(&root), "{paths:?}");
      assert!(paths.contains(&linked), "{paths:?}");
      assert!(
         worktrees.iter().any(|worktree| worktree
            .branch
            .as_deref()
            .is_some_and(|b| b.ends_with("feature"))),
         "{paths:?}"
      );
   }

   #[test]
   fn backend_paths_leave_local_paths_alone() {
      assert_eq!(backend_path("/home/me/repo".to_string()), "/home/me/repo");
   }
}
