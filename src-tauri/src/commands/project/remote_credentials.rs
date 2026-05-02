use crate::secure_storage;
use tauri::command;

const REMOTE_CRED_PREFIX: &str = "remote_cred_";

fn remote_credential_key(connection_id: &str) -> String {
   format!("{}{}", REMOTE_CRED_PREFIX, connection_id)
}

#[command]
pub async fn store_remote_credential(
   app: crate::app_runtime::AppHandle,
   connection_id: String,
   password: String,
) -> Result<(), String> {
   secure_storage::store_secret(&app, &remote_credential_key(&connection_id), &password)
}

#[command]
pub async fn get_remote_credential(
   app: crate::app_runtime::AppHandle,
   connection_id: String,
) -> Result<Option<String>, String> {
   secure_storage::get_secret(&app, &remote_credential_key(&connection_id))
}

#[command]
pub async fn remove_remote_credential(
   app: crate::app_runtime::AppHandle,
   connection_id: String,
) -> Result<(), String> {
   secure_storage::remove_secret(&app, &remote_credential_key(&connection_id))
}
