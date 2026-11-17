//! The ACP agent catalog built from Athas's extension manifests: the copies bundled with the
//! app for offline discovery, refreshed from the extensions CDN.

use crate::acp::types::{AgentConfig, AgentRuntime, AgentSource};
use serde::Deserialize;
use std::{
   collections::HashMap,
   sync::Mutex,
   time::{Duration, Instant},
};

const AGENT_CATALOG_CACHE_TTL: Duration = Duration::from_secs(300);
const NON_ACP_AGENT_IDS: &[&str] = &["claude-code", "codex-cli", "codex"];
const BUNDLED_AGENT_MANIFESTS: &[&str] = &[
   include_str!("../../../../extensions/official/antigravity/extension.json"),
   include_str!("../../../../extensions/official/claude-code/extension.json"),
   include_str!("../../../../extensions/official/gemini-cli/extension.json"),
   include_str!("../../../../extensions/official/github-copilot/extension.json"),
   include_str!("../../../../extensions/official/kimi-cli/extension.json"),
   include_str!("../../../../extensions/official/opencode/extension.json"),
   include_str!("../../../../extensions/official/qwen-code/extension.json"),
];

/// Whether `agent_id` is an ACP agent rather than one of Athas's terminal integrations.
pub fn is_acp_agent_id(agent_id: &str) -> bool {
   !NON_ACP_AGENT_IDS.contains(&agent_id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceAgentInstall {
   runtime: AgentRuntime,
   package: String,
   version: Option<String>,
   command: Option<String>,
   #[serde(default)]
   commands_by_platform: HashMap<String, String>,
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
   args_by_platform: HashMap<String, Vec<String>>,
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

/// The manifests index served by the extensions CDN at `base_url`.
pub fn extensions_manifest_url(base_url: &str) -> String {
   format!("{}/manifests.json", base_url.trim_end_matches('/'))
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

fn to_agent_config(
   contribution: MarketplaceAgentContribution,
   platform_arch: Option<&str>,
) -> AgentConfig {
   let args = platform_arch
      .and_then(|platform| contribution.args_by_platform.get(platform).cloned())
      .unwrap_or(contribution.args);
   let mut agent = AgentConfig {
      id: contribution.id,
      name: contribution.name,
      binary_name: contribution.binary_name,
      binary_path: None,
      args,
      env_vars: contribution.env_vars,
      icon: contribution.icon,
      description: contribution.description,
      installed: false,
      install_runtime: None,
      install_package: None,
      available_version: None,
      installed_version: None,
      update_available: false,
      managed: false,
      install_download_url: None,
      install_command: None,
      can_install: false,
      source: AgentSource::Extension,
      registry: None,
   };

   if let Some(install) = contribution.install {
      let download_url = platform_arch
         .and_then(|platform_arch| install.download_urls.get(platform_arch).cloned())
         .or(install.download_url);
      let command = platform_arch
         .and_then(|platform_arch| install.commands_by_platform.get(platform_arch).cloned())
         .or(install.command);
      let is_binary_install = install.runtime == AgentRuntime::Binary;

      agent.install_runtime = Some(install.runtime);
      agent.install_package = Some(install.package);
      agent.available_version = install.version;
      agent.install_command = command;
      agent.install_download_url = download_url;
      agent.can_install = agent.install_runtime.is_some()
         && agent.install_package.is_some()
         && (!is_binary_install || agent.install_download_url.is_some());
   }

   agent
}

/// Remote manifests win over the bundled fallback for the same agent id; sorted by name.
fn merge_agent_catalog(
   marketplace_agents: Vec<AgentConfig>,
   fallback_agents: Vec<AgentConfig>,
) -> Vec<AgentConfig> {
   let mut agents = marketplace_agents
      .into_iter()
      .map(|agent| (agent.id.clone(), agent))
      .collect::<HashMap<_, _>>();

   for fallback in fallback_agents {
      agents.entry(fallback.id.clone()).or_insert(fallback);
   }

   let mut agents = agents.into_values().collect::<Vec<_>>();
   agents.sort_by_key(|agent| agent.name.clone());
   agents
}

fn bundled_agent_catalog() -> Vec<AgentConfig> {
   BUNDLED_AGENT_MANIFESTS
      .iter()
      .filter_map(
         |manifest| match serde_json::from_str::<MarketplaceExtensionManifest>(manifest) {
            Ok(manifest) => Some(manifest),
            Err(error) => {
               log::error!("Invalid bundled agent manifest: {error}");
               None
            }
         },
      )
      .flat_map(|manifest| manifest.agents)
      .filter(|agent| is_acp_agent_id(&agent.id))
      .map(|agent| to_agent_config(agent, current_platform_arch()))
      .collect()
}

fn agent_configs_from_manifests(
   manifests: HashMap<String, MarketplaceExtensionManifest>,
) -> Vec<AgentConfig> {
   manifests
      .into_values()
      .flat_map(|manifest| manifest.agents)
      .filter(|agent| is_acp_agent_id(&agent.id))
      .map(|agent| to_agent_config(agent, current_platform_arch()))
      .collect()
}

/// Caches the merged catalog for a few minutes so opening chats does not refetch it.
#[derive(Default)]
pub struct AgentCatalogCache {
   cached: Mutex<Option<(Instant, Vec<AgentConfig>)>>,
}

impl AgentCatalogCache {
   pub const fn new() -> Self {
      Self {
         cached: Mutex::new(None),
      }
   }

   /// The catalog from `manifest_url` merged over the bundled agents; a failed or invalid
   /// download falls back to the bundled agents alone.
   pub async fn load(&self, manifest_url: &str) -> Result<Vec<AgentConfig>, String> {
      if let Some(agents) = self.fresh()? {
         return Ok(agents);
      }

      let agents = merge_agent_catalog(
         fetch_manifest_agents(manifest_url).await,
         bundled_agent_catalog(),
      );
      *self
         .cached
         .lock()
         .map_err(|_| "Agent catalog cache poisoned".to_string())? =
         Some((Instant::now(), agents.clone()));
      Ok(agents)
   }

   fn fresh(&self) -> Result<Option<Vec<AgentConfig>>, String> {
      let cached = self
         .cached
         .lock()
         .map_err(|_| "Agent catalog cache poisoned".to_string())?;
      Ok(cached
         .as_ref()
         .filter(|(loaded_at, _)| loaded_at.elapsed() < AGENT_CATALOG_CACHE_TTL)
         .map(|(_, agents)| agents.clone()))
   }
}

async fn fetch_manifest_agents(manifest_url: &str) -> Vec<AgentConfig> {
   let response = match reqwest::Client::new()
      .get(manifest_url)
      .timeout(Duration::from_secs(5))
      .send()
      .await
   {
      Ok(response) if response.status().is_success() => response,
      Ok(response) => {
         log::warn!(
            "Failed to load agent catalog: HTTP {}; using bundled agents",
            response.status()
         );
         return Vec::new();
      }
      Err(error) => {
         log::warn!(
            "Failed to load agent catalog: {}; using bundled agents",
            error
         );
         return Vec::new();
      }
   };

   match response
      .text()
      .await
      .map_err(|error| error.to_string())
      .and_then(|body| {
         serde_json::from_str::<HashMap<String, MarketplaceExtensionManifest>>(&body)
            .map_err(|error| error.to_string())
      }) {
      Ok(manifests) => agent_configs_from_manifests(manifests),
      Err(error) => {
         log::warn!("Invalid remote agent catalog: {error}; using bundled agents");
         Vec::new()
      }
   }
}

#[cfg(test)]
mod tests;
