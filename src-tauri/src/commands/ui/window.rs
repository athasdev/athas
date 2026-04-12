use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
#[cfg(target_os = "linux")]
use std::{cell::RefCell, collections::HashMap};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{
   AppHandle, Emitter, Manager, WebviewBuilder, WebviewUrl, WebviewWindow, command,
   webview::PageLoadEvent,
};
#[cfg(target_os = "linux")]
use wry::{
   Rect as WryRect, WebView as WryWebView, WebViewBuilder as WryWebViewBuilder,
   dpi::{PhysicalPosition as WryPhysicalPosition, PhysicalSize as WryPhysicalSize},
};

// Counter for generating unique web viewer labels
static WEB_VIEWER_COUNTER: AtomicU32 = AtomicU32::new(0);
static APP_WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

#[cfg(target_os = "linux")]
thread_local! {
   static LINUX_EMBEDDED_WEBVIEWS: RefCell<HashMap<String, WryWebView>> = RefCell::new(HashMap::new());
}

#[cfg(target_os = "linux")]
fn linux_embedded_bounds(x: f64, y: f64, width: f64, height: f64) -> WryRect {
   WryRect {
      position: WryPhysicalPosition::new(x.round() as i32, y.round() as i32).into(),
      size: WryPhysicalSize::new(width.round() as u32, height.round() as u32).into(),
   }
}

#[cfg(target_os = "linux")]
fn with_linux_embedded_webview<T>(
   label: &str,
   f: impl FnOnce(&WryWebView) -> Result<T, String>,
) -> Result<T, String> {
   LINUX_EMBEDDED_WEBVIEWS.with(|webviews| {
      let webviews = webviews.borrow();
      let webview = webviews
         .get(label)
         .ok_or_else(|| format!("Webview not found: {label}"))?;
      f(webview)
   })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedWebviewPageLoadEvent {
   webview_label: String,
   url: String,
   event: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedWebviewLocationChangeEvent {
   webview_label: String,
   url: String,
   navigation_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppWindowRequest {
   pub path: Option<String>,
   pub is_directory: Option<bool>,
   pub line: Option<u32>,
   pub remote_connection_id: Option<String>,
   pub remote_connection_name: Option<String>,
}

fn build_window_open_url(request: Option<&CreateAppWindowRequest>) -> String {
   let Some(request) = request else {
      return "/".to_string();
   };

   let has_payload = request.path.is_some() || request.remote_connection_id.is_some();
   if !has_payload {
      return "/".to_string();
   }

   let mut serializer = url::form_urlencoded::Serializer::new(String::new());
   serializer.append_pair("target", "open");

   if let Some(connection_id) = &request.remote_connection_id {
      serializer.append_pair("type", "remote");
      serializer.append_pair("connectionId", connection_id);

      if let Some(connection_name) = &request.remote_connection_name {
         serializer.append_pair("name", connection_name);
      }
   } else if let Some(path) = &request.path {
      serializer.append_pair(
         "type",
         if request.is_directory.unwrap_or(false) {
            "directory"
         } else {
            "file"
         },
      );
      serializer.append_pair("path", path);

      if let Some(line) = request.line {
         serializer.append_pair("line", &line.to_string());
      }
   }

   format!("/?{}", serializer.finish())
}

pub fn configure_app_window(window: &WebviewWindow) {
   #[cfg(target_os = "macos")]
   {
      use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};

      apply_vibrancy(window, NSVisualEffectMaterial::HudWindow, None, Some(12.0))
         .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
   }

   #[cfg(target_os = "windows")]
   {
      let _ = window.set_decorations(true);
   }

   #[cfg(target_os = "linux")]
   {
      let _ = window.set_decorations(false);
   }
}

pub fn create_app_window_internal(
   app: &AppHandle,
   request: Option<CreateAppWindowRequest>,
) -> Result<String, String> {
   let label = format!(
      "main-{}",
      APP_WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst) + 1
   );
   let url = build_window_open_url(request.as_ref());

   let builder = tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
      .title("")
      .inner_size(1200.0, 800.0)
      .min_inner_size(400.0, 400.0)
      .center()
      .decorations(true)
      .resizable(true)
      .shadow(true);

   #[cfg(target_os = "macos")]
   let builder = builder
      .hidden_title(true)
      .title_bar_style(TitleBarStyle::Overlay);

   let window = builder
      .build()
      .map_err(|e| format!("Failed to create app window: {e}"))?;

   configure_app_window(&window);

   Ok(label)
}

#[command]
pub async fn create_app_window(
   app: tauri::AppHandle,
   request: Option<CreateAppWindowRequest>,
) -> Result<String, String> {
   create_app_window_internal(&app, request)
}

fn build_webview_bridge_script(webview_label: &str) -> Result<String, String> {
   let encoded_label = serde_json::to_string(webview_label)
      .map_err(|e| format!("Failed to serialize webview label: {e}"))?;

   Ok(format!(
      r#"
(function() {{
  if (window.__ATHAS_WEBVIEW_BRIDGE_LOADED__) return;
  window.__ATHAS_WEBVIEW_BRIDGE_LOADED__ = true;

  const WEBVIEW_LABEL = {encoded_label};

  function emit(event, payload) {{
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (typeof invoke !== 'function') return;
    void invoke('plugin:event|emit', {{ event, payload }}).catch(() => {{}});
  }}

  function emitShortcut(shortcut) {{
    emit('embedded-webview-shortcut', {{
      webviewLabel: WEBVIEW_LABEL,
      shortcut
    }});
  }}

  function emitLocationChange(navigationType) {{
    emit('embedded-webview-location-change', {{
      webviewLabel: WEBVIEW_LABEL,
      url: window.location.href,
      navigationType
    }});
  }}

  function readMetadata() {{
    const title = document.title || '';
    let favicon = null;
    const icon =
      document.querySelector('link[rel~="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]');

    if (icon && icon.href) {{
      favicon = icon.href;
    }}

    return {{ title, favicon }};
  }}

  let lastMetadata = '';
  let metadataFrame = null;

  function emitMetadata() {{
    metadataFrame = null;
    const metadata = readMetadata();
    if (!metadata.title) return;

    const serialized = JSON.stringify(metadata);
    if (serialized === lastMetadata) return;
    lastMetadata = serialized;

    emit('embedded-webview-metadata', {{
      webviewLabel: WEBVIEW_LABEL,
      title: metadata.title,
      favicon: metadata.favicon
    }});
  }}

  function scheduleMetadataEmit() {{
    if (metadataFrame !== null) return;
    metadataFrame = window.requestAnimationFrame(emitMetadata);
  }}

  function wrapHistoryMethod(name, navigationType) {{
    const original = window.history[name];
    if (typeof original !== 'function') return;

    window.history[name] = function() {{
      const result = original.apply(this, arguments);
      scheduleMetadataEmit();
      emitLocationChange(navigationType);
      return result;
    }};
  }}

  document.addEventListener('keydown', function(e) {{
    const isMod = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;
    let shortcut = null;

    if (isMod && e.key === 'Tab') {{
      shortcut = 'global:switch-tab';
    }} else if (isMod && e.key === 'j') {{
      shortcut = 'global:toggle-terminal';
    }} else if (isMod && e.key === 'b') {{
      shortcut = 'global:toggle-sidebar';
    }} else if (isMod && e.key === 'k') {{
      shortcut = 'global:command-palette';
    }} else if (isMod && e.key === 'p') {{
      shortcut = 'global:quick-open';
    }} else if (isMod && e.key === 'w') {{
      shortcut = 'global:close-tab';
    }} else if (isMod && isShift && e.key === 'T') {{
      shortcut = 'global:reopen-tab';
    }} else if (isMod && e.key === 't') {{
      shortcut = 'global:new-tab';
    }} else if (isMod && e.key === 'n') {{
      shortcut = 'global:new-window';
    }} else if (isMod && isShift && e.key === 'N') {{
      shortcut = 'global:new-private-window';
    }} else if (isMod && e.key === 'f') {{
      shortcut = 'global:find';
    }} else if (isMod && isShift && e.key === 'F') {{
      shortcut = 'global:find-in-files';
    }} else if (isMod && e.key === ',') {{
      shortcut = 'global:settings';
    }} else if (isMod && e.key === 'l') {{
      shortcut = 'focus-url';
    }} else if (isMod && e.key === 'r' && !isShift) {{
      shortcut = 'refresh';
    }} else if (isMod && e.key === '[') {{
      shortcut = 'go-back';
    }} else if (isMod && e.key === ']') {{
      shortcut = 'go-forward';
    }} else if (isMod && e.key === '=') {{
      shortcut = 'zoom-in';
    }} else if (isMod && e.key === '-') {{
      shortcut = 'zoom-out';
    }} else if (isMod && e.key === '0') {{
      shortcut = 'zoom-reset';
    }} else if (e.key === 'Escape') {{
      shortcut = 'escape';
    }}

    if (shortcut) {{
      e.preventDefault();
      e.stopPropagation();
      emitShortcut(shortcut);
    }}
  }}, true);

  wrapHistoryMethod('pushState', 'push');
  wrapHistoryMethod('replaceState', 'replace');

  window.addEventListener('popstate', function() {{
    scheduleMetadataEmit();
    emitLocationChange('traverse');
  }});

  window.addEventListener('hashchange', function() {{
    scheduleMetadataEmit();
    emitLocationChange('push');
  }});

  window.addEventListener('load', scheduleMetadataEmit, true);
  window.addEventListener('pageshow', scheduleMetadataEmit, true);
  document.addEventListener('DOMContentLoaded', scheduleMetadataEmit, true);

  const metadataObserver = new MutationObserver(scheduleMetadataEmit);
  metadataObserver.observe(document.documentElement, {{
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href']
  }});

  scheduleMetadataEmit();
}})();
"#
   ))
}

#[command]
pub async fn create_embedded_webview(
   window: Window,
   url: String,
   x: f64,
   y: f64,
   width: f64,
   height: f64,
) -> Result<String, String> {
   let counter = WEB_VIEWER_COUNTER.fetch_add(1, Ordering::SeqCst);
   let webview_label = format!("web-viewer-{counter}");
   let parsed_url = normalize_webview_url(&url)?;

   #[cfg(target_os = "linux")]
   {
      let parent_window = window.clone();
      let embedded_label = webview_label.clone();
      let (tx, rx) = tokio::sync::oneshot::channel();

      window
         .run_on_main_thread(move || {
            let result = (|| {
               let builder = WryWebViewBuilder::new()
                  .with_url(&parsed_url)
                  .with_bounds(linux_embedded_bounds(x, y, width, height))
                  .with_initialization_script(SHORTCUT_INTERCEPTOR_SCRIPT)
                  .with_devtools(true)
                  .with_visible(true);

               let webview = builder
                  .build_as_child(&parent_window)
                  .map_err(|e| format!("Failed to create embedded webview: {e}"))?;

               LINUX_EMBEDDED_WEBVIEWS.with(|webviews| {
                  webviews
                     .borrow_mut()
                     .insert(embedded_label.clone(), webview);
               });

               Ok(embedded_label)
            })();

            let _ = tx.send(result);
         })
         .map_err(|e| format!("Failed to schedule embedded webview creation: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview creation channel dropped".to_string())?;
   }

   let x = x.round() as i32;
   let y = y.round() as i32;
   let width = width.round() as u32;
   let height = height.round() as u32;

   let mut webview_builder = WebviewBuilder::new(
      &webview_label,
      WebviewUrl::External(
         parsed_url
            .parse()
            .map_err(|e| format!("Invalid URL: {e}"))?,
      ),
   );

   webview_builder =
      webview_builder.initialization_script(build_webview_bridge_script(&webview_label)?);
   let app_handle = app.clone();
   let event_webview_label = webview_label.clone();
   let navigation_webview_label = webview_label.clone();
   let navigation_app_handle = app.clone();
   webview_builder = webview_builder.on_navigation(move |url| {
      let event = EmbeddedWebviewLocationChangeEvent {
         webview_label: navigation_webview_label.clone(),
         url: url.to_string(),
         navigation_type: "navigate".to_string(),
      };

      let _ = navigation_app_handle.emit("embedded-webview-location-change", event);
      true
   });
   webview_builder = webview_builder.on_page_load(move |_webview, payload| {
      let event = EmbeddedWebviewPageLoadEvent {
         webview_label: event_webview_label.clone(),
         url: payload.url().to_string(),
         event: match payload.event() {
            PageLoadEvent::Started => "started".to_string(),
            PageLoadEvent::Finished => "finished".to_string(),
         },
      };

      let _ = app_handle.emit("embedded-webview-page-load", event);
   });

   // Create embedded webview within the calling window so coordinates
   // are relative to the correct content area (fixes multi-window and
   // Linux positioning where the hardcoded "main" lookup could fail).
   let webview = window
      .add_child(
         webview_builder,
         tauri::PhysicalPosition::new(x, y),
         tauri::PhysicalSize::new(width, height),
      )
      .map_err(|e| format!("Failed to create embedded webview: {e}"))?;

   webview
      .set_auto_resize(false)
      .map_err(|e| format!("Failed to set auto resize: {e}"))?;

   Ok(webview_label)
}

#[command]
pub async fn close_embedded_webview(
   app: tauri::AppHandle,
   webview_label: String,
) -> Result<(), String> {
   #[cfg(target_os = "linux")]
   {
      let (tx, rx) = tokio::sync::oneshot::channel();
      app.run_on_main_thread(move || {
         LINUX_EMBEDDED_WEBVIEWS.with(|webviews| {
            webviews.borrow_mut().remove(&webview_label);
         });
         let _ = tx.send(Ok(()));
      })
      .map_err(|e| format!("Failed to schedule embedded webview close: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview close channel dropped".to_string())?;
   }

   if let Some(webview) = app.get_webview(&webview_label) {
      webview
         .close()
         .map_err(|e| format!("Failed to close webview: {e}"))?;
   }
   Ok(())
}

#[command]
pub async fn navigate_embedded_webview(
   app: tauri::AppHandle,
   webview_label: String,
   url: String,
) -> Result<(), String> {
   #[cfg(target_os = "linux")]
   {
      let parsed_url = normalize_webview_url(&url)?;
      let (tx, rx) = tokio::sync::oneshot::channel();
      app.run_on_main_thread(move || {
         let result = with_linux_embedded_webview(&webview_label, |webview| {
            webview
               .load_url(&parsed_url)
               .map_err(|e| format!("Failed to navigate: {e}"))
         });
         let _ = tx.send(result);
      })
      .map_err(|e| format!("Failed to schedule embedded webview navigation: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview navigation channel dropped".to_string())?;
   }

   if let Some(webview) = app.get_webview(&webview_label) {
      let parsed_url = normalize_webview_url(&url)?;

      webview
         .navigate(
            parsed_url
               .parse()
               .map_err(|e| format!("Invalid URL: {e}"))?,
         )
         .map_err(|e| format!("Failed to navigate: {e}"))?;
   } else {
      return Err(format!("Webview not found: {webview_label}"));
   }
   Ok(())
}

#[command]
pub async fn resize_embedded_webview(
   app: tauri::AppHandle,
   webview_label: String,
   x: f64,
   y: f64,
   width: f64,
   height: f64,
) -> Result<(), String> {
   if width <= 0.0 || height <= 0.0 {
      return Ok(());
   }

   #[cfg(target_os = "linux")]
   {
      let bounds = linux_embedded_bounds(x, y, width, height);
      let (tx, rx) = tokio::sync::oneshot::channel();
      app.run_on_main_thread(move || {
         let result = with_linux_embedded_webview(&webview_label, |webview| {
            webview
               .set_bounds(bounds)
               .map_err(|e| format!("Failed to set bounds: {e}"))
         });
         let _ = tx.send(result);
      })
      .map_err(|e| format!("Failed to schedule embedded webview resize: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview resize channel dropped".to_string())?;
   }

   let x = x.round() as i32;
   let y = y.round() as i32;
   let width = width.round() as u32;
   let height = height.round() as u32;

   if let Some(webview) = app.get_webview(&webview_label) {
      webview
         .set_position(tauri::PhysicalPosition::new(x, y))
         .map_err(|e| format!("Failed to set position: {e}"))?;
      webview
         .set_size(tauri::PhysicalSize::new(width, height))
         .map_err(|e| format!("Failed to set size: {e}"))?;
   } else {
      return Err(format!("Webview not found: {webview_label}"));
   }
   Ok(())
}

#[command]
pub async fn set_webview_visible(
   app: tauri::AppHandle,
   webview_label: String,
   visible: bool,
) -> Result<(), String> {
   #[cfg(target_os = "linux")]
   {
      let (tx, rx) = tokio::sync::oneshot::channel();
      app.run_on_main_thread(move || {
         let result = with_linux_embedded_webview(&webview_label, |webview| {
            webview
               .set_visible(visible)
               .map_err(|e| format!("Failed to update visibility: {e}"))
         });
         let _ = tx.send(result);
      })
      .map_err(|e| format!("Failed to schedule embedded webview visibility: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview visibility channel dropped".to_string())?;
   }

   if let Some(webview) = app.get_webview(&webview_label) {
      if visible {
         webview
            .show()
            .map_err(|e| format!("Failed to show webview: {e}"))?;
      } else {
         webview
            .hide()
            .map_err(|e| format!("Failed to hide webview: {e}"))?;
      }
   } else {
      return Err(format!("Webview not found: {webview_label}"));
   }
   Ok(())
}

#[command]
pub async fn open_webview_devtools(
   app: tauri::AppHandle,
   webview_label: String,
) -> Result<(), String> {
   #[cfg(target_os = "linux")]
   {
      let (tx, rx) = tokio::sync::oneshot::channel();
      app.run_on_main_thread(move || {
         #[cfg(any(debug_assertions, feature = "devtools"))]
         let result = with_linux_embedded_webview(&webview_label, |webview| {
            webview.open_devtools();
            Ok(())
         });

         #[cfg(not(any(debug_assertions, feature = "devtools")))]
         let result: Result<(), String> =
            Err("Webview devtools are unavailable in release builds".to_string());

         let _ = tx.send(result);
      })
      .map_err(|e| format!("Failed to schedule embedded webview devtools: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview devtools channel dropped".to_string())?;
   }

   if let Some(webview) = app.get_webview(&webview_label) {
      #[cfg(any(debug_assertions, feature = "devtools"))]
      {
         webview.open_devtools();
         Ok(())
      }

      #[cfg(not(any(debug_assertions, feature = "devtools")))]
      {
         let _ = webview;
         return Err("Webview devtools are unavailable in release builds".to_string());
      }
   } else {
      Err(format!("Webview not found: {webview_label}"))
   }
}

fn normalize_webview_url(url: &str) -> Result<String, String> {
   let sanitized = url
      .chars()
      .filter(|ch| !ch.is_control())
      .collect::<String>()
      .trim()
      .to_string();

   if sanitized.is_empty() || sanitized.chars().any(char::is_whitespace) {
      return Err("URL cannot be empty".to_string());
   }

   if sanitized == "about:blank" {
      return Ok(sanitized);
   }

   let normalized_input = if sanitized.starts_with("//") {
      format!("https:{sanitized}")
   } else if sanitized.starts_with(':') {
      format!("http://localhost{sanitized}")
   } else {
      sanitized
   };

   let candidate = if has_supported_protocol(&normalized_input) {
      normalized_input
   } else {
      format!(
         "{}{}",
         infer_webview_protocol(&normalized_input),
         normalized_input
      )
   };

   let parsed = url::Url::parse(&candidate).map_err(|e| format!("Invalid URL: {e}"))?;
   match parsed.scheme() {
      "http" | "https" => Ok(parsed.to_string()),
      "about" => Ok(parsed.to_string()),
      _ => Err("Only http, https, and about URLs are allowed".to_string()),
   }
}

fn has_supported_protocol(value: &str) -> bool {
   let Some(protocol_end) = value.find(':') else {
      return false;
   };

   let scheme = &value[..protocol_end];
   !scheme.is_empty()
      && scheme
         .chars()
         .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
}

fn infer_webview_protocol(value: &str) -> &'static str {
   let normalized = value.to_lowercase();

   if normalized.starts_with("localhost")
      || normalized.starts_with("127.")
      || normalized.starts_with("10.")
      || normalized.starts_with("192.168.")
      || normalized.starts_with("172.")
      || normalized.starts_with("[::1]")
      || normalized.starts_with("::1")
      || normalized.starts_with("0.0.0.0")
      || normalized.starts_with(':')
   {
      "http://"
   } else {
      "https://"
   }
}

#[command]
pub async fn set_webview_zoom(
   app: tauri::AppHandle,
   webview_label: String,
   zoom_level: f64,
) -> Result<(), String> {
   #[cfg(target_os = "linux")]
   {
      let (tx, rx) = tokio::sync::oneshot::channel();
      app.run_on_main_thread(move || {
         let result = with_linux_embedded_webview(&webview_label, |webview| {
            webview
               .zoom(zoom_level)
               .map_err(|e| format!("Failed to set zoom: {e}"))
         });
         let _ = tx.send(result);
      })
      .map_err(|e| format!("Failed to schedule embedded webview zoom: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview zoom channel dropped".to_string())?;
   }

   if let Some(webview) = app.get_webview(&webview_label) {
      webview
         .set_zoom(zoom_level)
         .map_err(|e| format!("Failed to set zoom: {e}"))?;
      Ok(())
   } else {
      Err(format!("Webview not found: {webview_label}"))
   }
}

#[derive(Deserialize, Serialize)]
pub struct WebviewMetadata {
   pub title: String,
   pub favicon: Option<String>,
}

#[command]
pub async fn poll_webview_metadata(
   app: tauri::AppHandle,
   webview_label: String,
) -> Result<Option<WebviewMetadata>, String> {
   #[cfg(target_os = "linux")]
   {
      let (tx, rx) = tokio::sync::oneshot::channel();
      let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

      app.run_on_main_thread(move || {
         let result = with_linux_embedded_webview(&webview_label, |webview| {
            let tx = tx.clone();
            webview
               .evaluate_script_with_callback(
                  r#"
                  (() => {
                     const title = document.title || "";
                     if (!title) {
                        return null;
                     }

                     const iconElement =
                        document.querySelector('link[rel~="icon"]') ||
                        document.querySelector('link[rel="shortcut icon"]');

                     return {
                        title,
                        favicon: iconElement?.href || null,
                     };
                  })()
                  "#,
                  move |value: String| {
                     let parsed = serde_json::from_str::<Option<WebviewMetadata>>(&value)
                        .map_err(|e| format!("Failed to parse metadata: {e}"));
                     if let Some(tx) = tx.lock().unwrap().take() {
                        let _ = tx.send(parsed);
                     }
                  },
               )
               .map_err(|e| format!("Failed to get metadata: {e}"))
         });

         if let Err(error) = result {
            if let Some(tx) = tx.lock().unwrap().take() {
               let _ = tx.send(Err(error));
            }
         }
      })
      .map_err(|e| format!("Failed to schedule embedded webview metadata poll: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview metadata channel dropped".to_string())?;
   }

   if let Some(webview) = app.get_webview(&webview_label) {
      // Store metadata in a dedicated global (does not touch location.hash
      // to avoid conflicts with the shortcut polling mechanism).
      webview
         .eval(
            r#"
            (function() {
               var t = document.title || '';
               var icon = '';
               var el = document.querySelector('link[rel~="icon"]') || document.querySelector('link[rel="shortcut icon"]');
               if (el && el.href) { icon = el.href; }
               window.__ATHAS_PAGE_META__ = JSON.stringify({t:t,i:icon});
            })();
            "#,
         )
         .map_err(|e| format!("Failed to get metadata: {e}"))?;

      tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;

      // Read back via a hash round-trip (single step)
      webview
         .eval(
            r#"
            (function() {
               var m = window.__ATHAS_PAGE_META__;
               window.__ATHAS_PAGE_META__ = null;
               if (m) window.location.hash = '__athas_meta=' + encodeURIComponent(m);
            })();
            "#,
         )
         .map_err(|e| format!("Failed to read metadata: {e}"))?;

      tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

      let url = webview
         .url()
         .map_err(|e| format!("Failed to get URL: {e}"))?;
      let hash = url.fragment().unwrap_or("");

      if let Some(encoded) = hash.strip_prefix("__athas_meta=") {
         webview
            .eval("window.location.hash = '';")
            .map_err(|e| format!("Failed to clear hash: {e}"))?;

         let decoded = percent_encoding::percent_decode_str(encoded)
            .decode_utf8()
            .unwrap_or_default();

         #[derive(Deserialize)]
         struct Meta {
            t: String,
            i: String,
         }

         if let Ok(meta) = serde_json::from_str::<Meta>(&decoded) {
            if meta.t.is_empty() {
               return Ok(None);
            }
            return Ok(Some(WebviewMetadata {
               title: meta.t,
               favicon: if meta.i.is_empty() {
                  None
               } else {
                  Some(meta.i)
               },
            }));
         }
      }

      Ok(None)
   } else {
      Err(format!("Webview not found: {webview_label}"))
   }
}

#[command]
pub async fn poll_webview_shortcut(
   app: tauri::AppHandle,
   webview_label: String,
) -> Result<Option<String>, String> {
   #[cfg(target_os = "linux")]
   {
      let (tx, rx) = tokio::sync::oneshot::channel();
      let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

      app.run_on_main_thread(move || {
         let result = with_linux_embedded_webview(&webview_label, |webview| {
            let tx = tx.clone();
            webview
               .evaluate_script_with_callback(
                  "window.__ATHAS_GET_SHORTCUT__ ? window.__ATHAS_GET_SHORTCUT__() : null",
                  move |value: String| {
                     let parsed = serde_json::from_str::<Option<String>>(&value)
                        .map_err(|e| format!("Failed to parse shortcut: {e}"));
                     if let Some(tx) = tx.lock().unwrap().take() {
                        let _ = tx.send(parsed);
                     }
                  },
               )
               .map_err(|e| format!("Failed to get shortcut: {e}"))
         });

         if let Err(error) = result {
            if let Some(tx) = tx.lock().unwrap().take() {
               let _ = tx.send(Err(error));
            }
         }
      })
      .map_err(|e| format!("Failed to schedule embedded webview shortcut poll: {e}"))?;

      return rx
         .await
         .map_err(|_| "Embedded webview shortcut channel dropped".to_string())?;
   }

   if let Some(webview) = app.get_webview(&webview_label) {
      // Check if there's a pending shortcut and move it to the URL hash
      webview
         .eval(
            r#"
            (function() {
               var s = window.__ATHAS_PENDING_SHORTCUT__;
               if (s) {
                  window.__ATHAS_PENDING_SHORTCUT__ = null;
                  window.location.hash = '__athas_shortcut=' + s;
               }
            })();
            "#,
         )
         .map_err(|e| format!("Failed to check shortcut: {e}"))?;

      // Small delay to allow the hash change to take effect
      tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

      // Get the URL and check for shortcut in hash
      let url = webview
         .url()
         .map_err(|e| format!("Failed to get URL: {e}"))?;
      let hash = url.fragment().unwrap_or("");

      if let Some(shortcut) = hash.strip_prefix("__athas_shortcut=") {
         // Clear the hash
         webview
            .eval("window.location.hash = '';")
            .map_err(|e| format!("Failed to clear hash: {e}"))?;

         return Ok(Some(shortcut.to_string()));
      }

      Ok(None)
   } else {
      Err(format!("Webview not found: {webview_label}"))
   }
}
