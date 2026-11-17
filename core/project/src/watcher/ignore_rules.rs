use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::{
   collections::HashMap,
   ffi::OsStr,
   path::{Component, Path, PathBuf},
   sync::Arc,
};

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

/// Ignore files read in every directory, in increasing precedence.
const IGNORE_FILE_NAMES: &[&str] = &[".gitignore", ".ignore"];

/// Past this many cached directory matchers the cache starts over, so a long session over a
/// huge tree does not keep one matcher per directory it ever saw.
const MAX_CACHED_DIRS: usize = 4096;

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

pub fn is_ignore_file(path: &Path) -> bool {
   path
      .file_name()
      .and_then(OsStr::to_str)
      .is_some_and(|name| IGNORE_FILE_NAMES.contains(&name))
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

/// The `.gitignore` / `.ignore` rules of one workspace root, read lazily per directory.
pub struct IgnoreRules {
   root: PathBuf,
   per_directory: HashMap<PathBuf, Option<Arc<Gitignore>>>,
   repository: Option<Arc<(Gitignore, Gitignore)>>,
}

impl IgnoreRules {
   pub fn new(root: impl Into<PathBuf>) -> Self {
      Self {
         root: root.into(),
         per_directory: HashMap::new(),
         repository: None,
      }
   }

   /// Forgets every matcher read so far. Called when an ignore file changes.
   pub fn invalidate(&mut self) {
      self.per_directory.clear();
      self.repository = None;
   }

   /// Whether `relative` (relative to the root) is ignored, checking the ignore files of every
   /// directory from the deepest one up to the root, then `.git/info/exclude` and the global
   /// excludes file.
   pub fn is_ignored(&mut self, relative: &Path, is_dir: bool) -> bool {
      let absolute = self.root.join(relative);
      let mut directory = relative.parent().map(Path::to_path_buf);

      while let Some(current) = directory {
         if let Some(matcher) = self.matcher_for(&current) {
            let matched = matcher.matched_path_or_any_parents(&absolute, is_dir);
            if matched.is_ignore() {
               return true;
            }
            if matched.is_whitelist() {
               return false;
            }
         }
         directory = current.parent().map(Path::to_path_buf);
      }

      let repository = self.repository_matchers();
      for matcher in [&repository.0, &repository.1] {
         let matched = matcher.matched_path_or_any_parents(&absolute, is_dir);
         if matched.is_ignore() {
            return true;
         }
         if matched.is_whitelist() {
            return false;
         }
      }
      false
   }

   fn matcher_for(&mut self, relative_dir: &Path) -> Option<Arc<Gitignore>> {
      if let Some(cached) = self.per_directory.get(relative_dir) {
         return cached.clone();
      }
      if self.per_directory.len() >= MAX_CACHED_DIRS {
         self.per_directory.clear();
      }

      let directory = self.root.join(relative_dir);
      let mut builder = GitignoreBuilder::new(&directory);
      let mut found = false;
      for name in IGNORE_FILE_NAMES {
         let path = directory.join(name);
         if path.is_file() {
            found = true;
            if let Some(error) = builder.add(&path) {
               log::debug!("[FileWatcher] Partially read {}: {error}", path.display());
            }
         }
      }

      let matcher = found
         .then(|| builder.build().ok())
         .flatten()
         .filter(|matcher| !matcher.is_empty())
         .map(Arc::new);
      self
         .per_directory
         .insert(relative_dir.to_path_buf(), matcher.clone());
      matcher
   }

   fn repository_matchers(&mut self) -> Arc<(Gitignore, Gitignore)> {
      if let Some(matchers) = &self.repository {
         return matchers.clone();
      }

      let mut exclude = GitignoreBuilder::new(&self.root);
      let exclude_path = self.root.join(".git").join("info").join("exclude");
      if exclude_path.is_file()
         && let Some(error) = exclude.add(&exclude_path)
      {
         log::debug!(
            "[FileWatcher] Partially read {}: {error}",
            exclude_path.display()
         );
      }
      let exclude = exclude.build().unwrap_or_else(|_| Gitignore::empty());
      let (global, _) = GitignoreBuilder::new(&self.root).build_global();

      let matchers = Arc::new((exclude, global));
      self.repository = Some(matchers.clone());
      matchers
   }
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

   #[test]
   fn respects_nested_ignore_files_and_negations() {
      let temp = tempfile::tempdir().unwrap();
      let root = temp.path();
      std::fs::create_dir_all(root.join("logs/keep")).unwrap();
      std::fs::create_dir_all(root.join("web/generated")).unwrap();
      std::fs::write(root.join(".gitignore"), "*.log\n/coverage/\n").unwrap();
      std::fs::write(root.join("web/.gitignore"), "generated/\n!important.log\n").unwrap();
      std::fs::write(root.join("web/.ignore"), "*.tmp\n").unwrap();

      let mut rules = IgnoreRules::new(root);
      assert!(rules.is_ignored(Path::new("debug.log"), false));
      assert!(rules.is_ignored(Path::new("logs/keep/today.log"), false));
      assert!(rules.is_ignored(Path::new("coverage"), true));
      assert!(rules.is_ignored(Path::new("coverage/lcov.info"), false));
      assert!(rules.is_ignored(Path::new("web/generated/types.ts"), false));
      assert!(rules.is_ignored(Path::new("web/scratch.tmp"), false));
      assert!(!rules.is_ignored(Path::new("web/important.log"), false));
      assert!(!rules.is_ignored(Path::new("src/main.rs"), false));
      assert!(!rules.is_ignored(Path::new("web/src/app.tsx"), false));
   }

   #[test]
   fn reads_info_exclude_and_picks_up_rule_changes_after_invalidate() {
      let temp = tempfile::tempdir().unwrap();
      let root = temp.path();
      std::fs::create_dir_all(root.join(".git/info")).unwrap();
      std::fs::write(root.join(".git/info/exclude"), "local-notes.md\n").unwrap();

      let mut rules = IgnoreRules::new(root);
      assert!(rules.is_ignored(Path::new("local-notes.md"), false));
      assert!(!rules.is_ignored(Path::new("data.watchtest"), false));

      std::fs::write(root.join(".gitignore"), "*.watchtest\n").unwrap();
      assert!(
         !rules.is_ignored(Path::new("data.watchtest"), false),
         "matchers are cached until invalidated"
      );
      rules.invalidate();
      assert!(rules.is_ignored(Path::new("data.watchtest"), false));
   }

   #[test]
   fn bounds_the_directory_cache() {
      let temp = tempfile::tempdir().unwrap();
      let mut rules = IgnoreRules::new(temp.path());
      for index in 0..(MAX_CACHED_DIRS + 10) {
         rules.is_ignored(&PathBuf::from(format!("d{index}/file.rs")), false);
      }
      assert!(rules.per_directory.len() <= MAX_CACHED_DIRS);
   }
}
