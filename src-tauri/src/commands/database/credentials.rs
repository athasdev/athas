use crate::secure_storage;
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct SavedConnection {
   pub id: String,
   pub name: String,
   pub db_type: String,
   pub host: String,
   pub port: u16,
   pub database: String,
   pub username: String,
   pub connection_string: Option<String>,
}

const DB_CRED_PREFIX: &str = "db_cred_";
const DB_CONNECTIONS_KEY: &str = "db_saved_connections";

#[command]
pub async fn store_db_credential(
   app: tauri::AppHandle,
   connection_id: String,
   password: String,
) -> Result<(), String> {
   let key = format!("{}{}", DB_CRED_PREFIX, connection_id);
   secure_storage::store_secret(&app, &key, &password)
}

#[command]
pub async fn get_db_credential(
   app: tauri::AppHandle,
   connection_id: String,
) -> Result<Option<String>, String> {
   let key = format!("{}{}", DB_CRED_PREFIX, connection_id);
   secure_storage::get_secret(&app, &key)
}

#[command]
pub async fn remove_db_credential(
   app: tauri::AppHandle,
   connection_id: String,
) -> Result<(), String> {
   let key = format!("{}{}", DB_CRED_PREFIX, connection_id);
   secure_storage::remove_secret(&app, &key)
}

#[command]
pub async fn save_connection(
   app: tauri::AppHandle,
   connection: SavedConnection,
) -> Result<(), String> {
   // Get existing connections
   let mut connections = get_saved_connections_internal(&app)?;

   // Replace or add
   if let Some(pos) = connections.iter().position(|c| c.id == connection.id) {
      connections[pos] = connection;
   } else {
      connections.push(connection);
   }

   let json = serde_json::to_string(&connections)
      .map_err(|e| format!("Failed to serialize connections: {}", e))?;
   secure_storage::store_secret(&app, DB_CONNECTIONS_KEY, &json)
}

#[command]
pub async fn list_saved_connections(app: tauri::AppHandle) -> Result<Vec<SavedConnection>, String> {
   get_saved_connections_internal(&app)
}

#[command]
pub async fn delete_saved_connection(
   app: tauri::AppHandle,
   connection_id: String,
) -> Result<(), String> {
   let mut connections = get_saved_connections_internal(&app)?;
   connections.retain(|c| c.id != connection_id);

   let json = serde_json::to_string(&connections)
      .map_err(|e| format!("Failed to serialize connections: {}", e))?;
   secure_storage::store_secret(&app, DB_CONNECTIONS_KEY, &json)?;

   // Also remove the stored credential
   let key = format!("{}{}", DB_CRED_PREFIX, connection_id);
   let _ = secure_storage::remove_secret(&app, &key);

   Ok(())
}

fn get_saved_connections_internal(app: &tauri::AppHandle) -> Result<Vec<SavedConnection>, String> {
   match secure_storage::get_secret(app, DB_CONNECTIONS_KEY)? {
      Some(json) => serde_json::from_str(&json)
         .map_err(|e| format!("Failed to parse saved connections: {}", e)),
      None => Ok(Vec::new()),
   }
}
