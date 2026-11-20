//! Docker operations driven end to end against the scripted fake CLI.

use crate::{
   Docker, DockerBuildImageRequest, DockerBuildPreset, DockerLogEvent, DockerLogExitEvent,
   DockerLogSink, DockerLogStreams, DockerRegistryLoginRequest, DockerRunImageRequest,
   dev_container_open::docker_exec_shell_command,
   project_config, save_project_config,
   shell::{join_command_output, slugify},
   test_support::{FakeDocker, Reply, fail, ok},
};
use std::{
   fs,
   path::{Path, PathBuf},
   sync::{Arc, Mutex},
   time::Duration,
};

fn canonical_tempdir() -> (tempfile::TempDir, PathBuf) {
   let dir = tempfile::tempdir().expect("tempdir");
   let path = dir.path().canonicalize().expect("canonical tempdir");
   (dir, path)
}

fn path_arg(path: &Path) -> String {
   path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn inventory_merges_stats_and_health_by_id_or_name() {
   let fake = FakeDocker::new(vec![
      ok(
         "ps --all --size",
         concat!(
            r#"{"ID":"c1","Names":"web","Image":"nginx","Command":"nginx","Status":"Up 1 minute (healthy)","State":"running","Ports":"","Networks":"bridge"}"#,
            "\n",
            r#"{"ID":"c2","Names":"db","Image":"postgres","Command":"pg","Status":"Exited (0)","State":"exited","Ports":"","Networks":"bridge"}"#,
            "\n"
         ),
      ),
      ok(
         "stats --no-stream",
         r#"{"Name":"db","CPUPerc":"1.5%","MemUsage":"10MiB / 1GiB"}"#,
      ),
      ok("ps --all --quiet", "c1\nc2\n"),
      ok(
         "inspect --format",
         concat!(
            r#"{"Id":"c1","Name":"/web","State":{"Health":{"Status":"healthy","FailingStreak":0,"Log":[]}}}"#,
            "\n",
            r#"{"Id":"c2","Name":"/db","State":{}}"#,
            "\n"
         ),
      ),
      ok(
         "images --all",
         r#"{"ID":"i1","Repository":"nginx","Tag":"latest","Digest":"<none>","Size":"40MB"}"#,
      ),
      ok(
         "volume ls",
         r#"{"Name":"data","Driver":"local","Scope":"local"}"#,
      ),
      ok(
         "network ls",
         r#"{"ID":"n1","Name":"bridge","Driver":"bridge","Scope":"local"}"#,
      ),
   ]);

   let inventory = fake.docker.inventory().await.expect("inventory");

   assert_eq!(inventory.containers.len(), 2);
   let web = &inventory.containers[0];
   assert_eq!(web.health.as_deref(), Some("healthy"));
   assert_eq!(
      web.health_details
         .as_ref()
         .map(|details| details.status.as_str()),
      Some("healthy")
   );
   assert!(web.stats.is_none());
   let db = &inventory.containers[1];
   assert_eq!(
      db.stats.as_ref().map(|stats| stats.cpu_percent.as_str()),
      Some("1.5%")
   );
   assert!(db.health_details.is_none());
   assert_eq!(inventory.images[0].repository, "nginx");
   assert_eq!(inventory.volumes[0].name, "data");
   assert_eq!(inventory.networks[0].name, "bridge");
   assert!(
      fake
         .lines()
         .contains(&"inspect --format {{json .}} c1 c2".to_string())
   );
}

#[tokio::test]
async fn inventory_tolerates_stats_failures_but_not_listing_failures() {
   let fake = FakeDocker::new(vec![
      ok("ps --all --size", ""),
      fail("stats", "stats unavailable", 1),
      fail("images", "daemon is not running", 1),
   ]);

   let error = fake.docker.inventory().await.expect_err("images failure");

   assert_eq!(error, "daemon is not running");
}

#[tokio::test]
async fn container_actions_validate_input_and_build_arguments() {
   let fake = FakeDocker::new(Vec::new());
   let docker = &fake.docker;

   assert_eq!(
      docker
         .container_action(" ".into(), "start".into(), None)
         .await
         .unwrap_err(),
      "Container id is required."
   );
   assert_eq!(
      docker
         .container_action("c1".into(), "explode".into(), None)
         .await
         .unwrap_err(),
      "Unsupported Docker container action: explode"
   );
   docker
      .container_action("c1".into(), "pause".into(), None)
      .await
      .unwrap();
   docker
      .container_action("c1".into(), "remove".into(), Some(true))
      .await
      .unwrap();
   docker
      .container_logs("c1".into(), None)
      .await
      .expect("logs");
   assert!(docker.container_logs("".into(), None).await.is_err());
   assert_eq!(
      docker
         .image_action("img".into(), "inspect".into(), None)
         .await
         .unwrap_err(),
      "Unsupported Docker image action: inspect"
   );
   docker
      .image_action(" img ".into(), "remove".into(), Some(true))
      .await
      .unwrap();
   docker
      .tag_image("app:1".into(), "registry/app:1".into())
      .await
      .unwrap();
   assert_eq!(
      docker
         .tag_image("app:1".into(), " ".into())
         .await
         .unwrap_err(),
      "Target tag is required."
   );

   assert_eq!(
      fake.lines(),
      vec![
         "pause c1",
         "rm --force c1",
         "logs --timestamps --tail 500 c1",
         "rmi --force img",
         "tag app:1 registry/app:1",
      ]
   );
}

#[tokio::test]
async fn reports_cli_failures_with_stderr_stdout_or_status() {
   let fake = FakeDocker::new(vec![
      fail("pull with-stderr", "  denied: access  \n", 1),
      Reply {
         pattern: "pull with-stdout",
         stdout: b"stdout detail\n",
         stderr: "",
         code: 1,
      },
      fail("pull silent", "", 7),
      Reply {
         pattern: "push binary",
         stdout: &[0xff, 0xfe],
         stderr: "",
         code: 0,
      },
   ]);

   let docker = &fake.docker;
   assert_eq!(
      docker
         .registry_pull("with-stderr".into())
         .await
         .unwrap_err(),
      "denied: access"
   );
   assert_eq!(
      docker
         .registry_pull("with-stdout".into())
         .await
         .unwrap_err(),
      "stdout detail"
   );
   let status = docker.registry_pull("silent".into()).await.unwrap_err();
   assert!(
      status.starts_with("Docker command failed with status"),
      "{status}"
   );
   let binary = docker.registry_push("binary".into()).await.unwrap_err();
   assert!(binary.contains("non-UTF-8"), "{binary}");
   assert_eq!(
      docker.registry_pull("  ".into()).await.unwrap_err(),
      "Image is required."
   );
}

#[tokio::test]
async fn explains_a_missing_docker_cli() {
   let (_dir, root) = canonical_tempdir();
   let docker = Docker::with_program(root.join("missing-docker"));

   let error = docker.registry_push("app".into()).await.unwrap_err();

   assert!(error.contains("Docker CLI was not found"), "{error}");
}

#[tokio::test]
async fn compose_actions_run_in_the_workspace_with_env_files_and_service() {
   let (_dir, workspace) = canonical_tempdir();
   let fake = FakeDocker::new(vec![
      ok("build web", "built\n"),
      ok("up --detach web", "started\n"),
   ]);
   let docker = &fake.docker;
   let workspace_arg = path_arg(&workspace);
   let files = vec!["compose.yaml".to_string()];

   let output = docker
      .compose_action(
         workspace_arg.clone(),
         files.clone(),
         Some(" web ".into()),
         "rebuild".into(),
         Some(vec![".env".into(), "  ".into()]),
      )
      .await
      .expect("rebuild");
   assert_eq!(output, "built\nstarted");

   docker
      .compose_action(
         workspace_arg.clone(),
         files.clone(),
         Some("web".into()),
         "down".into(),
         None,
      )
      .await
      .expect("down");
   docker
      .compose_action(
         workspace_arg.clone(),
         files.clone(),
         Some("web".into()),
         "restart".into(),
         None,
      )
      .await
      .expect("restart");
   docker
      .compose_action(
         workspace_arg.clone(),
         files.clone(),
         None,
         "up".into(),
         None,
      )
      .await
      .expect("up");

   let calls = fake.calls();
   assert_eq!(
      calls.iter().map(|call| call.line()).collect::<Vec<_>>(),
      vec![
         "compose --file compose.yaml --env-file .env build web",
         "compose --file compose.yaml --env-file .env up --detach web",
         "compose --file compose.yaml down",
         "compose --file compose.yaml restart web",
         "compose --file compose.yaml up --detach",
      ]
   );
   assert!(calls.iter().all(|call| call.cwd == workspace_arg));

   assert_eq!(
      docker
         .compose_action(
            workspace_arg.clone(),
            files.clone(),
            None,
            "nuke".into(),
            None
         )
         .await
         .unwrap_err(),
      "Unsupported Docker Compose action: nuke"
   );
   assert_eq!(
      docker
         .compose_action(workspace_arg, Vec::new(), None, "up".into(), None)
         .await
         .unwrap_err(),
      "No Docker Compose files were found for this workspace."
   );
   assert_eq!(
      docker
         .compose_action("wsl://Ubuntu/home".into(), files, None, "up".into(), None)
         .await
         .unwrap_err(),
      "Workspace path is required."
   );
}

#[tokio::test]
async fn compose_project_lists_declared_and_orphaned_services() {
   let (_dir, workspace) = canonical_tempdir();
   fs::write(workspace.join("compose.yaml"), "services: {}\n").unwrap();
   fs::create_dir(workspace.join(".devcontainer")).unwrap();
   fs::write(
      workspace.join(".devcontainer/docker-compose.yml"),
      "services: {}\n",
   )
   .unwrap();
   let fake = FakeDocker::new(vec![
      ok("config --services", "web\nworker\n"),
      ok(
         "ps --all --format json",
         r#"[{"ID":"c1","Name":"app-web-1","Service":"web","State":"running","Status":"Up"},{"ID":"c9","Name":"old","Service":"legacy","State":"exited","Status":"Exited"},{"ID":"c0","Service":" "}]"#,
      ),
   ]);

   let project = fake
      .docker
      .compose_project(Some(path_arg(&workspace)))
      .await
      .expect("compose project");

   assert_eq!(project.workspace_path, Some(path_arg(&workspace)));
   assert_eq!(
      project.files,
      vec![
         path_arg(&workspace.join("compose.yaml")),
         path_arg(&workspace.join(".devcontainer/docker-compose.yml")),
      ]
   );
   let services = project
      .services
      .iter()
      .map(|service| (service.name.as_str(), service.state.as_str()))
      .collect::<Vec<_>>();
   assert_eq!(
      services,
      vec![
         ("legacy", "exited"),
         ("web", "running"),
         ("worker", "not created")
      ]
   );
   assert!(
      fake
         .calls()
         .iter()
         .all(|call| call.cwd == path_arg(&workspace))
   );
}

#[tokio::test]
async fn compose_project_skips_docker_without_a_local_compose_file() {
   let (_dir, workspace) = canonical_tempdir();
   let fake = FakeDocker::new(Vec::new());

   let empty = fake
      .docker
      .compose_project(Some(path_arg(&workspace)))
      .await
      .unwrap();
   assert_eq!(empty.workspace_path, Some(path_arg(&workspace)));
   assert!(empty.files.is_empty());

   for workspace in [
      None,
      Some("remote://host/app".to_string()),
      Some("  ".into()),
   ] {
      let project = fake.docker.compose_project(workspace).await.unwrap();
      assert!(project.workspace_path.is_none());
   }
   assert!(fake.calls().is_empty());
}

#[tokio::test]
async fn builds_images_from_an_existing_context() {
   let (_dir, context) = canonical_tempdir();
   let fake = FakeDocker::new(Vec::new());

   fake
      .docker
      .build_image(DockerBuildImageRequest {
         context_path: path_arg(&context),
         dockerfile_path: Some(" Dockerfile.dev ".into()),
         tag: Some("app:dev".into()),
         build_args: Some(vec!["NODE_ENV=dev".into(), " ".into()]),
      })
      .await
      .expect("build");
   let error = fake
      .docker
      .build_image(DockerBuildImageRequest {
         context_path: path_arg(&context.join("missing")),
         dockerfile_path: None,
         tag: None,
         build_args: None,
      })
      .await
      .unwrap_err();

   assert!(
      error.starts_with("Build context path does not exist:"),
      "{error}"
   );
   let calls = fake.calls();
   assert_eq!(calls.len(), 1);
   assert_eq!(
      calls[0].line(),
      format!(
         "build --tag app:dev --file Dockerfile.dev --build-arg NODE_ENV=dev {}",
         path_arg(&context)
      )
   );
   assert_eq!(calls[0].cwd, path_arg(&context));
}

#[tokio::test]
async fn runs_images_with_shell_split_commands() {
   let fake = FakeDocker::new(vec![ok("run", "container-id\n")]);

   let output = fake
      .docker
      .run_image(DockerRunImageRequest {
         image: " nginx ".into(),
         name: Some("web".into()),
         ports: Some(vec!["8080:80".into(), "".into()]),
         volumes: Some(vec!["data:/data".into()]),
         env: Some(vec!["A=1".into()]),
         env_files: Some(vec![".env".into()]),
         command: Some(r#"sh -c "echo hi""#.into()),
         detach: None,
      })
      .await
      .expect("run");
   assert_eq!(output, "container-id\n");

   let error = fake
      .docker
      .run_image(DockerRunImageRequest {
         image: "nginx".into(),
         name: None,
         ports: None,
         volumes: None,
         env: None,
         env_files: None,
         command: Some("sh -c 'unterminated".into()),
         detach: Some(false),
      })
      .await
      .unwrap_err();
   assert_eq!(error, "Docker command has an unterminated ' quote.");

   let calls = fake.calls();
   assert_eq!(calls.len(), 1);
   assert_eq!(
      calls[0].args,
      vec![
         "run",
         "--detach",
         "--name",
         "web",
         "--publish",
         "8080:80",
         "--volume",
         "data:/data",
         "--env",
         "A=1",
         "--env-file",
         ".env",
         "nginx",
         "sh",
         "-c",
         "echo hi",
      ]
   );
}

#[tokio::test]
async fn prunes_only_known_targets() {
   let fake = FakeDocker::new(Vec::new());

   for target in ["containers", "images", "volumes", "networks", "system"] {
      fake
         .docker
         .prune_resources(target.into(), Some(true))
         .await
         .unwrap();
   }
   assert_eq!(
      fake
         .docker
         .prune_resources("everything".into(), None)
         .await
         .unwrap_err(),
      "Unsupported Docker prune target: everything"
   );

   assert_eq!(
      fake.lines(),
      vec![
         "container prune --force",
         "image prune --all --force",
         "volume prune --all --force",
         "network prune --force",
         "system prune --force --volumes",
      ]
   );
}

#[tokio::test]
async fn logs_in_with_the_password_on_stdin() {
   let fake = FakeDocker::new(vec![ok("login", "Login Succeeded\n")]);

   let output = fake
      .docker
      .registry_login(DockerRegistryLoginRequest {
         registry: Some(" ghcr.io ".into()),
         username: " me ".into(),
         password: "s3cret".into(),
      })
      .await
      .expect("login");
   assert_eq!(output, "Login Succeeded\n");
   assert_eq!(
      fake.lines(),
      vec!["login --username me --password-stdin ghcr.io"]
   );
   assert_eq!(fake.stdin(), "s3cret");

   let missing = fake
      .docker
      .registry_login(DockerRegistryLoginRequest {
         registry: None,
         username: "me".into(),
         password: String::new(),
      })
      .await
      .unwrap_err();
   assert_eq!(missing, "Password is required.");
}

#[tokio::test]
async fn searches_the_registry_with_a_clamped_limit() {
   let fake = FakeDocker::new(vec![ok(
      "search",
      r#"{"Name":"nginx","Description":"web server","StarCount":"20000","IsOfficial":"[OK]"}"#,
   )]);

   let results = fake
      .docker
      .registry_search(" nginx ".into(), Some(1000))
      .await
      .expect("search");

   assert_eq!(results.len(), 1);
   assert_eq!(results[0].name, "nginx");
   assert_eq!(
      fake.lines(),
      vec!["search --limit 100 --format {{json .}} nginx"]
   );
   assert_eq!(
      fake
         .docker
         .registry_search(" ".into(), None)
         .await
         .unwrap_err(),
      "Search query is required."
   );
}

#[tokio::test]
async fn copies_files_between_host_and_container() {
   let (_dir, host) = canonical_tempdir();
   let fake = FakeDocker::new(Vec::new());

   fake
      .docker
      .copy_from_container("c1".into(), "/app/log".into(), " /tmp/log ".into())
      .await
      .unwrap();
   fake
      .docker
      .copy_to_container("c1".into(), path_arg(&host), "/app".into())
      .await
      .unwrap();
   let missing = fake
      .docker
      .copy_to_container("c1".into(), path_arg(&host.join("nope")), "/app".into())
      .await
      .unwrap_err();
   assert!(
      missing.starts_with("Host path does not exist:"),
      "{missing}"
   );
   assert_eq!(
      fake
         .docker
         .copy_from_container("c1".into(), "/app".into(), " ".into())
         .await
         .unwrap_err(),
      "Host path is required."
   );

   assert_eq!(
      fake.lines(),
      vec![
         "cp c1:/app/log /tmp/log".to_string(),
         format!("cp {} c1:/app", path_arg(&host)),
      ]
   );
}

#[tokio::test]
async fn lists_container_files_from_the_copy_archive() {
   let mut builder = tar::Builder::new(Vec::new());
   for (path, contents) in [
      ("app/main.rs", &b"fn main() {}"[..]),
      ("app/src/lib.rs", b""),
   ] {
      let mut header = tar::Header::new_gnu();
      header.set_path(path).unwrap();
      header.set_size(contents.len() as u64);
      header.set_mode(0o644);
      header.set_cksum();
      builder.append(&header, contents).unwrap();
   }
   let archive: &'static [u8] = Box::leak(builder.into_inner().unwrap().into_boxed_slice());
   let fake = FakeDocker::new(vec![Reply {
      pattern: "cp c1:/app -",
      stdout: archive,
      stderr: "",
      code: 0,
   }]);

   let entries = fake
      .docker
      .list_container_files("c1".into(), Some("app".into()))
      .await
      .expect("list files");

   let summary = entries
      .iter()
      .map(|entry| (entry.path.as_str(), entry.is_directory, entry.size))
      .collect::<Vec<_>>();
   assert_eq!(
      summary,
      vec![("/app/main.rs", false, 12), ("/app/src", true, 0)]
   );
   assert_eq!(entries[0].mode.as_deref(), Some("644"));
}

#[tokio::test]
async fn opens_an_image_dev_container_and_runs_create_hooks_once() {
   let (_dir, workspace) = canonical_tempdir();
   fs::create_dir(workspace.join(".devcontainer")).unwrap();
   fs::write(
      workspace.join(".devcontainer/devcontainer.json"),
      r#"{
        // comments are allowed
        "name": "App",
        "image": "node:22",
        "forwardPorts": [3000],
        "containerEnv": { "NODE_ENV": "development" },
        "remoteEnv": { "TOKEN": "it's" },
        "remoteUser": "node",
        "postCreateCommand": "npm install",
        "postStartCommand": "npm run watch",
      }"#,
   )
   .unwrap();
   let fake = FakeDocker::new(vec![
      fail("test -f", "", 1),
      ok("npm install", "installed\n"),
      ok("npm run watch", "watching\n"),
      ok("run --detach", "new-container\n"),
   ]);

   let result = fake
      .docker
      .open_dev_container(
         path_arg(&workspace),
         ".devcontainer/devcontainer.json".into(),
      )
      .await
      .expect("open dev container");

   let slug = slugify(&format!("{}-App", workspace.display()));
   let container_name = format!("athas-devcontainer-{slug}");
   let workspace_folder = format!(
      "/workspaces/{}",
      workspace.file_name().unwrap().to_string_lossy()
   );
   assert_eq!(result.container_id, container_name);
   assert_eq!(result.name, "Dev Container: App");
   assert_eq!(result.output, "new-container\ninstalled\nwatching");
   assert_eq!(
      result.command,
      docker_exec_shell_command(
         &container_name,
         Some(&workspace_folder),
         Some("node"),
         &["TOKEN=it's".to_string()],
      )
   );

   let calls = fake.calls();
   let run = calls
      .iter()
      .find(|call| call.args.first().map(String::as_str) == Some("run"))
      .expect("docker run");
   assert_eq!(
      run.args,
      vec![
         "run".to_string(),
         "--detach".into(),
         "--name".into(),
         container_name.clone(),
         "--workdir".into(),
         workspace_folder.clone(),
         "--volume".into(),
         format!("{}:{}", workspace.display(), workspace_folder),
         "--env".into(),
         "NODE_ENV=development".into(),
         "--publish".into(),
         "3000:3000".into(),
         "node:22".into(),
         "sh".into(),
         "-lc".into(),
         "sleep infinity".into(),
      ]
   );
   let exec_commands = calls
      .iter()
      .filter(|call| call.args.first().map(String::as_str) == Some("exec"))
      .map(|call| call.args.last().unwrap().clone())
      .collect::<Vec<_>>();
   let marker = format!(
      "/tmp/.athas-devcontainer-post-create-{}",
      slugify(&path_arg(
         &workspace.join(".devcontainer/devcontainer.json")
      ))
   );
   assert_eq!(
      exec_commands,
      vec![
         format!("test -f {marker}"),
         "export TOKEN='it'\\''s' && npm install".to_string(),
         format!("mkdir -p /tmp && touch {marker}"),
         "export TOKEN='it'\\''s' && npm run watch".to_string(),
      ]
   );
   assert!(
      calls
         .iter()
         .filter(|call| call.line().contains("npm"))
         .all(|call| call.args[..3] == ["exec", "--user", "node"])
   );
}

#[tokio::test]
async fn restarts_an_existing_dev_container_and_skips_completed_create_hooks() {
   let (_dir, workspace) = canonical_tempdir();
   fs::write(
      workspace.join(".devcontainer.json"),
      r#"{ "name": "App", "image": "node:22", "workspaceFolder": "/src", "onCreateCommand": "setup" }"#,
   )
   .unwrap();
   let fake = FakeDocker::new(vec![ok("ps --all --quiet --filter", "existing-id\n")]);

   let result = fake
      .docker
      .open_dev_container(path_arg(&workspace), ".devcontainer.json".into())
      .await
      .expect("open");

   assert_eq!(result.container_id, "existing-id");
   assert_eq!(result.output, "");
   let lines = fake.lines();
   assert!(lines.contains(&"start existing-id".to_string()));
   assert!(!lines.iter().any(|line| line.starts_with("run ")));
   assert!(!lines.iter().any(|line| line.ends_with("setup")));
}

#[tokio::test]
async fn opens_a_compose_dev_container_through_its_service() {
   let (_dir, workspace) = canonical_tempdir();
   fs::create_dir(workspace.join(".devcontainer")).unwrap();
   fs::write(
      workspace.join(".devcontainer/devcontainer.json"),
      r#"{ "name": "Stack", "dockerComposeFile": "compose.yml", "service": "app", "workspaceFolder": "/workspace" }"#,
   )
   .unwrap();
   let fake = FakeDocker::new(vec![
      ok("up --detach app", "Started\n"),
      ok("ps -q app", "abc123\n"),
   ]);

   let result = fake
      .docker
      .open_dev_container(
         path_arg(&workspace),
         ".devcontainer/devcontainer.json".into(),
      )
      .await
      .expect("open compose dev container");

   assert_eq!(result.container_id, "abc123");
   assert_eq!(result.output, "Started");
   assert!(result.command.contains("'abc123'"));
   let compose_file = path_arg(&workspace.join(".devcontainer/compose.yml"));
   assert_eq!(
      fake.lines(),
      vec![
         format!("compose --file {compose_file} up --detach app"),
         format!("compose --file {compose_file} ps -q app"),
      ]
   );

   let missing_service = workspace.join(".devcontainer/broken.json");
   fs::write(
      &missing_service,
      r#"{ "dockerComposeFile": "compose.yml" }"#,
   )
   .unwrap();
   assert_eq!(
      fake
         .docker
         .open_dev_container(path_arg(&workspace), path_arg(&missing_service))
         .await
         .unwrap_err(),
      "Dev Container Compose config is missing service."
   );
}

#[tokio::test]
async fn rejects_dev_containers_without_an_image_source_or_outside_the_workspace() {
   let (_dir, root) = canonical_tempdir();
   let workspace = root.join("workspace");
   fs::create_dir(&workspace).unwrap();
   fs::write(
      workspace.join(".devcontainer.json"),
      r#"{ "name": "Empty" }"#,
   )
   .unwrap();
   fs::write(root.join("outside.json"), r#"{ "image": "alpine" }"#).unwrap();
   let fake = FakeDocker::new(Vec::new());

   let error = fake
      .docker
      .open_dev_container(path_arg(&workspace), ".devcontainer.json".into())
      .await
      .unwrap_err();
   assert!(
      error.starts_with("Dev Container must specify image"),
      "{error}"
   );

   let error = fake
      .docker
      .open_dev_container(path_arg(&workspace), "../outside.json".into())
      .await
      .unwrap_err();
   assert_eq!(error, "Docker project file must be inside the workspace.");
   let error = fake
      .docker
      .open_dev_container(path_arg(&root.join("gone")), "x.json".into())
      .await
      .unwrap_err();
   assert!(
      error.starts_with("Workspace path does not exist"),
      "{error}"
   );
}

#[tokio::test]
async fn builds_a_dockerfile_dev_container_image_before_running_it() {
   let (_dir, workspace) = canonical_tempdir();
   fs::create_dir(workspace.join(".devcontainer")).unwrap();
   fs::write(
      workspace.join(".devcontainer/devcontainer.json"),
      r#"{ "name": "Built", "build": { "dockerfile": "Dockerfile" }, "workspaceMount": "source=${localWorkspaceFolder},target=/code,type=bind" }"#,
   )
   .unwrap();
   let fake = FakeDocker::new(Vec::new());

   fake
      .docker
      .open_dev_container(
         path_arg(&workspace),
         ".devcontainer/devcontainer.json".into(),
      )
      .await
      .expect("open");

   let tag = format!(
      "athas-devcontainer:{}",
      slugify(&format!("{}-Built", workspace.display()))
   );
   let calls = fake.calls();
   assert_eq!(
      calls[0].args,
      vec![
         "build".to_string(),
         "--file".into(),
         path_arg(&workspace.join(".devcontainer/Dockerfile")),
         "--tag".into(),
         tag.clone(),
         path_arg(&workspace.join(".devcontainer")),
      ]
   );
   let run = calls
      .iter()
      .find(|call| call.args.first().map(String::as_str) == Some("run"))
      .expect("docker run");
   assert!(run.args.windows(2).any(|pair| pair
      == [
         "--mount".to_string(),
         format!("source={},target=/code,type=bind", workspace.display())
      ]));
   assert!(
      run.args
         .windows(2)
         .any(|pair| pair == ["--workdir", "/code"])
   );
   assert!(run.args.contains(&tag));
}

#[derive(Default)]
struct RecordingSink {
   lines: Mutex<Vec<DockerLogEvent>>,
   exits: Mutex<Vec<DockerLogExitEvent>>,
}

impl DockerLogSink for RecordingSink {
   fn line(&self, event: DockerLogEvent) {
      self.lines.lock().unwrap().push(event);
   }

   fn exit(&self, event: DockerLogExitEvent) {
      self.exits.lock().unwrap().push(event);
   }
}

async fn wait_for_exit(sink: &RecordingSink) {
   for _ in 0..200 {
      if !sink.exits.lock().unwrap().is_empty() {
         return;
      }
      tokio::time::sleep(Duration::from_millis(25)).await;
   }
   panic!("log stream never exited");
}

#[tokio::test]
async fn streams_container_logs_until_the_cli_exits() {
   let fake = FakeDocker::new(vec![Reply {
      pattern: "logs --follow --timestamps --tail 300 web",
      stdout: b"line one\nline two\n",
      stderr: "warning\n",
      code: 3,
   }]);
   let streams = DockerLogStreams::default();
   let sink = Arc::new(RecordingSink::default());

   let stream_id = streams
      .start(fake.docker.clone(), "web".into(), None, sink.clone())
      .await
      .expect("start stream");
   wait_for_exit(&sink).await;

   let mut lines = sink
      .lines
      .lock()
      .unwrap()
      .iter()
      .map(|event| {
         assert_eq!(event.stream_id, stream_id);
         assert_eq!(event.container_id, "web");
         (event.stream.clone(), event.line.clone())
      })
      .collect::<Vec<_>>();
   lines.sort();
   assert_eq!(
      lines,
      vec![
         ("stderr".to_string(), "warning".to_string()),
         ("stdout".to_string(), "line one".to_string()),
         ("stdout".to_string(), "line two".to_string()),
      ]
   );
   assert_eq!(
      sink.exits.lock().unwrap().as_slice(),
      [DockerLogExitEvent {
         stream_id,
         container_id: "web".into(),
         code: Some(3),
         error: None,
      }]
   );
   for _ in 0..200 {
      if streams.active_count().await == 0 {
         break;
      }
      tokio::time::sleep(Duration::from_millis(10)).await;
   }
   assert_eq!(streams.active_count().await, 0);
}

#[tokio::test]
async fn reports_log_stream_launch_failures_and_ignores_unknown_stops() {
   let (_dir, root) = canonical_tempdir();
   let streams = DockerLogStreams::default();
   let sink = Arc::new(RecordingSink::default());

   assert_eq!(
      streams
         .start(Docker::default(), " ".into(), None, sink.clone())
         .await
         .unwrap_err(),
      "Container id is required."
   );
   streams
      .start(
         Docker::with_program(root.join("missing-docker")),
         "web".into(),
         Some(10),
         sink.clone(),
      )
      .await
      .expect("start");
   wait_for_exit(&sink).await;

   let exits = sink.exits.lock().unwrap().clone();
   assert_eq!(exits[0].code, None);
   assert!(
      exits[0]
         .error
         .as_deref()
         .is_some_and(|error| error.contains("Docker CLI was not found"))
   );
   streams.stop("").await;
   streams.stop("unknown").await;
}

#[tokio::test]
async fn stopping_a_stream_aborts_it() {
   let (_dir, root) = canonical_tempdir();
   let program = root.join("docker");
   athas_test_support::write_script(&program, "exec sleep 30");
   let streams = DockerLogStreams::default();
   let sink = Arc::new(RecordingSink::default());

   let stream_id = streams
      .start(
         Docker::with_program(program),
         "web".into(),
         None,
         sink.clone(),
      )
      .await
      .unwrap();
   assert_eq!(streams.active_count().await, 1);
   streams.stop(&stream_id).await;

   assert_eq!(streams.active_count().await, 0);
   assert!(sink.exits.lock().unwrap().is_empty());
}

#[test]
fn saves_only_sanitized_presets_and_reloads_discovered_files() {
   let (_dir, workspace) = canonical_tempdir();
   fs::write(workspace.join(".env"), "A=1\nB=2\n").unwrap();
   let mut config = project_config(Some(path_arg(&workspace))).expect("empty config");
   assert!(config.build_presets.is_empty());
   config.build_presets = vec![
      DockerBuildPreset {
         name: " web ".into(),
         context_path: ".".into(),
         dockerfile_path: Some(" ".into()),
         tag: None,
         build_args: vec![" ".into(), "X=1".into()],
      },
      DockerBuildPreset {
         name: " ".into(),
         context_path: ".".into(),
         dockerfile_path: None,
         tag: None,
         build_args: Vec::new(),
      },
   ];

   let saved = save_project_config(path_arg(&workspace), config).expect("save");

   assert_eq!(saved.workspace_path, Some(path_arg(&workspace)));
   assert_eq!(saved.build_presets.len(), 1);
   assert_eq!(saved.build_presets[0].name, "web");
   assert_eq!(saved.build_presets[0].dockerfile_path, None);
   assert_eq!(saved.build_presets[0].build_args, vec!["X=1"]);
   assert_eq!(saved.env_files.len(), 1);
   assert_eq!(saved.env_files[0].keys, vec!["A", "B"]);
   let on_disk: serde_json::Value =
      serde_json::from_str(&fs::read_to_string(workspace.join(".athas/docker.json")).unwrap())
         .unwrap();
   assert_eq!(on_disk["workspacePath"], serde_json::Value::Null);
   assert_eq!(on_disk["envFiles"], serde_json::json!([]));

   assert!(project_config(None).unwrap().workspace_path.is_none());
   assert!(
      project_config(Some(path_arg(&workspace.join("missing"))))
         .unwrap_err()
         .starts_with("Workspace path does not exist")
   );
   fs::write(workspace.join(".athas/docker.json"), "{ nope").unwrap();
   assert!(
      project_config(Some(path_arg(&workspace)))
         .unwrap_err()
         .starts_with("Failed to parse Docker project config")
   );
}

#[test]
fn reads_and_writes_env_files_inside_the_workspace() {
   let (_dir, workspace) = canonical_tempdir();
   let workspace_arg = path_arg(&workspace);

   let written = crate::write_env_file(
      workspace_arg.clone(),
      ".env.local".into(),
      "export TOKEN=abc\n# comment\nPORT=1\n".into(),
   )
   .expect("write");
   assert_eq!(written.keys, vec!["PORT", "TOKEN"]);
   assert_eq!(written.relative_path, ".env.local");
   assert_eq!(
      crate::read_env_file(workspace_arg.clone(), ".env.local".into()).unwrap(),
      "export TOKEN=abc\n# comment\nPORT=1\n"
   );
   assert_eq!(
      crate::write_env_file(workspace_arg.clone(), "config.json".into(), "{}".into()).unwrap_err(),
      "Only .env files can be edited from Docker project settings."
   );
   assert_eq!(
      crate::read_env_file(workspace_arg.clone(), " ".into()).unwrap_err(),
      "File path is required."
   );
   fs::create_dir(workspace.join(".env.dir")).unwrap();
   assert_eq!(
      crate::delete_env_file(workspace_arg, ".env.dir".into()).unwrap_err(),
      "Env file path must point to a file."
   );
}

#[test]
fn formats_shell_helpers_for_container_commands() {
   assert_eq!(
      slugify("/Users/Me/My Project!--App"),
      "users-me-my-project-app"
   );
   assert_eq!(slugify(&"a".repeat(60)).len(), 48);
   assert_eq!(join_command_output(" a \n".into(), "  ".into()), "a");
   assert_eq!(join_command_output("".into(), "b".into()), "b");
   assert_eq!(
      docker_exec_shell_command("c1", Some("/src"), Some(" "), &["BAD".into()]),
      docker_exec_shell_command("c1", Some("/src"), None, &[])
   );
   let command = docker_exec_shell_command("c1", None, Some("dev"), &[]);
   assert!(command.starts_with("docker exec -it --user 'dev' 'c1' sh -lc '"));
}
