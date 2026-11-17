//! The server list as settings store it, joined with its secrets, and the `mcpServers` an ACP
//! agent receives.

use std::{
    fmt,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::acp;

/// How a server is reached.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpTransportKind {
    Stdio,
    Http,
    Sse,
}

/// A server as the settings store it. It carries no secrets.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerSetting {
    pub id: String,
    pub name: String,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    pub transport: McpTransportKind,
    /// Stdio only: the program to run.
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

/// A named value that may be a secret, such as an API key.
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct McpNameValue {
    pub name: String,
    pub value: String,
}

impl fmt::Debug for McpNameValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("McpNameValue").field("name", &self.name).field("value", &"<redacted>").finish()
    }
}

/// The secret part of a server: stdio environment variables and HTTP/SSE headers, kept in the
/// keychain as JSON under [`secrets_key`].
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct McpServerSecrets {
    #[serde(default)]
    pub env: Vec<McpNameValue>,
    #[serde(default)]
    pub headers: Vec<McpNameValue>,
}

/// An enabled server with its secrets joined in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpServerConfig {
    pub setting: McpServerSetting,
    pub secrets: McpServerSecrets,
}

/// A server left out because the agent cannot use its transport.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skipped {
    pub name: String,
    pub transport: McpTransportKind,
}

/// The keychain account the secrets of server `server_id` live under, the one Athas uses.
pub fn secrets_key(server_id: &str) -> Option<String> {
    let valid = !server_id.is_empty()
        && server_id.len() <= 128
        && server_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    valid.then(|| format!("mcp_server_{server_id}"))
}

/// The servers to offer from the `mcpServers` setting: enabled ones with a name and what their
/// transport needs. `load_secrets(id)` returns the stored secrets JSON of a server, if any; a
/// server whose secrets cannot be read is still offered without them, so it reports what it
/// is missing.
pub fn configured_servers(values: &[Value], load_secrets: impl Fn(&str) -> Option<String>) -> Vec<McpServerConfig> {
    values
        .iter()
        .filter_map(|value| serde_json::from_value::<McpServerSetting>(value.clone()).ok())
        .filter(is_usable)
        .map(|setting| {
            let secrets = secrets_key(&setting.id)
                .and_then(|_| load_secrets(&setting.id))
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_default();
            McpServerConfig { setting, secrets }
        })
        .collect()
}

fn is_usable(setting: &McpServerSetting) -> bool {
    let target = match setting.transport {
        McpTransportKind::Stdio => &setting.command,
        McpTransportKind::Http | McpTransportKind::Sse => &setting.url,
    };
    setting.enabled && !setting.name.trim().is_empty() && !target.trim().is_empty()
}

/// The `mcpServers` of an ACP `session/new`. Every agent takes stdio; HTTP and SSE servers go
/// only to agents that advertised them and are returned as skipped otherwise. A bare command
/// such as `npx` is resolved with `resolve_command`, since ACP asks for a path, and sent as
/// written when that fails.
pub fn acp_servers(
    configs: &[McpServerConfig],
    http: bool,
    sse: bool,
    resolve_command: impl Fn(&str) -> Option<PathBuf>,
) -> (Vec<acp::McpServer>, Vec<Skipped>) {
    let mut servers = Vec::new();
    let mut skipped = Vec::new();
    for config in configs {
        let setting = &config.setting;
        let name = setting.name.trim().to_string();
        let server = match setting.transport {
            McpTransportKind::Stdio => {
                let env = named_values(&config.secrets.env).map(|(name, value)| acp::EnvVariable::new(name, value)).collect();
                acp::McpServer::Stdio(
                    acp::McpServerStdio::new(name, resolve(setting.command.trim(), &resolve_command))
                        .args(setting.args.clone())
                        .env(env),
                )
            }
            McpTransportKind::Http if http => acp::McpServer::Http(acp::McpServerHttp::new(name, setting.url.trim()).headers(headers(config))),
            McpTransportKind::Sse if sse => acp::McpServer::Sse(acp::McpServerSse::new(name, setting.url.trim()).headers(headers(config))),
            transport => {
                skipped.push(Skipped { name, transport });
                continue;
            }
        };
        servers.push(server);
    }
    (servers, skipped)
}

/// A command as a path: absolute or relative paths stay, bare names are looked up.
pub(crate) fn resolve(command: &str, resolve_command: impl Fn(&str) -> Option<PathBuf>) -> PathBuf {
    if Path::new(command).is_absolute() || command.contains(['/', '\\']) {
        return PathBuf::from(command);
    }
    resolve_command(command).unwrap_or_else(|| PathBuf::from(command))
}

fn headers(config: &McpServerConfig) -> Vec<acp::HttpHeader> {
    named_values(&config.secrets.headers).map(|(name, value)| acp::HttpHeader::new(name, value)).collect()
}

/// Entries with a name, trimmed; values go as entered.
pub(crate) fn named_values(values: &[McpNameValue]) -> impl Iterator<Item = (&str, &str)> {
    values.iter().map(|entry| (entry.name.trim(), entry.value.as_str())).filter(|(name, _)| !name.is_empty())
}

/// What is wrong with a server draft, field by field (`McpServerDraftErrors`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DraftErrors {
    pub name: Option<String>,
    pub command: Option<String>,
    pub url: Option<String>,
    /// The environment variables (stdio) or headers (HTTP, SSE).
    pub values: Option<String>,
}

impl DraftErrors {
    pub fn any(&self) -> bool {
        self.name.is_some() || self.command.is_some() || self.url.is_some() || self.values.is_some()
    }
}

/// A server being added or changed, as the dialog holds it.
pub struct Draft<'a> {
    /// The server being changed; `None` for a new one.
    pub id: Option<&'a str>,
    pub name: &'a str,
    pub transport: McpTransportKind,
    pub command: &'a str,
    pub url: &'a str,
    pub values: &'a [McpNameValue],
}

fn is_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_') && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
}

fn is_header_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|ch| ch.is_ascii_alphanumeric() || "!#$%&'*+.^_`|~-".contains(ch))
}

fn validate_name_values(values: &[McpNameValue], header: bool) -> Option<String> {
    let noun = if header { "header" } else { "variable" };
    let mut seen = std::collections::HashSet::new();
    for entry in values.iter().filter(|entry| !entry.name.trim().is_empty() || !entry.value.is_empty()) {
        let name = entry.name.trim();
        if name.is_empty() {
            return Some(format!("Every {noun} with a value needs a name"));
        }
        if !(if header { is_header_name(name) } else { is_env_name(name) }) {
            return Some(format!("\"{name}\" is not a valid {noun} name"));
        }
        if !seen.insert(if header { name.to_ascii_lowercase() } else { name.to_string() }) {
            return Some(format!("{name} is set more than once"));
        }
    }
    None
}

fn is_http_url(url: &str) -> bool {
    ["http://", "https://"].iter().any(|scheme| url.get(..scheme.len()).is_some_and(|prefix| prefix.eq_ignore_ascii_case(scheme)) && url.len() > scheme.len() && !url[scheme.len()..].starts_with(['/', '?', '#']))
        && !url.contains(char::is_whitespace)
}

/// Checks a draft before it is saved (`validateMcpServerDraft`). Names must be unique because
/// agents identify servers by name; only the fields the chosen transport uses are checked.
pub fn validate_draft(draft: &Draft, servers: &[McpServerSetting]) -> DraftErrors {
    let mut errors = DraftErrors::default();
    let name = draft.name.trim();
    if name.is_empty() {
        errors.name = Some("Enter a name".into());
    } else if servers.iter().any(|server| Some(server.id.as_str()) != draft.id && server.name.to_lowercase() == name.to_lowercase()) {
        errors.name = Some("Another server already uses this name".into());
    }
    if draft.transport == McpTransportKind::Stdio {
        if draft.command.trim().is_empty() {
            errors.command = Some("Enter the command that starts the server".into());
        }
        errors.values = validate_name_values(draft.values, false);
    } else {
        let url = draft.url.trim();
        if url.is_empty() {
            errors.url = Some("Enter the server URL".into());
        } else if !is_http_url(url) {
            errors.url = Some("Use an http:// or https:// URL".into());
        }
        errors.values = validate_name_values(draft.values, true);
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn drafts_are_checked_field_by_field() {
        let value = |name: &str, value: &str| McpNameValue { name: name.into(), value: value.into() };
        let existing = vec![McpServerSetting { id: "a".into(), name: "Linear".into(), enabled: true, transport: McpTransportKind::Stdio, command: "npx".into(), args: Vec::new(), url: String::new() }];
        let stdio = Draft { id: None, name: "linear", transport: McpTransportKind::Stdio, command: " ", url: "", values: &[value("1BAD", "x")] };
        let errors = validate_draft(&stdio, &existing);
        assert_eq!(errors.name.as_deref(), Some("Another server already uses this name"));
        assert_eq!(errors.command.as_deref(), Some("Enter the command that starts the server"));
        assert_eq!(errors.values.as_deref(), Some("\"1BAD\" is not a valid variable name"));
        assert!(!validate_draft(&Draft { id: Some("a"), command: "npx", values: &[], ..stdio }, &existing).any());
        let headers = [value("Authorization", "a"), value("authorization", "b")];
        let http = Draft { id: None, name: "Remote", transport: McpTransportKind::Http, command: "", url: "ftp://x", values: &headers };
        let errors = validate_draft(&http, &existing);
        assert_eq!(errors.url.as_deref(), Some("Use an http:// or https:// URL"));
        assert_eq!(errors.values.as_deref(), Some("authorization is set more than once"));
        assert_eq!(validate_draft(&Draft { url: "", values: &[value("", "v")], ..http }, &existing).values.as_deref(), Some("Every header with a value needs a name"));
        assert!(!validate_draft(&Draft { url: "https://mcp.example.com/mcp", values: &[], ..http }, &existing).any());
    }

    fn config(name: &str, transport: McpTransportKind) -> McpServerConfig {
        McpServerConfig {
            setting: McpServerSetting {
                id: format!("{name}-id"),
                name: name.into(),
                enabled: true,
                transport,
                command: "npx".into(),
                args: vec!["-y".into(), "server".into()],
                url: "https://mcp.example.com".into(),
            },
            secrets: McpServerSecrets {
                env: vec![McpNameValue { name: " API_KEY ".into(), value: "secret".into() }, McpNameValue { name: " ".into(), value: "x".into() }],
                headers: vec![McpNameValue { name: "Authorization".into(), value: "Bearer t".into() }],
            },
        }
    }

    #[test]
    fn settings_parse_and_only_usable_servers_are_offered() {
        let values = vec![
            json!({ "id": "fs", "name": "Files", "transport": "stdio", "command": "npx", "args": ["-y", "fs"] }),
            json!({ "id": "off", "name": "Off", "enabled": false, "transport": "stdio", "command": "x" }),
            json!({ "id": "noname", "name": " ", "transport": "stdio", "command": "x" }),
            json!({ "id": "nourl", "name": "Web", "transport": "http" }),
            json!({ "id": "web", "name": "Web", "transport": "sse", "url": "https://x" }),
            json!({ "id": "bad", "transport": "carrier-pigeon" }),
        ];
        let servers = configured_servers(&values, |id| {
            (id == "fs").then(|| json!({ "env": [{ "name": "TOKEN", "value": "abc" }] }).to_string())
        });
        assert_eq!(servers.iter().map(|server| server.setting.id.as_str()).collect::<Vec<_>>(), ["fs", "web"]);
        assert_eq!(servers[0].setting.args, ["-y", "fs"]);
        assert_eq!(servers[0].secrets.env[0].value, "abc");
        assert_eq!(servers[1].secrets, McpServerSecrets::default());
    }

    #[test]
    fn secrets_keys_and_redaction() {
        assert_eq!(secrets_key("github_1-a").as_deref(), Some("mcp_server_github_1-a"));
        assert_eq!(secrets_key("../etc"), None);
        assert_eq!(secrets_key(""), None);
        let secrets: McpServerSecrets = serde_json::from_str(r#"{"headers":[{"name":"X","value":"hidden"}]}"#).unwrap();
        assert!(secrets.env.is_empty());
        assert!(!format!("{secrets:?}").contains("hidden"));
    }

    #[test]
    fn agents_get_the_transports_they_support() {
        let configs = [config("Files", McpTransportKind::Stdio), config("Web", McpTransportKind::Http), config("Stream", McpTransportKind::Sse)];
        let resolve = |command: &str| (command == "npx").then(|| PathBuf::from("/opt/homebrew/bin/npx"));
        let (servers, skipped) = acp_servers(&configs, false, false, resolve);
        assert_eq!(servers.len(), 1);
        let acp::McpServer::Stdio(stdio) = &servers[0] else { panic!("expected stdio") };
        assert_eq!(stdio.command, PathBuf::from("/opt/homebrew/bin/npx"));
        assert_eq!(stdio.env.len(), 1);
        assert_eq!(stdio.env[0].name, "API_KEY");
        assert_eq!(
            skipped,
            [Skipped { name: "Web".into(), transport: McpTransportKind::Http }, Skipped { name: "Stream".into(), transport: McpTransportKind::Sse }]
        );

        let (servers, skipped) = acp_servers(&configs, true, true, |_| None);
        assert!(skipped.is_empty());
        let acp::McpServer::Stdio(stdio) = &servers[0] else { panic!("expected stdio") };
        assert_eq!(stdio.command, PathBuf::from("npx"));
        assert!(matches!(&servers[1], acp::McpServer::Http(http) if http.headers.len() == 1 && http.url == "https://mcp.example.com"));
        assert!(matches!(&servers[2], acp::McpServer::Sse(_)));
    }

    #[test]
    fn paths_are_not_looked_up() {
        assert_eq!(resolve("./bin/server", |_| Some("/elsewhere".into())), PathBuf::from("./bin/server"));
        assert_eq!(resolve("/usr/bin/env", |_| None), PathBuf::from("/usr/bin/env"));
    }
}
