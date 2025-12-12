use serde::{Deserialize, Serialize};
use tauri::command;

const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const GITHUB_OAUTH_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL: &str = "https://api.github.com/user";
const COPILOT_TOKEN_URL: &str = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_MODELS_URL: &str = "https://api.githubcopilot.com/models";

const GITHUB_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceFlowResponse {
   pub device_code: String,
   pub user_code: String,
   pub verification_uri: String,
   pub expires_in: u64,
   pub interval: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthTokenResponse {
   pub access_token: Option<String>,
   pub token_type: Option<String>,
   pub scope: Option<String>,
   pub error: Option<String>,
   pub error_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotTokenResponse {
   pub token: String,
   pub expires_at: i64,
   pub refresh_in: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotAuthStatus {
   pub authenticated: bool,
   pub github_username: Option<String>,
   pub copilot_token_expires_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CopilotModel {
   pub id: String,
   pub name: String,
   pub version: Option<String>,
   pub is_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
   login: String,
}

#[command]
pub async fn copilot_start_device_flow() -> Result<DeviceFlowResponse, String> {
   let client = reqwest::Client::new();

   let response = client
      .post(GITHUB_DEVICE_CODE_URL)
      .header("Accept", "application/json")
      .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "read:user")])
      .send()
      .await
      .map_err(|e| format!("Failed to start device flow: {e}"))?;

   if !response.status().is_success() {
      let error_text = response.text().await.unwrap_or_default();
      return Err(format!("GitHub API error: {error_text}"));
   }

   response
      .json::<DeviceFlowResponse>()
      .await
      .map_err(|e| format!("Failed to parse device flow response: {e}"))
}

#[command]
pub async fn copilot_poll_device_auth(device_code: String) -> Result<OAuthTokenResponse, String> {
   let client = reqwest::Client::new();

   let response = client
      .post(GITHUB_OAUTH_TOKEN_URL)
      .header("Accept", "application/json")
      .form(&[
         ("client_id", GITHUB_CLIENT_ID),
         ("device_code", &device_code),
         ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
      ])
      .send()
      .await
      .map_err(|e| format!("Failed to poll for token: {e}"))?;

   response
      .json::<OAuthTokenResponse>()
      .await
      .map_err(|e| format!("Failed to parse token response: {e}"))
}

async fn fetch_github_username(github_token: &str) -> Option<String> {
   let client = reqwest::Client::new();

   let response = client
      .get(GITHUB_USER_URL)
      .header("Authorization", format!("token {github_token}"))
      .header("Accept", "application/json")
      .header("User-Agent", "Athas/1.0.0")
      .send()
      .await
      .ok()?;

   if !response.status().is_success() {
      return None;
   }

   let user: GitHubUser = response.json().await.ok()?;
   Some(user.login)
}

#[command]
pub async fn copilot_get_copilot_token(
   app: tauri::AppHandle,
   github_token: String,
) -> Result<CopilotTokenResponse, String> {
   let client = reqwest::Client::new();

   let response = client
      .get(COPILOT_TOKEN_URL)
      .header("Authorization", format!("token {github_token}"))
      .header("Accept", "application/json")
      .header("Editor-Version", "Athas/1.0.0")
      .header("Editor-Plugin-Version", "copilot-athas/1.0.0")
      .header(
         "User-Agent",
         "Athas/1.0.0 (https://github.com/athasdev/athas)",
      )
      .send()
      .await
      .map_err(|e| format!("Failed to get Copilot token: {e}"))?;

   if !response.status().is_success() {
      let status = response.status();
      let error_text = response.text().await.unwrap_or_default();

      if status.as_u16() == 401 {
         return Err("GitHub token is invalid or expired".to_string());
      }
      if status.as_u16() == 403 {
         return Err(
            "No active Copilot subscription found. Please subscribe at github.com/features/copilot"
               .to_string(),
         );
      }

      return Err(format!("Copilot API error ({status}): {error_text}"));
   }

   let token_response = response
      .json::<CopilotTokenResponse>()
      .await
      .map_err(|e| format!("Failed to parse Copilot token: {e}"))?;

   let username = fetch_github_username(&github_token).await;
   store_copilot_tokens(&app, &github_token, &token_response, username.as_deref()).await?;

   Ok(token_response)
}

async fn store_copilot_tokens(
   app: &tauri::AppHandle,
   github_token: &str,
   copilot_token: &CopilotTokenResponse,
   username: Option<&str>,
) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   store.set(
      "copilot_github_token",
      serde_json::Value::String(github_token.to_string()),
   );
   store.set(
      "copilot_access_token",
      serde_json::Value::String(copilot_token.token.clone()),
   );
   store.set(
      "copilot_token_expires_at",
      serde_json::Value::Number(copilot_token.expires_at.into()),
   );

   if let Some(name) = username {
      store.set(
         "copilot_github_username",
         serde_json::Value::String(name.to_string()),
      );
   }

   store
      .save()
      .map_err(|e| format!("Failed to save tokens: {e}"))?;

   Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredCopilotTokens {
   pub github_token: String,
   pub access_token: String,
   pub expires_at: i64,
   pub username: Option<String>,
}

#[command]
pub async fn copilot_get_stored_tokens(
   app: tauri::AppHandle,
) -> Result<Option<StoredCopilotTokens>, String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   let github_token = store
      .get("copilot_github_token")
      .and_then(|v| v.as_str().map(String::from));
   let access_token = store
      .get("copilot_access_token")
      .and_then(|v| v.as_str().map(String::from));
   let expires_at = store
      .get("copilot_token_expires_at")
      .and_then(|v| v.as_i64());
   let username = store
      .get("copilot_github_username")
      .and_then(|v| v.as_str().map(String::from));

   match (github_token, access_token, expires_at) {
      (Some(github_token), Some(access_token), Some(expires_at)) => Ok(Some(StoredCopilotTokens {
         github_token,
         access_token,
         expires_at,
         username,
      })),
      _ => Ok(None),
   }
}

#[command]
pub async fn copilot_refresh_token(app: tauri::AppHandle) -> Result<CopilotTokenResponse, String> {
   let tokens = copilot_get_stored_tokens(app.clone())
      .await?
      .ok_or("No stored tokens found")?;

   copilot_get_copilot_token(app, tokens.github_token).await
}

#[command]
pub async fn copilot_check_auth_status(app: tauri::AppHandle) -> Result<CopilotAuthStatus, String> {
   let tokens = copilot_get_stored_tokens(app).await?;

   match tokens {
      Some(stored) => {
         let now = chrono::Utc::now().timestamp();
         let authenticated = stored.expires_at > now;

         Ok(CopilotAuthStatus {
            authenticated,
            github_username: stored.username,
            copilot_token_expires_at: Some(stored.expires_at),
         })
      }
      None => Ok(CopilotAuthStatus {
         authenticated: false,
         github_username: None,
         copilot_token_expires_at: None,
      }),
   }
}

#[command]
pub async fn copilot_sign_out(app: tauri::AppHandle) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   let _ = store.delete("copilot_github_token");
   let _ = store.delete("copilot_access_token");
   let _ = store.delete("copilot_token_expires_at");
   let _ = store.delete("copilot_github_username");
   let _ = store.delete("copilot_enterprise_uri");

   store
      .save()
      .map_err(|e| format!("Failed to save store: {e}"))?;

   Ok(())
}

#[command]
pub async fn copilot_list_models(app: tauri::AppHandle) -> Result<Vec<CopilotModel>, String> {
   let tokens = copilot_get_stored_tokens(app.clone())
      .await?
      .ok_or("Not authenticated with Copilot")?;

   let now = chrono::Utc::now().timestamp();

   let token = if tokens.expires_at <= now {
      let refreshed = copilot_refresh_token(app).await?;
      refreshed.token
   } else {
      tokens.access_token
   };

   let client = reqwest::Client::new();

   let response = client
      .get(COPILOT_MODELS_URL)
      .header("Authorization", format!("Bearer {token}"))
      .header("Accept", "application/json")
      .header("Editor-Version", "Athas/1.0.0")
      .header("Editor-Plugin-Version", "copilot-athas/1.0.0")
      .header(
         "User-Agent",
         "Athas/1.0.0 (https://github.com/athasdev/athas)",
      )
      .send()
      .await
      .map_err(|e| format!("Failed to list models: {e}"))?;

   if !response.status().is_success() {
      let error_text = response.text().await.unwrap_or_default();
      return Err(format!("Failed to list models: {error_text}"));
   }

   #[derive(Deserialize)]
   struct ModelsResponse {
      data: Option<Vec<CopilotModel>>,
      models: Option<Vec<CopilotModel>>,
   }

   let models_response: ModelsResponse = response
      .json()
      .await
      .map_err(|e| format!("Failed to parse models: {e}"))?;

   Ok(models_response
      .data
      .or(models_response.models)
      .unwrap_or_default())
}

#[command]
pub async fn copilot_set_enterprise_uri(
   app: tauri::AppHandle,
   uri: Option<String>,
) -> Result<(), String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   match uri {
      Some(u) => store.set("copilot_enterprise_uri", serde_json::Value::String(u)),
      None => {
         let _ = store.delete("copilot_enterprise_uri");
      }
   }

   store
      .save()
      .map_err(|e| format!("Failed to save store: {e}"))?;

   Ok(())
}

#[command]
pub async fn copilot_get_enterprise_uri(app: tauri::AppHandle) -> Result<Option<String>, String> {
   use tauri_plugin_store::StoreExt;

   let store = app
      .store("secure.json")
      .map_err(|e| format!("Failed to access store: {e}"))?;

   Ok(store
      .get("copilot_enterprise_uri")
      .and_then(|v| v.as_str().map(String::from)))
}
