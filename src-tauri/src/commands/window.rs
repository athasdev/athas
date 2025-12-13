use std::sync::atomic::{AtomicU32, Ordering};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{
   Emitter, Manager, UserAttentionType, WebviewBuilder, WebviewUrl, WebviewWindowBuilder, command,
};

#[command]
pub async fn create_remote_window(
   app: tauri::AppHandle,
   connection_id: String,
   connection_name: String,
) -> Result<(), String> {
   let window_label = format!("remote-{connection_id}");

   // Check if window already exists
   if let Some(existing_window) = app.get_webview_window(&window_label) {
      // Window exists, just focus it and return
      let _ = existing_window.set_focus();
      return Ok(());
   }

   let url = format!("index.html?remote={connection_id}");
   #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
   let mut window_builder =
      WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App(url.into()));

   #[cfg(target_os = "macos")]
   {
      window_builder = window_builder
         .hidden_title(true)
         .title_bar_style(TitleBarStyle::Overlay);
   }

   let window = window_builder
      .transparent(true)
      .inner_size(1200.0, 800.0)
      .min_inner_size(800.0, 600.0)
      .center()
      .build()
      .map_err(|e| format!("Failed to create window: {e}"))?;

   let _ = window.request_user_attention(Some(UserAttentionType::Informational));

   #[cfg(target_os = "macos")]
   {
      use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};

      let window_for_vibrancy = window.clone();
      window
         .run_on_main_thread(move || {
            let _ = apply_vibrancy(
               &window_for_vibrancy,
               NSVisualEffectMaterial::HudWindow,
               None,
               Some(12.0),
            );
         })
         .expect("Failed to run vibrancy on main thread");
   }

   let window_clone = window.clone();
   let connection_id_clone = connection_id.clone();
   let connection_name_clone = connection_name.clone();

   let _ = window.emit(
      "remote-connection-info",
      serde_json::json!({
          "connectionId": connection_id,
          "connectionName": connection_name,
          "isRemoteWindow": true
      }),
   );

   std::thread::spawn(move || {
      std::thread::sleep(std::time::Duration::from_millis(1000));
      let _ = window_clone.emit(
         "remote-connection-info",
         serde_json::json!({
             "connectionId": connection_id_clone,
             "connectionName": connection_name_clone,
             "isRemoteWindow": true
         }),
      );
   });

   Ok(())
}

// Counter for generating unique web viewer labels
static WEB_VIEWER_COUNTER: AtomicU32 = AtomicU32::new(0);

/// React Grab script loader for localhost development URLs
/// Includes both the main react-grab script and the Claude Code client
const REACT_GRAB_SCRIPT: &str = r#"
(function() {
  if (window.__REACT_GRAB_LOADED__) return;
  window.__REACT_GRAB_LOADED__ = true;

  function loadScripts() {
    var script1 = document.createElement('script');
    script1.src = 'https://unpkg.com/react-grab/dist/index.global.js';
    script1.crossOrigin = 'anonymous';

    var script2 = document.createElement('script');
    script2.src = 'https://unpkg.com/@react-grab/claude-code/dist/client.global.js';
    script2.crossOrigin = 'anonymous';

    // Load Claude Code client after main script loads
    script1.onload = function() {
      document.head.appendChild(script2);
    };

    document.head.appendChild(script1);
  }

  // Inject as early as possible
  if (document.head) {
    loadScripts();
  } else {
    // Wait for head to be available
    var observer = new MutationObserver(function(mutations, obs) {
      if (document.head) {
        obs.disconnect();
        loadScripts();
      }
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  }
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

   // Parse and validate URL with localhost-aware protocol handling
   let parsed_url = if url.starts_with("http://") || url.starts_with("https://") {
      url.clone()
   } else if url == "about:blank" {
      "about:blank".to_string()
   } else {
      // Default to HTTP for localhost, HTTPS for everything else
      let normalized = url.to_lowercase();
      if normalized.starts_with("localhost") || normalized.starts_with("127.0.0.1") {
         format!("http://{url}")
      } else {
         format!("https://{url}")
      }
   };

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

   // Always inject react-grab script for web viewer
   webview_builder = webview_builder.initialization_script(REACT_GRAB_SCRIPT);

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
      // Parse URL with localhost-aware protocol handling
      let parsed_url = if url.starts_with("http://") || url.starts_with("https://") {
         url
      } else {
         // Default to HTTP for localhost, HTTPS for everything else
         let normalized = url.to_lowercase();
         if normalized.starts_with("localhost") || normalized.starts_with("127.0.0.1") {
            format!("http://{url}")
         } else {
            format!("https://{url}")
         }
      };

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
