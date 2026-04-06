use athas_database::{
   ConnectionManager,
   providers::{
      RedisKeyInfo, RedisServerInfo, redis_delete_key as db_redis_delete_key,
      redis_get_info as db_redis_get_info, redis_get_value as db_redis_get_value,
      redis_scan_keys as db_redis_scan_keys, redis_set_value as db_redis_set_value,
   },
};
use std::sync::Arc;

#[tauri::command]
pub async fn redis_scan_keys(
   connection_id: String,
   pattern: Option<String>,
   count: Option<usize>,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<Vec<RedisKeyInfo>, String> {
   db_redis_scan_keys(connection_id, pattern, count, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn redis_get_value(
   connection_id: String,
   key: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<serde_json::Value, String> {
   db_redis_get_value(connection_id, key, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn redis_set_value(
   connection_id: String,
   key: String,
   value: String,
   ttl: Option<i64>,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<(), String> {
   db_redis_set_value(connection_id, key, value, ttl, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn redis_delete_key(
   connection_id: String,
   key: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<bool, String> {
   db_redis_delete_key(connection_id, key, state.inner().as_ref()).await
}

#[tauri::command]
pub async fn redis_get_info(
   connection_id: String,
   state: tauri::State<'_, Arc<ConnectionManager>>,
) -> Result<RedisServerInfo, String> {
   db_redis_get_info(connection_id, state.inner().as_ref()).await
}
