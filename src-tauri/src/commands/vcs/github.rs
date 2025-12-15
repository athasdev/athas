use tauri::command;

#[command]
pub async fn store_github_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   store.set("github_token", serde_json::Value::String(token));

   store
      .save()
      .map_err(|e| format!("Failed to save store: {e}"))?;

   Ok(())
}

#[command]
pub async fn get_github_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   match store.get("github_token") {
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

#[command]
pub async fn remove_github_token(app: tauri::AppHandle) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   let _removed = store.delete("github_token");

   store
      .save()
      .map_err(|e| format!("Failed to save store: {e}"))?;

   Ok(())
}
