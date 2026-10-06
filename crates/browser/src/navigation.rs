use url::Url;

/// What a browser tab does with a navigation, whether the user or the page started it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDecision {
   /// Load it in the tab.
   Allow,
   /// Hand it to the operating system, as a browser does for a `mailto:` link.
   OpenExternally,
   /// Drop it.
   Block,
}

/// Schemes a page may hand to the operating system. Anything else that is not a
/// web page is dropped, so a page can't launch arbitrary apps through their URL
/// schemes.
const EXTERNAL_SCHEMES: &[&str] = &["mailto", "tel", "sms"];

/// Schemes Tauri serves the workbench and its assets from. On Windows they are
/// reached as `http(s)://<scheme>.localhost`.
const APP_PROTOCOLS: &[&str] = &["tauri", "asset", "ipc"];

/// Parses an address the user asked a tab to load. Tabs load web pages and the
/// blank page only; turning typed text into a URL or a search happens in the
/// frontend before this.
pub fn parse_browser_url(input: &str) -> Result<Url, String> {
   let url = Url::parse(input.trim()).map_err(|error| format!("Invalid URL: {error}"))?;
   match url.scheme() {
      "http" | "https" => Ok(url),
      "about" if url.path() == "blank" => Ok(url),
      scheme => Err(format!("Browser tabs can't open {scheme}: URLs")),
   }
}

/// The origins the workbench itself is served from. A tab never loads them:
/// Tauri treats those pages as the app and grants them the workbench's
/// permissions.
pub fn app_origins(dev_url: Option<&Url>) -> Vec<Url> {
   let mut origins = dev_url.into_iter().cloned().collect::<Vec<_>>();
   for protocol in APP_PROTOCOLS {
      for scheme in ["http", "https"] {
         if let Ok(origin) = Url::parse(&format!("{scheme}://{protocol}.localhost/")) {
            origins.push(origin);
         }
      }
   }
   origins
}

/// Decides a navigation inside a tab, including navigations of its frames.
pub fn decide_navigation(url: &Url, app_origins: &[Url]) -> NavigationDecision {
   match url.scheme() {
      "http" | "https" => {
         if app_origins
            .iter()
            .any(|origin| origin.origin() == url.origin())
         {
            NavigationDecision::Block
         } else {
            NavigationDecision::Allow
         }
      }
      "about" | "blob" | "data" => NavigationDecision::Allow,
      scheme if EXTERNAL_SCHEMES.contains(&scheme) => NavigationDecision::OpenExternally,
      _ => NavigationDecision::Block,
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   fn url(value: &str) -> Url {
      Url::parse(value).unwrap()
   }

   #[test]
   fn parses_web_pages_and_the_blank_page() {
      assert_eq!(
         parse_browser_url(" https://athas.dev/docs ")
            .unwrap()
            .as_str(),
         "https://athas.dev/docs"
      );
      assert_eq!(
         parse_browser_url("http://localhost:5173").unwrap().as_str(),
         "http://localhost:5173/"
      );
      assert_eq!(
         parse_browser_url("about:blank").unwrap().as_str(),
         "about:blank"
      );
   }

   #[test]
   fn rejects_addresses_that_are_not_web_pages() {
      assert!(parse_browser_url("file:///etc/passwd").is_err());
      assert!(parse_browser_url("javascript:alert(1)").is_err());
      assert!(parse_browser_url("tauri://localhost/").is_err());
      assert!(parse_browser_url("about:config").is_err());
      assert!(parse_browser_url("athas.dev").is_err());
   }

   #[test]
   fn loads_web_pages_and_hands_mail_links_to_the_system() {
      let origins = app_origins(None);
      assert_eq!(
         decide_navigation(&url("https://github.com/athasdev"), &origins),
         NavigationDecision::Allow
      );
      assert_eq!(
         decide_navigation(&url("http://localhost:3000/"), &origins),
         NavigationDecision::Allow
      );
      assert_eq!(
         decide_navigation(&url("about:blank"), &origins),
         NavigationDecision::Allow
      );
      assert_eq!(
         decide_navigation(&url("mailto:hello@athas.dev"), &origins),
         NavigationDecision::OpenExternally
      );
   }

   #[test]
   fn never_loads_the_workbench_or_local_files() {
      let dev_url = url("http://127.0.0.1:1420");
      let origins = app_origins(Some(&dev_url));
      for blocked in [
         "http://127.0.0.1:1420/index.html",
         "http://tauri.localhost/",
         "https://ipc.localhost/plugin",
         "http://asset.localhost/Users/me/secret",
         "tauri://localhost/",
         "asset://localhost/etc/hosts",
         "file:///etc/hosts",
         "vscode://open",
      ] {
         assert_eq!(
            decide_navigation(&url(blocked), &origins),
            NavigationDecision::Block,
            "{blocked}"
         );
      }
      assert_eq!(
         decide_navigation(&url("http://127.0.0.1:1421/"), &origins),
         NavigationDecision::Allow
      );
   }
}
