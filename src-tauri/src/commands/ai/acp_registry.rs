//! Installs agents from the ACP Registry: the registry copy lives in `<app data>/acp-registry`,
//! installs in `<app data>/agents/<agent id>/<version>`, and the launcher Athas starts in
//! `<app data>/tools/acp`, where installed agents are detected.

use crate::app_runtime::AppHandle;
use athas_ai::{
   AgentConfig,
   acp::registry::{
      self, RegistrySnapshot, RegistryStore, ResolvedDistribution, current_registry_platform,
      install, store::https_client,
   },
};
use athas_runtime::NodeRuntime;
use std::{fs, path::PathBuf, sync::OnceLock};
use tauri::Manager;
use tokio::sync::Mutex;

static REGISTRY_STORE: OnceLock<Mutex<Option<RegistryStore>>> = OnceLock::new();

fn app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
   app_handle
      .path()
      .app_data_dir()
      .map_err(|error| format!("Failed to resolve app data dir: {error}"))
}

/// The registry, refreshed at most hourly unless `force` is set; the cached copy when offline.
pub async fn registry_snapshot(app_handle: &AppHandle, force: bool) -> RegistrySnapshot {
   let Ok(data_dir) = app_data_dir(app_handle) else {
      return RegistrySnapshot::default();
   };
   let mut store = REGISTRY_STORE.get_or_init(|| Mutex::new(None)).lock().await;
   store
      .get_or_insert_with(|| RegistryStore::new(data_dir.join("acp-registry")))
      .snapshot(force)
      .await
}

fn agent_install_dir(app_handle: &AppHandle, agent_id: &str) -> Result<PathBuf, String> {
   if !registry::schema::is_valid_agent_id(agent_id) {
      return Err(format!("Invalid agent id: {agent_id}"));
   }
   Ok(app_data_dir(app_handle)?.join("agents").join(agent_id))
}

/// Whether installs and updates of `agent` come from the registry.
pub fn installs_from_registry(agent: &AgentConfig) -> bool {
   agent
      .registry
      .as_ref()
      .is_some_and(|info| info.installs_from_registry)
}

/// Installs or updates `agent` from the registry and points its launcher at the new version.
/// Older versions are removed only after the launcher has switched.
pub async fn install_registry_agent(
   app_handle: &AppHandle,
   agent: &AgentConfig,
) -> Result<(), String> {
   let info = agent
      .registry
      .as_ref()
      .filter(|info| info.installs_from_registry)
      .ok_or_else(|| format!("{} is not installed from the ACP Registry", agent.name))?;
   let snapshot = registry_snapshot(app_handle, false).await;
   let registry_agent = snapshot
      .agent(&info.id)
      .ok_or_else(|| format!("{} is no longer in the ACP Registry", agent.name))?;
   if let Some(reason) = snapshot.quarantine.get(&info.id) {
      return Err(format!(
         "{} is quarantined by the ACP Registry: {reason}",
         agent.name
      ));
   }
   let resolved = registry::resolve_distribution(registry_agent, current_registry_platform())?;
   let data_dir = app_data_dir(app_handle)?;
   let agent_dir = agent_install_dir(app_handle, &agent.id)?;
   let kind = resolved.kind();

   let (version_dir, program, leading_args) = match resolved {
      ResolvedDistribution::Binary {
         archive,
         sha256,
         cmd,
         ..
      } => {
         let client = https_client()?;
         let (version_dir, executable) = install::install_binary(
            &client,
            &agent_dir,
            &registry_agent.version,
            &archive,
            &sha256,
            &cmd,
         )
         .await?;
         (Some(version_dir), executable, Vec::new())
      }
      ResolvedDistribution::Npx { name, version, .. } => {
         let node = NodeRuntime::get_or_install_with_npm(Some(&data_dir.join("runtimes")))
            .await
            .map_err(|error| {
               format!(
                  "{} needs Node.js 24 or newer, which Athas could not find or download: {error}",
                  agent.name
               )
            })?;
         let npm_cli = node
            .npm_cli_path()
            .ok_or_else(|| "The Node.js runtime has no npm".to_string())?;
         let node_path = node.binary_path().clone();
         let install_node = node_path.clone();
         let install_dir = agent_dir.clone();
         let (version_dir, entry) = tokio::task::spawn_blocking(move || {
            install::install_npm(&install_node, &npm_cli, &install_dir, &name, &version)
         })
         .await
         .map_err(|error| format!("npm install stopped: {error}"))??;
         (
            Some(version_dir),
            node_path,
            vec![entry.to_string_lossy().into_owned()],
         )
      }
      ResolvedDistribution::Uvx { package, .. } => {
         let uvx = registry::find_uvx().ok_or_else(|| {
            format!(
               "{} runs with uv, which is not installed. Install uv from \
                https://docs.astral.sh/uv/ and try again.",
               agent.name
            )
         })?;
         (None, uvx, vec![package])
      }
   };

   install::write_launcher(
      &data_dir.join("tools").join("acp"),
      &agent.id,
      &program,
      &leading_args,
      &serde_json::json!({
         "version": registry_agent.version,
         "source": "registry",
         "registryId": info.id,
         "distribution": kind,
      }),
   )?;

   match version_dir {
      Some(version_dir) => {
         install::remove_stale_versions(&agent_dir, &version_dir);
      }
      None if agent_dir.exists() => {
         let _ = fs::remove_dir_all(&agent_dir);
      }
      None => {}
   }
   Ok(())
}

/// Removes every registry install of `agent_id`.
pub fn remove_registry_install(app_handle: &AppHandle, agent_id: &str) -> Result<(), String> {
   let agent_dir = agent_install_dir(app_handle, agent_id)?;
   if agent_dir.exists() {
      fs::remove_dir_all(&agent_dir)
         .map_err(|error| format!("Failed to remove the agent install: {error}"))?;
   }
   Ok(())
}
