//! What the address bar turns typed text into, and how a page is named.
//!
//! Ported from Athas's `features/browser/services/browser-address.ts`.

use std::sync::LazyLock;

use regex::Regex;

pub const BLANK_PAGE_URL: &str = "about:blank";

const SEARCH_URL: &str = "https://www.google.com/search?q=";

static SCHEME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[a-z][a-z0-9+.-]*:").unwrap());
static HOST_WITH_PORT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[^:]+:\d").unwrap());
static LOCAL_HOST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(localhost|\[[0-9a-f:]+\]|(\d{1,3}\.){3}\d{1,3}|[\w-]+\.(localhost|local|test|internal))(:\d+)?([/?#]|$)").unwrap()
});
static DOMAIN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]|$)").unwrap());
static PORT_ONLY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^:\d+").unwrap());

/// Turns what the user typed into the address bar into a URL to load: a web address as typed, a
/// host without a scheme (`localhost:5173`, `athas.dev/docs`), or a web search for anything else.
pub fn resolve_browser_address(input: &str) -> Option<String> {
    let value = input.trim();
    if value.is_empty() {
        return None;
    }
    if PORT_ONLY.is_match(value) {
        return Some(format!("http://localhost{value}"));
    }
    if SCHEME.is_match(value) && !HOST_WITH_PORT.is_match(value) {
        let scheme = value[..value.find(':').unwrap_or(0)].to_ascii_lowercase();
        if scheme == "http" || scheme == "https" {
            return Some(value.to_string());
        }
        if value.eq_ignore_ascii_case(BLANK_PAGE_URL) {
            return Some(BLANK_PAGE_URL.to_string());
        }
        return Some(search_url(value));
    }
    if !value.chars().any(char::is_whitespace) {
        if LOCAL_HOST.is_match(value) {
            return Some(format!("http://{value}"));
        }
        if DOMAIN.is_match(value) {
            return Some(format!("https://{value}"));
        }
    }
    Some(search_url(value))
}

fn search_url(query: &str) -> String {
    format!("{SEARCH_URL}{}", encode_uri_component(query))
}

/// `encodeURIComponent`: everything but letters, digits and `-_.!~*'()` is percent-encoded.
pub fn encode_uri_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

pub fn is_blank_page(url: &str) -> bool {
    url.is_empty() || url == BLANK_PAGE_URL
}

/// The address as the address bar shows it while the user is not editing it.
pub fn format_browser_address(url: &str) -> &str {
    if is_blank_page(url) { "" } else { url }
}

/// Name of a browser tab: the page title, or its host until the page has one.
pub fn browser_tab_name(url: &str, title: Option<&str>) -> String {
    if let Some(title) = title.map(str::trim).filter(|title| !title.is_empty()) {
        return title.to_string();
    }
    if is_blank_page(url) {
        return "New Tab".into();
    }
    match url::Url::parse(url) {
        Ok(parsed) => match parsed.host_str() {
            Some(host) => match parsed.port() {
                Some(port) => format!("{host}:{port}"),
                None => host.to_string(),
            },
            None => url.to_string(),
        },
        Err(_) => url.to_string(),
    }
}

pub fn is_secure_address(url: &str) -> bool {
    url.starts_with("https://")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(input: &str) -> Option<String> {
        resolve_browser_address(input)
    }

    #[test]
    fn keeps_full_web_addresses_as_typed() {
        assert_eq!(resolve(" https://athas.dev/docs ").as_deref(), Some("https://athas.dev/docs"));
        assert_eq!(resolve("http://localhost:3000/api?x=1").as_deref(), Some("http://localhost:3000/api?x=1"));
        assert_eq!(resolve("about:blank").as_deref(), Some("about:blank"));
    }

    #[test]
    fn opens_local_development_servers_over_http() {
        assert_eq!(resolve("localhost:5173").as_deref(), Some("http://localhost:5173"));
        assert_eq!(resolve("localhost").as_deref(), Some("http://localhost"));
        assert_eq!(resolve("127.0.0.1:8080/health").as_deref(), Some("http://127.0.0.1:8080/health"));
        assert_eq!(resolve("[::1]:3000").as_deref(), Some("http://[::1]:3000"));
        assert_eq!(resolve("app.localhost:3000").as_deref(), Some("http://app.localhost:3000"));
        assert_eq!(resolve(":4321").as_deref(), Some("http://localhost:4321"));
    }

    #[test]
    fn opens_bare_domains_over_https() {
        assert_eq!(resolve("athas.dev").as_deref(), Some("https://athas.dev"));
        assert_eq!(resolve("github.com/athasdev/athas").as_deref(), Some("https://github.com/athasdev/athas"));
        assert_eq!(resolve("docs.rs:443/tauri").as_deref(), Some("https://docs.rs:443/tauri"));
    }

    #[test]
    fn searches_for_anything_that_is_not_an_address() {
        assert_eq!(resolve("tauri child webview").as_deref(), Some("https://www.google.com/search?q=tauri%20child%20webview"));
        assert_eq!(resolve("react").as_deref(), Some("https://www.google.com/search?q=react"));
        assert_eq!(resolve("file:///etc/hosts").as_deref(), Some("https://www.google.com/search?q=file%3A%2F%2F%2Fetc%2Fhosts"));
        assert_eq!(resolve("javascript:alert(1)").as_deref(), Some("https://www.google.com/search?q=javascript%3Aalert(1)"));
    }

    #[test]
    fn ignores_empty_input() {
        assert_eq!(resolve("   "), None);
    }

    #[test]
    fn names_tabs_by_title_then_host() {
        assert_eq!(browser_tab_name("https://athas.dev/docs", Some(" Athas Docs ")), "Athas Docs");
        assert_eq!(browser_tab_name("http://localhost:5173/", None), "localhost:5173");
        assert_eq!(browser_tab_name("about:blank", None), "New Tab");
    }

    #[test]
    fn every_resolved_address_is_one_a_tab_may_load() {
        for input in ["localhost:5173", "athas.dev", "react hooks", ":3000", "about:blank", "javascript:alert(1)"] {
            let url = resolve(input).unwrap();
            assert!(athas_browser::parse_browser_url(&url).is_ok(), "{input} -> {url}");
        }
    }
}
