//! "Add to Athas" links for MCP servers (`services/mcp-install-link.ts`):
//! `athas://mcp/install?name=<name>&config=<base64 JSON>`. The config has the shape of Cursor
//! install links and `mcp.json` entries: `{ command, args, env }` for a local server or
//! `{ url, headers, type }` for a remote one. Nothing is saved from a link: it opens the server
//! editor in Settings > AI filled in, for the user to review.

use ai_mcp::McpTransportKind;
use base64::Engine as _;
use gpui::{App, Global};
use serde_json::Value;

/// Longest `config` value accepted, so a link cannot hand the editor megabytes of JSON.
const MAX_CONFIG_LENGTH: usize = 16 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct McpInstall {
    pub name: String,
    pub transport: McpTransportKind,
    pub command: String,
    pub args: Vec<String>,
    pub url: String,
    /// Environment variables (stdio) or headers (HTTP, SSE), as `(name, value)`.
    pub secrets: Vec<(String, String)>,
}

/// Standard or URL-safe base64; a `+` read back as a space from an unescaped query is restored.
fn decode_base64_json(value: &str) -> Option<Value> {
    let normalized: String = value.chars().map(|c| match c {
        ' ' | '-' => '+',
        '_' => '/',
        other => other,
    }).collect();
    let trimmed = normalized.trim_end_matches('=');
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD.decode(trimmed).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn name_values(value: Option<&Value>) -> Vec<(String, String)> {
    value.and_then(Value::as_object).map_or_else(Vec::new, |map| map.iter().filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string()))).collect())
}

/// The server an install link describes; `None` when the link is malformed.
pub fn parse(link: &str) -> Option<McpInstall> {
    let query = link.split_once('?')?.1.split('#').next().unwrap_or_default();
    let param = |key: &str| {
        query.split('&').find_map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (name == key).then(|| crate::chat_link::decode(&value.replace('+', " ")))
        })
    };
    let name = param("name")?.trim().to_string();
    let encoded = param("config")?;
    if name.is_empty() || encoded.is_empty() || encoded.len() > MAX_CONFIG_LENGTH {
        return None;
    }
    let config = decode_base64_json(&encoded)?;
    let config = config.as_object()?;
    if let Some(command) = config.get("command").and_then(Value::as_str).map(str::trim).filter(|command| !command.is_empty()) {
        let args = config.get("args").and_then(Value::as_array).map_or_else(Vec::new, |args| args.iter().filter_map(|arg| arg.as_str().map(str::to_string)).collect());
        return Some(McpInstall { name, transport: McpTransportKind::Stdio, command: command.to_string(), args, url: String::new(), secrets: name_values(config.get("env")) });
    }
    let url = config.get("url").and_then(Value::as_str)?.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.split_once("://").is_none_or(|(_, rest)| rest.is_empty()) {
        return None;
    }
    let transport = if config.get("type").and_then(Value::as_str) == Some("sse") { McpTransportKind::Sse } else { McpTransportKind::Http };
    Some(McpInstall { name, transport, command: String::new(), args: Vec::new(), url: url.to_string(), secrets: name_values(config.get("headers")) })
}

/// The link waiting for Settings > AI to show it.
#[derive(Default)]
pub(crate) struct PendingMcpInstall(pub Option<McpInstall>);

impl Global for PendingMcpInstall {}

/// Opens Settings > AI with the server editor filled in from `link`, or says the link is broken.
pub fn open(link: &str, cx: &mut App) {
    match parse(link) {
        Some(install) => {
            cx.set_global(PendingMcpInstall(Some(install)));
            workbench_api::open_settings(cx, Some("ai"), Some("MCP servers"));
        }
        None => {
            notifications::error(cx, "This MCP install link is not valid", None);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(name: &str, config: &str) -> String {
        format!("athas://mcp/install?name={name}&config={}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(config))
    }

    #[test]
    fn reads_local_and_remote_servers() {
        let local = parse(&link("github", r#"{"command":" npx ","args":["-y","@modelcontextprotocol/server-github",3],"env":{"GITHUB_TOKEN":"x","N":1}}"#)).unwrap();
        assert_eq!((local.transport, local.command.as_str()), (McpTransportKind::Stdio, "npx"));
        assert_eq!(local.args, ["-y", "@modelcontextprotocol/server-github"]);
        assert_eq!(local.secrets, [("GITHUB_TOKEN".to_string(), "x".to_string())]);
        let remote = parse(&link("Linear%20MCP", r#"{"url":"https://mcp.linear.app/sse","type":"sse","headers":{"Authorization":"Bearer t"}}"#)).unwrap();
        assert_eq!((remote.name.as_str(), remote.transport, remote.url.as_str()), ("Linear MCP", McpTransportKind::Sse, "https://mcp.linear.app/sse"));
        assert_eq!(parse(&link("x", r#"{"url":"https://h/mcp"}"#)).unwrap().transport, McpTransportKind::Http);
        let standard = format!("athas://mcp/install?name=x&config={}", base64::engine::general_purpose::STANDARD.encode(r#"{"command":"a"}"#));
        assert_eq!(parse(&standard).unwrap().command, "a");
    }

    #[test]
    fn malformed_links_are_refused() {
        assert_eq!(parse(&link("", r#"{"command":"npx"}"#)), None);
        assert_eq!(parse(&link("x", r#"{"url":"ftp://h"}"#)), None);
        assert_eq!(parse(&link("x", r#"["npx"]"#)), None);
        assert_eq!(parse("athas://mcp/install?name=x&config=%%%"), None);
        assert_eq!(parse("athas://mcp/install?name=x"), None);
    }
}
