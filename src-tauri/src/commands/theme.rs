use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static THEME_MONITOR: Mutex<Option<Arc<ThemeMonitor>>> = Mutex::new(None);

pub struct ThemeMonitor {
    app_handle: AppHandle,
    is_running: Arc<Mutex<bool>>,
}

impl ThemeMonitor {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            is_running: Arc::new(Mutex::new(false)),
        }
    }

    pub fn start(&self) {
        let mut running = self.is_running.lock().unwrap();
        if *running {
            return; // Already running
        }
        *running = true;
        drop(running);

        let app_handle = self.app_handle.clone();
        let is_running = self.is_running.clone();

        thread::spawn(move || {
            let mut last_theme = get_system_theme_sync();
            let mut check_count = 0;

            loop {
                if !*is_running.lock().unwrap() {
                    break;
                }

                let current_theme = get_system_theme_sync();
                if current_theme != last_theme {
                    log::info!(
                        "System theme changed from {} to {}",
                        last_theme,
                        current_theme
                    );
                    let _ = app_handle.emit("system-theme-changed", current_theme.clone());
                    last_theme = current_theme;
                    check_count = 0; // Reset counter after change
                } else {
                    check_count += 1;
                }

                // Adaptive polling: check frequently right after start/change, then less frequently
                let sleep_duration = if check_count < 10 {
                    Duration::from_millis(200) // Fast checks for first 2 seconds
                } else if check_count < 60 {
                    Duration::from_millis(500) // Medium checks for next 25 seconds  
                } else {
                    Duration::from_millis(2000) // Slow checks after that
                };

                thread::sleep(sleep_duration);
            }
        });
    }

    pub fn stop(&self) {
        let mut running = self.is_running.lock().unwrap();
        *running = false;
    }
}

fn get_system_theme_sync() -> String {
    #[cfg(target_os = "linux")]
    {
        // Try GNOME color-scheme first (most reliable on modern systems)
        if let Ok(output) = Command::new("gsettings")
            .args(&["get", "org.gnome.desktop.interface", "color-scheme"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let theme = stdout.trim().replace('\'', "").replace('\"', "");
                match theme.as_str() {
                    "prefer-dark" => return "dark".to_string(),
                    "prefer-light" => return "light".to_string(),
                    _ => {} // Continue to fallback
                }
            }
        }

        // Fallback to gtk-theme
        if let Ok(output) = Command::new("gsettings")
            .args(&["get", "org.gnome.desktop.interface", "gtk-theme"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
                if stdout.contains("dark") || stdout.contains("adwaita-dark") {
                    return "dark".to_string();
                }
            }
        }

        // Check for KDE Plasma theme
        if let Ok(output) = Command::new("kreadconfig5")
            .args(&[
                "--file",
                "kdeglobals",
                "--group",
                "General",
                "--key",
                "ColorScheme",
            ])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
                if stdout.contains("dark") || stdout.contains("breeze dark") {
                    return "dark".to_string();
                }
            }
        }

        // Default fallback - assume light theme
        "light".to_string()
    }

    #[cfg(target_os = "macos")]
    {
        // For macOS, try to detect dark mode
        if let Ok(output) = Command::new("defaults")
            .args(&["read", "-g", "AppleInterfaceStyle"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.trim().eq_ignore_ascii_case("dark") {
                    return "dark".to_string();
                }
            }
        }
        "light".to_string()
    }

    #[cfg(target_os = "windows")]
    {
        // For Windows, check registry for dark theme
        if let Ok(output) = Command::new("reg")
            .args(&[
                "query",
                "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                "/v",
                "AppsUseLightTheme",
            ])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.contains("0x0") {
                    return "dark".to_string();
                }
            }
        }
        "light".to_string()
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        "light".to_string()
    }
}

#[tauri::command]
pub async fn get_system_theme() -> Result<String, String> {
    Ok(get_system_theme_sync())
}

#[tauri::command]
pub async fn start_theme_monitoring(app_handle: AppHandle) -> Result<(), String> {
    let monitor = Arc::new(ThemeMonitor::new(app_handle));
    monitor.start();

    let mut global_monitor = THEME_MONITOR.lock().unwrap();
    *global_monitor = Some(monitor);

    Ok(())
}

#[tauri::command]
pub async fn trigger_theme_detection(app_handle: AppHandle) -> Result<String, String> {
    let current_theme = get_system_theme_sync();
    let _ = app_handle.emit("system-theme-changed", current_theme.clone());
    Ok(current_theme)
}

#[tauri::command]
pub async fn stop_theme_monitoring() -> Result<(), String> {
    let mut global_monitor = THEME_MONITOR.lock().unwrap();
    if let Some(monitor) = global_monitor.take() {
        monitor.stop();
    }

    Ok(())
}
