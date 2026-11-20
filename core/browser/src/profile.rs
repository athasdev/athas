use sha2::{Digest, Sha256};
use std::{
   fs, io,
   path::{Path, PathBuf},
};

/// Where a browser profile keeps cookies, storage and cache, kept apart from the
/// workbench's own webview data so clearing one never touches the other.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserProfile {
   /// Data folder for WebView2 and WebKitGTK.
   pub data_directory: PathBuf,
   /// Website data store identifier for WKWebView, used on macOS 14 and later.
   pub data_store_identifier: [u8; 16],
}

fn profile_digest(key: &str) -> [u8; 32] {
   let mut hasher = Sha256::new();
   hasher.update(b"athas:browser-profile:");
   hasher.update(key.as_bytes());
   hasher.finalize().into()
}

/// Resolves the profile named `key` under `app_data_dir`, creating its folder.
pub fn resolve_profile(app_data_dir: &Path, key: &str) -> io::Result<BrowserProfile> {
   let digest = profile_digest(key);
   let folder = digest[..8]
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect::<String>();
   let data_directory = app_data_dir.join("browser").join("profiles").join(folder);
   fs::create_dir_all(&data_directory)?;

   let mut data_store_identifier = [0u8; 16];
   data_store_identifier.copy_from_slice(&digest[..16]);

   Ok(BrowserProfile {
      data_directory,
      data_store_identifier,
   })
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn keeps_each_profile_in_its_own_stable_folder() {
      let root = std::env::temp_dir().join(format!("athas-browser-profile-{}", std::process::id()));
      let first = resolve_profile(&root, "default").unwrap();
      let again = resolve_profile(&root, "default").unwrap();
      let other = resolve_profile(&root, "work").unwrap();

      assert_eq!(first, again);
      assert_ne!(first.data_directory, other.data_directory);
      assert_ne!(first.data_store_identifier, other.data_store_identifier);
      assert!(
         first
            .data_directory
            .starts_with(root.join("browser").join("profiles"))
      );
      assert!(first.data_directory.is_dir());

      let _ = fs::remove_dir_all(root);
   }
}
