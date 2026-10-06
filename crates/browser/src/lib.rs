//! Browser tabs: native webviews Athas places over a pane to show web pages.
//!
//! This crate holds what does not need a running app: which navigations a tab
//! may follow, the script that reports page state back to the workbench, where
//! a profile keeps its data, and the events a tab sends to the frontend. The
//! webviews themselves are created in `src-tauri/src/browser.rs`.

mod bridge;
mod events;
mod navigation;
mod profile;
mod user_agent;

pub use bridge::{BridgeMessage, BrowserKeyBinding, bridge_script, sanitize_favicon_url};
pub use events::BrowserEvent;
pub use navigation::{NavigationDecision, app_origins, decide_navigation, parse_browser_url};
pub use profile::{BrowserProfile, resolve_profile};
pub use user_agent::safari_user_agent;

/// Every browser tab label starts with this.
pub const BROWSER_LABEL_PREFIX: &str = "browser-";
