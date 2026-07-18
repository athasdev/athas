#[cfg(feature = "linux")]
pub type AthasRuntime = tauri::Cef;

#[cfg(not(feature = "linux"))]
pub type AthasRuntime = tauri::Wry;

pub type AppHandle = tauri::AppHandle<AthasRuntime>;
