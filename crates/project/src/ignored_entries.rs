use crate::ignore_rules::GitIgnoreRules;
use std::{fs, path::Path};

/// Names of the entries of `directory` that the ignore files of `root` exclude: `.gitignore` and
/// `.ignore` files from `directory` up to `root`, `.git/info/exclude`, and the global excludes
/// file. Empty when `directory` is outside `root`.
pub fn ignored_entry_names(root: &Path, directory: &Path) -> Result<Vec<String>, String> {
   collect_ignored_entry_names(GitIgnoreRules::new(root), root, directory)
}

/// Like [`ignored_entry_names`] without the global excludes file, for a root on another system
/// whose git config this process cannot read.
pub fn ignored_entry_names_without_global_excludes(
   root: &Path,
   directory: &Path,
) -> Result<Vec<String>, String> {
   collect_ignored_entry_names(
      GitIgnoreRules::without_global_excludes(root),
      root,
      directory,
   )
}

fn collect_ignored_entry_names(
   mut rules: GitIgnoreRules,
   root: &Path,
   directory: &Path,
) -> Result<Vec<String>, String> {
   let Ok(relative_directory) = directory.strip_prefix(root) else {
      return Ok(Vec::new());
   };

   let entries = fs::read_dir(directory)
      .map_err(|error| format!("Failed to read {}: {error}", directory.display()))?;

   let mut names = Vec::new();
   for entry in entries.flatten() {
      let file_name = entry.file_name();
      // Git never applies ignore rules to its own directory.
      if file_name == ".git" {
         continue;
      }
      let Some(name) = file_name.to_str() else {
         continue;
      };
      // Git does not follow symlinks, so a link to a directory is matched as a file.
      let is_dir = entry.file_type().is_ok_and(|file_type| file_type.is_dir());
      if rules.is_ignored(&relative_directory.join(name), is_dir) {
         names.push(name.to_string());
      }
   }
   names.sort();
   Ok(names)
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::path::PathBuf;

   fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
      let temp = tempfile::tempdir().unwrap();
      for (path, content) in files {
         let path = temp.path().join(path);
         fs::create_dir_all(path.parent().unwrap()).unwrap();
         if path.to_string_lossy().ends_with('/') {
            fs::create_dir_all(&path).unwrap();
         } else {
            fs::write(&path, content).unwrap();
         }
      }
      temp
   }

   fn ignored(root: &Path, directory: &str) -> Vec<String> {
      ignored_entry_names_without_global_excludes(root, &root.join(directory)).unwrap()
   }

   #[test]
   fn applies_nested_ignore_files_relative_to_their_directory() {
      let temp = tree(&[
         (".gitignore", "target/\n*.tmp\n"),
         ("target/", ""),
         ("src/file.tmp", ""),
         ("src/main.ts", ""),
         ("subprojects/.gitignore", "/**/\npackagecache\n"),
         ("subprojects/zerocopy-0.8.48/", ""),
         ("subprojects/packagecache", ""),
         ("subprojects/notes.md", ""),
         ("zerocopy-0.8.48/", ""),
      ]);
      let root = temp.path();

      assert_eq!(ignored(root, ""), vec!["target"]);
      assert_eq!(ignored(root, "src"), vec!["file.tmp"]);
      assert_eq!(
         ignored(root, "subprojects"),
         vec!["packagecache", "zerocopy-0.8.48"]
      );
   }

   #[test]
   fn lets_deeper_rules_unignore_unless_a_parent_directory_is_ignored() {
      let temp = tree(&[
         (".gitignore", "*.log\nbuild/\n"),
         ("logs/.gitignore", "!keep.log\n"),
         ("logs/error.log", ""),
         ("logs/keep.log", ""),
         ("build/.gitignore", "!keep.log\n"),
         ("build/keep.log", ""),
      ]);
      let root = temp.path();

      assert_eq!(ignored(root, "logs"), vec!["error.log"]);
      assert_eq!(ignored(root, "build"), vec![".gitignore", "keep.log"]);
   }

   #[test]
   fn handles_anchored_and_directory_only_patterns() {
      let temp = tree(&[
         ("sub/.gitignore", "/cache\nbuild/\n"),
         ("sub/cache", ""),
         ("sub/build/", ""),
         ("sub/build.txt", ""),
         ("sub/deep/cache", ""),
      ]);
      let root = temp.path();

      assert_eq!(ignored(root, "sub"), vec!["build", "cache"]);
      assert!(ignored(root, "sub/deep").is_empty());
   }

   #[test]
   fn keeps_valid_rules_around_a_malformed_line() {
      let temp = tree(&[
         (".gitignore", "valid.out\n[z-a]\n\\#literal-hash\n"),
         ("valid.out", ""),
         ("#literal-hash", ""),
         ("kept.txt", ""),
      ]);

      assert_eq!(ignored(temp.path(), ""), vec!["#literal-hash", "valid.out"]);
   }

   #[test]
   fn never_reports_the_git_directory() {
      let temp = tree(&[
         (".gitignore", ".git\n*\n!.gitignore\n"),
         (".git/HEAD", ""),
         ("file.txt", ""),
      ]);

      assert_eq!(ignored(temp.path(), ""), vec!["file.txt"]);
   }

   #[cfg(unix)]
   #[test]
   fn treats_a_symlink_to_a_directory_as_a_file_like_git() {
      let temp = tree(&[(".gitignore", "build/\n"), ("real/", "")]);
      std::os::unix::fs::symlink(temp.path().join("real"), temp.path().join("build")).unwrap();

      assert!(ignored(temp.path(), "").is_empty());
   }

   #[test]
   fn reads_info_exclude_and_ignore_files() {
      let temp = tree(&[
         (".git/info/exclude", "local-notes.md\n"),
         (".ignore", "*.snap\n"),
         ("local-notes.md", ""),
         ("view.snap", ""),
         ("view.tsx", ""),
      ]);

      assert_eq!(
         ignored(temp.path(), ""),
         vec!["local-notes.md", "view.snap"]
      );
   }

   #[test]
   fn returns_nothing_for_a_directory_outside_the_root() {
      let temp = tree(&[(".gitignore", "*.log\n"), ("app/debug.log", "")]);
      let other = tree(&[("debug.log", "")]);

      assert!(
         ignored_entry_names_without_global_excludes(&temp.path().join("app"), other.path())
            .unwrap()
            .is_empty()
      );
      assert!(
         ignored_entry_names(&PathBuf::from(temp.path()).join("app"), other.path())
            .unwrap()
            .is_empty()
      );
   }
}
