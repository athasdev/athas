//! API keys, the Athas account token and other secrets live in the OS keychain (service
//! `dev.athas.gpui`), or in an owner-only `secure.json` when the keychain cannot keep them. A key can also come from the provider's usual environment
//! variable, such as `ANTHROPIC_API_KEY`.
//!
//! Account names follow the Tauri app's secure storage: `ai_token_<provider>`,
//! `athas_auth_token` and `mcp_server_<id>`.

use std::{
    collections::HashMap,
    sync::{Mutex, PoisonError},
};

use crate::catalog::Provider;

pub const KEYCHAIN_SERVICE: &str = paths::APP_ID;
pub const AUTH_TOKEN_ACCOUNT: &str = "athas_auth_token";
/// Environment variable with an Athas account token, for development.
pub const AUTH_TOKEN_ENV: &str = "ATHAS_AUTH_TOKEN";

pub fn provider_key_account(provider_id: &str) -> String {
    format!("ai_token_{provider_id}")
}

/// Where secrets are read from and saved to.
pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Option<String>;
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// The OS keychain. Reads are cached for the life of the process, since every model request needs
/// its key and a keychain read can take a while.
#[derive(Default)]
pub struct Keychain {
    #[cfg_attr(target_family = "wasm", allow(dead_code))]
    cache: Mutex<HashMap<String, Option<String>>>,
}

impl Keychain {
    /// The keychain shared by the whole app.
    pub fn shared() -> &'static Keychain {
        static KEYCHAIN: std::sync::OnceLock<Keychain> = std::sync::OnceLock::new();
        KEYCHAIN.get_or_init(Keychain::default)
    }
}

#[cfg(not(target_family = "wasm"))]
impl SecretStore for Keychain {
    fn get(&self, account: &str) -> Option<String> {
        let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(value) = cache.get(account) {
            return value.clone();
        }
        let value = secure_storage::get_secret(KEYCHAIN_SERVICE, account).ok().flatten().filter(|value| !value.is_empty());
        cache.insert(account.to_string(), value.clone());
        value
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        secure_storage::store_secret(KEYCHAIN_SERVICE, account, value).map_err(|error| format!("Could not save to the keychain: {error}"))?;
        self.cache.lock().unwrap_or_else(PoisonError::into_inner).insert(account.to_string(), Some(value.to_string()));
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        secure_storage::remove_secret(KEYCHAIN_SERVICE, account).map_err(|error| format!("Could not remove from the keychain: {error}"))?;
        self.cache.lock().unwrap_or_else(PoisonError::into_inner).insert(account.to_string(), None);
        Ok(())
    }
}

#[cfg(target_family = "wasm")]
impl SecretStore for Keychain {
    fn get(&self, _: &str) -> Option<String> {
        None
    }

    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Err("The keychain is not available in the browser".into())
    }

    fn delete(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

/// Secrets held in memory: for tests, and for a web build that receives them from its host.
#[derive(Default)]
pub struct MemorySecrets(Mutex<HashMap<String, String>>);

impl MemorySecrets {
    pub fn with(entries: &[(&str, &str)]) -> Self {
        Self(Mutex::new(entries.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect()))
    }
}

impl SecretStore for MemorySecrets {
    fn get(&self, account: &str) -> Option<String> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).get(account).cloned()
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).insert(account.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).remove(account);
        Ok(())
    }
}

/// The API key for `provider`: the saved one, else its environment variable.
pub fn api_key(store: &dyn SecretStore, provider: &Provider) -> Option<String> {
    store.get(&provider_key_account(provider.id)).or_else(|| {
        provider.key_env.iter().find_map(|name| std::env::var(name).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()))
    })
}

/// The signed-in Athas account's token, if any.
pub fn auth_token(store: &dyn SecretStore) -> Option<String> {
    store
        .get(AUTH_TOKEN_ACCOUNT)
        .or_else(|| std::env::var(AUTH_TOKEN_ENV).ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()))
}

/// How a key is shown in settings: its last four characters.
pub fn mask(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    if key.chars().count() <= 8 { "••••".to_string() } else { format!("••••{tail}") }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog;

    #[test]
    fn saved_keys_win_over_the_environment() {
        let anthropic = catalog::provider("anthropic").unwrap();
        let store = MemorySecrets::with(&[("ai_token_anthropic", "sk-saved")]);
        assert_eq!(api_key(&store, anthropic).as_deref(), Some("sk-saved"));
        store.delete("ai_token_anthropic").unwrap();
        let custom = catalog::provider("custom").unwrap();
        assert_eq!(api_key(&store, custom), None);
    }

    #[test]
    fn keys_are_masked_for_display() {
        assert_eq!(mask("sk-ant-1234567890abcd"), "••••abcd");
        assert_eq!(mask("short"), "••••");
    }
}
