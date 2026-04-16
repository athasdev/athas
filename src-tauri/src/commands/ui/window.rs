use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{
   AppHandle, Emitter, Manager, WebviewBuilder, WebviewUrl, WebviewWindow, command,
   webview::PageLoadEvent,
};

// Counter for generating unique web viewer labels
static WEB_VIEWER_COUNTER: AtomicU32 = AtomicU32::new(0);
static APP_WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

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
   app: tauri::AppHandle,
   url: String,
   x: f64,
   y: f64,
   width: f64,
   height: f64,
) -> Result<String, String> {
   let counter = WEB_VIEWER_COUNTER.fetch_add(1, Ordering::SeqCst);
   let webview_label = format!("web-viewer-{counter}");

   let parsed_url = normalize_webview_url(&url)?;

   // Get the main window
   let main_webview_window = app
      .get_webview_window("main")
      .ok_or("Main window not found")?;

   // Get the underlying Window to use add_child
   let main_window = main_webview_window.as_ref().window();

   // Build webview with conditional react-grab injection for localhost
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

   // Create embedded webview within the main window
   let webview = main_window
      .add_child(
         webview_builder,
         tauri::LogicalPosition::new(x, y),
         tauri::LogicalSize::new(width, height),
      )
      .map_err(|e| format!("Failed to create embedded webview: {e}"))?;

   // Set auto resize to follow parent window
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

   if let Some(webview) = app.get_webview(&webview_label) {
      webview
         .set_position(tauri::LogicalPosition::new(x, y))
         .map_err(|e| format!("Failed to set position: {e}"))?;
      webview
         .set_size(tauri::LogicalSize::new(width, height))
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
   if let Some(webview) = app.get_webview(&webview_label) {
      webview
         .set_zoom(zoom_level)
         .map_err(|e| format!("Failed to set zoom: {e}"))?;
      Ok(())
   } else {
      Err(format!("Webview not found: {webview_label}"))
   }
}
