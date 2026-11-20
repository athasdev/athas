//! Providers that run on this machine or the local network (`services/local-ai-connection.ts`):
//! Ollama away from Ollama Cloud, or a custom OpenAI-compatible endpoint on a local host. Prompts
//! sent to them never leave the LAN, so a chat on one keeps its side requests (its title) there.

use crate::{ProviderSettings, catalog};

const LOCAL_HOST_SUFFIXES: &[&str] = &[".localhost", ".local", ".lan", ".home.arpa", ".internal"];

/// The lowercase host of an `http(s)://` URL (a bare host gets `http://`), or `None`.
fn hostname(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let rest = match trimmed.split_once("://") {
        Some((scheme, rest)) if !scheme.is_empty() && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) => rest,
        Some(_) => return None,
        None => trimmed,
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let authority = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let host = if let Some(bracketed) = authority.strip_prefix('[') {
        format!("[{}]", bracketed.split(']').next()?)
    } else {
        authority.split(':').next().unwrap_or_default().to_string()
    };
    (!host.is_empty()).then(|| host.to_lowercase())
}

fn is_private_ipv4(host: &str) -> bool {
    let parts: Vec<u8> = host.split('.').filter_map(|part| part.parse().ok()).collect();
    if parts.len() != 4 || host.split('.').count() != 4 {
        return false;
    }
    let (a, b) = (parts[0], parts[1]);
    a == 127
        || a == 10
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 169 && b == 254)
        // Carrier-grade NAT space, which Tailscale and similar private networks use.
        || (a == 100 && (64..=127).contains(&b))
        || host == "0.0.0.0"
}

fn is_private_ipv6(host: &str) -> bool {
    let address = host.trim_start_matches('[').trim_end_matches(']');
    address == "::1" || address.starts_with("fc") || address.starts_with("fd") || ["fe8", "fe9", "fea", "feb"].iter().any(|prefix| address.starts_with(prefix))
}

/// Whether `url` points at this machine or the local network (`isLocalEndpointUrl`).
pub fn is_local_endpoint_url(url: &str) -> bool {
    let Some(host) = hostname(url) else { return false };
    host == "localhost" || LOCAL_HOST_SUFFIXES.iter().any(|suffix| host.ends_with(suffix)) || is_private_ipv4(&host) || (host.contains(':') && is_private_ipv6(&host))
}

pub fn is_ollama_cloud_url(url: &str) -> bool {
    hostname(url).is_some_and(|host| host == "ollama.com" || host.ends_with(".ollama.com"))
}

/// Whether the provider `settings` pick runs locally (`isLocalAiProvider`).
pub fn is_local_provider(settings: &ProviderSettings) -> bool {
    match settings.provider_id.as_str() {
        catalog::OLLAMA => {
            let base = catalog::normalize_ollama_base_url(&settings.ollama_base_url);
            !is_ollama_cloud_url(&base) && is_local_endpoint_url(&base)
        }
        catalog::CUSTOM => is_local_endpoint_url(&settings.custom_base_url),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_endpoints_are_this_machine_or_the_lan() {
        for url in ["http://localhost:11434", "http://127.0.0.1:8080/v1", "http://gpu.local", "http://box.lan", "https://10.0.0.4", "http://192.168.1.20:1234", "http://172.20.0.1", "http://100.64.1.2", "http://[::1]:11434", "http://[fd00::1]", "localhost:11434", "http://user@nas.home.arpa"] {
            assert!(is_local_endpoint_url(url), "{url}");
        }
        for url in ["https://api.openai.com/v1", "https://ollama.com", "http://172.32.0.1", "http://8.8.8.8", "http://1.2.3", "", "not a url://x"] {
            assert!(!is_local_endpoint_url(url), "{url}");
        }
    }

    #[test]
    fn only_ollama_and_custom_can_be_local() {
        let settings = |provider: &str, ollama: &str, custom: &str| ProviderSettings { provider_id: provider.into(), ollama_base_url: ollama.into(), custom_base_url: custom.into(), ..Default::default() };
        assert!(is_local_provider(&settings("ollama", "", "")));
        assert!(!is_local_provider(&settings("ollama", "https://ollama.com", "")));
        assert!(is_local_provider(&settings("custom", "", "http://127.0.0.1:1234/v1")));
        assert!(!is_local_provider(&settings("custom", "", "https://openrouter.ai/api/v1")));
        assert!(!is_local_provider(&settings("openai", "", "http://localhost")));
    }
}
