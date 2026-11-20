use crate::{RuntimeError, process::configure_background_command};
use std::{
   path::{Path, PathBuf},
   process::Command,
};

pub(crate) fn managed_runtime_dir(
   managed_root: Option<&Path>,
   runtime_name: &str,
) -> Result<PathBuf, RuntimeError> {
   let root = managed_root
      .ok_or_else(|| RuntimeError::PathError("managed runtime root not configured".to_string()))?;
   Ok(root.join(runtime_name))
}

pub(crate) fn check_runtime_version(
   binary_path: &Path,
   optional_v_prefix: bool,
) -> Result<(u32, u32, u32), RuntimeError> {
   let mut command = Command::new(binary_path);
   let output = configure_background_command(&mut command)
      .arg("--version")
      .output()
      .map_err(|error| RuntimeError::VersionCheckFailed(error.to_string()))?;

   if !output.status.success() {
      return Err(RuntimeError::VersionCheckFailed(
         String::from_utf8_lossy(&output.stderr).to_string(),
      ));
   }

   parse_runtime_version(&String::from_utf8_lossy(&output.stdout), optional_v_prefix)
}

pub(crate) fn parse_runtime_version(
   version: &str,
   optional_v_prefix: bool,
) -> Result<(u32, u32, u32), RuntimeError> {
   let trimmed = version.trim();
   let normalized = if optional_v_prefix {
      trimmed.strip_prefix('v').unwrap_or(trimmed)
   } else {
      trimmed
   };
   let parts: Vec<&str> = normalized.split('.').collect();

   if parts.len() < 3 {
      return Err(RuntimeError::VersionCheckFailed(format!(
         "Invalid version format: {version}"
      )));
   }

   let major = parts[0]
      .parse()
      .map_err(|_| RuntimeError::VersionCheckFailed(format!("Invalid major: {}", parts[0])))?;
   let minor = parts[1]
      .parse()
      .map_err(|_| RuntimeError::VersionCheckFailed(format!("Invalid minor: {}", parts[1])))?;
   let patch = parts[2]
      .split(|character: char| !character.is_ascii_digit())
      .next()
      .unwrap_or("0")
      .parse()
      .map_err(|_| RuntimeError::VersionCheckFailed(format!("Invalid patch: {}", parts[2])))?;

   Ok((major, minor, patch))
}

#[cfg(test)]
mod tests {
   use super::{managed_runtime_dir, parse_runtime_version};
   use crate::RuntimeError;
   use std::path::Path;

   #[test]
   fn joins_runtime_name_to_configured_root() {
      assert_eq!(
         managed_runtime_dir(Some(Path::new("/managed")), "bun").unwrap(),
         Path::new("/managed/bun")
      );
   }

   #[test]
   fn requires_a_managed_runtime_root() {
      assert!(matches!(
         managed_runtime_dir(None, "node"),
         Err(RuntimeError::PathError(message))
            if message == "managed runtime root not configured"
      ));
   }

   #[test]
   fn parses_bun_version_contract() {
      assert_eq!(
         parse_runtime_version("1.4.0-canary.1\n", false).unwrap(),
         (1, 4, 0)
      );
      assert!(parse_runtime_version("v1.4.0", false).is_err());
   }

   #[test]
   fn parses_node_version_contract() {
      assert_eq!(
         parse_runtime_version("v24.19.0-rc.1", true).unwrap(),
         (24, 19, 0)
      );
      assert_eq!(parse_runtime_version("24.19.0", true).unwrap(), (24, 19, 0));
   }

   #[test]
   fn rejects_incomplete_or_non_numeric_versions() {
      assert!(parse_runtime_version("1.2", false).is_err());
      assert!(parse_runtime_version("one.2.3", false).is_err());
      assert!(parse_runtime_version("1.two.3", false).is_err());
      assert!(parse_runtime_version("1.2.patch", false).is_err());
   }
}
