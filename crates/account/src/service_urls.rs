//! Where the account service and website live (`src/config/services.json`), with the same
//! development overrides: `ATHAS_API_URL` for the API and `ATHAS_WEBSITE_URL` for the website.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceUrls {
    pub api_base: String,
    pub website: String,
}

pub const DEFAULT_API_BASE: &str = "https://athas.dev";
pub const DEFAULT_WEBSITE: &str = "https://athas.dev";
pub const COMMUNITY_URL: &str = "https://discord.gg/DD8F38wFMv";
pub const GITHUB_RELEASES_URL: &str = "https://github.com/athasdev/athas/releases";
pub const BUG_REPORT_URL: &str = "https://github.com/athasdev/athas/issues/new?template=01-bug.yml";

impl Default for ServiceUrls {
    fn default() -> Self {
        Self { api_base: DEFAULT_API_BASE.into(), website: DEFAULT_WEBSITE.into() }
    }
}

fn trim(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

/// Whether a base points at this machine, such as a local development server.
pub fn is_local(base: &str) -> bool {
    base.contains("localhost") || base.contains("127.0.0.1")
}

impl ServiceUrls {
    /// The defaults, overridden by `ATHAS_API_URL` and `ATHAS_WEBSITE_URL`. A release build
    /// ignores a local API override, as the Tauri app does.
    pub fn from_env() -> Self {
        Self::from_overrides(std::env::var("ATHAS_API_URL").ok(), std::env::var("ATHAS_WEBSITE_URL").ok(), cfg!(debug_assertions))
    }

    pub fn from_overrides(api: Option<String>, website: Option<String>, allow_local: bool) -> Self {
        let api_base = api
            .map(|value| trim(&value))
            .filter(|value| !value.is_empty() && (allow_local || !is_local(value)))
            .unwrap_or_else(|| DEFAULT_API_BASE.into());
        let website = website.map(|value| trim(&value)).filter(|value| !value.is_empty()).unwrap_or_else(|| DEFAULT_WEBSITE.into());
        Self { api_base, website }
    }

    /// Points both the API and the website at one server, as tests and local servers do.
    pub fn local(base: &str) -> Self {
        Self { api_base: trim(base), website: trim(base) }
    }

    pub fn docs(&self) -> String {
        format!("{}/docs", self.website)
    }
    pub fn telemetry_docs(&self) -> String {
        format!("{}/docs/telemetry", self.website)
    }
    pub fn pricing(&self) -> String {
        format!("{}/pricing", self.website)
    }
    pub fn dashboard(&self) -> String {
        format!("{}/dashboard", self.website)
    }
    pub fn billing(&self) -> String {
        format!("{}/dashboard/settings/billing", self.website)
    }
    pub fn integrations(&self) -> String {
        format!("{}/dashboard/settings/integrations", self.website)
    }
    pub fn collaboration(&self) -> String {
        format!("{}/dashboard/collaboration", self.website)
    }
    pub fn sharing_library(&self) -> String {
        format!("{}/dashboard/settings/sharing", self.website)
    }
    /// The web page of a shared item.
    pub fn share(&self, id: &str) -> String {
        format!("{}/s/{id}", self.website)
    }

    /// The API host as an error message names it.
    pub fn api_host(&self) -> String {
        url::Url::parse(&self.api_base)
            .ok()
            .and_then(|url| url.host_str().map(|host| match url.port() {
                Some(port) => format!("{host}:{port}"),
                None => host.to_string(),
            }))
            .unwrap_or_else(|| self.api_base.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_athas() {
        let urls = ServiceUrls::from_overrides(None, None, true);
        assert_eq!(urls.api_base, "https://athas.dev");
        assert_eq!(urls.billing(), "https://athas.dev/dashboard/settings/billing");
        assert_eq!(urls.share("abc"), "https://athas.dev/s/abc");
        assert_eq!(urls.api_host(), "athas.dev");
    }

    #[test]
    fn overrides_trim_and_release_builds_ignore_local_apis() {
        let urls = ServiceUrls::from_overrides(Some(" http://localhost:3000/ ".into()), Some("https://staging.athas.dev/".into()), true);
        assert_eq!(urls.api_base, "http://localhost:3000");
        assert_eq!(urls.api_host(), "localhost:3000");
        assert_eq!(urls.pricing(), "https://staging.athas.dev/pricing");
        let release = ServiceUrls::from_overrides(Some("http://127.0.0.1:3000".into()), None, false);
        assert_eq!(release.api_base, DEFAULT_API_BASE);
    }
}
