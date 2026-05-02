#[cfg(feature = "linux")]
pub type AthasAppHandle = tauri::AppHandle<tauri::Cef>;

#[cfg(not(feature = "linux"))]
pub type AthasAppHandle = tauri::AppHandle<tauri::Wry>;
