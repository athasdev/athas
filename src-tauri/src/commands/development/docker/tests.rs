use super::{
   DockerComposeService, DockerContainerHealthDetails, DockerContainerRow, DockerDevContainer,
   DockerInspectContainerRow, DockerRegistrySearchRow, DockerStatsRow,
   devcontainer_workspace_folder, discover_dev_containers, discover_workspace_debug_presets,
   docker_delete_env_file, docker_open_env_file, format_docker_launch_error, is_env_file_path,
   normalize_jsonc, parse_compose_ps_output, parse_container_file_archive, parse_env_keys,
   parse_health, parse_json_lines, resolve_workspace_mount, split_command_args,
};
use std::{
   fs,
   io::{Cursor, Error, ErrorKind},
   path::Path,
};

#[test]
fn parses_docker_json_lines() {
   let rows = parse_json_lines::<DockerContainerRow>(
      r#"{"ID":"abc123","Names":"web","Image":"nginx","Command":"\"nginx\"","Status":"Up 2 minutes (healthy)","State":"running","Ports":"0.0.0.0:8080->80/tcp","Networks":"bridge","CreatedAt":"2026-06-27 10:00:00 +0000 UTC","Size":"1.2MB (virtual 142MB)"}"#,
   )
   .expect("valid docker json line");

   assert_eq!(rows.len(), 1);
   assert_eq!(rows[0].id, "abc123");
   assert_eq!(rows[0].size, "1.2MB (virtual 142MB)");
   assert_eq!(parse_health(&rows[0].status).as_deref(), Some("healthy"));
}

#[test]
fn parses_compose_ps_json_array() {
   let rows = parse_compose_ps_output(
      r#"[{"ID":"abc123","Name":"app-web-1","Service":"web","State":"running","Health":"healthy","Status":"running","Publishers":[{"URL":"0.0.0.0","TargetPort":3000,"PublishedPort":8080,"Protocol":"tcp"}]}]"#,
   )
   .expect("valid docker compose json");

   assert_eq!(rows.len(), 1);
   let service = DockerComposeService::from(rows.into_iter().next().unwrap());
   assert_eq!(service.name, "web");
   assert_eq!(service.health.as_deref(), Some("healthy"));
   assert_eq!(service.ports, "0.0.0.0:8080->3000/tcp");
}

#[test]
fn parses_docker_stats_json_lines() {
   let rows = parse_json_lines::<DockerStatsRow>(
      r#"{"ID":"abc123","Name":"web","CPUPerc":"1.25%","MemUsage":"64MiB / 2GiB","MemPerc":"3.12%","NetIO":"1kB / 2kB","BlockIO":"3MB / 4MB","PIDs":"8"}"#,
   )
   .expect("valid docker stats json line");

   assert_eq!(rows.len(), 1);
   assert_eq!(rows[0].id, "abc123");
   assert_eq!(rows[0].cpu_percent, "1.25%");
   assert_eq!(rows[0].memory_percent, "3.12%");
}

#[test]
fn parses_container_health_details() {
   let rows = parse_json_lines::<DockerInspectContainerRow>(
      r#"{"Id":"abc123","Name":"/web","State":{"Health":{"Status":"unhealthy","FailingStreak":2,"Log":[{"Start":"2026-06-27T10:00:00Z","End":"2026-06-27T10:00:01Z","ExitCode":1,"Output":"connection refused\n"}]}}}"#,
   )
   .expect("valid docker inspect json line");

   let health = rows[0].state.health.clone().expect("health state");
   let details = DockerContainerHealthDetails::from(health);

   assert_eq!(details.status, "unhealthy");
   assert_eq!(details.failing_streak, 2);
   assert_eq!(details.last_exit_code, Some(1));
   assert_eq!(details.last_output.as_deref(), Some("connection refused"));
}

#[test]
fn parses_container_file_archive_top_level_entries() {
   let mut builder = tar::Builder::new(Vec::new());
   append_tar_file(&mut builder, "app/package.json", b"{}");
   append_tar_file(&mut builder, "app/src/main.rs", b"fn main() {}");
   let archive = builder.into_inner().expect("archive bytes");

   let entries = parse_container_file_archive(&archive, "/app").expect("container files");

   assert_eq!(entries.len(), 2);
   assert!(
      entries
         .iter()
         .any(|entry| entry.name == "src" && entry.is_directory)
   );
   assert!(entries.iter().any(|entry| {
      entry.name == "package.json" && !entry.is_directory && entry.path == "/app/package.json"
   }));
}

#[test]
fn parses_container_file_archive_without_a_wrapper_directory() {
   let mut builder = tar::Builder::new(Vec::new());
   append_tar_file(&mut builder, "package.json", b"{}");
   append_tar_file(&mut builder, "src/main.rs", b"fn main() {}");
   let archive = builder.into_inner().expect("archive bytes");

   let entries = parse_container_file_archive(&archive, "/app").expect("container files");

   assert_eq!(entries.len(), 2);
   assert!(
      entries
         .iter()
         .any(|entry| entry.name == "src" && entry.path == "/app/src" && entry.is_directory)
   );
   assert!(entries.iter().any(|entry| {
      entry.name == "package.json" && entry.path == "/app/package.json" && !entry.is_directory
   }));
}

#[test]
fn parses_registry_search_json_lines() {
   let rows = parse_json_lines::<DockerRegistrySearchRow>(
      r#"{"Name":"nginx","Description":"Official build of Nginx.","StarCount":"21000","Official":"[OK]","Automated":""}"#,
   )
   .expect("valid docker search json");

   assert_eq!(rows.len(), 1);
   assert_eq!(rows[0].name, "nginx");
   assert_eq!(rows[0].official, "[OK]");
}

#[test]
fn parses_env_file_keys() {
   let keys = parse_env_keys(
      r#"
      # comment
      DATABASE_URL=postgres://localhost
      export NODE_ENV=development
      EMPTY=
      BAD KEY=value
      NODE_ENV=production
      "#,
   );

   assert_eq!(keys, vec!["DATABASE_URL", "EMPTY", "NODE_ENV"]);
}

#[test]
fn allows_only_env_file_names() {
   assert!(is_env_file_path(Path::new(".env")));
   assert!(is_env_file_path(Path::new(".env.local")));
   assert!(is_env_file_path(Path::new("config/.env.production")));
   assert!(!is_env_file_path(Path::new("env")));
   assert!(!is_env_file_path(Path::new(".envrc")));
   assert!(!is_env_file_path(Path::new("package.json")));
}

#[tokio::test]
async fn opens_or_creates_env_files() {
   let workspace = tempfile::tempdir().expect("workspace tempdir");
   let workspace_path = workspace.path().to_string_lossy().into_owned();
   fs::write(
      workspace.path().join(".env.local"),
      "NODE_ENV=development\n",
   )
   .expect("write env file");

   let existing = docker_open_env_file(workspace_path.clone(), ".env.local".to_string())
      .await
      .expect("open existing env file");
   assert_eq!(existing.content, "NODE_ENV=development\n");
   assert_eq!(existing.file.relative_path, ".env.local");
   assert_eq!(existing.file.keys, vec!["NODE_ENV"]);

   let created = docker_open_env_file(workspace_path.clone(), ".env.test".to_string())
      .await
      .expect("create env file");
   assert_eq!(created.content, "");
   assert!(workspace.path().join(".env.test").is_file());

   let invalid = docker_open_env_file(workspace_path, "package.json".to_string())
      .await
      .expect_err("reject non-env file");
   assert!(invalid.contains("Only .env files"));
}

#[tokio::test]
async fn deletes_only_env_files() {
   let workspace = tempfile::tempdir().expect("workspace tempdir");
   let workspace_path = workspace.path().to_string_lossy().into_owned();
   fs::write(workspace.path().join(".env.local"), "NODE_ENV=test\n").expect("write env file");
   fs::write(workspace.path().join("package.json"), "{}\n").expect("write json file");

   docker_delete_env_file(workspace_path.clone(), ".env.local".to_string())
      .await
      .expect("delete env file");
   assert!(!workspace.path().join(".env.local").exists());

   let invalid = docker_delete_env_file(workspace_path, "package.json".to_string())
      .await
      .expect_err("reject non-env delete");
   assert!(invalid.contains("Only .env files"));
   assert!(workspace.path().join("package.json").exists());
}

#[test]
fn splits_docker_run_commands_like_shell_words() {
   let args =
      split_command_args(r#"sh -lc "echo hello world" --flag='quoted value' '' escaped\ space"#)
         .expect("valid command args");

   assert_eq!(
      args,
      vec![
         "sh",
         "-lc",
         "echo hello world",
         "--flag=quoted value",
         "",
         "escaped space"
      ]
   );
}

#[test]
fn rejects_invalid_docker_run_command_syntax() {
   assert!(split_command_args(r#"sh -lc "echo nope"#).is_err());
   assert!(split_command_args(r#"echo dangling\"#).is_err());
}

#[test]
fn explains_missing_docker_cli() {
   let message = format_docker_launch_error(Error::new(ErrorKind::NotFound, "docker"));

   assert!(message.contains("Docker CLI was not found"));
   assert!(message.contains("PATH"));
}

#[test]
fn resolves_devcontainer_workspace_folder_from_mount_target() {
   let workspace = Path::new("/Users/test/project");
   let mut dev_container = DockerDevContainer {
      name: "Project".to_string(),
      config_path: "/Users/test/project/.devcontainer/devcontainer.json".to_string(),
      relative_path: ".devcontainer/devcontainer.json".to_string(),
      kind: "image".to_string(),
      image: Some("ubuntu:latest".to_string()),
      docker_file: None,
      context: None,
      docker_compose_files: Vec::new(),
      service: None,
      workspace_folder: None,
      remote_user: None,
      run_args: Vec::new(),
      container_env: Vec::new(),
      remote_env: Vec::new(),
      workspace_mount: Some(
         "source=${localWorkspaceFolder},target=/workspace,type=bind".to_string(),
      ),
      mounts: Vec::new(),
      forward_ports: Vec::new(),
      on_create_command: None,
      post_create_command: None,
      post_start_command: None,
      post_attach_command: None,
      features: Vec::new(),
   };

   assert_eq!(
      devcontainer_workspace_folder(workspace, &dev_container),
      "/workspace"
   );

   dev_container.workspace_folder = Some("/workspaces/custom".to_string());
   assert_eq!(
      devcontainer_workspace_folder(workspace, &dev_container),
      "/workspaces/custom"
   );

   dev_container.workspace_folder = None;
   dev_container.workspace_mount = Some(
      "source=${localWorkspaceFolder},target=${containerWorkspaceFolder},type=bind".to_string(),
   );
   assert_eq!(
      devcontainer_workspace_folder(workspace, &dev_container),
      "/workspaces/project"
   );
}

#[test]
fn strips_devcontainer_json_comments_without_touching_strings() {
   let normalized = normalize_jsonc(
      r#"{
        // comment
        "name": "https://example.test",
        "image": "mcr.microsoft.com/devcontainers/rust:1",
        /* block
           comment */
        "runArgs": ["--label", "path=//tmp",],
      }"#,
   );
   let value: serde_json::Value = serde_json::from_str(&normalized).expect("jsonc normalized");

   assert_eq!(value["name"], "https://example.test");
   assert_eq!(value["runArgs"][1], "path=//tmp");
}

#[test]
fn discovers_devcontainer_definitions() {
   let workspace = tempfile::tempdir().expect("workspace tempdir");
   let devcontainer_dir = workspace.path().join(".devcontainer");
   fs::create_dir_all(&devcontainer_dir).expect("devcontainer directory");
   fs::write(
      devcontainer_dir.join("devcontainer.json"),
      r#"{
        "name": "Rust",
        "build": { "dockerFile": "Dockerfile", "context": ".." },
        "workspaceFolder": "/workspaces/app",
        "workspaceMount": "source=${localWorkspaceFolder},target=${containerWorkspaceFolder},type=bind",
        "containerEnv": { "RUST_LOG": "debug", "PORT": 3000 },
        "remoteEnv": { "EDITOR": "athas" },
        "mounts": [
          "source=cache,target=/cache,type=volume",
          "source=${localWorkspaceFolderBasename}-cache,target=${containerWorkspaceFolder}/.cache,type=volume"
	           ],
	           "forwardPorts": [3000, "9229/tcp"],
	           "onCreateCommand": { "deps": "bun install", "setup": ["bun", "run", "setup"] },
	           "postCreateCommand": "cargo fetch",
	           "postStartCommand": ["cargo", "test"],
	           "postAttachCommand": "echo attached",
	           "features": { "ghcr.io/devcontainers/features/node:1": {} }
      }"#,
   )
   .expect("devcontainer json");

   let definitions = discover_dev_containers(&workspace.path().to_path_buf());

   assert_eq!(definitions.len(), 1);
   assert_eq!(definitions[0].name, "Rust");
   assert_eq!(definitions[0].kind, "dockerfile");
   assert_eq!(
      definitions[0].workspace_folder.as_deref(),
      Some("/workspaces/app")
   );
   assert_eq!(definitions[0].features.len(), 1);
   assert_eq!(
      definitions[0].workspace_mount.as_deref(),
      Some("source=${localWorkspaceFolder},target=${containerWorkspaceFolder},type=bind")
   );
   assert_eq!(
      resolve_workspace_mount(
         definitions[0].workspace_mount.as_deref().unwrap(),
         workspace.path(),
         "/workspaces/app",
      ),
      format!(
         "source={},target=/workspaces/app,type=bind",
         workspace.path().display()
      )
   );
   assert_eq!(
      definitions[0].container_env,
      vec!["PORT=3000", "RUST_LOG=debug"]
   );
   assert_eq!(definitions[0].remote_env, vec!["EDITOR=athas"]);
   assert_eq!(
      definitions[0].mounts,
      vec![
         "source=cache,target=/cache,type=volume",
         "source=${localWorkspaceFolderBasename}-cache,target=${containerWorkspaceFolder}/.cache,\
          type=volume"
      ]
   );
   assert_eq!(
      resolve_workspace_mount(
         &definitions[0].mounts[1],
         workspace.path(),
         "/workspaces/app"
      ),
      format!(
         "source={}-cache,target=/workspaces/app/.cache,type=volume",
         workspace
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap()
      )
   );
   assert_eq!(definitions[0].forward_ports, vec!["3000", "9229/tcp"]);
   assert_eq!(
      definitions[0].on_create_command.as_deref(),
      Some("bun install && 'bun' 'run' 'setup'")
   );
   assert_eq!(
      definitions[0].post_create_command.as_deref(),
      Some("cargo fetch")
   );
   assert_eq!(
      definitions[0].post_start_command.as_deref(),
      Some("'cargo' 'test'")
   );
   assert_eq!(
      definitions[0].post_attach_command.as_deref(),
      Some("echo attached")
   );
}

#[test]
fn discovers_workspace_debug_presets_from_launch_json() {
   let workspace = tempfile::tempdir().expect("workspace tempdir");
   let vscode_dir = workspace.path().join(".vscode");
   fs::create_dir_all(&vscode_dir).expect("vscode directory");
   fs::write(
      vscode_dir.join("launch.json"),
      r#"{
        "configurations": [
          {
            "name": "Debug server",
            "type": "node",
            "program": "${workspaceFolder}/server.js",
            "cwd": "${workspaceFolder}",
            "args": ["--port", "3000"]
          },
          {
            "name": "Custom",
            "type": "custom",
            "command": "echo ready"
          }
        ]
      }"#,
   )
   .expect("launch json");

   let presets = discover_workspace_debug_presets(workspace.path());

   assert_eq!(presets.len(), 2);
   assert_eq!(presets[0].name, "Debug server (1)");
   assert_eq!(
      presets[0].command,
      "'node' '--inspect-brk' '/workspace/server.js' '--port' '3000'"
   );
   assert_eq!(presets[0].workdir.as_deref(), Some("/workspace"));
   assert_eq!(presets[0].source.as_deref(), Some("launch.json"));
   assert_eq!(presets[1].command, "echo ready");
}

fn append_tar_file(builder: &mut tar::Builder<Vec<u8>>, path: &str, contents: &[u8]) {
   let mut header = tar::Header::new_gnu();
   header.set_path(path).expect("tar path");
   header.set_size(contents.len() as u64);
   header.set_cksum();
   builder
      .append(&header, Cursor::new(contents))
      .expect("append tar file");
}
