//! The workspace protocol the web workbench speaks to a server (`www/cloud/src/workspace-protocol.ts`
//! and `athas/src/features/web-workbench/services/workspace-protocol.ts`): the messages on the
//! workspace socket, the binary frames terminal output travels in, and the parsers that turn git
//! output into JSON. Everything here is pure, so the server, the wasm client and their tests share
//! it.
//!
//! Calls are `{ type: "call", id, method, params }` and answer with `{ type: "result", id, ok,
//! value | error }`. Paths in params are relative to the workspace root, never start with `/` and
//! never contain `..`; `""` is the root itself. The server also answers `POST /call` with the same
//! `{ method, params }` body, which is how the browser makes the blocking calls the workbench's
//! file system and git interfaces expect.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub mod git;
pub mod github;

/// The socket closes with these codes. Clients reconnect after 4001 with a fresh token.
pub const SOCKET_UNAUTHORIZED: u16 = 4001;
pub const SOCKET_STOPPED: u16 = 4003;
pub const SOCKET_NOT_READY: u16 = 4004;
pub const MAX_SOCKET_MESSAGE_BYTES: usize = 12 * 1024 * 1024;
/// Files larger than this are not sent to the editor.
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_LISTED_FILES: usize = 100_000;
pub const MAX_SEARCH_MATCHES: usize = 5000;
pub const MAX_TERMINALS: usize = 8;
pub const MAX_LANGUAGE_SERVERS: usize = 16;
pub const MAX_AGENTS: usize = 8;
/// Output kept per terminal so a reconnecting editor can redraw it.
pub const TERMINAL_BACKLOG_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    Auth { token: String },
    Renew { token: String },
    Call {
        id: u64,
        method: String,
        #[serde(default)]
        params: Map<String, Value>,
    },
    Ping,
}

impl ClientMessage {
    pub fn parse(text: &str) -> Option<Self> {
        if text.len() > MAX_SOCKET_MESSAGE_BYTES {
            return None;
        }
        serde_json::from_str(text).ok()
    }
}

/// The body of `POST /call`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CallRequest {
    pub method: String,
    #[serde(default)]
    pub params: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallError {
    pub code: String,
    pub message: String,
}

impl CallError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message)
    }
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CallError {}

/// A call's outcome, as `result` messages and `POST /call` answers carry it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CallOutcome {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<CallError>,
}

impl CallOutcome {
    pub fn from_result(result: Result<Value, CallError>) -> Self {
        match result {
            Ok(value) => Self { ok: true, value: Some(value), error: None },
            Err(error) => Self { ok: false, value: None, error: Some(error) },
        }
    }

    pub fn into_result(self) -> Result<Value, CallError> {
        if self.ok {
            Ok(self.value.unwrap_or(Value::Null))
        } else {
            Err(self.error.unwrap_or_else(|| CallError::new("error", "The workspace call failed.")))
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub id: String,
    pub repo: String,
    pub branch: String,
    /// The repository's directory on the server; the workbench opens it under the same path.
    pub root: String,
    pub terminals: Vec<String>,
    /// When the workspace stops, in milliseconds since the epoch; 0 when it does not.
    pub stops_at: u64,
}

/// What `POST /api/cloud-workspaces/:id/token` on athas.dev returns for a running cloud
/// workspace: the Worker's address and a ten-minute token.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    pub workspace_id: String,
    /// The Worker's https URL; the socket is `wss://…/workspaces/:id/socket` and calls go to
    /// `…/workspaces/:id/call`.
    pub endpoint: String,
    pub token: String,
    pub expires_at: String,
    pub repo: String,
    pub branch: String,
}

impl WorkspaceSession {
    /// Reads a session the website sent, refusing one that is malformed or whose endpoint is
    /// neither https nor plain http on this machine (`isWorkspaceSession`).
    pub fn parse(value: &Value) -> Option<Self> {
        let session: Self = serde_json::from_value(value.clone()).ok()?;
        let id_ok = session.workspace_id.len() == 36 && session.workspace_id.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte == b'-');
        (id_ok && !session.token.is_empty() && endpoint_allowed(&session.endpoint)).then_some(session)
    }

    /// Where this workspace's calls and socket live on the Worker.
    pub fn base_url(&self) -> String {
        format!("{}/workspaces/{}", self.endpoint.trim_end_matches('/'), self.workspace_id)
    }

    /// When the token stops working, in milliseconds since the epoch; `None` when the website's
    /// date can't be read.
    pub fn expires_at_ms(&self) -> Option<i64> {
        parse_iso_time_ms(&self.expires_at)
    }
}

fn endpoint_allowed(endpoint: &str) -> bool {
    let Some((scheme, rest)) = endpoint.split_once("://") else { return false };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let authority = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let host = if authority.starts_with('[') {
        authority.find(']').map(|end| &authority[..=end]).unwrap_or_default()
    } else {
        authority.split(':').next().unwrap_or_default()
    };
    if host.is_empty() {
        return false;
    }
    let local = matches!(host.to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "[::1]");
    scheme.eq_ignore_ascii_case("https") || (scheme.eq_ignore_ascii_case("http") && local)
}

/// An ISO 8601 time as JavaScript's `toISOString` writes it (`2026-11-13T15:49:00.000Z`, or with a
/// `±HH:MM` offset), in milliseconds since the epoch.
pub fn parse_iso_time_ms(text: &str) -> Option<i64> {
    let text = text.trim();
    let (date, time) = text.split_once(['T', 't', ' '])?;
    let mut date_parts = date.splitn(3, '-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;
    let (clock, offset_minutes) = if let Some(clock) = time.strip_suffix(['Z', 'z']) {
        (clock, 0)
    } else if let Some(index) = time.rfind(['+', '-']) {
        let (clock, offset) = time.split_at(index);
        let sign = if offset.starts_with('-') { -1 } else { 1 };
        let (hours, minutes) = offset[1..].split_once(':').unwrap_or((&offset[1..], "0"));
        (clock, sign * (hours.parse::<i64>().ok()? * 60 + minutes.parse::<i64>().ok()?))
    } else {
        (time, 0)
    };
    let mut clock_parts = clock.splitn(3, ':');
    let hour: i64 = clock_parts.next()?.parse().ok()?;
    let minute: i64 = clock_parts.next()?.parse().ok()?;
    let seconds_text = clock_parts.next().unwrap_or("0");
    let (seconds, fraction) = seconds_text.split_once('.').unwrap_or((seconds_text, ""));
    let second: i64 = seconds.parse().ok()?;
    let millis: i64 = if fraction.is_empty() { 0 } else { format!("{:0<3}", &fraction[..fraction.len().min(3)]).parse().ok()? };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    // Days since the epoch (Howard Hinnant's days_from_civil).
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some(((days * 24 + hour) * 60 + minute - offset_minutes) * 60_000 + second * 1000 + millis)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Created,
    Modified,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
    pub is_dir: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    Ready { workspace: WorkspaceInfo },
    Renewed,
    Result {
        id: u64,
        #[serde(flatten)]
        outcome: CallOutcome,
    },
    #[serde(rename = "fs.changes", rename_all = "camelCase")]
    FsChanges { changes: Vec<FileChange>, git_changed: bool, rescan: bool },
    #[serde(rename = "terminal.exit", rename_all = "camelCase")]
    TerminalExit { id: String, exit_code: Option<i32> },
    /// One JSON-RPC message a language server (`lsp.start`) wrote, without its framing.
    #[serde(rename = "lsp.message")]
    LspMessage { id: String, message: String },
    /// The language server stopped; `error` says why when it was not asked to.
    #[serde(rename = "lsp.exit")]
    LspExit {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// One ACP message an agent (`agent.start`) wrote, without its newline.
    #[serde(rename = "agent.message")]
    AgentMessage { id: String, message: String },
    /// The agent stopped; `error` says why when it was not asked to.
    #[serde(rename = "agent.exit")]
    AgentExit {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Stopped {
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Pong,
}

impl ServerMessage {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// Terminal output travels as binary frames: kind byte 1, the id's length, the id, then the bytes.
const TERMINAL_OUTPUT: u8 = 1;

pub fn encode_terminal_frame(id: &str, data: &[u8]) -> Vec<u8> {
    let id = &id.as_bytes()[..id.len().min(255)];
    let mut frame = Vec::with_capacity(2 + id.len() + data.len());
    frame.push(TERMINAL_OUTPUT);
    frame.push(id.len() as u8);
    frame.extend_from_slice(id);
    frame.extend_from_slice(data);
    frame
}

pub fn decode_terminal_frame(frame: &[u8]) -> Option<(String, &[u8])> {
    if frame.len() < 2 || frame[0] != TERMINAL_OUTPUT {
        return None;
    }
    let length = frame[1] as usize;
    let id = frame.get(2..2 + length)?;
    Some((String::from_utf8_lossy(id).into_owned(), &frame[2 + length..]))
}

pub fn to_base64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn from_base64(value: &Value) -> Result<Vec<u8>, CallError> {
    let text = value.as_str().ok_or_else(|| CallError::invalid("Expected base64 content."))?;
    base64::engine::general_purpose::STANDARD.decode(text).map_err(|_| CallError::invalid("Expected base64 content."))
}

/// Resolves an API path against the workspace root. API paths never start with `/` and never
/// contain `..`; `""` is the root itself.
pub fn resolve_path(root: &Path, path: &str) -> Result<PathBuf, CallError> {
    if path.len() > 4096 || path.contains('\0') {
        return Err(CallError::invalid("Invalid path."));
    }
    let mut relative = path;
    while let Some(rest) = relative.strip_prefix("./") {
        relative = rest.trim_start_matches('/');
    }
    let relative = relative.trim_end_matches('/');
    if relative.starts_with('/') || relative.split('/').any(|part| part == "..") {
        return Err(CallError::invalid("Paths must stay inside the workspace."));
    }
    Ok(if relative.is_empty() || relative == "." { root.to_path_buf() } else { root.join(relative) })
}

/// The API path of an absolute path inside the workspace, `None` outside it.
pub fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let text = relative.to_str()?.replace('\\', "/");
    Some(text)
}

#[cfg(test)]
mod tests {
    #[test]
    fn workspace_sessions_are_checked_before_use() {
        use super::{WorkspaceSession, parse_iso_time_ms};
        let session = |endpoint: &str, id: &str, token: &str| {
            serde_json::json!({ "workspaceId": id, "endpoint": endpoint, "token": token, "expiresAt": "2026-11-13T15:49:00.000Z", "repo": "a/b", "branch": "main" })
        };
        let id = "0f8fad5b-d9cb-469f-a165-70867728950e";
        let parsed = WorkspaceSession::parse(&session("https://cloud.athas.dev/", id, "t")).unwrap();
        assert_eq!(parsed.base_url(), format!("https://cloud.athas.dev/workspaces/{id}"));
        assert_eq!(parsed.expires_at_ms(), Some(1_794_584_940_000));
        assert!(WorkspaceSession::parse(&session("http://localhost:8787", id, "t")).is_some());
        assert!(WorkspaceSession::parse(&session("http://[::1]:8787", id, "t")).is_some());
        assert!(WorkspaceSession::parse(&session("http://evil.example", id, "t")).is_none());
        assert!(WorkspaceSession::parse(&session("ftp://cloud.athas.dev", id, "t")).is_none());
        assert!(WorkspaceSession::parse(&session("https://cloud.athas.dev", "not-a-uuid", "t")).is_none());
        assert!(WorkspaceSession::parse(&session("https://cloud.athas.dev", id, "")).is_none());
        assert!(WorkspaceSession::parse(&serde_json::json!({ "workspaceId": id })).is_none());

        assert_eq!(parse_iso_time_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_time_ms("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(parse_iso_time_ms("1970-01-01T01:00:00+01:00"), Some(0));
        assert_eq!(parse_iso_time_ms("2000-03-01T00:00:00.000Z"), Some(951_868_800_000));
        assert_eq!(parse_iso_time_ms("soon"), None);
    }

    use super::*;
    use serde_json::json;

    #[test]
    fn messages_match_the_typescript_shapes() {
        let call = ClientMessage::parse(r#"{"type":"call","id":3,"method":"fs.read","params":{"path":"a.rs"}}"#).unwrap();
        assert_eq!(call, ClientMessage::Call { id: 3, method: "fs.read".into(), params: json!({ "path": "a.rs" }).as_object().unwrap().clone() });
        assert_eq!(ClientMessage::parse(r#"{"type":"ping"}"#), Some(ClientMessage::Ping));
        assert_eq!(ClientMessage::parse("nonsense"), None);

        let result = ServerMessage::Result { id: 3, outcome: CallOutcome::from_result(Ok(json!({ "size": 1 }))) };
        assert_eq!(serde_json::to_value(&result).unwrap(), json!({ "type": "result", "id": 3, "ok": true, "value": { "size": 1 } }));
        let failed = ServerMessage::Result { id: 4, outcome: CallOutcome::from_result(Err(CallError::new("not_found", "gone"))) };
        assert_eq!(
            serde_json::to_value(&failed).unwrap(),
            json!({ "type": "result", "id": 4, "ok": false, "error": { "code": "not_found", "message": "gone" } })
        );
        let changes = ServerMessage::FsChanges {
            changes: vec![FileChange { path: "src".into(), kind: ChangeKind::Created, is_dir: true }],
            git_changed: false,
            rescan: false,
        };
        assert_eq!(
            serde_json::to_value(&changes).unwrap(),
            json!({ "type": "fs.changes", "changes": [{ "path": "src", "kind": "created", "isDir": true }], "gitChanged": false, "rescan": false })
        );
        let exit = ServerMessage::TerminalExit { id: "t1".into(), exit_code: Some(0) };
        assert_eq!(serde_json::to_value(&exit).unwrap(), json!({ "type": "terminal.exit", "id": "t1", "exitCode": 0 }));
        let parsed: ServerMessage = serde_json::from_value(json!({ "type": "result", "id": 4, "ok": false, "error": { "code": "x", "message": "y" } })).unwrap();
        assert_eq!(parsed, ServerMessage::Result { id: 4, outcome: CallOutcome::from_result(Err(CallError::new("x", "y"))) });
    }

    #[test]
    fn terminal_frames_round_trip() {
        let frame = encode_terminal_frame("t12", b"hello\r\n");
        assert_eq!(&frame[..5], &[1, 3, b't', b'1', b'2']);
        assert_eq!(decode_terminal_frame(&frame), Some(("t12".into(), &b"hello\r\n"[..])));
        assert_eq!(decode_terminal_frame(&[2, 0]), None);
        assert_eq!(decode_terminal_frame(&[1, 9, b'x']), None);
    }

    #[test]
    fn paths_stay_inside_the_root() {
        let root = Path::new("/workspace/repo");
        assert_eq!(resolve_path(root, "").unwrap(), root);
        assert_eq!(resolve_path(root, "./src/").unwrap(), root.join("src"));
        assert_eq!(resolve_path(root, "src/main.rs").unwrap(), root.join("src/main.rs"));
        assert!(resolve_path(root, "/etc/passwd").is_err());
        assert!(resolve_path(root, "src/../../x").is_err());
        assert_eq!(relative_path(root, &root.join("a/b")), Some("a/b".into()));
        assert_eq!(relative_path(root, Path::new("/elsewhere")), None);
    }

    #[test]
    fn base64_round_trips() {
        assert_eq!(from_base64(&json!(to_base64(b"\x00\xffbytes"))).unwrap(), b"\x00\xffbytes");
        assert!(from_base64(&json!(1)).is_err());
    }
}
