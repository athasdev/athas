use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerInventory {
   pub containers: Vec<DockerContainer>,
   pub images: Vec<DockerImage>,
   pub volumes: Vec<DockerVolume>,
   pub networks: Vec<DockerNetwork>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
   pub id: String,
   pub name: String,
   pub image: String,
   pub command: String,
   pub status: String,
   pub state: String,
   pub ports: String,
   pub networks: String,
   pub created_at: String,
   pub health: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImage {
   pub id: String,
   pub repository: String,
   pub tag: String,
   pub digest: String,
   pub size: String,
   pub created_since: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerVolume {
   pub name: String,
   pub driver: String,
   pub scope: String,
   pub mountpoint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerNetwork {
   pub id: String,
   pub name: String,
   pub driver: String,
   pub scope: String,
   pub internal: String,
   pub ipv6: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerContainerRow {
   #[serde(rename = "ID")]
   id: String,
   names: String,
   image: String,
   command: String,
   status: String,
   state: String,
   ports: String,
   networks: String,
   #[serde(default)]
   created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerImageRow {
   #[serde(rename = "ID")]
   id: String,
   repository: String,
   tag: String,
   digest: String,
   size: String,
   #[serde(default)]
   created_since: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerVolumeRow {
   name: String,
   driver: String,
   scope: String,
   #[serde(default)]
   mountpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerNetworkRow {
   #[serde(rename = "ID")]
   id: String,
   name: String,
   driver: String,
   scope: String,
   #[serde(default)]
   internal: String,
   #[serde(default, rename = "IPv6")]
   ipv6: String,
}

#[tauri::command]
pub async fn docker_get_inventory() -> Result<DockerInventory, String> {
   Ok(DockerInventory {
      containers: docker_list_containers().await?,
      images: docker_list_images().await?,
      volumes: docker_list_volumes().await?,
      networks: docker_list_networks().await?,
   })
}

#[tauri::command]
pub async fn docker_container_action(
   container_id: String,
   action: String,
   force: Option<bool>,
) -> Result<(), String> {
   if container_id.trim().is_empty() {
      return Err("Container id is required.".to_string());
   }

   let mut args = match action.as_str() {
      "start" | "stop" | "restart" | "pause" | "unpause" => vec![action, container_id],
      "remove" => {
         let mut args = vec!["rm".to_string()];
         if force.unwrap_or(false) {
            args.push("--force".to_string());
         }
         args.push(container_id);
         args
      }
      _ => return Err(format!("Unsupported Docker container action: {}", action)),
   };

   let borrowed = args.iter().map(String::as_str).collect::<Vec<_>>();
   run_docker(&borrowed).await?;
   args.clear();
   Ok(())
}

#[tauri::command]
pub async fn docker_get_container_logs(
   container_id: String,
   tail: Option<u16>,
) -> Result<String, String> {
   if container_id.trim().is_empty() {
      return Err("Container id is required.".to_string());
   }

   let tail = tail.unwrap_or(500).to_string();
   run_docker(&["logs", "--timestamps", "--tail", &tail, &container_id]).await
}

async fn docker_list_containers() -> Result<Vec<DockerContainer>, String> {
   let output = run_docker(&["ps", "--all", "--format", "{{json .}}"]).await?;
   parse_json_lines::<DockerContainerRow>(&output)
      .map(|rows| rows.into_iter().map(DockerContainer::from).collect())
}

async fn docker_list_images() -> Result<Vec<DockerImage>, String> {
   let output = run_docker(&["images", "--all", "--format", "{{json .}}"]).await?;
   parse_json_lines::<DockerImageRow>(&output)
      .map(|rows| rows.into_iter().map(Into::into).collect())
}

async fn docker_list_volumes() -> Result<Vec<DockerVolume>, String> {
   let output = run_docker(&["volume", "ls", "--format", "{{json .}}"]).await?;
   parse_json_lines::<DockerVolumeRow>(&output)
      .map(|rows| rows.into_iter().map(Into::into).collect())
}

async fn docker_list_networks() -> Result<Vec<DockerNetwork>, String> {
   let output = run_docker(&["network", "ls", "--format", "{{json .}}"]).await?;
   parse_json_lines::<DockerNetworkRow>(&output)
      .map(|rows| rows.into_iter().map(Into::into).collect())
}

async fn run_docker(args: &[&str]) -> Result<String, String> {
   let output = Command::new("docker")
      .args(args)
      .output()
      .await
      .map_err(|error| format!("Failed to launch Docker CLI: {}", error))?;

   if output.status.success() {
      return String::from_utf8(output.stdout)
         .map_err(|error| format!("Docker returned non-UTF-8 output: {}", error));
   }

   let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
   let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
   let detail = if !stderr.is_empty() { stderr } else { stdout };

   Err(if detail.is_empty() {
      format!("Docker command failed with status {}", output.status)
   } else {
      detail
   })
}

fn parse_json_lines<T>(output: &str) -> Result<Vec<T>, String>
where
   T: for<'de> Deserialize<'de>,
{
   output
      .lines()
      .filter(|line| !line.trim().is_empty())
      .map(|line| {
         serde_json::from_str(line)
            .map_err(|error| format!("Failed to parse Docker output: {}", error))
      })
      .collect()
}

fn parse_health(status: &str) -> Option<String> {
   if status.contains("(healthy)") {
      Some("healthy".to_string())
   } else if status.contains("(unhealthy)") {
      Some("unhealthy".to_string())
   } else if status.contains("(health: starting)") {
      Some("starting".to_string())
   } else {
      None
   }
}

impl From<DockerContainerRow> for DockerContainer {
   fn from(row: DockerContainerRow) -> Self {
      let health = parse_health(&row.status);
      Self {
         id: row.id,
         name: row.names,
         image: row.image,
         command: row.command,
         status: row.status,
         state: row.state,
         ports: row.ports,
         networks: row.networks,
         created_at: row.created_at,
         health,
      }
   }
}

impl From<DockerImageRow> for DockerImage {
   fn from(row: DockerImageRow) -> Self {
      Self {
         id: row.id,
         repository: row.repository,
         tag: row.tag,
         digest: row.digest,
         size: row.size,
         created_since: row.created_since,
      }
   }
}

impl From<DockerVolumeRow> for DockerVolume {
   fn from(row: DockerVolumeRow) -> Self {
      Self {
         name: row.name,
         driver: row.driver,
         scope: row.scope,
         mountpoint: row.mountpoint,
      }
   }
}

impl From<DockerNetworkRow> for DockerNetwork {
   fn from(row: DockerNetworkRow) -> Self {
      Self {
         id: row.id,
         name: row.name,
         driver: row.driver,
         scope: row.scope,
         internal: row.internal,
         ipv6: row.ipv6,
      }
   }
}

#[cfg(test)]
mod tests {
   use super::{DockerContainerRow, parse_health, parse_json_lines};

   #[test]
   fn parses_docker_json_lines() {
      let rows = parse_json_lines::<DockerContainerRow>(
         r#"{"ID":"abc123","Names":"web","Image":"nginx","Command":"\"nginx\"","Status":"Up 2 minutes (healthy)","State":"running","Ports":"0.0.0.0:8080->80/tcp","Networks":"bridge","CreatedAt":"2026-06-27 10:00:00 +0000 UTC"}"#,
      )
      .expect("valid docker json line");

      assert_eq!(rows.len(), 1);
      assert_eq!(rows[0].id, "abc123");
      assert_eq!(parse_health(&rows[0].status).as_deref(), Some("healthy"));
   }
}
