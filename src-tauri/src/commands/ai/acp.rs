use crate::app_runtime::AppHandle;
use athas_ai::{AcpAgentBridge, AcpAgentStatus, AcpSessionList, AgentConfig, AgentRuntime};
use athas_runtime::{RuntimeManager, RuntimeType};
use athas_tooling::{ToolConfig, ToolInstaller, ToolRuntime};
use serde::Deserialize;
use std::{
   collections::HashMap,
   fs,
   path::{Path, PathBuf},
   sync::Arc,
   time::{Duration, Instant},
};
use tauri::{Manager, State};
use tokio::sync::Mutex;

pub type AcpBridgeState = Arc<Mutex<AcpAgentBridge>>;
const EXTENSIONS_CDN_BASE_URL: &str = "https://athas.dev/extensions";
const ACP_REGISTRY_URL: &str =
   "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const AGENT_CATALOG_CACHE_SECONDS: u64 = 300;

#[derive(Deserialize)]
pub struct PermissionResponseArgs {
   #[serde(alias = "requestId")]
   request_id: String,
   approved: bool,
   #[serde(default)]
   cancelled: bool,
   #[serde(default, alias = "optionId")]
   option_id: Option<String>,
}

#[tauri::command]
pub async fn get_available_agents(
   bridge: State<'_, AcpBridgeState>,
) -> Result<Vec<AgentConfig>, String> {
   let mut bridge = bridge.lock().await;
   refresh_registered_agents(&mut bridge).await;
   Ok(bridge.detect_agents())
}

#[tauri::command]
pub async fn start_acp_agent(
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
   workspace_path: Option<String>,
   session_id: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = {
      let mut bridge = bridge.lock().await;
      refresh_registered_agents(&mut bridge).await;
      bridge.detect_agents();
      bridge.clone()
   };
   bridge
      .start_agent(&agent_id, workspace_path, session_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_acp_agent(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
) -> Result<AgentConfig, String> {
   let agent = {
      let mut bridge = bridge.lock().await;
      refresh_registered_agents(&mut bridge).await;
      let agents = bridge.detect_agents();
      agents
         .into_iter()
         .find(|agent| agent.id == agent_id)
         .ok_or_else(|| format!("Unknown ACP agent: {}", agent_id))?
   };

   let tool_config = tool_config_from_agent(&agent)?;
   let installed_binary = ToolInstaller::install(&app_handle, &tool_config)
      .await
      .map_err(|e| e.to_string())?;
   write_acp_wrapper(&app_handle, &agent, &tool_config, &installed_binary).await?;

   let mut bridge = bridge.lock().await;
   bridge.invalidate_agent_detection_cache();
   let installed = bridge
      .detect_agents()
      .into_iter()
      .find(|candidate| candidate.id == agent_id)
      .ok_or_else(|| format!("Installed ACP agent disappeared: {}", agent_id))?;

   Ok(installed)
}

#[tauri::command]
pub async fn uninstall_acp_agent(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
) -> Result<AgentConfig, String> {
   let agent = {
      let mut bridge = bridge.lock().await;
      refresh_registered_agents(&mut bridge).await;
      bridge.invalidate_agent_detection_cache();
      let agents = bridge.detect_agents();
      agents
         .into_iter()
         .find(|agent| agent.id == agent_id)
         .ok_or_else(|| format!("Unknown ACP agent: {}", agent_id))?
   };

   let tool_config = tool_config_from_agent(&agent)?;
   remove_acp_wrapper(&app_handle, &agent.id)?;
   remove_managed_tool(&app_handle, &tool_config)?;

   let mut bridge = bridge.lock().await;
   bridge.invalidate_agent_detection_cache();
   let detected = bridge
      .detect_agents()
      .into_iter()
      .find(|candidate| candidate.id == agent_id)
      .ok_or_else(|| format!("Uninstalled ACP agent disappeared: {}", agent_id))?;

   Ok(detected)
}

#[derive(Clone)]
struct CachedAgentCatalog {
   loaded_at: Instant,
   agents: Vec<AgentConfig>,
}

static AGENT_CATALOG_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<CachedAgentCatalog>>> =
   std::sync::OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceAgentInstall {
   runtime: AgentRuntime,
   package: String,
   command: Option<String>,
   download_url: Option<String>,
   #[serde(default)]
   download_urls: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceAgentContribution {
   id: String,
   name: String,
   binary_name: String,
   #[serde(default)]
   args: Vec<String>,
   #[serde(default)]
   env_vars: HashMap<String, String>,
   icon: Option<String>,
   description: Option<String>,
   install: Option<MarketplaceAgentInstall>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceExtensionManifest {
   #[serde(default)]
   agents: Vec<MarketplaceAgentContribution>,
}

#[derive(Deserialize)]
struct AcpRegistryIndex {
   #[serde(default)]
   agents: Vec<AcpRegistryAgent>,
}

#[derive(Deserialize)]
struct AcpRegistryAgent {
   id: String,
   name: String,
   description: String,
   icon: Option<String>,
   distribution: AcpRegistryDistribution,
}

#[derive(Deserialize)]
struct AcpRegistryDistribution {
   binary: Option<HashMap<String, AcpRegistryBinaryTarget>>,
   npx: Option<AcpRegistryPackageTarget>,
   uvx: Option<AcpRegistryPackageTarget>,
}

#[derive(Deserialize)]
struct AcpRegistryBinaryTarget {
   archive: String,
   cmd: String,
   #[serde(default)]
   args: Vec<String>,
   #[serde(default)]
   env: HashMap<String, String>,
}

#[derive(Deserialize)]
struct AcpRegistryPackageTarget {
   package: String,
   #[serde(default)]
   args: Vec<String>,
   #[serde(default)]
   env: HashMap<String, String>,
}

fn extensions_manifest_url() -> String {
   let base_url = std::env::var("ATHAS_EXTENSIONS_CDN_URL")
      .unwrap_or_else(|_| EXTENSIONS_CDN_BASE_URL.to_string());
   format!("{}/manifests.json", base_url.trim_end_matches('/'))
}

fn acp_registry_url() -> String {
   std::env::var("ATHAS_ACP_REGISTRY_URL").unwrap_or_else(|_| ACP_REGISTRY_URL.to_string())
}

fn current_platform_arch() -> Option<&'static str> {
   match (std::env::consts::OS, std::env::consts::ARCH) {
      ("macos", "aarch64") => Some("darwin-arm64"),
      ("macos", "x86_64") => Some("darwin-x64"),
      ("linux", "aarch64") => Some("linux-arm64"),
      ("linux", "x86_64") => Some("linux-x64"),
      ("windows", "aarch64") => Some("win32-arm64"),
      ("windows", "x86_64") => Some("win32-x64"),
      _ => None,
   }
}

fn current_acp_registry_platform() -> Option<&'static str> {
   match (std::env::consts::OS, std::env::consts::ARCH) {
      ("macos", "aarch64") => Some("darwin-aarch64"),
      ("macos", "x86_64") => Some("darwin-x86_64"),
      ("linux", "aarch64") => Some("linux-aarch64"),
      ("linux", "x86_64") => Some("linux-x86_64"),
      ("windows", "aarch64") => Some("windows-aarch64"),
      ("windows", "x86_64") => Some("windows-x86_64"),
      _ => None,
   }
}

fn registry_command_name(cmd: &str, fallback: &str) -> String {
   Path::new(cmd)
      .file_name()
      .and_then(|name| name.to_str())
      .map(|name| {
         if cfg!(windows) {
            name.strip_suffix(".exe").unwrap_or(name).to_string()
         } else {
            name.to_string()
         }
      })
      .filter(|name| !name.is_empty())
      .unwrap_or_else(|| fallback.to_string())
}

fn to_agent_config(contribution: MarketplaceAgentContribution) -> AgentConfig {
   let mut agent = AgentConfig {
      id: contribution.id,
      name: contribution.name,
      binary_name: contribution.binary_name,
      binary_path: None,
      args: contribution.args,
      env_vars: contribution.env_vars,
      icon: contribution.icon,
      description: contribution.description,
      installed: false,
      install_runtime: None,
      install_package: None,
      install_download_url: None,
      install_command: None,
      can_install: false,
   };

   if let Some(install) = contribution.install {
      let download_url = current_platform_arch()
         .and_then(|platform_arch| install.download_urls.get(platform_arch).cloned())
         .or(install.download_url);
      let is_binary_install = install.runtime == AgentRuntime::Binary;

      agent.install_runtime = Some(install.runtime);
      agent.install_package = Some(install.package);
      agent.install_command = install.command;
      agent.install_download_url = download_url;
      agent.can_install = agent.install_runtime.is_some()
         && agent.install_package.is_some()
         && (!is_binary_install || agent.install_download_url.is_some());
   }

   agent
}

fn acp_registry_agent_to_config(agent: AcpRegistryAgent) -> Option<AgentConfig> {
   let AcpRegistryAgent {
      id,
      name,
      description,
      icon,
      distribution,
   } = agent;

   if let Some(target) = current_acp_registry_platform()
      .and_then(|platform| distribution.binary.as_ref()?.get(platform))
   {
      let binary_name = registry_command_name(&target.cmd, &id);
      return Some(AgentConfig {
         id,
         name,
         binary_name,
         binary_path: None,
         args: target.args.clone(),
         env_vars: target.env.clone(),
         icon,
         description: Some(description),
         installed: false,
         install_runtime: Some(AgentRuntime::Binary),
         install_package: Some(target.cmd.clone()),
         install_download_url: Some(target.archive.clone()),
         install_command: Some(registry_command_name(&target.cmd, "")),
         can_install: true,
      });
   }

   if let Some(target) = distribution.npx {
      let mut args = vec!["-y".to_string(), target.package.clone()];
      args.extend(target.args.clone());
      return Some(AgentConfig {
         id,
         name,
         binary_name: "npx".to_string(),
         binary_path: None,
         args,
         env_vars: target.env,
         icon,
         description: Some(description),
         installed: false,
         install_runtime: Some(AgentRuntime::Node),
         install_package: Some(target.package),
         install_download_url: None,
         install_command: None,
         can_install: true,
      });
   }

   if let Some(target) = distribution.uvx {
      let mut args = vec![target.package];
      args.extend(target.args);
      return Some(AgentConfig {
         id,
         name,
         binary_name: "uvx".to_string(),
         binary_path: None,
         args,
         env_vars: target.env,
         icon,
         description: Some(description),
         installed: false,
         install_runtime: None,
         install_package: None,
         install_download_url: None,
         install_command: None,
         can_install: false,
      });
   }

   None
}

fn acp_registry_agents_from_index(index: AcpRegistryIndex) -> Vec<AgentConfig> {
   let mut agents = index
      .agents
      .into_iter()
      .filter_map(acp_registry_agent_to_config)
      .collect::<Vec<_>>();
   agents.sort_by_key(|agent| agent.name.clone());
   agents
}

async fn load_acp_registry_agents() -> Result<Vec<AgentConfig>, String> {
   let response = reqwest::Client::new()
      .get(acp_registry_url())
      .timeout(Duration::from_secs(5))
      .send()
      .await
      .map_err(|error| format!("Failed to load ACP registry: {}", error))?;

   if !response.status().is_success() {
      return Err(format!(
         "Failed to load ACP registry: HTTP {}",
         response.status()
      ));
   }

   let registry = response
      .json::<AcpRegistryIndex>()
      .await
      .map_err(|error| format!("Invalid ACP registry: {}", error))?;

   Ok(acp_registry_agents_from_index(registry))
}

async fn load_marketplace_agents() -> Result<Vec<AgentConfig>, String> {
   let cache = AGENT_CATALOG_CACHE.get_or_init(|| std::sync::Mutex::new(None));
   {
      let cached = cache
         .lock()
         .map_err(|_| "Agent catalog cache poisoned".to_string())?;
      if let Some(catalog) = cached.as_ref()
         && catalog.loaded_at.elapsed() < Duration::from_secs(AGENT_CATALOG_CACHE_SECONDS)
      {
         return Ok(catalog.agents.clone());
      }
   }

   let agents = match load_acp_registry_agents().await {
      Ok(agents) => agents,
      Err(registry_error) => {
         log::warn!("{}", registry_error);
         load_legacy_marketplace_agents().await?
      }
   };

   let mut cached = cache
      .lock()
      .map_err(|_| "Agent catalog cache poisoned".to_string())?;
   *cached = Some(CachedAgentCatalog {
      loaded_at: Instant::now(),
      agents: agents.clone(),
   });

   Ok(agents)
}

async fn load_legacy_marketplace_agents() -> Result<Vec<AgentConfig>, String> {
   let response = reqwest::Client::new()
      .get(extensions_manifest_url())
      .timeout(Duration::from_secs(5))
      .send()
      .await
      .map_err(|error| format!("Failed to load agent catalog: {}", error))?;

   if !response.status().is_success() {
      return Err(format!(
         "Failed to load agent catalog: HTTP {}",
         response.status()
      ));
   }

   let manifests = response
      .json::<HashMap<String, MarketplaceExtensionManifest>>()
      .await
      .map_err(|error| format!("Invalid agent catalog: {}", error))?;

   let mut agents = manifests
      .into_values()
      .flat_map(|manifest| manifest.agents)
      .map(to_agent_config)
      .collect::<Vec<_>>();
   agents.sort_by_key(|agent| agent.name.clone());

   Ok(agents)
}

async fn refresh_registered_agents(bridge: &mut AcpAgentBridge) {
   match load_marketplace_agents().await {
      Ok(agents) => bridge.replace_registered_agents(agents),
      Err(error) => {
         log::warn!("{}", error);
      }
   }
}

#[tauri::command]
pub async fn stop_acp_agent(bridge: State<'_, AcpBridgeState>) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge.stop_agent().await.map_err(|e| e.to_string())?;
   Ok(bridge.get_status().await)
}

#[tauri::command]
pub async fn send_acp_prompt(
   bridge: State<'_, AcpBridgeState>,
   prompt: Vec<serde_json::Value>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge.send_prompt(prompt).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_acp_status(bridge: State<'_, AcpBridgeState>) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
   Ok(bridge.get_status().await)
}

#[tauri::command]
pub async fn respond_acp_permission(
   bridge: State<'_, AcpBridgeState>,
   args: PermissionResponseArgs,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .respond_to_permission(
         args.request_id,
         args.approved,
         args.cancelled,
         args.option_id,
      )
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_acp_session_mode(
   bridge: State<'_, AcpBridgeState>,
   mode_id: String,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .set_session_mode(&mode_id)
      .await
      .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct SessionConfigOptionArgs {
   #[serde(alias = "configId")]
   config_id: String,
   value: String,
}

#[derive(Deserialize)]
pub struct SessionListArgs {
   cwd: Option<String>,
   cursor: Option<String>,
}

#[tauri::command]
pub async fn set_acp_session_config_option(
   bridge: State<'_, AcpBridgeState>,
   args: SessionConfigOptionArgs,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .set_session_config_option(&args.config_id, &args.value)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_acp_sessions(
   bridge: State<'_, AcpBridgeState>,
   args: SessionListArgs,
) -> Result<AcpSessionList, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .list_sessions(args.cwd, args.cursor)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_acp_prompt(bridge: State<'_, AcpBridgeState>) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge.cancel_prompt().await.map_err(|e| e.to_string())
}

fn tool_config_from_agent(agent: &AgentConfig) -> Result<ToolConfig, String> {
   let runtime = match agent.install_runtime.clone() {
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

fn remove_acp_wrapper(app_handle: &AppHandle, agent_id: &str) -> Result<(), String> {
   let wrapper_path = acp_wrapper_path(app_handle, agent_id)?;
   if wrapper_path.exists() {
      fs::remove_file(&wrapper_path).map_err(|e| format!("Failed to remove ACP wrapper: {}", e))?;
   }
   Ok(())
}

fn remove_managed_tool(app_handle: &AppHandle, tool_config: &ToolConfig) -> Result<(), String> {
   let Some(package) = tool_config.package.as_ref() else {
      return Ok(());
   };
   let tools_dir = ToolInstaller::get_tools_dir(app_handle).map_err(|e| e.to_string())?;
   let path = match tool_config.runtime {
      ToolRuntime::Node => tools_dir.join("npm").join(package),
      ToolRuntime::Python => tools_dir.join("python").join(package),
      ToolRuntime::Go => {
         ToolInstaller::get_tool_path(app_handle, tool_config).map_err(|e| e.to_string())?
      }
      ToolRuntime::Rust => {
         ToolInstaller::get_tool_path(app_handle, tool_config).map_err(|e| e.to_string())?
      }
      ToolRuntime::Binary => tools_dir.join("binary").join(&tool_config.name),
      ToolRuntime::Bun => tools_dir.join("bun").join(package),
      ToolRuntime::Ruby => tools_dir.join("ruby").join(package),
   };

   if path.is_dir() {
      fs::remove_dir_all(&path).map_err(|e| format!("Failed to remove managed tool: {}", e))?;
   } else if path.exists() {
      fs::remove_file(&path).map_err(|e| format!("Failed to remove managed tool: {}", e))?;
   }

   Ok(())
}

async fn write_acp_wrapper(
   app_handle: &AppHandle,
   agent: &AgentConfig,
   tool_config: &ToolConfig,
   installed_binary: &Path,
) -> Result<(), String> {
   let wrapper_path = acp_wrapper_path(app_handle, &agent.id)?;
   if let Some(parent) = wrapper_path.parent() {
      std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
   }

   let wrapper_contents = match agent.install_runtime {
      Some(AgentRuntime::Node) => {
         let managed_root = app_handle
            .path()
            .app_data_dir()
            .map(|dir| dir.join("runtimes"))
            .map_err(|e| format!("Failed to resolve runtime directory: {}", e))?;
         let node_path = RuntimeManager::get_runtime(Some(&managed_root), RuntimeType::Node)
            .await
            .map_err(|e| e.to_string())?;
         let entrypoint = ToolInstaller::get_lsp_launch_path(app_handle, tool_config)
            .map_err(|e| e.to_string())?;
         build_node_wrapper(&node_path, &entrypoint)
      }
      _ => build_binary_wrapper(installed_binary),
   };

   std::fs::write(&wrapper_path, wrapper_contents).map_err(|e| e.to_string())?;
   make_wrapper_executable(&wrapper_path)?;
   Ok(())
}

fn acp_wrapper_path(app_handle: &AppHandle, agent_id: &str) -> Result<PathBuf, String> {
   let data_dir = app_handle
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
   let file_name = if cfg!(windows) {
      format!("{agent_id}.cmd")
   } else {
      agent_id.to_string()
   };
   Ok(data_dir.join("tools").join("acp").join(file_name))
}

fn build_binary_wrapper(binary: &Path) -> String {
   #[cfg(target_os = "windows")]
   {
      format!("@echo off\r\n\"{}\" %*\r\n", binary.display())
   }

   #[cfg(not(target_os = "windows"))]
   {
      format!("#!/bin/sh\nexec \"{}\" \"$@\"\n", binary.display())
   }
}

fn build_node_wrapper(node_path: &Path, entrypoint: &Path) -> String {
   #[cfg(target_os = "windows")]
   {
      format!(
         "@echo off\r\n\"{}\" \"{}\" %*\r\n",
         node_path.display(),
         entrypoint.display()
      )
   }

   #[cfg(not(target_os = "windows"))]
   {
      format!(
         "#!/bin/sh\nexec \"{}\" \"{}\" \"$@\"\n",
         node_path.display(),
         entrypoint.display()
      )
   }
}

fn make_wrapper_executable(path: &PathBuf) -> Result<(), String> {
   #[cfg(unix)]
   {
      use std::os::unix::fs::PermissionsExt;
      let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
      let mut permissions = metadata.permissions();
      permissions.set_mode(0o755);
      std::fs::set_permissions(path, permissions).map_err(|e| e.to_string())?;
   }

   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;

   fn parse_registry(json: &str) -> Vec<AgentConfig> {
      let index: AcpRegistryIndex = serde_json::from_str(json).expect("registry fixture");
      acp_registry_agents_from_index(index)
   }

   #[test]
   fn acp_registry_maps_binary_agent_for_current_platform() {
      let agents = parse_registry(
         r#"{
            "agents": [
              {
                "id": "codex-acp",
                "name": "Codex CLI",
                "version": "0.14.0",
                "description": "ACP adapter for OpenAI's coding assistant",
                "distribution": {
                  "binary": {
                    "darwin-aarch64": {
                      "archive": "https://example.com/codex-aarch64.tar.gz",
                      "cmd": "./codex-acp",
                      "args": ["--acp"],
                      "env": { "CODEX_HOME": "/tmp/codex" }
                    },
                    "darwin-x86_64": {
                      "archive": "https://example.com/codex-x64.tar.gz",
                      "cmd": "./codex-acp"
                    },
                    "linux-x86_64": {
                      "archive": "https://example.com/codex-linux.tar.gz",
                      "cmd": "./codex-acp"
                    },
                    "windows-x86_64": {
                      "archive": "https://example.com/codex.zip",
                      "cmd": "./codex-acp.exe"
                    }
                  }
                },
                "icon": "https://example.com/codex.svg"
              }
            ]
         }"#,
      );

      let agent = agents
         .into_iter()
         .find(|agent| agent.id == "codex-acp")
         .expect("codex agent");

      assert_eq!(agent.name, "Codex CLI");
      assert_eq!(agent.install_runtime, Some(AgentRuntime::Binary));
      assert_eq!(agent.binary_name, "codex-acp");
      assert!(agent.can_install);
      assert!(agent.install_download_url.is_some());
      assert_eq!(agent.icon.as_deref(), Some("https://example.com/codex.svg"));
   }

   #[test]
   fn acp_registry_maps_npx_agent_to_npx_launch() {
      let agents = parse_registry(
         r#"{
            "agents": [
              {
                "id": "claude-acp",
                "name": "Claude Agent",
                "version": "0.33.1",
                "description": "ACP wrapper for Claude",
                "distribution": {
                  "npx": {
                    "package": "@agentclientprotocol/claude-agent-acp@0.33.1",
                    "args": ["--verbose"],
                    "env": { "ANTHROPIC_HOME": "/tmp/claude" }
                  }
                }
              }
            ]
         }"#,
      );

      let agent = agents
         .into_iter()
         .find(|agent| agent.id == "claude-acp")
         .expect("claude agent");

      assert_eq!(agent.binary_name, "npx");
      assert_eq!(agent.install_runtime, Some(AgentRuntime::Node));
      assert_eq!(
         agent.args,
         vec![
            "-y".to_string(),
            "@agentclientprotocol/claude-agent-acp@0.33.1".to_string(),
            "--verbose".to_string()
         ]
      );
      assert_eq!(
         agent.install_package.as_deref(),
         Some("@agentclientprotocol/claude-agent-acp@0.33.1")
      );
      assert!(agent.can_install);
   }

   #[test]
   fn acp_registry_includes_uvx_agents_without_managed_install_claim() {
      let agents = parse_registry(
         r#"{
            "agents": [
              {
                "id": "fast-agent",
                "name": "fast-agent",
                "version": "0.7.0",
                "description": "Code and build agents",
                "distribution": {
                  "uvx": {
                    "package": "fast-agent-acp==0.7.0",
                    "args": ["-x"]
                  }
                }
              }
            ]
         }"#,
      );

      let agent = agents
         .into_iter()
         .find(|agent| agent.id == "fast-agent")
         .expect("uvx agent");

      assert_eq!(agent.binary_name, "uvx");
      assert_eq!(
         agent.args,
         vec!["fast-agent-acp==0.7.0".to_string(), "-x".to_string()]
      );
      assert_eq!(agent.install_runtime, None);
      assert!(!agent.can_install);
   }

   #[test]
   fn acp_registry_prefers_current_platform_binary_over_npx() {
      let agents = parse_registry(
         r#"{
            "agents": [
              {
                "id": "kilo",
                "name": "Kilo",
                "version": "7.2.40",
                "description": "Kilo ACP",
                "distribution": {
                  "binary": {
                    "darwin-aarch64": {
                      "archive": "https://example.com/kilo-aarch64.tar.gz",
                      "cmd": "./kilo"
                    },
                    "darwin-x86_64": {
                      "archive": "https://example.com/kilo-x64.tar.gz",
                      "cmd": "./kilo"
                    },
                    "linux-x86_64": {
                      "archive": "https://example.com/kilo-linux.tar.gz",
                      "cmd": "./kilo"
                    },
                    "windows-x86_64": {
                      "archive": "https://example.com/kilo.zip",
                      "cmd": "kilo.exe"
                    }
                  },
                  "npx": {
                    "package": "kilo-code@7.2.40"
                  }
                }
              }
            ]
         }"#,
      );

      let agent = agents
         .into_iter()
         .find(|agent| agent.id == "kilo")
         .expect("kilo agent");

      assert_eq!(agent.install_runtime, Some(AgentRuntime::Binary));
      assert_eq!(agent.binary_name, "kilo");
   }
}
