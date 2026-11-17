//! Where the account token is kept: the OS keychain (`secure_storage.rs`), under this app's own
//! service name so it never touches the Tauri app's entry.

use std::sync::Mutex;

pub const KEYCHAIN_SERVICE: &str = paths::APP_ID;
pub const TOKEN_KEY: &str = "athas_auth_token";

pub trait TokenStore: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, token: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

pub struct KeychainTokenStore;

#[cfg(not(target_family = "wasm"))]
impl TokenStore for KeychainTokenStore {
    fn get(&self) -> Result<Option<String>, String> {
        secure_storage::get_secret(KEYCHAIN_SERVICE, TOKEN_KEY)
            .map(|token| token.filter(|token| !token.is_empty()))
            .map_err(|error| format!("Failed to read the saved session: {error}"))
    }

    fn set(&self, token: &str) -> Result<(), String> {
        secure_storage::store_secret(KEYCHAIN_SERVICE, TOKEN_KEY, token).map_err(|error| format!("Failed to save the session: {error}"))
    }

    fn delete(&self) -> Result<(), String> {
        secure_storage::remove_secret(KEYCHAIN_SERVICE, TOKEN_KEY)
            .map_err(|error| format!("Could not remove the saved session from secure storage: {error}"))
    }
}

/// The browser has no keychain; the web build keeps the session for the page's lifetime.
#[cfg(target_family = "wasm")]
impl TokenStore for KeychainTokenStore {
    fn get(&self) -> Result<Option<String>, String> {
        WEB_TOKEN.get()
    }

    fn set(&self, token: &str) -> Result<(), String> {
        WEB_TOKEN.set(token)
    }

    fn delete(&self) -> Result<(), String> {
        WEB_TOKEN.delete()
    }
}

#[cfg(target_family = "wasm")]
static WEB_TOKEN: MemoryTokenStore = MemoryTokenStore(Mutex::new(None));

/// A token kept in memory, for tests and headless runs.
#[derive(Default)]
pub struct MemoryTokenStore(Mutex<Option<String>>);

impl MemoryTokenStore {
    pub fn with_token(token: &str) -> Self {
        Self(Mutex::new(Some(token.to_string())))
    }
}

impl TokenStore for MemoryTokenStore {
    fn get(&self) -> Result<Option<String>, String> {
        Ok(self.0.lock().map_err(|error| error.to_string())?.clone())
    }

    fn set(&self, token: &str) -> Result<(), String> {
        *self.0.lock().map_err(|error| error.to_string())? = Some(token.to_string());
        Ok(())
    }

    fn delete(&self) -> Result<(), String> {
        *self.0.lock().map_err(|error| error.to_string())? = None;
        Ok(())
    }
}
