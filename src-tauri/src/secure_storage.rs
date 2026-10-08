use serde_json::{Map, Value};
use std::{
   collections::HashMap,
   fs,
   io::{ErrorKind, Write},
   path::{Path, PathBuf},
   sync::{LazyLock, Mutex, MutexGuard},
};
use tauri::{AppHandle, Manager};

const SECURE_STORE_FILE: &str = "secure.json";
type SecretCache = HashMap<(String, String), String>;

static SECRET_CACHE: LazyLock<Mutex<SecretCache>> = LazyLock::new(|| Mutex::new(HashMap::new()));
// Every window reads and rewrites secure.json from its own command thread, so each
// read-modify-write runs under this lock or concurrent saves interleave into invalid JSON.
static SECURE_STORE_LOCK: Mutex<()> = Mutex::new(());

fn lock_secure_store() -> MutexGuard<'static, ()> {
   SECURE_STORE_LOCK
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn keychain_service(app: &AppHandle) -> &str {
   app.config().identifier.as_str()
}

fn secret_cache_key(app: &AppHandle, key: &str) -> (String, String) {
   (keychain_service(app).to_string(), key.to_string())
}

fn secret_cache() -> std::sync::MutexGuard<'static, SecretCache> {
   SECRET_CACHE
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn get_secret_with_cache<Load>(
   cache: &Mutex<SecretCache>,
   service: &str,
   key: &str,
   load: Load,
) -> Result<Option<String>, String>
where
   Load: FnOnce() -> Result<Option<String>, String>,
{
   let mut cache = cache
      .lock()
      .unwrap_or_else(|poisoned| poisoned.into_inner());
   let cache_key = (service.to_string(), key.to_string());

   if let Some(value) = cache.get(&cache_key) {
      return Ok(Some(value.clone()));
   }

   let value = load()?;
   if let Some(value) = &value {
      cache.insert(cache_key, value.clone());
   }

   Ok(value)
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
   match fs::read_to_string(path) {
      Ok(contents) => {
         if contents.trim().is_empty() {
            return Ok(Map::new());
         }

         serde_json::from_str::<Map<String, Value>>(&contents)
            .or_else(|error| {
               let recovered = recover_leading_store(&contents).ok_or(error)?;
               log::warn!(
                  "Recovered secure store '{}' from a partially overwritten file",
                  path.display()
               );
               Ok(recovered)
            })
            .map_err(|e: serde_json::Error| {
               format!("Failed to parse secure store '{}': {}", path.display(), e)
            })
      }
      Err(error) if error.kind() == ErrorKind::NotFound => Ok(Map::new()),
      Err(error) => Err(format!(
         "Failed to read secure store '{}': {}",
         path.display(),
         error
      )),
   }
}

/// A save interrupted by another one leaves a complete object followed by the tail of the longer
/// write. The leading object is the last full save, so it is kept and the next save rewrites it.
fn recover_leading_store(contents: &str) -> Option<Map<String, Value>> {
   serde_json::Deserializer::from_str(contents)
      .into_iter::<Map<String, Value>>()
      .next()?
      .ok()
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

fn set_in_store(path: &Path, key: &str, value: &str) -> Result<(), String> {
   let _guard = lock_secure_store();
   let mut store = load_store_from_path(path)?;
   store.insert(key.to_string(), Value::String(value.to_string()));
   save_store_to_path(path, &store)
}

fn get_from_store(path: &Path, key: &str) -> Result<Option<String>, String> {
   let _guard = lock_secure_store();
   let store = load_store_from_path(path)?;
   Ok(store
      .get(key)
      .and_then(|value| value.as_str().map(|s| s.to_string())))
}

fn delete_from_store(path: &Path, key: &str) -> Result<(), String> {
   let _guard = lock_secure_store();
   let mut store = load_store_from_path(path)?;
   if store.remove(key).is_none() {
      return Ok(());
   }
   save_store_to_path(path, &store)
}

fn store_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
   set_in_store(&secure_store_path(app)?, key, value)
}

fn store_get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
   get_from_store(&secure_store_path(app)?, key)
}

fn store_delete(app: &AppHandle, key: &str) -> Result<(), String> {
   delete_from_store(&secure_store_path(app)?, key)
}

fn store_secret_with_operations<SetKeychain, GetKeychain, DeleteFallback, SetFallback>(
   key: &str,
   value: &str,
   set_keychain: SetKeychain,
   get_keychain: GetKeychain,
   delete_fallback: DeleteFallback,
   set_fallback: SetFallback,
) -> Result<(), String>
where
   SetKeychain: FnOnce(&str, &str) -> Result<(), String>,
   GetKeychain: FnOnce(&str) -> Result<Option<String>, String>,
   DeleteFallback: FnOnce(&str) -> Result<(), String>,
   SetFallback: FnOnce(&str, &str) -> Result<(), String>,
{
   match set_keychain(key, value) {
      Ok(()) => match get_keychain(key) {
         Ok(Some(stored_value)) if stored_value == value => delete_fallback(key),
         Ok(_) => {
            log::warn!(
               "Keychain write for key '{}' could not be read back, using secure.json fallback",
               key
            );
            set_fallback(key, value)
         }
         Err(error) => {
            log::warn!(
               "Keychain readback failed for key '{}', using secure.json fallback: {}",
               key,
               error
            );
            set_fallback(key, value)
         }
      },
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

fn get_keychain_password(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
   let entry = keyring_entry(app, key)?;
   match entry.get_password() {
      Ok(value) => Ok(Some(value)),
      Err(keyring::Error::NoEntry) => Ok(None),
      Err(error) => Err(format!("Failed to read keychain entry: {error}")),
   }
}

pub fn store_secret(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
   let cache_key = secret_cache_key(app, key);
   secret_cache().remove(&cache_key);

   store_secret_with_operations(
      key,
      value,
      |key, value| set_keychain_password(app, key, value),
      |key| get_keychain_password(app, key),
      |key| store_delete(app, key),
      |key, value| store_set(app, key, value),
   )?;

   secret_cache().insert(cache_key, value.to_string());
   Ok(())
}

pub fn get_secret(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
   get_secret_with_cache(&SECRET_CACHE, keychain_service(app), key, || {
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
   })
}

pub fn remove_secret(app: &AppHandle, key: &str) -> Result<(), String> {
   secret_cache().remove(&secret_cache_key(app, key));

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

/// Writes a sibling temp file and renames it over the store, so readers and crashes never see a
/// partially written file.
fn write_secure_store_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
   match fs::symlink_metadata(path) {
      Ok(metadata) if metadata.file_type().is_symlink() => {
         return Err(std::io::Error::new(
            ErrorKind::InvalidInput,
            "secure store path must not be a symlink",
         ));
      }
      Ok(_) => {}
      Err(error) if error.kind() == ErrorKind::NotFound => {}
      Err(error) => return Err(error),
   }

   let directory = path.parent().unwrap_or_else(|| Path::new("."));
   let mut file = tempfile::Builder::new()
      .prefix(".secure-")
      .suffix(".tmp")
      .tempfile_in(directory)?;
   restrict_secure_file(file.as_file())?;
   file.write_all(contents)?;
   file.as_file().sync_all()?;
   file.persist(path).map_err(|error| error.error)?;
   Ok(())
}

#[cfg(unix)]
fn restrict_secure_file(file: &fs::File) -> std::io::Result<()> {
   use std::os::unix::fs::PermissionsExt;

   file.set_permissions(fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_secure_file(_file: &fs::File) -> std::io::Result<()> {
   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::{
      cell::RefCell,
      rc::Rc,
      sync::atomic::{AtomicUsize, Ordering},
   };

   #[test]
   fn secret_cache_reuses_loaded_values_for_the_same_service_and_key() {
      let cache = Mutex::new(HashMap::new());
      let loads = AtomicUsize::new(0);

      let first = get_secret_with_cache(&cache, "com.code.athas.dev", "github_token", || {
         loads.fetch_add(1, Ordering::Relaxed);
         Ok(Some("secret".to_string()))
      });
      let second = get_secret_with_cache(&cache, "com.code.athas.dev", "github_token", || {
         loads.fetch_add(1, Ordering::Relaxed);
         Ok(Some("different".to_string()))
      });

      assert_eq!(first, Ok(Some("secret".to_string())));
      assert_eq!(second, Ok(Some("secret".to_string())));
      assert_eq!(loads.load(Ordering::Relaxed), 1);
   }

   #[test]
   fn secret_cache_does_not_cache_missing_values() {
      let cache = Mutex::new(HashMap::new());
      let loads = AtomicUsize::new(0);

      let first = get_secret_with_cache(&cache, "com.code.athas.dev", "github_token", || {
         loads.fetch_add(1, Ordering::Relaxed);
         Ok(None)
      });
      let second = get_secret_with_cache(&cache, "com.code.athas.dev", "github_token", || {
         loads.fetch_add(1, Ordering::Relaxed);
         Ok(Some("secret".to_string()))
      });

      assert_eq!(first, Ok(None));
      assert_eq!(second, Ok(Some("secret".to_string())));
      assert_eq!(loads.load(Ordering::Relaxed), 2);
   }

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
               calls.borrow_mut().push(format!("read:{key}"));
               Ok(Some("secret".to_string()))
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
            "read:github_token".to_string(),
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
         |_| -> Result<Option<String>, String> {
            panic!("keychain readback should not run after a failed write")
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
   fn store_secret_uses_fallback_when_keychain_readback_is_missing() {
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
               calls.borrow_mut().push(format!("read:{key}"));
               Ok(None)
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
            "read:github_token".to_string(),
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

   #[test]
   fn concurrent_updates_keep_every_key_and_valid_json() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let path = temp_dir.path().join(SECURE_STORE_FILE);

      std::thread::scope(|scope| {
         for index in 0..16 {
            let path = &path;
            scope.spawn(move || {
               for round in 0..10 {
                  let key = format!("key_{index}");
                  set_in_store(path, &key, &format!("value_{index}_{round}")).expect("set");
                  delete_from_store(path, "missing").expect("delete missing");
               }
            });
         }
      });

      let store = load_store_from_path(&path).expect("store stays valid");
      assert_eq!(store.len(), 16);
      assert_eq!(store["key_3"], Value::String("value_3_9".to_string()));
   }

   #[test]
   fn load_recovers_the_complete_store_before_an_overwritten_tail() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let path = temp_dir.path().join(SECURE_STORE_FILE);
      fs::write(&path, "{\n  \"athas_auth_token\": \"token\"\n}en\"\n}").expect("write torn file");

      let store = load_store_from_path(&path).expect("recover leading store");

      assert_eq!(store.len(), 1);
      assert_eq!(
         store["athas_auth_token"],
         Value::String("token".to_string())
      );
   }

   #[test]
   fn load_still_rejects_a_store_that_is_not_json() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let path = temp_dir.path().join(SECURE_STORE_FILE);
      fs::write(&path, "not json").expect("write invalid file");

      assert!(load_store_from_path(&path).is_err());
   }

   #[test]
   fn set_repairs_a_torn_store() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let path = temp_dir.path().join(SECURE_STORE_FILE);
      fs::write(&path, "{\"github_token\":\"old\"}ken\"}").expect("write torn file");

      set_in_store(&path, "athas_auth_token", "new").expect("set after recovery");

      let contents = fs::read_to_string(&path).expect("read store");
      let store: Map<String, Value> = serde_json::from_str(&contents).expect("clean json");
      assert_eq!(store["github_token"], Value::String("old".to_string()));
      assert_eq!(store["athas_auth_token"], Value::String("new".to_string()));
   }

   #[test]
   fn deleting_a_missing_key_leaves_the_file_untouched() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let path = temp_dir.path().join(SECURE_STORE_FILE);
      fs::write(&path, r#"{"github_token":"secret"}"#).expect("write fallback");

      delete_from_store(&path, "athas_auth_token").expect("delete missing key");

      assert_eq!(
         fs::read_to_string(&path).expect("read store"),
         r#"{"github_token":"secret"}"#
      );
   }

   #[test]
   fn save_leaves_no_temporary_files_behind() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let path = temp_dir.path().join(SECURE_STORE_FILE);

      set_in_store(&path, "github_token", "secret").expect("set");
      set_in_store(&path, "github_token", "rotated").expect("overwrite");

      let names: Vec<_> = fs::read_dir(temp_dir.path())
         .expect("read dir")
         .map(|entry| entry.expect("entry").file_name())
         .collect();
      assert_eq!(names, vec![std::ffi::OsString::from(SECURE_STORE_FILE)]);
   }

   #[cfg(unix)]
   #[test]
   fn save_refuses_to_replace_a_symlinked_store() {
      let temp_dir = tempfile::tempdir().expect("temp dir");
      let target = temp_dir.path().join("elsewhere.json");
      let path = temp_dir.path().join(SECURE_STORE_FILE);
      fs::write(&target, "{}").expect("write target");
      std::os::unix::fs::symlink(&target, &path).expect("symlink store");

      assert!(set_in_store(&path, "github_token", "secret").is_err());
      assert_eq!(fs::read_to_string(&target).expect("read target"), "{}");
   }
}
