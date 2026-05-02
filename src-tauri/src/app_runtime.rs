#[cfg(all(target_os = "linux", feature = "linux"))]
pub type AthasRuntime = tauri::Cef;

#[cfg(not(all(target_os = "linux", feature = "linux")))]
pub type AthasRuntime = tauri::Wry;

pub type AppHandle = tauri::AppHandle<AthasRuntime>;
