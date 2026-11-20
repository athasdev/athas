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

   let paths = parse_jetbrains_recent_paths(value, Some(Path::new("/Users/example")));
   assert!(paths.iter().any(|path| path.ends_with("/Projects/Athas")));
   assert!(!paths.iter().any(|path| path.contains("ssh://")));
}

fn temp_root() -> (tempfile::TempDir, PathBuf) {
   let dir = tempfile::tempdir().unwrap();
   let root = dir.path().canonicalize().unwrap();
   (dir, root)
}

fn project_dir(root: &Path, name: &str) -> String {
   let path = root.join("projects").join(name);
   fs::create_dir_all(&path).unwrap();
   path.to_string_lossy().into_owned()
}

fn file_uri(path: &str) -> String {
   Url::from_file_path(path).unwrap().to_string()
}

fn write_code_storage(app_dir: &Path, recent: Option<&str>, storage: Option<&str>) {
   let global = app_dir.join("User").join("globalStorage");
   fs::create_dir_all(&global).unwrap();
   if let Some(recent) = recent {
      let connection = Connection::open(global.join("state.vscdb")).unwrap();
      connection
         .execute_batch("create table ItemTable (key text primary key, value text);")
         .unwrap();
      connection
         .execute(
            "insert into ItemTable (key, value) values ('history.recentlyOpenedPathsList', ?1)",
            [recent],
         )
         .unwrap();
   }
   if let Some(storage) = storage {
      fs::write(global.join("storage.json"), storage).unwrap();
   }
}

fn write_zed_db(path: &Path, with_remote_column: bool, rows: &[(&str, Option<&str>, i64)]) {
   fs::create_dir_all(path.parent().unwrap()).unwrap();
   let connection = Connection::open(path).unwrap();
   let remote = if with_remote_column {
      ", remote_connection_id integer"
   } else {
      ""
   };
   connection
      .execute_batch(&format!(
         "create table workspaces (paths text, paths_order text, timestamp integer{remote});"
      ))
      .unwrap();
   for (paths, order, timestamp) in rows {
      connection
         .execute(
            "insert into workspaces (paths, paths_order, timestamp) values (?1, ?2, ?3)",
            rusqlite::params![paths, order, timestamp],
         )
         .unwrap();
   }
   if with_remote_column {
      connection
         .execute(
            "insert into workspaces (paths, timestamp, remote_connection_id) values \
             ('/remote/app', 99, 1)",
            [],
         )
         .unwrap();
   }
}

#[test]
fn collects_existing_projects_from_every_editor_once() {
   let (_dir, root) = temp_root();
   let athas = project_dir(&root, "athas");
   let website = project_dir(&root, "website");
   let zed_only = project_dir(&root, "zed-only");
   let older = project_dir(&root, "older");
   let idea = project_dir(&root, "idea-project");
   let missing = root.join("projects/deleted").to_string_lossy().into_owned();

   let vscode = root.join("Code");
   write_code_storage(
      &vscode,
      Some(&format!(
         r#"{{"entries":[{{"folderUri":"{}"}},{{"folderUri":"{}"}}]}}"#,
         file_uri(&athas),
         file_uri(&missing)
      )),
      Some(&format!(
         r#"{{"profileAssociations":{{"workspaces":{{"{}":"default"}}}}}}"#,
         file_uri(&website)
      )),
   );
   let cursor = root.join("Cursor");
   write_code_storage(
      &cursor,
      Some(&format!(
         r#"{{"entries":[{{"folderUri":"{}"}}]}}"#,
         file_uri(&athas)
      )),
      None,
   );
   let zed_db = root.join("zed/0-stable/db.sqlite");
   write_zed_db(
      &zed_db,
      true,
      &[
         (&older, None, 1),
         (&format!("{athas}\n{zed_only}/"), Some("1,0"), 5),
      ],
   );
   let jetbrains_root = root.join("JetBrains");
   let options = jetbrains_root.join("IntelliJIdea2024.3").join("options");
   fs::create_dir_all(&options).unwrap();
   let home_relative = idea
      .strip_prefix(&*root.to_string_lossy())
      .unwrap()
      .to_string();
   fs::write(
      options.join("recentProjects.xml"),
      format!(
         r#"<application><component name="RecentProjectsManager"><option name="additionalInfo"><map><entry key="$USER_HOME${home_relative}" /><entry key="$APPLICATION_CONFIG_DIR$/x" /></map></option></component></application>"#
      ),
   )
   .unwrap();
   fs::create_dir_all(jetbrains_root.join("PyCharm2024.1")).unwrap();
   fs::write(jetbrains_root.join("stray-file"), "").unwrap();

   let sources = IdeStorageSources {
      code: vec![
         code_source("vscode", "VS Code", vscode),
         code_source("cursor", "Cursor", cursor),
         code_source("windsurf", "Windsurf", root.join("Windsurf")),
      ],
      zed: vec![
         zed_source("zed", "Zed", zed_db),
         zed_source("zed-dev", "Zed Dev", root.join("zed/0-dev/db.sqlite")),
      ],
      jetbrains_roots: vec![jetbrains_root, root.join("NoJetBrains")],
      home: Some(root.clone()),
   };

   let projects = collect_ide_projects(&sources);

   let summary = projects
      .iter()
      .map(|project| {
         (
            project.name.as_str(),
            project.source_id.as_str(),
            project.source_name.as_str(),
         )
      })
      .collect::<Vec<_>>();
   assert_eq!(
      summary,
      vec![
         ("athas", "vscode", "VS Code"),
         ("website", "vscode", "VS Code"),
         ("zed-only", "zed", "Zed"),
         ("older", "zed", "Zed"),
         ("idea-project", "jetbrains", "JetBrains IntelliJIdea"),
      ]
   );
   assert_eq!(projects[0].path, athas);
}

#[test]
fn reads_zed_databases_without_the_remote_column_or_paths() {
   let (_dir, root) = temp_root();
   let legacy = root.join("legacy.sqlite");
   write_zed_db(&legacy, false, &[("/a", None, 1), ("", None, 2)]);
   assert_eq!(
      read_zed_workspace_paths(&legacy).unwrap(),
      vec!["/a".to_string()]
   );

   let ancient = root.join("ancient.sqlite");
   Connection::open(&ancient)
      .unwrap()
      .execute_batch("create table workspaces (workspace_location blob);")
      .unwrap();
   assert!(read_zed_workspace_paths(&ancient).unwrap().is_empty());

   let broken = root.join("broken.sqlite");
   fs::write(&broken, "not a database").unwrap();
   assert!(read_zed_workspace_paths(&broken).is_err());
}

#[test]
fn reads_missing_or_empty_code_state_as_no_history() {
   let (_dir, root) = temp_root();
   assert_eq!(
      read_code_recently_opened_value(&root.join("missing.vscdb")),
      Ok(None)
   );

   let db = root.join("state.vscdb");
   Connection::open(&db)
      .unwrap()
      .execute_batch("create table ItemTable (key text, value text);")
      .unwrap();
   assert_eq!(read_code_recently_opened_value(&db), Ok(None));
   assert!(read_code_profile_workspace_paths(&root.join("storage.json")).is_empty());
   fs::write(root.join("storage.json"), "{ nope").unwrap();
   assert!(read_code_profile_workspace_paths(&root.join("storage.json")).is_empty());
}

#[test]
fn expands_only_local_jetbrains_paths() {
   let home = Path::new("/home/me");
   assert_eq!(
      expand_jetbrains_path("$USER_HOME$/src/app", Some(home)),
      Some("/home/me/src/app".to_string())
   );
   assert_eq!(
      expand_jetbrains_path("~/src/app", Some(home)),
      Some("/home/me/src/app".to_string())
   );
   assert_eq!(expand_jetbrains_path("$USER_HOME$/src", None), None);
   assert_eq!(expand_jetbrains_path("  ", Some(home)), None);
   assert_eq!(
      expand_jetbrains_path("/opt/app", None),
      Some("/opt/app".to_string())
   );
   assert_eq!(
      jetbrains_product_name("WebStorm2024.2"),
      "JetBrains WebStorm"
   );
   assert_eq!(jetbrains_product_name("2024.2"), "JetBrains");
   assert_eq!(project_name_from_path(Path::new("/")), "/");
   assert_eq!(
      parse_zed_primary_path("/a\n/b", Some("7")),
      Some("/a".to_string())
   );
   assert_eq!(parse_zed_primary_path(" \n", None), None);
}
