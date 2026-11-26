//! Where Athas keeps the passkeys it makes: one keychain item holding all of them, so a site's
//! key never sits in a plain file (`secure_storage` falls back to its owner-only file only when
//! the keychain refuses).

use std::sync::Mutex;

use super::passkey::Passkey;

const ACCOUNT: &str = "browser-passkeys";

fn service() -> String {
    format!("{}.passkeys", paths::APP_ID)
}

/// What the keychain held when last read, so a sign-in never waits on it twice.
static PASSKEYS: Mutex<Option<Vec<Passkey>>> = Mutex::new(None);

fn with_passkeys<T>(change: impl FnOnce(&mut Vec<Passkey>) -> T) -> Result<T, String> {
    let mut cached = PASSKEYS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if cached.is_none() {
        let stored = secure_storage::get_secret(&service(), ACCOUNT)?;
        let passkeys = match stored {
            Some(text) => serde_json::from_str(&text).map_err(|error| format!("Failed to read saved passkeys: {error}"))?,
            None => Vec::new(),
        };
        *cached = Some(passkeys);
    }
    Ok(change(cached.get_or_insert_with(Vec::new)))
}

fn save(passkeys: &[Passkey]) -> Result<(), String> {
    let text = serde_json::to_string(passkeys).map_err(|error| error.to_string())?;
    secure_storage::store_secret(&service(), ACCOUNT, &text)
}

/// Every saved passkey.
pub fn all() -> Result<Vec<Passkey>, String> {
    with_passkeys(|passkeys| passkeys.clone())
}

/// Saves `passkey`, replacing one for the same account on the same site.
pub fn add(passkey: Passkey) -> Result<(), String> {
    with_passkeys(|passkeys| {
        let mut next = passkeys.clone();
        next.retain(|existing| !(existing.rp_id == passkey.rp_id && existing.user_handle == passkey.user_handle));
        next.push(passkey);
        save(&next)?;
        *passkeys = next;
        Ok(())
    })?
}

pub fn remove(credential_id: &[u8]) -> Result<(), String> {
    with_passkeys(|passkeys| {
        let mut next = passkeys.clone();
        next.retain(|passkey| passkey.credential_id != credential_id);
        save(&next)?;
        *passkeys = next;
        Ok(())
    })?
}

/// Notes that `credential_id` just signed in.
pub fn mark_used(credential_id: &[u8], now: u64) {
    let _ = with_passkeys(|passkeys| {
        let mut next = passkeys.clone();
        if let Some(passkey) = next.iter_mut().find(|passkey| passkey.credential_id == credential_id) {
            passkey.last_used_at = Some(now);
            if save(&next).is_ok() {
                *passkeys = next;
            }
        }
    });
}

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs())
}
