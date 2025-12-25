use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::Path, process::Command};
use tauri::State;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TomlTheme {
   pub id: String,
   pub name: String,
   pub description: String,
   pub category: String, // "System" | "Light" | "Dark"
   #[serde(rename = "is_dark")]
   pub is_dark: Option<bool>,
   #[serde(rename = "css_variables")]
   pub css_variables: HashMap<String, String>,
   #[serde(rename = "syntax_tokens")]
   pub syntax_tokens: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TomlThemeFile {
   pub themes: Vec<TomlTheme>,
}

pub type ThemeCache = RwLock<HashMap<String, TomlTheme>>;

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
         .args(["read", "-g", "AppleInterfaceStyle"])
         .output()
         && output.status.success()
      {
         let stdout = String::from_utf8_lossy(&output.stdout);
         if stdout.trim().eq_ignore_ascii_case("dark") {
            return "dark".to_string();
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

pub fn load_theme_from_toml(toml_path: &Path) -> Result<Vec<TomlTheme>, String> {
   let content = fs::read_to_string(toml_path)
      .map_err(|e| format!("Failed to read theme file {}: {}", toml_path.display(), e))?;

   let theme_file: TomlThemeFile = toml::from_str(&content).map_err(|e| {
      format!(
         "Failed to parse TOML theme file {}: {}",
         toml_path.display(),
         e
      )
   })?;

   Ok(theme_file.themes)
}

pub fn load_themes_from_directory(themes_dir: &Path) -> Result<Vec<TomlTheme>, String> {
   let mut all_themes = Vec::new();

   if !themes_dir.exists() {
      return Ok(all_themes);
   }

   let entries = fs::read_dir(themes_dir).map_err(|e| {
      format!(
         "Failed to read themes directory {}: {}",
         themes_dir.display(),
         e
      )
   })?;

   for entry in entries {
      let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
      let path = entry.path();

      if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("toml") {
         match load_theme_from_toml(&path) {
            Ok(mut themes) => all_themes.append(&mut themes),
            Err(e) => {
               eprintln!(
                  "Warning: Failed to load theme from {}: {}",
                  path.display(),
                  e
               );
            }
         }
      }
   }

   Ok(all_themes)
}

#[tauri::command]
pub async fn load_toml_themes(themes_dir: String) -> Result<Vec<TomlTheme>, String> {
   let themes_path = Path::new(&themes_dir);
   load_themes_from_directory(themes_path)
}

#[tauri::command]
pub async fn load_single_toml_theme(theme_path: String) -> Result<Vec<TomlTheme>, String> {
   let path = Path::new(&theme_path);
   load_theme_from_toml(path)
}

#[tauri::command]
pub async fn get_cached_themes(cache: State<'_, ThemeCache>) -> Result<Vec<TomlTheme>, String> {
   let themes = cache.read().await;
   Ok(themes.values().cloned().collect())
}

#[tauri::command]
pub async fn cache_themes(
   themes: Vec<TomlTheme>,
   cache: State<'_, ThemeCache>,
) -> Result<(), String> {
   let mut theme_cache = cache.write().await;
   for theme in themes {
      theme_cache.insert(theme.id.clone(), theme);
   }
   Ok(())
}

#[tauri::command]
pub async fn get_temp_dir() -> Result<String, String> {
   let temp_dir = std::env::temp_dir();
   temp_dir
      .to_str()
      .map(|s| s.to_string())
      .ok_or_else(|| "Failed to convert temp directory path to string".to_string())
}

#[tauri::command]
pub async fn write_temp_file(file_name: String, content: String) -> Result<(), String> {
   let temp_dir = std::env::temp_dir();
   let file_path = temp_dir.join(&file_name);

   fs::write(&file_path, content)
      .map_err(|e| format!("Failed to write temp file {}: {}", file_name, e))?;

   Ok(())
}

#[tauri::command]
pub async fn delete_temp_file(file_name: String) -> Result<(), String> {
   let temp_dir = std::env::temp_dir();
   let file_path = temp_dir.join(&file_name);

   if file_path.exists() {
      fs::remove_file(&file_path)
         .map_err(|e| format!("Failed to delete temp file {}: {}", file_name, e))?;
   }

   Ok(())
}
