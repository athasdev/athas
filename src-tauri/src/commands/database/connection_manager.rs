use super::sidecar::run_database_sidecar;
use crate::app_runtime::AppHandle;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
   pub id: String,
   pub name: String,
   pub db_type: String,
   pub host: String,
   pub port: u16,
   pub database: String,
   pub username: String,
   pub connection_string: Option<String>,
}

#[tauri::command]
pub async fn connect_database(
   app_handle: AppHandle,
   config: ConnectionConfig,
   password: Option<String>,
) -> Result<Value, String> {
   run_database_sidecar(
      app_handle,
      config.db_type.clone(),
      "connect_database".to_string(),
      json!({ "config": config, "password": password }),
   )
   .await
}

#[tauri::command]
pub async fn disconnect_database(
   app_handle: AppHandle,
   connection_id: String,
   db_type: Option<String>,
) -> Result<Value, String> {
   let provider_id = db_type.ok_or_else(|| "Missing database provider id".to_string())?;
   run_database_sidecar(
      app_handle,
      provider_id,
      "disconnect_database".to_string(),
      json!({ "connectionId": connection_id }),
   )
   .await
}

#[tauri::command]
pub async fn test_connection(
   app_handle: AppHandle,
   config: ConnectionConfig,
   password: Option<String>,
) -> Result<Value, String> {
   run_database_sidecar(
      app_handle,
      config.db_type.clone(),
      "test_connection".to_string(),
      json!({ "config": config, "password": password }),
   )
   .await
}
