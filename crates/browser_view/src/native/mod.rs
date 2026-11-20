//! The native page: a wry webview made a child of the GPUI window through its raw window handle,
//! outside any webview manager, so the window stays a plain GPUI window. Pages talk to Athas only
//! through the bridge script's `window.ipc.postMessage`.
//!
//! Ported from Athas's `src-tauri/src/browser.rs`.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

use std::{collections::HashSet, path::PathBuf, sync::Arc};

use athas_browser::{
    BridgeMessage, BrowserEvent, NavigationDecision, app_origins, bridge_script, clip_holes, decide_navigation, parse_browser_url,
    resolve_profile, sanitize_favicon_url,
};
use futures::channel::mpsc::UnboundedSender;
use gpui::Window;
use wry::{
    NewWindowResponse, PageLoadEvent, WebView, WebViewBuilder,
    dpi::{LogicalPosition, LogicalSize},
    http::{Response, header::CONTENT_TYPE},
    raw_window_handle::HasWindowHandle,
};

use crate::host::{Content, CreateOptions, NativeEvent, NavigationAction};
use crate::{layout::Rect, preview_protocol};

const DEFAULT_PROFILE: &str = "default";
const MIN_ZOOM: f64 = 0.25;
const MAX_ZOOM: f64 = 5.0;

#[cfg(not(target_os = "macos"))]
thread_local! {
    /// WebView2 keeps a profile's data through a context that must outlive every webview using it.
    static CONTEXTS: std::cell::RefCell<std::collections::HashMap<PathBuf, wry::WebContext>> = Default::default();
}

pub struct NativeWebView {
    webview: WebView,
    visible: bool,
    /// Where workbench UI covers the page, relative to it.
    holes: Vec<Rect>,
}

fn to_wry(bounds: Rect) -> wry::Rect {
    wry::Rect {
        position: LogicalPosition::new(bounds.x, bounds.y).into(),
        size: LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)).into(),
    }
}

fn send(events: &UnboundedSender<NativeEvent>, event: BrowserEvent) {
    let _ = events.unbounded_send(NativeEvent::Page(event));
}

/// What the page does with a navigation, the bridge's reports and the shortcuts it forwards.
fn handle_bridge_message(events: &UnboundedSender<NativeEvent>, commands: &HashSet<String>, body: &str) {
    let Ok(message) = serde_json::from_str::<BridgeMessage>(body) else { return };
    let event = match message {
        BridgeMessage::Focus => BrowserEvent::Focused,
        BridgeMessage::Location { can_go_back, can_go_forward } => {
            let _ = events.unbounded_send(NativeEvent::Location { can_go_back, can_go_forward });
            return;
        }
        BridgeMessage::Favicon { href } => BrowserEvent::FaviconChanged { url: sanitize_favicon_url(href.as_deref()) },
        // Pages can send anything; only the shortcuts this page was made with reach the workbench.
        BridgeMessage::Shortcut { command } if commands.contains(&command) => BrowserEvent::Shortcut { command },
        BridgeMessage::Shortcut { .. } => return,
    };
    send(events, event);
}

fn app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID))
}

impl NativeWebView {
    /// Makes the page over `options.bounds` of `window`. `Ok(None)` when the window has no native
    /// handle, as a headless window has none.
    pub fn create(window: &Window, options: CreateOptions) -> Result<Option<Self>, String> {
        if HasWindowHandle::window_handle(window).is_err() {
            return Ok(None);
        }
        let CreateOptions { content, bounds, zoom, corner_radius, key_bindings, events } = options;
        let (url, preview_root) = match content {
            Content::Url(url) => (parse_browser_url(&url)?.to_string(), None),
            Content::Preview { root, url } => (url, Some(root)),
        };
        let profile = app_data_dir()
            .ok_or_else(|| "Failed to resolve app data folder".to_string())
            .and_then(|dir| resolve_profile(&dir, DEFAULT_PROFILE).map_err(|error| format!("Failed to prepare browser profile: {error}")))?;
        let origins = Arc::new(app_origins(None));
        let commands: HashSet<String> = key_bindings.iter().map(|binding| binding.command.clone()).collect();
        let is_preview = preview_root.is_some();

        let navigation_events = events.clone();
        let navigation_origins = origins.clone();
        let new_window_events = events.clone();
        let load_events = events.clone();
        let title_events = events.clone();
        let download_events = events.clone();
        let finished_download_events = events.clone();
        let bridge_events = events;

        let build = |builder: WebViewBuilder| -> Result<WebView, String> {
            let builder = builder
                .with_url(url.as_str())
                .with_bounds(to_wry(bounds))
                .with_visible(true)
                .with_focused(false)
                .with_accept_first_mouse(true)
                .with_devtools(true)
                .with_back_forward_navigation_gestures(!is_preview)
                .with_initialization_script_for_main_only(bridge_script(&key_bindings), true)
                .with_navigation_handler(move |url| {
                    if is_preview && preview_protocol::is_preview_url(&url) {
                        return true;
                    }
                    let Ok(url) = url::Url::parse(&url) else { return false };
                    match decide_navigation(&url, &navigation_origins) {
                        NavigationDecision::Allow => true,
                        NavigationDecision::OpenExternally => {
                            let _ = navigation_events.unbounded_send(NativeEvent::OpenExternally(url.to_string()));
                            false
                        }
                        NavigationDecision::Block => false,
                    }
                })
                .with_new_window_req_handler(move |url, _features| {
                    if let Ok(url) = url::Url::parse(&url) {
                        match decide_navigation(&url, &origins) {
                            NavigationDecision::Allow => send(&new_window_events, BrowserEvent::OpenInNewTab { url: url.to_string() }),
                            NavigationDecision::OpenExternally => {
                                let _ = new_window_events.unbounded_send(NativeEvent::OpenExternally(url.to_string()));
                            }
                            NavigationDecision::Block => {}
                        }
                    }
                    NewWindowResponse::Deny
                })
                .with_on_page_load_handler(move |event, url| match event {
                    PageLoadEvent::Started => send(&load_events, BrowserEvent::LoadStarted { url }),
                    PageLoadEvent::Finished => {
                        send(&load_events, BrowserEvent::LoadFinished { url });
                        let _ = load_events.unbounded_send(NativeEvent::Location { can_go_back: None, can_go_forward: None });
                    }
                })
                .with_document_title_changed_handler(move |title| {
                    send(&title_events, BrowserEvent::TitleChanged { title });
                    let _ = title_events.unbounded_send(NativeEvent::Location { can_go_back: None, can_go_forward: None });
                })
                .with_download_started_handler(move |url, destination| {
                    send(&download_events, BrowserEvent::DownloadStarted { url, path: destination.display().to_string() });
                    true
                })
                .with_download_completed_handler(move |url, path, success| {
                    send(
                        &finished_download_events,
                        BrowserEvent::DownloadFinished { url, path: path.map(|path| path.display().to_string()), success },
                    );
                })
                .with_ipc_handler(move |request| handle_bridge_message(&bridge_events, &commands, request.body()));

            let builder = match preview_root.clone() {
                Some(root) => builder.with_custom_protocol(preview_protocol::SCHEME.into(), move |_, request| {
                    match preview_protocol::resolve_request(&root, request.uri().path()).and_then(|file| Some((preview_protocol::read_served(&file)?, file))) {
                        Some((bytes, file)) => Response::builder()
                            .header(CONTENT_TYPE, preview_protocol::mime_type(&file))
                            .header("Cache-Control", "no-store")
                            .body(bytes.into())
                            .unwrap_or_else(|_| Response::new(Vec::new().into())),
                        None => Response::builder().status(404).body(Vec::new().into()).unwrap_or_else(|_| Response::new(Vec::new().into())),
                    }
                }),
                None => builder,
            };

            #[cfg(target_os = "macos")]
            let builder = {
                use wry::WebViewBuilderExtDarwin;
                builder
                    .with_data_store_identifier(profile.data_store_identifier)
                    .with_user_agent(athas_browser::safari_user_agent(macos::major_version()))
            };

            builder.build_as_child(window).map_err(|error| format!("Failed to create browser tab: {error}"))
        };

        #[cfg(target_os = "macos")]
        let webview = build(WebViewBuilder::new())?;
        #[cfg(not(target_os = "macos"))]
        let webview = CONTEXTS.with(|contexts| {
            let mut contexts = contexts.borrow_mut();
            let context = contexts.entry(profile.data_directory.clone()).or_insert_with(|| wry::WebContext::new(Some(profile.data_directory.clone())));
            build(WebViewBuilder::new_with_web_context(context))
        })?;

        #[cfg(target_os = "macos")]
        macos::unlock_refresh_rate(&webview);
        #[cfg(target_os = "macos")]
        if corner_radius > 0.0 {
            macos::round_corners(&webview, corner_radius);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = corner_radius;
        if (zoom - 1.0).abs() > f64::EPSILON {
            let _ = webview.zoom(zoom.clamp(MIN_ZOOM, MAX_ZOOM));
        }
        Ok(Some(Self { webview, visible: true, holes: Vec::new() }))
    }

    pub fn is_visible(&self) -> bool {
        self.visible
    }

    /// Moves the page over its slot with `holes` cut out where workbench UI covers it, or hides it.
    pub fn set_layout(&mut self, layout: Option<(Rect, Vec<Rect>)>) -> Result<(), String> {
        match layout.filter(|(bounds, _)| bounds.width >= 1.0 && bounds.height >= 1.0) {
            Some((bounds, holes)) => {
                self.webview.set_bounds(to_wry(bounds)).map_err(|error| format!("Failed to move browser tab: {error}"))?;
                // Cut before showing, so a page never flashes over the UI.
                self.set_holes(clip_holes(bounds.width, bounds.height, &holes))?;
                if !self.visible {
                    self.webview.set_visible(true).map_err(|error| format!("Failed to show browser tab: {error}"))?;
                    self.visible = true;
                }
            }
            None => {
                if self.visible {
                    self.webview.set_visible(false).map_err(|error| format!("Failed to hide browser tab: {error}"))?;
                    self.visible = false;
                }
                self.set_holes(Vec::new())?;
            }
        }
        Ok(())
    }

    fn set_holes(&mut self, holes: Vec<Rect>) -> Result<(), String> {
        if holes.is_empty() && self.holes.is_empty() {
            return Ok(());
        }
        #[cfg(target_os = "windows")]
        windows::apply_holes(&self.webview, &holes)?;
        self.holes = holes;
        Ok(())
    }

    pub fn navigate(&self, url: &str) -> Result<(), String> {
        let url = parse_browser_url(url)?;
        self.webview.load_url(url.as_str()).map_err(|error| format!("Failed to open page: {error}"))
    }

    pub fn perform(&self, action: NavigationAction) -> Result<(), String> {
        match action {
            NavigationAction::Back => self.webview.evaluate_script("history.back()"),
            NavigationAction::Forward => self.webview.evaluate_script("history.forward()"),
            NavigationAction::Reload => self.webview.reload(),
            NavigationAction::Stop => self.webview.evaluate_script("window.stop()"),
        }
        .map_err(|error| format!("Browser action failed: {error}"))
    }

    pub fn set_zoom(&self, zoom: f64) -> Result<(), String> {
        self.webview.zoom(zoom.clamp(MIN_ZOOM, MAX_ZOOM)).map_err(|error| format!("Failed to zoom page: {error}"))
    }

    pub fn focus(&self) {
        let _ = self.webview.focus();
    }

    /// Gives keyboard focus back to the window the page sits in.
    pub fn focus_parent(&self) {
        let _ = self.webview.focus_parent();
    }

    /// The main frame's address, read from the webview itself, never from the page, so a page
    /// can't show another site's address.
    pub fn url(&self) -> Option<String> {
        self.webview.url().ok()
    }

    pub fn open_devtools(&self) -> Result<(), String> {
        #[cfg(any(debug_assertions, feature = "devtools"))]
        {
            self.webview.open_devtools();
            Ok(())
        }
        #[cfg(not(any(debug_assertions, feature = "devtools")))]
        Err("Page developer tools are unavailable in release builds".to_string())
    }

    /// Clears cookies, storage and cache of the browser profile.
    pub fn clear_data(&self) -> Result<(), String> {
        // Before macOS 14 WKWebView can't keep a separate data store, so pages share Athas's and
        // clearing it would wipe Athas's own data.
        #[cfg(target_os = "macos")]
        if macos::major_version() < 14 {
            return Err("Clearing browsing data needs macOS 14 or later".to_string());
        }
        self.webview.clear_all_browsing_data().map_err(|error| format!("Failed to clear browsing data: {error}"))
    }

    /// Takes a JPEG of what the page shows right now and sends it as `NativeEvent::Snapshot`.
    pub fn capture_snapshot(&self, events: UnboundedSender<NativeEvent>) {
        #[cfg(target_os = "macos")]
        macos::capture_snapshot(&self.webview, move |bytes| {
            let _ = events.unbounded_send(NativeEvent::Snapshot(bytes));
        });
        #[cfg(not(target_os = "macos"))]
        let _ = events.unbounded_send(NativeEvent::Snapshot(None));
    }
}

/// How this platform lets workbench UI show over pages.
pub fn capabilities() -> athas_browser::BrowserCapabilities {
    athas_browser::BrowserCapabilities::current()
}
