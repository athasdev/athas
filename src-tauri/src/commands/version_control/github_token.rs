//! Reads the stored GitHub credentials and the source preference for
//! [`athas_github::resolve_token`].

use crate::secure_storage::get_secret;
use athas_github::{
   ResolvedGitHubToken, TokenSourcePreference, TokenSources, cached_gh_cli_token, non_blank,
   resolve_token,
};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub const ATHAS_ACCOUNT_SECRET_KEY: &str = "github_token";
pub const PERSONAL_ACCESS_TOKEN_SECRET_KEY: &str = "github_pat";
const TOKEN_SOURCE_SETTING_KEY: &str = "githubTokenSource";

fn read_token_source_preference(app: &AppHandle) -> TokenSourcePreference {
   let setting = app.store("settings.json").ok().and_then(|store| {
      store
         .get(TOKEN_SOURCE_SETTING_KEY)
         .and_then(|value| value.as_str().map(ToOwned::to_owned))
   });
   TokenSourcePreference::from_setting(setting.as_deref())
}

fn read_stored_secret(app: &AppHandle, key: &str) -> Option<String> {
   non_blank(get_secret(app, key).ok().flatten())
}

pub fn has_personal_access_token(app: &AppHandle) -> bool {
   read_stored_secret(app, PERSONAL_ACCESS_TOKEN_SECRET_KEY).is_some()
}

pub fn has_athas_account_token(app: &AppHandle) -> bool {
   read_stored_secret(app, ATHAS_ACCOUNT_SECRET_KEY).is_some()
}

/// Resolves the token to authenticate with, honouring the user's source preference.
///
/// Blocking: may spawn `gh`. Call it from a blocking context, never directly on
/// an async command thread.
pub fn resolve_github_token(app: &AppHandle) -> ResolvedGitHubToken {
   resolve_token(
      read_token_source_preference(app),
      TokenSources {
         personal_access_token: || {
            get_secret(app, PERSONAL_ACCESS_TOKEN_SECRET_KEY)
               .ok()
               .flatten()
         },
         athas_account_token: || get_secret(app, ATHAS_ACCOUNT_SECRET_KEY).ok().flatten(),
         gh_cli_token: cached_gh_cli_token,
      },
   )
}
