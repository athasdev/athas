use tauri::command;

/// Store the auth token securely
#[command]
pub async fn store_auth_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   store.set(
      "athas_auth_token".to_string(),
      serde_json::Value::String(token),
   );

   store
      .save()
      .map_err(|e| format!("Failed to save store: {e}"))?;

   Ok(())
}

/// Get the stored auth token
#[command]
pub async fn get_auth_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   match store.get("athas_auth_token") {
      Some(token) => {
         if let Some(token_str) = token.as_str() {
            Ok(Some(token_str.to_string()))
         } else {
            Ok(None)
         }
      }
      None => Ok(None),
   }
}

/// Remove the auth token
#[command]
pub async fn remove_auth_token(app: tauri::AppHandle) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   let _removed = store.delete("athas_auth_token");

   store
      .save()
      .map_err(|e| format!("Failed to save store: {e}"))?;

   Ok(())
}
