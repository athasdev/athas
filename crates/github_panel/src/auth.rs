//! Finding a GitHub token the way Athas does (`githubTokenSource`): the personal access token
//! pasted in Settings (kept in the keychain; a token in the environment, `GITHUB_TOKEN` or
//! `GH_TOKEN`, stands in for it), then the `gh` CLI's token. The Athas account's GitHub token is
//! not synced to this build.

use crate::gh::{GitHubTokenSource, TokenSourcePreference};
#[cfg(not(target_family = "wasm"))]
use crate::gh::{GitHubAuthStatus, TokenSources, non_blank, resolve_token};

#[cfg(not(target_family = "wasm"))]
const KEYCHAIN_SERVICE: &str = paths::GITHUB_KEYCHAIN_SERVICE;
#[cfg(not(target_family = "wasm"))]
const KEYCHAIN_ACCOUNT: &str = "personal-access-token";

#[cfg(not(target_family = "wasm"))]
/// The personal access token saved in Settings. Blocking: reads the keychain.
pub fn stored_personal_access_token() -> Option<String> {
    non_blank(secure_storage::get_secret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).ok().flatten())
}

#[cfg(not(target_family = "wasm"))]
/// Saves a pasted personal access token (`storeGitHubPersonalAccessToken`).
pub fn save_personal_access_token(token: &str) -> Result<(), String> {
    let token = crate::gh::normalize_personal_access_token(token)?;
    secure_storage::store_secret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, token).map_err(|error| format!("Failed to save the token: {error}"))?;
    crate::gh::invalidate_gh_cli_token_cache();
    Ok(())
}

#[cfg(not(target_family = "wasm"))]
/// `removeGitHubPersonalAccessToken`.
pub fn remove_personal_access_token() -> Result<(), String> {
    secure_storage::remove_secret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| format!("Failed to remove the token: {error}"))
}

#[cfg(not(target_family = "wasm"))]
fn personal_access_token() -> Option<String> {
    stored_personal_access_token().or_else(env_token)
}

#[cfg(not(target_family = "wasm"))]
/// What Settings > Git > GitHub Account shows (`getGitHubTokenStatus`). Blocking: reads the
/// keychain, may spawn `gh` and asks GitHub who the token belongs to.
pub fn token_status(preference: TokenSourcePreference) -> Result<crate::gh::GitHubTokenStatus, String> {
    let resolved = resolve_token(
        preference,
        TokenSources { personal_access_token, athas_account_token: || None, gh_cli_token: crate::gh::cached_gh_cli_token },
    );
    crate::gh::github_token_status(resolved, personal_access_token().is_some(), false)
}

/// Scopes that let a token delete or rewrite more than Athas needs (`getDestructiveScopes`).
pub fn destructive_scopes(scopes: Option<&str>) -> Vec<String> {
    const DESTRUCTIVE: &[&str] = &["delete_repo", "admin:org", "admin:enterprise", "delete:packages"];
    let granted: Vec<&str> = scopes.unwrap_or_default().split(|c: char| c == ',' || c.is_whitespace()).filter(|scope| !scope.is_empty()).collect();
    DESTRUCTIVE.iter().filter(|scope| granted.contains(scope)).map(|scope| scope.to_string()).collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token {
    pub value: String,
    pub source: GitHubTokenSource,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Auth {
    Checking,
    Authenticated(Token),
    /// No token anywhere, or GitHub rejected the one found.
    Missing { gh_installed: bool, rejected: bool },
    /// GitHub could not be reached; the token may be fine.
    Unavailable(String),
}

impl Auth {
    pub fn token(&self) -> Option<String> {
        match self {
            Auth::Authenticated(token) => Some(token.value.clone()),
            _ => None,
        }
    }
}

#[cfg(not(target_family = "wasm"))]
fn env_token() -> Option<String> {
    ["GITHUB_TOKEN", "GH_TOKEN"].iter().find_map(|key| non_blank(std::env::var(key).ok()))
}

#[cfg(not(target_family = "wasm"))]
/// The token to use, without checking it. Blocking: may spawn `gh` (its answer is cached a minute).
pub fn find_token(preference: TokenSourcePreference) -> Option<Token> {
    let resolved = resolve_token(
        preference,
        TokenSources { personal_access_token, athas_account_token: || None, gh_cli_token: crate::gh::cached_gh_cli_token },
    );
    Some(Token { value: resolved.token?, source: resolved.source? })
}

#[cfg(not(target_family = "wasm"))]
/// Finds a token and asks GitHub whether it works. Blocking: spawns `gh` and calls the API.
pub fn check(preference: TokenSourcePreference) -> Auth {
    let Some(token) = find_token(preference) else {
        return Auth::Missing { gh_installed: crate::gh::is_gh_cli_installed(), rejected: false };
    };
    match crate::gh::github_check_auth(Some(token.value.clone())) {
        Ok(GitHubAuthStatus::Authenticated) => Auth::Authenticated(token),
        Ok(GitHubAuthStatus::NotAuthenticated) => {
            crate::gh::invalidate_gh_cli_token_cache();
            Auth::Missing { gh_installed: crate::gh::is_gh_cli_installed(), rejected: true }
        }
        Err(error) => Auth::Unavailable(error),
    }
}

/// The workspace server finds and checks its own token; the browser only learns whether there is
/// one. Blocking: a call to the server.
#[cfg(target_family = "wasm")]
pub fn check(_preference: TokenSourcePreference) -> Auth {
    use web_protocol::github::AuthState;
    match crate::relay::auth_state() {
        Ok(AuthState::Authenticated { source }) => match serde_json::from_value(serde_json::Value::String(source)) {
            Ok(source) => Auth::Authenticated(Token { value: String::new(), source }),
            Err(_) => Auth::Unavailable("The workspace server named an unknown GitHub token source.".into()),
        },
        Ok(AuthState::Missing { gh_installed, rejected }) => Auth::Missing { gh_installed, rejected },
        Ok(AuthState::Unavailable { error }) => Auth::Unavailable(error),
        Err(error) => Auth::Unavailable(error),
    }
}

pub fn source_label(source: GitHubTokenSource) -> &'static str {
    match source {
        GitHubTokenSource::GhCli => "GitHub CLI (gh)",
        GitHubTokenSource::PersonalAccessToken => "Personal access token",
        GitHubTokenSource::Athas => "Athas account",
    }
}
