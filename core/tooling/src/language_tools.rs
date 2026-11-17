//! Per-language tool management: which tools a language declares, whether they are installed,
//! and installing them.

use crate::{
   LanguageToolConfigSet, LanguageToolStatus, ToolConfig, ToolError, ToolInstaller, ToolRegistry,
   ToolStatus, ToolType,
};
use std::{collections::HashMap, path::Path};
use tauri::AppHandle;

const TOOL_TYPES: [ToolType; 3] = [ToolType::Lsp, ToolType::Formatter, ToolType::Linter];

impl ToolType {
   /// Parses the frontend's tool type name (`lsp`, `formatter`, or `linter`).
   pub fn parse(value: &str) -> Result<Self, String> {
      match value {
         "lsp" => Ok(Self::Lsp),
         "formatter" => Ok(Self::Formatter),
         "linter" => Ok(Self::Linter),
         _ => Err(format!("Unknown tool type: {}", value)),
      }
   }

   pub fn as_str(&self) -> &'static str {
      match self {
         Self::Lsp => "lsp",
         Self::Formatter => "formatter",
         Self::Linter => "linter",
      }
   }
}

/// Names of the tool types the language declares, in no particular order.
pub fn available_tools(language_id: &str, tools: Option<LanguageToolConfigSet>) -> Vec<String> {
   ToolRegistry::get_tools(language_id, tools)
      .map(|tools| tools.keys().map(|kind| kind.as_str().to_string()).collect())
      .unwrap_or_default()
}

/// Whether each declared tool is installed; undeclared tools stay `None`.
pub fn language_tool_status(
   app_handle: &AppHandle,
   language_id: &str,
   tools: Option<LanguageToolConfigSet>,
) -> LanguageToolStatus {
   let tools_dir = ToolInstaller::get_tools_dir(app_handle).ok();
   language_tool_status_in(tools_dir.as_deref(), language_id, tools)
}

fn language_tool_status_in(
   tools_dir: Option<&Path>,
   language_id: &str,
   tools: Option<LanguageToolConfigSet>,
) -> LanguageToolStatus {
   let resolved = ToolRegistry::get_tools(language_id, tools).unwrap_or_default();
   status_for_each(language_id, &resolved, |config, _| {
      let installed =
         tools_dir.is_some_and(|dir| ToolInstaller::is_installed_in(dir, config).unwrap_or(false));
      if installed {
         ToolStatus::Installed
      } else {
         ToolStatus::NotInstalled
      }
   })
}

/// Installs every declared tool; each failure is reported in the status instead of aborting.
pub async fn install_language_tools(
   app_handle: &AppHandle,
   language_id: &str,
   tools: Option<LanguageToolConfigSet>,
) -> LanguageToolStatus {
   let resolved = ToolRegistry::get_tools(language_id, tools).unwrap_or_default();
   let mut status = LanguageToolStatus::new(language_id);
   for tool_type in TOOL_TYPES {
      if let Some(config) = resolved.get(&tool_type) {
         let result = install_with_companions(app_handle, language_id, tool_type, config).await;
         set_status(&mut status, tool_type, install_status(result));
      }
   }
   status
}

/// Installs one declared tool, failing only when the type is unknown or not declared.
pub async fn install_tool(
   app_handle: &AppHandle,
   language_id: &str,
   tool_type: &str,
   tools: Option<LanguageToolConfigSet>,
) -> Result<ToolStatus, String> {
   let tool_type = ToolType::parse(tool_type)?;
   let config = declared_tool(language_id, tool_type, tools)?;
   Ok(install_status(
      install_with_companions(app_handle, language_id, tool_type, &config).await,
   ))
}

/// The launch path of a declared tool when it exists on disk.
pub fn tool_path(
   app_handle: &AppHandle,
   language_id: &str,
   tool_type: &str,
   tools: Option<LanguageToolConfigSet>,
) -> Result<Option<String>, String> {
   let tool_type = ToolType::parse(tool_type)?;
   let Some(config) = ToolRegistry::get_tool(language_id, tool_type, tools) else {
      return Ok(None);
   };
   let tools_dir = ToolInstaller::get_tools_dir(app_handle).map_err(|e| e.to_string())?;
   existing_tool_path(&tools_dir, tool_type, &config)
}

fn existing_tool_path(
   tools_dir: &Path,
   tool_type: ToolType,
   config: &ToolConfig,
) -> Result<Option<String>, String> {
   let path = match tool_type {
      ToolType::Lsp => ToolInstaller::lsp_launch_path_in(tools_dir, config),
      _ => ToolInstaller::tool_path_in(tools_dir, config),
   }
   .map_err(|e| e.to_string())?;

   Ok(path.exists().then(|| path.to_string_lossy().into_owned()))
}

/// The installed Java debug adapter bundle, if any.
pub fn java_debug_bundle_path(app_handle: &AppHandle) -> Result<Option<String>, String> {
   let path = ToolInstaller::java_debug_bundle_path(app_handle).map_err(|e| e.to_string())?;
   Ok(path.exists().then(|| path.to_string_lossy().into_owned()))
}

fn declared_tool(
   language_id: &str,
   tool_type: ToolType,
   tools: Option<LanguageToolConfigSet>,
) -> Result<ToolConfig, String> {
   ToolRegistry::get_tool(language_id, tool_type, tools)
      .ok_or_else(|| format!("No {} configured for {}", tool_type.as_str(), language_id))
}

/// Installs the tool, plus the Java debug adapter alongside the Java language server.
async fn install_with_companions(
   app_handle: &AppHandle,
   language_id: &str,
   tool_type: ToolType,
   config: &ToolConfig,
) -> Result<(), ToolError> {
   ToolInstaller::install(app_handle, config).await?;
   if needs_java_debug_bundle(language_id, tool_type) {
      ToolInstaller::ensure_java_debug_bundle(app_handle).await?;
   }
   Ok(())
}

fn needs_java_debug_bundle(language_id: &str, tool_type: ToolType) -> bool {
   language_id == "java" && tool_type == ToolType::Lsp
}

fn install_status(result: Result<(), ToolError>) -> ToolStatus {
   match result {
      Ok(()) => ToolStatus::Installed,
      Err(error) => ToolStatus::Failed(error.to_string()),
   }
}

fn status_for_each(
   language_id: &str,
   resolved: &HashMap<ToolType, ToolConfig>,
   mut check: impl FnMut(&ToolConfig, ToolType) -> ToolStatus,
) -> LanguageToolStatus {
   let mut status = LanguageToolStatus::new(language_id);
   for tool_type in TOOL_TYPES {
      if let Some(config) = resolved.get(&tool_type) {
         set_status(&mut status, tool_type, check(config, tool_type));
      }
   }
   status
}

fn set_status(status: &mut LanguageToolStatus, tool_type: ToolType, value: ToolStatus) {
   let slot = match tool_type {
      ToolType::Lsp => &mut status.lsp,
      ToolType::Formatter => &mut status.formatter,
      ToolType::Linter => &mut status.linter,
   };
   *slot = Some(value);
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::ToolRuntime;
   use std::fs;

   fn binary_tool(name: &str) -> ToolConfig {
      ToolConfig {
         name: name.to_string(),
         command: None,
         runtime: ToolRuntime::Binary,
         package: None,
         packages: Vec::new(),
         download_url: Some("https://example.com/tool.tar.gz".to_string()),
         args: Vec::new(),
         env: HashMap::new(),
      }
   }

   fn install_fake_binary(tools_dir: &Path, name: &str) -> std::path::PathBuf {
      let dir = tools_dir.join("binary").join(name);
      fs::create_dir_all(&dir).unwrap();
      let path = dir.join(ToolInstaller::bin_file_name(name));
      #[cfg(unix)]
      athas_test_support::write_executable(&path, "#!/bin/sh\n");
      #[cfg(not(unix))]
      fs::write(&path, "#!/bin/sh\n").unwrap();
      path
   }

   #[test]
   fn parses_and_names_tool_types() {
      for tool_type in TOOL_TYPES {
         assert_eq!(ToolType::parse(tool_type.as_str()), Ok(tool_type));
      }
      assert_eq!(
         ToolType::parse("debugger"),
         Err("Unknown tool type: debugger".to_string())
      );
   }

   #[test]
   fn lists_and_resolves_declared_tools() {
      let tools = LanguageToolConfigSet {
         lsp: Some(binary_tool("zz-test-lsp")),
         linter: Some(binary_tool("zz-test-lint")),
         ..Default::default()
      };

      let mut available = available_tools("zz", Some(tools.clone()));
      available.sort();
      assert_eq!(available, vec!["linter", "lsp"]);
      assert!(available_tools("zz", None).is_empty());

      assert_eq!(
         declared_tool("zz", ToolType::Formatter, Some(tools.clone())).unwrap_err(),
         "No formatter configured for zz"
      );
      assert_eq!(
         declared_tool("zz", ToolType::Lsp, Some(tools))
            .unwrap()
            .name,
         "zz-test-lsp"
      );
   }

   #[test]
   fn reports_installed_and_missing_declared_tools() {
      let tools_dir = tempfile::tempdir().unwrap();
      install_fake_binary(tools_dir.path(), "zz-test-lsp");
      let tools = LanguageToolConfigSet {
         lsp: Some(binary_tool("zz-test-lsp")),
         formatter: Some(binary_tool("zz-test-fmt")),
         linter: None,
      };

      let status = language_tool_status_in(Some(tools_dir.path()), "zz", Some(tools.clone()));
      assert_eq!(status.language_id, "zz");
      assert_eq!(status.lsp, Some(ToolStatus::Installed));
      assert_eq!(status.formatter, Some(ToolStatus::NotInstalled));
      assert_eq!(status.linter, None);

      let without_dir = language_tool_status_in(None, "zz", Some(tools));
      assert_eq!(without_dir.lsp, Some(ToolStatus::NotInstalled));
      let undeclared = language_tool_status_in(Some(tools_dir.path()), "zz", None);
      assert_eq!(
         (undeclared.lsp, undeclared.formatter, undeclared.linter),
         (None, None, None)
      );
   }

   #[test]
   fn finds_existing_tool_paths_only() {
      let tools_dir = tempfile::tempdir().unwrap();
      let installed = install_fake_binary(tools_dir.path(), "zz-test-lsp");

      assert_eq!(
         existing_tool_path(tools_dir.path(), ToolType::Lsp, &binary_tool("zz-test-lsp")),
         Ok(Some(installed.to_string_lossy().into_owned()))
      );
      assert_eq!(
         existing_tool_path(
            tools_dir.path(),
            ToolType::Formatter,
            &binary_tool("zz-test-lsp")
         ),
         Ok(Some(installed.to_string_lossy().into_owned()))
      );
   }

   #[test]
   fn installs_the_java_debug_bundle_only_with_the_java_language_server() {
      assert!(needs_java_debug_bundle("java", ToolType::Lsp));
      assert!(!needs_java_debug_bundle("java", ToolType::Formatter));
      assert!(!needs_java_debug_bundle("kotlin", ToolType::Lsp));
      assert_eq!(install_status(Ok(())), ToolStatus::Installed);
      assert_eq!(
         install_status(Err(ToolError::NotFound("jdtls".to_string()))),
         ToolStatus::Failed(ToolError::NotFound("jdtls".to_string()).to_string())
      );
   }
}
