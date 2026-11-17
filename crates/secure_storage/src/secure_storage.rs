//! Secrets in the OS keychain, with an owner-only `secure.json` for when the keychain cannot keep
//! them (`secure_storage.rs`): no Secret Service on Linux, a locked or refusing keychain. A value
//! read once is kept in memory, so later reads never wait on the keychain.

use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex, MutexGuard},
};

const SECURE_STORE_FILE: &str = "secure.json";
const APP_ID: &str = paths::APP_ID;

type SecretCache = HashMap<(String, String), String>;

static SECRET_CACHE: LazyLock<Mutex<SecretCache>> = LazyLock::new(|| Mutex::new(HashMap::new()));
// Each read-modify-write of secure.json runs under this lock, or concurrent saves interleave into
// invalid JSON.
static SECURE_STORE_LOCK: Mutex<()> = Mutex::new(());

fn lock_secure_store() -> MutexGuard<'static, ()> {
    SECURE_STORE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn secret_cache() -> MutexGuard<'static, SecretCache> {
    SECRET_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Saves `value` under `key` in the keychain's `service`; when the keychain fails or cannot read
/// the value back, in `secure.json` instead.
pub fn store_secret(service: &str, key: &str, value: &str) -> Result<(), String> {
    let cache_key = (service.to_string(), key.to_string());
    secret_cache().remove(&cache_key);
    let fallback_key = fallback_key(service, key);
    store_secret_with_operations(
        key,
        value,
        |key, value| set_keychain_password(service, key, value),
        |key| get_keychain_password(service, key),
        |_| store_delete(&fallback_key),
        |_, value| store_set(&fallback_key, value),
    )?;
    secret_cache().insert(cache_key, value.to_string());
    Ok(())
}

/// The value under `key`: from the keychain, else from `secure.json`.
pub fn get_secret(service: &str, key: &str) -> Result<Option<String>, String> {
    get_secret_with_cache(&SECRET_CACHE, service, key, || {
        let fallback_key = fallback_key(service, key);
        match keyring::Entry::new(service, key) {
            Ok(entry) => match entry.get_password() {
                Ok(value) => {
                    if let Err(error) = store_delete(&fallback_key) {
                        log::warn!("Failed to remove stale secure.json fallback for key '{key}': {error}");
                    }
                    return Ok(Some(value));
                }
                Err(keyring::Error::NoEntry) => {}
                Err(error) => {
                    log::warn!("Failed to read key '{key}' from keychain, falling back to secure.json: {error}");
                }
            },
            Err(error) => {
                log::warn!("Keychain entry initialization failed for key '{key}', falling back to secure.json: {error}");
            }
        }
        store_get(&fallback_key)
    })
}

/// Removes the value from the keychain and from `secure.json`.
pub fn remove_secret(service: &str, key: &str) -> Result<(), String> {
    secret_cache().remove(&(service.to_string(), key.to_string()));
    if let Ok(entry) = keyring::Entry::new(service, key) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => {
                log::warn!("Failed to remove key '{key}' from keychain, continuing with secure.json cleanup: {error}");
            }
        }
    }
    store_delete(&fallback_key(service, key))
}

/// Keys of the app's own service stand alone in `secure.json`; others carry their service.
fn fallback_key(service: &str, key: &str) -> String {
    if service == APP_ID { key.to_string() } else { format!("{service}/{key}") }
}

fn get_secret_with_cache(
    cache: &Mutex<SecretCache>,
    service: &str,
    key: &str,
    load: impl FnOnce() -> Result<Option<String>, String>,
) -> Result<Option<String>, String> {
    let mut cache = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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

fn store_secret_with_operations(
    key: &str,
    value: &str,
    set_keychain: impl FnOnce(&str, &str) -> Result<(), String>,
    get_keychain: impl FnOnce(&str) -> Result<Option<String>, String>,
    delete_fallback: impl FnOnce(&str) -> Result<(), String>,
    set_fallback: impl FnOnce(&str, &str) -> Result<(), String>,
) -> Result<(), String> {
    match set_keychain(key, value) {
        Ok(()) => match get_keychain(key) {
            Ok(Some(stored)) if stored == value => delete_fallback(key),
            Ok(_) => {
                log::warn!("Keychain write for key '{key}' could not be read back, using secure.json fallback");
                set_fallback(key, value)
            }
            Err(error) => {
                log::warn!("Keychain readback failed for key '{key}', using secure.json fallback: {error}");
                set_fallback(key, value)
            }
        },
        Err(error) => {
            log::warn!("Keychain unavailable for key '{key}', using secure.json fallback: {error}");
            set_fallback(key, value)
        }
    }
}

fn set_keychain_password(service: &str, key: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(service, key)
        .map_err(|error| format!("Failed to initialize keychain entry: {error}"))?
        .set_password(value)
        .map_err(|error| format!("Failed to write keychain entry: {error}"))
}

fn get_keychain_password(service: &str, key: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(service, key).map_err(|error| format!("Failed to initialize keychain entry: {error}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read keychain entry: {error}")),
    }
}

/// The first of the app's data folder and `~/.athas-gpui` that can be made owner-only.
fn secure_store_path() -> Result<PathBuf, String> {
    let candidates = [dirs::data_dir().map(|dir| dir.join(APP_ID)), dirs::home_dir().map(|dir| dir.join(".athas-gpui"))];
    for dir in candidates.into_iter().flatten() {
        match create_secure_dir_all(&dir) {
            Ok(()) => return Ok(dir.join(SECURE_STORE_FILE)),
            Err(error) => log::warn!("Failed to create secure storage directory '{}': {error}", dir.display()),
        }
    }
    Err("Failed to resolve a writable secure storage directory".to_string())
}

fn store_set(key: &str, value: &str) -> Result<(), String> {
    set_in_store(&secure_store_path()?, key, value)
}

fn store_get(key: &str) -> Result<Option<String>, String> {
    get_from_store(&secure_store_path()?, key)
}

fn store_delete(key: &str) -> Result<(), String> {
    delete_from_store(&secure_store_path()?, key)
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
                    log::warn!("Recovered secure store '{}' from a partially overwritten file", path.display());
                    Ok(recovered)
                })
                .map_err(|error: serde_json::Error| format!("Failed to parse secure store '{}': {error}", path.display()))
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(format!("Failed to read secure store '{}': {error}", path.display())),
    }
}

/// A save interrupted by another one leaves a complete object followed by the tail of the longer
/// write. The leading object is the last full save, so it is kept and the next save rewrites it.
fn recover_leading_store(contents: &str) -> Option<Map<String, Value>> {
    serde_json::Deserializer::from_str(contents).into_iter::<Map<String, Value>>().next()?.ok()
}

fn save_store_to_path(path: &Path, store: &Map<String, Value>) -> Result<(), String> {
    if store.is_empty() {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Failed to remove empty secure store '{}': {error}", path.display())),
        };
    }
    if let Some(parent) = path.parent() {
        create_secure_dir_all(parent)
            .map_err(|error| format!("Failed to create secure store directory '{}': {error}", parent.display()))?;
    }
    let contents = serde_json::to_string_pretty(store).map_err(|error| format!("Failed to serialize secure store: {error}"))?;
    write_secure_store_file(path, contents.as_bytes())
        .map_err(|error| format!("Failed to save secure store '{}': {error}", path.display()))
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
    Ok(store.get(key).and_then(|value| value.as_str().map(str::to_string)))
}

fn delete_from_store(path: &Path, key: &str) -> Result<(), String> {
    let _guard = lock_secure_store();
    let mut store = load_store_from_path(path)?;
    if store.remove(key).is_none() {
        return Ok(());
    }
    save_store_to_path(path, &store)
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
fn harden_secure_dir(_: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Writes a sibling temp file and renames it over the store, so readers and crashes never see a
/// partially written file.
fn write_secure_store_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(std::io::Error::new(ErrorKind::InvalidInput, "secure store path must not be a symlink"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    let mut file = tempfile::Builder::new().prefix(".secure-").suffix(".tmp").tempfile_in(directory)?;
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
fn restrict_secure_file(_: &fs::File) -> std::io::Result<()> {
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
    fn the_cache_keeps_loaded_values_but_not_missing_ones() {
        let cache = Mutex::new(HashMap::new());
        let loads = AtomicUsize::new(0);
        let load = |value: Option<&str>| {
            loads.fetch_add(1, Ordering::Relaxed);
            Ok(value.map(str::to_string))
        };
        assert_eq!(get_secret_with_cache(&cache, "s", "missing", || load(None)), Ok(None));
        assert_eq!(get_secret_with_cache(&cache, "s", "missing", || load(Some("later"))), Ok(Some("later".into())));
        assert_eq!(get_secret_with_cache(&cache, "s", "missing", || load(Some("different"))), Ok(Some("later".into())));
        assert_eq!(loads.load(Ordering::Relaxed), 2);
    }

    fn store_with(keychain_write: Result<(), String>, readback: Result<Option<String>, String>) -> Vec<String> {
        let calls = Rc::new(RefCell::new(Vec::new()));
        let failed_write = keychain_write.is_err();
        let result = store_secret_with_operations(
            "token",
            "secret",
            {
                let calls = calls.clone();
                move |key, value| {
                    calls.borrow_mut().push(format!("keychain:{key}:{value}"));
                    keychain_write
                }
            },
            {
                let calls = calls.clone();
                move |key| {
                    assert!(!failed_write, "keychain readback should not run after a failed write");
                    calls.borrow_mut().push(format!("read:{key}"));
                    readback
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
        calls.borrow().clone()
    }

    #[test]
    fn the_fallback_is_used_only_when_the_keychain_cannot_keep_the_value() {
        assert_eq!(store_with(Ok(()), Ok(Some("secret".into()))), ["keychain:token:secret", "read:token", "delete:token"]);
        assert_eq!(store_with(Err("unavailable".into()), Ok(None)), ["keychain:token:secret", "fallback:token:secret"]);
        assert_eq!(store_with(Ok(()), Ok(None)), ["keychain:token:secret", "read:token", "fallback:token:secret"]);
        assert_eq!(store_with(Ok(()), Err("locked".into())), ["keychain:token:secret", "read:token", "fallback:token:secret"]);
    }

    #[test]
    fn other_services_keep_their_keys_apart() {
        assert_eq!(fallback_key(APP_ID, "athas_auth_token"), "athas_auth_token");
        assert_eq!(fallback_key("dev.athas.gpui.github", "personal-access-token"), "dev.athas.gpui.github/personal-access-token");
    }

    #[cfg(unix)]
    #[test]
    fn the_store_is_owner_only_and_an_empty_one_is_deleted() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("athas");
        let path = dir.join(SECURE_STORE_FILE);
        set_in_store(&path, "token", "secret").unwrap();
        assert_eq!(fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(get_from_store(&path, "token").unwrap(), Some("secret".into()));

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        set_in_store(&path, "token", "rotated").unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);

        let names: Vec<_> = fs::read_dir(&dir).unwrap().map(|entry| entry.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from(SECURE_STORE_FILE)]);

        delete_from_store(&path, "token").unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn concurrent_updates_keep_every_key_and_valid_json() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(SECURE_STORE_FILE);
        std::thread::scope(|scope| {
            for index in 0..16 {
                let path = &path;
                scope.spawn(move || {
                    for round in 0..10 {
                        set_in_store(path, &format!("key_{index}"), &format!("value_{index}_{round}")).unwrap();
                        delete_from_store(path, "missing").unwrap();
                    }
                });
            }
        });
        let store = load_store_from_path(&path).unwrap();
        assert_eq!(store.len(), 16);
        assert_eq!(store["key_3"], Value::String("value_3_9".into()));
    }

    #[test]
    fn a_torn_store_is_recovered_and_repaired() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(SECURE_STORE_FILE);
        fs::write(&path, "{\"github_token\":\"old\"}ken\"}").unwrap();
        set_in_store(&path, "athas_auth_token", "new").unwrap();
        let store: Map<String, Value> = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(store["github_token"], Value::String("old".into()));
        assert_eq!(store["athas_auth_token"], Value::String("new".into()));

        fs::write(&path, "not json").unwrap();
        assert!(load_store_from_path(&path).is_err());
    }

    #[test]
    fn deleting_a_missing_key_leaves_the_file_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(SECURE_STORE_FILE);
        fs::write(&path, r#"{"github_token":"secret"}"#).unwrap();
        delete_from_store(&path, "athas_auth_token").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"github_token":"secret"}"#);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_store_is_never_replaced() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("elsewhere.json");
        let path = temp.path().join(SECURE_STORE_FILE);
        fs::write(&target, "{}").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        assert!(set_in_store(&path, "github_token", "secret").is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "{}");
    }
}
