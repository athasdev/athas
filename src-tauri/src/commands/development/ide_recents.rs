use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
   collections::HashSet,
   fs,
   path::{Path, PathBuf},
};
use tauri::command;
use url::Url;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IdeRecentProject {
   pub name: String,
   pub path: String,
   pub source_id: String,
   pub source_name: String,
}

#[derive(Debug, Clone)]
struct CodeStorageSource {
   id: &'static str,
   name: &'static str,
   app_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct ZedStorageSource {
   id: &'static str,
   name: &'static str,
   db_path: PathBuf,
}

#[derive(Debug, Clone)]
struct JetBrainsStorageSource {
   id: &'static str,
   name: String,
   recent_projects_path: PathBuf,
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

#[derive(Debug, Deserialize)]
struct CodeStorageJson {
   #[serde(rename = "profileAssociations")]
   profile_associations: Option<CodeProfileAssociations>,
}

#[derive(Debug, Deserialize)]
struct CodeProfileAssociations {
   workspaces: Option<std::collections::HashMap<String, String>>,
}

#[command]
pub fn get_importable_ide_projects() -> Result<Vec<IdeRecentProject>, String> {
   let mut projects = Vec::new();
   let mut seen = HashSet::new();

   collect_code_recent_projects(&mut projects, &mut seen);
   collect_zed_recent_projects(&mut projects, &mut seen);
   collect_jetbrains_recent_projects(&mut projects, &mut seen);

   Ok(projects)
}

fn collect_code_recent_projects(projects: &mut Vec<IdeRecentProject>, seen: &mut HashSet<String>) {
   for source in code_storage_sources() {
      let db_path = source
         .app_dir
         .join("User")
         .join("globalStorage")
         .join("state.vscdb");
      let storage_path = source
         .app_dir
         .join("User")
         .join("globalStorage")
         .join("storage.json");

      let value = match read_code_recently_opened_value(&db_path) {
         Ok(Some(value)) => value,
         Ok(None) => String::new(),
         Err(error) => {
            log::warn!(
               "Failed to read recent projects from {}: {}",
               db_path.display(),
               error
            );
            continue;
         }
      };

      for path in parse_code_recent_folder_paths(&value) {
         push_project(projects, seen, &source.id, source.name, path);
      }

      for path in read_code_profile_workspace_paths(&storage_path) {
         push_project(projects, seen, &source.id, source.name, path);
      }
   }
}

fn collect_zed_recent_projects(projects: &mut Vec<IdeRecentProject>, seen: &mut HashSet<String>) {
   for source in zed_storage_sources() {
      if !source.db_path.exists() {
         continue;
      }

      let paths = match read_zed_workspace_paths(&source.db_path) {
         Ok(paths) => paths,
         Err(error) => {
            log::warn!(
               "Failed to read recent projects from {}: {}",
               source.db_path.display(),
               error
            );
            continue;
         }
      };

      for path in paths {
         push_project(projects, seen, &source.id, source.name, path);
      }
   }
}

fn collect_jetbrains_recent_projects(
   projects: &mut Vec<IdeRecentProject>,
   seen: &mut HashSet<String>,
) {
   for source in jetbrains_storage_sources() {
      let value = match fs::read_to_string(&source.recent_projects_path) {
         Ok(value) => value,
         Err(error) => {
            if source.recent_projects_path.exists() {
               log::warn!(
                  "Failed to read recent projects from {}: {}",
                  source.recent_projects_path.display(),
                  error
               );
            }
            continue;
         }
      };

      for path in parse_jetbrains_recent_paths(&value) {
         push_project(projects, seen, source.id, &source.name, path);
      }
   }
}

fn push_project(
   projects: &mut Vec<IdeRecentProject>,
   seen: &mut HashSet<String>,
   source_id: &str,
   source_name: &str,
   path: String,
) {
   if !seen.insert(path.clone()) {
      return;
   }

   let path_buf = PathBuf::from(&path);
   if !path_buf.is_dir() {
      return;
   }

   projects.push(IdeRecentProject {
      name: project_name_from_path(&path_buf),
      path,
      source_id: source_id.to_string(),
      source_name: source_name.to_string(),
   });
}

fn read_code_recently_opened_value(path: &Path) -> Result<Option<String>, String> {
   if !path.exists() {
      return Ok(None);
   }

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

fn parse_code_recent_folder_paths(value: &str) -> Vec<String> {
   if value.trim().is_empty() {
      return Vec::new();
   }

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

fn read_code_profile_workspace_paths(path: &Path) -> Vec<String> {
   let Ok(value) = fs::read_to_string(path) else {
      return Vec::new();
   };

   let Ok(storage) = serde_json::from_str::<CodeStorageJson>(&value) else {
      return Vec::new();
   };

   storage
      .profile_associations
      .and_then(|associations| associations.workspaces)
      .map(|workspaces| {
         workspaces
            .into_keys()
            .filter_map(|uri| file_uri_to_path(&uri))
            .collect()
      })
      .unwrap_or_default()
}

fn read_zed_workspace_paths(path: &Path) -> Result<Vec<String>, String> {
   let connection = Connection::open_with_flags(
      path,
      OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
   )
   .map_err(|error| error.to_string())?;

   let has_paths_column = table_has_column(&connection, "workspaces", "paths")?;
   if !has_paths_column {
      return Ok(Vec::new());
   }

   let has_remote_connection_id =
      table_has_column(&connection, "workspaces", "remote_connection_id")?;
   let where_clause = if has_remote_connection_id {
      "where remote_connection_id is null and paths is not null and paths != ''"
   } else {
      "where paths is not null and paths != ''"
   };

   let query =
      format!("select paths, paths_order from workspaces {where_clause} order by timestamp desc");

   let mut statement = connection
      .prepare(&query)
      .map_err(|error| error.to_string())?;

   let rows = statement
      .query_map([], |row| {
         let paths: String = row.get(0)?;
         let paths_order: Option<String> = row.get(1)?;
         Ok((paths, paths_order))
      })
      .map_err(|error| error.to_string())?;

   let mut paths = Vec::new();
   for row in rows {
      let (workspace_paths, paths_order) = row.map_err(|error| error.to_string())?;
      if let Some(path) = parse_zed_primary_path(&workspace_paths, paths_order.as_deref()) {
         paths.push(path);
      }
   }

   Ok(paths)
}

fn table_has_column(
   connection: &Connection,
   table_name: &str,
   column_name: &str,
) -> Result<bool, String> {
   let mut statement = connection
      .prepare(&format!("pragma table_info({table_name})"))
      .map_err(|error| error.to_string())?;

   let columns = statement
      .query_map([], |row| row.get::<_, String>(1))
      .map_err(|error| error.to_string())?;

   for column in columns {
      if column.map_err(|error| error.to_string())? == column_name {
         return Ok(true);
      }
   }

   Ok(false)
}

fn parse_zed_primary_path(paths: &str, paths_order: Option<&str>) -> Option<String> {
   let workspace_paths: Vec<String> = paths
      .split('\n')
      .map(|path| path.trim().trim_end_matches('/').to_string())
      .filter(|path| !path.is_empty())
      .collect();

   if workspace_paths.is_empty() {
      return None;
   }

   let first_index = paths_order
      .and_then(|order| order.split(',').next())
      .and_then(|index| index.trim().parse::<usize>().ok())
      .filter(|index| *index < workspace_paths.len())
      .unwrap_or(0);

   workspace_paths.get(first_index).cloned()
}

fn parse_jetbrains_recent_paths(value: &str) -> Vec<String> {
   let Ok(document) = roxmltree::Document::parse(value) else {
      return Vec::new();
   };

   let mut paths = Vec::new();
   for node in document.descendants() {
      if node.tag_name().name() != "entry" && node.tag_name().name() != "option" {
         continue;
      }

      for attribute in ["key", "value"] {
         let Some(value) = node.attribute(attribute) else {
            continue;
         };

         if let Some(path) = expand_jetbrains_path(value) {
            paths.push(path);
         }
      }
   }

   paths
}

fn expand_jetbrains_path(value: &str) -> Option<String> {
   let trimmed = value.trim();
   if trimmed.is_empty() || trimmed.contains("://") {
      return None;
   }

   let expanded = if let Some(home) = dirs::home_dir() {
      trimmed
         .replace("$USER_HOME$", &home.to_string_lossy())
         .replace("~/", &format!("{}/", home.to_string_lossy()))
   } else {
      trimmed.to_string()
   };

   if expanded.contains('$') {
      return None;
   }

   Some(expanded)
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

fn project_name_from_path(path: &Path) -> String {
   path
      .file_name()
      .map(|name| name.to_string_lossy().into_owned())
      .filter(|name| !name.is_empty())
      .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn code_storage_sources() -> Vec<CodeStorageSource> {
   let mut sources = Vec::new();

   #[cfg(target_os = "macos")]
   if let Some(home) = dirs::home_dir() {
      let base = home.join("Library").join("Application Support");
      sources.extend([
         code_source("vscode", "VS Code", base.join("Code")),
         code_source(
            "vscode-insiders",
            "VS Code Insiders",
            base.join("Code - Insiders"),
         ),
         code_source("vscodium", "VSCodium", base.join("VSCodium")),
         code_source("cursor", "Cursor", base.join("Cursor")),
         code_source("windsurf", "Windsurf", base.join("Windsurf")),
      ]);
   }

   #[cfg(windows)]
   if let Some(app_data) = std::env::var_os("APPDATA") {
      let base = PathBuf::from(app_data);
      sources.extend([
         code_source("vscode", "VS Code", base.join("Code")),
         code_source(
            "vscode-insiders",
            "VS Code Insiders",
            base.join("Code - Insiders"),
         ),
         code_source("vscodium", "VSCodium", base.join("VSCodium")),
         code_source("cursor", "Cursor", base.join("Cursor")),
         code_source("windsurf", "Windsurf", base.join("Windsurf")),
      ]);
   }

   #[cfg(all(unix, not(target_os = "macos")))]
   if let Some(config_dir) = dirs::config_dir() {
      sources.extend([
         code_source("vscode", "VS Code", config_dir.join("Code")),
         code_source(
            "vscode-insiders",
            "VS Code Insiders",
            config_dir.join("Code - Insiders"),
         ),
         code_source("vscodium", "VSCodium", config_dir.join("VSCodium")),
         code_source("cursor", "Cursor", config_dir.join("Cursor")),
         code_source("windsurf", "Windsurf", config_dir.join("Windsurf")),
      ]);
   }

   sources
}

fn code_source(id: &'static str, name: &'static str, app_dir: PathBuf) -> CodeStorageSource {
   CodeStorageSource { id, name, app_dir }
}

fn zed_storage_sources() -> Vec<ZedStorageSource> {
   let mut sources = Vec::new();

   #[cfg(target_os = "macos")]
   if let Some(home) = dirs::home_dir() {
      let base = home
         .join("Library")
         .join("Application Support")
         .join("Zed")
         .join("db");
      sources.extend([
         zed_source("zed", "Zed", base.join("0-stable").join("db.sqlite")),
         zed_source(
            "zed-preview",
            "Zed Preview",
            base.join("0-preview").join("db.sqlite"),
         ),
         zed_source("zed-dev", "Zed Dev", base.join("0-dev").join("db.sqlite")),
      ]);
   }

   #[cfg(windows)]
   if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
      let base = PathBuf::from(local_app_data).join("Zed").join("db");
      sources.extend([
         zed_source("zed", "Zed", base.join("0-stable").join("db.sqlite")),
         zed_source(
            "zed-preview",
            "Zed Preview",
            base.join("0-preview").join("db.sqlite"),
         ),
         zed_source("zed-dev", "Zed Dev", base.join("0-dev").join("db.sqlite")),
      ]);
   }

   #[cfg(all(unix, not(target_os = "macos")))]
   if let Some(data_dir) = dirs::data_dir() {
      let base = data_dir.join("zed").join("db");
      sources.extend([
         zed_source("zed", "Zed", base.join("0-stable").join("db.sqlite")),
         zed_source(
            "zed-preview",
            "Zed Preview",
            base.join("0-preview").join("db.sqlite"),
         ),
         zed_source("zed-dev", "Zed Dev", base.join("0-dev").join("db.sqlite")),
      ]);
   }

   sources
}

fn zed_source(id: &'static str, name: &'static str, db_path: PathBuf) -> ZedStorageSource {
   ZedStorageSource { id, name, db_path }
}

fn jetbrains_storage_sources() -> Vec<JetBrainsStorageSource> {
   let mut roots = Vec::new();

   #[cfg(target_os = "macos")]
   if let Some(home) = dirs::home_dir() {
      roots.push(
         home
            .join("Library")
            .join("Application Support")
            .join("JetBrains"),
      );
   }

   #[cfg(windows)]
   if let Some(app_data) = std::env::var_os("APPDATA") {
      roots.push(PathBuf::from(app_data).join("JetBrains"));
   }

   #[cfg(all(unix, not(target_os = "macos")))]
   if let Some(config_dir) = dirs::config_dir() {
      roots.push(config_dir.join("JetBrains"));
   }

   let mut sources = Vec::new();
   for root in roots {
      let Ok(entries) = fs::read_dir(root) else {
         continue;
      };

      for entry in entries.flatten() {
         let path = entry.path();
         if !path.is_dir() {
            continue;
         }

         let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
         };

         sources.push(JetBrainsStorageSource {
            id: "jetbrains",
            name: jetbrains_product_name(name),
            recent_projects_path: path.join("options").join("recentProjects.xml"),
         });
      }
   }

   sources
}

fn jetbrains_product_name(config_dir_name: &str) -> String {
   let product = config_dir_name
      .trim_end_matches(|character: char| character.is_ascii_digit() || character == '.')
      .trim();

   if product.is_empty() {
      "JetBrains".to_string()
   } else {
      format!("JetBrains {product}")
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn parses_only_local_code_folder_uris() {
      let value = r#"{
         "entries": [
            { "folderUri": "file:///Users/example/Projects/Athas" },
            { "fileUri": "file:///Users/example/Projects/Athas/src/main.ts" },
            { "folderUri": "vscode-remote://ssh-remote+host/home/sw/app" },
            { "folderUri": "file:///Users/example/Projects/Other%20Project" }
         ]
      }"#;

      assert_eq!(
         parse_code_recent_folder_paths(value),
         vec![
            "/Users/example/Projects/Athas".to_string(),
            "/Users/example/Projects/Other Project".to_string()
         ]
      );
   }

   #[test]
   fn parses_code_storage_profile_workspace_paths() {
      let value = r#"{
         "profileAssociations": {
            "workspaces": {
               "file:///Users/example/Projects/Athas": "__default__profile__",
               "vscode-remote://ssh-remote+host/home/sw/app": "__default__profile__"
            }
         }
      }"#;

      let storage: CodeStorageJson = serde_json::from_str(value).unwrap();
      let paths: Vec<String> = storage
         .profile_associations
         .and_then(|associations| associations.workspaces)
         .unwrap()
         .into_keys()
         .filter_map(|uri| file_uri_to_path(&uri))
         .collect();

      assert_eq!(paths, vec!["/Users/example/Projects/Athas".to_string()]);
   }

   #[test]
   fn malformed_code_recent_list_returns_empty_paths() {
      assert!(parse_code_recent_folder_paths("not json").is_empty());
   }

   #[test]
   fn rejects_non_file_uris() {
      assert_eq!(
         file_uri_to_path("vscode-remote://ssh-remote+host/home/sw/app"),
         None
      );
   }

   #[test]
   fn parses_zed_primary_path_with_order() {
      assert_eq!(
         parse_zed_primary_path("/workspace/first\n/workspace/second", Some("1,0")),
         Some("/workspace/second".to_string())
      );
   }

   #[test]
   fn parses_jetbrains_recent_project_paths() {
      let value = r#"
         <application>
           <component name="RecentProjectsManager">
             <option name="recentPaths">
               <list>
                 <option value="$USER_HOME$/Projects/Athas" />
                 <option value="ssh://host/project" />
               </list>
             </option>
           </component>
         </application>
      "#;

      let paths = parse_jetbrains_recent_paths(value);
      assert!(paths.iter().any(|path| path.ends_with("/Projects/Athas")));
      assert!(!paths.iter().any(|path| path.contains("ssh://")));
   }
}
