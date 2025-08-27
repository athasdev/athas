#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri::{Emitter, Manager, UserAttentionType, WebviewUrl, WebviewWindowBuilder, command};

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
   let window_builder = WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App(url.into()));

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
