use crate::secure_storage::{get_secret, remove_secret, store_secret};
use tauri::command;

const AUTH_TOKEN_KEY: &str = "athas_auth_token";

/// Store the auth token using OS keychain when available.
#[command]
pub async fn store_auth_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
   store_secret(&app, AUTH_TOKEN_KEY, &token)
}

/// Get the stored auth token
#[command]
pub async fn get_auth_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
   get_secret(&app, AUTH_TOKEN_KEY)
}

/// Remove the auth token
#[command]
pub async fn remove_auth_token(app: tauri::AppHandle) -> Result<(), String> {
   remove_secret(&app, AUTH_TOKEN_KEY)
}
