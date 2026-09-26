//! Fetches the ACP Registry and keeps a copy in the app data directory, so the agent list works
//! offline and the registry is downloaded at most once an hour unless the user asks for it.

use super::schema::{RegistryAgent, is_valid_agent_id, parse_quarantine, parse_registry};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::{
   collections::HashMap,
   fs,
   path::{Path, PathBuf},
   time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const REGISTRY_URL: &str =
   "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
/// Tried in order; the CDN does not publish the quarantine list today, the repository does.
pub const QUARANTINE_URLS: &[&str] = &[
   "https://cdn.agentclientprotocol.com/registry/v1/latest/quarantine.json",
   "https://raw.githubusercontent.com/agentclientprotocol/registry/main/quarantine.json",
];
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(60 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ICON_BYTES: usize = 256 * 1024;

const REGISTRY_FILE: &str = "registry.json";
const QUARANTINE_FILE: &str = "quarantine.json";
const STATE_FILE: &str = "state.json";
const ICONS_DIR: &str = "icons";

/// What Athas knows about the registry right now.
#[derive(Debug, Clone, Default)]
pub struct RegistrySnapshot {
   pub agents: Vec<RegistryAgent>,
   /// Agent id to the reason the registry quarantined it.
   pub quarantine: HashMap<String, String>,
   /// Agent id to a `data:` URL of its cached icon.
   pub icons: HashMap<String, String>,
   /// When the registry was last downloaded, if ever.
   pub fetched_at: Option<SystemTime>,
}

impl RegistrySnapshot {
   pub fn agent(&self, id: &str) -> Option<&RegistryAgent> {
      self.agents.iter().find(|agent| agent.id == id)
   }
}

/// An HTTP client that only follows HTTPS redirects.
pub fn https_client() -> Result<reqwest::Client, String> {
   reqwest::Client::builder()
      .redirect(reqwest::redirect::Policy::custom(|attempt| {
         if attempt.url().scheme() != "https" {
            attempt.error("refusing a redirect away from HTTPS")
         } else if attempt.previous().len() >= 10 {
            attempt.error("too many redirects")
         } else {
            attempt.follow()
         }
      }))
      .https_only(true)
      .build()
      .map_err(|error| format!("Failed to create HTTP client: {error}"))
}

pub struct RegistryStore {
   cache_dir: PathBuf,
   snapshot: Option<RegistrySnapshot>,
}

impl RegistryStore {
   pub fn new(cache_dir: PathBuf) -> Self {
      Self {
         cache_dir,
         snapshot: None,
      }
   }

   /// The registry, downloaded again when the copy is over an hour old or `force` is set. When
   /// the download fails the last copy on disk is used.
   pub async fn snapshot(&mut self, force: bool) -> RegistrySnapshot {
      if self.snapshot.is_none() {
         self.snapshot = load_cached(&self.cache_dir);
      }
      let fresh = self
         .snapshot
         .as_ref()
         .is_some_and(|snapshot| is_fresh(snapshot.fetched_at, SystemTime::now()));
      if fresh && !force {
         return self.snapshot.clone().unwrap_or_default();
      }

      match fetch_and_cache(&self.cache_dir).await {
         Ok(snapshot) => self.snapshot = Some(snapshot),
         Err(error) => log::warn!("ACP registry refresh failed, using the cached copy: {error}"),
      }
      self.snapshot.clone().unwrap_or_default()
   }
}

pub fn is_fresh(fetched_at: Option<SystemTime>, now: SystemTime) -> bool {
   fetched_at
      .and_then(|fetched_at| now.duration_since(fetched_at).ok())
      .is_some_and(|age| age < REFRESH_INTERVAL)
}

/// Reads the copy on disk. `None` when there is none or it cannot be parsed.
pub fn load_cached(cache_dir: &Path) -> Option<RegistrySnapshot> {
   let body = fs::read_to_string(cache_dir.join(REGISTRY_FILE)).ok()?;
   let agents = parse_registry(&body)
      .map_err(|error| log::warn!("Ignoring the cached ACP registry: {error}"))
      .ok()?;
   let quarantine = fs::read_to_string(cache_dir.join(QUARANTINE_FILE))
      .ok()
      .and_then(|body| parse_quarantine(&body).ok())
      .unwrap_or_default();
   let fetched_at = fs::read_to_string(cache_dir.join(STATE_FILE))
      .ok()
      .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
      .and_then(|state| state.get("fetchedAt")?.as_u64())
      .map(|seconds| UNIX_EPOCH + Duration::from_secs(seconds));
   let icons = cached_icons(cache_dir, &agents);
   Some(RegistrySnapshot {
      agents,
      quarantine,
      icons,
      fetched_at,
   })
}

async fn fetch_and_cache(cache_dir: &Path) -> Result<RegistrySnapshot, String> {
   let client = https_client()?;
   let body = fetch_text(&client, REGISTRY_URL)
      .await?
      .ok_or_else(|| "The ACP registry was not found".to_string())?;
   // Parse before writing so a broken download never replaces a good copy.
   parse_registry(&body)?;

   let mut quarantine_body = None;
   for url in QUARANTINE_URLS {
      match fetch_text(&client, url).await {
         Ok(Some(body)) if parse_quarantine(&body).is_ok() => {
            quarantine_body = Some(body);
            break;
         }
         Ok(_) => {}
         Err(error) => log::debug!("ACP registry quarantine unavailable at {url}: {error}"),
      }
   }

   fs::create_dir_all(cache_dir).map_err(|error| error.to_string())?;
   write_atomically(&cache_dir.join(REGISTRY_FILE), body.as_bytes())?;
   match quarantine_body {
      Some(body) => write_atomically(&cache_dir.join(QUARANTINE_FILE), body.as_bytes())?,
      // Keep an earlier list only when this refresh could not reach one at all.
      None => log::debug!("No ACP registry quarantine list was downloaded"),
   }
   let fetched_at = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_secs())
      .unwrap_or_default();
   write_atomically(
      &cache_dir.join(STATE_FILE),
      serde_json::json!({ "fetchedAt": fetched_at })
         .to_string()
         .as_bytes(),
   )?;

   let agents = parse_registry(&body)?;
   cache_icons(&client, cache_dir, &agents).await;
   load_cached(cache_dir).ok_or_else(|| "The ACP registry cache could not be read".to_string())
}

/// `Ok(None)` for 404, so a missing optional file is not an error.
async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<Option<String>, String> {
   let response = client
      .get(url)
      .timeout(REQUEST_TIMEOUT)
      .send()
      .await
      .map_err(|error| error.to_string())?;
   if response.status() == reqwest::StatusCode::NOT_FOUND {
      return Ok(None);
   }
   if !response.status().is_success() {
      return Err(format!("HTTP {}", response.status()));
   }
   response
      .text()
      .await
      .map(Some)
      .map_err(|error| error.to_string())
}

pub fn write_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
   let temp = path.with_extension("tmp");
   fs::write(&temp, contents).map_err(|error| format!("Failed to write {temp:?}: {error}"))?;
   fs::rename(&temp, path).map_err(|error| format!("Failed to write {path:?}: {error}"))
}

/// Icons are cached by agent id and a hash of their URL, so a new icon URL is downloaded again.
fn icon_file(cache_dir: &Path, agent_id: &str, url: &str) -> PathBuf {
   let digest = Sha256::digest(url.as_bytes());
   let hash = digest
      .iter()
      .take(6)
      .map(|byte| format!("{byte:02x}"))
      .collect::<String>();
   cache_dir
      .join(ICONS_DIR)
      .join(format!("{agent_id}-{hash}.svg"))
}

fn icon_url(agent: &RegistryAgent) -> Option<&str> {
   agent
      .icon
      .as_deref()
      .filter(|url| url.starts_with("https://") && is_valid_agent_id(&agent.id))
}

async fn cache_icons(client: &reqwest::Client, cache_dir: &Path, agents: &[RegistryAgent]) {
   if fs::create_dir_all(cache_dir.join(ICONS_DIR)).is_err() {
      return;
   }
   let downloads = agents.iter().filter_map(|agent| {
      let url = icon_url(agent)?;
      let path = icon_file(cache_dir, &agent.id, url);
      if path.is_file() {
         return None;
      }
      Some(async move {
         match fetch_text(client, url).await {
            Ok(Some(svg)) if is_plausible_svg(&svg) => {
               if let Err(error) = write_atomically(&path, svg.as_bytes()) {
                  log::debug!("Failed to cache ACP agent icon: {error}");
               }
            }
            Ok(_) => log::debug!("Ignoring ACP agent icon at {url}"),
            Err(error) => log::debug!("Failed to download ACP agent icon {url}: {error}"),
         }
      })
   });
   futures::future::join_all(downloads).await;
}

fn is_plausible_svg(body: &str) -> bool {
   let trimmed = body.trim_start();
   body.len() <= MAX_ICON_BYTES
      && (trimmed.starts_with("<svg") || trimmed.starts_with("<?xml"))
      && body.contains("<svg")
}

fn cached_icons(cache_dir: &Path, agents: &[RegistryAgent]) -> HashMap<String, String> {
   agents
      .iter()
      .filter_map(|agent| {
         let path = icon_file(cache_dir, &agent.id, icon_url(agent)?);
         let svg = fs::read(path).ok()?;
         let encoded = base64::engine::general_purpose::STANDARD.encode(svg);
         Some((
            agent.id.clone(),
            format!("data:image/svg+xml;base64,{encoded}"),
         ))
      })
      .collect()
}

#[cfg(test)]
mod tests {
   use super::*;

   const REGISTRY: &str = r#"{ "version": "1.0.0", "agents": [
      { "id": "goose", "name": "Goose", "version": "1.52.0",
        "icon": "https://cdn.example.com/goose.svg",
        "distribution": { "npx": { "package": "goose@1.52.0" } } }
   ] }"#;

   #[test]
   fn a_copy_is_fresh_for_an_hour() {
      let now = SystemTime::now();
      assert!(is_fresh(Some(now - Duration::from_secs(59 * 60)), now));
      assert!(!is_fresh(Some(now - Duration::from_secs(61 * 60)), now));
      assert!(!is_fresh(None, now));
   }

   #[test]
   fn loads_the_cached_registry_quarantine_and_icons() {
      let dir = tempfile::tempdir().unwrap();
      fs::write(dir.path().join(REGISTRY_FILE), REGISTRY).unwrap();
      fs::write(dir.path().join(QUARANTINE_FILE), r#"{ "goose": "Broken" }"#).unwrap();
      fs::write(dir.path().join(STATE_FILE), r#"{ "fetchedAt": 1000 }"#).unwrap();
      let icon = icon_file(dir.path(), "goose", "https://cdn.example.com/goose.svg");
      fs::create_dir_all(icon.parent().unwrap()).unwrap();
      fs::write(&icon, "<svg/>").unwrap();

      let snapshot = load_cached(dir.path()).unwrap();
      assert_eq!(snapshot.agents.len(), 1);
      assert_eq!(snapshot.quarantine["goose"], "Broken");
      assert_eq!(
         snapshot.fetched_at,
         Some(UNIX_EPOCH + Duration::from_secs(1000))
      );
      assert!(snapshot.icons["goose"].starts_with("data:image/svg+xml;base64,"));
   }

   #[test]
   fn a_missing_or_broken_cache_loads_nothing() {
      let dir = tempfile::tempdir().unwrap();
      assert!(load_cached(dir.path()).is_none());
      fs::write(dir.path().join(REGISTRY_FILE), "{").unwrap();
      assert!(load_cached(dir.path()).is_none());
   }

   #[test]
   fn only_svg_icons_are_cached() {
      assert!(is_plausible_svg(
         "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
      ));
      assert!(is_plausible_svg("<?xml version=\"1.0\"?><svg/>"));
      assert!(!is_plausible_svg("<html><body>Not found</body></html>"));
   }
}
