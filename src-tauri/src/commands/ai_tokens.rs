use tauri::command;

/// Store an AI provider token securely
#[command]
pub async fn store_ai_provider_token(
   app: tauri::AppHandle,
   provider_id: String,
   token: String,
) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   let key = format!("ai_token_{}", provider_id);
   store.set(key, serde_json::Value::String(token));

   store
      .save()
      .map_err(|e| format!("Failed to save store: {e}"))?;

   Ok(())
}

/// Get an AI provider token
#[command]
pub async fn get_ai_provider_token(
   app: tauri::AppHandle,
   provider_id: String,
) -> Result<Option<String>, String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   let key = format!("ai_token_{}", provider_id);
   match store.get(&key) {
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

/// Remove an AI provider token
#[command]
pub async fn remove_ai_provider_token(
   app: tauri::AppHandle,
   provider_id: String,
) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   let key = format!("ai_token_{}", provider_id);
   let _removed = store.delete(&key);

   store
      .save()
      .map_err(|e| format!("Failed to save store: {e}"))?;

   Ok(())
}
