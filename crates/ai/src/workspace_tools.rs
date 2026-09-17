use std::{
   fs,
   io::{Read, Write},
   path::{Component, Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 256 * 1024;

fn excluded_path(relative: &Path) -> bool {
   relative.components().any(|part| {
      let name = part.as_os_str().to_string_lossy().to_ascii_lowercase();
      name == ".git"
         || name == ".env"
         || name.starts_with(".env.")
         || [".pem", ".key", ".p12", ".pfx"]
            .iter()
            .any(|extension| name.ends_with(extension))
   })
}

fn permitted_path(root: &str, relative: &str, create: bool) -> Result<PathBuf, String> {
   let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
   let relative = Path::new(relative);
   if relative.is_absolute()
      || relative
         .components()
         .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
   {
      return Err("Use a relative path inside the workspace.".into());
   }
   if excluded_path(relative) {
      return Err("This file is excluded from automatic workspace tools.".into());
   }
   let target = root.join(relative);
   let mut component_path = root.clone();
   for component in relative.components() {
      component_path.push(component);
      if fs::symlink_metadata(&component_path)
         .is_ok_and(|metadata| metadata.file_type().is_symlink())
      {
         return Err("Use the original workspace path instead of a symbolic link.".into());
      }
   }
   let resolved = match fs::canonicalize(&target) {
      Ok(path) => path,
      Err(error) if create && error.kind() == std::io::ErrorKind::NotFound => {
         let parent = target.parent().ok_or("A file path is required.")?;
         fs::canonicalize(parent)
            .map_err(|e| e.to_string())?
            .join(target.file_name().ok_or("A file name is required.")?)
      }
      Err(error) => return Err(error.to_string()),
   };
   if !resolved.starts_with(&root) || resolved == root {
      return Err("The path must remain inside the workspace.".into());
   }
   if excluded_path(resolved.strip_prefix(&root).map_err(|e| e.to_string())?) {
      return Err("This file is excluded from automatic workspace tools.".into());
   }
   Ok(resolved)
}

pub fn read_workspace_file(root: &str, path: &str) -> Result<String, String> {
   let target = permitted_path(root, path, false)?;
   let metadata = fs::metadata(&target).map_err(|e| e.to_string())?;
   if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
      return Err("Read a text file smaller than 256 KiB.".into());
   }
   let mut content = String::new();
   fs::File::open(target)
      .map_err(|e| e.to_string())?
      .take(MAX_FILE_BYTES + 1)
      .read_to_string(&mut content)
      .map_err(|e| e.to_string())?;
   if content.len() as u64 > MAX_FILE_BYTES {
      return Err("Read a text file smaller than 256 KiB.".into());
   }
   Ok(content)
}

pub fn edit_workspace_file(
   root: &str,
   path: &str,
   expected_content: Option<&str>,
   old_text: &str,
   new_text: &str,
) -> Result<(), String> {
   let target = permitted_path(root, path, true)?;
   let current = match read_workspace_file(root, path) {
      Ok(content) => Some(content),
      Err(error) if !target.exists() => {
         drop(error);
         None
      }
      Err(error) => return Err(error),
   };
   if current.as_deref() != expected_content {
      return Err("The file changed since it was read. Read it again before editing.".into());
   }
   let replacement = if let Some(content) = current {
      if old_text.is_empty() || content.matches(old_text).count() != 1 {
         return Err("The old text must match exactly one location in the file.".into());
      }
      content.replacen(old_text, new_text, 1)
   } else {
      if !old_text.is_empty() {
         return Err("New files must have empty old text.".into());
      }
      new_text.to_string()
   };
   if replacement.len() as u64 > MAX_FILE_BYTES {
      return Err("The edited file is too large.".into());
   }
   let mut temporary = tempfile::NamedTempFile::new_in(target.parent().ok_or("Missing parent")?)
      .map_err(|e| e.to_string())?;
   if let Ok(metadata) = fs::metadata(&target) {
      temporary
         .as_file()
         .set_permissions(metadata.permissions())
         .map_err(|e| e.to_string())?;
   }
   temporary
      .write_all(replacement.as_bytes())
      .map_err(|e| e.to_string())?;
   temporary.as_file().sync_all().map_err(|e| e.to_string())?;
   temporary.persist(target).map_err(|e| e.to_string())?;
   Ok(())
}

pub fn list_workspace_files(root: &str) -> Result<Vec<String>, String> {
   let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
   let mut pending = vec![(root.clone(), 0)];
   let mut files = Vec::new();
   let mut visited = 0;
   while let Some((directory, depth)) = pending.pop() {
      if depth > 12 || files.len() >= 512 || visited >= 5000 {
         continue;
      }
      let mut entries = fs::read_dir(directory)
         .map_err(|e| e.to_string())?
         .filter_map(Result::ok)
         .take(5000)
         .collect::<Vec<_>>();
      entries.sort_by_key(|entry| entry.file_name());
      for entry in entries {
         visited += 1;
         if files.len() >= 512 || visited >= 5000 {
            break;
         }
         let name = entry.file_name().to_string_lossy().to_string();
         if [".git", "node_modules", "target", ".next", "dist", ".venv"].contains(&name.as_str()) {
            continue;
         }
         let kind = entry.file_type().map_err(|e| e.to_string())?;
         if kind.is_symlink() {
            continue;
         }
         if kind.is_dir() {
            pending.push((entry.path(), depth + 1));
         } else if kind.is_file() {
            let path = entry.path();
            let relative = path
               .strip_prefix(&root)
               .map_err(|e| e.to_string())?
               .to_string_lossy()
               .to_string();
            if permitted_path(
               root.to_str().ok_or("Invalid workspace path")?,
               &relative,
               false,
            )
            .is_ok()
            {
               files.push(relative);
            }
         }
      }
   }
   files.sort();
   Ok(files)
}

#[derive(serde::Serialize)]
pub struct WorkspaceMatch {
   path: String,
   line: usize,
   text: String,
}

pub fn search_workspace_files(root: &str, query: &str) -> Result<Vec<WorkspaceMatch>, String> {
   if query.is_empty() || query.len() > 500 {
      return Err("Search for 1 to 500 bytes of literal text.".into());
   }
   let mut matches = Vec::new();
   for path in list_workspace_files(root)? {
      let Ok(content) = read_workspace_file(root, &path) else {
         continue;
      };
      for (index, line) in content.lines().enumerate() {
         if line.contains(query) {
            matches.push(WorkspaceMatch {
               path: path.clone(),
               line: index + 1,
               text: line.chars().take(300).collect(),
            });
            if matches.len() >= 40 {
               return Ok(matches);
            }
         }
      }
   }
   Ok(matches)
}

#[cfg(test)]
mod tests {
   use super::*;
   #[test]
   fn refuses_traversal_and_secret_files() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join(".env"), "secret").unwrap();
      assert!(read_workspace_file(root, "../outside").is_err());
      assert!(read_workspace_file(root, ".env").is_err());
      assert!(read_workspace_file(root, "/etc/passwd").is_err());
   }
   #[test]
   fn edits_only_the_read_version_and_preserves_unrelated_content() {
      let dir = tempfile::tempdir().unwrap();
      let root = dir.path().to_str().unwrap();
      fs::write(dir.path().join("code.ts"), "before old after").unwrap();
      assert!(edit_workspace_file(root, "code.ts", Some("stale"), "old", "new").is_err());
      edit_workspace_file(root, "code.ts", Some("before old after"), "old", "new").unwrap();
      assert_eq!(
         read_workspace_file(root, "code.ts").unwrap(),
         "before new after"
      );
      edit_workspace_file(root, "new.ts", None, "", "created").unwrap();
      assert_eq!(read_workspace_file(root, "new.ts").unwrap(), "created");
   }
   #[cfg(unix)]
   #[test]
   fn refuses_symlink_escape() {
      let dir = tempfile::tempdir().unwrap();
      let outside = tempfile::tempdir().unwrap();
      fs::write(outside.path().join("secret"), "private").unwrap();
      std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();
      let root = dir.path().to_str().unwrap();
      assert!(read_workspace_file(root, "linked/secret").is_err());
      fs::write(dir.path().join(".env"), "secret").unwrap();
      std::os::unix::fs::symlink(dir.path().join(".env"), dir.path().join("alias")).unwrap();
      assert!(read_workspace_file(root, "alias").is_err());
      assert!(edit_workspace_file(root, "linked/new", None, "", "content").is_err());
   }
}
