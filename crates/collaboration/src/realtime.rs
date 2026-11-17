//! The account service's realtime collaboration (`collaboration-realtime.ts` and the document
//! half of `collaboration-api.ts`): presence heartbeats, shared documents with their update
//! stream (server-sent events), and the room tickets and messages of the realtime rooms.
//! Everything here is plain data and blocking calls; [`crate::room`] keeps a room's socket open
//! and [`crate::presence`] drives it all from the editor in front.

use std::{
    sync::atomic::{AtomicI64, Ordering},
    time::Duration,
};

use account::{
    ApiError, Client,
    api::{Collaboration, Method},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

/// The account service answers 404 `realtime_disabled` while rooms are off; ask again after this.
const REALTIME_DISABLED_RETRY_MS: i64 = 5 * 60_000;
const RECONNECT_BASE_MS: u64 = 1_000;
const RECONNECT_MAX_MS: u64 = 30_000;
/// The room closes a socket with this code when its token expired without being renewed.
pub const ROOM_TOKEN_EXPIRED_CLOSE_CODE: u16 = 4001;

static REALTIME_DISABLED_UNTIL: AtomicI64 = AtomicI64::new(0);

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// A shared document's room, or the room of an agent session shared with the team.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RoomTarget {
    Document(i64),
    Share(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomTicket {
    pub url: String,
    /// Milliseconds since the epoch.
    pub expires_at: i64,
}

impl RoomTicket {
    /// The token the ticket's URL carries, sent again to renew an open socket.
    pub fn token(&self) -> Option<String> {
        url::Url::parse(&self.url).ok()?.query_pairs().find(|(key, _)| key == "token").map(|(_, value)| value.into_owned())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomMember {
    pub connection_id: String,
    pub user_id: i64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RoomMessage {
    Welcome { me: RoomMember, members: Vec<RoomMember> },
    Join(RoomMember),
    Leave(RoomMember),
    Presence { from: RoomMember, data: Map<String, Value> },
    Event { from: RoomMember, name: String, data: Map<String, Value> },
    Error(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomStatus {
    Connecting,
    Open,
    Reconnecting,
    /// Rooms are off, or the room never opened; callers keep polling.
    Unavailable,
    Closed,
}

fn member(value: Option<&Value>) -> Option<RoomMember> {
    let value = value?;
    value.get("connectionId")?.as_str()?;
    value.get("userId")?.as_i64()?;
    serde_json::from_value(value.clone()).ok()
}

/// A room's message, or `None` for keepalive answers and anything malformed
/// (`parseCollaborationRoomMessage`).
pub fn parse_room_message(raw: &str) -> Option<RoomMessage> {
    if raw == "pong" {
        return None;
    }
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;
    let data = || object.get("data").and_then(Value::as_object).cloned();
    match object.get("type")?.as_str()? {
        "welcome" => {
            let members = object.get("members")?.as_array()?.iter().filter_map(|entry| member(Some(entry))).collect();
            Some(RoomMessage::Welcome { me: member(object.get("self"))?, members })
        }
        "join" => Some(RoomMessage::Join(member(object.get("member"))?)),
        "leave" => Some(RoomMessage::Leave(member(object.get("member"))?)),
        "presence" => Some(RoomMessage::Presence { from: member(object.get("from"))?, data: data()? }),
        "event" => Some(RoomMessage::Event {
            from: member(object.get("from"))?,
            name: object.get("name")?.as_str()?.to_string(),
            data: data()?,
        }),
        "error" => Some(RoomMessage::Error(object.get("error")?.as_str()?.to_string())),
        _ => None,
    }
}

/// The wait before reconnect attempt `attempt` (1-based): doubling from a second up to thirty,
/// with a quarter either way of jitter (`random` in 0..1).
pub fn reconnect_delay(attempt: u32, random: f64) -> Duration {
    let base = (RECONNECT_BASE_MS.saturating_mul(1u64 << attempt.saturating_sub(1).min(16))).min(RECONNECT_MAX_MS);
    Duration::from_millis((base as f64 * (0.75 + random.clamp(0.0, 1.0) * 0.5)).round() as u64)
}

pub fn reset_realtime_availability() {
    REALTIME_DISABLED_UNTIL.store(0, Ordering::Relaxed);
}

/// Asks the account service for a room ticket; `Ok(None)` while realtime rooms are off.
pub fn request_room_ticket(client: &Client, token: &str, target: &RoomTarget, device_id: &str, now: i64) -> Result<Option<RoomTicket>, ApiError> {
    if REALTIME_DISABLED_UNTIL.load(Ordering::Relaxed) > now {
        return Ok(None);
    }
    let mut body = json!({ "deviceId": device_id });
    match target {
        RoomTarget::Document(id) => body["documentId"] = json!(id),
        RoomTarget::Share(id) => body["shareId"] = json!(id),
    }
    let payload = match client.authed(token, Method::Post, "/api/collaboration/rooms/token", Some(&body), "Failed to join collaboration room") {
        Ok(payload) => payload,
        Err(ApiError::Http { status: 404, code: Some(code), .. }) if code == "realtime_disabled" => {
            REALTIME_DISABLED_UNTIL.store(now + REALTIME_DISABLED_RETRY_MS, Ordering::Relaxed);
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let Some(url) = payload.get("url").and_then(Value::as_str).filter(|url| url.starts_with("ws://") || url.starts_with("wss://")) else {
        return Ok(None);
    };
    let expires_at = payload
        .get("expiresAt")
        .and_then(Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map_or(now, |time| time.timestamp_millis());
    Ok(Some(RoomTicket { url: url.to_string(), expires_at }))
}

fn snapshot(payload: Value) -> Option<Collaboration> {
    payload.get("collaboration").and_then(Collaboration::parse)
}

/// What a heartbeat tells the team about this device.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PresenceUpdate {
    pub online: bool,
    pub active_file_path: Option<String>,
    pub following_user_id: Option<i64>,
    pub cursor_label: Option<String>,
}

/// `POST /api/collaboration/presence`; answers with the whole team.
pub fn update_presence(client: &Client, token: &str, device_id: &str, update: &PresenceUpdate) -> Result<Option<Collaboration>, ApiError> {
    let body = json!({
        "deviceId": device_id,
        "status": if update.online { "online" } else { "offline" },
        "followingUserId": if update.online { update.following_user_id } else { None },
        "activeFilePath": update.active_file_path,
        "cursorLabel": if update.online { update.cursor_label.clone() } else { None },
    });
    client.authed(token, Method::Post, "/api/collaboration/presence", Some(&body), "Failed to update collaboration presence").map(snapshot)
}

/// `POST /api/collaboration/documents`: shares the file at `path` with the team.
pub fn register_document(client: &Client, token: &str, path: &str) -> Result<Option<Collaboration>, ApiError> {
    let body = json!({ "path": path, "baseVersion": 0, "stateVector": { "source": "desktop-active-buffer" } });
    client.authed(token, Method::Post, "/api/collaboration/documents", Some(&body), "Failed to register collaboration document").map(snapshot)
}

/// `POST /api/collaboration/documents/{id}/updates`: a cursor or viewport update over REST, for
/// when the document's room is not open.
pub fn append_document_update(
    client: &Client,
    token: &str,
    document_id: i64,
    client_id: &str,
    client_seq: u64,
    update_type: &str,
    operation: &Value,
) -> Result<Option<Collaboration>, ApiError> {
    let body = json!({ "clientId": client_id, "clientSeq": client_seq, "updateType": update_type, "operation": operation });
    client
        .authed(token, Method::Post, &format!("/api/collaboration/documents/{document_id}/updates"), Some(&body), "Failed to append collaboration document update")
        .map(snapshot)
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub id: i64,
    pub path: String,
    pub base_version: i64,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DocumentUpdate {
    pub id: i64,
    pub document_id: i64,
    pub actor_user_id: Option<i64>,
    pub client_id: String,
    pub client_seq: i64,
    pub server_version: i64,
    pub update_type: String,
    pub operation: Map<String, Value>,
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum StreamEvent {
    Ready { document: DocumentSnapshot, after_server_version: i64 },
    Update { document: DocumentSnapshot, update: DocumentUpdate },
    Heartbeat { document: DocumentSnapshot, after_server_version: i64 },
    Error(String),
}

/// One `event:`/`data:` block of the document stream (`parseCollaborationSseBlock`).
pub fn parse_stream_block(block: &str) -> Option<StreamEvent> {
    let event = block.lines().find_map(|line| line.strip_prefix("event:")).map(str::trim)?;
    let data = block.lines().filter_map(|line| line.strip_prefix("data:")).map(str::trim_start).collect::<Vec<_>>().join("\n");
    if data.is_empty() {
        return None;
    }
    let data: Value = serde_json::from_str(&data).ok()?;
    data.as_object()?;
    let document = || data.get("document").and_then(|document| serde_json::from_value::<DocumentSnapshot>(document.clone()).ok());
    let after = data.get("afterServerVersion").and_then(Value::as_i64).unwrap_or(0);
    match event {
        "ready" => Some(StreamEvent::Ready { document: document()?, after_server_version: after }),
        "update" => Some(StreamEvent::Update { document: document()?, update: serde_json::from_value(data.get("update")?.clone()).ok()? }),
        "heartbeat" => Some(StreamEvent::Heartbeat { document: document()?, after_server_version: after }),
        "error" => Some(StreamEvent::Error(data.get("error").and_then(Value::as_str).unwrap_or("Collaboration stream failed").to_string())),
        _ => None,
    }
}

/// Splits what arrived so far into complete blocks, keeping the unfinished tail in `buffer`.
pub fn drain_stream_blocks(buffer: &mut String) -> Vec<StreamEvent> {
    let mut events = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let block: String = buffer.drain(..end + 2).collect();
        events.extend(parse_stream_block(block.trim()));
    }
    events
}

/// Where a teammate's file is in the project open here, matched by the project folder's name
/// (`mapTeammatePath`): `/home/ada/code/athas/src/app.ts` maps to `<root>/src/app.ts` when the
/// open project is a folder called `athas`.
pub fn map_teammate_path(theirs: &str, root: &str) -> Option<String> {
    let root = root.trim_end_matches(['/', '\\']);
    let theirs_normalized = theirs.replace('\\', "/");
    let name = root.rsplit(['/', '\\']).next().filter(|name| !name.is_empty())?;
    if theirs_normalized.starts_with(&format!("{}/", root.replace('\\', "/"))) {
        return Some(theirs.to_string());
    }
    let marker = format!("/{name}/");
    let index = theirs_normalized.rfind(&marker)?;
    Some(format!("{root}/{}", &theirs_normalized[index + marker.len()..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_messages_parse_and_malformed_ones_drop() {
        let welcome = r#"{"type":"welcome","self":{"connectionId":"c1","userId":1,"deviceId":"d1"},"members":[{"connectionId":"c2","userId":2},{"bad":true}]}"#;
        match parse_room_message(welcome) {
            Some(RoomMessage::Welcome { me, members }) => {
                assert_eq!(me.device_id.as_deref(), Some("d1"));
                assert_eq!(members.len(), 1);
            }
            other => panic!("{other:?}"),
        }
        let presence = r#"{"type":"presence","from":{"connectionId":"c2","userId":2},"data":{"updateType":"cursor"}}"#;
        assert!(matches!(parse_room_message(presence), Some(RoomMessage::Presence { .. })));
        assert_eq!(parse_room_message(r#"{"type":"error","error":"nope"}"#), Some(RoomMessage::Error("nope".into())));
        assert_eq!(parse_room_message("pong"), None);
        assert_eq!(parse_room_message(r#"{"type":"join","member":{"userId":2}}"#), None);
        assert_eq!(parse_room_message("not json"), None);
    }

    #[test]
    fn reconnect_backs_off_to_thirty_seconds() {
        assert_eq!(reconnect_delay(1, 0.5), Duration::from_millis(1000));
        assert_eq!(reconnect_delay(3, 0.5), Duration::from_millis(4000));
        assert_eq!(reconnect_delay(20, 0.5), Duration::from_millis(30_000));
        assert_eq!(reconnect_delay(1, 0.0), Duration::from_millis(750));
    }

    #[test]
    fn stream_blocks_split_on_blank_lines() {
        let mut buffer = String::from(
            "event: ready\ndata: {\"document\":{\"id\":7,\"path\":\"/a\",\"baseVersion\":3},\"afterServerVersion\":3}\n\nevent: update\ndata: {\"document\":{\"id\":7},\"update\":{\"clientId\":\"x\",\"serverVersion\":4,\"updateType\":\"cursor\",\"operation\":{}}}\n\nevent: heart",
        );
        let events = drain_stream_blocks(&mut buffer);
        assert_eq!(events.len(), 2);
        assert!(matches!(&events[0], StreamEvent::Ready { document, after_server_version: 3 } if document.id == 7));
        assert!(matches!(&events[1], StreamEvent::Update { update, .. } if update.server_version == 4));
        assert_eq!(buffer, "event: heart");
        assert_eq!(parse_stream_block("event: error\ndata: {\"error\":\"gone\"}"), Some(StreamEvent::Error("gone".into())));
    }

    #[test]
    fn teammate_paths_map_by_project_folder_name() {
        assert_eq!(map_teammate_path("/home/ada/code/athas/src/app.ts", "/Users/me/athas"), Some("/Users/me/athas/src/app.ts".into()));
        assert_eq!(map_teammate_path("/Users/me/athas/README.md", "/Users/me/athas/"), Some("/Users/me/athas/README.md".into()));
        assert_eq!(map_teammate_path("/home/ada/other/file.rs", "/Users/me/athas"), None);
    }

    #[test]
    fn ticket_token_comes_from_the_url() {
        let ticket = RoomTicket { url: "wss://rooms.example/r/1?token=abc&x=1".into(), expires_at: 0 };
        assert_eq!(ticket.token().as_deref(), Some("abc"));
    }

    #[test]
    fn an_offline_heartbeat_drops_what_only_online_devices_share() {
        use telemetry::mock_server::{MockServer, Response};

        let server = MockServer::start(|_| Response::json(200, json!({})));
        let client = Client::new(account::ServiceUrls::local(server.url()));
        let update = PresenceUpdate { online: false, active_file_path: None, following_user_id: Some(4), cursor_label: Some("Fix".into()) };
        update_presence(&client, "tok", "dev-1", &update).unwrap();
        let body = server.requests()[0].json();
        assert_eq!(body["status"], "offline");
        assert_eq!(body["deviceId"], "dev-1");
        assert_eq!((body["followingUserId"].clone(), body["cursorLabel"].clone()), (Value::Null, Value::Null));
    }
}
