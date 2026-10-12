use crate::{
   Docker, DockerDevContainer, DockerDevContainerOpenResult,
   compose::compose_path_args,
   devcontainer::{devcontainer_workspace_folder, read_dev_container, resolve_workspace_mount},
   normalize_optional_value, path_string,
   project_config::{ensure_workspace_dir, resolve_workspace_file},
   require_workspace_path,
   shell::{join_command_output, shell_command_with_context, shell_quote, slugify},
};
use std::path::{Path, PathBuf};

impl Docker {
   /// Starts (building or creating when needed) the dev container described by `config_path`,
   /// runs its lifecycle commands, and returns the shell command that attaches to it.
   pub async fn open_dev_container(
      &self,
      workspace_path: String,
      config_path: String,
   ) -> Result<DockerDevContainerOpenResult, String> {
      let workspace_path = require_workspace_path(workspace_path)?;
      ensure_workspace_dir(&workspace_path)?;
      let config_path = resolve_workspace_file(&workspace_path, config_path)?;
      let dev_container = read_dev_container(&workspace_path, &config_path)?;

      if !dev_container.docker_compose_files.is_empty() {
         return self
            .open_compose_dev_container(&workspace_path, &dev_container)
            .await;
      }

      self
         .open_image_dev_container(&workspace_path, &dev_container)
         .await
   }

   async fn open_compose_dev_container(
      &self,
      workspace_path: &Path,
      dev_container: &DockerDevContainer,
   ) -> Result<DockerDevContainerOpenResult, String> {
      let service = dev_container
         .service
         .clone()
         .ok_or_else(|| "Dev Container Compose config is missing service.".to_string())?;
      let compose_files = dev_container
         .docker_compose_files
         .iter()
         .map(PathBuf::from)
         .collect::<Vec<_>>();
      let mut up_args = compose_path_args(&compose_files);
      up_args.extend(["up".to_string(), "--detach".to_string(), service.clone()]);
      let up_output = self.run_in(&up_args, workspace_path).await?;

      let mut ps_args = compose_path_args(&compose_files);
      ps_args.extend(["ps".to_string(), "-q".to_string(), service.clone()]);
      let container_id = first_line(&self.run_in(&ps_args, workspace_path).await?)
         .ok_or_else(|| format!("Docker Compose did not return a container for {}.", service))?;
      let lifecycle_output = self
         .run_lifecycle_commands(&container_id, dev_container)
         .await?;

      Ok(DockerDevContainerOpenResult {
         command: docker_exec_shell_command(
            &container_id,
            dev_container.workspace_folder.as_deref(),
            dev_container.remote_user.as_deref(),
            &dev_container.remote_env,
         ),
         name: format!("Dev Container: {}", dev_container.name),
         container_id,
         output: join_command_output(up_output, lifecycle_output),
      })
   }

   async fn open_image_dev_container(
      &self,
      workspace_path: &Path,
      dev_container: &DockerDevContainer,
   ) -> Result<DockerDevContainerOpenResult, String> {
      let slug = slugify(&format!(
         "{}-{}",
         workspace_path.display(),
         dev_container.name
      ));
      let image = match (&dev_container.image, &dev_container.docker_file) {
         (Some(image), _) => image.clone(),
         (None, Some(docker_file)) => {
            let tag = format!("athas-devcontainer:{}", slug);
            let context = dev_container
               .context
               .clone()
               .unwrap_or_else(|| path_string(workspace_path));
            self
               .run_owned(&[
                  "build".to_string(),
                  "--file".to_string(),
                  docker_file.clone(),
                  "--tag".to_string(),
                  tag.clone(),
                  context,
               ])
               .await?;
            tag
         }
         (None, None) => {
            return Err(
               "Dev Container must specify image, dockerFile, build.dockerFile, or Docker Compose."
                  .to_string(),
            );
         }
      };
      let container_name = format!("athas-devcontainer-{}", slug);
      let workspace_folder = devcontainer_workspace_folder(workspace_path, dev_container);
      let output = if let Some(container_id) = self.container_id_by_name(&container_name).await? {
         self.run_owned(&["start".to_string(), container_id]).await?;
         String::new()
      } else {
         self
            .run_owned(&dev_container_run_args(
               dev_container,
               workspace_path,
               &workspace_folder,
               &container_name,
               image,
            ))
            .await?
      };
      let container_id = self
         .container_id_by_name(&container_name)
         .await?
         .unwrap_or(container_name);
      let lifecycle_output = self
         .run_lifecycle_commands(&container_id, dev_container)
         .await?;

      Ok(DockerDevContainerOpenResult {
         command: docker_exec_shell_command(
            &container_id,
            Some(&workspace_folder),
            dev_container.remote_user.as_deref(),
            &dev_container.remote_env,
         ),
         name: format!("Dev Container: {}", dev_container.name),
         container_id,
         output: join_command_output(output, lifecycle_output),
      })
   }

   async fn container_id_by_name(&self, container_name: &str) -> Result<Option<String>, String> {
      let output = self
         .run_owned(&[
            "ps".to_string(),
            "--all".to_string(),
            "--quiet".to_string(),
            "--filter".to_string(),
            format!("name=^/{}$", container_name),
         ])
         .await?;
      Ok(first_line(&output))
   }

   /// Runs onCreate/postCreate once per container (tracked by a marker file), then postStart
   /// and postAttach every time.
   async fn run_lifecycle_commands(
      &self,
      container_id: &str,
      dev_container: &DockerDevContainer,
   ) -> Result<String, String> {
      let mut output = String::new();
      if dev_container.on_create_command.is_some() || dev_container.post_create_command.is_some() {
         let marker_path = lifecycle_marker_path(dev_container);
         let marker_exists = self
            .exec_shell(container_id, &format!("test -f {}", marker_path))
            .await
            .is_ok();
         if !marker_exists {
            for command in [
               &dev_container.on_create_command,
               &dev_container.post_create_command,
            ]
            .into_iter()
            .flatten()
            {
               output = join_command_output(
                  output,
                  self
                     .exec_lifecycle_command(container_id, command, dev_container)
                     .await?,
               );
            }
            self
               .exec_shell(
                  container_id,
                  &format!("mkdir -p /tmp && touch {}", marker_path),
               )
               .await?;
         }
      }
      for command in [
         &dev_container.post_start_command,
         &dev_container.post_attach_command,
      ]
      .into_iter()
      .flatten()
      {
         output = join_command_output(
            output,
            self
               .exec_lifecycle_command(container_id, command, dev_container)
               .await?,
         );
      }
      Ok(output)
   }

   async fn exec_lifecycle_command(
      &self,
      container_id: &str,
      command: &str,
      dev_container: &DockerDevContainer,
   ) -> Result<String, String> {
      let command = shell_command_with_context(
         command,
         dev_container.workspace_folder.as_deref(),
         &dev_container.remote_env,
      );
      let mut args = vec!["exec".to_string()];
      if let Some(remote_user) = normalize_optional_value(dev_container.remote_user.clone()) {
         args.push("--user".to_string());
         args.push(remote_user);
      }
      args.extend([
         container_id.to_string(),
         "sh".to_string(),
         "-lc".to_string(),
         command,
      ]);
      self.run_owned(&args).await
   }

   async fn exec_shell(&self, container_id: &str, command: &str) -> Result<String, String> {
      self
         .run_owned(&[
            "exec".to_string(),
            container_id.to_string(),
            "sh".to_string(),
            "-lc".to_string(),
            command.to_string(),
         ])
         .await
   }
}

/// `docker run` arguments that keep an image-based dev container alive with the workspace
/// mounted.
fn dev_container_run_args(
   dev_container: &DockerDevContainer,
   workspace_path: &Path,
   workspace_folder: &str,
   container_name: &str,
   image: String,
) -> Vec<String> {
   let mut args = vec![
      "run".to_string(),
      "--detach".to_string(),
      "--name".to_string(),
      container_name.to_string(),
      "--workdir".to_string(),
      workspace_folder.to_string(),
   ];
   if let Some(workspace_mount) = &dev_container.workspace_mount {
      args.push("--mount".to_string());
      args.push(resolve_workspace_mount(
         workspace_mount,
         workspace_path,
         workspace_folder,
      ));
   } else {
      args.push("--volume".to_string());
      args.push(format!(
         "{}:{}",
         workspace_path.to_string_lossy(),
         workspace_folder
      ));
   }
   for env in &dev_container.container_env {
      args.push("--env".to_string());
      args.push(env.clone());
   }
   for mount in &dev_container.mounts {
      args.push("--mount".to_string());
      args.push(resolve_workspace_mount(
         mount,
         workspace_path,
         workspace_folder,
      ));
   }
   for port in &dev_container.forward_ports {
      args.push("--publish".to_string());
      args.push(publish_port_arg(port));
   }
   args.extend(dev_container.run_args.clone());
   args.extend([
      image,
      "sh".to_string(),
      "-lc".to_string(),
      "sleep infinity".to_string(),
   ]);
   args
}

fn first_line(output: &str) -> Option<String> {
   output
      .lines()
      .next()
      .map(str::trim)
      .filter(|id| !id.is_empty())
      .map(ToString::to_string)
}

fn lifecycle_marker_path(dev_container: &DockerDevContainer) -> String {
   format!(
      "/tmp/.athas-devcontainer-post-create-{}",
      slugify(&dev_container.config_path)
   )
}

/// Publishes a bare forwarded port on the same host port.
fn publish_port_arg(port: &str) -> String {
   if port.contains(':') {
      port.to_string()
   } else {
      let host_port = port.split('/').next().unwrap_or(port);
      format!("{}:{}", host_port, port)
   }
}

/// Interactive `docker exec` command that opens bash (or sh) in the dev container.
pub(crate) fn docker_exec_shell_command(
   container_id: &str,
   workdir: Option<&str>,
   remote_user: Option<&str>,
   remote_env: &[String],
) -> String {
   let shell_probe = "if command -v bash >/dev/null 2>&1; then exec bash; elif command -v sh \
                      >/dev/null 2>&1; then exec sh; else echo \"No interactive shell found in \
                      this container.\" >&2; exit 127; fi";
   let command = shell_command_with_context(shell_probe, workdir, remote_env);
   let user_arg = remote_user
      .filter(|user| !user.trim().is_empty())
      .map(|user| format!(" --user {}", shell_quote(user)))
      .unwrap_or_default();
   format!(
      "docker exec -it{} {} sh -lc {}",
      user_arg,
      shell_quote(container_id),
      shell_quote(&command)
   )
}
