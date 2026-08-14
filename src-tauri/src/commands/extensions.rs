use crate::{
   app_runtime::AppHandle,
   secure_storage::{get_secret, remove_secret, store_secret},
};
use athas_extensions::{
   DownloadInfo, ExtensionInstaller, ExtensionMetadata, validate_extension_id,
};
use std::{env, fs, path::Path};
use tauri::{AppHandle as TauriAppHandle, Runtime, command};
use url::Url;

fn validate_extension_key(key: &str) -> Result<(), String> {
   if key.is_empty() || key.len() > 128 {
      return Err("Invalid extension key length".to_string());
   }
   if !key
      .chars()
      .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-')
   {
      return Err("Invalid extension key characters".to_string());
   }
   Ok(())
}

fn extension_secret_key(extension_id: &str, key: &str) -> Result<String, String> {
   validate_extension_id(extension_id).map_err(|error| error.to_string())?;
   validate_extension_key(key)?;
   Ok(format!("extension:{extension_id}:{key}"))
}

fn validate_extension_entrypoint(entrypoint: &str) -> Result<(), String> {
   let path = Path::new(entrypoint);
   if entrypoint.is_empty()
      || path.is_absolute()
      || path
         .components()
         .any(|component| !matches!(component, std::path::Component::Normal(_)))
   {
      return Err("Invalid extension entrypoint".to_string());
   }
   Ok(())
}

fn is_allowed_extension_host(host: &str) -> bool {
   host == "athas.dev" || host.ends_with(".athas.dev")
}

fn validate_extension_download_url(input: &str) -> Result<(), String> {
   let parsed = Url::parse(input).map_err(|_| "Invalid extension download URL".to_string())?;
   let host = parsed.host_str().unwrap_or_default();
   match parsed.scheme() {
      "https" => {
         if !cfg!(debug_assertions) && !is_allowed_extension_host(host) {
            return Err("Extension download host is not allowed".to_string());
         }
      }
      "http" if cfg!(debug_assertions) => {
         if host != "localhost" && host != "127.0.0.1" {
            return Err("Insecure extension download URL is not allowed".to_string());
         }
      }
      _ => return Err("Extension download URL must use HTTPS".to_string()),
   }
   Ok(())
}

#[command]
pub fn get_bundled_extensions_path<R: Runtime>(
   app_handle: TauriAppHandle<R>,
) -> Result<String, String> {
   // In production, use Tauri's resource directory API
   // In development, fall back to the source path
   let extensions_path = if cfg!(debug_assertions) {
      // Development mode: use source path
      let mut cwd =
         env::current_dir().map_err(|e| format!("Failed to get current directory: {}", e))?;

      // If we're in src-tauri directory, go up one level to project root
      if cwd.ends_with("src-tauri") {
         cwd.pop();
      }

      cwd.join("src").join("extensions").join("bundled")
   } else {
      // Production mode: use Tauri's resource directory
      use tauri::Manager;

      let resource_path = app_handle
         .path()
         .resource_dir()
         .map_err(|e| format!("Failed to get resource dir: {}", e))?;

      resource_path.join("bundled")
   };

   log::info!("Bundled extensions path: {:?}", extensions_path);

   Ok(extensions_path
      .to_str()
      .ok_or("Failed to convert path to string")?
      .to_string())
}

#[command]
pub async fn install_extension(
   app_handle: AppHandle,
   extension_id: String,
   url: String,
   checksum: String,
   size: u64,
) -> Result<(), String> {
   validate_extension_id(&extension_id).map_err(|error| error.to_string())?;
   validate_extension_download_url(&url)?;

   log::info!("Installing extension {} from {}", extension_id, url);

   let installer = ExtensionInstaller::new(app_handle)
      .map_err(|e| format!("Failed to create installer: {}", e))?;

   let download_info = DownloadInfo {
      url,
      checksum,
      size,
   };

   installer
      .install_extension(extension_id, download_info)
      .await
      .map_err(|e| format!("Failed to install extension: {}", e))
}

#[command]
pub fn uninstall_extension(app_handle: AppHandle, extension_id: String) -> Result<(), String> {
   validate_extension_id(&extension_id).map_err(|error| error.to_string())?;

   log::info!("Uninstalling extension {}", extension_id);

   let installer = ExtensionInstaller::new(app_handle)
      .map_err(|e| format!("Failed to create installer: {}", e))?;

   installer
      .uninstall_extension(&extension_id)
      .map_err(|e| format!("Failed to uninstall extension: {}", e))
}

#[command]
pub fn list_installed_extensions(app_handle: AppHandle) -> Result<Vec<ExtensionMetadata>, String> {
   let installer = ExtensionInstaller::new(app_handle)
      .map_err(|e| format!("Failed to create installer: {}", e))?;

   installer
      .list_installed_extensions()
      .map_err(|e| format!("Failed to list extensions: {}", e))
}

#[command]
pub fn get_extension_path(app_handle: AppHandle, extension_id: String) -> Result<String, String> {
   validate_extension_id(&extension_id).map_err(|error| error.to_string())?;

   log::info!("Getting path for extension {}", extension_id);

   let installer = ExtensionInstaller::new(app_handle)
      .map_err(|e| format!("Failed to create installer: {}", e))?;

   let path = installer.get_extension_dir(&extension_id);

   Ok(path
      .to_str()
      .ok_or("Failed to convert path to string")?
      .to_string())
}

#[command]
pub fn read_extension_entrypoint(
   app_handle: AppHandle,
   extension_id: String,
   entrypoint: String,
) -> Result<String, String> {
   validate_extension_id(&extension_id).map_err(|error| error.to_string())?;
   validate_extension_entrypoint(&entrypoint)?;

   let installer = ExtensionInstaller::new(app_handle)
      .map_err(|e| format!("Failed to create installer: {}", e))?;
   let extension_dir = installer.get_extension_dir(&extension_id);
   let entrypoint_path = extension_dir.join(entrypoint);
   let canonical_extension_dir = extension_dir
      .canonicalize()
      .map_err(|e| format!("Failed to resolve extension directory: {e}"))?;
   let canonical_entrypoint = entrypoint_path
      .canonicalize()
      .map_err(|e| format!("Failed to resolve extension entrypoint: {e}"))?;
   if !canonical_entrypoint.starts_with(&canonical_extension_dir) {
      return Err("Extension entrypoint escaped its installation directory".to_string());
   }
   let metadata = fs::metadata(&canonical_entrypoint)
      .map_err(|e| format!("Failed to inspect extension entrypoint: {e}"))?;
   if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
      return Err("Extension entrypoint must be a file no larger than 2 MB".to_string());
   }

   fs::read_to_string(canonical_entrypoint)
      .map_err(|e| format!("Failed to read extension entrypoint: {e}"))
}

#[command]
pub fn get_extension_secret(
   app_handle: AppHandle,
   extension_id: String,
   key: String,
) -> Result<Option<String>, String> {
   get_secret(&app_handle, &extension_secret_key(&extension_id, &key)?)
}

#[command]
pub fn set_extension_secret(
   app_handle: AppHandle,
   extension_id: String,
   key: String,
   value: String,
) -> Result<(), String> {
   store_secret(
      &app_handle,
      &extension_secret_key(&extension_id, &key)?,
      &value,
   )
}

#[command]
pub fn delete_extension_secret(
   app_handle: AppHandle,
   extension_id: String,
   key: String,
) -> Result<(), String> {
   remove_secret(&app_handle, &extension_secret_key(&extension_id, &key)?)
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::path::Path;

   #[test]
   fn extension_secret_keys_are_scoped_and_validated() {
      assert_eq!(
         extension_secret_key("athas.gitlab", "token").unwrap(),
         "extension:athas.gitlab:token"
      );
      assert!(extension_secret_key("athas.gitlab", "../token").is_err());
   }

   #[test]
   fn extension_entrypoints_must_be_relative_files() {
      assert!(validate_extension_entrypoint("main.js").is_ok());
      assert!(validate_extension_entrypoint("dist/main.js").is_ok());
      assert!(validate_extension_entrypoint("../main.js").is_err());
      assert!(validate_extension_entrypoint("/tmp/main.js").is_err());
   }

   #[test]
   fn test_get_bundled_extensions_path_ends_with_bundled() {
      // Create a mock Tauri app for testing
      let app = tauri::test::mock_app();
      let app_handle = app.handle().clone();

      // Call the function
      let result = get_bundled_extensions_path(app_handle);

      // Verify it succeeds and the path ends with "bundled"
      assert!(result.is_ok(), "get_bundled_extensions_path should succeed");
      let path = result.unwrap();
      let path = Path::new(&path);

      // The path must end with "bundled", not "_up_/src/extensions/bundled"
      // This verifies the fix for issue #475 where Linux builds had wrong paths
      assert!(
         path.ends_with("bundled"),
         "Path should end with 'bundled', got: {:?}",
         path
      );

      // Verify the path doesn't contain "_up_" which indicates incorrect Tauri resource bundling
      assert!(
         !path.to_string_lossy().contains("_up_"),
         "Path should not contain '_up_' (incorrect bundling), got: {:?}",
         path
      );
   }

   #[test]
   fn test_get_bundled_extensions_path_is_absolute_in_debug() {
      let app = tauri::test::mock_app();
      let app_handle = app.handle().clone();

      let result = get_bundled_extensions_path(app_handle);
      assert!(result.is_ok());

      let path_str = result.unwrap();
      let path = Path::new(&path_str);

      // In debug mode, the path should be constructed from current_dir
      // and should be an absolute path
      assert!(
         path.is_absolute(),
         "Path should be absolute in debug mode, got: {:?}",
         path
      );
   }

   #[test]
   fn test_get_bundled_extensions_path_contains_expected_structure() {
      let app = tauri::test::mock_app();
      let app_handle = app.handle().clone();

      let result = get_bundled_extensions_path(app_handle);
      assert!(result.is_ok());

      let path_str = result.unwrap();

      // In debug mode, path should contain src/extensions/bundled
      // This is the development path structure
      assert!(
         path_str.contains("src")
            && path_str.contains("extensions")
            && path_str.ends_with("bundled"),
         "Debug path should have structure .../src/extensions/bundled, got: {}",
         path_str
      );
   }

   #[test]
   fn test_validate_extension_download_url_rejects_unsafe_schemes() {
      assert!(validate_extension_download_url("file:///tmp/evil.tar.gz").is_err());
      assert!(validate_extension_download_url("javascript:alert(1)").is_err());
      assert!(validate_extension_download_url("ftp://example.com/ext.tar.gz").is_err());
   }

   #[test]
   fn test_validate_extension_download_url_accepts_expected_hosts() {
      assert!(validate_extension_download_url("https://athas.dev/extensions/test.tar.gz").is_ok());
      assert!(
         validate_extension_download_url("https://cdn.athas.dev/extensions/test.tar.gz").is_ok()
      );

      if cfg!(debug_assertions) {
         assert!(validate_extension_download_url("http://localhost:3000/test.tar.gz").is_ok());
      }
   }

   #[test]
   fn test_is_allowed_extension_host_rejects_suffix_spoofing() {
      assert!(is_allowed_extension_host("athas.dev"));
      assert!(is_allowed_extension_host("cdn.athas.dev"));
      assert!(is_allowed_extension_host("a.b.athas.dev"));
      // Suffix-match spoofing attempts must be rejected.
      assert!(!is_allowed_extension_host("evilathas.dev"));
      assert!(!is_allowed_extension_host("athas.dev.attacker.example"));
      assert!(!is_allowed_extension_host("not-athas.dev"));
      assert!(!is_allowed_extension_host(""));
   }
}
