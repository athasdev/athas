//! Secure storage for the secret part of user-configured MCP servers (stdio environment
//! variables and HTTP/SSE headers), and joining it with the stored server list when an ACP
//! agent starts. Secret values never pass through logs.

use crate::{
   app_runtime::AppHandle,
   secure_storage::{get_secret, remove_secret, store_secret},
};
use athas_ai::{McpServerConfig, McpServerSecrets, McpServerSetting, mcp_stdio::McpStdioEvent};
use tauri::command;

fn secrets_key(server_id: &str) -> Result<String, String> {
   let valid = !server_id.is_empty()
      && server_id.len() <= 128
      && server_id
         .chars()
         .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
   if !valid {
      return Err("Invalid MCP server id".to_string());
   }
   Ok(format!("mcp_server_{server_id}"))
}

fn load_secrets(app: &AppHandle, server_id: &str) -> Result<McpServerSecrets, String> {
   let Some(stored) = get_secret(app, &secrets_key(server_id)?)? else {
      return Ok(McpServerSecrets::default());
   };
   serde_json::from_str(&stored).map_err(|_| "Stored MCP server secrets are unreadable".to_string())
}

/// Joins the enabled servers from settings with their stored secrets. A server whose secrets
/// cannot be read is still offered without them, so the agent reports what it is missing.
pub(crate) fn resolve_mcp_servers(
   app: &AppHandle,
   servers: Vec<McpServerSetting>,
) -> Vec<McpServerConfig> {
   servers
      .into_iter()
      .filter(|server| server.enabled)
      .filter_map(|server| {
         let secrets = load_secrets(app, &server.id).unwrap_or_else(|error| {
            log::warn!("MCP server '{}': {}", server.name, error);
            McpServerSecrets::default()
         });
         McpServerConfig::from_setting(server, secrets)
      })
      .collect()
}

#[command]
pub async fn get_mcp_server_secrets(
   app: AppHandle,
   server_id: String,
) -> Result<McpServerSecrets, String> {
   load_secrets(&app, &server_id)
}

/// Stores a server's environment variables and headers, or clears them when both are empty.
#[command]
pub async fn store_mcp_server_secrets(
   app: AppHandle,
   server_id: String,
   secrets: McpServerSecrets,
) -> Result<(), String> {
   let key = secrets_key(&server_id)?;
   if secrets.is_empty() {
      return remove_secret(&app, &key);
   }
   let serialized = serde_json::to_string(&secrets)
      .map_err(|_| "Failed to serialize MCP server secrets".to_string())?;
   store_secret(&app, &key, &serialized)
}

/// Starts a stdio MCP server for the built-in agent under `process_id`, with its stored
/// environment joined in. Its stdout lines and exit arrive on `on_event`.
#[command]
pub async fn intelligence_mcp_start(
   app: AppHandle,
   process_id: String,
   server: McpServerSetting,
   cwd: Option<String>,
   on_event: tauri::ipc::Channel<McpStdioEvent>,
) -> Result<(), String> {
   let name = server.name.clone();
   let config = resolve_mcp_servers(&app, vec![server])
      .into_iter()
      .next()
      .ok_or_else(|| format!("MCP server '{name}' is disabled or incomplete"))?;
   let listener: athas_ai::mcp_stdio::McpStdioListener = std::sync::Arc::new(move |event| {
      let _ = on_event.send(event);
   });
   athas_ai::mcp_stdio::start_mcp_stdio(
      &process_id,
      &config,
      cwd.as_deref().map(std::path::Path::new),
      listener,
   )
   .await
}

#[command]
pub async fn intelligence_mcp_send(process_id: String, message: String) -> Result<(), String> {
   athas_ai::mcp_stdio::send_mcp_stdio(&process_id, &message).await
}

#[command]
pub fn intelligence_mcp_stop(process_id: String) {
   athas_ai::mcp_stdio::stop_mcp_stdio(&process_id);
}

#[command]
pub async fn remove_mcp_server_secrets(app: AppHandle, server_id: String) -> Result<(), String> {
   remove_secret(&app, &secrets_key(&server_id)?)
}

#[cfg(test)]
mod tests {
   use super::secrets_key;

   #[test]
   fn keys_secrets_by_server_id() {
      assert_eq!(secrets_key("a1-b_2").unwrap(), "mcp_server_a1-b_2");
      assert!(secrets_key("").is_err());
      assert!(secrets_key("../other").is_err());
      assert!(secrets_key("ai_token_openai with space").is_err());
   }
}
