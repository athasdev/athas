//! Chooses which GitHub credential Athas should use for API calls.
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

use crate::{gh_cli::gh_cli_token, github_describe_token, is_gh_cli_installed};
use std::{
   sync::Mutex,
   time::{Duration, Instant},
};

/// Spawning `gh` costs a process launch, and every GitHub command resolves a
/// token. Re-reading it at most once a minute keeps `gh auth switch` and token
/// rotation effective without paying that cost per request.
const GH_TOKEN_CACHE_TTL: Duration = Duration::from_secs(60);

static GH_TOKEN_CACHE: TtlCache = TtlCache::new(GH_TOKEN_CACHE_TTL);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GitHubTokenSource {
   Athas,
   PersonalAccessToken,
   GhCli,
}

/// The user's `githubTokenSource` setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenSourcePreference {
   Auto,
   Athas,
   PersonalAccessToken,
   GhCli,
}

impl TokenSourcePreference {
   /// Unknown or missing values mean `Auto`.
   pub fn from_setting(value: Option<&str>) -> Self {
      match value {
         Some("athas") => Self::Athas,
         Some("pat") => Self::PersonalAccessToken,
         Some("gh") => Self::GhCli,
         _ => Self::Auto,
      }
   }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedGitHubToken {
   pub token: Option<String>,
   pub source: Option<GitHubTokenSource>,
}

/// Where stored credentials come from; each reader is only called when its source is consulted.
pub struct TokenSources<P, A, G> {
   pub personal_access_token: P,
   pub athas_account_token: A,
   pub gh_cli_token: G,
}

/// Resolves the token to authenticate with, honouring the preference. Stored tokens are trimmed
/// and blank ones count as missing.
pub fn resolve_token<P, A, G>(
   preference: TokenSourcePreference,
   sources: TokenSources<P, A, G>,
) -> ResolvedGitHubToken
where
   P: FnOnce() -> Option<String>,
   A: FnOnce() -> Option<String>,
   G: FnOnce() -> Option<String>,
{
   let TokenSources {
      personal_access_token,
      athas_account_token,
      gh_cli_token,
   } = sources;
   let pat = || {
      non_blank(personal_access_token())
         .map(|token| (token, GitHubTokenSource::PersonalAccessToken))
   };
   let athas = || non_blank(athas_account_token()).map(|token| (token, GitHubTokenSource::Athas));
   let gh = || gh_cli_token().map(|token| (token, GitHubTokenSource::GhCli));

   let resolved = match preference {
      TokenSourcePreference::Auto => pat().or_else(athas).or_else(gh),
      TokenSourcePreference::PersonalAccessToken => pat(),
      TokenSourcePreference::Athas => athas(),
      TokenSourcePreference::GhCli => gh(),
   };

   ResolvedGitHubToken {
      source: resolved.as_ref().map(|(_, source)| *source),
      token: resolved.map(|(token, _)| token),
   }
}

/// Trims a stored secret, treating blank values as absent.
pub fn non_blank(token: Option<String>) -> Option<String> {
   token
      .map(|token| token.trim().to_string())
      .filter(|token| !token.is_empty())
}

/// Validates a personal access token pasted into Settings.
pub fn normalize_personal_access_token(token: &str) -> Result<&str, String> {
   let token = token.trim();
   if token.is_empty() {
      return Err("Personal access token cannot be empty.".to_string());
   }
   Ok(token)
}

/// The `gh` CLI's token, re-read at most once a minute. Blocking: may spawn `gh`.
pub fn cached_gh_cli_token() -> Option<String> {
   GH_TOKEN_CACHE.get_or_load(gh_cli_token)
}

/// Drops the cached `gh` token so the next resolution re-reads it.
pub fn invalidate_gh_cli_token_cache() {
   GH_TOKEN_CACHE.invalidate();
}

struct TtlCache {
   ttl: Duration,
   value: Mutex<Option<(Instant, Option<String>)>>,
}

impl TtlCache {
   const fn new(ttl: Duration) -> Self {
      Self {
         ttl,
         value: Mutex::new(None),
      }
   }

   fn get_or_load(&self, load: impl FnOnce() -> Option<String>) -> Option<String> {
      let mut value = self.value.lock().ok()?;
      if let Some((read_at, token)) = value.as_ref()
         && read_at.elapsed() < self.ttl
      {
         return token.clone();
      }

      let token = load();
      *value = Some((Instant::now(), token.clone()));
      token
   }

   fn invalidate(&self) {
      if let Ok(mut value) = self.value.lock() {
         *value = None;
      }
   }
}

/// What the GitHub auth indicator in Settings shows.
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitHubTokenStatus {
   /// Which source supplied the active token, or `None` when there is none.
   pub source: Option<GitHubTokenSource>,
   pub has_personal_access_token: bool,
   pub has_athas_account_token: bool,
   pub gh_cli_installed: bool,
   /// The account the active token belongs to; `None` when GitHub rejected it.
   pub login: Option<String>,
   /// Scopes GitHub reports for the active token; `None` for fine-grained tokens.
   pub scopes: Option<String>,
}

/// Describes the active token by asking GitHub who it belongs to. Blocking: calls the API and may
/// spawn `gh`.
pub fn github_token_status(
   resolved: ResolvedGitHubToken,
   has_personal_access_token: bool,
   has_athas_account_token: bool,
) -> Result<GitHubTokenStatus, String> {
   let identity = github_describe_token(resolved.token)?;
   Ok(GitHubTokenStatus {
      source: resolved.source,
      has_personal_access_token,
      has_athas_account_token,
      gh_cli_installed: is_gh_cli_installed(),
      login: identity.as_ref().map(|identity| identity.login.clone()),
      scopes: identity.and_then(|identity| identity.scopes),
   })
}

/// Whether the `gh` CLI can supply a credential, for the one-click switch in empty states.
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GhCliAvailability {
   pub installed: bool,
   /// True when `gh` is also logged in, so switching to it would actually work.
   pub has_token: bool,
}

/// Blocking: may spawn `gh`.
pub fn gh_cli_availability() -> GhCliAvailability {
   let installed = is_gh_cli_installed();
   GhCliAvailability {
      installed,
      has_token: installed && cached_gh_cli_token().is_some(),
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::cell::Cell;

   fn sources(
      pat: Option<&str>,
      athas: Option<&str>,
      gh: Option<&str>,
   ) -> TokenSources<
      impl FnOnce() -> Option<String>,
      impl FnOnce() -> Option<String>,
      impl FnOnce() -> Option<String>,
   > {
      let (pat, athas, gh) = (
         pat.map(ToString::to_string),
         athas.map(ToString::to_string),
         gh.map(ToString::to_string),
      );
      TokenSources {
         personal_access_token: move || pat,
         athas_account_token: move || athas,
         gh_cli_token: move || gh,
      }
   }

   fn resolved(token: &str, source: GitHubTokenSource) -> ResolvedGitHubToken {
      ResolvedGitHubToken {
         token: Some(token.to_string()),
         source: Some(source),
      }
   }

   const NONE: ResolvedGitHubToken = ResolvedGitHubToken {
      token: None,
      source: None,
   };

   #[test]
   fn reads_the_source_preference_setting() {
      assert_eq!(
         TokenSourcePreference::from_setting(Some("athas")),
         TokenSourcePreference::Athas
      );
      assert_eq!(
         TokenSourcePreference::from_setting(Some("pat")),
         TokenSourcePreference::PersonalAccessToken
      );
      assert_eq!(
         TokenSourcePreference::from_setting(Some("gh")),
         TokenSourcePreference::GhCli
      );
      assert_eq!(
         TokenSourcePreference::from_setting(Some("auto")),
         TokenSourcePreference::Auto
      );
      assert_eq!(
         TokenSourcePreference::from_setting(None),
         TokenSourcePreference::Auto
      );
   }

   #[test]
   fn auto_prefers_the_pasted_token_then_the_account_then_gh() {
      use GitHubTokenSource::*;
      let auto = TokenSourcePreference::Auto;

      assert_eq!(
         resolve_token(auto, sources(Some(" pat "), Some("athas"), Some("gh"))),
         resolved("pat", PersonalAccessToken)
      );
      assert_eq!(
         resolve_token(auto, sources(Some("  "), Some("athas"), Some("gh"))),
         resolved("athas", Athas)
      );
      assert_eq!(
         resolve_token(auto, sources(None, None, Some("gh"))),
         resolved("gh", GhCli)
      );
      assert_eq!(resolve_token(auto, sources(None, None, None)), NONE);
   }

   #[test]
   fn a_pinned_source_never_falls_back() {
      use GitHubTokenSource::*;

      assert_eq!(
         resolve_token(
            TokenSourcePreference::Athas,
            sources(Some("pat"), Some("athas"), Some("gh"))
         ),
         resolved("athas", Athas)
      );
      assert_eq!(
         resolve_token(
            TokenSourcePreference::GhCli,
            sources(Some("pat"), Some("athas"), None)
         ),
         NONE
      );
      assert_eq!(
         resolve_token(
            TokenSourcePreference::PersonalAccessToken,
            sources(None, Some("athas"), Some("gh"))
         ),
         NONE
      );
   }

   #[test]
   fn only_consults_gh_when_needed() {
      let gh_reads = Cell::new(0);
      let resolved = resolve_token(
         TokenSourcePreference::Auto,
         TokenSources {
            personal_access_token: || Some("pat".to_string()),
            athas_account_token: || None,
            gh_cli_token: || {
               gh_reads.set(gh_reads.get() + 1);
               Some("gh".to_string())
            },
         },
      );

      assert_eq!(resolved.token.as_deref(), Some("pat"));
      assert_eq!(gh_reads.get(), 0);
   }

   #[test]
   fn caches_the_gh_token_until_invalidated_or_expired() {
      let cache = TtlCache::new(Duration::from_secs(60));
      let loads = Cell::new(0);
      let load = || {
         loads.set(loads.get() + 1);
         Some(format!("token-{}", loads.get()))
      };

      assert_eq!(cache.get_or_load(load).as_deref(), Some("token-1"));
      assert_eq!(cache.get_or_load(load).as_deref(), Some("token-1"));
      cache.invalidate();
      assert_eq!(cache.get_or_load(load).as_deref(), Some("token-2"));

      let expired = TtlCache::new(Duration::ZERO);
      assert_eq!(expired.get_or_load(|| None), None);
      assert_eq!(
         expired.get_or_load(|| Some("fresh".to_string())).as_deref(),
         Some("fresh")
      );
   }

   #[test]
   fn validates_pasted_personal_access_tokens() {
      assert_eq!(normalize_personal_access_token("  ghp_x \n"), Ok("ghp_x"));
      assert_eq!(
         normalize_personal_access_token("   "),
         Err("Personal access token cannot be empty.".to_string())
      );
      assert_eq!(non_blank(Some(" x ".into())), Some("x".to_string()));
      assert_eq!(non_blank(Some(" ".into())), None);
   }
}
