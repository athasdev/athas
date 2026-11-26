//! Chrome and the browsers built on Chromium: each profile in `Local State`, its `Cookies`
//! database, and the key the browser encrypts cookie values with.
//!
//! macOS: the key is PBKDF2 of the browser's "Safe Storage" keychain password, values are
//! AES-128-CBC behind a `v10` tag. Windows: the key is in `Local State`, sealed with DPAPI, values
//! are AES-256-GCM behind `v10`/`v11`; Chrome's newer `v20` values are bound to Chrome itself and
//! stay out of reach.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{Browser, Cookie, ImportError, SameSite, Source, Store};

/// Chromium counts time in microseconds since 1601.
const WINDOWS_TO_UNIX_EPOCH_SECONDS: i64 = 11_644_473_600;

/// From this database version, a value starts with the SHA-256 of its host.
const HOST_DIGEST_VERSION: i64 = 24;

struct Install {
    browser: Browser,
    /// The user data folder, under the platform's application data.
    folder: &'static [&'static str],
    keychain_service: &'static str,
}

#[cfg(target_os = "macos")]
const INSTALLS: &[Install] = &[
    Install { browser: Browser::Chrome, folder: &["Google", "Chrome"], keychain_service: "Chrome Safe Storage" },
    Install { browser: Browser::Arc, folder: &["Arc", "User Data"], keychain_service: "Arc Safe Storage" },
    Install { browser: Browser::Dia, folder: &["Dia", "User Data"], keychain_service: "Dia Safe Storage" },
    Install { browser: Browser::Brave, folder: &["BraveSoftware", "Brave-Browser"], keychain_service: "Brave Safe Storage" },
    Install { browser: Browser::Edge, folder: &["Microsoft Edge"], keychain_service: "Microsoft Edge Safe Storage" },
    Install { browser: Browser::Vivaldi, folder: &["Vivaldi"], keychain_service: "Vivaldi Safe Storage" },
    Install { browser: Browser::Opera, folder: &["com.operasoftware.Opera"], keychain_service: "Opera Safe Storage" },
    Install { browser: Browser::Chromium, folder: &["Chromium"], keychain_service: "Chromium Safe Storage" },
];

#[cfg(target_os = "windows")]
const INSTALLS: &[Install] = &[
    Install { browser: Browser::Chrome, folder: &["Google", "Chrome", "User Data"], keychain_service: "" },
    Install { browser: Browser::Edge, folder: &["Microsoft", "Edge", "User Data"], keychain_service: "" },
    Install { browser: Browser::Brave, folder: &["BraveSoftware", "Brave-Browser", "User Data"], keychain_service: "" },
    Install { browser: Browser::Vivaldi, folder: &["Vivaldi", "User Data"], keychain_service: "" },
    Install { browser: Browser::Arc, folder: &["Packages", "TheBrowserCompany.Arc_ttt1ap7aakyb4", "LocalCache", "Local", "Arc", "User Data"], keychain_service: "" },
    Install { browser: Browser::Chromium, folder: &["Chromium", "User Data"], keychain_service: "" },
];

fn application_data() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return dirs::data_dir();
    #[cfg(target_os = "windows")]
    return dirs::data_local_dir();
}

fn cookie_database(profile: &Path) -> Option<PathBuf> {
    [profile.join("Network").join("Cookies"), profile.join("Cookies")].into_iter().find(|path| path.is_file())
}

pub(super) fn sources() -> Vec<Source> {
    let Some(base) = application_data() else { return Vec::new() };
    let mut sources = Vec::new();
    for install in INSTALLS {
        let user_data = install.folder.iter().fold(base.clone(), |path, part| path.join(part));
        if !user_data.is_dir() {
            continue;
        }
        let local_state: Value = std::fs::read_to_string(user_data.join("Local State"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or(Value::Null);
        let profiles = profiles(&local_state);
        // Opera keeps its one profile in the user data folder itself.
        let profiles = if profiles.is_empty() { vec![(String::new(), "Default".to_string(), None)] } else { profiles };
        for (folder, name, account) in profiles {
            let directory = if folder.is_empty() { user_data.clone() } else { user_data.join(&folder) };
            let Some(cookies) = cookie_database(&directory).or_else(|| folder.is_empty().then(|| cookie_database(&user_data.join("Default"))).flatten())
            else {
                continue;
            };
            sources.push(Source {
                browser: install.browser,
                profile: name,
                account,
                store: Store::Chromium { cookies, user_data: user_data.clone(), keychain_service: install.keychain_service },
            });
        }
    }
    sources
}

/// `(folder, name, account)` of each profile `Local State` lists, in the browser's own order.
fn profiles(local_state: &Value) -> Vec<(String, String, Option<String>)> {
    let Some(cache) = local_state.pointer("/profile/info_cache").and_then(Value::as_object) else { return Vec::new() };
    let order: Vec<String> = local_state
        .pointer("/profile/profiles_order")
        .and_then(Value::as_array)
        .map(|order| order.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let mut folders: Vec<&String> = cache.keys().collect();
    folders.sort_by_key(|folder| (order.iter().position(|ordered| ordered == *folder).unwrap_or(usize::MAX), folder.as_str() != "Default", folder.to_string()));
    folders
        .into_iter()
        .map(|folder| {
            let info = &cache[folder];
            let text = |key: &str| info.get(key).and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty()).map(str::to_string);
            let name = text("name").or_else(|| text("gaia_name")).unwrap_or_else(|| folder.clone());
            (folder.clone(), name, text("user_name"))
        })
        .collect()
}

pub(super) fn read(browser: Browser, database: &Path, user_data: &Path, keychain_service: &str) -> Result<(Vec<Cookie>, usize), ImportError> {
    let key = key::load(browser, user_data, keychain_service)?;
    let (_folder, copy) = super::snapshot(database, browser)?;
    let connection = super::open_database(&copy)?;
    let version: i64 = connection
        .query_row("SELECT value FROM meta WHERE key = 'version'", [], |row| row.get::<_, String>(0))
        .ok()
        .and_then(|version| version.parse().ok())
        .unwrap_or(0);
    let error = |error: rusqlite::Error| ImportError::Other(format!("Failed to read {}'s cookies: {error}", browser.name()));
    let mut statement = connection
        .prepare(&format!(
            "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies{}",
            // A partitioned cookie belongs to one site embedded in another; WebKit keeps no
            // partitions, so it would overwrite the site's own cookie of the same name.
            if has_column(&connection, "top_frame_site_key") { " WHERE top_frame_site_key = ''" } else { "" }
        ))
        .map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, bool>(7)?,
                row.get::<_, i64>(8)?,
            ))
        })
        .map_err(error)?;
    let mut cookies = Vec::new();
    let (mut locked, mut unreadable, mut failed, mut not_text) = (0, 0, 0, 0);
    for row in rows {
        let Ok((domain, name, plain, encrypted, path, expires, secure, http_only, same_site)) = row else {
            unreadable += 1;
            continue;
        };
        let value = if encrypted.is_empty() {
            plain
        } else {
            match key.decrypt(&encrypted) {
                Decrypted::Value(mut bytes) => {
                    if version >= HOST_DIGEST_VERSION && bytes.len() >= 32 {
                        bytes.drain(..32);
                    }
                    let Ok(value) = String::from_utf8(bytes) else {
                        not_text += 1;
                        continue;
                    };
                    value
                }
                Decrypted::Locked => {
                    locked += 1;
                    continue;
                }
                Decrypted::Failed => {
                    failed += 1;
                    continue;
                }
            }
        };
        cookies.push(Cookie {
            name,
            value,
            domain,
            path: if path.is_empty() { "/".to_string() } else { path },
            expires: (expires > 0).then(|| expires / 1_000_000 - WINDOWS_TO_UNIX_EPOCH_SECONDS),
            secure,
            http_only,
            same_site: match same_site {
                0 => Some(SameSite::None),
                1 => Some(SameSite::Lax),
                2 => Some(SameSite::Strict),
                _ => None,
            },
        });
    }
    log::info!(
        "[browser-import] {}: {} cookies read (database version {version}); {failed} failed to decrypt, {not_text} not text, {unreadable} unreadable rows, {locked} locked",
        browser.name(),
        cookies.len()
    );
    Ok((cookies, locked))
}

fn has_column(connection: &rusqlite::Connection, column: &str) -> bool {
    connection.prepare(&format!("SELECT {column} FROM cookies LIMIT 0")).is_ok()
}

enum Decrypted {
    Value(Vec<u8>),
    /// Sealed to the browser itself.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Locked,
    Failed,
}

#[cfg(target_os = "macos")]
mod key {
    use aes::cipher::{BlockDecryptMut as _, KeyIvInit as _, block_padding::Pkcs7};
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit, SearchResult};

    use super::{Browser, Decrypted, ImportError, Path};

    pub struct Key([u8; 16]);

    /// Unlocks the browser's "Safe Storage" item; macOS asks the user the first time.
    pub fn load(browser: Browser, _user_data: &Path, service: &str) -> Result<Key, ImportError> {
        let results = ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(service)
            .load_data(true)
            .limit(Limit::Max(1))
            .search()
            .map_err(|_| ImportError::KeychainDenied(browser))?;
        let Some(SearchResult::Data(password)) = results.into_iter().next() else {
            return Err(ImportError::KeychainDenied(browser));
        };
        let mut key = [0u8; 16];
        pbkdf2::pbkdf2_hmac::<sha1::Sha1>(&password, b"saltysalt", 1003, &mut key);
        Ok(Key(key))
    }

    impl Key {
        pub(super) fn decrypt(&self, data: &[u8]) -> Decrypted {
            let Some(body) = data.strip_prefix(b"v10") else { return Decrypted::Failed };
            let iv = [b' '; 16];
            match cbc::Decryptor::<aes::Aes128>::new(&self.0.into(), &iv.into()).decrypt_padded_vec_mut::<Pkcs7>(body) {
                Ok(bytes) => Decrypted::Value(bytes),
                Err(_) => Decrypted::Failed,
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use aes::cipher::{BlockEncryptMut as _, block_padding::Pkcs7};

        use super::*;

        #[test]
        fn decrypts_a_v10_value() {
            let key = Key([7; 16]);
            let sealed = cbc::Encryptor::<aes::Aes128>::new(&key.0.into(), &[b' '; 16].into()).encrypt_padded_vec_mut::<Pkcs7>(b"session=1");
            let mut data = b"v10".to_vec();
            data.extend(sealed);
            assert!(matches!(key.decrypt(&data), Decrypted::Value(value) if value == b"session=1"));
            assert!(matches!(key.decrypt(b"v11abc"), Decrypted::Failed));
        }
    }
}

#[cfg(target_os = "windows")]
mod key {
    use aes_gcm::{Aes256Gcm, KeyInit as _, Nonce, aead::Aead as _};
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use serde_json::Value;
    use windows::Win32::{
        Foundation::{HLOCAL, LocalFree},
        Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptUnprotectData},
    };

    use super::{Browser, Decrypted, ImportError, Path};

    pub struct Key(Aes256Gcm);

    /// Unseals the key `Local State` keeps with DPAPI.
    pub fn load(browser: Browser, user_data: &Path, _service: &str) -> Result<Key, ImportError> {
        let fail = || ImportError::KeychainDenied(browser);
        let local_state: Value = std::fs::read_to_string(user_data.join("Local State"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .ok_or_else(fail)?;
        let sealed = local_state
            .pointer("/os_crypt/encrypted_key")
            .and_then(Value::as_str)
            .and_then(|text| STANDARD.decode(text).ok())
            .ok_or_else(fail)?;
        let sealed = sealed.strip_prefix(b"DPAPI").ok_or_else(fail)?;
        let key = unprotect(sealed).ok_or_else(fail)?;
        Aes256Gcm::new_from_slice(&key).map(Key).map_err(|_| fail())
    }

    fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: `input` points at `data` for the call; the system allocates `output`, which is
        // copied and then freed with LocalFree as CryptUnprotectData requires.
        unsafe {
            CryptUnprotectData(&input, None, None, None, None, 0, &mut output).ok()?;
            let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
            Some(bytes)
        }
    }

    impl Key {
        pub(super) fn decrypt(&self, data: &[u8]) -> Decrypted {
            if data.starts_with(b"v20") {
                return Decrypted::Locked;
            }
            if !(data.starts_with(b"v10") || data.starts_with(b"v11")) || data.len() < 3 + 12 + 16 {
                return Decrypted::Failed;
            }
            let (nonce, body) = data[3..].split_at(12);
            match self.0.decrypt(Nonce::from_slice(nonce), body) {
                Ok(bytes) => Decrypted::Value(bytes),
                Err(_) => Decrypted::Failed,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_profiles_in_the_browsers_order() {
        let local_state = serde_json::json!({
            "profile": {
                "info_cache": {
                    "Profile 2": { "name": "Work", "user_name": "me@work.dev" },
                    "Default": { "name": "Person 1", "user_name": "" },
                },
                "profiles_order": ["Profile 2", "Default"],
            }
        });
        assert_eq!(
            profiles(&local_state),
            [
                ("Profile 2".to_string(), "Work".to_string(), Some("me@work.dev".to_string())),
                ("Default".to_string(), "Person 1".to_string(), None),
            ]
        );
    }
}
