use crate::app_runtime::AppHandle;
use athas_extensions::ExtensionInstaller;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::PathBuf, process::Stdio};
use tauri::command;
use tokio::{io::AsyncWriteExt, process::Command};

#[derive(Debug, Deserialize)]
struct ExtensionManifest {
   #[serde(rename = "databaseProviders", default)]
   database_providers: Vec<DatabaseProviderContribution>,
}

#[derive(Debug, Deserialize)]
struct DatabaseProviderContribution {
   id: String,
   sidecar: PlatformArchExecutable,
}

#[derive(Debug, Deserialize)]
struct PlatformArchExecutable {
   #[serde(rename = "darwin-arm64")]
   darwin_arm64: Option<String>,
   #[serde(rename = "darwin-x64")]
   darwin_x64: Option<String>,
   #[serde(rename = "linux-arm64")]
   linux_arm64: Option<String>,
   #[serde(rename = "linux-x64")]
   linux_x64: Option<String>,
   #[serde(rename = "win32-x64")]
   win32_x64: Option<String>,
}

fn database_extension_id(provider_id: &str) -> Result<String, String> {
   if provider_id.is_empty()
      || !provider_id
         .chars()
         .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
   {
      return Err("Invalid database provider id".to_string());
   }

   Ok(format!("athas.database.{}", provider_id))
}

fn platform_arch() -> &'static str {
   match (std::env::consts::OS, std::env::consts::ARCH) {
      ("macos", "aarch64") => "darwin-arm64",
      ("macos", _) => "darwin-x64",
      ("linux", "aarch64") => "linux-arm64",
      ("linux", _) => "linux-x64",
      ("windows", _) => "win32-x64",
      _ => "linux-x64",
   }
}

fn sidecar_for_platform(sidecar: &PlatformArchExecutable) -> Option<&str> {
   match platform_arch() {
      "darwin-arm64" => sidecar.darwin_arm64.as_deref(),
      "darwin-x64" => sidecar.darwin_x64.as_deref(),
      "linux-arm64" => sidecar.linux_arm64.as_deref(),
      "linux-x64" => sidecar.linux_x64.as_deref(),
      "win32-x64" => sidecar.win32_x64.as_deref(),
      _ => None,
   }
}

fn resolve_sidecar_path(app_handle: AppHandle, provider_id: &str) -> Result<PathBuf, String> {
   let extension_id = database_extension_id(provider_id)?;
   let installer = ExtensionInstaller::new(app_handle)
      .map_err(|e| format!("Failed to initialize extension installer: {}", e))?;
   let extension_dir = installer.get_extension_dir(&extension_id);

   if !extension_dir.exists() {
      return Err(format!(
         "{} provider is not installed. Install it from Settings > Extensions.",
         provider_id
      ));
   }

   let manifest_path = extension_dir.join("extension.json");
   let manifest_json = std::fs::read_to_string(&manifest_path)
      .map_err(|e| format!("Failed to read database provider manifest: {}", e))?;
   let manifest: ExtensionManifest = serde_json::from_str(&manifest_json)
      .map_err(|e| format!("Invalid database provider manifest: {}", e))?;
   let provider = manifest
      .database_providers
      .iter()
      .find(|candidate| candidate.id == provider_id)
      .ok_or_else(|| format!("Manifest does not contribute provider {}", provider_id))?;
   let relative_sidecar = sidecar_for_platform(&provider.sidecar)
      .ok_or_else(|| format!("No database sidecar for {}", platform_arch()))?;
   let sidecar_path = extension_dir.join(relative_sidecar);

   if !sidecar_path.exists() {
      return Err(format!(
         "Database sidecar is missing for provider {}: {}",
         provider_id, relative_sidecar
      ));
   }

   Ok(sidecar_path)
}

pub async fn run_database_sidecar(
   app_handle: AppHandle,
   provider_id: String,
   command: String,
   payload: Value,
) -> Result<Value, String> {
   let sidecar_path = resolve_sidecar_path(app_handle, &provider_id)?;
   let request = json!({
      "protocolVersion": 1,
      "providerId": provider_id,
      "command": command,
      "payload": payload,
   });

   let mut child = Command::new(&sidecar_path)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|e| format!("Failed to start database sidecar: {}", e))?;

   if let Some(mut stdin) = child.stdin.take() {
      stdin
         .write_all(request.to_string().as_bytes())
         .await
         .map_err(|e| format!("Failed to write sidecar request: {}", e))?;
      stdin
         .shutdown()
         .await
         .map_err(|e| format!("Failed to close sidecar stdin: {}", e))?;
   }

   let output = child
      .wait_with_output()
      .await
      .map_err(|e| format!("Failed to wait for database sidecar: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
      return Err(if stderr.is_empty() {
         format!("Database sidecar exited with {}", output.status)
      } else {
         stderr
      });
   }

   serde_json::from_slice(&output.stdout)
      .map_err(|e| format!("Invalid database sidecar response: {}", e))
}

#[command]
pub async fn run_database_provider_command(
   app_handle: AppHandle,
   provider_id: String,
   command: String,
   payload: Value,
) -> Result<Value, String> {
   run_database_sidecar(app_handle, provider_id, command, payload).await
}
