use std::path::{Component, Path, PathBuf};

/// Directory names whose contents never reach the frontend, whatever the ignore files say. They
/// are build output, dependency caches, or tool state that churn far faster than anyone reads
/// them in a file tree.
pub const ALWAYS_IGNORED_DIRS: &[&str] = &[
   "node_modules",
   "target",
   "dist",
   "build",
   ".next",
   ".nuxt",
   ".svelte-kit",
   ".turbo",
   ".parcel-cache",
   ".cache",
   ".gradle",
   ".venv",
   "__pycache__",
   ".pytest_cache",
   ".mypy_cache",
];

/// Where a path inside a workspace root falls for the watcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathClass {
   /// A worktree path the frontend should hear about (subject to the ignore files).
   Worktree,
   /// A file inside the root `.git` directory whose change can move the Git view.
   GitState,
   /// Never reported: other `.git` internals, nested repositories, and always-ignored dirs.
   Dropped,
}

/// Classifies `relative`, a path relative to the workspace root, before any ignore file is read.
pub fn classify(relative: &Path) -> PathClass {
   let mut components = relative
      .components()
      .filter_map(|component| match component {
         Component::Normal(name) => Some(name),
         _ => None,
      });

   let Some(first) = components.next() else {
      return PathClass::Dropped;
   };

   if first == ".git" {
      let rest: PathBuf = components.collect();
      return if is_git_state_path(&rest) {
         PathClass::GitState
      } else {
         PathClass::Dropped
      };
   }

   let dropped = std::iter::once(first).chain(components).any(|name| {
      name == ".git"
         || name
            .to_str()
            .is_some_and(|name| ALWAYS_IGNORED_DIRS.contains(&name))
   });
   if dropped {
      PathClass::Dropped
   } else {
      PathClass::Worktree
   }
}

/// Whether `inside_git_dir` (relative to `.git`) is state the Git view shows: the checked out
/// commit, the index, refs, and in-progress merge/cherry-pick/revert markers. Objects, hooks and
/// lock files churn during every git command and say nothing on their own.
pub fn is_git_state_path(inside_git_dir: &Path) -> bool {
   let Some(name) = inside_git_dir.to_str() else {
      return false;
   };
   let name = name.replace('\\', "/");
   if name.ends_with(".lock") {
      return false;
   }

   matches!(
      name.as_str(),
      "HEAD"
         | "index"
         | "packed-refs"
         | "ORIG_HEAD"
         | "FETCH_HEAD"
         | "MERGE_HEAD"
         | "CHERRY_PICK_HEAD"
         | "REVERT_HEAD"
         | "REBASE_HEAD"
         | "logs/HEAD"
   ) || name.starts_with("refs/")
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn classifies_git_state_and_dropped_paths() {
      assert_eq!(classify(Path::new("src/main.rs")), PathClass::Worktree);
      assert_eq!(classify(Path::new(".gitignore")), PathClass::Worktree);
      assert_eq!(classify(Path::new(".github/ci.yml")), PathClass::Worktree);
      assert_eq!(classify(Path::new("build.rs")), PathClass::Worktree);

      for path in [
         ".git/HEAD",
         ".git/index",
         ".git/packed-refs",
         ".git/logs/HEAD",
         ".git/refs/heads/main",
         ".git/refs/remotes/origin/main",
         ".git/MERGE_HEAD",
      ] {
         assert_eq!(classify(Path::new(path)), PathClass::GitState, "{path}");
      }

      for path in [
         "",
         ".git",
         ".git/objects/ab/cdef",
         ".git/index.lock",
         ".git/refs/heads/main.lock",
         ".git/hooks/pre-commit",
         "vendor/lib/.git/HEAD",
         "node_modules/react/index.js",
         "web/node_modules/.bin/vite",
         "target/debug/athas",
         "crates/project/target",
         "app/dist/index.html",
         "pkg/__pycache__/mod.pyc",
      ] {
         assert_eq!(classify(Path::new(path)), PathClass::Dropped, "{path}");
      }
   }
}
