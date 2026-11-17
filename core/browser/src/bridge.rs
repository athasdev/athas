use serde::{Deserialize, Serialize};
use url::Url;

const BRIDGE_SCRIPT: &str = include_str!("bridge.js");
const KEY_BINDINGS_PLACEHOLDER: &str = "__ATHAS_BROWSER_KEY_BINDINGS__";

/// Longest favicon URL a page may report; larger `data:` icons are ignored.
const MAX_FAVICON_URL_LEN: usize = 64 * 1024;

/// A workbench shortcut the bridge intercepts while a page has focus, so the
/// keys reach Athas instead of the page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowserKeyBinding {
   pub command: String,
   /// `KeyboardEvent.key`, lowercased. Ignored when `code` is set.
   pub key: String,
   /// `KeyboardEvent.code`, for keys whose character depends on Shift.
   pub code: Option<String>,
   pub meta: bool,
   pub ctrl: bool,
   pub alt: bool,
   pub shift: bool,
}

/// A report from the bridge script running in a page.
///
/// Pages share their JavaScript world with the bridge, so any page can send
/// these. Nothing here is trusted: addresses are read from the webview itself,
/// and shortcuts are only accepted for commands the tab was created with.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
   tag = "kind",
   rename_all = "camelCase",
   rename_all_fields = "camelCase"
)]
pub enum BridgeMessage {
   Focus,
   Location {
      can_go_back: Option<bool>,
      can_go_forward: Option<bool>,
   },
   Favicon {
      href: Option<String>,
   },
   Shortcut {
      command: String,
   },
}

/// The script injected into the main frame of every page a tab loads.
pub fn bridge_script(key_bindings: &[BrowserKeyBinding]) -> String {
   let bindings = serde_json::to_string(key_bindings).unwrap_or_else(|_| "[]".to_string());
   BRIDGE_SCRIPT.replace(KEY_BINDINGS_PLACEHOLDER, &bindings)
}

/// Keeps a favicon URL the workbench can show in a tab: a web address or an
/// inline image of reasonable size.
pub fn sanitize_favicon_url(href: Option<&str>) -> Option<String> {
   let href = href?.trim();
   if href.is_empty() || href.len() > MAX_FAVICON_URL_LEN {
      return None;
   }
   let url = Url::parse(href).ok()?;
   match url.scheme() {
      "http" | "https" => Some(url.to_string()),
      "data" if url.path().starts_with("image/") => Some(href.to_string()),
      _ => None,
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn embeds_key_bindings_as_json() {
      let script = bridge_script(&[BrowserKeyBinding {
         command: "workbench.commandPalette".to_string(),
         key: "p".to_string(),
         code: None,
         meta: true,
         ctrl: false,
         alt: false,
         shift: true,
      }]);

      assert!(!script.contains(KEY_BINDINGS_PLACEHOLDER));
      assert!(script.contains(r#"[{"command":"workbench.commandPalette","key":"p","code":null,"meta":true,"ctrl":false,"alt":false,"shift":true}]"#));
      assert!(script.contains("ipc.postMessage"));
   }

   #[test]
   fn parses_bridge_reports() {
      assert_eq!(
         serde_json::from_str::<BridgeMessage>(r#"{"kind":"focus"}"#).unwrap(),
         BridgeMessage::Focus
      );
      assert_eq!(
         serde_json::from_str::<BridgeMessage>(
            r#"{"kind":"location","canGoBack":true,"canGoForward":null}"#
         )
         .unwrap(),
         BridgeMessage::Location {
            can_go_back: Some(true),
            can_go_forward: None
         }
      );
      assert!(serde_json::from_str::<BridgeMessage>(r#"{"kind":"evaluate","code":"1"}"#).is_err());
   }

   #[test]
   fn keeps_only_displayable_favicons() {
      assert_eq!(
         sanitize_favicon_url(Some("https://athas.dev/favicon.ico")).as_deref(),
         Some("https://athas.dev/favicon.ico")
      );
      assert_eq!(
         sanitize_favicon_url(Some("data:image/png;base64,iVBORw0KGgo=")).as_deref(),
         Some("data:image/png;base64,iVBORw0KGgo=")
      );
      assert_eq!(sanitize_favicon_url(Some("data:text/html,<script>")), None);
      assert_eq!(sanitize_favicon_url(Some("javascript:alert(1)")), None);
      assert_eq!(sanitize_favicon_url(Some("file:///etc/hosts")), None);
      assert_eq!(sanitize_favicon_url(None), None);
      let huge = format!("data:image/png;base64,{}", "A".repeat(MAX_FAVICON_URL_LEN));
      assert_eq!(sanitize_favicon_url(Some(&huge)), None);
   }
}
