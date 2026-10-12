//! Local filesystem operations behind the editor's file commands. Callers confine paths to the
//! user's scope first; these functions only act on the paths they are given.

use crate::file_mutations::{FILE_CHANGED, mutate_text};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use walkdir::WalkDir;

/// Total size of the regular files under `path`, without following links. Unreadable entries
/// are skipped.
pub fn directory_size(path: &Path) -> Result<u64, String> {
   if !path.is_dir() {
      return Err("Path is not a directory".to_string());
   }

   let mut size = 0_u64;
   for entry in WalkDir::new(path).follow_links(false) {
      let Ok(entry) = entry else {
         continue;
      };
      if !entry.file_type().is_file() {
         continue;
      }
      let Ok(metadata) = entry.metadata() else {
         continue;
      };
      size = size.saturating_add(metadata.len());
   }

   Ok(size)
}

/// Replaces the file's text atomically.
pub fn write_text(path: &Path, content: String) -> Result<(), String> {
   mutate_text(path, None, |_| Ok(Some(content))).map(|_| ())
}

/// The text a checked write expects on disk, sent as its UTF-8 length and SHA-256 instead of a
/// second full copy of the file.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedFileDigest {
   pub byte_length: u32,
   pub sha256: String,
}

impl ExpectedFileDigest {
   pub fn of(text: &str) -> Self {
      Self {
         byte_length: text.len() as u32,
         sha256: format!("{:x}", Sha256::digest(text.as_bytes())),
      }
   }

   fn matches(&self, text: &str) -> bool {
      text.len() == self.byte_length as usize
         && format!("{:x}", Sha256::digest(text.as_bytes())) == self.sha256
   }
}

/// Mirrors `matches_expected`: a file that only adds a UTF-8 BOM still matches, and a missing
/// file only matches a missing expectation.
fn matches_expected_digest(current: Option<&str>, expected: Option<&ExpectedFileDigest>) -> bool {
   match (current, expected) {
      (Some(current), Some(expected)) => {
         expected.matches(current)
            || current
               .strip_prefix('\u{feff}')
               .is_some_and(|text| expected.matches(text))
      }
      (None, None) => true,
      _ => false,
   }
}

/// Writes `content` only when the file still holds the text described by `expected` (`None`
/// meaning the file must not exist); otherwise fails with [`FILE_CHANGED`].
pub fn write_text_checked(
   path: &Path,
   expected: Option<ExpectedFileDigest>,
   content: String,
) -> Result<(), String> {
   let expected_length = expected
      .as_ref()
      .map_or(0, |digest| digest.byte_length as u64);
   mutate_text(
      path,
      Some(expected_length.max(content.len() as u64) + 3),
      |current| {
         if !matches_expected_digest(current, expected.as_ref()) {
            return Err(FILE_CHANGED.into());
         }
         Ok(Some(content))
      },
   )
   .map(|_| ())
}

#[derive(Debug, Serialize, specta::Type)]
pub struct SymlinkInfo {
   pub is_symlink: bool,
   pub target: Option<String>,
   pub is_dir: bool,
}

/// Describes `path` without following it. A symlink's target is reported relative to
/// `workspace_root` when it points inside it; a broken link has no target.
pub fn symlink_info(path: &Path, workspace_root: Option<String>) -> Result<SymlinkInfo, String> {
   let metadata =
      fs::symlink_metadata(path).map_err(|e| format!("Failed to get metadata: {}", e))?;
   let is_symlink = metadata.file_type().is_symlink();
   let target = if is_symlink {
      fs::read_link(path)
         .ok()
         .map(|target| display_link_target(path, target, workspace_root.as_deref()))
   } else {
      None
   };

   Ok(SymlinkInfo {
      is_symlink,
      target,
      is_dir: metadata.is_dir(),
   })
}

fn display_link_target(
   link: &Path,
   target: std::path::PathBuf,
   workspace_root: Option<&str>,
) -> String {
   let Some(root) = workspace_root else {
      return target.to_string_lossy().into_owned();
   };
   let absolute_target = if target.is_absolute() {
      target
   } else if let Some(parent) = link.parent() {
      parent.join(&target)
   } else {
      target
   };
   absolute_target
      .strip_prefix(root)
      .unwrap_or(&absolute_target)
      .to_string_lossy()
      .into_owned()
}

/// Renames `source` to a `target` that must not exist yet.
pub fn rename_path(source: &Path, target: &Path) -> Result<(), String> {
   if !source.exists() {
      return Err("Source path does not exist".to_string());
   }
   if target.exists() {
      return Err("Target path already exists".to_string());
   }

   fs::rename(source, target).map_err(|e| format!("Failed to rename file: {}", e))
}

/// Moves a file or directory to a new, not yet existing path in an existing directory, copying
/// and deleting when a rename cannot cross filesystems.
pub fn move_path(source: &Path, target: &Path) -> Result<(), String> {
   if !source.exists() {
      return Err("Source path does not exist".to_string());
   }
   if target.exists() {
      return Err("Target path already exists".to_string());
   }
   if let Some(parent) = target.parent()
      && !parent.exists()
   {
      return Err("Target directory does not exist".to_string());
   }
   if source.is_dir() && target.starts_with(source) {
      return Err("Cannot move a directory into itself".to_string());
   }

   match fs::rename(source, target) {
      Ok(()) => Ok(()),
      Err(rename_err) => move_by_copy(source, target, &rename_err),
   }
}

fn move_by_copy(source: &Path, target: &Path, rename_err: &std::io::Error) -> Result<(), String> {
   if source.is_file() {
      fs::copy(source, target).map_err(|copy_err| {
         format!(
            "Failed to move file: {} (rename: {}, copy: {})",
            rename_err, rename_err, copy_err
         )
      })?;
      fs::remove_file(source)
         .map_err(|del_err| format!("File copied but failed to delete source: {}", del_err))
   } else if source.is_dir() {
      copy_dir_all(source, target)?;
      remove_dir_all(source)
   } else {
      Err("Source is neither a file nor a directory".to_string())
   }
}

/// Recursively copies `src` into `dst`. Links to files are copied as files; links to
/// directories and broken links are recreated as links; special files are skipped.
pub fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
   fs::create_dir_all(dst).map_err(|e| format!("Failed to create directory: {}", e))?;

   for entry in WalkDir::new(src).min_depth(1) {
      let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
      let src_path = entry.path();
      let relative_path = src_path
         .strip_prefix(src)
         .map_err(|e| format!("Failed to get relative path: {}", e))?;
      let dst_path = dst.join(relative_path);

      let file_type = entry.file_type();
      if file_type.is_dir() {
         fs::create_dir_all(&dst_path).map_err(|e| format!("Failed to create directory: {}", e))?;
      } else if file_type.is_file() || src_path.is_file() {
         fs::copy(src_path, &dst_path).map_err(|e| format!("Failed to copy file: {}", e))?;
      } else if file_type.is_symlink() {
         copy_symlink(src_path, &dst_path)?;
      }
   }

   Ok(())
}

fn copy_symlink(src: &Path, dst: &Path) -> Result<(), String> {
   let target = fs::read_link(src).map_err(|e| format!("Failed to read symlink: {}", e))?;

   #[cfg(unix)]
   let result = std::os::unix::fs::symlink(&target, dst);
   #[cfg(windows)]
   let result = std::os::windows::fs::symlink_dir(&target, dst);

   result.map_err(|e| format!("Failed to copy symlink: {}", e))
}

pub fn remove_dir_all(path: &Path) -> Result<(), String> {
   fs::remove_dir_all(path).map_err(|e| format!("Failed to remove directory: {}", e))
}

#[cfg(test)]
mod tests;
