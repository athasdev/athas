//! Which Athas this build is, and where its data lives.
//!
//! Development builds are `dev.athas.gpui`: their own bundle id, data folder, keychain entries,
//! socket and logs, so running one never touches the installed app. Shipping builds are compiled
//! with `ATHAS_IDENTITY=release` (`scripts/bundle-mac.sh --release` and the release workflow set
//! it): they take over the Tauri app's bundle id `com.code.athas`, so the Tauri updater can
//! replace that app with this one, and keep their data in `dev.athas.app`, next to the Tauri app's
//! `com.code.athas` folder, which is only read (see `docs/release-migration.md`).

use std::path::PathBuf;

const fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut index = 0;
    while index < a.len() {
        if a[index] != b[index] {
            return false;
        }
        index += 1;
    }
    true
}

/// Whether this is a shipping build (`ATHAS_IDENTITY=release` at compile time).
pub const IS_RELEASE_IDENTITY: bool = match option_env!("ATHAS_IDENTITY") {
    Some(identity) => same(identity, "release"),
    None => false,
};

/// The folder this build keeps its data in, and the service of its keychain entries.
pub const APP_ID: &str = if IS_RELEASE_IDENTITY { "dev.athas.app" } else { "dev.athas.gpui" };

/// The bundle identifier (macOS), app id (Wayland, Windows AppUserModelID) of this build.
pub const BUNDLE_ID: &str = if IS_RELEASE_IDENTITY { TAURI_APP_ID } else { "dev.athas.gpui" };

/// The keychain service of the GitHub token.
pub const GITHUB_KEYCHAIN_SERVICE: &str = if IS_RELEASE_IDENTITY { "dev.athas.app.github" } else { "dev.athas.gpui.github" };

/// The Tauri app's identifier: its bundle id, data folder and keychain service.
pub const TAURI_APP_ID: &str = "com.code.athas";

/// `<data dir>/<APP_ID>`, where settings, the workspace and the socket live.
pub fn data_dir() -> Option<PathBuf> {
    system_data_dir().map(|dir| dir.join(APP_ID))
}

/// `<data dir>/com.code.athas`, the Tauri app's data, read on the first run.
pub fn tauri_data_dir() -> Option<PathBuf> {
    system_data_dir().map(|dir| dir.join(TAURI_APP_ID))
}

#[cfg(not(target_family = "wasm"))]
fn system_data_dir() -> Option<PathBuf> {
    dirs::data_dir()
}

/// The web build keeps no files of its own.
#[cfg(target_family = "wasm")]
fn system_data_dir() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_builds_keep_to_themselves() {
        assert!(same("release", "release"));
        assert!(!same("release", "releases"));
        assert!(!same("dev", "rel"));
        if !IS_RELEASE_IDENTITY {
            assert_eq!(APP_ID, "dev.athas.gpui");
            assert_eq!(BUNDLE_ID, "dev.athas.gpui");
        } else {
            assert_eq!(BUNDLE_ID, TAURI_APP_ID);
        }
        assert_ne!(APP_ID, TAURI_APP_ID);
        assert!(GITHUB_KEYCHAIN_SERVICE.starts_with(APP_ID));
    }
}
