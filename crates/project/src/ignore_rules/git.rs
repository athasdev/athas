use super::{IgnoreScope, ScopeMatch};
use std::{
   collections::HashMap,
   ffi::OsStr,
   path::{Path, PathBuf},
   sync::Arc,
};

/// Ignore files read in every directory, in increasing precedence.
const IGNORE_FILE_NAMES: &[&str] = &[".gitignore", ".ignore"];

/// Past this many cached directory matchers the cache starts over, so a long session over a
/// huge tree does not keep one matcher per directory it ever saw.
const MAX_CACHED_DIRS: usize = 4096;

pub fn is_ignore_file(path: &Path) -> bool {
   path
      .file_name()
      .and_then(OsStr::to_str)
      .is_some_and(|name| IGNORE_FILE_NAMES.contains(&name))
}

/// The `.gitignore` / `.ignore` rules of one workspace root, read lazily per directory, plus
/// `.git/info/exclude` and the global excludes file. Ignore files that cannot be read, and lines
/// that do not compile, are skipped.
pub struct GitIgnoreRules {
   root: PathBuf,
   per_directory: HashMap<PathBuf, Option<Arc<IgnoreScope>>>,
   repository: Option<Arc<Vec<IgnoreScope>>>,
   global_excludes: bool,
}

impl GitIgnoreRules {
   pub fn new(root: impl Into<PathBuf>) -> Self {
      Self {
         root: root.into(),
         per_directory: HashMap::new(),
         repository: None,
         global_excludes: true,
      }
   }

   /// Rules for a root whose global excludes file is not the one this process's git config
   /// names, such as a WSL distribution reached from Windows.
   pub fn without_global_excludes(root: impl Into<PathBuf>) -> Self {
      Self {
         global_excludes: false,
         ..Self::new(root)
      }
   }

   /// Forgets every matcher read so far. Called when an ignore file changes.
   pub fn invalidate(&mut self) {
      self.per_directory.clear();
      self.repository = None;
   }

   /// Whether `relative` (relative to the root) is ignored: it or one of its parent directories
   /// is excluded by the ignore files of the directories above it (the deepest one deciding),
   /// then by `.git/info/exclude` and the global excludes file.
   pub fn is_ignored(&mut self, relative: &Path, is_dir: bool) -> bool {
      let parents: Vec<PathBuf> = relative
         .ancestors()
         .skip(1)
         .filter(|parent| !parent.as_os_str().is_empty())
         .map(Path::to_path_buf)
         .collect();
      // Git never descends into an excluded directory, so a `!pattern` below it cannot bring a
      // path back.
      for parent in parents.iter().rev() {
         if self.is_excluded(parent, true) {
            return true;
         }
      }
      self.is_excluded(relative, is_dir)
   }

   fn is_excluded(&mut self, relative: &Path, is_dir: bool) -> bool {
      let absolute = self.root.join(relative);
      let mut directory = relative.parent().map(Path::to_path_buf);

      while let Some(current) = directory {
         if let Some(scope) = self.scope_for(&current) {
            match scope.matched(&absolute, is_dir) {
               ScopeMatch::Ignore => return true,
               ScopeMatch::Allow => return false,
               ScopeMatch::None => {}
            }
         }
         directory = current.parent().map(Path::to_path_buf);
      }

      for scope in self.repository_scopes().iter() {
         match scope.matched(&absolute, is_dir) {
            ScopeMatch::Ignore => return true,
            ScopeMatch::Allow => return false,
            ScopeMatch::None => {}
         }
      }
      false
   }

   fn scope_for(&mut self, relative_dir: &Path) -> Option<Arc<IgnoreScope>> {
      if let Some(cached) = self.per_directory.get(relative_dir) {
         return cached.clone();
      }
      if self.per_directory.len() >= MAX_CACHED_DIRS {
         self.per_directory.clear();
      }

      let directory = self.root.join(relative_dir);
      let scope = self
         .read_scope(
            &directory,
            IGNORE_FILE_NAMES.iter().map(|name| directory.join(name)),
         )
         .map(Arc::new);
      self
         .per_directory
         .insert(relative_dir.to_path_buf(), scope.clone());
      scope
   }

   fn repository_scopes(&mut self) -> Arc<Vec<IgnoreScope>> {
      if let Some(scopes) = &self.repository {
         return scopes.clone();
      }

      let exclude = self.root.join(".git").join("info").join("exclude");
      let mut scopes: Vec<IgnoreScope> = self
         .read_scope(&self.root, std::iter::once(exclude))
         .into_iter()
         .collect();
      if self.global_excludes {
         scopes.extend(IgnoreScope::global_excludes(&self.root));
      }

      let scopes = Arc::new(scopes);
      self.repository = Some(scopes.clone());
      scopes
   }

   fn read_scope(
      &self,
      directory: &Path,
      paths: impl Iterator<Item = PathBuf>,
   ) -> Option<IgnoreScope> {
      let mut builder = IgnoreScope::builder(directory);
      for path in paths.filter(|path| path.is_file()) {
         if let Err(error) = builder.add(&path) {
            log::debug!("[IgnoreRules] Partially read {}: {error}", path.display());
         }
      }
      builder.build().ok().flatten()
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn respects_nested_ignore_files_and_negations() {
      let temp = tempfile::tempdir().unwrap();
      let root = temp.path();
      std::fs::create_dir_all(root.join("logs/keep")).unwrap();
      std::fs::create_dir_all(root.join("web/generated")).unwrap();
      std::fs::write(root.join(".gitignore"), "*.log\n/coverage/\n").unwrap();
      std::fs::write(root.join("web/.gitignore"), "generated/\n!important.log\n").unwrap();
      std::fs::write(root.join("web/.ignore"), "*.tmp\n").unwrap();

      let mut rules = GitIgnoreRules::new(root);
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

      let mut rules = GitIgnoreRules::new(root);
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
   fn matches_globstar_directories_and_excluded_parents_like_git() {
      let temp = tempfile::tempdir().unwrap();
      let root = temp.path();
      std::fs::create_dir_all(root.join("build")).unwrap();
      std::fs::create_dir_all(root.join("sub/nested")).unwrap();
      std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
      std::fs::write(root.join("build/.gitignore"), "!keep.log\n").unwrap();
      std::fs::write(root.join("sub/.gitignore"), "/**/\n").unwrap();

      let mut rules = GitIgnoreRules::without_global_excludes(root);
      assert!(rules.is_ignored(Path::new("build/keep.log"), false));
      assert!(rules.is_ignored(Path::new("sub/nested"), true));
      assert!(rules.is_ignored(Path::new("sub/nested/file.rs"), false));
      assert!(!rules.is_ignored(Path::new("sub/notes.md"), false));
      assert!(!rules.is_ignored(Path::new("sub/.gitignore"), false));
   }

   #[test]
   fn bounds_the_directory_cache() {
      let temp = tempfile::tempdir().unwrap();
      let mut rules = GitIgnoreRules::new(temp.path());
      for index in 0..(MAX_CACHED_DIRS + 10) {
         rules.is_ignored(&PathBuf::from(format!("d{index}/file.rs")), false);
      }
      assert!(rules.per_directory.len() <= MAX_CACHED_DIRS);
   }
}
