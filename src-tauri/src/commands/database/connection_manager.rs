use athas_database::{
   ConnectionConfig, ConnectionManager, ConnectionResult, connect_database as db_connect_database,
   disconnect_database as db_disconnect_database, test_connection as db_test_connection,
};
use std::sync::Arc;

#[tauri::command]
pub async fn connect_database(
   config: ConnectionConfig,
   password: Option<String>,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<ConnectionResult, String> {
   db_connect_database(config, password, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn disconnect_database(
   connection_id: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
   db_disconnect_database(connection_id, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn test_connection(
   config: ConnectionConfig,
   password: Option<String>,
) -> Result<ConnectionResult, String> {
   db_test_connection(config, password).await
}
