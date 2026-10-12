//! IPC shapes of remote sessions: the connection status event and where a remote terminal
//! starts.

use serde::{Deserialize, Serialize};

/// The event the frontend listens on for SSH connections opening and closing.
pub const SSH_CONNECTION_STATUS_EVENT: &str = "ssh_connection_status";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionStatus {
   pub connection_id: String,
   pub connected: bool,
}

impl SshConnectionStatus {
   pub fn connected(connection_id: impl Into<String>) -> Self {
      Self {
         connection_id: connection_id.into(),
         connected: true,
      }
   }

   pub fn disconnected(connection_id: impl Into<String>) -> Self {
      Self {
         connection_id: connection_id.into(),
         connected: false,
      }
   }
}

/// Where a remote terminal connects and starts.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTerminalTarget {
   pub host: String,
   pub port: u16,
   pub username: String,
   pub password: Option<String>,
   pub key_path: Option<String>,
   pub working_directory: Option<String>,
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn serializes_the_status_event_the_frontend_expects() {
      assert_eq!(
         serde_json::to_value(SshConnectionStatus::connected("conn-1")).unwrap(),
         serde_json::json!({ "connectionId": "conn-1", "connected": true })
      );
      assert_eq!(
         serde_json::to_value(SshConnectionStatus::disconnected("conn-1")).unwrap(),
         serde_json::json!({ "connectionId": "conn-1", "connected": false })
      );
   }

   #[test]
   fn reads_terminal_targets_with_optional_credentials() {
      let target: RemoteTerminalTarget = serde_json::from_value(serde_json::json!({
         "host": "example.com",
         "port": 22,
         "username": "me",
         "keyPath": "~/.ssh/id_ed25519",
         "workingDirectory": "/srv/app"
      }))
      .unwrap();

      assert_eq!(target.host, "example.com");
      assert_eq!(target.password, None);
      assert_eq!(target.key_path.as_deref(), Some("~/.ssh/id_ed25519"));
      assert_eq!(target.working_directory.as_deref(), Some("/srv/app"));
   }
}
