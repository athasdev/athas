use crate::app_runtime::AppHandle;
use serde_json::{Map, Value};
use std::{fs, io::ErrorKind, path::PathBuf};
use tauri::Manager;

const SECURE_STORE_FILE: &str = "secure.json";

fn keychain_service(app: &AppHandle) -> &str {
   app.config().identifier.as_str()
}

fn keyring_entry(app: &AppHandle, key: &str) -> Result<keyring::Entry, String> {
   keyring::Entry::new(keychain_service(app), key)
      .map_err(|e| format!("Failed to initialize keychain entry: {e}"))
}

fn secure_store_path(app: &AppHandle) -> Result<PathBuf, String> {
   let mut candidates = Vec::new();

   if let Ok(dir) = app.path().app_data_dir() {
      candidates.push(dir);
   }

   if let Some(dir) = dirs::data_dir() {
      candidates.push(dir.join("athas"));
   }

   if let Some(dir) = dirs::home_dir() {
      candidates.push(dir.join(".athas"));
   }

   for dir in candidates {
      match fs::create_dir_all(&dir) {
         Ok(()) => return Ok(dir.join(SECURE_STORE_FILE)),
         Err(error) => {
            log::warn!(
               "Failed to create secure storage directory '{}': {}",
               dir.display(),
               error
            );
         }
      }
   }

   Err("Failed to resolve a writable secure storage directory".to_string())
}

fn load_store(app: &AppHandle) -> Result<Map<String, Value>, String> {
   let path = secure_store_path(app)?;

   match fs::read_to_string(&path) {
      Ok(contents) => {
         if contents.trim().is_empty() {
            return Ok(Map::new());
         }

         serde_json::from_str::<Map<String, Value>>(&contents)
            .map_err(|e| format!("Failed to parse secure store '{}': {}", path.display(), e))
      }
      Err(error) if error.kind() == ErrorKind::NotFound => Ok(Map::new()),
      Err(error) => Err(format!(
         "Failed to read secure store '{}': {}",
         path.display(),
         error
      )),
   }
}

fn save_store(app: &AppHandle, store: &Map<String, Value>) -> Result<(), String> {
   let path = secure_store_path(app)?;
   let contents = serde_json::to_string_pretty(store)
      .map_err(|e| format!("Failed to serialize secure store: {e}"))?;

   fs::write(&path, contents)
      .map_err(|e| format!("Failed to save secure store '{}': {}", path.display(), e))
}

fn store_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
   let mut store = load_store(app)?;
   store.insert(key.to_string(), Value::String(value.to_string()));
   save_store(app, &store)
}

fn store_get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
   let store = load_store(app)?;
   Ok(store
      .get(key)
      .and_then(|value| value.as_str().map(|s| s.to_string())))
}

fn store_delete(app: &AppHandle, key: &str) -> Result<(), String> {
   let mut store = load_store(app)?;
   store.remove(key);
   save_store(app, &store)
}

pub fn store_secret(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
   let store_result = store_set(app, key, value);

   match keyring_entry(app, key) {
      Ok(entry) => match entry.set_password(value) {
         Ok(()) => {
            if let Err(error) = &store_result {
               log::warn!(
                  "Failed to mirror key '{}' to secure.json fallback after keychain write: {}",
                  key,
                  error
               );
            }
            return Ok(());
         }
         Err(error) => {
            log::warn!(
               "Keychain unavailable for key '{}', using secure.json fallback: {}",
               key,
               error
            );
         }
      },
      Err(error) => {
         log::warn!(
            "Keychain entry initialization failed for key '{}', using secure.json fallback: {}",
            key,
            error
         );
      }
   }

   store_result
}

pub fn get_secret(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
   match keyring_entry(app, key) {
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
   if let Ok(entry) = keyring_entry(app, key) {
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
