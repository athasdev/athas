//! Resolves which GitHub credential Athas should use for API calls.
//!
//! Three sources can supply one, in descending priority under `Auto`:
//!
//! 1. a personal access token the user pasted into Settings,
//! 2. the token synced from the connected Athas account,
//! 3. the token owned by the user's `gh` CLI installation.
//!
//! The `gh` token is the escape hatch for repositories the Athas OAuth app
//! cannot reach — typically an organization that has not approved it. Users can
//! also pin a single source explicitly, because an Athas token that authenticates
//! fine while being blind to org repositories would otherwise always win.

use crate::{app_runtime::AppHandle, secure_storage::get_secret};
use std::{
   sync::Mutex,
   time::{Duration, Instant},
};
use tauri_plugin_store::StoreExt;

pub const ATHAS_ACCOUNT_SECRET_KEY: &str = "github_token";
pub const PERSONAL_ACCESS_TOKEN_SECRET_KEY: &str = "github_pat";
const TOKEN_SOURCE_SETTING_KEY: &str = "githubTokenSource";

/// Spawning `gh` costs a process launch, and every GitHub command resolves a
/// token. Re-reading it at most once a minute keeps `gh auth switch` and token
/// rotation effective without paying that cost per request.
const GH_TOKEN_CACHE_TTL: Duration = Duration::from_secs(60);

static GH_TOKEN_CACHE: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitHubTokenSource {
   Athas,
   PersonalAccessToken,
   GhCli,
}

pub struct ResolvedGitHubToken {
   pub token: Option<String>,
   pub source: Option<GitHubTokenSource>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TokenSourcePreference {
   Auto,
   Athas,
   PersonalAccessToken,
   GhCli,
}

fn read_token_source_preference(app: &AppHandle) -> TokenSourcePreference {
   let Ok(store) = app.store("settings.json") else {
      return TokenSourcePreference::Auto;
   };

   match store
      .get(TOKEN_SOURCE_SETTING_KEY)
      .and_then(|value| value.as_str().map(ToOwned::to_owned))
      .as_deref()
   {
      Some("athas") => TokenSourcePreference::Athas,
      Some("pat") => TokenSourcePreference::PersonalAccessToken,
      Some("gh") => TokenSourcePreference::GhCli,
      _ => TokenSourcePreference::Auto,
   }
}

fn read_stored_secret(app: &AppHandle, key: &str) -> Option<String> {
   get_secret(app, key)
      .ok()
      .flatten()
      .map(|token| token.trim().to_string())
      .filter(|token| !token.is_empty())
}

pub fn has_personal_access_token(app: &AppHandle) -> bool {
   read_stored_secret(app, PERSONAL_ACCESS_TOKEN_SECRET_KEY).is_some()
}

pub fn has_athas_account_token(app: &AppHandle) -> bool {
   read_stored_secret(app, ATHAS_ACCOUNT_SECRET_KEY).is_some()
}

pub fn cached_gh_cli_token() -> Option<String> {
   let mut cache = GH_TOKEN_CACHE.lock().ok()?;

   if let Some((read_at, token)) = cache.as_ref()
      && read_at.elapsed() < GH_TOKEN_CACHE_TTL
   {
      return token.clone();
   }

   let token = athas_github::gh_cli_token();
   *cache = Some((Instant::now(), token.clone()));
   token
}

/// Drops the cached `gh` token so the next resolution re-reads it.
pub fn invalidate_gh_cli_token_cache() {
   if let Ok(mut cache) = GH_TOKEN_CACHE.lock() {
      *cache = None;
   }
}

/// Resolves the token to authenticate with, honouring the user's source preference.
///
/// Blocking: may spawn `gh`. Call it from a blocking context, never directly on
/// an async command thread.
pub fn resolve_github_token(app: &AppHandle) -> ResolvedGitHubToken {
   let preference = read_token_source_preference(app);

   let personal_access_token = || {
      read_stored_secret(app, PERSONAL_ACCESS_TOKEN_SECRET_KEY)
         .map(|token| (token, GitHubTokenSource::PersonalAccessToken))
   };
   let athas_account_token = || {
      read_stored_secret(app, ATHAS_ACCOUNT_SECRET_KEY)
         .map(|token| (token, GitHubTokenSource::Athas))
   };
   let gh_cli_token = || cached_gh_cli_token().map(|token| (token, GitHubTokenSource::GhCli));

   let resolved = match preference {
      TokenSourcePreference::Auto => personal_access_token()
         .or_else(athas_account_token)
         .or_else(gh_cli_token),
      TokenSourcePreference::PersonalAccessToken => personal_access_token(),
      TokenSourcePreference::Athas => athas_account_token(),
      TokenSourcePreference::GhCli => gh_cli_token(),
   };

   match resolved {
      Some((token, source)) => ResolvedGitHubToken {
         token: Some(token),
         source: Some(source),
      },
      None => ResolvedGitHubToken {
         token: None,
         source: None,
      },
   }
}
