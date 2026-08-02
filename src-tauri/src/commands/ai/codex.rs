use athas_ai::{CodexAppServer, CodexIntegrationStatus, CodexRequestDecision, CodexThreadSettings};
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStartArgs {
   cwd: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadArgs {
   cwd: String,
   thread_id: Option<String>,
   #[serde(default)]
   settings: CodexThreadSettings,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTurnArgs {
   thread_id: String,
   input: Vec<Value>,
   #[serde(default)]
   settings: CodexThreadSettings,
}

#[tauri::command]
pub async fn get_codex_status(
   server: State<'_, CodexAppServer>,
) -> Result<CodexIntegrationStatus, String> {
   Ok(server.status().await)
}

#[tauri::command]
pub async fn start_codex_integration(
   server: State<'_, CodexAppServer>,
   args: CodexStartArgs,
) -> Result<CodexIntegrationStatus, String> {
   server
      .start(args.cwd)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn stop_codex_integration(server: State<'_, CodexAppServer>) -> Result<(), String> {
   server.stop().await;
   Ok(())
}

#[tauri::command]
pub async fn start_codex_thread(
   server: State<'_, CodexAppServer>,
   args: CodexThreadArgs,
) -> Result<Value, String> {
   server
      .start_thread(args.cwd, args.thread_id, args.settings)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn start_codex_turn(
   server: State<'_, CodexAppServer>,
   args: CodexTurnArgs,
) -> Result<Value, String> {
   server
      .start_turn(args.thread_id, args.input, args.settings)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn interrupt_codex_turn(
   server: State<'_, CodexAppServer>,
   thread_id: String,
   turn_id: String,
) -> Result<Value, String> {
   server
      .interrupt_turn(thread_id, turn_id)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn respond_codex_request(
   server: State<'_, CodexAppServer>,
   response: CodexRequestDecision,
) -> Result<(), String> {
   server
      .respond(response)
      .await
      .map_err(|error| error.to_string())
}

macro_rules! codex_value_command {
   ($name:ident, $method:ident) => {
      #[tauri::command]
      pub async fn $name(server: State<'_, CodexAppServer>) -> Result<Value, String> {
         server.$method().await.map_err(|error| error.to_string())
      }
   };
}

codex_value_command!(read_codex_account, read_account);
codex_value_command!(logout_codex_account, logout);
codex_value_command!(list_codex_models, list_models);
codex_value_command!(read_codex_rate_limits, read_rate_limits);
codex_value_command!(list_codex_mcp_servers, list_mcp_servers);
codex_value_command!(list_codex_permission_profiles, list_permission_profiles);
codex_value_command!(list_codex_collaboration_modes, list_collaboration_modes);

#[tauri::command]
pub async fn start_codex_login(
   server: State<'_, CodexAppServer>,
   login_type: String,
) -> Result<Value, String> {
   server
      .start_login(login_type)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_codex_threads(
   server: State<'_, CodexAppServer>,
   cwd: Option<String>,
   cursor: Option<String>,
) -> Result<Value, String> {
   server
      .list_threads(cwd, cursor)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn read_codex_thread(
   server: State<'_, CodexAppServer>,
   thread_id: String,
) -> Result<Value, String> {
   server
      .read_thread(thread_id)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn archive_codex_thread(
   server: State<'_, CodexAppServer>,
   thread_id: String,
) -> Result<Value, String> {
   server
      .archive_thread(thread_id)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_codex_thread(
   server: State<'_, CodexAppServer>,
   thread_id: String,
) -> Result<Value, String> {
   server
      .delete_thread(thread_id)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_codex_skills(
   server: State<'_, CodexAppServer>,
   cwd: String,
) -> Result<Value, String> {
   server
      .list_skills(cwd)
      .await
      .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn start_codex_review(
   server: State<'_, CodexAppServer>,
   thread_id: String,
) -> Result<Value, String> {
   server
      .start_review(thread_id)
      .await
      .map_err(|error| error.to_string())
}
