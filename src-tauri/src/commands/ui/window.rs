use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{
   AppHandle, Manager, TitleBarStyle, WebviewBuilder, WebviewUrl, WebviewWindow, command,
};

// Counter for generating unique web viewer labels
static WEB_VIEWER_COUNTER: AtomicU32 = AtomicU32::new(0);
static APP_WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);

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

   let window = tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
      .title("")
      .inner_size(1200.0, 800.0)
      .min_inner_size(400.0, 400.0)
      .center()
      .decorations(true)
      .resizable(true)
      .shadow(true)
      .hidden_title(true)
      .title_bar_style(TitleBarStyle::Overlay)
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

/// Keyboard shortcut interceptor for web viewer
/// Captures app-level shortcuts and stores them for polling
const SHORTCUT_INTERCEPTOR_SCRIPT: &str = r#"
(function() {
  if (window.__ATHAS_SHORTCUTS_LOADED__) return;
  window.__ATHAS_SHORTCUTS_LOADED__ = true;

  window.__ATHAS_PENDING_SHORTCUT__ = null;

  document.addEventListener('keydown', function(e) {
    const isMod = e.metaKey || e.ctrlKey;
    let shortcut = null;

    // Web viewer specific shortcuts
    if (isMod && e.key === 'l') {
      shortcut = 'focus-url';
    } else if (isMod && e.key === 'r' && !e.shiftKey) {
      shortcut = 'refresh';
    } else if (isMod && e.key === '[') {
      shortcut = 'go-back';
    } else if (isMod && e.key === ']') {
      shortcut = 'go-forward';
    } else if (isMod && e.key === '=') {
      shortcut = 'zoom-in';
    } else if (isMod && e.key === '-') {
      shortcut = 'zoom-out';
    } else if (isMod && e.key === '0') {
      shortcut = 'zoom-reset';
    } else if (e.key === 'Escape') {
      shortcut = 'escape';
    }

    if (shortcut) {
      e.preventDefault();
      e.stopPropagation();
      window.__ATHAS_PENDING_SHORTCUT__ = shortcut;
    }
  }, true);

  // Helper to get and clear pending shortcut
  window.__ATHAS_GET_SHORTCUT__ = function() {
    const s = window.__ATHAS_PENDING_SHORTCUT__;
    window.__ATHAS_PENDING_SHORTCUT__ = null;
    return s;
  };
})();
"#;

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

   // Inject shortcut interceptor script
   webview_builder = webview_builder.initialization_script(SHORTCUT_INTERCEPTOR_SCRIPT);

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
   let trimmed = url.trim();
   if trimmed.is_empty() {
      return Err("URL cannot be empty".to_string());
   }

   if trimmed == "about:blank" {
      return Ok(trimmed.to_string());
   }

   let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
      trimmed.to_string()
   } else {
      let normalized = trimmed.to_lowercase();
      if normalized.starts_with("localhost") || normalized.starts_with("127.0.0.1") {
         format!("http://{trimmed}")
      } else {
         format!("https://{trimmed}")
      }
   };

   let parsed = url::Url::parse(&candidate).map_err(|e| format!("Invalid URL: {e}"))?;
   match parsed.scheme() {
      "http" | "https" => Ok(candidate),
      _ => Err("Only http and https URLs are allowed".to_string()),
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

#[command]
pub async fn poll_webview_shortcut(
   app: tauri::AppHandle,
   webview_label: String,
) -> Result<Option<String>, String> {
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
