use super::types::{ToolConfig, ToolError, ToolRuntime};
use crate::features::runtime::{RuntimeManager, RuntimeType};
use std::{path::PathBuf, process::Command};
use tauri::Manager;

/// Handles installation of language tools
pub struct ToolInstaller;

impl ToolInstaller {
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
            Self::install_via_bun(app_handle, package).await
         }
         ToolRuntime::Node => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_npm(app_handle, package).await
         }
         ToolRuntime::Python => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_pip(app_handle, package).await
         }
         ToolRuntime::Go => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_go(app_handle, package).await
         }
         ToolRuntime::Rust => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            Self::install_via_cargo(app_handle, package).await
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

      // Return the node_modules/.bin path
      let bin_path = package_dir.join("node_modules").join(".bin").join(package);
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

      let bin_path = package_dir.join("node_modules").join(".bin").join(package);
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
         venv_dir.join("Scripts").join(format!("{}.exe", package))
      } else {
         venv_dir.join("bin").join(package)
      };

      Ok(bin_path)
   }

   /// Install a package via go install
   async fn install_via_go(
      app_handle: &tauri::AppHandle,
      package: &str,
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

      // Extract binary name from package path
      let binary_name = package.split('/').last().unwrap_or(package);

      let bin_path = if cfg!(windows) {
         gopath.join("bin").join(format!("{}.exe", binary_name))
      } else {
         gopath.join("bin").join(binary_name)
      };

      Ok(bin_path)
   }

   /// Install a package via cargo install
   async fn install_via_cargo(
      app_handle: &tauri::AppHandle,
      package: &str,
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
         cargo_home.join("bin").join(format!("{}.exe", package))
      } else {
         cargo_home.join("bin").join(package)
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

      let bin_name = if cfg!(windows) {
         format!("{}.exe", name)
      } else {
         name.to_string()
      };
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

      std::fs::write(&bin_path, &bytes)?;

      // Make executable on Unix
      #[cfg(unix)]
      {
         use std::os::unix::fs::PermissionsExt;
         std::fs::set_permissions(&bin_path, std::fs::Permissions::from_mode(0o755))?;
      }

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
               .join(package))
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
               .join(package))
         }
         ToolRuntime::Python => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let bin_name = if cfg!(windows) {
               format!("{}.exe", package)
            } else {
               package.clone()
            };
            Ok(tools_dir
               .join("python")
               .join(package)
               .join("bin")
               .join(bin_name))
         }
         ToolRuntime::Go => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let binary_name = package.split('/').last().unwrap_or(package);
            let bin_name = if cfg!(windows) {
               format!("{}.exe", binary_name)
            } else {
               binary_name.to_string()
            };
            Ok(tools_dir.join("go").join("bin").join(bin_name))
         }
         ToolRuntime::Rust => {
            let package = config
               .package
               .as_ref()
               .ok_or_else(|| ToolError::ConfigError("No package specified".to_string()))?;
            let bin_name = if cfg!(windows) {
               format!("{}.exe", package)
            } else {
               package.clone()
            };
            Ok(tools_dir.join("cargo").join("bin").join(bin_name))
         }
         ToolRuntime::Binary => {
            let bin_name = if cfg!(windows) {
               format!("{}.exe", config.name)
            } else {
               config.name.clone()
            };
            Ok(tools_dir.join("bin").join(bin_name))
         }
      }
   }
}
