use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::path::Path;

/// How an [`IgnoreScope`] answers for one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeMatch {
   None,
   Ignore,
   /// A `!pattern` brings the path back.
   Allow,
}

/// Rules in gitignore syntax, anchored at the directory whose ignore files hold them.
pub struct IgnoreScope {
   matcher: Gitignore,
}

pub struct IgnoreScopeBuilder {
   builder: GitignoreBuilder,
}

impl IgnoreScope {
   pub fn builder(directory: &Path) -> IgnoreScopeBuilder {
      IgnoreScopeBuilder {
         builder: GitignoreBuilder::new(directory),
      }
   }

   /// The excludes file this machine's git config names (`core.excludesFile`), anchored at
   /// `root`.
   pub fn global_excludes(root: &Path) -> Option<Self> {
      let (matcher, error) = GitignoreBuilder::new(root).build_global();
      if let Some(error) = error {
         log::debug!("[IgnoreRules] Partially read the global excludes file: {error}");
      }
      (!matcher.is_empty()).then_some(Self { matcher })
   }

   /// The decision for `path` itself, never for its parent directories.
   pub fn matched(&self, path: &Path, is_dir: bool) -> ScopeMatch {
      if !path.starts_with(self.matcher.path()) {
         return ScopeMatch::None;
      }
      let matched = self.matcher.matched(path, is_dir);
      if matched.is_ignore() {
         ScopeMatch::Ignore
      } else if matched.is_whitelist() {
         ScopeMatch::Allow
      } else {
         ScopeMatch::None
      }
   }

   /// The decision for the nearest of `path` and its parent directories that a rule matches,
   /// short of the scope's own directory. `Gitignore::matched_path_or_any_parents` also tests
   /// that directory, as an empty path, and a `/**/` rule matches it, which would ignore every
   /// file beside the rule.
   pub fn matched_path_or_parents(&self, path: &Path, is_dir: bool) -> ScopeMatch {
      let directory = self.matcher.path();
      let mut current = path;
      let mut current_is_dir = is_dir;
      while current != directory && current.starts_with(directory) {
         let matched = self.matched(current, current_is_dir);
         if matched != ScopeMatch::None {
            return matched;
         }
         let Some(parent) = current.parent() else {
            break;
         };
         current = parent;
         current_is_dir = true;
      }
      ScopeMatch::None
   }
}

impl IgnoreScopeBuilder {
   /// Adds the rules of the ignore file at `file`. Lines that do not compile are reported, and
   /// the others still apply.
   pub fn add(&mut self, file: &Path) -> Result<(), String> {
      match self.builder.add(file) {
         Some(error) => Err(error.to_string()),
         None => Ok(()),
      }
   }

   /// `None` when no line holds a rule.
   pub fn build(self) -> Result<Option<IgnoreScope>, String> {
      let matcher = self.builder.build().map_err(|error| error.to_string())?;
      Ok((!matcher.is_empty()).then_some(IgnoreScope { matcher }))
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::path::PathBuf;

   fn scope(rules: &str) -> (tempfile::TempDir, PathBuf, IgnoreScope) {
      let temp = tempfile::tempdir().unwrap();
      let root = temp.path().to_path_buf();
      std::fs::write(root.join(".gitignore"), rules).unwrap();
      let mut builder = IgnoreScope::builder(&root);
      builder.add(&root.join(".gitignore")).unwrap();
      let scope = builder.build().unwrap().unwrap();
      (temp, root, scope)
   }

   #[test]
   fn matches_a_path_itself_and_reports_negations() {
      let (_temp, root, scope) = scope("*.log\n!keep.log\nbuild/\n");

      assert_eq!(
         scope.matched(&root.join("debug.log"), false),
         ScopeMatch::Ignore
      );
      assert_eq!(
         scope.matched(&root.join("keep.log"), false),
         ScopeMatch::Allow
      );
      assert_eq!(scope.matched(&root.join("build"), true), ScopeMatch::Ignore);
      assert_eq!(
         scope.matched(&root.join("build/out.js"), false),
         ScopeMatch::None
      );
      assert_eq!(
         scope.matched(Path::new("/elsewhere/debug.log"), false),
         ScopeMatch::None
      );
   }

   #[test]
   fn takes_the_nearest_decision_without_testing_its_own_directory() {
      let (_temp, root, globstar) = scope("/**/\n");
      assert_eq!(
         globstar.matched_path_or_parents(&root.join("notes.md"), false),
         ScopeMatch::None
      );
      assert_eq!(
         globstar.matched_path_or_parents(&root.join("sub/a.rs"), false),
         ScopeMatch::Ignore
      );

      let (_temp, root, nested) = scope("build/\n!build/keep.js\n");
      assert_eq!(
         nested.matched_path_or_parents(&root.join("build/out.js"), false),
         ScopeMatch::Ignore
      );
      assert_eq!(
         nested.matched_path_or_parents(&root.join("build/keep.js"), false),
         ScopeMatch::Allow
      );
   }

   #[test]
   fn builds_nothing_from_files_without_rules() {
      let temp = tempfile::tempdir().unwrap();
      let file = temp.path().join(".gitignore");
      std::fs::write(&file, "# comment\n\n").unwrap();
      let mut builder = IgnoreScope::builder(temp.path());
      builder.add(&file).unwrap();
      assert!(builder.build().unwrap().is_none());
   }
}
