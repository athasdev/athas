//! The links the app itself offers -- a provider's key page, the docs, a pricing page -- carry a
//! `utm_source`, so the site they open can see the visit came from Athas, the way a link out of
//! ChatGPT carries `utm_source=chatgpt.com`.
//!
//! Only a plain web page is tagged. A download, an API or raw-content host, a loopback address, a
//! link that already names its source and anything that is not `http(s)` is opened as it is, so a
//! signed URL keeps working. Links the user brought with them -- a chat message, a preview, a
//! repository of theirs -- are opened with `cx.open_url` and stay untouched.

use std::borrow::Cow;

use gpui::App;

/// What another site sees as the source of the visit.
const SOURCE: &str = "athas.dev";

/// What athas.dev sees, rather than itself as the referrer.
const OWN_SOURCE: &str = "athas-app";

/// Hosts that serve files or APIs instead of pages; their URLs are often signed.
const UNTAGGED_HOSTS: &[&str] = &["codeload.github.com", "registry.npmjs.org", "crates.io"];

/// Paths that end in a download rather than a page.
const UNTAGGED_SUFFIXES: &[&str] = &[".zip", ".tar.gz", ".tgz", ".gz", ".dmg", ".exe", ".msi", ".appimage", ".deb", ".rpm", ".pkg", ".json", ".xml"];

/// A web page the app sends someone to, tagged with where it came from.
pub fn outbound(url: &str) -> Cow<'_, str> {
    let rest = ["https://", "http://"].iter().find_map(|scheme| url.get(..scheme.len()).filter(|start| start.eq_ignore_ascii_case(scheme)).map(|_| &url[scheme.len()..]));
    let Some(rest) = rest else { return Cow::Borrowed(url) };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host = authority.rsplit('@').next().unwrap_or(authority).rsplit_once(':').map_or(authority, |(host, _)| host).to_ascii_lowercase();
    let path = rest[authority.len()..].split(['?', '#']).next().unwrap_or_default().to_ascii_lowercase();
    if host.is_empty() || !taggable(&host, &path) || names_a_source(rest) {
        return Cow::Borrowed(url);
    }
    let source = match is_own(&host) {
        true => OWN_SOURCE,
        false => SOURCE,
    };
    let (base, fragment) = url.split_once('#').map_or((url, ""), |(base, fragment)| (base, fragment));
    let separator = match base.contains('?') {
        true if base.ends_with(['?', '&']) => "",
        true => "&",
        false => "?",
    };
    let fragment = match fragment.is_empty() && !url.contains('#') {
        true => String::new(),
        false => format!("#{fragment}"),
    };
    Cow::Owned(format!("{base}{separator}utm_source={source}{fragment}"))
}

/// Athas's own site, which sees the app as the source rather than itself.
fn is_own(host: &str) -> bool {
    host == "athas.dev" || host.ends_with(".athas.dev")
}

fn taggable(host: &str, path: &str) -> bool {
    let local = host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.starts_with('[')
        || host.split('.').all(|label| !label.is_empty() && label.bytes().all(|byte| byte.is_ascii_digit()));
    !local
        && !host.starts_with("api.")
        && !host.ends_with(".githubusercontent.com")
        && !host.ends_with(".amazonaws.com")
        && !UNTAGGED_HOSTS.contains(&host)
        && !UNTAGGED_SUFFIXES.iter().any(|suffix| path.ends_with(suffix))
}

/// Whether the query already carries a `utm_source`, as a share link out of the website does.
fn names_a_source(rest: &str) -> bool {
    let Some(query) = rest.split('#').next().and_then(|rest| rest.split_once('?')).map(|(_, query)| query) else {
        return false;
    };
    query.split('&').any(|pair| pair.split('=').next().is_some_and(|name| name.eq_ignore_ascii_case("utm_source")))
}

/// Opening a link the app offers, rather than one the user brought with them.
pub trait OpenOutbound {
    /// Opens a page of ours or of another site, tagged with Athas as the source.
    fn open_outbound(&mut self, url: &str);
}

impl OpenOutbound for App {
    fn open_outbound(&mut self, url: &str) {
        self.open_url(&outbound(url));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn another_site_sees_athas_as_the_source() {
        assert_eq!(outbound("https://console.anthropic.com/settings/keys"), "https://console.anthropic.com/settings/keys?utm_source=athas.dev");
        assert_eq!(outbound("https://github.com/athasdev/athas/issues/new?template=01-bug.yml"), "https://github.com/athasdev/athas/issues/new?template=01-bug.yml&utm_source=athas.dev");
        assert_eq!(outbound("https://openrouter.ai/keys#tab"), "https://openrouter.ai/keys?utm_source=athas.dev#tab");
        assert_eq!(outbound("https://vercel.com/dashboard/ai-gateway?"), "https://vercel.com/dashboard/ai-gateway?utm_source=athas.dev");
        assert_eq!(outbound("HTTPS://Console.X.AI"), "HTTPS://Console.X.AI?utm_source=athas.dev");
    }

    #[test]
    fn our_own_site_sees_the_app() {
        assert_eq!(outbound("https://athas.dev/pricing"), "https://athas.dev/pricing?utm_source=athas-app");
        assert_eq!(outbound("https://cloud.athas.dev/workspaces/1"), "https://cloud.athas.dev/workspaces/1?utm_source=athas-app");
    }

    #[test]
    fn downloads_local_servers_and_tagged_links_are_left_alone() {
        for url in [
            "http://localhost:5173/",
            "http://127.0.0.1:3000/dashboard",
            "https://objects.githubusercontent.com/release.dmg",
            "https://api.github.com/repos/athasdev/athas",
            "https://github.com/athasdev/athas/archive/refs/tags/v1.zip",
            "https://athas.dev/s/abc?utm_source=share",
            "mailto:hey@athas.dev?subject=Athas%20bug%20report",
            "file:///Users/me/notes.md",
            "x-apple.systempreferences:com.apple.preference.security",
        ] {
            assert_eq!(outbound(url), url, "{url} should be opened as it is");
        }
    }
}
