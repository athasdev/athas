use crate::app_runtime::AppHandle;
use athas_extensions::ExtensionInstaller;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::{
   future::Future,
   path::{Component, Path, PathBuf},
   process::Stdio,
   time::Duration,
};
use tauri::command;
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

const DATABASE_SIDECAR_TIMEOUT: Duration = Duration::from_secs(60);
const DATABASE_SIDECAR_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
struct ExtensionManifest {
   #[serde(rename = "databaseProviders", default)]
   database_providers: Vec<DatabaseProviderContribution>,
}

#[derive(Debug, Deserialize)]
struct DatabaseProviderContribution {
   id: String,
   #[serde(rename = "protocolVersion")]
   protocol_version: Option<u32>,
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

#[derive(Debug, Deserialize)]
struct DatabaseSidecarEnvelope {
   #[serde(rename = "protocolVersion")]
   protocol_version: Option<u32>,
   ok: bool,
   result: Option<Value>,
   error: Option<DatabaseSidecarError>,
}

#[derive(Debug, Deserialize)]
struct DatabaseSidecarError {
   message: String,
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

fn validate_database_provider_protocol(
   provider: &DatabaseProviderContribution,
) -> Result<(), String> {
   match provider.protocol_version {
      Some(DATABASE_SIDECAR_PROTOCOL_VERSION) => Ok(()),
      Some(version) => Err(format!(
         "Unsupported database sidecar protocol version for provider {}: {}",
         provider.id, version
      )),
      None => Err(format!(
         "Database provider {} manifest was missing protocolVersion",
         provider.id
      )),
   }
}

fn validate_relative_sidecar_path(relative_sidecar: &str) -> Result<(), String> {
   let path = Path::new(relative_sidecar);
   if relative_sidecar.trim().is_empty() || path.is_absolute() {
      return Err("Invalid database sidecar path".to_string());
   }

   for component in path.components() {
      match component {
         Component::Normal(_) => {}
         Component::CurDir | Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
            return Err("Invalid database sidecar path".to_string());
         }
      }
   }

   Ok(())
}

fn is_builtin_database_provider(provider_id: &str) -> bool {
   provider_id == "sqlite"
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
   validate_database_provider_protocol(provider)?;
   let relative_sidecar = sidecar_for_platform(&provider.sidecar)
      .ok_or_else(|| format!("No database sidecar for {}", platform_arch()))?;
   validate_relative_sidecar_path(relative_sidecar)?;
   let sidecar_path = extension_dir.join(relative_sidecar);

   if !sidecar_path.exists() {
      return Err(format!(
         "Database sidecar is missing for provider {}: {}",
         provider_id, relative_sidecar
      ));
   }

   Ok(sidecar_path)
}

fn payload_connection_id(payload: &Value) -> Option<&str> {
   payload
      .get("connectionId")
      .or_else(|| payload.get("connection_id"))
      .and_then(Value::as_str)
}

fn hydrate_connection_payload(app_handle: &AppHandle, payload: Value) -> Result<Value, String> {
   let Some(connection_id) = payload_connection_id(&payload) else {
      return Ok(payload);
   };

   if payload.get("connectionConfig").is_some() {
      return Ok(payload);
   }

   let saved_connection = super::credentials::get_saved_connections_internal(app_handle)?
      .into_iter()
      .find(|connection| connection.id == connection_id)
      .ok_or_else(|| format!("Saved connection {} was not found", connection_id))?;
   let password = super::credentials::get_db_credential_internal(app_handle, connection_id)?;

   let mut object = match payload {
      Value::Object(object) => object,
      _ => Map::new(),
   };
   object.insert(
      "connectionConfig".to_string(),
      serde_json::to_value(saved_connection)
         .map_err(|e| format!("Failed to encode saved connection: {}", e))?,
   );
   object.insert(
      "password".to_string(),
      password.map_or(Value::Null, Value::String),
   );

   Ok(Value::Object(object))
}

fn decode_sidecar_response(stdout: &[u8]) -> Result<Value, String> {
   let value: Value = serde_json::from_slice(stdout)
      .map_err(|e| format!("Invalid database sidecar response: {}", e))?;

   if value.get("ok").is_none() && value.get("protocolVersion").is_none() {
      return Ok(value);
   }

   let envelope: DatabaseSidecarEnvelope = serde_json::from_value(value)
      .map_err(|e| format!("Invalid database sidecar envelope: {}", e))?;

   match envelope.protocol_version {
      Some(DATABASE_SIDECAR_PROTOCOL_VERSION) => {}
      Some(version) => {
         return Err(format!(
            "Unsupported database sidecar protocol version: {}",
            version
         ));
      }
      None => return Err("Database sidecar response was missing protocolVersion".to_string()),
   }

   if envelope.ok {
      return envelope
         .result
         .ok_or_else(|| "Database sidecar response was missing result".to_string());
   }

   Err(
      envelope
         .error
         .map(|error| error.message)
         .unwrap_or_else(|| "Database sidecar returned an unknown error".to_string()),
   )
}

fn sidecar_timeout_error(timeout_duration: Duration) -> String {
   format!(
      "Database sidecar timed out after {} seconds",
      timeout_duration.as_secs()
   )
}

async fn run_with_database_sidecar_timeout<F, T>(
   timeout_duration: Duration,
   future: F,
) -> Result<T, String>
where
   F: Future<Output = Result<T, String>>,
{
   timeout(timeout_duration, future)
      .await
      .map_err(|_| sidecar_timeout_error(timeout_duration))?
}

fn build_sidecar_request(provider_id: String, command: String, payload: Value) -> Value {
   json!({
      "protocolVersion": DATABASE_SIDECAR_PROTOCOL_VERSION,
      "providerId": provider_id,
      "command": command,
      "payload": payload,
   })
}

pub async fn run_database_sidecar(
   app_handle: AppHandle,
   provider_id: String,
   command: String,
   payload: Value,
) -> Result<Value, String> {
   let payload = hydrate_connection_payload(&app_handle, payload)?;
   if is_builtin_database_provider(&provider_id) {
      return run_with_database_sidecar_timeout(
         DATABASE_SIDECAR_TIMEOUT,
         athas_database::sidecar::run_provider_command(provider_id, command, payload),
      )
      .await;
   }

   let sidecar_path = resolve_sidecar_path(app_handle, &provider_id)?;
   let request = build_sidecar_request(provider_id, command, payload);

   let sidecar_dir = sidecar_path
      .parent()
      .and_then(|bin_dir| bin_dir.parent())
      .ok_or_else(|| "Invalid database sidecar path".to_string())?;

   let mut child = Command::new(&sidecar_path)
      .current_dir(sidecar_dir)
      .env("ATHAS_DB_SIDECAR_DIR", sidecar_dir)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .kill_on_drop(true)
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

   let output = timeout(DATABASE_SIDECAR_TIMEOUT, child.wait_with_output())
      .await
      .map_err(|_| sidecar_timeout_error(DATABASE_SIDECAR_TIMEOUT))?
      .map_err(|e| format!("Failed to wait for database sidecar: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
      return Err(if stderr.is_empty() {
         format!("Database sidecar exited with {}", output.status)
      } else {
         stderr
      });
   }

   decode_sidecar_response(&output.stdout)
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

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn decodes_typed_sidecar_success_envelope() {
      let response = include_bytes!("fixtures/sidecar_success_v1.json");

      let value = decode_sidecar_response(response).expect("success envelope");

      assert_eq!(value, json!({ "rows": [[1]], "columns": ["id"] }));
   }

   #[test]
   fn builds_v1_sidecar_request_envelope() {
      let fixture: Value = serde_json::from_str(include_str!(
         "../../../../crates/database/src/fixtures/sidecar_request_v1.json"
      ))
      .expect("request fixture");

      let request = build_sidecar_request(
         "sqlite".to_string(),
         "disconnect_database".to_string(),
         json!({}),
      );

      assert_eq!(request, fixture);
   }

   #[test]
   fn decodes_typed_sidecar_error_envelope() {
      let response = include_bytes!("fixtures/sidecar_error_v1.json");

      let error = decode_sidecar_response(response).expect_err("error envelope");

      assert_eq!(error, "Query failed");
   }

   #[test]
   fn decodes_typed_sidecar_panic_envelope() {
      let response = include_bytes!("fixtures/sidecar_panic_v1.json");

      let error = decode_sidecar_response(response).expect_err("panic envelope");

      assert_eq!(error, "Database sidecar panic: simulated provider panic");
   }

   #[test]
   fn accepts_legacy_raw_sidecar_responses() {
      let response = include_bytes!("fixtures/sidecar_legacy_raw_result.json");

      let value = decode_sidecar_response(response).expect("legacy response");

      assert_eq!(value, json!({ "rows": [[1]], "columns": ["id"] }));
   }

   #[test]
   fn rejects_unsupported_sidecar_protocol_version() {
      let response = include_bytes!("fixtures/sidecar_unsupported_protocol_v2.json");

      let error = decode_sidecar_response(response).expect_err("unsupported protocol version");

      assert_eq!(error, "Unsupported database sidecar protocol version: 2");
   }

   #[test]
   fn rejects_sidecar_envelope_without_protocol_version() {
      let response = br#"{"ok":true,"result":{"rows":[]}}"#;

      let error = decode_sidecar_response(response).expect_err("missing protocol version");

      assert_eq!(
         error,
         "Database sidecar response was missing protocolVersion"
      );
   }

   #[test]
   fn rejects_sidecar_envelope_without_ok_status() {
      let response = br#"{"protocolVersion":1,"result":{"rows":[]}}"#;

      let error = decode_sidecar_response(response).expect_err("missing ok status");

      assert!(
         error.starts_with("Invalid database sidecar envelope:"),
         "{}",
         error
      );
   }

   #[test]
   fn rejects_success_sidecar_envelope_without_result() {
      let response = br#"{"protocolVersion":1,"ok":true}"#;

      let error = decode_sidecar_response(response).expect_err("missing result");

      assert_eq!(error, "Database sidecar response was missing result");
   }

   #[test]
   fn reports_unknown_sidecar_error_when_error_payload_is_missing() {
      let response = br#"{"protocolVersion":1,"ok":false}"#;

      let error = decode_sidecar_response(response).expect_err("missing error payload");

      assert_eq!(error, "Database sidecar returned an unknown error");
   }

   #[test]
   fn rejects_database_provider_manifest_protocol_mismatches() {
      let provider = DatabaseProviderContribution {
         id: "postgres".to_string(),
         protocol_version: Some(2),
         sidecar: PlatformArchExecutable {
            darwin_arm64: Some("bin/athas-db-postgres".to_string()),
            darwin_x64: None,
            linux_arm64: None,
            linux_x64: None,
            win32_x64: None,
         },
      };

      let error =
         validate_database_provider_protocol(&provider).expect_err("protocol mismatch should fail");

      assert_eq!(
         error,
         "Unsupported database sidecar protocol version for provider postgres: 2"
      );
   }

   #[test]
   fn rejects_database_provider_manifest_without_protocol_version() {
      let provider = DatabaseProviderContribution {
         id: "postgres".to_string(),
         protocol_version: None,
         sidecar: PlatformArchExecutable {
            darwin_arm64: Some("bin/athas-db-postgres".to_string()),
            darwin_x64: None,
            linux_arm64: None,
            linux_x64: None,
            win32_x64: None,
         },
      };

      let error = validate_database_provider_protocol(&provider)
         .expect_err("missing protocol version should fail");

      assert_eq!(
         error,
         "Database provider postgres manifest was missing protocolVersion"
      );
   }

   #[test]
   fn formats_sidecar_timeout_error() {
      assert_eq!(
         sidecar_timeout_error(Duration::from_secs(60)),
         "Database sidecar timed out after 60 seconds"
      );
   }

   #[tokio::test]
   async fn times_out_builtin_database_provider_commands() {
      let error = run_with_database_sidecar_timeout(
         Duration::from_millis(1),
         std::future::pending::<Result<Value, String>>(),
      )
      .await;

      assert_eq!(
         error.expect_err("pending provider command should time out"),
         "Database sidecar timed out after 0 seconds"
      );
   }

   #[test]
   fn rejects_sidecar_manifest_paths_that_escape_the_extension_dir() {
      assert!(validate_relative_sidecar_path("bin/athas-db-postgres").is_ok());

      for invalid_path in [
         "",
         "../athas-db-postgres",
         "bin/../athas-db-postgres",
         "/tmp/athas-db-postgres",
      ] {
         assert_eq!(
            validate_relative_sidecar_path(invalid_path).expect_err("invalid sidecar path"),
            "Invalid database sidecar path"
         );
      }
   }
}
