use super::{
   acp_registry::{
      install_registry_agent, installs_from_registry, registry_snapshot, remove_registry_install,
   },
   mcp::resolve_mcp_servers,
   tokens::ai_provider_token,
};
use crate::service_urls;
use athas_ai::{
   AcpAgentBridge, AcpAgentStatus, AcpOpenedSession, AcpSessionList, AgentConfig, AgentLaunchEnv,
   AgentRuntime, McpServerSetting, SessionConfigValue,
   acp::{
      agent_catalog::{AgentCatalogCache, extensions_manifest_url, is_acp_agent_id},
      agent_install::{AcpAgentFiles, binary_wrapper, node_wrapper, tool_config_from_agent},
      registry::{catalog::merge_registry_agents, current_registry_platform},
   },
};
use athas_runtime::{RuntimeManager, RuntimeType};
use athas_tooling::{ToolConfig, ToolInstaller, remove_managed_install};
use serde::Deserialize;
use std::{path::Path, sync::Arc};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

pub type AcpBridgeState = Arc<Mutex<AcpAgentBridge>>;

static AGENT_CATALOG: AgentCatalogCache = AgentCatalogCache::new();

fn extensions_cdn_base_url() -> String {
   std::env::var("ATHAS_EXTENSIONS_CDN_URL")
      .unwrap_or_else(|_| service_urls::extensions_cdn_base_url().to_string())
}
/// Provider keys from Athas's AI settings that an ACP agent is started with, as (agent id,
/// provider id, env var). With the user's Anthropic API key, the Claude adapter bills usage to
/// that key and needs no sign-in of its own, which would replace the Claude CLI's login.
const AGENT_PROVIDER_KEYS: &[(&str, &str, &str)] =
   &[("claude-acp", "anthropic", "ANTHROPIC_API_KEY")];

/// Reads the provider keys an agent is started with from the keychain at each start.
pub fn agent_launch_env(app_handle: AppHandle) -> AgentLaunchEnv {
   Arc::new(move |agent_id| {
      AGENT_PROVIDER_KEYS
         .iter()
         .filter(|(id, ..)| *id == agent_id)
         .filter_map(|(_, provider_id, env_var)| {
            match ai_provider_token(&app_handle, provider_id) {
               Ok(Some(key)) if !key.trim().is_empty() => {
                  Some((env_var.to_string(), key.trim().to_string()))
               }
               Ok(_) => None,
               Err(error) => {
                  log::warn!("Could not read the {provider_id} key for {agent_id}: {error}");
                  None
               }
            }
         })
         .collect()
   })
}

#[derive(Deserialize, specta::Type)]
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
#[specta::specta]
pub async fn get_available_agents(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
) -> Result<Vec<AgentConfig>, String> {
   refresh_registered_agents(&app_handle, &bridge, false).await;
   Ok(bridge.lock().await.detect_agents())
}

/// Downloads the ACP Registry again now instead of waiting for the hourly refresh, and asks every
/// agent on PATH for its version again.
#[tauri::command]
#[specta::specta]
pub async fn refresh_acp_agent_registry(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
) -> Result<Vec<AgentConfig>, String> {
   refresh_registered_agents(&app_handle, &bridge, true).await;
   Ok(bridge.lock().await.redetect_agents())
}

/// Opens a chat's session on `agent_id` in `workspace_path`, starting the agent when it is not
/// running there yet. One agent process serves every chat that uses it in the workspace.
/// `session_id` is the chat's earlier session, reattached when the agent still has it; with
/// `import_session` it is an agent session a new chat imports, and the answer carries its history.
/// `mcp_servers` is the user's MCP server list from settings; enabled servers are joined with
/// their stored secrets and offered to the agent. `additional_directories` are the workspace's
/// other roots, offered to agents that support them. With `prepare` the session is opened ahead of
/// the chat's first prompt: it never signs in or asks the user to, and `import_session` and
/// `auth_method_id` are ignored.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn open_acp_session(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
   workspace_path: Option<String>,
   session_id: Option<String>,
   import_session: Option<bool>,
   auth_method_id: Option<String>,
   mcp_servers: Option<Vec<McpServerSetting>>,
   additional_directories: Option<Vec<String>>,
   prepare: Option<bool>,
) -> Result<AcpOpenedSession, String> {
   let mcp_servers = resolve_mcp_servers(&app_handle, mcp_servers.unwrap_or_default());
   refresh_registered_agents(&app_handle, &bridge, false).await;
   let bridge = {
      let mut bridge = bridge.lock().await;
      bridge.detect_agents();
      bridge.clone()
   };
   let additional_directories = additional_directories.unwrap_or_default();
   let opened = if prepare.unwrap_or(false) {
      bridge
         .prepare_session(
            &agent_id,
            workspace_path,
            session_id,
            mcp_servers,
            additional_directories,
         )
         .await
   } else {
      bridge
         .open_session(
            &agent_id,
            workspace_path,
            session_id,
            import_session.unwrap_or(false),
            auth_method_id,
            mcp_servers,
            additional_directories,
         )
         .await
   };
   opened.map_err(|e| e.to_string())
}

/// Lets go of a chat's session (the chat was deleted); the agent keeps serving other chats.
#[tauri::command]
#[specta::specta]
pub async fn close_acp_session(
   bridge: State<'_, AcpBridgeState>,
   session_id: String,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .close_session(session_id)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn install_acp_agent(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
) -> Result<AgentConfig, String> {
   let agent = find_registered_agent(&app_handle, &bridge, &agent_id).await?;
   install_agent(&app_handle, &agent).await?;

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
#[specta::specta]
pub async fn update_acp_agent(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
) -> Result<AgentConfig, String> {
   let agent = find_registered_agent(&app_handle, &bridge, &agent_id).await?;
   if !agent.can_install {
      return Err(format!("{} does not support managed updates", agent.name));
   }
   install_agent(&app_handle, &agent).await?;

   let mut bridge = bridge.lock().await;
   bridge.invalidate_agent_detection_cache();
   bridge
      .detect_agents()
      .into_iter()
      .find(|candidate| candidate.id == agent_id)
      .ok_or_else(|| format!("Updated ACP agent disappeared: {}", agent_id))
}

#[tauri::command]
#[specta::specta]
pub async fn uninstall_acp_agent(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
) -> Result<AgentConfig, String> {
   let agent = find_registered_agent(&app_handle, &bridge, &agent_id).await?;
   let files = acp_agent_files(&app_handle)?;
   files.remove_wrapper(&agent.id)?;
   files.remove_metadata(&agent.id)?;
   remove_registry_install(&app_handle, &agent.id)?;
   if let Ok(tool_config) = tool_config_from_agent(&agent) {
      remove_managed_install(&app_handle, &tool_config)?;
   }

   let mut bridge = bridge.lock().await;
   bridge.invalidate_agent_detection_cache();
   let detected = bridge
      .detect_agents()
      .into_iter()
      .find(|candidate| candidate.id == agent_id)
      .ok_or_else(|| format!("Uninstalled ACP agent disappeared: {}", agent_id))?;

   Ok(detected)
}

async fn find_registered_agent(
   app_handle: &AppHandle,
   bridge: &AcpBridgeState,
   agent_id: &str,
) -> Result<AgentConfig, String> {
   refresh_registered_agents(app_handle, bridge, false).await;
   let mut bridge = bridge.lock().await;
   bridge.invalidate_agent_detection_cache();
   bridge
      .detect_agents()
      .into_iter()
      .find(|agent| agent.id == agent_id)
      .ok_or_else(|| format!("Unknown ACP agent: {}", agent_id))
}

/// Installs `agent` from the ACP Registry when the registry serves it, otherwise from its
/// extension manifest.
async fn install_agent(app_handle: &AppHandle, agent: &AgentConfig) -> Result<(), String> {
   if installs_from_registry(agent) {
      install_registry_agent(app_handle, agent).await?;
      // An install made earlier from the extension manifest is no longer launched.
      if let Ok(tool_config) = tool_config_from_agent(agent)
         && let Err(error) = remove_managed_install(app_handle, &tool_config)
      {
         log::warn!(
            "Failed to remove the earlier install of {}: {error}",
            agent.name
         );
      }
      return Ok(());
   }

   let tool_config = tool_config_from_agent(agent)?;
   let installed_binary = ToolInstaller::install_managed(app_handle, &tool_config)
      .await
      .map_err(|e| e.to_string())?;
   write_acp_wrapper(app_handle, agent, &tool_config, &installed_binary).await?;
   acp_agent_files(app_handle)?.write_metadata(agent)
}

/// Rebuilds the agent catalog: extension manifests with the ACP Registry merged in.
async fn refresh_registered_agents(app_handle: &AppHandle, bridge: &AcpBridgeState, force: bool) {
   let manifest_agents = match AGENT_CATALOG
      .load(&extensions_manifest_url(&extensions_cdn_base_url()))
      .await
   {
      Ok(agents) => agents,
      Err(error) => {
         log::warn!("{}", error);
         return;
      }
   };
   let snapshot = registry_snapshot(app_handle, force).await;
   let agents = merge_registry_agents(
      manifest_agents,
      &snapshot,
      current_registry_platform(),
      is_acp_agent_id,
   );
   bridge.lock().await.replace_registered_agents(agents);
}

/// Starts `agent_id` in `workspace_path` without opening a session, so its sessions can be
/// browsed before any chat uses it. Does nothing when it already runs there.
#[tauri::command]
#[specta::specta]
pub async fn start_acp_agent(
   app_handle: AppHandle,
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
   workspace_path: Option<String>,
) -> Result<(), String> {
   refresh_registered_agents(&app_handle, &bridge, false).await;
   let bridge = {
      let mut bridge = bridge.lock().await;
      bridge.detect_agents();
      bridge.clone()
   };
   bridge
      .start_agent(&agent_id, workspace_path)
      .await
      .map_err(|e| e.to_string())
}

/// Stops the agent running `agent_id` in `workspace_path`, ending every session on it. Without
/// an agent id every agent is stopped.
#[tauri::command]
#[specta::specta]
pub async fn stop_acp_agent(
   bridge: State<'_, AcpBridgeState>,
   agent_id: Option<String>,
   workspace_path: Option<String>,
) -> Result<Vec<AcpAgentStatus>, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .stop_agent(agent_id, workspace_path)
      .await
      .map_err(|e| e.to_string())?;
   Ok(bridge.get_status().await)
}

#[tauri::command]
#[specta::specta]
pub async fn send_acp_prompt(
   bridge: State<'_, AcpBridgeState>,
   session_id: String,
   prompt: Vec<serde_json::Value>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .send_prompt(session_id, prompt)
      .await
      .map_err(|e| e.to_string())
}

/// Every running agent and the sessions open on it.
#[tauri::command]
#[specta::specta]
pub async fn get_acp_status(
   bridge: State<'_, AcpBridgeState>,
) -> Result<Vec<AcpAgentStatus>, String> {
   let bridge = { bridge.lock().await.clone() };
   Ok(bridge.get_status().await)
}

#[tauri::command]
#[specta::specta]
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

/// Answers an agent's `elicitation/create` request. `response` is ACP `CreateElicitationResponse`
/// JSON: `{ "action": "accept", "content": {...} }`, `{ "action": "decline" }` or `{ "action":
/// "cancel" }`.
#[tauri::command]
#[specta::specta]
pub async fn respond_acp_elicitation(
   bridge: State<'_, AcpBridgeState>,
   request_id: String,
   response: serde_json::Value,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .respond_to_elicitation(request_id, response)
      .await
      .map_err(|e| e.to_string())
}

/// Answers the ACP client's `acp-buffer-read` event: what the editor holds for the file an agent
/// is reading, unsaved changes included, or null when the file is not open.
#[tauri::command]
#[specta::specta]
pub async fn respond_acp_buffer_read(
   bridge: State<'_, AcpBridgeState>,
   request_id: String,
   content: Option<String>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge.respond_to_buffer_read(request_id, content).await;
   Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_acp_session_mode(
   bridge: State<'_, AcpBridgeState>,
   session_id: String,
   mode_id: String,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .set_session_mode(session_id, mode_id)
      .await
      .map_err(|e| e.to_string())
}

#[derive(Deserialize, specta::Type)]
pub struct SessionConfigOptionArgs {
   #[serde(alias = "sessionId")]
   session_id: String,
   #[serde(alias = "configId")]
   config_id: String,
   value: SessionConfigValue,
}

/// Names the agent process a request is for: `agent_id` running in `workspace_path`.
#[derive(Deserialize, specta::Type)]
pub struct AgentTargetArgs {
   #[serde(alias = "agentId")]
   agent_id: String,
   #[serde(default, alias = "workspacePath")]
   workspace_path: Option<String>,
}

#[derive(Deserialize, specta::Type)]
pub struct SessionListArgs {
   #[serde(flatten)]
   agent: AgentTargetArgs,
   cwd: Option<String>,
   cursor: Option<String>,
}

#[derive(Deserialize, specta::Type)]
pub struct SessionDeleteArgs {
   #[serde(flatten)]
   agent: AgentTargetArgs,
   #[serde(alias = "sessionId")]
   session_id: String,
}

#[tauri::command]
#[specta::specta]
pub async fn set_acp_session_config_option(
   bridge: State<'_, AcpBridgeState>,
   args: SessionConfigOptionArgs,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .set_session_config_option(args.session_id, args.config_id, args.value)
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_acp_sessions(
   bridge: State<'_, AcpBridgeState>,
   args: SessionListArgs,
) -> Result<AcpSessionList, String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .list_sessions(
         args.agent.agent_id,
         args.agent.workspace_path,
         args.cwd,
         args.cursor,
      )
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_acp_session(
   bridge: State<'_, AcpBridgeState>,
   args: SessionDeleteArgs,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .delete_session(
         args.agent.agent_id,
         args.agent.workspace_path,
         args.session_id,
      )
      .await
      .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn logout_acp_agent(
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
   workspace_path: Option<String>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .logout(agent_id, workspace_path)
      .await
      .map_err(|e| e.to_string())
}

/// Signs in to the running agent with an `agent` method the user picked.
#[tauri::command]
#[specta::specta]
pub async fn authenticate_acp_agent(
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
   workspace_path: Option<String>,
   method_id: String,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .authenticate(agent_id, workspace_path, method_id)
      .await
      .map_err(|e| e.to_string())
}

/// Cancels the prompt turn in `session_id`; other chats keep running. Without a session (the
/// chat's agent is still starting), the startup of `agent_id` in `workspace_path` is stopped.
#[tauri::command]
#[specta::specta]
pub async fn cancel_acp_prompt(
   bridge: State<'_, AcpBridgeState>,
   session_id: Option<String>,
   agent_id: Option<String>,
   workspace_path: Option<String>,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge
      .cancel_prompt(session_id, agent_id, workspace_path)
      .await
      .map_err(|e| e.to_string())
}

fn acp_agent_files(app_handle: &AppHandle) -> Result<AcpAgentFiles, String> {
   let data_dir = app_handle
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
   Ok(AcpAgentFiles::new(&data_dir))
}

async fn write_acp_wrapper(
   app_handle: &AppHandle,
   agent: &AgentConfig,
   tool_config: &ToolConfig,
   installed_binary: &Path,
) -> Result<(), String> {
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
         node_wrapper(&node_path, &entrypoint)
      }
      _ => binary_wrapper(installed_binary),
   };

   acp_agent_files(app_handle)?.write_wrapper(&agent.id, &wrapper_contents)
}
