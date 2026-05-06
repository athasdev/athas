use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::command;
use url::Url;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct VsCodeRecentProject {
   pub name: String,
   pub path: String,
   pub source: String,
}

#[derive(Debug, Clone)]
struct VsCodeStorageSource {
   name: &'static str,
   path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct RecentlyOpenedPathsList {
   entries: Vec<RecentlyOpenedEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentlyOpenedEntry {
   folder_uri: Option<String>,
}

#[command]
pub fn get_vscode_recent_projects() -> Result<Vec<VsCodeRecentProject>, String> {
   let mut projects = Vec::new();
   let mut seen = HashSet::new();

   for source in vscode_storage_sources() {
      if !source.path.exists() {
         continue;
      }

      let value = match read_recently_opened_value(&source.path) {
         Ok(Some(value)) => value,
         Ok(None) => continue,
         Err(error) => {
            log::warn!(
               "Failed to read VS Code recent projects from {}: {}",
               source.path.display(),
               error
            );
            continue;
         }
      };

      for path in parse_recent_folder_paths(&value) {
         if !seen.insert(path.clone()) {
            continue;
         }

         let path_buf = PathBuf::from(&path);
         if !path_buf.is_dir() {
            continue;
         }

         projects.push(VsCodeRecentProject {
            name: project_name_from_path(&path_buf),
            path,
            source: source.name.to_string(),
         });
      }
   }

   Ok(projects)
}

fn read_recently_opened_value(path: &PathBuf) -> Result<Option<String>, String> {
   let connection = Connection::open_with_flags(
      path,
      OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
   )
   .map_err(|error| error.to_string())?;

   let mut statement = connection
      .prepare("select value from ItemTable where key = 'history.recentlyOpenedPathsList'")
      .map_err(|error| error.to_string())?;

   let result = statement.query_row([], |row| row.get::<_, String>(0));

   match result {
      Ok(value) => Ok(Some(value)),
      Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
      Err(error) => Err(error.to_string()),
   }
}

fn parse_recent_folder_paths(value: &str) -> Vec<String> {
   let Ok(list) = serde_json::from_str::<RecentlyOpenedPathsList>(value) else {
      return Vec::new();
   };

   list
      .entries
      .into_iter()
      .filter_map(|entry| entry.folder_uri)
      .filter_map(|uri| file_uri_to_path(&uri))
      .collect()
}

fn file_uri_to_path(uri: &str) -> Option<String> {
   let parsed = Url::parse(uri).ok()?;
   if parsed.scheme() != "file" {
      return None;
   }

   parsed
      .to_file_path()
      .ok()
      .map(|path| path.to_string_lossy().into_owned())
}

fn project_name_from_path(path: &PathBuf) -> String {
   path
      .file_name()
      .map(|name| name.to_string_lossy().into_owned())
      .filter(|name| !name.is_empty())
      .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn vscode_storage_sources() -> Vec<VsCodeStorageSource> {
   let mut sources = Vec::new();

   #[cfg(target_os = "macos")]
   if let Some(home) = dirs::home_dir() {
      let base = home.join("Library").join("Application Support");
      sources.extend([
         source("VS Code", base.join("Code")),
         source("VS Code Insiders", base.join("Code - Insiders")),
         source("VSCodium", base.join("VSCodium")),
      ]);
   }

   #[cfg(windows)]
   if let Some(app_data) = std::env::var_os("APPDATA") {
      let base = PathBuf::from(app_data);
      sources.extend([
         source("VS Code", base.join("Code")),
         source("VS Code Insiders", base.join("Code - Insiders")),
         source("VSCodium", base.join("VSCodium")),
      ]);
   }

   #[cfg(all(unix, not(target_os = "macos")))]
   if let Some(config_dir) = dirs::config_dir() {
      sources.extend([
         source("VS Code", config_dir.join("Code")),
         source("VS Code Insiders", config_dir.join("Code - Insiders")),
         source("VSCodium", config_dir.join("VSCodium")),
      ]);
   }

   sources
}

fn source(name: &'static str, app_dir: PathBuf) -> VsCodeStorageSource {
   VsCodeStorageSource {
      name,
      path: app_dir
         .join("User")
         .join("globalStorage")
         .join("state.vscdb"),
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn parses_only_local_folder_uris() {
      let value = r#"{
         "entries": [
            { "folderUri": "file:///Users/example/Projects/Athas" },
            { "fileUri": "file:///Users/example/Projects/Athas/src/main.ts" },
            { "folderUri": "vscode-remote://ssh-remote+host/home/sw/app" },
            { "folderUri": "file:///Users/example/Projects/Other%20Project" }
         ]
      }"#;

      assert_eq!(
         parse_recent_folder_paths(value),
         vec![
            "/Users/example/Projects/Athas".to_string(),
            "/Users/example/Projects/Other Project".to_string()
         ]
      );
   }

   #[test]
   fn malformed_recent_list_returns_empty_paths() {
      assert!(parse_recent_folder_paths("not json").is_empty());
   }

   #[test]
   fn rejects_non_file_uris() {
      assert_eq!(
         file_uri_to_path("vscode-remote://ssh-remote+host/home/sw/app"),
         None
      );
   }
}
