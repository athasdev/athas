use crate::secure_storage::{get_secret, remove_secret, store_secret};
use serde::Serialize;
use tauri::AppHandle;

use super::github_rest::fetch_current_user_with_pat;

const GITHUB_PAT_SECRET_KEY: &str = "github_token";
const GITHUB_PAT_SOURCE_KEY: &str = "github_pat_fallback_source";

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GitHubAuthSource {
   Gh,
   Pat,
   None,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthStatus {
   pub source: GitHubAuthSource,
   pub is_authenticated: bool,
   pub current_user: Option<String>,
   pub cli_available: bool,
   pub has_stored_pat: bool,
   pub has_legacy_stored_token: bool,
}

#[derive(Debug, Clone)]
pub struct ResolvedGitHubAuth {
   pub status: GitHubAuthStatus,
   pub pat_token: Option<String>,
}

pub async fn resolve_github_auth(app: &AppHandle) -> Result<ResolvedGitHubAuth, String> {
   let cli_available = which::which("gh").is_ok();
   let stored_pat = get_secret(app, GITHUB_PAT_SECRET_KEY)?;
   let has_stored_pat = stored_pat.is_some();
   let has_legacy_stored_token = has_stored_pat && is_legacy_pat_fallback(app)?;

   if cli_available {
      match athas_github::github_check_cli_auth(app.clone()) {
         Ok(true) => {
            let current_user = athas_github::github_get_current_user(app.clone()).ok();
            return Ok(ResolvedGitHubAuth {
               status: GitHubAuthStatus {
                  source: GitHubAuthSource::Gh,
                  is_authenticated: true,
                  current_user,
                  cli_available,
                  has_stored_pat,
                  has_legacy_stored_token,
               },
               pat_token: None,
            });
         }
         Ok(false) => {}
         Err(error) => {
            log::warn!(
               "GitHub CLI auth resolution failed, falling back to PAT resolution: {error}"
            );
         }
      }
   }

   if let Some(token) = stored_pat {
      match fetch_current_user_with_pat(&token).await {
         Ok(current_user) => {
            return Ok(ResolvedGitHubAuth {
               status: GitHubAuthStatus {
                  source: GitHubAuthSource::Pat,
                  is_authenticated: true,
                  current_user: Some(current_user),
                  cli_available,
                  has_stored_pat: true,
                  has_legacy_stored_token,
               },
               pat_token: Some(token),
            });
         }
         Err(error) => {
            log::warn!("Stored GitHub PAT fallback is invalid or unusable: {error}");
         }
      }
   }

   Ok(ResolvedGitHubAuth {
      status: GitHubAuthStatus {
         source: GitHubAuthSource::None,
         is_authenticated: false,
         current_user: None,
         cli_available,
         has_stored_pat,
         has_legacy_stored_token,
      },
      pat_token: None,
   })
}

pub async fn store_pat_fallback(app: &AppHandle, token: &str) -> Result<GitHubAuthStatus, String> {
   let trimmed_token = token.trim();
   if trimmed_token.is_empty() {
      return Err("Personal access token is required.".to_string());
   }

   let _current_user = fetch_current_user_with_pat(trimmed_token).await?;
   store_secret(app, GITHUB_PAT_SECRET_KEY, trimmed_token)?;
   store_secret(app, GITHUB_PAT_SOURCE_KEY, "pat")?;

   Ok(resolve_github_auth(app).await?.status)
}

pub async fn remove_pat_fallback(app: &AppHandle) -> Result<GitHubAuthStatus, String> {
   remove_secret(app, GITHUB_PAT_SECRET_KEY)?;
   remove_secret(app, GITHUB_PAT_SOURCE_KEY)?;
   Ok(resolve_github_auth(app).await?.status)
}

fn is_legacy_pat_fallback(app: &AppHandle) -> Result<bool, String> {
   let source = get_secret(app, GITHUB_PAT_SOURCE_KEY)?;
   Ok(!matches!(source.as_deref(), Some("pat")))
}

#[cfg(test)]
mod tests {
   use super::{GitHubAuthSource, GitHubAuthStatus};

   #[test]
   fn serializes_auth_source_in_lowercase() {
      let json = serde_json::to_value(GitHubAuthStatus {
         source: GitHubAuthSource::Pat,
         is_authenticated: true,
         current_user: Some("fsos".to_string()),
         cli_available: true,
         has_stored_pat: true,
         has_legacy_stored_token: false,
      })
      .expect("auth status should serialize");

      assert_eq!(
         json.get("source").and_then(|value| value.as_str()),
         Some("pat")
      );
      assert_eq!(
         json.get("cliAvailable").and_then(|value| value.as_bool()),
         Some(true)
      );
   }
}
