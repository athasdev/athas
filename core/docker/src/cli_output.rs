use crate::{
   DockerComposeService, DockerContainer, DockerContainerHealthDetails, DockerContainerStats,
   DockerImage, DockerNetwork, DockerRegistrySearchResult, DockerVolume,
};
use serde::Deserialize;

/// Parses CLI output printed with `--format '{{json .}}'`: one JSON object per line.
pub(crate) fn parse_json_lines<T>(output: &str) -> Result<Vec<T>, String>
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

/// Health state embedded in a `docker ps` status such as `Up 2 minutes (healthy)`.
pub(crate) fn parse_health(status: &str) -> Option<String> {
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerContainerRow {
   #[serde(rename = "ID")]
   pub(crate) id: String,
   pub(crate) names: String,
   pub(crate) image: String,
   pub(crate) command: String,
   pub(crate) status: String,
   pub(crate) state: String,
   pub(crate) ports: String,
   pub(crate) networks: String,
   #[serde(default)]
   pub(crate) created_at: String,
   #[serde(default)]
   pub(crate) size: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerStatsRow {
   #[serde(default, rename = "ID")]
   pub(crate) id: String,
   #[serde(default)]
   pub(crate) name: String,
   #[serde(default, rename = "CPUPerc")]
   pub(crate) cpu_percent: String,
   #[serde(default)]
   pub(crate) mem_usage: String,
   #[serde(default, rename = "MemPerc")]
   pub(crate) memory_percent: String,
   #[serde(default, rename = "NetIO")]
   pub(crate) network_io: String,
   #[serde(default, rename = "BlockIO")]
   pub(crate) block_io: String,
   #[serde(default, rename = "PIDs")]
   pub(crate) pids: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerInspectContainerRow {
   #[serde(default, rename = "Id")]
   pub(crate) id: String,
   #[serde(default)]
   pub(crate) name: String,
   #[serde(default)]
   pub(crate) state: DockerInspectContainerState,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerInspectContainerState {
   pub(crate) health: Option<DockerInspectContainerHealth>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerInspectContainerHealth {
   #[serde(default)]
   pub(crate) status: String,
   #[serde(default)]
   pub(crate) failing_streak: i64,
   #[serde(default)]
   pub(crate) log: Vec<DockerInspectContainerHealthLog>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerInspectContainerHealthLog {
   #[serde(default)]
   pub(crate) start: String,
   #[serde(default)]
   pub(crate) end: String,
   #[serde(default)]
   pub(crate) exit_code: i64,
   #[serde(default)]
   pub(crate) output: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerImageRow {
   #[serde(rename = "ID")]
   pub(crate) id: String,
   pub(crate) repository: String,
   pub(crate) tag: String,
   pub(crate) digest: String,
   pub(crate) size: String,
   #[serde(default)]
   pub(crate) created_since: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerRegistrySearchRow {
   pub(crate) name: String,
   #[serde(default)]
   pub(crate) description: String,
   #[serde(default)]
   pub(crate) star_count: String,
   #[serde(default)]
   pub(crate) official: String,
   #[serde(default)]
   pub(crate) automated: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerVolumeRow {
   pub(crate) name: String,
   pub(crate) driver: String,
   pub(crate) scope: String,
   #[serde(default)]
   pub(crate) mountpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerNetworkRow {
   #[serde(rename = "ID")]
   pub(crate) id: String,
   pub(crate) name: String,
   pub(crate) driver: String,
   pub(crate) scope: String,
   #[serde(default)]
   pub(crate) internal: String,
   #[serde(default, rename = "IPv6")]
   pub(crate) ipv6: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerComposeServiceRow {
   #[serde(default, rename = "ID")]
   pub(crate) id: String,
   #[serde(default)]
   pub(crate) name: String,
   #[serde(default)]
   pub(crate) service: String,
   #[serde(default)]
   pub(crate) state: String,
   #[serde(default)]
   pub(crate) health: String,
   #[serde(default)]
   pub(crate) status: String,
   #[serde(default)]
   pub(crate) publishers: Vec<DockerComposePublisherRow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerComposePublisherRow {
   #[serde(default, rename = "URL")]
   pub(crate) url: String,
   #[serde(default)]
   pub(crate) target_port: u16,
   #[serde(default)]
   pub(crate) published_port: u16,
   #[serde(default)]
   pub(crate) protocol: String,
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
         size: row.size,
         health,
         health_details: None,
         stats: None,
      }
   }
}

impl From<DockerInspectContainerHealth> for DockerContainerHealthDetails {
   fn from(health: DockerInspectContainerHealth) -> Self {
      let last_log = health.log.last();
      Self {
         status: health.status,
         failing_streak: health.failing_streak,
         last_output: last_log
            .map(|log| log.output.trim().to_string())
            .filter(|output| !output.is_empty()),
         last_exit_code: last_log.map(|log| log.exit_code),
         last_started_at: last_log
            .map(|log| log.start.clone())
            .filter(|value| !value.trim().is_empty()),
         last_finished_at: last_log
            .map(|log| log.end.clone())
            .filter(|value| !value.trim().is_empty()),
      }
   }
}

impl From<DockerStatsRow> for DockerContainerStats {
   fn from(row: DockerStatsRow) -> Self {
      Self {
         cpu_percent: row.cpu_percent,
         memory_usage: row.mem_usage,
         memory_percent: row.memory_percent,
         network_io: row.network_io,
         block_io: row.block_io,
         pids: row.pids,
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

impl From<DockerRegistrySearchRow> for DockerRegistrySearchResult {
   fn from(row: DockerRegistrySearchRow) -> Self {
      Self {
         name: row.name,
         description: row.description,
         star_count: row.star_count,
         official: row.official,
         automated: row.automated,
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

impl From<DockerComposeServiceRow> for DockerComposeService {
   fn from(row: DockerComposeServiceRow) -> Self {
      let ports = row
         .publishers
         .iter()
         .filter_map(|publisher| {
            if publisher.published_port == 0 || publisher.target_port == 0 {
               return None;
            }
            let host = if publisher.url.trim().is_empty() {
               "0.0.0.0"
            } else {
               publisher.url.trim()
            };
            Some(
               format!(
                  "{}:{}->{}{}",
                  host,
                  publisher.published_port,
                  publisher.target_port,
                  if publisher.protocol.trim().is_empty() {
                     ""
                  } else {
                     "/"
                  }
               ) + publisher.protocol.trim(),
            )
         })
         .collect::<Vec<_>>()
         .join(", ");
      let health = if row.health.trim().is_empty() {
         parse_health(&row.status)
      } else {
         Some(row.health)
      };
      let state = if row.state.trim().is_empty() {
         "unknown".to_string()
      } else {
         row.state
      };
      let status = if row.status.trim().is_empty() {
         state.clone()
      } else {
         row.status
      };

      Self {
         name: row.service,
         state,
         status,
         health,
         container_id: if row.id.trim().is_empty() {
            None
         } else {
            Some(row.id)
         },
         container_name: if row.name.trim().is_empty() {
            None
         } else {
            Some(row.name)
         },
         ports,
      }
   }
}
