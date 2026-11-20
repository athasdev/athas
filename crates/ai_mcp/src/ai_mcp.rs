//! MCP servers the user configured (`mcpServers` in settings): which ones to offer, the list
//! handed to ACP agents in `session/new`, and a client the built-in agent calls tools with, over
//! stdio, HTTP or SSE.
//!
//! Ported from Athas's `crates/ai/src/acp/mcp_servers.rs`, `crates/ai/src/mcp_stdio.rs` and
//! `features/ai/intelligence/lib/intelligence-mcp-client.ts`. Secret values (environment
//! variables, headers) are never logged: their `Debug` output names them only.

mod client;
mod http;
mod servers;

pub use agent_client_protocol_schema::v1 as acp;
pub use client::{McpClient, McpTool, McpToolOutput, model_tool_name, parse_model_tool_name};
pub use servers::{
    Draft, DraftErrors, McpNameValue, McpServerConfig, McpServerSecrets, McpServerSetting, McpTransportKind, Skipped,
    acp_servers, configured_servers, secrets_key, validate_draft,
};
