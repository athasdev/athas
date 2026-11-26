//! Browser tabs and file previews: web pages in native webviews placed over the workbench, with
//! the navigation bar drawn by GPUI, and previews of HTML, SVG, markdown and CSV files.
//!
//! A page is a wry webview made a child of the GPUI window through its raw window handle. Each
//! frame its slot element measures where it lands and the floating UI over it, and moves, cuts or
//! hides the native view to match; a window without a native handle (headless rendering) shows a
//! placeholder in its place.

pub mod address;
pub mod browser_use;
mod frame;
mod host;
pub mod key_bindings;
pub mod layout;
mod page;
pub mod page_state;
pub mod pages;
mod preview;
pub mod preview_protocol;
mod slot;

#[cfg(all(feature = "webview", any(target_os = "macos", target_os = "windows")))]
#[path = "native/mod.rs"]
mod native;
#[cfg(target_family = "wasm")]
#[path = "native_web.rs"]
mod native;
#[cfg(not(any(target_family = "wasm", all(feature = "webview", any(target_os = "macos", target_os = "windows")))))]
#[path = "native_stub.rs"]
mod native;
#[cfg(all(feature = "webview", any(target_os = "macos", target_os = "windows")))]
#[path = "profile/mod.rs"]
pub mod profile;
#[cfg(not(all(feature = "webview", any(target_os = "macos", target_os = "windows"))))]
#[path = "profile_stub.rs"]
pub mod profile;

use std::path::PathBuf;

use gpui::{AnyView, App, AppContext as _, FocusHandle, Focusable as _, KeyBinding, Window, actions};

pub use frame::frame_tracker;
pub use page::{BrowserPage, BrowserPageEvent, PageExtras, PageSlot, open_browser_tab};
#[cfg(target_family = "wasm")]
pub use native::{PreviewAddress, set_preview_address};
pub use preview::{PreviewKind, PreviewView, can_preview, open_preview, preview_title};
#[cfg(target_family = "wasm")]
pub use preview::set_web_files;

/// Whether this build places native pages over the window (frames over the canvas on the web).
pub const NATIVE_PAGES: bool = cfg!(any(target_family = "wasm", all(feature = "webview", any(target_os = "macos", target_os = "windows"))));

pub const BROWSER_KIND: &str = "browser";
pub const PREVIEW_KIND: &str = "preview";
/// The centre tab kinds this crate shows.
pub const RESOURCE_KINDS: &[&str] = &[BROWSER_KIND, PREVIEW_KIND];

actions!(browser, [NewTab, OpenUrl, FocusAddressBar, Reload, Back, Forward, OpenDevTools, ZoomIn, ZoomOut, ResetZoom, ImportBrowserData, ManagePasskeys]);

/// Registers the browser commands. Call before the keymap binds.
pub fn init(cx: &mut App) {
    keymap::register(cx, "browser.newTab", NewTab);
    keymap::register(cx, "browser.openUrl", OpenUrl);
    keymap::register(cx, "browser.focusAddressBar", FocusAddressBar);
    keymap::register(cx, "browser.reload", Reload);
    keymap::register(cx, "browser.back", Back);
    keymap::register(cx, "browser.forward", Forward);
    keymap::register(cx, "browser.openDevTools", OpenDevTools);
    if profile::PageProfile::AVAILABLE {
        keymap::register(cx, "browser.importBrowserData", ImportBrowserData);
        keymap::register(cx, "browser.managePasskeys", ManagePasskeys);
    }
    cx.on_action(|_: &NewTab, cx| open_browser_tab(None, cx));
    page::init_profile_commands(cx);
    // A blank tab focuses its address bar, which takes the address the old prompt asked for.
    cx.on_action(|_: &OpenUrl, cx| open_browser_tab(None, cx));
    ui::bind_keys_once(cx, "browser_view", |cx| {
        #[cfg(target_os = "macos")]
        let keys = ["cmd-=", "cmd-+", "cmd--", "cmd-0"];
        #[cfg(not(target_os = "macos"))]
        let keys = ["ctrl-=", "ctrl-+", "ctrl--", "ctrl-0"];
        cx.bind_keys([
            KeyBinding::new(keys[0], ZoomIn, Some("Browser")),
            KeyBinding::new(keys[1], ZoomIn, Some("Browser")),
            KeyBinding::new(keys[2], ZoomOut, Some("Browser")),
            KeyBinding::new(keys[3], ResetZoom, Some("Browser")),
        ]);
    });
}

/// The view of a browser or preview tab, and what to focus in it.
pub fn open_resource_with_focus(kind: &str, id: &str, project: Option<PathBuf>, window: &mut Window, cx: &mut App) -> Option<(AnyView, FocusHandle)> {
    match kind {
        BROWSER_KIND => {
            let page = cx.new(|cx| BrowserPage::new(id.to_string(), window, cx));
            let focus = page.focus_handle(cx);
            Some((page.into(), focus))
        }
        PREVIEW_KIND => Some(preview::preview_view(PathBuf::from(id), project, window, cx)),
        _ => None,
    }
}

/// Forgets what a closed browser tab kept.
pub fn forget_page(id: &str) {
    pages::with_store(|store| store.forget(id));
}
