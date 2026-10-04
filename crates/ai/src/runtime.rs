#[cfg(feature = "linux")]
pub type AthasAppHandle = tauri::AppHandle<tauri::Cef>;

#[cfg(all(not(feature = "linux"), feature = "tauri-wry"))]
pub type AthasAppHandle = tauri::AppHandle<tauri::Wry>;

#[cfg(all(not(feature = "linux"), not(feature = "tauri-wry")))]
pub type AthasAppHandle = tauri::AppHandle<tauri::test::MockRuntime>;
