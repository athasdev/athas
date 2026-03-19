use athas_ai::{AcpAgentBridge, AcpAgentStatus, AgentConfig, AgentRuntime};
use athas_runtime::{RuntimeManager, RuntimeType};
use athas_tooling::{ToolConfig, ToolInstaller, ToolRuntime};
use serde::Deserialize;
use std::{
   collections::HashMap,
   path::{Path, PathBuf},
   sync::Arc,
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

pub type AcpBridgeState = Arc<Mutex<AcpAgentBridge>>;

#[derive(Deserialize)]
pub struct PermissionResponseArgs {
   #[serde(alias = "requestId")]
   request_id: String,
   approved: bool,
   #[serde(default)]
   cancelled: bool,
}

#[tauri::command]
pub async fn get_available_agents(
   bridge: State<'_, AcpBridgeState>,
) -> Result<Vec<AgentConfig>, String> {
   let mut bridge = bridge.lock().await;
   Ok(bridge.detect_agents())
}

#[tauri::command]
pub async fn start_acp_agent(
   bridge: State<'_, AcpBridgeState>,
   agent_id: String,
   workspace_path: Option<String>,
   session_id: Option<String>,
) -> Result<AcpAgentStatus, String> {
   let bridge = { bridge.lock().await.clone() };
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
   let installed = bridge
      .detect_agents()
      .into_iter()
      .find(|candidate| candidate.id == agent_id)
      .ok_or_else(|| format!("Installed ACP agent disappeared: {}", agent_id))?;

   Ok(installed)
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
   prompt: String,
) -> Result<(), String> {
   let bridge = { bridge.lock().await.clone() };
   bridge.send_prompt(&prompt).await.map_err(|e| e.to_string())
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
      .respond_to_permission(args.request_id, args.approved, args.cancelled)
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

   let package = agent
      .install_package
      .clone()
      .ok_or_else(|| format!("{} is missing installation metadata", agent.name))?;

   Ok(ToolConfig {
      name: agent.binary_name.clone(),
      command: agent.install_command.clone(),
      runtime,
      package: Some(package),
      download_url: None,
      args: vec![],
      env: HashMap::new(),
   })
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
         let node_path = RuntimeManager::get_runtime(app_handle, RuntimeType::Node)
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
