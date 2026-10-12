use super::*;
use std::path::PathBuf;

fn temp_root() -> (tempfile::TempDir, PathBuf) {
   let dir = tempfile::tempdir().unwrap();
   let root = dir.path().canonicalize().unwrap();
   (dir, root)
}

#[test]
fn sums_nested_file_sizes_and_rejects_files() {
   let (_dir, root) = temp_root();
   fs::create_dir(root.join("nested")).unwrap();
   fs::write(root.join("first.txt"), b"athas").unwrap();
   fs::write(root.join("nested/second.txt"), b"editor").unwrap();

   assert_eq!(directory_size(&root), Ok(11));
   assert_eq!(
      directory_size(&root.join("first.txt")),
      Err("Path is not a directory".to_string())
   );
}

#[test]
fn digest_is_standard_sha256() {
   assert_eq!(
      ExpectedFileDigest::of("abc").sha256,
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
   );
   assert_eq!(
      ExpectedFileDigest::of(&"a".repeat(1_000_000)).sha256,
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
   );
}

#[test]
fn digest_matches_the_same_text_with_or_without_a_bom() {
   let expected = ExpectedFileDigest::of("before\r\n");
   assert!(matches_expected_digest(Some("before\r\n"), Some(&expected)));
   assert!(matches_expected_digest(
      Some("\u{feff}before\r\n"),
      Some(&expected)
   ));
   assert!(!matches_expected_digest(Some("before\n"), Some(&expected)));
   assert!(!matches_expected_digest(None, Some(&expected)));
   assert!(matches_expected_digest(None, None));
   assert!(!matches_expected_digest(Some(""), None));
}

#[test]
fn checked_writes_only_replace_the_expected_text() {
   let (_dir, root) = temp_root();
   let path = root.join("notes.md");

   write_text_checked(&path, None, "first".into()).expect("create when absent");
   assert_eq!(fs::read_to_string(&path).unwrap(), "first");

   assert_eq!(
      write_text_checked(&path, None, "clobber".into()).unwrap_err(),
      FILE_CHANGED
   );
   assert_eq!(
      write_text_checked(
         &path,
         Some(ExpectedFileDigest::of("stale")),
         "clobber".into()
      )
      .unwrap_err(),
      FILE_CHANGED
   );
   assert_eq!(fs::read_to_string(&path).unwrap(), "first");

   write_text_checked(
      &path,
      Some(ExpectedFileDigest::of("first")),
      "second".into(),
   )
   .expect("matching write");
   assert_eq!(fs::read_to_string(&path).unwrap(), "second");

   write_text(&path, "third".into()).unwrap();
   assert_eq!(fs::read_to_string(&path).unwrap(), "third");
}

#[cfg(unix)]
#[test]
fn describes_files_links_and_broken_links() {
   use std::os::unix::fs::symlink;
   let (_dir, root) = temp_root();
   fs::create_dir(root.join("src")).unwrap();
   fs::write(root.join("src/lib.rs"), "").unwrap();
   symlink("src/lib.rs", root.join("relative-link")).unwrap();
   symlink(root.join("src"), root.join("absolute-link")).unwrap();
   symlink("missing", root.join("broken-link")).unwrap();
   let workspace = Some(root.to_string_lossy().into_owned());

   let file = symlink_info(&root.join("src/lib.rs"), workspace.clone()).unwrap();
   assert!(!file.is_symlink && !file.is_dir && file.target.is_none());
   let dir = symlink_info(&root.join("src"), None).unwrap();
   assert!(dir.is_dir);

   let relative = symlink_info(&root.join("relative-link"), workspace.clone()).unwrap();
   assert!(relative.is_symlink);
   assert_eq!(relative.target.as_deref(), Some("src/lib.rs"));
   let absolute = symlink_info(&root.join("absolute-link"), workspace.clone()).unwrap();
   assert_eq!(absolute.target.as_deref(), Some("src"));
   assert!(!absolute.is_dir, "links are not followed");
   let unscoped = symlink_info(&root.join("absolute-link"), None).unwrap();
   assert_eq!(
      unscoped.target,
      Some(root.join("src").to_string_lossy().into_owned())
   );
   let outside = symlink_info(&root.join("relative-link"), Some("/elsewhere".to_string())).unwrap();
   assert_eq!(
      outside.target,
      Some(root.join("src/lib.rs").to_string_lossy().into_owned())
   );
   let broken = symlink_info(&root.join("broken-link"), workspace).unwrap();
   assert_eq!(broken.target.as_deref(), Some("missing"));

   assert!(
      symlink_info(&root.join("nope"), None)
         .unwrap_err()
         .starts_with("Failed to get metadata")
   );
}

#[test]
fn renames_only_onto_free_paths() {
   let (_dir, root) = temp_root();
   fs::write(root.join("a.txt"), "a").unwrap();
   fs::write(root.join("b.txt"), "b").unwrap();

   assert_eq!(
      rename_path(&root.join("missing"), &root.join("c.txt")).unwrap_err(),
      "Source path does not exist"
   );
   assert_eq!(
      rename_path(&root.join("a.txt"), &root.join("b.txt")).unwrap_err(),
      "Target path already exists"
   );
   rename_path(&root.join("a.txt"), &root.join("c.txt")).unwrap();
   assert_eq!(fs::read_to_string(root.join("c.txt")).unwrap(), "a");
   assert!(!root.join("a.txt").exists());
}

#[test]
fn moves_files_and_directories_with_validation() {
   let (_dir, root) = temp_root();
   fs::create_dir_all(root.join("dir/inner")).unwrap();
   fs::write(root.join("dir/inner/file.txt"), "x").unwrap();
   fs::write(root.join("file.txt"), "f").unwrap();

   assert_eq!(
      move_path(&root.join("dir"), &root.join("dir/inner/moved")).unwrap_err(),
      "Cannot move a directory into itself"
   );
   assert_eq!(
      move_path(&root.join("file.txt"), &root.join("missing/file.txt")).unwrap_err(),
      "Target directory does not exist"
   );
   assert_eq!(
      move_path(&root.join("file.txt"), &root.join("dir")).unwrap_err(),
      "Target path already exists"
   );
   assert_eq!(
      move_path(&root.join("ghost"), &root.join("x")).unwrap_err(),
      "Source path does not exist"
   );

   move_path(&root.join("dir"), &root.join("moved")).unwrap();
   assert_eq!(
      fs::read_to_string(root.join("moved/inner/file.txt")).unwrap(),
      "x"
   );
   move_path(&root.join("file.txt"), &root.join("moved/file.txt")).unwrap();
   assert!(!root.join("file.txt").exists());
}

#[test]
fn falls_back_to_copy_and_delete_when_rename_fails() {
   let (_dir, root) = temp_root();
   fs::create_dir_all(root.join("dir/inner")).unwrap();
   fs::write(root.join("dir/inner/file.txt"), "x").unwrap();
   fs::write(root.join("file.txt"), "f").unwrap();
   let cross_device = std::io::Error::other("cross-device link");

   move_by_copy(
      &root.join("file.txt"),
      &root.join("copied.txt"),
      &cross_device,
   )
   .unwrap();
   assert_eq!(fs::read_to_string(root.join("copied.txt")).unwrap(), "f");
   assert!(!root.join("file.txt").exists());

   move_by_copy(&root.join("dir"), &root.join("copied-dir"), &cross_device).unwrap();
   assert_eq!(
      fs::read_to_string(root.join("copied-dir/inner/file.txt")).unwrap(),
      "x"
   );
   assert!(!root.join("dir").exists());

   let error = move_by_copy(
      &root.join("copied.txt"),
      &root.join("missing/target.txt"),
      &cross_device,
   )
   .unwrap_err();
   assert!(
      error.starts_with("Failed to move file: cross-device link"),
      "{error}"
   );
   assert_eq!(
      move_by_copy(&root.join("ghost"), &root.join("x"), &cross_device).unwrap_err(),
      "Source is neither a file nor a directory"
   );
}

#[cfg(unix)]
#[test]
fn copies_links_to_directories_and_broken_links() {
   use std::os::unix::fs::symlink;
   let (_dir, root) = temp_root();
   let src = root.join("src");
   fs::create_dir_all(src.join("nested")).unwrap();
   fs::write(src.join("nested/file.txt"), "hello").unwrap();
   symlink("nested", src.join("dir-link")).unwrap();
   symlink("nested/file.txt", src.join("file-link")).unwrap();
   symlink("missing", src.join("broken-link")).unwrap();

   let dst = root.join("dst");
   copy_dir_all(&src, &dst).unwrap();

   assert_eq!(
      fs::read_to_string(dst.join("nested/file.txt")).unwrap(),
      "hello"
   );
   assert_eq!(fs::read_to_string(dst.join("file-link")).unwrap(), "hello");
   assert!(
      !fs::symlink_metadata(dst.join("file-link"))
         .unwrap()
         .file_type()
         .is_symlink()
   );
   assert_eq!(
      fs::read_link(dst.join("dir-link")).unwrap(),
      PathBuf::from("nested")
   );
   assert_eq!(
      fs::read_link(dst.join("broken-link")).unwrap(),
      PathBuf::from("missing")
   );
   assert!(
      remove_dir_all(&root.join("nope"))
         .unwrap_err()
         .starts_with("Failed to remove directory")
   );
}
