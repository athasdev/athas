use super::*;
use std::fs;

fn canonical_temp_dir() -> (tempfile::TempDir, PathBuf) {
   let temp = tempfile::tempdir().unwrap();
   let canonical = temp.path().canonicalize().unwrap();
   (temp, canonical)
}

fn text(path: &Path) -> &str {
   path.to_str().unwrap()
}

#[test]
fn rejects_empty_nul_and_relative_paths() {
   for (path, expected) in [
      ("", "path must not be empty"),
      ("   ", "path must not be empty"),
      ("/tmp/foo\0bar", "path must not contain NUL bytes"),
      ("notes.md", "Path must be absolute"),
      ("./notes.md", "Path must be absolute"),
      ("../notes.md", "Path must be absolute"),
      ("src/../notes.md", "Path must be absolute"),
   ] {
      assert_eq!(resolve_local_path(path).unwrap_err(), expected, "{path:?}");
      assert_eq!(
         resolve_symlink_path(path).unwrap_err(),
         expected,
         "{path:?}"
      );
   }
}

#[test]
fn accepts_paths_inside_and_outside_the_home_directory() {
   if let Some(home) = dirs::home_dir().filter(|home| home.exists()) {
      assert_eq!(
         resolve_local_path(text(&home)).unwrap(),
         home.canonicalize().unwrap()
      );
   }

   // Temp dirs live outside the home directory on Linux and macOS; workspaces may too.
   let (temp, canonical) = canonical_temp_dir();
   let file = temp.path().join("notes.md");
   fs::write(&file, "hi").unwrap();
   assert_eq!(
      resolve_local_path(text(&file)).unwrap(),
      canonical.join("notes.md")
   );
}

#[test]
fn resolves_new_targets_through_their_existing_parent() {
   let (temp, canonical) = canonical_temp_dir();
   fs::create_dir(temp.path().join("subdir")).unwrap();

   assert_eq!(
      resolve_local_path(text(&temp.path().join("subdir/new.txt"))).unwrap(),
      canonical.join("subdir/new.txt")
   );
   let error = resolve_local_path(text(&temp.path().join("missing/new.txt"))).unwrap_err();
   assert!(
      error.starts_with("Failed to resolve parent path: "),
      "{error}"
   );
}

#[test]
fn collapses_parent_directory_components() {
   let (temp, canonical) = canonical_temp_dir();
   fs::create_dir_all(temp.path().join("a/b")).unwrap();
   fs::write(temp.path().join("a/notes.md"), "hi").unwrap();

   assert_eq!(
      resolve_local_path(text(&temp.path().join("a/b/../notes.md"))).unwrap(),
      canonical.join("a/notes.md")
   );
   assert_eq!(
      resolve_local_path(text(&temp.path().join("a/b/../new.md"))).unwrap(),
      canonical.join("a/new.md"),
      "a new file under `..` lands in the resolved directory"
   );
   assert_eq!(
      resolve_local_path(text(&temp.path().join("a/b/.."))).unwrap(),
      canonical.join("a")
   );
   assert_eq!(
      resolve_symlink_path(text(&temp.path().join("a/b/../link"))).unwrap(),
      canonical.join("a/link")
   );
   assert_eq!(
      resolve_symlink_path(text(&temp.path().join("a/.."))).unwrap_err(),
      "Path has no file name"
   );
}

#[test]
fn the_filesystem_root_has_no_parent_to_resolve() {
   let root = if cfg!(windows) { r"C:\" } else { "/" };
   assert_eq!(
      resolve_symlink_path(root).unwrap_err(),
      "Path has no parent"
   );
   if Path::new(root).exists() {
      assert_eq!(
         resolve_local_path(root).unwrap(),
         Path::new(root).canonicalize().unwrap()
      );
   }
}

#[cfg(unix)]
#[test]
fn follows_symlinks_except_for_the_leaf_of_a_symlink_path() {
   use std::os::unix::fs::symlink;

   let (workspace, workspace_canonical) = canonical_temp_dir();
   let (outside, outside_canonical) = canonical_temp_dir();
   fs::write(outside.path().join("secret.txt"), "x").unwrap();
   symlink(
      outside.path().join("secret.txt"),
      workspace.path().join("file-link"),
   )
   .unwrap();
   symlink(outside.path(), workspace.path().join("dir-link")).unwrap();
   symlink(
      workspace.path().join("gone.txt"),
      workspace.path().join("dangling"),
   )
   .unwrap();

   assert_eq!(
      resolve_local_path(text(&workspace.path().join("file-link"))).unwrap(),
      outside_canonical.join("secret.txt"),
      "an existing symlink resolves to its target"
   );
   assert_eq!(
      resolve_symlink_path(text(&workspace.path().join("file-link"))).unwrap(),
      workspace_canonical.join("file-link"),
      "the symlink itself is kept"
   );
   assert_eq!(
      resolve_symlink_path(text(&workspace.path().join("dir-link/secret.txt"))).unwrap(),
      outside_canonical.join("secret.txt"),
      "symlinked parent directories are still resolved"
   );
   assert_eq!(
      resolve_local_path(text(&workspace.path().join("dangling"))).unwrap(),
      workspace_canonical.join("dangling"),
      "a dangling symlink is treated like a new file next to it"
   );
}

#[cfg(unix)]
#[test]
fn windows_style_paths_are_relative_on_unix() {
   for path in [
      r"C:\Users\me\notes.md",
      r"\\server\share\notes.md",
      "C:/notes.md",
   ] {
      assert_eq!(
         resolve_local_path(path).unwrap_err(),
         "Path must be absolute",
         "{path}"
      );
   }
}

#[cfg(windows)]
#[test]
fn windows_paths_need_a_drive_or_share_prefix() {
   for path in [r"C:notes.md", r"\notes.md", "/notes.md"] {
      assert_eq!(
         resolve_local_path(path).unwrap_err(),
         "Path must be absolute",
         "{path}"
      );
   }

   let (temp, canonical) = canonical_temp_dir();
   fs::write(temp.path().join("notes.md"), "hi").unwrap();
   let forward_slashes = text(temp.path()).replace('\\', "/") + "/notes.md";
   assert_eq!(
      resolve_local_path(&forward_slashes).unwrap(),
      canonical.join("notes.md")
   );
}
