//! Locating and removing the files a managed tool install left under the tools directory.

use crate::{ToolConfig, ToolInstaller, ToolRuntime};
use std::{
   fs,
   path::{Path, PathBuf},
};
use tauri::AppHandle;

/// Removes the managed install of `config`, if any. Tools without a package and system tools
/// have nothing to remove.
pub fn remove_managed_install(app_handle: &AppHandle, config: &ToolConfig) -> Result<(), String> {
   if config.package.is_none() {
      return Ok(());
   }
   let tools_dir = ToolInstaller::get_tools_dir(app_handle).map_err(|e| e.to_string())?;
   remove_managed_install_in(&tools_dir, config)
}

fn remove_managed_install_in(tools_dir: &Path, config: &ToolConfig) -> Result<(), String> {
   let Some(path) = managed_install_path(tools_dir, config)? else {
      return Ok(());
   };

   if path.is_dir() {
      fs::remove_dir_all(&path).map_err(|e| format!("Failed to remove managed tool: {}", e))?;
   } else if path.exists() {
      fs::remove_file(&path).map_err(|e| format!("Failed to remove managed tool: {}", e))?;
   }
   Ok(())
}

/// The directory (or, for Go and Rust, the binary) a managed install of `config` occupies.
fn managed_install_path(tools_dir: &Path, config: &ToolConfig) -> Result<Option<PathBuf>, String> {
   let Some(package) = config.package.as_ref() else {
      return Ok(None);
   };
   let package_dir = |runtime_dir: &str, name: &str| tools_dir.join(runtime_dir).join(name);
   let path = match config.runtime {
      ToolRuntime::Node => package_dir("npm", &ToolInstaller::node_package_identity(package)),
      ToolRuntime::Bun => package_dir("bun", &ToolInstaller::node_package_identity(package)),
      ToolRuntime::Python => package_dir("python", package),
      ToolRuntime::Ruby => package_dir("ruby", package),
      ToolRuntime::R => package_dir("r", package),
      ToolRuntime::Binary => package_dir("binary", &config.name),
      ToolRuntime::Go | ToolRuntime::Rust => {
         ToolInstaller::tool_path_in(tools_dir, config).map_err(|e| e.to_string())?
      }
      ToolRuntime::System => return Ok(None),
   };
   Ok(Some(path))
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::collections::HashMap;

   fn config(runtime: ToolRuntime, package: Option<&str>) -> ToolConfig {
      ToolConfig {
         name: "agent".to_string(),
         command: None,
         runtime,
         package: package.map(ToString::to_string),
         packages: Vec::new(),
         download_url: None,
         args: Vec::new(),
         env: HashMap::new(),
      }
   }

   #[test]
   fn locates_installs_by_runtime_without_package_versions() {
      let tools = Path::new("/tools");
      let path = |runtime, package| managed_install_path(tools, &config(runtime, package));

      assert_eq!(
         path(ToolRuntime::Node, Some("@google/gemini-cli@0.56.0")),
         Ok(Some(tools.join("npm/@google/gemini-cli")))
      );
      assert_eq!(
         path(ToolRuntime::Bun, Some("opencode-ai@1.18.21")),
         Ok(Some(tools.join("bun/opencode-ai")))
      );
      assert_eq!(
         path(ToolRuntime::Python, Some("kimi-cli")),
         Ok(Some(tools.join("python/kimi-cli")))
      );
      assert_eq!(
         path(ToolRuntime::Binary, Some("ignored")),
         Ok(Some(tools.join("binary/agent")))
      );
      assert_eq!(path(ToolRuntime::System, Some("x")), Ok(None));
      assert_eq!(path(ToolRuntime::Node, None), Ok(None));
   }

   #[test]
   fn removes_install_directories_and_tolerates_missing_ones() {
      let tools = tempfile::tempdir().unwrap();
      let install = tools.path().join("npm/@scope/agent/node_modules");
      fs::create_dir_all(&install).unwrap();
      fs::write(install.join("index.js"), "").unwrap();
      let node = config(ToolRuntime::Node, Some("@scope/agent@1.2.3"));

      remove_managed_install_in(tools.path(), &node).unwrap();
      assert!(!tools.path().join("npm/@scope/agent").exists());
      assert!(tools.path().join("npm/@scope").exists());

      remove_managed_install_in(tools.path(), &node).unwrap();
      remove_managed_install_in(tools.path(), &config(ToolRuntime::Binary, None)).unwrap();
   }

   #[test]
   fn removes_single_file_installs() {
      let tools = tempfile::tempdir().unwrap();
      fs::create_dir_all(tools.path().join("python")).unwrap();
      fs::write(tools.path().join("python/agent-file"), "").unwrap();

      remove_managed_install_in(
         tools.path(),
         &config(ToolRuntime::Python, Some("agent-file")),
      )
      .unwrap();

      assert!(!tools.path().join("python/agent-file").exists());
   }
}
