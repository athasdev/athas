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

pub(super) fn resolve_path_against_workspace(workspace_path: Option<&Path>, path: &str) -> PathBuf {
   let candidate = PathBuf::from(path);
   if candidate.is_absolute() {
      return candidate;
   }

   workspace_path
      .map(|workspace| workspace.join(candidate.clone()))
      .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join(candidate))
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
   fn resolves_relative_paths_against_workspace() {
      let workspace = PathBuf::from("/workspace");

      assert_eq!(
         resolve_path_against_workspace(Some(&workspace), "src/main.ts"),
         PathBuf::from("/workspace/src/main.ts")
      );
   }
}
