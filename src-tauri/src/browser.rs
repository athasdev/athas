//! Browser tabs: native webviews the frontend places over a pane.
//!
//! The pages are wry webviews created as children of the workbench window, but
//! outside Tauri's webview manager. Tauri treats a window holding more than one
//! of its webviews as a multi-webview window, which is no longer a
//! `WebviewWindow`; keeping browser tabs out of the manager leaves every
//! workbench window, and the commands and plugins that look them up, as they
//! were. It also means pages get none of Tauri's IPC: they talk to Athas only
//! through the bridge script's `window.ipc.postMessage`.
//!
//! wry webviews are not `Send`, so they live on the main thread and every
//! command hops there to use them.

use athas_browser::{
   BROWSER_LABEL_PREFIX, BridgeMessage, BrowserEvent, BrowserKeyBinding, NavigationDecision,
   app_origins, bridge_script, decide_navigation, parse_browser_url, resolve_profile,
   sanitize_favicon_url,
};
use serde::Deserialize;
use std::{
   cell::RefCell,
   collections::{HashMap, HashSet},
   sync::{
      Arc,
      atomic::{AtomicU64, Ordering},
   },
};
use tauri::{AppHandle, Manager, Runtime, command, ipc::Channel};
use tauri_plugin_opener::OpenerExt;
use wry::{
   NewWindowResponse, PageLoadEvent, Rect, WebView, WebViewBuilder,
   dpi::{LogicalPosition, LogicalSize},
};

const DEFAULT_PROFILE: &str = "default";
const MIN_ZOOM: f64 = 0.25;
const MAX_ZOOM: f64 = 5.0;

static NEXT_TAB_ID: AtomicU64 = AtomicU64::new(0);

struct BrowserTab {
   webview: WebView,
   window_label: String,
   visible: bool,
}

thread_local! {
   /// Browser tabs that are alive, by label. Only the main thread touches it.
   static TABS: RefCell<HashMap<String, BrowserTab>> = RefCell::new(HashMap::new());
   /// WebView2 and WebKitGTK keep a profile's data through a context that must
   /// outlive every webview using it.
   #[cfg(not(target_os = "macos"))]
   static CONTEXTS: RefCell<HashMap<std::path::PathBuf, wry::WebContext>> =
      RefCell::new(HashMap::new());
}

/// Runs `f` on the main thread, where the webviews live, and returns its result.
async fn on_main_thread<R: Runtime, T: Send + 'static>(
   app: &AppHandle<R>,
   f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
   let (sender, receiver) = tokio::sync::oneshot::channel();
   app.run_on_main_thread(move || {
      let _ = sender.send(f());
   })
   .map_err(|error| format!("Failed to reach the main thread: {error}"))?;
   receiver
      .await
      .map_err(|_| "The browser tab task was dropped".to_string())?
}

fn with_tab<T>(label: &str, f: impl FnOnce(&mut BrowserTab) -> T) -> Result<T, String> {
   TABS.with(|tabs| {
      let mut tabs = tabs
         .try_borrow_mut()
         .map_err(|_| "Browser tabs are busy".to_string())?;
      let tab = tabs
         .get_mut(label)
         .ok_or_else(|| format!("Browser tab not found: {label}"))?;
      Ok(f(tab))
   })
}

/// Reads the main frame's address from the webview itself, never from the page,
/// so a page can't show another site's address. Runs as its own main-thread
/// task because webview callbacks may fire while the tab registry is in use.
fn send_current_url<R: Runtime>(
   app: &AppHandle<R>,
   label: String,
   events: Channel<BrowserEvent>,
   history: (Option<bool>, Option<bool>),
) {
   let _ = app.run_on_main_thread(move || {
      if let Ok(Ok(url)) = with_tab(&label, |tab| tab.webview.url()) {
         let _ = events.send(BrowserEvent::UrlChanged {
            url,
            can_go_back: history.0,
            can_go_forward: history.1,
         });
      }
   });
}

fn handle_bridge_message<R: Runtime>(
   app: &AppHandle<R>,
   label: &str,
   events: &Channel<BrowserEvent>,
   commands: &HashSet<String>,
   body: &str,
) {
   let Ok(message) = serde_json::from_str::<BridgeMessage>(body) else {
      return;
   };
   let event = match message {
      BridgeMessage::Focus => BrowserEvent::Focused,
      BridgeMessage::Location {
         can_go_back,
         can_go_forward,
      } => {
         send_current_url(
            app,
            label.to_string(),
            events.clone(),
            (can_go_back, can_go_forward),
         );
         return;
      }
      BridgeMessage::Favicon { href } => BrowserEvent::FaviconChanged {
         url: sanitize_favicon_url(href.as_deref()),
      },
      // Pages can send anything; only the shortcuts this tab was created with
      // reach the workbench.
      BridgeMessage::Shortcut { command } if commands.contains(&command) => {
         BrowserEvent::Shortcut { command }
      }
      BridgeMessage::Shortcut { .. } => return,
   };
   let _ = events.send(event);
}

fn open_externally<R: Runtime>(app: &AppHandle<R>, url: &str) {
   if let Err(error) = app.opener().open_url(url, None::<&str>) {
      log::warn!("Failed to open {url} outside the browser tab: {error}");
   }
}

fn dev_url<R: Runtime>(app: &AppHandle<R>) -> Option<url::Url> {
   if cfg!(debug_assertions) {
      app.config().build.dev_url.clone()
   } else {
      None
   }
}

#[cfg(target_os = "macos")]
fn macos_major_version() -> u64 {
   match tauri_plugin_os::version() {
      tauri_plugin_os::Version::Semantic(major, ..) => major,
      _ => 0,
   }
}

/// Where a browser tab sits in its window, in CSS pixels of the workbench.
#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
   pub x: f64,
   pub y: f64,
   pub width: f64,
   pub height: f64,
}

impl BrowserBounds {
   fn is_empty(&self) -> bool {
      self.width < 1.0 || self.height < 1.0
   }

   fn to_rect(self) -> Rect {
      Rect {
         position: LogicalPosition::new(self.x, self.y).into(),
         size: LogicalSize::new(self.width.max(1.0), self.height.max(1.0)).into(),
      }
   }
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCreateRequest {
   pub url: String,
   pub bounds: BrowserBounds,
   pub zoom: Option<f64>,
   /// Workbench shortcuts the page hands back to Athas while it has focus.
   pub key_bindings: Vec<BrowserKeyBinding>,
}

#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BrowserNavigationAction {
   Back,
   Forward,
   Reload,
   Stop,
}

fn build_webview(
   app: &AppHandle,
   window: &tauri::WebviewWindow,
   label: &str,
   request: BrowserCreateRequest,
   events: Channel<BrowserEvent>,
) -> Result<WebView, String> {
   let url = parse_browser_url(&request.url)?;
   let profile = resolve_profile(
      &app
         .path()
         .app_data_dir()
         .map_err(|error| format!("Failed to resolve app data folder: {error}"))?,
      DEFAULT_PROFILE,
   )
   .map_err(|error| format!("Failed to prepare browser profile: {error}"))?;
   let origins = Arc::new(app_origins(dev_url(app).as_ref()));
   let commands = request
      .key_bindings
      .iter()
      .map(|binding| binding.command.clone())
      .collect::<HashSet<_>>();

   let navigation_app = app.clone();
   let navigation_origins = origins.clone();
   let new_window_app = app.clone();
   let new_window_events = events.clone();
   let load_app = app.clone();
   let load_label = label.to_string();
   let load_events = events.clone();
   let title_app = app.clone();
   let title_label = label.to_string();
   let title_events = events.clone();
   let download_events = events.clone();
   let finished_download_events = events.clone();
   let bridge_app = app.clone();
   let bridge_label = label.to_string();
   let bridge_events = events;

   let build = |builder: WebViewBuilder| -> Result<WebView, String> {
      let builder = builder
         .with_url(url.as_str())
         .with_bounds(request.bounds.to_rect())
         .with_visible(true)
         .with_focused(false)
         .with_accept_first_mouse(true)
         .with_devtools(true)
         .with_back_forward_navigation_gestures(true)
         .with_initialization_script_for_main_only(bridge_script(&request.key_bindings), true)
         .with_navigation_handler(move |url| {
            let Ok(url) = url::Url::parse(&url) else {
               return false;
            };
            match decide_navigation(&url, &navigation_origins) {
               NavigationDecision::Allow => true,
               NavigationDecision::OpenExternally => {
                  open_externally(&navigation_app, url.as_str());
                  false
               }
               NavigationDecision::Block => {
                  log::warn!("Blocked browser tab navigation to {url}");
                  false
               }
            }
         })
         .with_new_window_req_handler(move |url, _features| {
            if let Ok(url) = url::Url::parse(&url) {
               match decide_navigation(&url, &origins) {
                  NavigationDecision::Allow => {
                     let _ = new_window_events.send(BrowserEvent::OpenInNewTab {
                        url: url.to_string(),
                     });
                  }
                  NavigationDecision::OpenExternally => {
                     open_externally(&new_window_app, url.as_str());
                  }
                  NavigationDecision::Block => {}
               }
            }
            NewWindowResponse::Deny
         })
         .with_on_page_load_handler(move |event, url| match event {
            PageLoadEvent::Started => {
               let _ = load_events.send(BrowserEvent::LoadStarted { url });
            }
            PageLoadEvent::Finished => {
               let _ = load_events.send(BrowserEvent::LoadFinished { url });
               send_current_url(
                  &load_app,
                  load_label.clone(),
                  load_events.clone(),
                  (None, None),
               );
            }
         })
         .with_document_title_changed_handler(move |title| {
            let _ = title_events.send(BrowserEvent::TitleChanged { title });
            send_current_url(
               &title_app,
               title_label.clone(),
               title_events.clone(),
               (None, None),
            );
         })
         .with_download_started_handler(move |url, destination| {
            let _ = download_events.send(BrowserEvent::DownloadStarted {
               url,
               path: destination.display().to_string(),
            });
            true
         })
         .with_download_completed_handler(move |url, path, success| {
            let _ = finished_download_events.send(BrowserEvent::DownloadFinished {
               url,
               path: path.map(|path| path.display().to_string()),
               success,
            });
         })
         .with_ipc_handler(move |request| {
            handle_bridge_message(
               &bridge_app,
               &bridge_label,
               &bridge_events,
               &commands,
               request.body(),
            );
         });

      #[cfg(target_os = "macos")]
      let builder = {
         use wry::WebViewBuilderExtDarwin;
         builder
            .with_data_store_identifier(profile.data_store_identifier)
            .with_user_agent(athas_browser::safari_user_agent(macos_major_version()))
      };

      // Linux hosts child webviews in the window's GTK box, as Tauri does.
      #[cfg(any(target_os = "windows", target_os = "macos"))]
      let webview = builder.build_as_child(window);
      #[cfg(not(any(target_os = "windows", target_os = "macos")))]
      let webview = {
         use wry::WebViewBuilderExtUnix;
         let vbox = window
            .default_vbox()
            .map_err(|error| format!("Failed to find the window content: {error}"))?;
         builder.build_gtk(&vbox)
      };
      webview.map_err(|error| format!("Failed to create browser tab: {error}"))
   };

   #[cfg(target_os = "macos")]
   let webview = build(WebViewBuilder::new());
   #[cfg(not(target_os = "macos"))]
   let webview = CONTEXTS.with(|contexts| {
      let mut contexts = contexts.borrow_mut();
      let context = contexts
         .entry(profile.data_directory.clone())
         .or_insert_with(|| wry::WebContext::new(Some(profile.data_directory.clone())));
      build(WebViewBuilder::new_with_web_context(context))
   });

   let webview = webview?;
   if let Some(zoom) = request.zoom
      && (zoom - 1.0).abs() > f64::EPSILON
   {
      let _ = webview.zoom(zoom.clamp(MIN_ZOOM, MAX_ZOOM));
   }
   Ok(webview)
}

#[command]
#[specta::specta]
pub async fn browser_create(
   app: AppHandle,
   window: tauri::WebviewWindow,
   request: BrowserCreateRequest,
   on_event: Channel<BrowserEvent>,
) -> Result<String, String> {
   let label = format!(
      "{BROWSER_LABEL_PREFIX}{}",
      NEXT_TAB_ID.fetch_add(1, Ordering::Relaxed)
   );
   let tab_label = label.clone();
   let main_app = app.clone();
   on_main_thread(&app, move || {
      let webview = build_webview(&main_app, &window, &tab_label, request, on_event)?;
      TABS.with(|tabs| {
         tabs.borrow_mut().insert(
            tab_label,
            BrowserTab {
               webview,
               window_label: window.label().to_string(),
               visible: true,
            },
         );
      });
      Ok(())
   })
   .await?;
   Ok(label)
}

/// Moves a tab over its pane, or hides it when `bounds` is `None`.
#[command]
#[specta::specta]
pub async fn browser_set_bounds(
   app: AppHandle,
   label: String,
   bounds: Option<BrowserBounds>,
) -> Result<(), String> {
   on_main_thread(&app, move || {
      with_tab(&label, |tab| {
         match bounds.filter(|bounds| !bounds.is_empty()) {
            Some(bounds) => {
               tab.webview
                  .set_bounds(bounds.to_rect())
                  .map_err(|error| format!("Failed to move browser tab: {error}"))?;
               if !tab.visible {
                  tab.webview
                     .set_visible(true)
                     .map_err(|error| format!("Failed to show browser tab: {error}"))?;
                  tab.visible = true;
               }
            }
            None if tab.visible => {
               tab.webview
                  .set_visible(false)
                  .map_err(|error| format!("Failed to hide browser tab: {error}"))?;
               tab.visible = false;
            }
            None => {}
         }
         Ok(())
      })?
   })
   .await
}

#[command]
#[specta::specta]
pub async fn browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
   let url = parse_browser_url(&url)?;
   on_main_thread(&app, move || {
      with_tab(&label, |tab| tab.webview.load_url(url.as_str()))?
         .map_err(|error| format!("Failed to open page: {error}"))
   })
   .await
}

#[command]
#[specta::specta]
pub async fn browser_perform(
   app: AppHandle,
   label: String,
   action: BrowserNavigationAction,
) -> Result<(), String> {
   on_main_thread(&app, move || {
      with_tab(&label, |tab| match action {
         BrowserNavigationAction::Back => tab.webview.evaluate_script("history.back()"),
         BrowserNavigationAction::Forward => tab.webview.evaluate_script("history.forward()"),
         BrowserNavigationAction::Reload => tab.webview.reload(),
         BrowserNavigationAction::Stop => tab.webview.evaluate_script("window.stop()"),
      })?
      .map_err(|error| format!("Browser action failed: {error}"))
   })
   .await
}

#[command]
#[specta::specta]
pub async fn browser_set_zoom(app: AppHandle, label: String, zoom: f64) -> Result<(), String> {
   on_main_thread(&app, move || {
      with_tab(&label, |tab| {
         tab.webview.zoom(zoom.clamp(MIN_ZOOM, MAX_ZOOM))
      })?
      .map_err(|error| format!("Failed to zoom page: {error}"))
   })
   .await
}

#[command]
#[specta::specta]
pub async fn browser_focus(app: AppHandle, label: String) -> Result<(), String> {
   on_main_thread(&app, move || {
      with_tab(&label, |tab| tab.webview.focus())?
         .map_err(|error| format!("Failed to focus page: {error}"))
   })
   .await
}

/// Gives keyboard focus back to the workbench webview that calls this, for
/// example when a workbench shortcut pressed inside a page opens a dialog.
#[command]
#[specta::specta]
pub async fn browser_focus_workbench(webview: tauri::Webview) -> Result<(), String> {
   webview
      .set_focus()
      .map_err(|error| format!("Failed to focus the workbench: {error}"))
}

#[command]
#[specta::specta]
pub async fn browser_open_devtools(app: AppHandle, label: String) -> Result<(), String> {
   on_main_thread(&app, move || {
      with_tab(&label, |tab| {
         #[cfg(any(debug_assertions, feature = "devtools"))]
         {
            tab.webview.open_devtools();
            Ok(())
         }
         #[cfg(not(any(debug_assertions, feature = "devtools")))]
         {
            let _ = tab;
            Err("Page developer tools are unavailable in release builds".to_string())
         }
      })?
   })
   .await
}

/// Clears cookies, storage and cache of the browser profile the tab uses.
#[command]
#[specta::specta]
pub async fn browser_clear_data(app: AppHandle, label: String) -> Result<(), String> {
   // Before macOS 14 WKWebView can't keep a separate data store, so browser
   // tabs share the workbench's and clearing it would wipe Athas's own data.
   #[cfg(target_os = "macos")]
   if macos_major_version() < 14 {
      return Err("Clearing browsing data needs macOS 14 or later".to_string());
   }
   on_main_thread(&app, move || {
      with_tab(&label, |tab| tab.webview.clear_all_browsing_data())?
         .map_err(|error| format!("Failed to clear browsing data: {error}"))
   })
   .await
}

#[command]
#[specta::specta]
pub async fn browser_close(app: AppHandle, label: String) -> Result<(), String> {
   on_main_thread(&app, move || {
      // Dropping the webview removes it from its window.
      let removed = TABS.with(|tabs| tabs.borrow_mut().remove(&label));
      drop(removed);
      Ok(())
   })
   .await
}

/// Closes every browser tab of the calling window. The workbench calls this when
/// it starts, so tabs left by a reloaded workbench don't cover the new one.
#[command]
#[specta::specta]
pub async fn browser_close_window_tabs(
   app: AppHandle,
   window: tauri::WebviewWindow,
) -> Result<(), String> {
   let window_label = window.label().to_string();
   on_main_thread(&app, move || {
      close_window_tabs(&window_label);
      Ok(())
   })
   .await
}

fn close_window_tabs(window_label: &str) {
   let removed = TABS.with(|tabs| {
      let mut tabs = tabs.borrow_mut();
      let labels = tabs
         .iter()
         .filter(|(_, tab)| tab.window_label == window_label)
         .map(|(label, _)| label.clone())
         .collect::<Vec<_>>();
      labels
         .into_iter()
         .filter_map(|label| tabs.remove(&label))
         .collect::<Vec<_>>()
   });
   drop(removed);
}

/// Drops the tabs of a destroyed window.
pub(crate) fn forget_window<R: Runtime>(app: &AppHandle<R>, window_label: &str) {
   let window_label = window_label.to_string();
   let _ = app.run_on_main_thread(move || close_window_tabs(&window_label));
}
