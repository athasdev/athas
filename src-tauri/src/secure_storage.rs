use crate::app_runtime::AppHandle;
use serde_json::{Map, Value};
use std::{
   fs,
   fs::OpenOptions,
   io::{ErrorKind, Write},
   path::{Path, PathBuf},
};
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
      match create_secure_dir_all(&dir) {
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

fn load_store_from_path(path: &Path) -> Result<Map<String, Value>, String> {
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

fn save_store_to_path(path: &Path, store: &Map<String, Value>) -> Result<(), String> {
   if store.is_empty() {
      return match fs::remove_file(path) {
         Ok(()) => Ok(()),
         Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
         Err(error) => Err(format!(
            "Failed to remove empty secure store '{}': {}",
            path.display(),
            error
         )),
      };
   }

   if let Some(parent) = path.parent() {
      create_secure_dir_all(parent).map_err(|e| {
         format!(
            "Failed to create secure store directory '{}': {}",
            parent.display(),
            e
         )
      })?;
   }

   let contents = serde_json::to_string_pretty(store)
      .map_err(|e| format!("Failed to serialize secure store: {e}"))?;

   write_secure_store_file(path, contents.as_bytes())
      .map_err(|e| format!("Failed to save secure store '{}': {}", path.display(), e))
}

fn load_store(app: &AppHandle) -> Result<Map<String, Value>, String> {
   load_store_from_path(&secure_store_path(app)?)
}

fn save_store(app: &AppHandle, store: &Map<String, Value>) -> Result<(), String> {
   save_store_to_path(&secure_store_path(app)?, store)
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

fn store_secret_with_operations<SetKeychain, DeleteFallback, SetFallback>(
   key: &str,
   value: &str,
   set_keychain: SetKeychain,
   delete_fallback: DeleteFallback,
   set_fallback: SetFallback,
) -> Result<(), String>
where
   SetKeychain: FnOnce(&str, &str) -> Result<(), String>,
   DeleteFallback: FnOnce(&str) -> Result<(), String>,
   SetFallback: FnOnce(&str, &str) -> Result<(), String>,
{
   match set_keychain(key, value) {
      Ok(()) => delete_fallback(key),
      Err(error) => {
         log::warn!(
            "Keychain unavailable for key '{}', using secure.json fallback: {}",
            key,
            error
         );
         set_fallback(key, value)
      }
   }
}

fn set_keychain_password(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
   let entry = keyring_entry(app, key)?;
   entry
      .set_password(value)
      .map_err(|e| format!("Failed to write keychain entry: {e}"))
}

pub fn store_secret(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
   store_secret_with_operations(
      key,
      value,
      |key, value| set_keychain_password(app, key, value),
      |key| store_delete(app, key),
      |key, value| store_set(app, key, value),
   )
}

pub fn get_secret(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
   match keyring_entry(app, key) {
      Ok(entry) => match entry.get_password() {
         Ok(value) => {
            if let Err(error) = store_delete(app, key) {
               log::warn!(
                  "Failed to remove stale secure.json fallback for key '{}': {}",
                  key,
                  error
               );
            }
            return Ok(Some(value));
         }
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

fn create_secure_dir_all(path: &Path) -> std::io::Result<()> {
   fs::create_dir_all(path)?;
   harden_secure_dir(path)
}

#[cfg(unix)]
fn harden_secure_dir(path: &Path) -> std::io::Result<()> {
   use std::os::unix::fs::PermissionsExt;

   fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn harden_secure_dir(_path: &Path) -> std::io::Result<()> {
   Ok(())
}

#[cfg(unix)]
fn write_secure_store_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
   use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

   match fs::symlink_metadata(path) {
      Ok(metadata) => {
         if metadata.file_type().is_symlink() {
            return Err(std::io::Error::new(
               ErrorKind::InvalidInput,
               "secure store path must not be a symlink",
            ));
         }
         fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
      }
      Err(error) if error.kind() == ErrorKind::NotFound => {}
      Err(error) => return Err(error),
   }

   let mut file = OpenOptions::new()
      .write(true)
      .create(true)
      .truncate(true)
      .mode(0o600)
      .open(path)?;
   file.write_all(contents)?;
   file.flush()?;
   file.set_permissions(fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn write_secure_store_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
   let mut file = OpenOptions::new()
      .write(true)
      .create(true)
      .truncate(true)
      .open(path)?;
   file.write_all(contents)?;
   file.flush()
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::{cell::RefCell, rc::Rc};

   #[test]
   fn store_secret_removes_plaintext_fallback_when_keychain_succeeds() {
      let calls = Rc::new(RefCell::new(Vec::new()));

      let result = store_secret_with_operations(
         "github_token",
         "secret",
         {
            let calls = calls.clone();
            move |key, value| {
               calls.borrow_mut().push(format!("keychain:{key}:{value}"));
               Ok(())
            }
         },
         {
            let calls = calls.clone();
            move |key| {
               calls.borrow_mut().push(format!("delete:{key}"));
               Ok(())
            }
         },
         {
            let calls = calls.clone();
            move |key, value| {
               calls.borrow_mut().push(format!("fallback:{key}:{value}"));
               Ok(())
            }
         },
      );

      assert_eq!(result, Ok(()));
      assert_eq!(
         calls.borrow().as_slice(),
         [
            "keychain:github_token:secret".to_string(),
            "delete:github_token".to_string()
         ]
      );
   }

   #[test]
   fn store_secret_uses_fallback_only_when_keychain_fails() {
      let calls = Rc::new(RefCell::new(Vec::new()));

      let result = store_secret_with_operations(
         "github_token",
         "secret",
         {
            let calls = calls.clone();
            move |key, value| {
               calls.borrow_mut().push(format!("keychain:{key}:{value}"));
               Err("keychain unavailable".to_string())
            }
         },
         {
            let calls = calls.clone();
            move |key| {
               calls.borrow_mut().push(format!("delete:{key}"));
               Ok(())
            }
         },
         {
            let calls = calls.clone();
            move |key, value| {
               calls.borrow_mut().push(format!("fallback:{key}:{value}"));
               Ok(())
            }
         },
      );

      assert_eq!(result, Ok(()));
      assert_eq!(
         calls.borrow().as_slice(),
         [
            "keychain:github_token:secret".to_string(),
            "fallback:github_token:secret".to_string()
         ]
      );
   }

   #[test]
   fn save_store_deletes_empty_fallback_file() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let path = temp_dir.path().join(SECURE_STORE_FILE);
      fs::write(&path, r#"{"github_token":"secret"}"#).expect("write fallback");

      save_store_to_path(&path, &Map::new()).expect("delete empty fallback");

      assert!(!path.exists());
   }

   #[cfg(unix)]
   #[test]
   fn save_store_restricts_file_and_directory_permissions() {
      use std::os::unix::fs::PermissionsExt;

      let temp_dir = tempfile::tempdir().expect("temp dir");
      let store_dir = temp_dir.path().join("athas");
      let path = store_dir.join(SECURE_STORE_FILE);
      let mut store = Map::new();
      store.insert(
         "github_token".to_string(),
         Value::String("secret".to_string()),
      );

      save_store_to_path(&path, &store).expect("save fallback");

      let dir_mode = fs::metadata(&store_dir)
         .expect("dir metadata")
         .permissions()
         .mode()
         & 0o777;
      let file_mode = fs::metadata(&path)
         .expect("file metadata")
         .permissions()
         .mode()
         & 0o777;
      assert_eq!(dir_mode, 0o700);
      assert_eq!(file_mode, 0o600);
   }

   #[cfg(unix)]
   #[test]
   fn save_store_repairs_existing_file_permissions() {
      use std::os::unix::fs::PermissionsExt;

      let temp_dir = tempfile::tempdir().expect("temp dir");
      let path = temp_dir.path().join(SECURE_STORE_FILE);
      fs::write(&path, r#"{"github_token":"old"}"#).expect("write fallback");
      fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("set insecure mode");

      let mut store = Map::new();
      store.insert(
         "github_token".to_string(),
         Value::String("secret".to_string()),
      );
      save_store_to_path(&path, &store).expect("save fallback");

      let mode = fs::metadata(&path)
         .expect("file metadata")
         .permissions()
         .mode()
         & 0o777;
      assert_eq!(mode, 0o600);
      assert_eq!(
         load_store_from_path(&path).expect("load fallback")["github_token"],
         Value::String("secret".to_string())
      );
   }
}
