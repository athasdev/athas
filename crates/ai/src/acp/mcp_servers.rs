//! MCP servers the user configured in Athas, handed to ACP agents in `session/new`,
//! `session/load` and `session/resume`.
//!
//! The server list lives in the frontend settings without secrets; environment variables and
//! HTTP headers are kept in secure storage and joined in when an agent starts. Values are never
//! logged: the `Debug` impls here print names only.

use super::types::AcpMcpCapabilities;
use agent_client_protocol::schema::v1 as acp;
use serde::{Deserialize, Serialize};
use std::{
   fmt,
   path::{Path, PathBuf},
};

/// How the agent reaches an MCP server.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpTransportKind {
   Stdio,
   Http,
   Sse,
}

/// An MCP server as stored in the user's settings. Carries no secrets.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSetting {
   pub id: String,
   pub name: String,
   #[serde(default = "enabled_by_default")]
   pub enabled: bool,
   pub transport: McpTransportKind,
   /// Stdio only: the executable to run.
   #[serde(default)]
   pub command: String,
   /// Stdio only.
   #[serde(default)]
   pub args: Vec<String>,
   /// HTTP and SSE only.
   #[serde(default)]
   pub url: String,
}

fn enabled_by_default() -> bool {
   true
}

/// A named value whose value may be a secret, such as an API key.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpNameValue {
   pub name: String,
   pub value: String,
}

impl fmt::Debug for McpNameValue {
   fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
      f.debug_struct("McpNameValue")
         .field("name", &self.name)
         .field("value", &"<redacted>")
         .finish()
   }
}

/// The secret part of an MCP server: stdio environment variables and HTTP/SSE headers.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpServerSecrets {
   #[serde(default)]
   pub env: Vec<McpNameValue>,
   #[serde(default)]
   pub headers: Vec<McpNameValue>,
}

impl McpServerSecrets {
   pub fn is_empty(&self) -> bool {
      self.env.is_empty() && self.headers.is_empty()
   }
}

/// An enabled MCP server with its secrets joined in, ready to offer to agents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServerConfig {
   pub setting: McpServerSetting,
   pub secrets: McpServerSecrets,
}

impl McpServerConfig {
   /// Joins a stored server with its secrets. Returns `None` for a disabled server or one that
   /// is missing what its transport needs, so it is never sent.
   pub fn from_setting(setting: McpServerSetting, secrets: McpServerSecrets) -> Option<Self> {
      if !setting.enabled || setting.name.trim().is_empty() {
         return None;
      }
      let target = match setting.transport {
         McpTransportKind::Stdio => &setting.command,
         McpTransportKind::Http | McpTransportKind::Sse => &setting.url,
      };
      if target.trim().is_empty() {
         return None;
      }
      Some(Self { setting, secrets })
   }
}

/// An MCP server left out of a session because the agent cannot use its transport.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpSkippedMcpServer {
   pub name: String,
   pub transport: McpTransportKind,
}

/// The servers to send in session setup, and the ones the agent cannot take.
#[derive(Debug, Clone, Default, PartialEq)]
pub(super) struct McpServerSelection {
   pub servers: Vec<acp::McpServer>,
   pub skipped: Vec<AcpSkippedMcpServer>,
}

/// Builds the `mcpServers` list for an agent. Every agent takes stdio; HTTP and SSE servers are
/// sent only when the agent advertised them in `mcpCapabilities` and are reported as skipped
/// otherwise. A bare stdio command such as `npx` is resolved to an absolute path with
/// `resolve_command`, because ACP asks for one; it is sent as written when that fails.
pub(super) fn select_mcp_servers(
   configs: &[McpServerConfig],
   capabilities: &AcpMcpCapabilities,
   resolve_command: impl Fn(&str) -> Option<PathBuf>,
) -> McpServerSelection {
   let mut selection = McpServerSelection::default();

   for config in configs {
      let setting = &config.setting;
      let name = setting.name.trim().to_string();
      let supported = match setting.transport {
         McpTransportKind::Stdio => true,
         McpTransportKind::Http => capabilities.http,
         McpTransportKind::Sse => capabilities.sse,
      };
      if !supported {
         selection.skipped.push(AcpSkippedMcpServer {
            name,
            transport: setting.transport,
         });
         continue;
      }

      let server = match setting.transport {
         McpTransportKind::Stdio => {
            let command = setting.command.trim();
            let command = if Path::new(command).is_absolute() || command.contains(['/', '\\']) {
               PathBuf::from(command)
            } else {
               resolve_command(command).unwrap_or_else(|| PathBuf::from(command))
            };
            acp::McpServer::Stdio(
               acp::McpServerStdio::new(name, command)
                  .args(setting.args.clone())
                  .env(
                     named_values(&config.secrets.env)
                        .map(|(name, value)| acp::EnvVariable::new(name, value))
                        .collect(),
                  ),
            )
         }
         McpTransportKind::Http => acp::McpServer::Http(
            acp::McpServerHttp::new(name, setting.url.trim()).headers(headers(config)),
         ),
         McpTransportKind::Sse => acp::McpServer::Sse(
            acp::McpServerSse::new(name, setting.url.trim()).headers(headers(config)),
         ),
      };
      selection.servers.push(server);
   }

   selection
}

fn headers(config: &McpServerConfig) -> Vec<acp::HttpHeader> {
   named_values(&config.secrets.headers)
      .map(|(name, value)| acp::HttpHeader::new(name, value))
      .collect()
}

/// Entries with a name, trimmed. Values are sent as entered.
fn named_values(values: &[McpNameValue]) -> impl Iterator<Item = (&str, &str)> {
   values
      .iter()
      .map(|entry| (entry.name.trim(), entry.value.as_str()))
      .filter(|(name, _)| !name.is_empty())
}

#[cfg(test)]
mod tests {
   use super::*;
   use serde_json::json;

   fn setting(name: &str, transport: McpTransportKind) -> McpServerSetting {
      McpServerSetting {
         id: format!("{name}-id"),
         name: name.to_string(),
         enabled: true,
         transport,
         command: String::new(),
         args: Vec::new(),
         url: String::new(),
      }
   }

   fn stdio(name: &str, command: &str, args: &[&str]) -> McpServerSetting {
      McpServerSetting {
         command: command.to_string(),
         args: args.iter().map(ToString::to_string).collect(),
         ..setting(name, McpTransportKind::Stdio)
      }
   }

   fn remote(name: &str, transport: McpTransportKind, url: &str) -> McpServerSetting {
      McpServerSetting {
         url: url.to_string(),
         ..setting(name, transport)
      }
   }

   fn pair(name: &str, value: &str) -> McpNameValue {
      McpNameValue {
         name: name.to_string(),
         value: value.to_string(),
      }
   }

   fn config(setting: McpServerSetting, secrets: McpServerSecrets) -> McpServerConfig {
      McpServerConfig::from_setting(setting, secrets).expect("server should be usable")
   }

   fn no_resolve(_: &str) -> Option<PathBuf> {
      None
   }

   #[test]
   fn reads_settings_as_the_frontend_stores_them() {
      let setting: McpServerSetting = serde_json::from_value(json!({
         "id": "abc",
         "name": "linear",
         "transport": "http",
         "url": "https://mcp.linear.app/mcp"
      }))
      .unwrap();

      assert!(setting.enabled);
      assert_eq!(setting.transport, McpTransportKind::Http);
      assert!(setting.args.is_empty());
   }

   #[test]
   fn drops_disabled_and_incomplete_servers() {
      let mut disabled = stdio("fs", "npx", &[]);
      disabled.enabled = false;

      assert!(McpServerConfig::from_setting(disabled, McpServerSecrets::default()).is_none());
      assert!(
         McpServerConfig::from_setting(stdio("fs", "  ", &[]), McpServerSecrets::default())
            .is_none()
      );
      assert!(
         McpServerConfig::from_setting(
            remote("docs", McpTransportKind::Sse, ""),
            McpServerSecrets::default()
         )
         .is_none()
      );
      assert!(
         McpServerConfig::from_setting(stdio(" ", "npx", &[]), McpServerSecrets::default())
            .is_none()
      );
   }

   #[test]
   fn maps_stdio_servers_with_args_and_env() {
      let configs = [config(
         stdio("fs", "/usr/local/bin/mcp-fs", &["--root", "."]),
         McpServerSecrets {
            env: vec![pair(" TOKEN ", "secret"), pair("", "ignored")],
            headers: vec![pair("Authorization", "not for stdio")],
         },
      )];

      let selection = select_mcp_servers(&configs, &AcpMcpCapabilities::default(), no_resolve);

      assert!(selection.skipped.is_empty());
      assert_eq!(
         serde_json::to_value(&selection.servers).unwrap(),
         json!([{
            "name": "fs",
            "command": "/usr/local/bin/mcp-fs",
            "args": ["--root", "."],
            "env": [{ "name": "TOKEN", "value": "secret" }]
         }])
      );
   }

   #[test]
   fn resolves_bare_commands_to_absolute_paths() {
      let configs = [
         config(stdio("a", "npx", &[]), McpServerSecrets::default()),
         config(stdio("b", "missing", &[]), McpServerSecrets::default()),
         config(stdio("c", "./bin/server", &[]), McpServerSecrets::default()),
      ];

      let selection = select_mcp_servers(&configs, &AcpMcpCapabilities::default(), |command| {
         (command == "npx").then(|| PathBuf::from("/opt/node/bin/npx"))
      });

      let commands: Vec<_> = selection
         .servers
         .iter()
         .map(|server| match server {
            acp::McpServer::Stdio(stdio) => stdio.command.clone(),
            other => panic!("unexpected server {other:?}"),
         })
         .collect();
      assert_eq!(
         commands,
         [
            PathBuf::from("/opt/node/bin/npx"),
            PathBuf::from("missing"),
            PathBuf::from("./bin/server"),
         ]
      );
   }

   #[test]
   fn maps_http_and_sse_servers_with_headers() {
      let secrets = McpServerSecrets {
         env: vec![pair("IGNORED", "env is stdio only")],
         headers: vec![pair("Authorization", "Bearer abc")],
      };
      let configs = [
         config(
            remote(
               "linear",
               McpTransportKind::Http,
               " https://mcp.linear.app/mcp ",
            ),
            secrets.clone(),
         ),
         config(
            remote("events", McpTransportKind::Sse, "https://example.com/sse"),
            secrets,
         ),
      ];

      let selection = select_mcp_servers(
         &configs,
         &AcpMcpCapabilities {
            http: true,
            sse: true,
         },
         no_resolve,
      );

      assert!(selection.skipped.is_empty());
      assert_eq!(
         serde_json::to_value(&selection.servers).unwrap(),
         json!([
            {
               "type": "http",
               "name": "linear",
               "url": "https://mcp.linear.app/mcp",
               "headers": [{ "name": "Authorization", "value": "Bearer abc" }]
            },
            {
               "type": "sse",
               "name": "events",
               "url": "https://example.com/sse",
               "headers": [{ "name": "Authorization", "value": "Bearer abc" }]
            }
         ])
      );
   }

   #[test]
   fn skips_transports_the_agent_did_not_advertise() {
      let configs = [
         config(stdio("fs", "/bin/fs", &[]), McpServerSecrets::default()),
         config(
            remote("linear", McpTransportKind::Http, "https://a"),
            McpServerSecrets::default(),
         ),
         config(
            remote("events", McpTransportKind::Sse, "https://b"),
            McpServerSecrets::default(),
         ),
      ];

      let stdio_only = select_mcp_servers(&configs, &AcpMcpCapabilities::default(), no_resolve);
      assert_eq!(stdio_only.servers.len(), 1);
      assert_eq!(
         stdio_only.skipped,
         [
            AcpSkippedMcpServer {
               name: "linear".into(),
               transport: McpTransportKind::Http,
            },
            AcpSkippedMcpServer {
               name: "events".into(),
               transport: McpTransportKind::Sse,
            },
         ]
      );

      let http_only = select_mcp_servers(
         &configs,
         &AcpMcpCapabilities {
            http: true,
            sse: false,
         },
         no_resolve,
      );
      assert_eq!(http_only.servers.len(), 2);
      assert_eq!(
         http_only.skipped,
         [AcpSkippedMcpServer {
            name: "events".into(),
            transport: McpTransportKind::Sse,
         }]
      );
   }

   #[test]
   fn never_prints_secret_values() {
      let secrets = McpServerSecrets {
         env: vec![pair("TOKEN", "super-secret")],
         headers: vec![pair("Authorization", "Bearer hidden")],
      };

      let printed = format!("{secrets:?}");
      assert!(printed.contains("TOKEN"));
      assert!(!printed.contains("super-secret"));
      assert!(!printed.contains("hidden"));
   }
}
