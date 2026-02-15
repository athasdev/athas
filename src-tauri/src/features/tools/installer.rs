use super::types::{ToolConfig, ToolError, ToolRuntime};
use crate::features::runtime::{RuntimeManager, RuntimeType};
use flate2::read::GzDecoder;
use serde_json::Value;
use std::{
   fs,
   io::Cursor,
   path::{Path, PathBuf},
   process::Command,
};
use tauri::Manager;
use walkdir::WalkDir;
use zip::ZipArchive;

/// Handles installation of language tools
pub struct ToolInstaller;

impl ToolInstaller {
   fn node_bin_name(name: &str) -> String {
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

   fn resolve_node_package_entrypoint(
      package_dir: &Path,
      package: &str,
      command_name: &str,
   ) -> Option<PathBuf> {
      let package_root = package_dir.join("node_modules").join(package);
      let package_json = package_root.join("package.json");
      let package_json_content = fs::read_to_string(package_json).ok()?;
      let package_json_value: Value = serde_json::from_str(&package_json_content).ok()?;
      let bin_field = package_json_value.get("bin")?;

      if let Some(single_bin) = bin_field.as_str() {
         return Some(package_root.join(single_bin));
      }

      let bins = bin_field.as_object()?;
      if let Some(command_bin) = bins.get(command_name).and_then(|value| value.as_str()) {
         return Some(package_root.join(command_bin));
      }

      bins
         .values()
         .next()
         .and_then(|value| value.as_str())
         .map(|first_bin| package_root.join(first_bin))
   }

   fn ensure_executable(path: &Path) -> Result<(), ToolError> {
      #[cfg(unix)]
      {
         use std::os::unix::fs::PermissionsExt;
         fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
      }
      Ok(())
   }

   fn extract_archive(bytes: &[u8], url: &str, target_dir: &Path) -> Result<(), ToolError> {
      if url.ends_with(".tar.gz") || url.ends_with(".tgz") {
         let decoder = GzDecoder::new(Cursor::new(bytes));
         let mut archive = tar::Archive::new(decoder);
         archive.unpack(target_dir).map_err(|e| {
            ToolError::InstallationFailed(format!("Failed to unpack tar.gz: {}", e))
         })?;
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

         if file_name == expected_name || (!cfg!(windows) && file_name == command_name) {
            return Ok(path);
         }

         if file_name.starts_with(command_name) {
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

   /// Install a tool based on its configuration
   pub async fn install(
      app_handle: &tauri::AppHandle,
      config: &ToolConfig,
   ) -> Result<PathBuf, ToolError> {
      match config.runtime {
         ToolRuntime::Bun => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_bun(app_handle, package, &config.name).await
         }
         ToolRuntime::Node => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_npm(app_handle, package, &config.name).await
         }
         ToolRuntime::Python => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_pip(app_handle, package, &config.name).await
         }
         ToolRuntime::Go => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_go(app_handle, package, &config.name).await
         }
         ToolRuntime::Rust => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_cargo(app_handle, package, &config.name).await
         }
         ToolRuntime::Binary => {
            let url = config
               .download_url
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No download URL specified".to_string()))?;
            Self::download_binary(app_handle, &config.name, url).await
         }
      }
   }

   /// Get the installation directory for tools
   pub fn get_tools_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, ToolError> {
      let data_dir = app_handle
         .path()
         .app_data_dir()
         .map_err(|e| ToolError::ConfigError(e.to_string()))?;
      Ok(data_dir.join("tools"))
   }

   /// Install a package via Bun (global)
   async fn install_via_bun(
      app_handle: &tauri::AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let bun_path = RuntimeManager::get_runtime(app_handle, RuntimeType::Bun)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let package_dir = tools_dir.join("bun").join(package);
      std::fs::create_dir_all(&package_dir)?;

      log::info!("Installing {} via Bun to {:?}", package, package_dir);

      let output = Command::new(&bun_path)
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

      // Return the node_modules/.bin path for the configured command.
      let bin_path = package_dir
         .join("node_modules")
         .join(".bin")
         .join(Self::node_bin_name(command_name));
      if bin_path.exists() {
         Ok(bin_path)
      } else {
         // Try without .bin for packages that don't have a binary
         Ok(package_dir.join("node_modules").join(package))
      }
   }

   /// Install a package via npm (global)
   async fn install_via_npm(
      app_handle: &tauri::AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let node_path = RuntimeManager::get_runtime(app_handle, RuntimeType::Node)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let package_dir = tools_dir.join("npm").join(package);
      std::fs::create_dir_all(&package_dir)?;

      // Get npm path (should be alongside node)
      let npm_path = node_path
         .parent()
         .map(|p| p.join("npm"))
         .unwrap_or_else(|| which::which("npm").unwrap_or_else(|_| PathBuf::from("npm")));

      log::info!("Installing {} via npm to {:?}", package, package_dir);

      let output = Command::new(&npm_path)
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

      let bin_path = package_dir
         .join("node_modules")
         .join(".bin")
         .join(Self::node_bin_name(command_name));
      if bin_path.exists() {
         Ok(bin_path)
      } else {
         Ok(package_dir.join("node_modules").join(package))
      }
   }

   /// Install a package via pip (user)
   async fn install_via_pip(
      app_handle: &tauri::AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let python_path = RuntimeManager::get_runtime(app_handle, RuntimeType::Python)
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
      let output = Command::new(&python_path)
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

      let output = Command::new(&pip_path)
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

      Ok(bin_path)
   }

   /// Install a package via go install
   async fn install_via_go(
      app_handle: &tauri::AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let go_path = RuntimeManager::get_runtime(app_handle, RuntimeType::Go)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let gopath = tools_dir.join("go");
      std::fs::create_dir_all(&gopath)?;

      log::info!("Installing {} via go install", package);

      let output = Command::new(&go_path)
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

      Ok(bin_path)
   }

   /// Install a package via cargo install
   async fn install_via_cargo(
      app_handle: &tauri::AppHandle,
      package: &str,
      command_name: &str,
   ) -> Result<PathBuf, ToolError> {
      let cargo_path = RuntimeManager::get_runtime(app_handle, RuntimeType::Rust)
         .await
         .map_err(|e| ToolError::RuntimeNotAvailable(e.to_string()))?;

      let tools_dir = Self::get_tools_dir(app_handle)?;
      let cargo_home = tools_dir.join("cargo");
      std::fs::create_dir_all(&cargo_home)?;

      log::info!("Installing {} via cargo install", package);

      let output = Command::new(&cargo_path)
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

      Ok(bin_path)
   }

   /// Download a binary directly
   async fn download_binary(
      app_handle: &tauri::AppHandle,
      name: &str,
      url: &str,
   ) -> Result<PathBuf, ToolError> {
      let tools_dir = Self::get_tools_dir(app_handle)?;
      let bin_dir = tools_dir.join("bin");
      std::fs::create_dir_all(&bin_dir)?;

      let bin_name = Self::bin_file_name(name);
      let bin_path = bin_dir.join(&bin_name);

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

      let bytes = response
         .bytes()
         .await
         .map_err(|e| ToolError::DownloadFailed(e.to_string()))?;

      let staging_dir = tempfile::tempdir()
         .map_err(|e| ToolError::InstallationFailed(format!("Failed to create temp dir: {}", e)))?;
      Self::extract_archive(&bytes, url, staging_dir.path())?;

      let source_binary = Self::pick_binary(staging_dir.path(), name)?;
      fs::copy(&source_binary, &bin_path).map_err(|e| {
         ToolError::InstallationFailed(format!(
            "Failed to copy binary from {:?} to {:?}: {}",
            source_binary, bin_path, e
         ))
      })?;
      Self::ensure_executable(&bin_path)?;

      Ok(bin_path)
   }

   /// Check if a tool is installed
   pub fn is_installed(
      app_handle: &tauri::AppHandle,
      config: &ToolConfig,
   ) -> Result<bool, ToolError> {
      let path = Self::get_tool_path(app_handle, config)?;
      Ok(path.exists())
   }

   /// Get the path where a tool would be/is installed
   pub fn get_tool_path(
      app_handle: &tauri::AppHandle,
      config: &ToolConfig,
   ) -> Result<PathBuf, ToolError> {
      let tools_dir = Self::get_tools_dir(app_handle)?;

      match config.runtime {
         ToolRuntime::Bun => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Ok(tools_dir
               .join("bun")
               .join(package)
               .join("node_modules")
               .join(".bin")
               .join(Self::node_bin_name(&config.name)))
         }
         ToolRuntime::Node => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Ok(tools_dir
               .join("npm")
               .join(package)
               .join("node_modules")
               .join(".bin")
               .join(Self::node_bin_name(&config.name)))
         }
         ToolRuntime::Python => {
            let bin_name = Self::bin_file_name(&config.name);
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
            let bin_name = Self::bin_file_name(&config.name);
            Ok(tools_dir.join("go").join("bin").join(bin_name))
         }
         ToolRuntime::Rust => {
            let bin_name = Self::bin_file_name(&config.name);
            Ok(tools_dir.join("cargo").join("bin").join(bin_name))
         }
         ToolRuntime::Binary => {
            let bin_name = Self::bin_file_name(&config.name);
            Ok(tools_dir.join("bin").join(bin_name))
         }
      }
   }

   /// Get the preferred launch path for LSP servers.
   /// For Node/Bun tools, this returns the package bin entrypoint (e.g. .js/.mjs)
   /// so the LSP client can run it with managed Node runtime.
   pub fn get_lsp_launch_path(
      app_handle: &tauri::AppHandle,
      config: &ToolConfig,
   ) -> Result<PathBuf, ToolError> {
      let tools_dir = Self::get_tools_dir(app_handle)?;

      match config.runtime {
         ToolRuntime::Bun => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let package_dir = tools_dir.join("bun").join(package);

            if let Some(entrypoint) =
               Self::resolve_node_package_entrypoint(&package_dir, package, &config.name)
            {
               return Ok(entrypoint);
            }

            Ok(package_dir
               .join("node_modules")
               .join(".bin")
               .join(Self::node_bin_name(&config.name)))
         }
         ToolRuntime::Node => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let package_dir = tools_dir.join("npm").join(package);

            if let Some(entrypoint) =
               Self::resolve_node_package_entrypoint(&package_dir, package, &config.name)
            {
               return Ok(entrypoint);
            }

            Ok(package_dir
               .join("node_modules")
               .join(".bin")
               .join(Self::node_bin_name(&config.name)))
         }
         _ => Self::get_tool_path(app_handle, config),
      }
   }
}
