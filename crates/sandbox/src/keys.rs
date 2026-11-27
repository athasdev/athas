//! Where a provider's API key is kept: the OS keychain, through `secure_storage`, under
//! `sandbox_<provider>`. One place, so whoever reaches for a sandbox -- the catalog's page today,
//! the agent later -- asks the same question of the same drawer.
//!
//! Nothing here holds a key in memory of its own: `secure_storage` caches what it reads, and a
//! key that was removed elsewhere is gone the next time it is asked for.

const SERVICE: &str = paths::APP_ID;

/// Set by a headless run (the snapshot tool) to leave the keychain alone. A keychain asked for a
/// key by a binary it has never seen puts up a prompt, and a prompt nobody can see is a hang.
const NO_KEYCHAIN: &str = "ATHAS_NO_KEYCHAIN";

fn allowed() -> bool {
    std::env::var_os(NO_KEYCHAIN).is_none()
}

fn entry(provider: &str) -> String {
    format!("sandbox_{provider}")
}

pub fn store(provider: &str, key: &str) -> Result<(), String> {
    if !allowed() {
        return Ok(());
    }
    secure_storage::store_secret(SERVICE, &entry(provider), key.trim())
}

/// The key for `provider`, or `None` when there is none. A keychain that refuses is `None` too:
/// to the caller there is no key either way.
pub fn get(provider: &str) -> Option<String> {
    if !allowed() {
        return None;
    }
    secure_storage::get_secret(SERVICE, &entry(provider)).ok().flatten().filter(|key| !key.trim().is_empty())
}

pub fn clear(provider: &str) -> Result<(), String> {
    if !allowed() {
        return Ok(());
    }
    secure_storage::remove_secret(SERVICE, &entry(provider))
}

/// Enough of a key to recognise it by, and not enough to use: `e2b_…a1b2`.
pub fn mask(key: &str) -> String {
    let key = key.trim();
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    match key.char_indices().nth(4) {
        Some((end, _)) if key.chars().count() > 8 => format!("{}…{tail}", &key[..end]),
        _ => "…".repeat(1) + &tail,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_mask_shows_enough_to_recognise_a_key_and_not_enough_to_use_it() {
        assert_eq!(super::mask("e2b_1234567890abcd"), "e2b_…abcd");
        // Too short to cut: all that is left is the tail, which is the whole thing. Keys this
        // short are not real keys, and showing one in full tells the user it was not taken.
        assert_eq!(super::mask("abcd"), "…abcd");
    }
}
