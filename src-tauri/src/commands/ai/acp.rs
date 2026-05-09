use crate::app_runtime::AppHandle;
use athas_ai::{AcpAgentBridge, AcpAgentStatus, AcpSessionList, AgentConfig, AgentRuntime};
use athas_runtime::{RuntimeManager, RuntimeType};
use athas_tooling::{ToolConfig, ToolInstaller, ToolRuntime};
use serde::{Deserialize, Serialize};
use std::{
   collections::HashMap,
   fs,
   path::{Path, PathBuf},
   sync::Arc,
   time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

pub type AcpBridgeState = Arc<Mutex<AcpAgentBridge>>;
const EXTENSIONS_CDN_BASE_URL: &str = "https://athas.dev/extensions";
const ACP_REGISTRY_URL: &str =
   "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const AGENT_CATALOG_CACHE_SECONDS: u64 = 300;
const EXCLUDED_ACP_REGISTRY_AGENT_IDS: &[&str] = &["agoragentic-acp"];

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
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
) -> Result<Vec<AgentConfig>, String> {
   let mut bridge = bridge.lock().await;
   refresh_registered_agents(&app_handle, &mut bridge).await;
   Ok(bridge.detect_agents())
}

#[tauri::command]
pub async fn start_acp_agent(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
   workspace_path: Option<String>,
   session_id: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = {
      let mut bridge = bridge.lock().await;
      refresh_registered_agents(&app_handle, &mut bridge).await;
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
      refresh_registered_agents(&app_handle, &mut bridge).await;
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
      refresh_registered_agents(&app_handle, &mut bridge).await;
      bridge.invalidate_agent_detection_cache();
      let agents = bridge.detect_agents();
      agents
         .into_iter()
         .find(|agent| agent.id == agent_id)
         .ok_or_else(|| format!("Unknown ACP agent: {}", agent_id))?
   };

   let tool_config = tool_config_from_agent(&agent)?;
   remove_acp_wrapper(&app_handle, &agent.id)?;
   remove_acp_install_receipt(&app_handle, &agent.id)?;
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
enum AcpAgentServerSetting {
   Custom {
      command: String,
      #[serde(default)]
      args: Vec<String>,
      #[serde(default)]
      env: HashMap<String, String>,
      #[serde(default, alias = "defaultMode")]
      default_mode: Option<String>,
      #[serde(default, alias = "defaultModel")]
      default_model: Option<String>,
   },
   Registry {
      #[serde(default)]
      env: HashMap<String, String>,
      #[serde(default, alias = "defaultMode")]
      default_mode: Option<String>,
      #[serde(default, alias = "defaultModel")]
      default_model: Option<String>,
   },
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

fn npm_package_name(package_spec: &str) -> String {
   let spec = package_spec.trim();
   if let Some(scoped) = spec.strip_prefix('@') {
      let mut segments = scoped.splitn(3, '/');
      let Some(scope) = segments.next() else {
         return spec.to_string();
      };
      let Some(name_and_version) = segments.next() else {
         return spec.to_string();
      };
      let name = name_and_version
         .rsplit_once('@')
         .map(|(name, _)| name)
         .unwrap_or(name_and_version);
      if name.is_empty() {
         spec.to_string()
      } else {
         format!("@{scope}/{name}")
      }
   } else {
      spec
         .rsplit_once('@')
         .map(|(name, _)| name)
         .filter(|name| !name.is_empty())
         .unwrap_or(spec)
         .to_string()
   }
}

fn package_command_name(package_name: &str, fallback: &str) -> String {
   package_name
      .rsplit('/')
      .next()
      .filter(|name| !name.is_empty())
      .unwrap_or(fallback)
      .to_string()
}

fn npx_command_name(package_name: &str, fallback: &str) -> String {
   match package_name {
      "@google/gemini-cli" => "gemini".to_string(),
      "@qwen-code/qwen-code" => "qwen".to_string(),
      "@tencent-ai/codebuddy-code" => "codebuddy".to_string(),
      "dirac-cli" => "dirac".to_string(),
      _ => package_command_name(package_name, fallback),
   }
}

fn python_package_spec_from_uvx(package_spec: &str) -> String {
   let spec = package_spec.trim();
   if spec.contains("==") {
      return spec.to_string();
   }
   spec
      .rsplit_once('@')
      .map(|(package, version)| format!("{package}=={version}"))
      .unwrap_or_else(|| spec.to_string())
}

fn python_command_name(package_spec: &str, fallback: &str) -> String {
   let package = package_spec
      .split_once("==")
      .map(|(package, _)| package)
      .unwrap_or(package_spec)
      .trim();
   package_command_name(package, fallback)
}

fn to_agent_config(contribution: MarketplaceAgentContribution) -> AgentConfig {
   let mut agent = AgentConfig {
      id: contribution.id,
      name: contribution.name,
      binary_name: contribution.binary_name,
      binary_path: None,
      args: contribution.args,
      env_vars: contribution.env_vars,
      default_mode: None,
      default_model: None,
      icon: contribution.icon,
      description: contribution.description,
      installed: false,
      install_runtime: None,
      install_package: None,
      install_download_url: None,
      install_command: None,
      can_install: false,
      update_available: false,
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
         default_mode: None,
         default_model: None,
         icon,
         description: Some(description),
         installed: false,
         install_runtime: Some(AgentRuntime::Binary),
         install_package: Some(target.cmd.clone()),
         install_download_url: Some(target.archive.clone()),
         install_command: Some(registry_command_name(&target.cmd, "")),
         can_install: true,
         update_available: false,
      });
   }

   if let Some(target) = distribution.npx {
      let package_name = npm_package_name(&target.package);
      let command = npx_command_name(&package_name, &id);
      return Some(AgentConfig {
         id,
         name,
         binary_name: command.clone(),
         binary_path: None,
         args: target.args.clone(),
         env_vars: target.env,
         default_mode: None,
         default_model: None,
         icon,
         description: Some(description),
         installed: false,
         install_runtime: Some(AgentRuntime::Node),
         install_package: Some(target.package),
         install_download_url: None,
         install_command: Some(command),
         can_install: true,
         update_available: false,
      });
   }

   if let Some(target) = distribution.uvx {
      let package = python_package_spec_from_uvx(&target.package);
      let command = python_command_name(&package, &id);
      return Some(AgentConfig {
         id,
         name,
         binary_name: command.clone(),
         binary_path: None,
         args: target.args,
         env_vars: target.env,
         default_mode: None,
         default_model: None,
         icon,
         description: Some(description),
         installed: false,
         install_runtime: Some(AgentRuntime::Python),
         install_package: Some(package),
         install_download_url: None,
         install_command: Some(command),
         can_install: true,
         update_available: false,
      });
   }

   None
}

fn acp_registry_agents_from_index(index: AcpRegistryIndex) -> Vec<AgentConfig> {
   let mut agents = index
      .agents
      .into_iter()
      .filter(|agent| !EXCLUDED_ACP_REGISTRY_AGENT_IDS.contains(&agent.id.as_str()))
      .filter_map(acp_registry_agent_to_config)
      .collect::<Vec<_>>();
   agents.sort_by_key(|agent| agent.name.clone());
   agents
}

fn acp_registry_cache_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
   app_handle
      .path()
      .app_data_dir()
      .map(|dir| dir.join("acp-registry").join("registry.json"))
      .map_err(|error| format!("Failed to resolve ACP registry cache path: {}", error))
}

fn acp_registry_agents_from_json(json: &str) -> Result<Vec<AgentConfig>, String> {
   let registry = serde_json::from_str::<AcpRegistryIndex>(json)
      .map_err(|error| format!("Invalid ACP registry: {}", error))?;
   Ok(acp_registry_agents_from_index(registry))
}

fn load_cached_acp_registry_agents(app_handle: &AppHandle) -> Result<Vec<AgentConfig>, String> {
   let cache_path = acp_registry_cache_path(app_handle)?;
   let json = fs::read_to_string(&cache_path)
      .map_err(|error| format!("Failed to read cached ACP registry: {}", error))?;
   acp_registry_agents_from_json(&json)
      .map_err(|error| format!("Invalid cached ACP registry: {}", error))
}

fn write_acp_registry_cache(app_handle: &AppHandle, json: &str) -> Result<(), String> {
   let cache_path = acp_registry_cache_path(app_handle)?;
   if let Some(parent) = cache_path.parent() {
      fs::create_dir_all(parent)
         .map_err(|error| format!("Failed to create ACP registry cache directory: {}", error))?;
   }
   fs::write(&cache_path, json)
      .map_err(|error| format!("Failed to write ACP registry cache: {}", error))
}

async fn load_acp_registry_agents(app_handle: &AppHandle) -> Result<Vec<AgentConfig>, String> {
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

   let json = response
      .text()
      .await
      .map_err(|error| format!("Failed to read ACP registry response: {}", error))?;

   let agents = acp_registry_agents_from_json(&json)?;
   if let Err(error) = write_acp_registry_cache(app_handle, &json) {
      log::warn!("{}", error);
   }

   Ok(agents)
}

async fn load_preferred_registry_agents(
   app_handle: &AppHandle,
) -> Result<Vec<AgentConfig>, String> {
   match load_acp_registry_agents(app_handle).await {
      Ok(agents) => Ok(agents),
      Err(registry_error) => {
         log::warn!("{}", registry_error);
         load_cached_acp_registry_agents(app_handle).map_err(|cache_error| {
            log::warn!("{}", cache_error);
            registry_error
         })
      }
   }
}

fn merge_agent_catalogs(
   mut preferred_agents: Vec<AgentConfig>,
   fallback_agents: Vec<AgentConfig>,
) -> Vec<AgentConfig> {
   for agent in fallback_agents {
      if !preferred_agents
         .iter()
         .any(|preferred| preferred.id == agent.id)
      {
         preferred_agents.push(agent);
      }
   }
   preferred_agents.sort_by_key(|agent| agent.name.clone());
   preferred_agents
}

fn apply_agent_server_settings(
   mut agents: Vec<AgentConfig>,
   settings: HashMap<String, AcpAgentServerSetting>,
) -> Vec<AgentConfig> {
   for (id, setting) in settings {
      match setting {
         AcpAgentServerSetting::Custom {
            command,
            args,
            env,
            default_mode,
            default_model,
         } => {
            if command.trim().is_empty() {
               log::warn!("Skipping custom ACP agent '{}' with an empty command", id);
               continue;
            }
            let binary_name = registry_command_name(&command, &id);
            let custom_agent = AgentConfig {
               id: id.clone(),
               name: id,
               binary_name,
               binary_path: Some(expand_home(&command)),
               args,
               env_vars: env,
               default_mode: clean_setting(default_mode),
               default_model: clean_setting(default_model),
               icon: None,
               description: Some("Custom ACP agent from Athas settings".to_string()),
               installed: false,
               install_runtime: None,
               install_package: None,
               install_download_url: None,
               install_command: None,
               can_install: false,
               update_available: false,
            };
            upsert_agent(&mut agents, custom_agent);
         }
         AcpAgentServerSetting::Registry {
            env,
            default_mode,
            default_model,
         } => {
            let Some(agent) = agents
               .iter_mut()
               .find(|agent| agent.id == id || agent.name == id)
            else {
               log::debug!("Configured ACP registry agent '{}' was not found", id);
               continue;
            };
            agent.env_vars.extend(env);
            agent.default_mode = clean_setting(default_mode);
            agent.default_model = clean_setting(default_model);
         }
      }
   }

   agents.sort_by_key(|agent| agent.name.clone());
   agents
}

fn clean_setting(value: Option<String>) -> Option<String> {
   value
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty())
}

fn expand_home(path: &str) -> String {
   if path == "~" {
      return std::env::var("HOME").unwrap_or_else(|_| path.to_string());
   }
   if let Some(rest) = path.strip_prefix("~/") {
      if let Ok(home) = std::env::var("HOME") {
         return Path::new(&home).join(rest).to_string_lossy().to_string();
      }
   }
   path.to_string()
}

fn upsert_agent(agents: &mut Vec<AgentConfig>, agent: AgentConfig) {
   if let Some(existing) = agents.iter_mut().find(|existing| existing.id == agent.id) {
      *existing = agent;
   } else {
      agents.push(agent);
   }
}

fn load_agent_server_settings(
   app_handle: &AppHandle,
) -> Result<HashMap<String, AcpAgentServerSetting>, String> {
   let store = app_handle
      .store("settings.json")
      .map_err(|error| format!("Failed to load settings store: {}", error))?;
   let Some(value) = store.get("agentServers") else {
      return Ok(HashMap::new());
   };
   let raw_settings = serde_json::from_value::<HashMap<String, serde_json::Value>>(value)
      .map_err(|error| format!("Invalid agentServers settings: {}", error))?;
   let mut settings = HashMap::new();

   for (id, value) in raw_settings {
      match serde_json::from_value::<AcpAgentServerSetting>(value) {
         Ok(setting) => {
            settings.insert(id, setting);
         }
         Err(error) => {
            log::warn!("Skipping invalid ACP agent setting '{}': {}", id, error);
         }
      }
   }

   Ok(settings)
}

async fn load_marketplace_agents(app_handle: &AppHandle) -> Result<Vec<AgentConfig>, String> {
   let cache = AGENT_CATALOG_CACHE.get_or_init(|| std::sync::Mutex::new(None));
   {
      let cached = cache
         .lock()
         .map_err(|_| "Agent catalog cache poisoned".to_string())?;
      if let Some(catalog) = cached.as_ref()
         && catalog.loaded_at.elapsed() < Duration::from_secs(AGENT_CATALOG_CACHE_SECONDS)
      {
         let agent_settings = load_agent_server_settings(app_handle).map_err(|error| {
            log::warn!("{}", error);
            error
         })?;
         return Ok(apply_agent_server_settings(
            catalog.agents.clone(),
            agent_settings,
         ));
      }
   }

   let registry_agents = load_preferred_registry_agents(app_handle).await;
   let legacy_agents = load_legacy_marketplace_agents().await;
   let agents = match (registry_agents, legacy_agents) {
      (Ok(registry_agents), Ok(legacy_agents)) => {
         merge_agent_catalogs(registry_agents, legacy_agents)
      }
      (Ok(registry_agents), Err(legacy_error)) => {
         log::warn!("{}", legacy_error);
         registry_agents
      }
      (Err(registry_error), Ok(legacy_agents)) => {
         log::warn!("{}", registry_error);
         legacy_agents
      }
      (Err(registry_error), Err(legacy_error)) => {
         return Err(format!(
            "{}; legacy agent catalog also failed: {}",
            registry_error, legacy_error
         ));
      }
   };

   let mut cached = cache
      .lock()
      .map_err(|_| "Agent catalog cache poisoned".to_string())?;
   *cached = Some(CachedAgentCatalog {
      loaded_at: Instant::now(),
      agents: agents.clone(),
   });

   let agent_settings = load_agent_server_settings(app_handle).map_err(|error| {
      log::warn!("{}", error);
      error
   })?;
   Ok(apply_agent_server_settings(agents, agent_settings))
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

async fn refresh_registered_agents(app_handle: &AppHandle, bridge: &mut AcpAgentBridge) {
   match load_marketplace_agents(app_handle).await {
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
      ToolRuntime::Node => tools_dir
         .join("npm")
         .join(ToolInstaller::managed_dir_name(package)),
      ToolRuntime::Python => tools_dir
         .join("python")
         .join(ToolInstaller::managed_dir_name(package)),
      ToolRuntime::Go => {
         ToolInstaller::get_tool_path(app_handle, tool_config).map_err(|e| e.to_string())?
      }
      ToolRuntime::Rust => {
         ToolInstaller::get_tool_path(app_handle, tool_config).map_err(|e| e.to_string())?
      }
      ToolRuntime::Binary => tools_dir
         .join("binary")
         .join(ToolInstaller::managed_dir_name(&tool_config.name)),
      ToolRuntime::Bun => tools_dir
         .join("bun")
         .join(ToolInstaller::managed_dir_name(package)),
      ToolRuntime::Ruby => tools_dir
         .join("ruby")
         .join(ToolInstaller::managed_dir_name(package)),
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
   write_acp_install_receipt(app_handle, agent)?;
   Ok(())
}

fn acp_wrapper_path(app_handle: &AppHandle, agent_id: &str) -> Result<PathBuf, String> {
   let data_dir = app_handle
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
   let safe_agent_id = receipt_file_stem(agent_id);
   let file_name = if cfg!(windows) {
      format!("{safe_agent_id}.cmd")
   } else {
      safe_agent_id
   };
   Ok(data_dir.join("tools").join("acp").join(file_name))
}

fn acp_install_receipt_path(app_handle: &AppHandle, agent_id: &str) -> Result<PathBuf, String> {
   let data_dir = app_handle
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
   Ok(data_dir
      .join("tools")
      .join("acp")
      .join(".receipts")
      .join(format!("{}.json", receipt_file_stem(agent_id))))
}

fn receipt_file_stem(agent_id: &str) -> String {
   let stem = agent_id
      .chars()
      .map(|character| match character {
         'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => character,
         _ => '_',
      })
      .collect::<String>();
   if stem == "." || stem == ".." {
      stem.replace('.', "_")
   } else {
      stem
   }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AcpInstallReceipt {
   agent_id: String,
   install_runtime: Option<String>,
   install_package: Option<String>,
   install_download_url: Option<String>,
   install_command: Option<String>,
   installed_at_unix_seconds: u64,
}

fn write_acp_install_receipt(app_handle: &AppHandle, agent: &AgentConfig) -> Result<(), String> {
   let receipt_path = acp_install_receipt_path(app_handle, &agent.id)?;
   if let Some(parent) = receipt_path.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("Failed to create ACP receipt dir: {}", e))?;
   }

   let receipt = AcpInstallReceipt {
      agent_id: agent.id.clone(),
      install_runtime: agent_runtime_key(agent),
      install_package: agent.install_package.clone(),
      install_download_url: agent.install_download_url.clone(),
      install_command: agent.install_command.clone(),
      installed_at_unix_seconds: SystemTime::now()
         .duration_since(UNIX_EPOCH)
         .map(|duration| duration.as_secs())
         .unwrap_or_default(),
   };
   let json = serde_json::to_string_pretty(&receipt)
      .map_err(|e| format!("Failed to encode ACP install receipt: {}", e))?;
   fs::write(receipt_path, json).map_err(|e| format!("Failed to write ACP install receipt: {}", e))
}

fn remove_acp_install_receipt(app_handle: &AppHandle, agent_id: &str) -> Result<(), String> {
   let receipt_path = acp_install_receipt_path(app_handle, agent_id)?;
   if receipt_path.exists() {
      fs::remove_file(&receipt_path)
         .map_err(|e| format!("Failed to remove ACP install receipt: {}", e))?;
   }
   Ok(())
}

fn agent_runtime_key(agent: &AgentConfig) -> Option<String> {
   agent
      .install_runtime
      .as_ref()
      .and_then(|runtime| serde_json::to_value(runtime).ok())
      .and_then(|value| value.as_str().map(ToString::to_string))
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

   fn agent(id: &str, name: &str, binary_name: &str) -> AgentConfig {
      AgentConfig {
         id: id.to_string(),
         name: name.to_string(),
         binary_name: binary_name.to_string(),
         binary_path: None,
         args: Vec::new(),
         env_vars: HashMap::new(),
         default_mode: None,
         default_model: None,
         icon: None,
         description: None,
         installed: false,
         install_runtime: None,
         install_package: None,
         install_download_url: None,
         install_command: None,
         can_install: false,
         update_available: false,
      }
   }

   #[test]
   fn merge_agent_catalogs_prefers_registry_and_preserves_legacy_only_agents() {
      let mut registry = agent("codex-acp", "Codex Registry", "npx");
      registry.args = vec!["-y".to_string(), "@vendor/codex-acp".to_string()];
      let legacy = agent("codex-acp", "Codex Legacy", "codex-acp");
      let legacy_only = agent("athas-local", "Athas Local", "athas-local");

      let merged = merge_agent_catalogs(vec![registry], vec![legacy, legacy_only]);

      assert_eq!(merged.len(), 2);
      let codex = merged
         .iter()
         .find(|candidate| candidate.id == "codex-acp")
         .expect("codex agent");
      assert_eq!(codex.name, "Codex Registry");
      assert_eq!(codex.binary_name, "npx");
      assert!(merged.iter().any(|candidate| candidate.id == "athas-local"));
   }

   #[test]
   fn registry_settings_override_env_and_defaults_without_dropping_agent() {
      let mut base = agent("codex-acp", "Codex", "npx");
      base.env_vars.insert(
         "BASE_URL".to_string(),
         "https://registry.example".to_string(),
      );
      base
         .env_vars
         .insert("KEEP_ME".to_string(), "registry".to_string());

      let mut env = HashMap::new();
      env.insert("BASE_URL".to_string(), "https://user.example".to_string());
      env.insert("USER_ONLY".to_string(), "true".to_string());
      let mut settings = HashMap::new();
      settings.insert(
         "codex-acp".to_string(),
         AcpAgentServerSetting::Registry {
            env,
            default_mode: Some("plan".to_string()),
            default_model: Some("gpt-5.5".to_string()),
         },
      );

      let agents = apply_agent_server_settings(vec![base], settings);
      let codex = agents.first().expect("codex agent");

      assert_eq!(
         codex.env_vars.get("BASE_URL").map(String::as_str),
         Some("https://user.example")
      );
      assert_eq!(
         codex.env_vars.get("KEEP_ME").map(String::as_str),
         Some("registry")
      );
      assert_eq!(
         codex.env_vars.get("USER_ONLY").map(String::as_str),
         Some("true")
      );
      assert_eq!(codex.default_mode.as_deref(), Some("plan"));
      assert_eq!(codex.default_model.as_deref(), Some("gpt-5.5"));
   }

   #[test]
   fn custom_agent_settings_create_runnable_agent_config() {
      let mut env = HashMap::new();
      env.insert("CUSTOM_TOKEN".to_string(), "secret".to_string());
      let mut settings = HashMap::new();
      settings.insert(
         "my-agent".to_string(),
         AcpAgentServerSetting::Custom {
            command: "/usr/local/bin/my-agent".to_string(),
            args: vec!["--acp".to_string()],
            env,
            default_mode: Some(" act ".to_string()),
            default_model: Some(" custom-model ".to_string()),
         },
      );

      let agents = apply_agent_server_settings(Vec::new(), settings);
      let custom = agents.first().expect("custom agent");

      assert_eq!(custom.id, "my-agent");
      assert_eq!(custom.name, "my-agent");
      assert_eq!(custom.binary_name, "my-agent");
      assert_eq!(
         custom.binary_path.as_deref(),
         Some("/usr/local/bin/my-agent")
      );
      assert_eq!(custom.args, vec!["--acp"]);
      assert_eq!(
         custom.env_vars.get("CUSTOM_TOKEN").map(String::as_str),
         Some("secret")
      );
      assert_eq!(custom.default_mode.as_deref(), Some("act"));
      assert_eq!(custom.default_model.as_deref(), Some("custom-model"));
      assert!(!custom.can_install);
   }

   #[test]
   fn malformed_custom_agent_settings_are_skipped() {
      let mut settings = HashMap::new();
      settings.insert(
         "broken".to_string(),
         AcpAgentServerSetting::Custom {
            command: " ".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
            default_mode: None,
            default_model: None,
         },
      );

      let agents = apply_agent_server_settings(Vec::new(), settings);

      assert!(agents.is_empty());
   }

   #[test]
   fn npm_package_name_strips_registry_version_specs() {
      assert_eq!(npm_package_name("cline@2.18.0"), "cline");
      assert_eq!(
         npm_package_name("@agentclientprotocol/claude-agent-acp@0.33.1"),
         "@agentclientprotocol/claude-agent-acp"
      );
      assert_eq!(npm_package_name("@scope/package"), "@scope/package");
   }

   #[test]
   fn npx_command_name_uses_known_package_binary_aliases() {
      assert_eq!(npx_command_name("@google/gemini-cli", "gemini"), "gemini");
      assert_eq!(
         npx_command_name("@qwen-code/qwen-code", "qwen-code"),
         "qwen"
      );
      assert_eq!(
         npx_command_name("@tencent-ai/codebuddy-code", "codebuddy-code"),
         "codebuddy"
      );
      assert_eq!(npx_command_name("dirac-cli", "dirac"), "dirac");
      assert_eq!(npx_command_name("cline", "cline"), "cline");
   }

   #[test]
   fn python_package_spec_from_uvx_converts_registry_version_specs() {
      assert_eq!(
         python_package_spec_from_uvx("fast-agent-acp==0.7.1"),
         "fast-agent-acp==0.7.1"
      );
      assert_eq!(
         python_package_spec_from_uvx("minion-code@0.1.44"),
         "minion-code==0.1.44"
      );
   }

   #[test]
   fn acp_registry_json_maps_npx_distribution_as_managed_node_install() {
      let json = r#"{
        "agents": [
          {
            "id": "qwen-code",
            "name": "Qwen Code",
            "description": "Qwen ACP adapter",
            "icon": "codex.svg",
            "distribution": {
              "npx": {
                "package": "@qwen-code/qwen-code@0.15.9",
                "args": ["--acp"],
                "env": { "REGISTRY_ENV": "1" }
              }
            }
          }
        ]
      }"#;

      let agents = acp_registry_agents_from_json(json).expect("registry agents");
      let qwen = agents.first().expect("qwen agent");

      assert_eq!(qwen.id, "qwen-code");
      assert_eq!(qwen.binary_name, "qwen");
      assert_eq!(qwen.args, vec!["--acp".to_string()]);
      assert_eq!(qwen.install_runtime, Some(AgentRuntime::Node));
      assert_eq!(
         qwen.install_package.as_deref(),
         Some("@qwen-code/qwen-code@0.15.9")
      );
      assert_eq!(qwen.install_command.as_deref(), Some("qwen"));
      assert!(qwen.can_install);
      assert_eq!(
         qwen.env_vars.get("REGISTRY_ENV").map(String::as_str),
         Some("1")
      );
   }

   #[test]
   fn acp_registry_json_skips_excluded_agents() {
      let json = r#"{
        "agents": [
          {
            "id": "agoragentic-acp",
            "name": "Agoragentic",
            "description": "Marketplace adapter",
            "distribution": {
              "npx": {
                "package": "agoragentic-mcp@1.3.0",
                "args": ["--acp"]
              }
            }
          },
          {
            "id": "codex-acp",
            "name": "Codex",
            "description": "Codex ACP adapter",
            "distribution": {
              "npx": {
                "package": "@vendor/codex-acp"
              }
            }
          }
        ]
      }"#;

      let agents = acp_registry_agents_from_json(json).expect("registry agents");

      assert_eq!(agents.len(), 1);
      assert_eq!(
         agents.first().map(|agent| agent.id.as_str()),
         Some("codex-acp")
      );
   }

   #[test]
   fn acp_registry_json_maps_uvx_distribution_as_managed_python_install() {
      let json = r#"{
        "agents": [
          {
            "id": "minion-code",
            "name": "Minion Code",
            "description": "Minion ACP adapter",
            "distribution": {
              "uvx": {
                "package": "minion-code@0.1.44",
                "args": ["acp"]
              }
            }
          }
        ]
      }"#;

      let agents = acp_registry_agents_from_json(json).expect("registry agents");
      let minion = agents.first().expect("minion agent");

      assert_eq!(minion.id, "minion-code");
      assert_eq!(minion.binary_name, "minion-code");
      assert_eq!(minion.args, vec!["acp".to_string()]);
      assert_eq!(minion.install_runtime, Some(AgentRuntime::Python));
      assert_eq!(
         minion.install_package.as_deref(),
         Some("minion-code==0.1.44")
      );
      assert_eq!(minion.install_command.as_deref(), Some("minion-code"));
      assert!(minion.can_install);
   }
}
