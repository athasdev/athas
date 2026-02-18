use crate::secure_storage::{get_secret, remove_secret, store_secret};
use tauri::command;

fn provider_key(provider_id: &str) -> String {
   format!("ai_token_{}", provider_id)
}

/// Store an AI provider token using OS keychain when available.
#[command]
pub async fn store_ai_provider_token(
   app: tauri::AppHandle,
   provider_id: String,
   token: String,
) -> Result<(), String> {
   store_secret(&app, &provider_key(&provider_id), &token)
}

/// Get an AI provider token
#[command]
pub async fn get_ai_provider_token(
   app: tauri::AppHandle,
   provider_id: String,
) -> Result<Option<String>, String> {
   get_secret(&app, &provider_key(&provider_id))
}

/// Remove an AI provider token
#[command]
pub async fn remove_ai_provider_token(
   app: tauri::AppHandle,
   provider_id: String,
) -> Result<(), String> {
   remove_secret(&app, &provider_key(&provider_id))
}
