use std::{
   fs,
   io::{Read, Write},
   path::Path,
   sync::Mutex,
};

static FILE_MUTATION_LOCK: Mutex<()> = Mutex::new(());
pub const FILE_CHANGED: &str =
   "The file changed while preparing the update. Read it again before editing.";

pub struct TextMutation {
   pub previous_content: Option<String>,
   pub content: Option<String>,
}

fn read_text(path: &Path, max_bytes: Option<u64>) -> Result<Option<String>, String> {
   let file = match fs::File::open(path) {
      Ok(file) => file,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
      Err(error) => return Err(format!("Could not read file: {error}")),
   };
   let mut bytes = Vec::new();
   if let Some(limit) = max_bytes {
      file
         .take(limit.saturating_add(1))
         .read_to_end(&mut bytes)
         .map_err(|error| error.to_string())?;
      if bytes.len() as u64 > limit {
         return Err("The file exceeds the update size limit.".into());
      }
   } else {
      let mut file = file;
      file
         .read_to_end(&mut bytes)
         .map_err(|error| error.to_string())?;
   }
   String::from_utf8(bytes)
      .map(Some)
      .map_err(|error| format!("The file is not valid UTF-8: {error}"))
}

/// Serializes cooperating local writers and rechecks the disk before replacing or deleting it.
pub fn mutate_text(
   path: &Path,
   max_bytes: Option<u64>,
   mutation: impl FnOnce(Option<&str>) -> Result<Option<String>, String>,
) -> Result<TextMutation, String> {
   if !path.is_absolute() {
      return Err("File paths must be absolute.".into());
   }
   let guard = FILE_MUTATION_LOCK
      .lock()
      .map_err(|error| error.to_string())?;
   let target = match fs::symlink_metadata(path) {
      Ok(_) => {
         fs::canonicalize(path).map_err(|error| format!("Could not resolve file: {error}"))?
      }
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => path.to_path_buf(),
      Err(error) => return Err(format!("Could not inspect file: {error}")),
   };
   let metadata = fs::metadata(&target).ok();
   if metadata
      .as_ref()
      .is_some_and(|metadata| !metadata.is_file())
   {
      return Err("Only text files can be changed.".into());
   }
   let previous_content = read_text(&target, max_bytes)?;
   let mut content = mutation(previous_content.as_deref())?;
   if previous_content
      .as_ref()
      .is_some_and(|text| text.starts_with('\u{feff}'))
      && let Some(text) = content.as_mut()
      && !text.starts_with('\u{feff}')
   {
      text.insert(0, '\u{feff}');
   }
   if content != previous_content {
      if metadata
         .as_ref()
         .is_some_and(|metadata| metadata.permissions().readonly())
      {
         return Err("The file is read-only.".into());
      }
      if let Some(text) = &content {
         if max_bytes.is_some_and(|limit| text.len() as u64 > limit) {
            return Err("The update exceeds the size limit.".into());
         }
         let parent = target.parent().ok_or("Missing parent directory.")?;
         fs::create_dir_all(parent).map_err(|error| error.to_string())?;
         let mut builder = tempfile::Builder::new();
         #[cfg(unix)]
         if previous_content.is_none() {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(fs::Permissions::from_mode(0o666));
         }
         let mut temporary = builder
            .tempfile_in(parent)
            .map_err(|error| error.to_string())?;
         if let Some(metadata) = metadata {
            temporary
               .as_file()
               .set_permissions(metadata.permissions())
               .map_err(|error| error.to_string())?;
         }
         temporary
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
         temporary
            .as_file()
            .sync_all()
            .map_err(|error| error.to_string())?;
         if read_text(&target, max_bytes)? != previous_content {
            return Err(FILE_CHANGED.into());
         }
         if previous_content.is_none() {
            temporary
               .persist_noclobber(&target)
               .map_err(|error| error.to_string())?;
         } else {
            temporary
               .persist(&target)
               .map_err(|error| error.to_string())?;
         }
      } else {
         if read_text(&target, max_bytes)? != previous_content {
            return Err(FILE_CHANGED.into());
         }
         fs::remove_file(&target).map_err(|error| error.to_string())?;
      }
   }
   drop(guard);
   Ok(TextMutation {
      previous_content,
      content,
   })
}

pub fn matches_expected(current: Option<&str>, expected: Option<&str>) -> bool {
   match (current, expected) {
      (Some(current), Some(expected)) => {
         current == expected || current.strip_prefix('\u{feff}') == Some(expected)
      }
      (None, None) => true,
      _ => false,
   }
}

pub fn replace_text_if_unchanged(
   path: &Path,
   expected: Option<&str>,
   content: &str,
) -> Result<(), String> {
   mutate_text(
      path,
      Some(expected.map_or(0, str::len).max(content.len()) as u64 + 3),
      |current| {
         if !matches_expected(current, expected) {
            return Err(FILE_CHANGED.into());
         }
         Ok(Some(content.to_string()))
      },
   )
   .map(|_| ())
}

pub fn delete_text_if_unchanged(path: &Path, expected: &str) -> Result<(), String> {
   mutate_text(path, Some(expected.len() as u64 + 3), |current| {
      if !matches_expected(current, Some(expected)) {
         return Err(FILE_CHANGED.into());
      }
      Ok(None)
   })
   .map(|_| ())
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn stale_writes_and_deletions_preserve_the_newer_file() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("file.txt");
      fs::write(&path, "newer").unwrap();
      assert!(replace_text_if_unchanged(&path, Some("older"), "replacement").is_err());
      assert!(delete_text_if_unchanged(&path, "older").is_err());
      assert_eq!(fs::read_to_string(&path).unwrap(), "newer");
   }

   #[test]
   fn detects_outside_changes_made_while_the_update_is_prepared() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("file.txt");
      fs::write(&path, "before").unwrap();
      let result = mutate_text(&path, None, |_| {
         fs::write(&path, "outside").unwrap();
         Ok(Some("replacement".into()))
      });
      assert!(result.is_err());
      assert_eq!(fs::read_to_string(&path).unwrap(), "outside");
   }

   #[test]
   fn creates_missing_files_but_never_overwrites_an_unexpected_file() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("nested/file.txt");
      replace_text_if_unchanged(&path, None, "created").unwrap();
      assert!(replace_text_if_unchanged(&path, None, "overwrite").is_err());
      assert_eq!(fs::read_to_string(&path).unwrap(), "created");
      delete_text_if_unchanged(&path, "created").unwrap();
      assert!(!path.exists());
   }

   #[test]
   fn preserves_utf8_bom_and_line_endings_for_decoded_frontend_text() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("file.txt");
      fs::write(&path, "\u{feff}before\r\n").unwrap();
      replace_text_if_unchanged(&path, Some("before\r\n"), "after\r\n").unwrap();
      assert_eq!(fs::read_to_string(&path).unwrap(), "\u{feff}after\r\n");
   }

   #[test]
   fn rejects_binary_files_and_directories() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("binary");
      fs::write(&path, [0xff, 0xfe]).unwrap();
      assert!(replace_text_if_unchanged(&path, None, "replacement").is_err());
      assert!(replace_text_if_unchanged(dir.path(), None, "replacement").is_err());
      assert_eq!(fs::read(&path).unwrap(), [0xff, 0xfe]);
   }

   #[test]
   fn bounded_updates_do_not_read_or_replace_oversized_files() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("large.txt");
      fs::write(&path, "too large").unwrap();
      assert!(mutate_text(&path, Some(3), |_| Ok(Some("new".into()))).is_err());
      assert_eq!(fs::read_to_string(&path).unwrap(), "too large");
   }

   #[cfg(unix)]
   #[test]
   fn does_not_bypass_readonly_permissions_through_atomic_replacement() {
      use std::os::unix::fs::PermissionsExt;
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("readonly.txt");
      fs::write(&path, "before").unwrap();
      fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
      assert!(replace_text_if_unchanged(&path, Some("before"), "after").is_err());
      assert!(delete_text_if_unchanged(&path, "before").is_err());
      assert_eq!(fs::read_to_string(&path).unwrap(), "before");
   }

   #[test]
   fn checked_writes_and_computed_mutations_share_one_content_guard() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("file.txt");
      fs::write(&path, "before").unwrap();
      let start = std::sync::Arc::new(std::sync::Barrier::new(16));
      let threads: Vec<_> = (0..16)
         .map(|index| {
            let path = path.clone();
            let start = start.clone();
            std::thread::spawn(move || {
               start.wait();
               if index % 2 == 0 {
                  replace_text_if_unchanged(&path, Some("before"), &format!("writer {index}"))
               } else {
                  mutate_text(&path, None, |current| {
                     if current != Some("before") {
                        return Err(FILE_CHANGED.into());
                     }
                     Ok(Some(format!("writer {index}")))
                  })
                  .map(|_| ())
               }
            })
         })
         .collect();
      assert_eq!(
         threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(Result::is_ok)
            .count(),
         1
      );
   }

   #[cfg(unix)]
   #[test]
   fn preserves_executable_modes_and_symlinks() {
      use std::os::unix::fs::{PermissionsExt, symlink};
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("script.sh");
      let alias = dir.path().join("alias.sh");
      fs::write(&path, "before").unwrap();
      fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
      symlink(&path, &alias).unwrap();
      replace_text_if_unchanged(&alias, Some("before"), "after").unwrap();
      assert!(
         fs::symlink_metadata(&alias)
            .unwrap()
            .file_type()
            .is_symlink()
      );
      assert_eq!(
         fs::metadata(&path).unwrap().permissions().mode() & 0o777,
         0o755
      );
      assert_eq!(fs::read_to_string(&path).unwrap(), "after");
   }
}
