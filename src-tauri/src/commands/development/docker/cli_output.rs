use super::{
   DockerComposeService, DockerContainer, DockerContainerHealthDetails, DockerContainerStats,
   DockerImage, DockerNetwork, DockerRegistrySearchResult, DockerVolume, parse_health,
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerContainerRow {
   #[serde(rename = "ID")]
   pub(super) id: String,
   pub(super) names: String,
   pub(super) image: String,
   pub(super) command: String,
   pub(super) status: String,
   pub(super) state: String,
   pub(super) ports: String,
   pub(super) networks: String,
   #[serde(default)]
   pub(super) created_at: String,
   #[serde(default)]
   pub(super) size: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerStatsRow {
   #[serde(default, rename = "ID")]
   pub(super) id: String,
   #[serde(default)]
   pub(super) name: String,
   #[serde(default, rename = "CPUPerc")]
   pub(super) cpu_percent: String,
   #[serde(default)]
   pub(super) mem_usage: String,
   #[serde(default, rename = "MemPerc")]
   pub(super) memory_percent: String,
   #[serde(default, rename = "NetIO")]
   pub(super) network_io: String,
   #[serde(default, rename = "BlockIO")]
   pub(super) block_io: String,
   #[serde(default, rename = "PIDs")]
   pub(super) pids: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerInspectContainerRow {
   #[serde(default, rename = "Id")]
   pub(super) id: String,
   #[serde(default)]
   pub(super) name: String,
   #[serde(default)]
   pub(super) state: DockerInspectContainerState,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerInspectContainerState {
   pub(super) health: Option<DockerInspectContainerHealth>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerInspectContainerHealth {
   #[serde(default)]
   pub(super) status: String,
   #[serde(default)]
   pub(super) failing_streak: i64,
   #[serde(default)]
   pub(super) log: Vec<DockerInspectContainerHealthLog>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerInspectContainerHealthLog {
   #[serde(default)]
   pub(super) start: String,
   #[serde(default)]
   pub(super) end: String,
   #[serde(default)]
   pub(super) exit_code: i64,
   #[serde(default)]
   pub(super) output: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerImageRow {
   #[serde(rename = "ID")]
   pub(super) id: String,
   pub(super) repository: String,
   pub(super) tag: String,
   pub(super) digest: String,
   pub(super) size: String,
   #[serde(default)]
   pub(super) created_since: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerRegistrySearchRow {
   pub(super) name: String,
   #[serde(default)]
   pub(super) description: String,
   #[serde(default)]
   pub(super) star_count: String,
   #[serde(default)]
   pub(super) official: String,
   #[serde(default)]
   pub(super) automated: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerVolumeRow {
   pub(super) name: String,
   pub(super) driver: String,
   pub(super) scope: String,
   #[serde(default)]
   pub(super) mountpoint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerNetworkRow {
   #[serde(rename = "ID")]
   pub(super) id: String,
   pub(super) name: String,
   pub(super) driver: String,
   pub(super) scope: String,
   #[serde(default)]
   pub(super) internal: String,
   #[serde(default, rename = "IPv6")]
   pub(super) ipv6: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerComposeServiceRow {
   #[serde(default, rename = "ID")]
   pub(super) id: String,
   #[serde(default)]
   pub(super) name: String,
   #[serde(default)]
   pub(super) service: String,
   #[serde(default)]
   pub(super) state: String,
   #[serde(default)]
   pub(super) health: String,
   #[serde(default)]
   pub(super) status: String,
   #[serde(default)]
   pub(super) publishers: Vec<DockerComposePublisherRow>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct DockerComposePublisherRow {
   #[serde(default, rename = "URL")]
   pub(super) url: String,
   #[serde(default)]
   pub(super) target_port: u16,
   #[serde(default)]
   pub(super) published_port: u16,
   #[serde(default)]
   pub(super) protocol: String,
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
