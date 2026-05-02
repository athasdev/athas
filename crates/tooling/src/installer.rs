use crate::{ToolConfig, ToolError, ToolRuntime, platform, runtime::AthasAppHandle as AppHandle};
use athas_runtime::{RuntimeManager, RuntimeType, process::configure_background_command};
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use serde_json::Value;
use std::{
   fs,
   io::Cursor,
   path::{Component, Path, PathBuf},
   process::Command,
};
use tauri::Manager;
use url::Url;
use walkdir::WalkDir;
use xz2::read::XzDecoder;
use zip::ZipArchive;

/// Maximum size for a managed binary tool download. Most single-file tools are
/// small, but SDK-backed language servers such as Dart include runtime assets.
const MAX_BINARY_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;

/// Validate that a binary download URL uses an acceptable scheme and host.
///
/// Release builds require HTTPS. Debug builds additionally permit `http://`
/// to `localhost` and `127.0.0.1` for local fixtures and tests.
fn validate_binary_download_url(input: &str) -> Result<(), ToolError> {
   let parsed = Url::parse(input)
      .map_err(|_| ToolError::DownloadFailed(format!("Invalid download URL: {}", input)))?;
   let host = parsed.host_str().unwrap_or_default();
   match parsed.scheme() {
      "https" => Ok(()),
      "http" if cfg!(debug_assertions) && (host == "localhost" || host == "127.0.0.1") => Ok(()),
      other => Err(ToolError::DownloadFailed(format!(
         "Tool download URL must use HTTPS (got scheme {:?})",
         other
      ))),
   }
}

/// Handles installation of language tools
pub struct ToolInstaller;

impl ToolInstaller {
   fn get_runtime_root(app_handle: &AppHandle) -> Result<PathBuf, ToolError> {
      app_handle
         .path()
         .app_data_dir()
         .map(|dir| dir.join("runtimes"))
         .map_err(|e| ToolError::ConfigError(e.to_string()))
   }

   fn configured_command_name(config: &ToolConfig) -> &str {
      config.command.as_deref().unwrap_or(&config.name)
   }

   fn default_node_bin_name(name: &str) -> String {
      if cfg!(windows) {
         format!("{}.cmd", name)
      } else {
         name.to_string()
      }
   }

   fn node_bin_names(name: &str) -> Vec<String> {
      if cfg!(windows) {
         vec![
            format!("{}.cmd", name),
            format!("{}.exe", name),
            format!("{}.ps1", name),
            name.to_string(),
         ]
      } else {
         vec![name.to_string()]
      }
   }

   fn script_bin_name(name: &str) -> String {
      if cfg!(windows) {
         format!("{}.cmd", name)
      } else {
         name.to_string()
      }
   }

   fn bin_file_name(name: &str) -> String {
      if cfg!(windows) {
         format!("{}.exe", name)
      } else {
         name.to_string()
      }
   }

   fn ensure_node_package_manifest(package_dir: &Path) -> Result<(), ToolError> {
      let package_json = package_dir.join("package.json");
      if package_json.exists() {
         return Ok(());
      }

      fs::write(
         package_json,
         "{\n  \"private\": true,\n  \"dependencies\": {}\n}\n",
      )?;
      Ok(())
   }

   fn resolve_node_bin_shim(package_dir: &Path, command_name: &str) -> Option<PathBuf> {
      let bin_dir = package_dir.join("node_modules").join(".bin");
      Self::node_bin_names(command_name)
         .into_iter()
         .map(|name| bin_dir.join(name))
         .find(|path| path.exists())
   }

   fn safe_package_bin_path(package_root: &Path, bin_path: &str) -> Option<PathBuf> {
      let relative_path = Path::new(bin_path);
      if relative_path.is_absolute()
         || relative_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
      {
         return None;
      }

      Some(package_root.join(relative_path))
   }

   fn resolve_node_package_entrypoint_from_root(
      package_root: &Path,
      command_name: &str,
      allow_first_bin_fallback: bool,
   ) -> Option<PathBuf> {
      let package_json = package_root.join("package.json");
      let package_json_content = fs::read_to_string(package_json).ok()?;
      let package_json_value: Value = serde_json::from_str(&package_json_content).ok()?;
      let bin_field = package_json_value.get("bin")?;

      if let Some(single_bin) = bin_field.as_str() {
         return Self::safe_package_bin_path(package_root, single_bin);
      }

      let bins = bin_field.as_object()?;
      if let Some(command_bin) = bins.get(command_name).and_then(|value| value.as_str()) {
         return Self::safe_package_bin_path(package_root, command_bin);
      }

      if !allow_first_bin_fallback {
         return None;
      }

      bins
         .values()
         .next()
         .and_then(|value| value.as_str())
         .and_then(|first_bin| Self::safe_package_bin_path(package_root, first_bin))
   }

   fn resolve_node_package_entrypoint(
      package_dir: &Path,
      package: &str,
      command_name: &str,
   ) -> Option<PathBuf> {
      let package_root = package_dir.join("node_modules").join(package);
      Self::resolve_node_package_entrypoint_from_root(&package_root, command_name, true)
         .filter(|path| path.exists())
   }

   fn resolve_node_package_binary(
      package_dir: &Path,
      package: &str,
      command_name: &str,
   ) -> Option<PathBuf> {
      if let Some(path) = Self::resolve_node_bin_shim(package_dir, command_name) {
         return Some(path);
      }

      if let Some(path) = Self::resolve_node_package_entrypoint(package_dir, package, command_name)
      {
         return Some(path);
      }

      let node_modules_dir = package_dir.join("node_modules");
      for entry in WalkDir::new(&node_modules_dir)
         .max_depth(3)
         .into_iter()
         .filter_map(|entry| entry.ok())
         .filter(|entry| {
            entry.file_type().is_file()
               && entry.file_name().to_str() == Some("package.json")
               && !entry
                  .path()
                  .components()
                  .any(|component| matches!(component, Component::Normal(name) if name == ".bin"))
         })
      {
         let Some(package_root) = entry.path().parent() else {
            continue;
         };

         if let Some(path) =
            Self::resolve_node_package_entrypoint_from_root(package_root, command_name, false)
            && path.exists()
         {
            return Some(path);
         }
      }

      None
   }

   #[cfg(unix)]
   fn ensure_executable(path: &Path) -> Result<(), ToolError> {
      use std::os::unix::fs::PermissionsExt;
      fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
      Ok(())
   }

   #[cfg(not(unix))]
   fn ensure_executable(path: &Path) -> Result<(), ToolError> {
      let _ = path;
      Ok(())
   }

   /// Validate that a binary exists at the given path and ensure it is executable.
   fn validate_and_prepare(path: &Path) -> Result<PathBuf, ToolError> {
      if !path.exists() {
         return Err(ToolError::InstallationFailed(format!(
            "Binary not found at {:?} after installation",
            path
         )));
      }
      Self::ensure_executable(path)?;
      Ok(path.to_path_buf())
   }

   fn validate_existing_binary(path: &Path, config: &ToolConfig) -> Result<(), ToolError> {
      if path.exists() && matches!(config.runtime, ToolRuntime::Binary) {
         platform::validate_downloaded_binary(path, &config.name)
            .map_err(ToolError::InstallationFailed)?;
      }

      Ok(())
   }

   fn copy_dir_all(source: &Path, target: &Path) -> Result<(), ToolError> {
      fs::create_dir_all(target)?;

      for entry in fs::read_dir(source)? {
         let entry = entry?;
         let source_path = entry.path();
         let target_path = target.join(entry.file_name());

         if entry.file_type()?.is_dir() {
            Self::copy_dir_all(&source_path, &target_path)?;
         } else {
            if let Some(parent) = target_path.parent() {
               fs::create_dir_all(parent)?;
            }
            fs::copy(&source_path, &target_path).map_err(|e| {
               ToolError::InstallationFailed(format!(
                  "Failed to copy tool file from {:?} to {:?}: {}",
                  source_path, target_path, e
               ))
            })?;
         }
      }

      Ok(())
   }

   fn extract_archive(bytes: &[u8], url: &str, target_dir: &Path) -> Result<(), ToolError> {
      if url.ends_with(".tar.xz") || url.ends_with(".txz") {
         let decoder = XzDecoder::new(Cursor::new(bytes));
         let mut archive = tar::Archive::new(decoder);
         let entries = archive.entries().map_err(|e| {
            ToolError::InstallationFailed(format!("Failed to read tar.xz entries: {}", e))
         })?;
         for entry in entries {
            let mut entry = entry.map_err(|e| {
               ToolError::InstallationFailed(format!("Failed to read tar.xz entry: {}", e))
            })?;
            let unpacked = entry.unpack_in(target_dir).map_err(|e| {
               ToolError::InstallationFailed(format!("Failed to unpack tar.xz entry: {}", e))
            })?;
            if !unpacked {
               return Err(ToolError::InstallationFailed(
                  "Rejected archive entry with invalid path".to_string(),
               ));
            }
         }
         return Ok(());
      }

      if url.ends_with(".tar.gz") || url.ends_with(".tgz") {
         let decoder = GzDecoder::new(Cursor::new(bytes));
         let mut archive = tar::Archive::new(decoder);
         let entries = archive.entries().map_err(|e| {
            ToolError::InstallationFailed(format!("Failed to read tar.gz entries: {}", e))
         })?;
         for entry in entries {
            let mut entry = entry.map_err(|e| {
               ToolError::InstallationFailed(format!("Failed to read tar.gz entry: {}", e))
            })?;
            let unpacked = entry.unpack_in(target_dir).map_err(|e| {
               ToolError::InstallationFailed(format!("Failed to unpack tar.gz entry: {}", e))
            })?;
            if !unpacked {
               return Err(ToolError::InstallationFailed(
                  "Rejected archive entry with invalid path".to_string(),
               ));
            }
         }
         return Ok(());
      }

      if url.ends_with(".zip") {
         let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| {
            ToolError::InstallationFailed(format!("Failed to read zip archive: {}", e))
         })?;

         for index in 0..archive.len() {
            let mut file = archive.by_index(index).map_err(|e| {
               ToolError::InstallationFailed(format!("Failed to read zip entry: {}", e))
            })?;

            let Some(relative_path) = file.enclosed_name().map(|p| p.to_path_buf()) else {
               continue;
            };

            let output_path = target_dir.join(relative_path);

            if file.name().ends_with('/') {
               fs::create_dir_all(&output_path)?;
               continue;
            }

            if let Some(parent) = output_path.parent() {
               fs::create_dir_all(parent)?;
            }

            let mut output_file = fs::File::create(&output_path)?;
            std::io::copy(&mut file, &mut output_file)?;
         }

         return Ok(());
      }

      if url.ends_with(".gz") {
         let mut decoder = GzDecoder::new(Cursor::new(bytes));
         let output_path = target_dir.join("downloaded-binary");
         let mut output_file = fs::File::create(output_path)?;
         std::io::copy(&mut decoder, &mut output_file)?;
         return Ok(());
      }

      fs::write(target_dir.join("downloaded-binary"), bytes)?;
      Ok(())
   }

   fn pick_binary(staging_dir: &Path, command_name: &str) -> Result<PathBuf, ToolError> {
      let expected_name = Self::bin_file_name(command_name);
      let mut prefix_matches: Vec<PathBuf> = Vec::new();
      let mut fallback_files: Vec<PathBuf> = Vec::new();

      for entry in WalkDir::new(staging_dir)
         .into_iter()
         .filter_map(|entry| entry.ok())
         .filter(|entry| entry.file_type().is_file())
      {
         let path = entry.into_path();
         let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();

         if file_name.eq_ignore_ascii_case(&expected_name)
            || (!cfg!(windows) && file_name.eq_ignore_ascii_case(command_name))
         {
            return Ok(path);
         }

         if file_name
            .to_ascii_lowercase()
            .starts_with(&command_name.to_ascii_lowercase())
         {
            prefix_matches.push(path.clone());
         }

         fallback_files.push(path);
      }

      if let Some(path) = prefix_matches.into_iter().next() {
         return Ok(path);
      }

      fallback_files.into_iter().next().ok_or_else(|| {
         ToolError::InstallationFailed("No binary found in downloaded archive".to_string())
      })
   }

   fn binary_install_dir(app_handle: &AppHandle, name: &str) -> Result<PathBuf, ToolError> {
      Ok(Self::get_tools_dir(app_handle)?.join("binary").join(name))
   }

   fn install_extracted_binary(
      staging_dir: &Path,
      install_dir: &Path,
      name: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let source_binary = Self::pick_binary(staging_dir, command_name)?;
      platform::validate_downloaded_binary(&source_binary, name)
         .map_err(ToolError::InstallationFailed)?;

      let relative_binary = source_binary.strip_prefix(staging_dir).map_err(|e| {
         ToolError::InstallationFailed(format!(
            "Failed to resolve downloaded binary path {:?}: {}",
            source_binary, e
         ))
      })?;

      if install_dir.exists() {
         fs::remove_dir_all(install_dir)?;
      }
      fs::create_dir_all(install_dir)?;

      let installed_binary = if relative_binary == Path::new("downloaded-binary") {
         let bin_path = install_dir.join(Self::bin_file_name(command_name));
         fs::copy(&source_binary, &bin_path).map_err(|e| {
            ToolError::InstallationFailed(format!(
               "Failed to copy binary from {:?} to {:?}: {}",
               source_binary, bin_path, e
            ))
         })?;
         bin_path
      } else {
         Self::copy_dir_all(staging_dir, install_dir)?;
         install_dir.join(relative_binary)
      };

      Self::ensure_executable(&installed_binary)?;
      Ok(installed_binary)
   }

   /// Install a tool based on its configuration
   pub async fn install(app_handle: &AppHandle, config: &ToolConfig) -> Result<PathBuf, ToolError> {
      match config.runtime {
         ToolRuntime::Bun => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_bun(app_handle, package, Self::configured_command_name(config)).await
         }
         ToolRuntime::Node => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_npm(app_handle, package, Self::configured_command_name(config)).await
         }
         ToolRuntime::Python => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_pip(app_handle, package, Self::configured_command_name(config)).await
         }
         ToolRuntime::Go => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_go(app_handle, package, Self::configured_command_name(config)).await
         }
         ToolRuntime::Rust => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_cargo(app_handle, package, Self::configured_command_name(config))
               .await
         }
         ToolRuntime::Ruby => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_gem(app_handle, package, Self::configured_command_name(config)).await
         }
         ToolRuntime::Binary => {
            if let Some(url) = config.download_url.as_ref() {
               Self::download_binary(
                  app_handle,
                  &config.name,
                  Self::configured_command_name(config),
                  url,
               )
               .await
            } else {
               let command_name = Self::configured_command_name(config);
               which::which(command_name).map_err(|_| {
                  ToolError::NotFound(format!(
                     "{} (not found on PATH and no download URL configured)",
                     command_name
                  ))
               })
            }
         }
      }
   }

   /// Get the installation directory for tools
   pub fn get_tools_dir(app_handle: &AppHandle) -> Result<PathBuf, ToolError> {
      let data_dir = app_handle
         .path()
         .app_data_dir()
         .map_err(|e| ToolError::ConfigError(e.to_string()))?;
      Ok(data_dir.join("tools"))
   }

   /// Install a package via Bun (global)
   async fn install_via_bun(
      app_handle: &AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let runtime_root = Self::get_runtime_root(app_handle)?;
      let bun_path = RuntimeManager::get_runtime(Some(&runtime_root), RuntimeType::Bun)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let package_dir = tools_dir.join("bun").join(package);
      std::fs::create_dir_all(&package_dir)?;
      Self::ensure_node_package_manifest(&package_dir)?;

      log::info!("Installing {} via Bun to {:?}", package, package_dir);

      let mut command = Command::new(&bun_path);
      let output = configure_background_command(&mut command)
         .args(["add", package])
         .current_dir(&package_dir)
         .output()
         .map_err(|e| ToolError::InstallationFailed(e.to_string()))?;

      if !output.status.success() {
         let stderr = String::from_utf8_lossy(&output.stderr);
         return Err(ToolError::InstallationFailed(format!(
            "Bun install failed: {}",
            stderr
         )));
      }

      if let Some(binary_path) =
         Self::resolve_node_package_binary(&package_dir, package, command_name)
      {
         return Self::validate_and_prepare(&binary_path);
      }

      Err(ToolError::InstallationFailed(format!(
         "Binary '{}' not found after installing package '{}' via Bun",
         command_name, package
      )))
   }

   /// Install a package via npm (global)
   async fn install_via_npm(
      app_handle: &AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let runtime_root = Self::get_runtime_root(app_handle)?;
      let node_path = RuntimeManager::get_runtime(Some(&runtime_root), RuntimeType::Node)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let package_dir = tools_dir.join("npm").join(package);
      std::fs::create_dir_all(&package_dir)?;
      Self::ensure_node_package_manifest(&package_dir)?;

      // Get npm path (should be alongside node)
      let npm_path = node_path
         .parent()
         .map(|p| p.join("npm"))
         .unwrap_or_else(|| which::which("npm").unwrap_or_else(|_| PathBuf::from("npm")));

      log::info!("Installing {} via npm to {:?}", package, package_dir);

      let mut command = Command::new(&npm_path);
      let output = configure_background_command(&mut command)
         .args(["install", package])
         .current_dir(&package_dir)
         .output()
         .map_err(|e| ToolError::InstallationFailed(e.to_string()))?;

      if !output.status.success() {
         let stderr = String::from_utf8_lossy(&output.stderr);
         return Err(ToolError::InstallationFailed(format!(
            "npm install failed: {}",
            stderr
         )));
      }

      if let Some(binary_path) =
         Self::resolve_node_package_binary(&package_dir, package, command_name)
      {
         return Self::validate_and_prepare(&binary_path);
      }

      Err(ToolError::InstallationFailed(format!(
         "Binary '{}' not found after installing package '{}' via npm",
         command_name, package
      )))
   }

   /// Install a package via pip (user)
   async fn install_via_pip(
      app_handle: &AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let runtime_root = Self::get_runtime_root(app_handle)?;
      let python_path = RuntimeManager::get_runtime(Some(&runtime_root), RuntimeType::Python)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let venv_dir = tools_dir.join("python").join(package);
      std::fs::create_dir_all(&venv_dir)?;

      log::info!(
         "Installing {} via pip in virtual environment at {:?}",
         package,
         venv_dir
      );

      // Create virtual environment
      let mut command = Command::new(&python_path);
      let output = configure_background_command(&mut command)
         .args(["-m", "venv", venv_dir.to_string_lossy().as_ref()])
         .output()
         .map_err(|e| ToolError::InstallationFailed(e.to_string()))?;

      if !output.status.success() {
         let stderr = String::from_utf8_lossy(&output.stderr);
         return Err(ToolError::InstallationFailed(format!(
            "Failed to create venv: {}",
            stderr
         )));
      }

      // Install package in venv
      let pip_path = if cfg!(windows) {
         venv_dir.join("Scripts").join("pip.exe")
      } else {
         venv_dir.join("bin").join("pip")
      };

      let mut command = Command::new(&pip_path);
      let output = configure_background_command(&mut command)
         .args(["install", package])
         .output()
         .map_err(|e| ToolError::InstallationFailed(e.to_string()))?;

      if !output.status.success() {
         let stderr = String::from_utf8_lossy(&output.stderr);
         return Err(ToolError::InstallationFailed(format!(
            "pip install failed: {}",
            stderr
         )));
      }

      // Return binary path
      let bin_path = if cfg!(windows) {
         venv_dir
            .join("Scripts")
            .join(Self::bin_file_name(command_name))
      } else {
         venv_dir.join("bin").join(command_name)
      };

      Self::validate_and_prepare(&bin_path)
   }

   /// Install a package via go install
   async fn install_via_go(
      app_handle: &AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let runtime_root = Self::get_runtime_root(app_handle)?;
      let go_path = RuntimeManager::get_runtime(Some(&runtime_root), RuntimeType::Go)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let gopath = tools_dir.join("go");
      std::fs::create_dir_all(&gopath)?;

      log::info!("Installing {} via go install", package);

      let mut command = Command::new(&go_path);
      let output = configure_background_command(&mut command)
         .args(["install", &format!("{}@latest", package)])
         .env("GOPATH", &gopath)
         .output()
         .map_err(|e| ToolError::InstallationFailed(e.to_string()))?;

      if !output.status.success() {
         let stderr = String::from_utf8_lossy(&output.stderr);
         return Err(ToolError::InstallationFailed(format!(
            "go install failed: {}",
            stderr
         )));
      }

      let bin_path = if cfg!(windows) {
         gopath.join("bin").join(Self::bin_file_name(command_name))
      } else {
         gopath.join("bin").join(command_name)
      };

      Self::validate_and_prepare(&bin_path)
   }

   /// Install a package via cargo install
   async fn install_via_cargo(
      app_handle: &AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let runtime_root = Self::get_runtime_root(app_handle)?;
      let cargo_path = RuntimeManager::get_runtime(Some(&runtime_root), RuntimeType::Rust)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let cargo_home = tools_dir.join("cargo");
      std::fs::create_dir_all(&cargo_home)?;

      log::info!("Installing {} via cargo install", package);

      let mut command = Command::new(&cargo_path);
      let output = configure_background_command(&mut command)
         .args(["install", package])
         .env("CARGO_HOME", &cargo_home)
         .output()
         .map_err(|e| ToolError::InstallationFailed(e.to_string()))?;

      if !output.status.success() {
         let stderr = String::from_utf8_lossy(&output.stderr);
         return Err(ToolError::InstallationFailed(format!(
            "cargo install failed: {}",
            stderr
         )));
      }

      let bin_path = if cfg!(windows) {
         cargo_home
            .join("bin")
            .join(Self::bin_file_name(command_name))
      } else {
         cargo_home.join("bin").join(command_name)
      };

      Self::validate_and_prepare(&bin_path)
   }

   fn ruby_wrapper_path(package_dir: &Path, command_name: &str) -> PathBuf {
      package_dir
         .join("bin")
         .join(Self::script_bin_name(command_name))
   }

   #[cfg(windows)]
   fn batch_escape_path(path: &Path) -> String {
      path.to_string_lossy().replace('%', "%%")
   }

   #[cfg(not(windows))]
   fn shell_quote_path(path: &Path) -> String {
      let escaped = path.to_string_lossy().replace('\'', "'\"'\"'");
      format!("'{escaped}'")
   }

   fn write_ruby_wrapper(
      package_dir: &Path,
      command_name: &str,
      gem_home: &Path,
      gem_bin_dir: &Path,
   ) -> Result<PathBuf, ToolError> {
      let wrapper_path = Self::ruby_wrapper_path(package_dir, command_name);
      if let Some(parent) = wrapper_path.parent() {
         fs::create_dir_all(parent)?;
      }

      #[cfg(windows)]
      {
         let gem_command = gem_bin_dir.join(format!("{}.bat", command_name));
         if !gem_command.exists() {
            return Err(ToolError::InstallationFailed(format!(
               "gem install did not create expected executable: {}",
               gem_command.display()
            )));
         }
         fs::write(
            &wrapper_path,
            format!(
               "@echo off\r\nset \"GEM_HOME={}\"\r\nset \"GEM_PATH={}\"\r\ncall \"{}\" %*\r\n",
               Self::batch_escape_path(gem_home),
               Self::batch_escape_path(gem_home),
               Self::batch_escape_path(&gem_command)
            ),
         )?;
      }

      #[cfg(not(windows))]
      {
         let gem_command = gem_bin_dir.join(command_name);
         if !gem_command.exists() {
            return Err(ToolError::InstallationFailed(format!(
               "gem install did not create expected executable: {}",
               gem_command.display()
            )));
         }
         fs::write(
            &wrapper_path,
            format!(
               "#!/bin/sh\nexport GEM_HOME={}\nexport GEM_PATH={}\nexec {} \"$@\"\n",
               Self::shell_quote_path(gem_home),
               Self::shell_quote_path(gem_home),
               Self::shell_quote_path(&gem_command)
            ),
         )?;
      }

      Self::validate_and_prepare(&wrapper_path)
   }

   /// Install a package via RubyGems into an Athas-managed GEM_HOME.
   async fn install_via_gem(
      app_handle: &AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let gem_path = which::which("gem").map_err(|_| {
         ToolError::RuntimeNotAvailable(
            "RubyGems 'gem' was not found. Install Ruby to use Ruby language tools.".to_string(),
         )
      })?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let package_dir = tools_dir.join("ruby").join(package);
      let gem_home = package_dir.join("gems");
      let gem_bin_dir = package_dir.join("gem-bin");
      std::fs::create_dir_all(&gem_home)?;
      std::fs::create_dir_all(&gem_bin_dir)?;

      log::info!("Installing {} via RubyGems to {:?}", package, gem_home);

      let mut command = Command::new(&gem_path);
      let output = configure_background_command(&mut command)
         .args([
            "install",
            package,
            "--install-dir",
            gem_home.to_string_lossy().as_ref(),
            "--bindir",
            gem_bin_dir.to_string_lossy().as_ref(),
            "--no-document",
         ])
         .env("GEM_HOME", &gem_home)
         .env("GEM_PATH", &gem_home)
         .output()
         .map_err(|e| ToolError::InstallationFailed(e.to_string()))?;

      if !output.status.success() {
         let stderr = String::from_utf8_lossy(&output.stderr);
         return Err(ToolError::InstallationFailed(format!(
            "gem install failed: {}",
            stderr
         )));
      }

      Self::write_ruby_wrapper(&package_dir, command_name, &gem_home, &gem_bin_dir)
   }

   /// Download a binary directly.
   ///
   /// Enforces:
   /// - HTTPS-only URLs (localhost HTTP permitted in debug builds only).
   /// - A 100 MB streaming size cap, independently of any `Content-Length`.
   /// - Successful HTTP status.
   async fn download_binary(
      app_handle: &AppHandle,
      name: &str,
      command_name: &str,
      url: &str,
   ) -> Result<PathBuf, ToolError> {
      validate_binary_download_url(url)?;

      let install_dir = Self::binary_install_dir(app_handle, name)?;

      log::info!("Downloading {} from {}", name, url);

      let response = reqwest::get(url)
         .await
         .map_err(|e| ToolError::DownloadFailed(e.to_string()))?;

      if !response.status().is_success() {
         return Err(ToolError::DownloadFailed(format!(
            "HTTP {} for {}",
            response.status(),
            url
         )));
      }

      if let Some(content_length) = response.content_length()
         && content_length > MAX_BINARY_DOWNLOAD_BYTES
      {
         return Err(ToolError::DownloadFailed(format!(
            "Tool download too large: {} bytes (max {})",
            content_length, MAX_BINARY_DOWNLOAD_BYTES
         )));
      }

      let mut stream = response.bytes_stream();
      let mut bytes: Vec<u8> = Vec::new();
      while let Some(chunk) = stream.next().await {
         let chunk = chunk.map_err(|e| ToolError::DownloadFailed(e.to_string()))?;
         if bytes.len() as u64 + chunk.len() as u64 > MAX_BINARY_DOWNLOAD_BYTES {
            return Err(ToolError::DownloadFailed(format!(
               "Tool download exceeded size cap of {} bytes",
               MAX_BINARY_DOWNLOAD_BYTES
            )));
         }
         bytes.extend_from_slice(&chunk);
      }

      let staging_dir = tempfile::tempdir()
         .map_err(|e| ToolError::InstallationFailed(format!("Failed to create temp dir: {}", e)))?;
      Self::extract_archive(&bytes, url, staging_dir.path())?;
      Self::install_extracted_binary(staging_dir.path(), &install_dir, name, command_name)
   }

   /// Check if a tool is installed
   pub fn is_installed(app_handle: &AppHandle, config: &ToolConfig) -> Result<bool, ToolError> {
      let path = Self::get_tool_path(app_handle, config)?;
      if !path.exists() {
         return Ok(false);
      }

      Self::validate_existing_binary(&path, config)?;
      Ok(true)
   }

   /// Get the path where a tool would be/is installed
   pub fn get_tool_path(app_handle: &AppHandle, config: &ToolConfig) -> Result<PathBuf, ToolError> {
      let tools_dir = Self::get_tools_dir(app_handle)?;

      match config.runtime {
         ToolRuntime::Bun => {
            let command_name = Self::configured_command_name(config);
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let package_dir = tools_dir.join("bun").join(package);
            Ok(
               Self::resolve_node_package_binary(&package_dir, package, command_name)
                  .unwrap_or_else(|| {
                     package_dir
                        .join("node_modules")
                        .join(".bin")
                        .join(Self::default_node_bin_name(command_name))
                  }),
            )
         }
         ToolRuntime::Node => {
            let command_name = Self::configured_command_name(config);
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let package_dir = tools_dir.join("npm").join(package);
            Ok(
               Self::resolve_node_package_binary(&package_dir, package, command_name)
                  .unwrap_or_else(|| {
                     package_dir
                        .join("node_modules")
                        .join(".bin")
                        .join(Self::default_node_bin_name(command_name))
                  }),
            )
         }
         ToolRuntime::Python => {
            let bin_name = Self::bin_file_name(Self::configured_command_name(config));
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let scripts_dir = if cfg!(windows) { "Scripts" } else { "bin" };
            Ok(tools_dir
               .join("python")
               .join(package)
               .join(scripts_dir)
               .join(bin_name))
         }
         ToolRuntime::Go => {
            let bin_name = Self::bin_file_name(Self::configured_command_name(config));
            Ok(tools_dir.join("go").join("bin").join(bin_name))
         }
         ToolRuntime::Rust => {
            let bin_name = Self::bin_file_name(Self::configured_command_name(config));
            Ok(tools_dir.join("cargo").join("bin").join(bin_name))
         }
         ToolRuntime::Ruby => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Ok(Self::ruby_wrapper_path(
               &tools_dir.join("ruby").join(package),
               Self::configured_command_name(config),
            ))
         }
         ToolRuntime::Binary => {
            let command_name = Self::configured_command_name(config);
            let bin_name = Self::bin_file_name(command_name);
            if config.download_url.is_none()
               && let Ok(system_path) = which::which(command_name)
            {
               Self::validate_existing_binary(&system_path, config)?;
               return Ok(system_path);
            }

            let install_dir = tools_dir.join("binary").join(&config.name);
            if install_dir.exists()
               && let Ok(path) = Self::pick_binary(&install_dir, command_name)
            {
               Self::validate_existing_binary(&path, config)?;
               return Ok(path);
            }

            let legacy_path = tools_dir.join("bin").join(bin_name);
            Self::validate_existing_binary(&legacy_path, config)?;
            Ok(legacy_path)
         }
      }
   }

   /// Get the preferred launch path for LSP servers.
   /// For Node/Bun tools, this returns the package bin entrypoint (e.g. .js/.mjs)
   /// so the LSP client can run it with managed Node runtime.
   pub fn get_lsp_launch_path(
      app_handle: &AppHandle,
      config: &ToolConfig,
   ) -> Result<PathBuf, ToolError> {
      let tools_dir = Self::get_tools_dir(app_handle)?;

      match config.runtime {
         ToolRuntime::Bun => {
            let command_name = Self::configured_command_name(config);
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let package_dir = tools_dir.join("bun").join(package);

            if let Some(entrypoint) =
               Self::resolve_node_package_entrypoint(&package_dir, package, command_name)
            {
               return Ok(entrypoint);
            }

            Ok(
               Self::resolve_node_bin_shim(&package_dir, command_name).unwrap_or_else(|| {
                  package_dir
                     .join("node_modules")
                     .join(".bin")
                     .join(Self::default_node_bin_name(command_name))
               }),
            )
         }
         ToolRuntime::Node => {
            let command_name = Self::configured_command_name(config);
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let package_dir = tools_dir.join("npm").join(package);

            if let Some(entrypoint) =
               Self::resolve_node_package_entrypoint(&package_dir, package, command_name)
            {
               return Ok(entrypoint);
            }

            Ok(
               Self::resolve_node_bin_shim(&package_dir, command_name).unwrap_or_else(|| {
                  package_dir
                     .join("node_modules")
                     .join(".bin")
                     .join(Self::default_node_bin_name(command_name))
               }),
            )
         }
         _ => Self::get_tool_path(app_handle, config),
      }
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn rejects_non_https_binary_urls() {
      assert!(validate_binary_download_url("ftp://example.com/tool.tar.gz").is_err());
      assert!(validate_binary_download_url("file:///etc/passwd").is_err());
      assert!(validate_binary_download_url("javascript:alert(1)").is_err());
      assert!(validate_binary_download_url("not a url").is_err());
   }

   #[test]
   fn rejects_plain_http_in_release_builds() {
      let result = validate_binary_download_url("http://example.com/tool.tar.gz");
      if cfg!(debug_assertions) {
         // Debug builds reject non-localhost HTTP.
         assert!(result.is_err());
      } else {
         assert!(result.is_err());
      }
   }

   #[test]
   fn accepts_https_and_debug_localhost() {
      assert!(validate_binary_download_url("https://example.com/tool.tar.gz").is_ok());
      if cfg!(debug_assertions) {
         assert!(validate_binary_download_url("http://localhost:3000/tool.tar.gz").is_ok());
         assert!(validate_binary_download_url("http://127.0.0.1:8080/tool.tar.gz").is_ok());
      }
   }

   #[test]
   fn creates_node_package_manifest_to_anchor_local_installs() {
      let temp = tempfile::tempdir().unwrap();
      let package_dir = temp.path().join("bun").join("typescript-language-server");
      fs::create_dir_all(&package_dir).unwrap();

      ToolInstaller::ensure_node_package_manifest(&package_dir).unwrap();

      let package_json = package_dir.join("package.json");
      let manifest = fs::read_to_string(package_json).unwrap();
      assert!(manifest.contains("\"private\": true"));
      assert!(manifest.contains("\"dependencies\": {}"));
   }

   #[test]
   fn preserves_existing_node_package_manifest() {
      let temp = tempfile::tempdir().unwrap();
      let package_dir = temp.path().join("npm").join("eslint");
      fs::create_dir_all(&package_dir).unwrap();
      let package_json = package_dir.join("package.json");
      fs::write(
         &package_json,
         "{ \"private\": true, \"dependencies\": { \"eslint\": \"*\" } }",
      )
      .unwrap();

      ToolInstaller::ensure_node_package_manifest(&package_dir).unwrap();

      let manifest = fs::read_to_string(package_json).unwrap();
      assert!(manifest.contains("\"eslint\": \"*\""));
   }

   #[test]
   fn resolves_node_bin_shim_when_present() {
      let temp = tempfile::tempdir().unwrap();
      let package_dir = temp.path().join("bun").join("typescript-language-server");
      let bin_path =
         package_dir
            .join("node_modules")
            .join(".bin")
            .join(ToolInstaller::default_node_bin_name(
               "typescript-language-server",
            ));
      fs::create_dir_all(bin_path.parent().unwrap()).unwrap();
      fs::write(&bin_path, "").unwrap();

      let resolved = ToolInstaller::resolve_node_package_binary(
         &package_dir,
         "typescript-language-server",
         "typescript-language-server",
      );

      assert_eq!(resolved.as_deref(), Some(bin_path.as_path()));
   }

   #[test]
   fn resolves_scoped_node_package_entrypoint_when_shim_is_missing() {
      let temp = tempfile::tempdir().unwrap();
      let package_dir = temp.path().join("bun").join("@vue").join("language-server");
      let package_root = package_dir
         .join("node_modules")
         .join("@vue")
         .join("language-server");
      let entrypoint = package_root.join("bin").join("vue-language-server.js");
      fs::create_dir_all(entrypoint.parent().unwrap()).unwrap();
      fs::write(
         package_root.join("package.json"),
         r#"{
  "name": "@vue/language-server",
  "bin": {
    "vue-language-server": "./bin/vue-language-server.js"
  }
}"#,
      )
      .unwrap();
      fs::write(&entrypoint, "").unwrap();

      let resolved = ToolInstaller::resolve_node_package_binary(
         &package_dir,
         "@vue/language-server",
         "vue-language-server",
      );

      assert_eq!(resolved.as_deref(), Some(entrypoint.as_path()));
   }

   #[test]
   fn writes_ruby_wrapper_for_managed_gem_executable() {
      let temp = tempfile::tempdir().unwrap();
      let package_dir = temp.path().join("ruby").join("solargraph");
      let gem_home = package_dir.join("gems");
      let gem_bin_dir = package_dir.join("gem-bin");
      let gem_command = gem_bin_dir.join(if cfg!(windows) {
         "solargraph.bat"
      } else {
         "solargraph"
      });
      fs::create_dir_all(gem_command.parent().unwrap()).unwrap();
      fs::write(&gem_command, "").unwrap();

      let wrapper =
         ToolInstaller::write_ruby_wrapper(&package_dir, "solargraph", &gem_home, &gem_bin_dir)
            .unwrap();

      assert_eq!(
         wrapper,
         package_dir
            .join("bin")
            .join(ToolInstaller::script_bin_name("solargraph"))
      );
      let content = fs::read_to_string(wrapper).unwrap();
      assert!(content.contains("GEM_HOME"));
      assert!(content.contains(gem_command.to_string_lossy().as_ref()));
   }

   #[test]
   fn rejects_ruby_wrapper_when_gem_executable_is_missing() {
      let temp = tempfile::tempdir().unwrap();
      let package_dir = temp.path().join("ruby").join("solargraph");

      let result = ToolInstaller::write_ruby_wrapper(
         &package_dir,
         "solargraph",
         &package_dir.join("gems"),
         &package_dir.join("gem-bin"),
      );

      assert!(matches!(result, Err(ToolError::InstallationFailed(_))));
   }

   #[test]
   fn rejects_unsafe_node_package_bin_paths() {
      let temp = tempfile::tempdir().unwrap();
      let package_root = temp.path().join("node_modules").join("bad-package");

      assert!(ToolInstaller::safe_package_bin_path(&package_root, "../bad.js").is_none());
      assert!(ToolInstaller::safe_package_bin_path(&package_root, "/tmp/bad.js").is_none());
      assert!(
         ToolInstaller::safe_package_bin_path(&package_root, "./bin/good.js")
            .unwrap()
            .ends_with("bin/good.js")
      );
   }

   #[test]
   fn picks_binary_case_insensitively_from_archive() {
      let temp = tempfile::tempdir().unwrap();
      let binary = temp.path().join(if cfg!(windows) {
         "OmniSharp.exe"
      } else {
         "OmniSharp"
      });
      fs::write(&binary, "").unwrap();

      let picked = ToolInstaller::pick_binary(temp.path(), "omnisharp").unwrap();

      assert_eq!(picked, binary);
   }

   #[test]
   fn preserves_binary_archive_layout_when_installing() {
      let staging = tempfile::tempdir().unwrap();
      let install = tempfile::tempdir().unwrap();
      let install_dir = install.path().join("dart");
      let dart = staging.path().join("dart-sdk").join("bin").join("dart");
      let snapshot = staging
         .path()
         .join("dart-sdk")
         .join("bin")
         .join("snapshots")
         .join("analysis_server.dart.snapshot");
      fs::create_dir_all(snapshot.parent().unwrap()).unwrap();
      fs::write(&dart, "").unwrap();
      fs::write(&snapshot, "").unwrap();

      let installed =
         ToolInstaller::install_extracted_binary(staging.path(), &install_dir, "dart", "dart")
            .unwrap();

      assert_eq!(
         installed,
         install_dir.join("dart-sdk").join("bin").join("dart")
      );
      assert!(
         install_dir
            .join("dart-sdk")
            .join("bin")
            .join("snapshots")
            .join("analysis_server.dart.snapshot")
            .exists()
      );
   }

   #[test]
   fn installs_binary_archive_using_configured_command_name() {
      let staging = tempfile::tempdir().unwrap();
      let install = tempfile::tempdir().unwrap();
      let install_dir = install.path().join("elixir-ls");
      let launcher = staging.path().join(if cfg!(windows) {
         "language_server.bat"
      } else {
         "language_server.sh"
      });
      let launch_script = staging.path().join("launch.sh");
      fs::write(&launcher, "").unwrap();
      fs::write(&launch_script, "").unwrap();

      let command_name = if cfg!(windows) {
         "language_server.bat"
      } else {
         "language_server.sh"
      };
      let installed = ToolInstaller::install_extracted_binary(
         staging.path(),
         &install_dir,
         "elixir-ls",
         command_name,
      )
      .unwrap();

      assert_eq!(installed, install_dir.join(command_name));
      assert!(install_dir.join("launch.sh").exists());
   }
}
