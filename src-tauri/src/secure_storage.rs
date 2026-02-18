use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const SECURE_STORE_FILE: &str = "secure.json";
const KEYCHAIN_SERVICE: &str = "com.code.athas";

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
   keyring::Entry::new(KEYCHAIN_SERVICE, key)
      .map_err(|e| format!("Failed to initialize keychain entry: {e}"))
}

fn store_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
   let store = app
      .store(SECURE_STORE_FILE)
      .map_err(|e| format!("Failed to access secure store: {e}"))?;

   store.set(
      key.to_string(),
      serde_json::Value::String(value.to_string()),
   );

   store
      .save()
      .map_err(|e| format!("Failed to save secure store: {e}"))?;

   Ok(())
}

fn store_get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
   let store = app
      .store(SECURE_STORE_FILE)
      .map_err(|e| format!("Failed to access secure store: {e}"))?;

   Ok(store
      .get(key)
      .and_then(|value| value.as_str().map(|s| s.to_string())))
}

fn store_delete(app: &AppHandle, key: &str) -> Result<(), String> {
   let store = app
      .store(SECURE_STORE_FILE)
      .map_err(|e| format!("Failed to access secure store: {e}"))?;

   let _removed = store.delete(key);
   store
      .save()
      .map_err(|e| format!("Failed to save secure store: {e}"))?;

   Ok(())
}

pub fn store_secret(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
   match keyring_entry(key) {
      Ok(entry) => match entry.set_password(value) {
         Ok(()) => {
            let _ = store_delete(app, key);
            return Ok(());
         }
         Err(error) => {
            log::warn!(
               "Keychain unavailable for key '{}', falling back to secure.json: {}",
               key,
               error
            );
         }
      },
      Err(error) => {
         log::warn!(
            "Keychain entry initialization failed for key '{}', falling back to secure.json: {}",
            key,
            error
         );
      }
   }

   store_set(app, key, value)
}

pub fn get_secret(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
   match keyring_entry(key) {
      Ok(entry) => match entry.get_password() {
         Ok(value) => return Ok(Some(value)),
         Err(keyring::Error::NoEntry) => {}
         Err(error) => {
            log::warn!(
               "Failed to read key '{}' from keychain, falling back to secure.json: {}",
               key,
               error
            );
         }
      },
      Err(error) => {
         log::warn!(
            "Keychain entry initialization failed for key '{}', falling back to secure.json: {}",
            key,
            error
         );
      }
   }

   store_get(app, key)
}

pub fn remove_secret(app: &AppHandle, key: &str) -> Result<(), String> {
   if let Ok(entry) = keyring_entry(key) {
      match entry.delete_credential() {
         Ok(()) | Err(keyring::Error::NoEntry) => {}
         Err(error) => {
            log::warn!(
               "Failed to remove key '{}' from keychain, continuing with secure.json cleanup: {}",
               key,
               error
            );
         }
      }
   }

   store_delete(app, key)
}
