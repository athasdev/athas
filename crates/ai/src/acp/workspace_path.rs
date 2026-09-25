use anyhow::{Context, Result, bail};
use std::{
   fs,
   path::{Component, Path, PathBuf},
};

pub(super) fn resolve_workspace_path(workspace_path: Option<String>) -> Result<Option<PathBuf>> {
   let Some(raw_path) = workspace_path else {
      return Ok(None);
   };
   let trimmed = raw_path.trim();
   if trimmed.is_empty() {
      return Ok(None);
   }

   let path = path_from_workspace_input(trimmed)?;
   let absolute_path = if path.is_absolute() {
      path
   } else {
      std::env::current_dir()
         .context("Failed to read current directory for relative workspace path")?
         .join(path)
   };
   let path = lexical_normalize(&absolute_path);
   let metadata = fs::metadata(&path)
      .with_context(|| format!("Workspace path does not exist: {}", path.display()))?;
   if !metadata.is_dir() {
      bail!("Workspace path is not a directory: {}", path.display());
   }

   Ok(Some(path))
}

pub(super) fn path_to_string(path: &Path) -> String {
   path.to_string_lossy().to_string()
}

/// The absolute path an agent means by `path`, with `.` and `..` resolved lexically. ACP paths
/// are absolute; a relative one is taken against the workspace.
pub(super) fn resolve_path_against_workspace(workspace_path: Option<&Path>, path: &str) -> PathBuf {
   let candidate = PathBuf::from(path);
   let absolute = if candidate.is_absolute() {
      candidate
   } else {
      workspace_path
         .map(|workspace| workspace.join(&candidate))
         .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join(candidate))
   };
   lexical_normalize(&absolute)
}

/// Where `path` really is on disk: its deepest existing ancestor with symlinks resolved, plus the
/// part that does not exist yet. `None` when an existing ancestor cannot be resolved, such as a
/// dangling symlink, since a write through it could land anywhere.
pub(super) fn real_path(path: &Path) -> Option<PathBuf> {
   let path = lexical_normalize(path);
   for ancestor in path.ancestors() {
      if fs::symlink_metadata(ancestor).is_err() {
         continue;
      }
      let real = fs::canonicalize(ancestor).ok()?;
      let rest = path.strip_prefix(ancestor).ok()?;
      return Some(if rest.as_os_str().is_empty() {
         real
      } else {
         real.join(rest)
      });
   }
   None
}

/// Whether `path` lies inside one of the workspace `roots`. Both sides are compared by where they
/// really are, so `..` and symlinks cannot step out of a root.
pub(super) fn is_inside_roots(path: &Path, roots: &[PathBuf]) -> bool {
   let Some(path) = real_path(path) else {
      return false;
   };
   roots.iter().any(|root| path.starts_with(root))
}

fn path_from_workspace_input(input: &str) -> Result<PathBuf> {
   if let Some(file_path) = input.strip_prefix("file://") {
      return parse_file_uri_path(file_path);
   }

   Ok(PathBuf::from(input))
}

fn parse_file_uri_path(file_path: &str) -> Result<PathBuf> {
   let decoded = percent_decode(file_path)?;

   #[cfg(windows)]
   {
      let without_localhost = decoded
         .strip_prefix("localhost/")
         .or_else(|| decoded.strip_prefix("localhost\\"))
         .unwrap_or(decoded.as_str());
      let normalized = without_localhost.replace('/', "\\");

      if let Some(path) = normalized.strip_prefix("\\\\") {
         return Ok(PathBuf::from(format!("\\\\{path}")));
      }
      if let Some(rest) = normalized.strip_prefix('\\')
         && rest.len() >= 2
         && rest.as_bytes()[1] == b':'
      {
         return Ok(PathBuf::from(rest));
      }
      if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
         return Ok(PathBuf::from(normalized));
      }

      return Ok(PathBuf::from(format!("\\\\{normalized}")));
   }

   #[cfg(not(windows))]
   {
      let without_localhost = decoded
         .strip_prefix("localhost/")
         .unwrap_or(decoded.as_str());
      if without_localhost.starts_with('/') {
         Ok(PathBuf::from(without_localhost))
      } else {
         Ok(PathBuf::from(format!("/{without_localhost}")))
      }
   }
}

fn percent_decode(input: &str) -> Result<String> {
   let bytes = input.as_bytes();
   let mut output = Vec::with_capacity(bytes.len());
   let mut index = 0;

   while index < bytes.len() {
      if bytes[index] == b'%' {
         if index + 2 >= bytes.len() {
            bail!("Invalid percent escape in file URI");
         }
         let high = hex_value(bytes[index + 1])?;
         let low = hex_value(bytes[index + 2])?;
         output.push((high << 4) | low);
         index += 3;
      } else {
         output.push(bytes[index]);
         index += 1;
      }
   }

   String::from_utf8(output).context("File URI path is not valid UTF-8")
}

fn hex_value(byte: u8) -> Result<u8> {
   match byte {
      b'0'..=b'9' => Ok(byte - b'0'),
      b'a'..=b'f' => Ok(byte - b'a' + 10),
      b'A'..=b'F' => Ok(byte - b'A' + 10),
      _ => bail!("Invalid percent escape in file URI"),
   }
}

fn lexical_normalize(path: &Path) -> PathBuf {
   let mut normalized = PathBuf::new();
   for component in path.components() {
      match component {
         Component::CurDir => {}
         Component::ParentDir => {
            normalized.pop();
         }
         _ => normalized.push(component.as_os_str()),
      }
   }
   normalized
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn treats_missing_workspace_as_none() {
      assert!(resolve_workspace_path(None).unwrap().is_none());
      assert!(
         resolve_workspace_path(Some("   ".to_string()))
            .unwrap()
            .is_none()
      );
   }

   #[test]
   fn rejects_missing_workspace_path() {
      let missing =
         std::env::temp_dir().join(format!("athas-missing-workspace-{}", uuid::Uuid::new_v4()));

      let err = resolve_workspace_path(Some(path_to_string(&missing))).unwrap_err();
      assert!(err.to_string().contains("Workspace path does not exist"));
   }

   #[test]
   fn rejects_file_workspace_path() {
      let temp_dir = tempfile::tempdir().unwrap();
      let file_path = temp_dir.path().join("file.txt");
      fs::write(&file_path, "not a directory").unwrap();

      let err = resolve_workspace_path(Some(path_to_string(&file_path))).unwrap_err();
      assert!(
         err.to_string()
            .contains("Workspace path is not a directory")
      );
   }

   #[test]
   fn accepts_existing_workspace_directory() {
      let temp_dir = tempfile::tempdir().unwrap();
      let resolved = resolve_workspace_path(Some(path_to_string(temp_dir.path()))).unwrap();

      assert_eq!(resolved.as_deref(), Some(temp_dir.path()));
   }

   #[test]
   fn decodes_file_uri_workspace_path() {
      let temp_dir = tempfile::tempdir().unwrap();
      let workspace = temp_dir.path().join("space dir");
      fs::create_dir(&workspace).unwrap();
      let uri = format!("file://{}", path_to_string(&workspace).replace(' ', "%20"));

      let resolved = resolve_workspace_path(Some(uri)).unwrap();

      assert_eq!(resolved.as_deref(), Some(workspace.as_path()));
   }

   #[test]
   fn resolves_dot_segments_lexically() {
      let workspace = PathBuf::from("/workspace");

      assert_eq!(
         resolve_path_against_workspace(Some(&workspace), "/workspace/src/../../etc/passwd"),
         PathBuf::from("/etc/passwd")
      );
      assert_eq!(
         resolve_path_against_workspace(Some(&workspace), "../outside.txt"),
         PathBuf::from("/outside.txt")
      );
      assert_eq!(
         resolve_path_against_workspace(Some(&workspace), "./src/./a.ts"),
         PathBuf::from("/workspace/src/a.ts")
      );
   }

   fn workspace_roots(workspace: &Path) -> Vec<PathBuf> {
      vec![fs::canonicalize(workspace).unwrap()]
   }

   #[test]
   fn keeps_paths_inside_the_workspace() {
      let temp_dir = tempfile::tempdir().unwrap();
      let workspace = temp_dir.path().join("workspace");
      fs::create_dir_all(workspace.join("src")).unwrap();
      fs::write(workspace.join("src/a.ts"), "").unwrap();
      let roots = workspace_roots(&workspace);

      assert!(is_inside_roots(&workspace.join("src/a.ts"), &roots));
      // Files and folders that do not exist yet are judged by where they would be created.
      assert!(is_inside_roots(&workspace.join("new/dir/b.ts"), &roots));
      assert!(is_inside_roots(&workspace, &roots));
   }

   #[test]
   fn finds_paths_that_leave_the_workspace() {
      let temp_dir = tempfile::tempdir().unwrap();
      let workspace = temp_dir.path().join("workspace");
      fs::create_dir_all(&workspace).unwrap();
      fs::write(temp_dir.path().join("secret.txt"), "").unwrap();
      let roots = workspace_roots(&workspace);

      assert!(!is_inside_roots(
         &temp_dir.path().join("secret.txt"),
         &roots
      ));
      let escaped = resolve_path_against_workspace(Some(&workspace), "../secret.txt");
      assert!(!is_inside_roots(&escaped, &roots));
      let absolute = resolve_path_against_workspace(
         Some(&workspace),
         &path_to_string(&workspace.join("src/../../secret.txt")),
      );
      assert!(!is_inside_roots(&absolute, &roots));
      // A sibling whose name starts with the workspace's is not inside it.
      assert!(!is_inside_roots(
         &temp_dir.path().join("workspace-other/a.txt"),
         &roots
      ));
      assert!(!is_inside_roots(Path::new("/etc/hosts"), &roots));
      assert!(!is_inside_roots(Path::new("/a.txt"), &[]));
   }

   #[cfg(unix)]
   #[test]
   fn follows_symlinks_out_of_the_workspace() {
      let temp_dir = tempfile::tempdir().unwrap();
      let workspace = temp_dir.path().join("workspace");
      let outside = temp_dir.path().join("outside");
      fs::create_dir_all(&workspace).unwrap();
      fs::create_dir_all(&outside).unwrap();
      std::os::unix::fs::symlink(&outside, workspace.join("link")).unwrap();
      std::os::unix::fs::symlink(outside.join("gone"), workspace.join("dangling")).unwrap();
      let roots = workspace_roots(&workspace);

      assert!(!is_inside_roots(&workspace.join("link/a.txt"), &roots));
      assert!(!is_inside_roots(&workspace.join("link"), &roots));
      assert!(!is_inside_roots(&workspace.join("dangling"), &roots));
      // A link that stays inside is fine.
      std::os::unix::fs::symlink(&workspace, workspace.join("self")).unwrap();
      assert!(is_inside_roots(&workspace.join("self/a.txt"), &roots));
   }

   #[test]
   fn resolves_relative_paths_against_workspace() {
      let workspace = PathBuf::from("/workspace");

      assert_eq!(
         resolve_path_against_workspace(Some(&workspace), "src/main.ts"),
         PathBuf::from("/workspace/src/main.ts")
      );
   }
}
