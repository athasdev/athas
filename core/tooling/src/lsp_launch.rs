//! Resolves how to launch a language server from an extension's tool manifest.

use crate::{LanguageToolConfigSet, ToolConfig, ToolInstaller, ToolRegistry, ToolType};
use std::{collections::HashMap, path::Path};
use tauri::AppHandle;

/// Server binary, arguments, and environment for starting a language server.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LspLaunch {
   pub server_path: Option<String>,
   pub server_args: Option<Vec<String>>,
   pub server_env: Option<HashMap<String, String>>,
}

impl LspLaunch {
   fn passthrough(server_path: Option<String>, server_args: Option<Vec<String>>) -> Self {
      Self {
         server_path,
         server_args,
         server_env: None,
      }
   }
}

/// Uses the managed LSP tool for `language_id` when the manifest declares one, falling back to
/// the explicit `server_path` and `server_args` otherwise. jdtls additionally gets a Java
/// runtime, installed on demand.
pub async fn resolve_lsp_launch(
   app_handle: &AppHandle,
   language_id: Option<String>,
   server_path: Option<String>,
   server_args: Option<Vec<String>>,
   tools: Option<LanguageToolConfigSet>,
) -> Result<LspLaunch, String> {
   let Some(config) = managed_lsp_config(language_id, tools) else {
      return Ok(LspLaunch::passthrough(server_path, server_args));
   };

   let launch_path =
      ToolInstaller::get_lsp_launch_path(app_handle, &config).map_err(|e| e.to_string())?;
   let args = launch_args(&config, server_args);
   let java = if needs_java_executable(&config, args.as_deref()) {
      Some(
         ToolInstaller::get_or_install_java_executable(app_handle)
            .await
            .map_err(|e| e.to_string())?,
      )
   } else {
      None
   };

   Ok(managed_launch(&config, &launch_path, args, java.as_deref()))
}

fn managed_lsp_config(
   language_id: Option<String>,
   tools: Option<LanguageToolConfigSet>,
) -> Option<ToolConfig> {
   ToolRegistry::get_tool(&language_id?, ToolType::Lsp, Some(tools?))
}

/// Explicit non-empty arguments win over the manifest's defaults.
fn launch_args(config: &ToolConfig, server_args: Option<Vec<String>>) -> Option<Vec<String>> {
   match server_args {
      Some(args) if !args.is_empty() => Some(args),
      _ if !config.args.is_empty() => Some(config.args.clone()),
      args => args,
   }
}

fn needs_java_executable(config: &ToolConfig, args: Option<&[String]>) -> bool {
   config.name == "jdtls"
      && !args
         .unwrap_or_default()
         .iter()
         .any(|arg| arg == "--java-executable" || arg.starts_with("--java-executable="))
}

fn managed_launch(
   config: &ToolConfig,
   launch_path: &Path,
   mut args: Option<Vec<String>>,
   java: Option<&Path>,
) -> LspLaunch {
   if let Some(java) = java {
      args.get_or_insert_default().splice(
         0..0,
         [
            "--java-executable".to_string(),
            java.to_string_lossy().into_owned(),
         ],
      );
   }

   LspLaunch {
      server_path: Some(launch_path.to_string_lossy().into_owned()),
      server_args: args,
      server_env: (!config.env.is_empty()).then(|| config.env.clone()),
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::ToolRuntime;
   use std::path::PathBuf;

   fn config(name: &str, args: &[&str], env: &[(&str, &str)]) -> ToolConfig {
      ToolConfig {
         name: name.to_string(),
         command: None,
         runtime: ToolRuntime::Binary,
         package: None,
         packages: Vec::new(),
         download_url: None,
         args: args.iter().map(ToString::to_string).collect(),
         env: env
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect(),
      }
   }

   fn strings(values: &[&str]) -> Vec<String> {
      values.iter().map(ToString::to_string).collect()
   }

   #[test]
   fn explicit_arguments_override_manifest_defaults() {
      let config = config("pyright", &["--stdio"], &[]);

      assert_eq!(
         launch_args(&config, Some(strings(&["--verbose"]))),
         Some(strings(&["--verbose"]))
      );
      assert_eq!(
         launch_args(&config, Some(Vec::new())),
         Some(strings(&["--stdio"]))
      );
      assert_eq!(launch_args(&config, None), Some(strings(&["--stdio"])));

      let bare = self::config("bare", &[], &[]);
      assert_eq!(launch_args(&bare, Some(Vec::new())), Some(Vec::new()));
      assert_eq!(launch_args(&bare, None), None);
   }

   #[test]
   fn only_jdtls_without_an_explicit_java_needs_one() {
      let jdtls = config("jdtls", &[], &[]);

      assert!(needs_java_executable(&jdtls, None));
      assert!(needs_java_executable(
         &jdtls,
         Some(&strings(&["-data", "/tmp"]))
      ));
      assert!(!needs_java_executable(
         &jdtls,
         Some(&strings(&["--java-executable", "/jdk/bin/java"]))
      ));
      assert!(!needs_java_executable(
         &jdtls,
         Some(&strings(&["--java-executable=/jdk/bin/java"]))
      ));
      assert!(!needs_java_executable(&config("gopls", &[], &[]), None));
   }

   #[test]
   fn managed_launch_prepends_java_and_carries_the_manifest_env() {
      let config = config("jdtls", &[], &[("JAVA_OPTS", "-Xmx1g")]);
      let java = PathBuf::from("/jdk/bin/java");

      let launch = managed_launch(
         &config,
         Path::new("/tools/jdtls"),
         Some(strings(&["-data", "/ws"])),
         Some(&java),
      );

      assert_eq!(launch.server_path.as_deref(), Some("/tools/jdtls"));
      assert_eq!(
         launch.server_args,
         Some(strings(&[
            "--java-executable",
            "/jdk/bin/java",
            "-data",
            "/ws"
         ]))
      );
      assert_eq!(
         launch.server_env,
         Some(HashMap::from([(
            "JAVA_OPTS".to_string(),
            "-Xmx1g".to_string()
         )]))
      );

      let plain = managed_launch(
         &self::config("gopls", &[], &[]),
         Path::new("/tools/gopls"),
         None,
         None,
      );
      assert_eq!(plain.server_args, None);
      assert_eq!(plain.server_env, None);
   }

   #[test]
   fn unmanaged_languages_pass_the_request_through() {
      assert!(managed_lsp_config(None, Some(LanguageToolConfigSet::default())).is_none());
      assert!(managed_lsp_config(Some("rust".into()), None).is_none());
      assert!(
         managed_lsp_config(Some("rust".into()), Some(LanguageToolConfigSet::default())).is_none()
      );
      assert_eq!(
         LspLaunch::passthrough(Some("/bin/ls".into()), None),
         LspLaunch {
            server_path: Some("/bin/ls".into()),
            server_args: None,
            server_env: None,
         }
      );
   }

   #[test]
   fn manifest_lsp_tools_are_selected_by_language() {
      let tools = LanguageToolConfigSet {
         lsp: Some(config("pyright", &["--stdio"], &[])),
         ..Default::default()
      };

      let config = managed_lsp_config(Some("python".into()), Some(tools)).expect("lsp tool");

      assert_eq!(config.name, "pyright");
   }
}
