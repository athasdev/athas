use crate::app_runtime::AthasRuntime;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
   collections::HashSet,
   fs,
   path::{Path, PathBuf},
   sync::{
      LazyLock, Mutex,
      atomic::{AtomicU32, Ordering},
   },
   time::{Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(all(target_os = "macos", not(feature = "linux")))]
use tauri::TitleBarStyle;
use tauri::{Emitter, Manager, WebviewBuilder, WebviewUrl, command, webview::PageLoadEvent};
#[cfg(all(target_os = "macos", not(feature = "linux")))]
use window_vibrancy::{
   NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy, clear_vibrancy,
};

#[cfg(all(target_os = "macos", not(feature = "linux")))]
const ATHAS_WINDOW_MATERIAL: NSVisualEffectMaterial = NSVisualEffectMaterial::Menu;
#[cfg(all(target_os = "macos", not(feature = "linux")))]
const ATHAS_WINDOW_STATE: NSVisualEffectState = NSVisualEffectState::Active;
#[cfg(all(target_os = "macos", not(feature = "linux")))]
const EMBEDDED_WEBVIEW_CORNER_RADIUS: f64 = 7.0;

// Counter for generating unique web viewer labels
static WEB_VIEWER_COUNTER: AtomicU32 = AtomicU32::new(0);
static APP_WINDOW_COUNTER: AtomicU32 = AtomicU32::new(0);
static EMBEDDED_WEBVIEW_LABELS: LazyLock<Mutex<HashSet<String>>> =
   LazyLock::new(|| Mutex::new(HashSet::new()));

struct EmbeddedWebviewProfile {
   #[cfg_attr(all(target_os = "macos", not(feature = "linux")), allow(dead_code))]
   data_directory: PathBuf,
   #[cfg_attr(any(not(target_os = "macos"), feature = "linux"), allow(dead_code))]
   data_store_identifier: [u8; 16],
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

fn append_window_trace_params(url: String, label: &str, created_at_ms: u128) -> String {
   let separator = if url.contains('?') { '&' } else { '?' };
   format!("{url}{separator}athasWindowTraceId={label}&athasWindowCreatedAtMs={created_at_ms}")
}

fn build_window_open_url(
   request: Option<&CreateAppWindowRequest>,
   label: &str,
   created_at_ms: u128,
) -> String {
   let Some(request) = request else {
      return append_window_trace_params("/".to_string(), label, created_at_ms);
   };

   let has_payload = request.path.is_some() || request.remote_connection_id.is_some();
   if !has_payload {
      return append_window_trace_params("/".to_string(), label, created_at_ms);
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

   append_window_trace_params(format!("/?{}", serializer.finish()), label, created_at_ms)
}

fn window_open_request_kind(request: Option<&CreateAppWindowRequest>) -> &'static str {
   match request {
      Some(request) if request.remote_connection_id.is_some() => "remote",
      Some(request) if request.path.is_some() && request.is_directory.unwrap_or(false) => {
         "directory"
      }
      Some(request) if request.path.is_some() => "file",
      _ => "empty",
   }
}

fn window_open_created_at_ms() -> u128 {
   SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis()
}

fn window_title_for_request(request: Option<&CreateAppWindowRequest>) -> String {
   let name = request.and_then(|request| {
      request
         .remote_connection_name
         .as_deref()
         .filter(|name| !name.trim().is_empty())
         .map(str::trim)
         .map(str::to_string)
         .or_else(|| {
            request.path.as_deref().and_then(|path| {
               Path::new(path)
                  .file_name()
                  .and_then(|name| name.to_str())
                  .filter(|name| !name.trim().is_empty())
                  .map(str::to_string)
            })
         })
   });

   match name {
      Some(name) => format!("{name} - Athas"),
      None => "Athas".to_string(),
   }
}

fn profile_digest(profile_key: &str) -> [u8; 32] {
   let mut hasher = Sha256::new();
   hasher.update(b"athas:web-viewer-profile:");
   hasher.update(profile_key.as_bytes());
   hasher.finalize().into()
}

fn digest_hex(bytes: &[u8]) -> String {
   let mut value = String::with_capacity(bytes.len() * 2);
   for byte in bytes {
      value.push_str(&format!("{byte:02x}"));
   }
   value
}

fn resolve_embedded_webview_profile(
   app: &tauri::AppHandle<AthasRuntime>,
   profile_key: &str,
) -> Result<EmbeddedWebviewProfile, String> {
   let digest = profile_digest(profile_key);
   let data_directory = app
      .path()
      .app_data_dir()
      .map_err(|e| format!("Failed to resolve app data directory: {e}"))?
      .join("web-viewer")
      .join("profiles")
      .join(digest_hex(&digest));

   fs::create_dir_all(&data_directory)
      .map_err(|e| format!("Failed to create web viewer profile directory: {e}"))?;

   let mut data_store_identifier = [0u8; 16];
   data_store_identifier.copy_from_slice(&digest[..16]);

   Ok(EmbeddedWebviewProfile {
      data_directory,
      data_store_identifier,
   })
}

fn normalize_user_agent(user_agent: Option<String>) -> Result<Option<String>, String> {
   let Some(user_agent) = user_agent else {
      return Ok(None);
   };

   let trimmed = user_agent.trim();
   if trimmed.is_empty() {
      return Ok(None);
   }

   if trimmed.chars().any(char::is_control) {
      return Err("User agent cannot contain control characters".to_string());
   }

   Ok(Some(trimmed.to_string()))
}

pub fn configure_app_window(window: &tauri::WebviewWindow<AthasRuntime>) {
   #[cfg(all(target_os = "macos", not(feature = "linux")))]
   {
      let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
      if let Err(error) = apply_vibrancy(
         window,
         ATHAS_WINDOW_MATERIAL,
         Some(ATHAS_WINDOW_STATE),
         None,
      ) {
         log::warn!("Failed to initialize macOS window vibrancy: {error}");
      }
   }

   #[cfg(any(not(target_os = "macos"), feature = "linux"))]
   {
      let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 255)));
   }

   #[cfg(target_os = "windows")]
   {
      let _ = window.set_decorations(false);
   }

   #[cfg(all(target_os = "linux", not(feature = "linux")))]
   {
      let _ = window.set_decorations(false);
   }
}

#[cfg(all(target_os = "macos", not(feature = "linux")))]
fn set_ns_appearance(target: *mut std::ffi::c_void, appearance_name: &str) -> Result<(), String> {
   use objc::{class, msg_send, runtime::Object, sel, sel_impl};
   use std::ffi::CString;

   let appearance_name =
      CString::new(appearance_name).map_err(|e| format!("Invalid macOS appearance name: {e}"))?;

   unsafe {
      let name: *mut Object =
         msg_send![class!(NSString), stringWithUTF8String: appearance_name.as_ptr()];
      if name.is_null() {
         return Err("Failed to create macOS appearance name".to_string());
      }

      let appearance: *mut Object = msg_send![class!(NSAppearance), appearanceNamed: name];
      if appearance.is_null() {
         return Err("Failed to resolve macOS appearance".to_string());
      }

      let target = target.cast::<Object>();
      let _: () = msg_send![target, setAppearance: appearance];
   }

   Ok(())
}

#[cfg(all(target_os = "macos", not(feature = "linux")))]
fn apply_embedded_webview_corner_radius(
   webview: &tauri::Webview<AthasRuntime>,
) -> Result<(), String> {
   webview
      .with_webview(|platform_webview| unsafe {
         use objc::{
            msg_send,
            runtime::{BOOL, Object, YES},
            sel, sel_impl,
         };

         let view = platform_webview.inner().cast::<Object>();
         if view.is_null() {
            return;
         }

         let _: () = msg_send![view, setWantsLayer: YES];
         let layer: *mut Object = msg_send![view, layer];
         if layer.is_null() {
            return;
         }

         let _: () = msg_send![layer, setCornerRadius: EMBEDDED_WEBVIEW_CORNER_RADIUS];
         let _: () = msg_send![layer, setMasksToBounds: YES];
         let _: () = msg_send![layer, setAllowsEdgeAntialiasing: YES as BOOL];
         let _: () = msg_send![layer, setEdgeAntialiasingMask: 15usize];
      })
      .map_err(|e| format!("Failed to apply embedded webview corner radius: {e}"))
}

#[cfg(all(target_os = "macos", not(feature = "linux")))]
fn sync_macos_window_appearance(
   window: &tauri::WebviewWindow<AthasRuntime>,
   theme_type: &str,
   transparency_enabled: bool,
) -> Result<(), String> {
   let appearance_name = match theme_type {
      "light" => "NSAppearanceNameAqua",
      "dark" => "NSAppearanceNameDarkAqua",
      _ => return Err(format!("Unsupported macOS theme appearance: {theme_type}")),
   };

   let ns_window = window
      .ns_window()
      .map_err(|e| format!("Failed to access macOS window: {e}"))?;
   set_ns_appearance(ns_window, appearance_name)?;

   let ns_view = window
      .ns_view()
      .map_err(|e| format!("Failed to access macOS webview: {e}"))?;
   set_ns_appearance(ns_view, appearance_name)?;

   if transparency_enabled {
      let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
      let _ = clear_vibrancy(window);
      apply_vibrancy(
         window,
         ATHAS_WINDOW_MATERIAL,
         Some(ATHAS_WINDOW_STATE),
         None,
      )
      .map_err(|e| format!("Failed to refresh macOS vibrancy: {e}"))?;
   } else {
      let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 255)));
      let _ = clear_vibrancy(window);
   }

   Ok(())
}

#[command]
pub fn uses_native_window_chrome() -> bool {
   cfg!(all(target_os = "linux", feature = "linux"))
}

#[command]
pub fn set_macos_window_appearance(
   window: tauri::WebviewWindow<AthasRuntime>,
   theme_type: String,
   transparency_enabled: Option<bool>,
) -> Result<(), String> {
   #[cfg(all(target_os = "macos", not(feature = "linux")))]
   {
      sync_macos_window_appearance(&window, &theme_type, transparency_enabled.unwrap_or(true))?;
   }

   #[cfg(any(not(target_os = "macos"), feature = "linux"))]
   {
      let _ = window;
      let _ = theme_type;
      let _ = transparency_enabled;
   }

   Ok(())
}

#[command]
pub fn set_window_transparency_enabled(
   window: tauri::WebviewWindow<AthasRuntime>,
   enabled: bool,
) -> Result<(), String> {
   #[cfg(all(target_os = "macos", not(feature = "linux")))]
   {
      if enabled {
         let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
         let _ = clear_vibrancy(&window);
         if let Err(error) = apply_vibrancy(
            &window,
            ATHAS_WINDOW_MATERIAL,
            Some(ATHAS_WINDOW_STATE),
            None,
         ) {
            log::warn!("Failed to apply macOS window vibrancy: {error}");
         }
      } else {
         let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 255)));
         let _ = clear_vibrancy(&window);
      }
   }

   #[cfg(any(not(target_os = "macos"), feature = "linux"))]
   {
      let _ = window;
      let _ = enabled;
   }

   Ok(())
}

fn create_labeled_app_window_internal(
   app: &tauri::AppHandle<AthasRuntime>,
   label: String,
   request: Option<CreateAppWindowRequest>,
) -> Result<String, String> {
   let started_at = Instant::now();
   let created_at_ms = window_open_created_at_ms();
   let request_kind = window_open_request_kind(request.as_ref());
   log::info!("[window-open:{label}] create:start kind={request_kind}");

   let url = build_window_open_url(request.as_ref(), &label, created_at_ms);
   let title = window_title_for_request(request.as_ref());
   let trace_label = label.clone();

   let builder = tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
      .title(title)
      .inner_size(1200.0, 800.0)
      .min_inner_size(400.0, 400.0)
      .center()
      .decorations(true)
      .transparent(cfg!(target_os = "macos"))
      .resizable(true)
      .shadow(true)
      .on_page_load(move |_window, payload| {
         let event = match payload.event() {
            PageLoadEvent::Started => "started",
            PageLoadEvent::Finished => "finished",
         };
         log::info!(
            "[window-open:{trace_label}] page-load:{event} elapsedMs={}",
            started_at.elapsed().as_millis()
         );
      });

   #[cfg(any(
      target_os = "windows",
      all(target_os = "linux", not(feature = "linux"))
   ))]
   let builder = builder.decorations(false);

   #[cfg(all(target_os = "macos", not(feature = "linux")))]
   let builder = builder
      .hidden_title(true)
      .title_bar_style(TitleBarStyle::Overlay)
      .traffic_light_position(tauri::LogicalPosition::new(14.0, 20.0));

   let build_started_at = Instant::now();
   let window = builder
      .build()
      .map_err(|e| format!("Failed to create app window: {e}"))?;
   log::info!(
      "[window-open:{label}] build:end durationMs={} totalMs={}",
      build_started_at.elapsed().as_millis(),
      started_at.elapsed().as_millis()
   );

   let configure_started_at = Instant::now();
   configure_app_window(&window);
   log::info!(
      "[window-open:{label}] configure:end durationMs={} totalMs={}",
      configure_started_at.elapsed().as_millis(),
      started_at.elapsed().as_millis()
   );

   let show_started_at = Instant::now();
   let _ = window.show();
   let _ = window.set_focus();
   log::info!(
      "[window-open:{label}] show-focus:end durationMs={} totalMs={}",
      show_started_at.elapsed().as_millis(),
      started_at.elapsed().as_millis()
   );

   Ok(label)
}

pub fn create_app_window_internal(
   app: &tauri::AppHandle<AthasRuntime>,
   request: Option<CreateAppWindowRequest>,
) -> Result<String, String> {
   let label = format!(
      "main-{}",
      APP_WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst) + 1
   );

   create_labeled_app_window_internal(app, label, request)
}

#[command]
pub async fn create_app_window(
   app: tauri::AppHandle<AthasRuntime>,
   request: Option<CreateAppWindowRequest>,
) -> Result<String, String> {
   let started_at = Instant::now();
   let request_kind = window_open_request_kind(request.as_ref());
   log::info!("[window-open:command] create_app_window:start kind={request_kind}");
   let result = create_app_window_internal(&app, request);
   match &result {
      Ok(label) => log::info!(
         "[window-open:{label}] create_app_window:end durationMs={}",
         started_at.elapsed().as_millis()
      ),
      Err(error) => log::error!(
         "[window-open:command] create_app_window:error durationMs={} error={error}",
         started_at.elapsed().as_millis()
      ),
   }
   result
}

fn build_webview_bridge_script(
   webview_label: &str,
   parent_window_label: &str,
) -> Result<String, String> {
   let encoded_label = serde_json::to_string(webview_label)
      .map_err(|e| format!("Failed to serialize webview label: {e}"))?;
   let encoded_parent_window_label = serde_json::to_string(parent_window_label)
      .map_err(|e| format!("Failed to serialize parent window label: {e}"))?;

   Ok(format!(
      r#"
(function() {{
  if (window.__ATHAS_WEBVIEW_BRIDGE_LOADED__) return;
  window.__ATHAS_WEBVIEW_BRIDGE_LOADED__ = true;

  const WEBVIEW_LABEL = {encoded_label};
  const PARENT_WINDOW_LABEL = {encoded_parent_window_label};

  function emit(event, payload) {{
    const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    if (typeof invoke !== 'function') return;

    try {{
      const result = invoke('plugin:event|emit', {{ event, payload }});
      if (result && typeof result.catch === 'function') {{
        void result.catch(() => {{}});
      }}
    }} catch (_) {{}}
  }}

  function emitShortcut(shortcut) {{
    emit('embedded-webview-shortcut', {{
      parentWindowLabel: PARENT_WINDOW_LABEL,
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

    const key = typeof e.key === 'string' ? e.key.toLowerCase() : e.key;

    if (isMod && e.key === 'Tab') {{
      shortcut = 'global:switch-tab';
    }} else if (isMod && !isShift && key === 'j') {{
      shortcut = 'global:toggle-terminal';
    }} else if (isMod && !isShift && key === 'b') {{
      shortcut = 'global:toggle-sidebar';
    }} else if (isMod && isShift && key === 'p') {{
      shortcut = 'global:command-palette';
    }} else if (isMod && !isShift && key === 'k') {{
      shortcut = 'global:command-palette';
    }} else if (isMod && !isShift && key === 'p') {{
      shortcut = 'global:quick-open';
    }} else if (isMod && !isShift && key === 'w') {{
      shortcut = 'global:close-tab';
    }} else if (isMod && isShift && key === 't') {{
      shortcut = 'global:reopen-tab';
    }} else if (isMod && !isShift && key === 't') {{
      shortcut = 'global:new-tab';
    }} else if (isMod && isShift && key === 'n') {{
      shortcut = 'global:new-private-window';
    }} else if (isMod && !isShift && key === 'n') {{
      shortcut = 'global:new-window';
    }} else if (isMod && isShift && key === 'f') {{
      shortcut = 'global:find-in-files';
    }} else if (isMod && !isShift && key === 'f') {{
      shortcut = 'global:find';
    }} else if (isMod && e.key === ',') {{
      shortcut = 'global:settings';
    }} else if (isMod && !isShift && key === 'l') {{
      shortcut = 'focus-url';
    }} else if (isMod && key === 'r' && !isShift) {{
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
#[allow(clippy::too_many_arguments)]
pub async fn create_embedded_webview(
   app: tauri::AppHandle<AthasRuntime>,
   window: tauri::WebviewWindow<AthasRuntime>,
   url: String,
   profile_key: String,
   user_agent: Option<String>,
   x: f64,
   y: f64,
   width: f64,
   height: f64,
) -> Result<String, String> {
   let counter = WEB_VIEWER_COUNTER.fetch_add(1, Ordering::SeqCst);
   let webview_label = format!("web-viewer-{counter}");

   let parsed_url = normalize_webview_url(&url)?;
   let profile = resolve_embedded_webview_profile(&app, &profile_key)?;
   let user_agent = normalize_user_agent(user_agent)?;
   let parent_window_label = window.label().to_string();
   let parent_window = window.as_ref().window();

   // Build webview with conditional react-grab injection for localhost
   let mut webview_builder = WebviewBuilder::new(
      &webview_label,
      WebviewUrl::External(
         parsed_url
            .parse()
            .map_err(|e| format!("Invalid URL: {e}"))?,
      ),
   );

   #[cfg(all(target_os = "macos", not(feature = "linux")))]
   {
      webview_builder = webview_builder.data_store_identifier(profile.data_store_identifier);
   }

   #[cfg(any(not(target_os = "macos"), feature = "linux"))]
   {
      webview_builder = webview_builder.data_directory(profile.data_directory);
   }

   if let Some(user_agent) = user_agent.as_deref() {
      webview_builder = webview_builder.user_agent(user_agent);
   }

   webview_builder = webview_builder.initialization_script(build_webview_bridge_script(
      &webview_label,
      &parent_window_label,
   )?);
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

   // Create embedded webview within the window that requested it.
   let webview = parent_window
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

   #[cfg(all(target_os = "macos", not(feature = "linux")))]
   apply_embedded_webview_corner_radius(&webview)?;

   if let Ok(mut labels) = EMBEDDED_WEBVIEW_LABELS.lock() {
      labels.insert(webview_label.clone());
   }

   Ok(webview_label)
}

#[command]
pub async fn clear_embedded_webview_browsing_data(
   app: tauri::AppHandle<AthasRuntime>,
   webview_label: String,
) -> Result<(), String> {
   if let Some(webview) = app.get_webview(&webview_label) {
      webview
         .clear_all_browsing_data()
         .map_err(|e| format!("Failed to clear webview browsing data: {e}"))?;
      Ok(())
   } else {
      Err(format!("Webview not found: {webview_label}"))
   }
}

#[command]
pub async fn close_embedded_webview(
   app: tauri::AppHandle<AthasRuntime>,
   webview_label: String,
) -> Result<(), String> {
   if let Some(webview) = app.get_webview(&webview_label) {
      webview
         .close()
         .map_err(|e| format!("Failed to close webview: {e}"))?;
   }
   if let Ok(mut labels) = EMBEDDED_WEBVIEW_LABELS.lock() {
      labels.remove(&webview_label);
   }
   Ok(())
}

#[command]
pub async fn close_all_embedded_webviews(
   app: tauri::AppHandle<AthasRuntime>,
) -> Result<(), String> {
   let labels = EMBEDDED_WEBVIEW_LABELS
      .lock()
      .map(|labels| labels.iter().cloned().collect::<Vec<_>>())
      .unwrap_or_default();

   let mut close_errors = Vec::new();
   for label in labels {
      if let Some(webview) = app.get_webview(&label)
         && let Err(error) = webview.close()
      {
         close_errors.push(format!("{label}: {error}"));
      }
   }

   if let Ok(mut labels) = EMBEDDED_WEBVIEW_LABELS.lock() {
      labels.clear();
   }

   if close_errors.is_empty() {
      Ok(())
   } else {
      Err(format!(
         "Failed to close embedded webviews: {}",
         close_errors.join(", ")
      ))
   }
}

#[command]
pub async fn navigate_embedded_webview(
   app: tauri::AppHandle<AthasRuntime>,
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
   app: tauri::AppHandle<AthasRuntime>,
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
   app: tauri::AppHandle<AthasRuntime>,
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
         if let Some(main_webview) = app.get_webview_window("main") {
            let _ = main_webview.set_focus();
         }
      }
   } else {
      return Err(format!("Webview not found: {webview_label}"));
   }
   Ok(())
}

#[command]
pub async fn open_webview_devtools(
   app: tauri::AppHandle<AthasRuntime>,
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

#[command]
pub async fn reopen_current_webview_devtools(
   window: tauri::WebviewWindow<AthasRuntime>,
) -> Result<(), String> {
   #[cfg(any(debug_assertions, feature = "devtools"))]
   {
      if window.is_devtools_open() {
         window.close_devtools();
      }
      window.open_devtools();
      Ok(())
   }

   #[cfg(not(any(debug_assertions, feature = "devtools")))]
   {
      let _ = window;
      Err("Webview devtools are unavailable in release builds".to_string())
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
   app: tauri::AppHandle<AthasRuntime>,
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
