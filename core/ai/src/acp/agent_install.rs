//! Files Athas keeps for ACP agents it installs from extension manifests: a launcher wrapper
//! per agent and the installed version metadata next to it.

use crate::acp::types::{AgentConfig, AgentRuntime};
use athas_tooling::{ToolConfig, ToolRuntime};
use std::{
   collections::HashMap,
   fs,
   path::{Path, PathBuf},
};

/// The tool install that provides `agent`'s binary.
pub fn tool_config_from_agent(agent: &AgentConfig) -> Result<ToolConfig, String> {
   let runtime = match agent.install_runtime {
      Some(AgentRuntime::Node) => ToolRuntime::Node,
      Some(AgentRuntime::Python) => ToolRuntime::Python,
      Some(AgentRuntime::Go) => ToolRuntime::Go,
      Some(AgentRuntime::Rust) => ToolRuntime::Rust,
      Some(AgentRuntime::Binary) => ToolRuntime::Binary,
      None => {
         return Err(format!(
            "{} does not support managed installation",
            agent.name
         ));
      }
   };

   let package = if runtime == ToolRuntime::Binary {
      agent.install_package.clone()
   } else {
      Some(
         agent
            .install_package
            .clone()
            .ok_or_else(|| format!("{} is missing installation metadata", agent.name))?,
      )
   };

   Ok(ToolConfig {
      name: agent.binary_name.clone(),
      command: agent.install_command.clone(),
      runtime,
      package,
      packages: vec![],
      download_url: agent.install_download_url.clone(),
      args: vec![],
      env: HashMap::new(),
   })
}

/// The `tools/acp` directory under the app data directory.
#[derive(Debug, Clone)]
pub struct AcpAgentFiles {
   dir: PathBuf,
}

impl AcpAgentFiles {
   pub fn new(app_data_dir: &Path) -> Self {
      Self {
         dir: app_data_dir.join("tools").join("acp"),
      }
   }

   pub fn wrapper_path(&self, agent_id: &str) -> PathBuf {
      let file_name = if cfg!(windows) {
         format!("{agent_id}.cmd")
      } else {
         agent_id.to_string()
      };
      self.dir.join(file_name)
   }

   fn metadata_path(&self, agent_id: &str) -> PathBuf {
      self.dir.join(format!("{agent_id}.json"))
   }

   /// Writes an executable launcher for the agent.
   pub fn write_wrapper(&self, agent_id: &str, contents: &str) -> Result<(), String> {
      let path = self.wrapper_path(agent_id);
      fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
      fs::write(&path, contents).map_err(|e| e.to_string())?;
      make_executable(&path)
   }

   pub fn remove_wrapper(&self, agent_id: &str) -> Result<(), String> {
      remove_file_if_exists(&self.wrapper_path(agent_id))
         .map_err(|e| format!("Failed to remove ACP wrapper: {}", e))
   }

   /// Records the installed version and package, which update detection compares against.
   pub fn write_metadata(&self, agent: &AgentConfig) -> Result<(), String> {
      let contents = serde_json::to_vec_pretty(&serde_json::json!({
         "version": agent.available_version.as_deref(),
         "package": agent.install_package.as_deref(),
      }))
      .map_err(|error| format!("Failed to serialize ACP agent metadata: {error}"))?;
      fs::write(self.metadata_path(&agent.id), contents)
         .map_err(|error| format!("Failed to write ACP agent metadata: {error}"))
   }

   pub fn remove_metadata(&self, agent_id: &str) -> Result<(), String> {
      remove_file_if_exists(&self.metadata_path(agent_id))
         .map_err(|error| format!("Failed to remove ACP agent metadata: {error}"))
   }
}

/// A launcher that forwards its arguments to `binary`.
pub fn binary_wrapper(binary: &Path) -> String {
   if cfg!(windows) {
      format!("@echo off\r\n\"{}\" %*\r\n", binary.display())
   } else {
      format!("#!/bin/sh\nexec \"{}\" \"$@\"\n", binary.display())
   }
}

/// A launcher that runs `entrypoint` with the managed Node runtime.
pub fn node_wrapper(node_path: &Path, entrypoint: &Path) -> String {
   if cfg!(windows) {
      format!(
         "@echo off\r\n\"{}\" \"{}\" %*\r\n",
         node_path.display(),
         entrypoint.display()
      )
   } else {
      format!(
         "#!/bin/sh\nexec \"{}\" \"{}\" \"$@\"\n",
         node_path.display(),
         entrypoint.display()
      )
   }
}

fn remove_file_if_exists(path: &Path) -> std::io::Result<()> {
   if path.exists() {
      fs::remove_file(path)?;
   }
   Ok(())
}

fn make_executable(path: &Path) -> Result<(), String> {
   #[cfg(unix)]
   {
      use std::os::unix::fs::PermissionsExt;
      fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
   }
   #[cfg(not(unix))]
   let _ = path;
   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;

   fn installable(runtime: Option<AgentRuntime>, package: Option<&str>) -> AgentConfig {
      let mut agent = AgentConfig::new("demo-acp", "Demo", "demo");
      agent.install_runtime = runtime;
      agent.install_package = package.map(ToString::to_string);
      agent.install_command = Some("demo-cmd".to_string());
      agent.install_download_url = Some("https://example.com/demo.tar.gz".to_string());
      agent.available_version = Some("1.2.3".to_string());
      agent
   }

   #[test]
   fn maps_agent_installs_onto_tool_installs() {
      let node =
         tool_config_from_agent(&installable(Some(AgentRuntime::Node), Some("demo@1"))).unwrap();
      assert_eq!(node.runtime, ToolRuntime::Node);
      assert_eq!(node.name, "demo");
      assert_eq!(node.package.as_deref(), Some("demo@1"));
      assert_eq!(node.command.as_deref(), Some("demo-cmd"));
      assert_eq!(
         node.download_url.as_deref(),
         Some("https://example.com/demo.tar.gz")
      );

      let binary = tool_config_from_agent(&installable(Some(AgentRuntime::Binary), None)).unwrap();
      assert_eq!(binary.runtime, ToolRuntime::Binary);
      assert_eq!(binary.package, None);

      for (runtime, expected) in [
         (AgentRuntime::Python, ToolRuntime::Python),
         (AgentRuntime::Go, ToolRuntime::Go),
         (AgentRuntime::Rust, ToolRuntime::Rust),
      ] {
         assert_eq!(
            tool_config_from_agent(&installable(Some(runtime), Some("pkg")))
               .unwrap()
               .runtime,
            expected
         );
      }

      assert_eq!(
         tool_config_from_agent(&installable(Some(AgentRuntime::Python), None)).unwrap_err(),
         "Demo is missing installation metadata"
      );
      assert_eq!(
         tool_config_from_agent(&installable(None, Some("pkg"))).unwrap_err(),
         "Demo does not support managed installation"
      );
   }

   #[cfg(unix)]
   #[test]
   fn writes_and_removes_agent_wrappers_and_metadata() {
      use std::os::unix::fs::PermissionsExt;
      let data = tempfile::tempdir().unwrap();
      let files = AcpAgentFiles::new(data.path());
      let agent = installable(Some(AgentRuntime::Node), Some("demo@1.2.3"));

      files
         .write_wrapper(&agent.id, &binary_wrapper(Path::new("/opt/demo")))
         .unwrap();
      files.write_metadata(&agent).unwrap();

      let wrapper = data.path().join("tools/acp/demo-acp");
      assert_eq!(files.wrapper_path(&agent.id), wrapper);
      assert_eq!(
         fs::read_to_string(&wrapper).unwrap(),
         "#!/bin/sh\nexec \"/opt/demo\" \"$@\"\n"
      );
      assert_eq!(
         fs::metadata(&wrapper).unwrap().permissions().mode() & 0o777,
         0o755
      );
      let metadata: serde_json::Value =
         serde_json::from_slice(&fs::read(data.path().join("tools/acp/demo-acp.json")).unwrap())
            .unwrap();
      assert_eq!(
         metadata,
         serde_json::json!({ "version": "1.2.3", "package": "demo@1.2.3" })
      );

      files.remove_wrapper(&agent.id).unwrap();
      files.remove_metadata(&agent.id).unwrap();
      assert!(!wrapper.exists());
      assert!(!data.path().join("tools/acp/demo-acp.json").exists());
      files.remove_wrapper(&agent.id).unwrap();
      files.remove_metadata(&agent.id).unwrap();
   }

   #[cfg(unix)]
   #[test]
   fn node_wrappers_run_the_entrypoint_with_the_managed_runtime() {
      assert_eq!(
         node_wrapper(
            Path::new("/runtimes/node/bin/node"),
            Path::new("/tools/npm/demo/cli.js")
         ),
         "#!/bin/sh\nexec \"/runtimes/node/bin/node\" \"/tools/npm/demo/cli.js\" \"$@\"\n"
      );
   }
}
