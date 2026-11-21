//! Sharing to the web (`features/sharing`): a read-only snapshot of an agent session on
//! athas.dev, public or limited to emails or an organization, optionally kept up to date.

use std::{path::Path, sync::LazyLock};

use account::{ApiError, Client, Method};
use agent_ui::thread::{Entry, Transcript};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The largest snapshot the server takes.
pub const MAX_SHARE_CHARS: usize = 500_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShareKind {
    Snippet,
    Buffer,
    #[default]
    Agent,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    #[default]
    Public,
    Email,
    Organization,
    Private,
}

impl Visibility {
    pub const CHOICES: [Visibility; 3] = [Visibility::Public, Visibility::Email, Visibility::Organization];

    pub fn label(self) -> &'static str {
        match self {
            Self::Public => "Anyone with the link",
            Self::Email => "Specific emails · Pro",
            Self::Organization => "Organization · Pro",
            Self::Private => "Private",
        }
    }

    pub fn short_label(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::Email => "email",
            Self::Organization => "organization",
            Self::Private => "private",
        }
    }

    /// Email and organization links need Pro.
    pub fn is_restricted(self) -> bool {
        matches!(self, Self::Email | Self::Organization)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ShareMessage {
    pub role: &'static str,
    pub content: String,
}

/// What is about to be shared.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ShareDraft {
    pub source_id: Option<String>,
    pub device_id: Option<String>,
    pub source_updated_at: Option<i64>,
    pub kind: ShareKind,
    pub title: String,
    pub content: String,
    pub language: String,
    pub messages: Vec<ShareMessage>,
    /// The first line's number, for a snippet out of a file.
    pub start_line: Option<usize>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Organization {
    pub id: i64,
    pub name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SharedItem {
    pub id: String,
    pub title: String,
    pub kind: ShareKind,
    pub visibility: Visibility,
    pub live: bool,
    pub source_id: Option<String>,
    pub device_id: Option<String>,
    pub revision: i64,
    pub updated_at: i64,
    pub emails: Vec<String>,
    pub workspace_id: Option<i64>,
}

/// `GET /api/shares`: what the account may share and what it has shared.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ShareOptions {
    pub pro: bool,
    pub sessions_enabled: bool,
    pub items: Vec<SharedItem>,
    pub organizations: Vec<Organization>,
    /// Sessions kept out of session sync.
    pub excluded_sources: Vec<ExcludedSource>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ExcludedSource {
    pub source_id: String,
    pub device_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct CreatedShare {
    pub id: String,
    pub url: String,
}

/// Who may open a link.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Access {
    pub visibility: Visibility,
    pub emails: Vec<String>,
    pub workspace_id: Option<i64>,
}

/// Splits "a@x.com, b@y.com; c@z.com" into addresses.
pub fn parse_emails(text: &str) -> Vec<String> {
    text.split([',', ';', ' ', '\n', '\t']).map(str::trim).filter(|email| !email.is_empty()).map(str::to_string).collect()
}

static LOCAL_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)(^|[\s(\[`])(?:file://)?(?:~/|/(?:Users|home|private|tmp|var|Volumes)/)[^\s)\]}`]+").expect("local path pattern")
});
static WINDOWS_PATH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b[A-Za-z]:\\[^\s)\]}`]+").expect("windows path pattern"));

/// Replaces paths on this machine with `[local path]` (`redactLocalPaths`).
pub fn redact_local_paths(content: &str) -> String {
    let unix = LOCAL_PATH.replace_all(content, "${1}[local path]");
    WINDOWS_PATH.replace_all(&unix, "[local path]").into_owned()
}

/// The conversation of a session: what you asked and what the agent answered, without
/// thoughts, tool calls or notices, local paths redacted.
pub fn conversation(transcript: &Transcript) -> Vec<ShareMessage> {
    transcript
        .entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::User(message) => Some(("user", message.text.as_str())),
            Entry::Agent(message) => Some(("assistant", message.text.as_str())),
            _ => None,
        })
        .filter(|(_, text)| !text.trim().is_empty())
        .map(|(role, text)| ShareMessage { role, content: redact_local_paths(text) })
        .collect()
}

pub fn conversation_markdown(messages: &[ShareMessage]) -> String {
    messages
        .iter()
        .map(|message| format!("## {}\n\n{}", if message.role == "user" { "You" } else { "Agent" }, message.content))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The share draft of an agent session as it is now.
pub fn agent_draft(session_id: &str, title: &str, transcript: &Transcript, updated_at_ms: Option<i64>) -> ShareDraft {
    let messages = conversation(transcript);
    ShareDraft {
        source_id: Some(session_id.to_string()),
        device_id: Some(device_id()),
        source_updated_at: updated_at_ms,
        kind: ShareKind::Agent,
        title: title.to_string(),
        content: conversation_markdown(&messages),
        language: "markdown".into(),
        messages,
        start_line: None,
    }
}

/// The share draft of a file, or with `selection` (its first line, zero-based, and text) of the
/// selected code only (`shareEditor`).
pub fn editor_draft(path: &str, title: &str, language: &str, content: String, selection: Option<(usize, String)>) -> ShareDraft {
    let language = if language.trim().is_empty() { "text" } else { language };
    let (kind, start_line, content) = match selection {
        Some((line, text)) => (ShareKind::Snippet, Some(line + 1), text),
        None => (ShareKind::Buffer, Some(1), content),
    };
    ShareDraft {
        source_id: Some(path.to_string()),
        device_id: Some(device_id()),
        source_updated_at: None,
        kind,
        title: title.to_string(),
        content,
        language: language.to_lowercase(),
        messages: Vec::new(),
        start_line,
    }
}

/// Reads a session's saved transcript (`agent_ui::persistence`) and makes its draft.
pub fn agent_draft_from_disk(sessions_dir: &Path, session_id: &str, title: &str) -> Option<ShareDraft> {
    let transcript = agent_ui::persistence::load(sessions_dir, session_id)?;
    let title = if title.trim().is_empty() { transcript.agent_title.clone().unwrap_or_else(|| "Agent session".into()) } else { title.to_string() };
    Some(agent_draft(session_id, &title, &transcript, None))
}

/// This install's sharing device id, kept beside the settings.
pub fn device_id() -> String {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(read_or_create_device_id).clone()
}

fn read_or_create_device_id() -> String {
    let path = if cfg!(test) { None } else { dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("sharing-device")) };
    if let Some(id) = path.as_ref().and_then(|path| std::fs::read_to_string(path).ok()).map(|id| id.trim().to_string()).filter(|id| !id.is_empty()) {
        return id;
    }
    let id = uuid::Uuid::new_v4().to_string();
    if let Some(path) = path {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, &id);
    }
    id
}

/// The body of `POST /api/shares`.
pub fn create_body(draft: &ShareDraft, request_id: &str, live: bool, access: &Access) -> Value {
    let restricted = |visibility| access.visibility == visibility;
    json!({
        "sourceUpdatedAt": draft.source_updated_at,
        "sourceId": draft.source_id,
        "deviceId": draft.device_id,
        "live": live,
        "kind": draft.kind,
        "title": draft.title,
        "content": draft.content,
        "language": draft.language,
        "messages": draft.messages,
        "startLine": draft.start_line,
        "requestId": request_id,
        "visibility": access.visibility,
        "emails": if restricted(Visibility::Email) { access.emails.clone() } else { Vec::new() },
        "workspaceId": if restricted(Visibility::Organization) { access.workspace_id } else { None },
    })
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ApiError> {
    serde_json::from_value(value).map_err(|error| ApiError::Malformed(format!("Unexpected answer from Athas sharing: {error}")))
}

const FAILURE: &str = "Could not reach Athas sharing. Try again.";

pub fn fetch_options(client: &Client, token: &str) -> Result<ShareOptions, ApiError> {
    decode(client.authed(token, Method::Get, "/api/shares", None, FAILURE)?)
}

pub fn create_share(client: &Client, token: &str, body: &Value) -> Result<CreatedShare, ApiError> {
    decode(client.authed(token, Method::Post, "/api/shares", Some(body), FAILURE)?)
}

pub fn revoke_share(client: &Client, token: &str, id: &str) -> Result<(), ApiError> {
    client.authed(token, Method::Delete, &format!("/api/shares/{}", encode(id)), None, FAILURE).map(|_| ())
}

/// Changes a share; `revision` is the one the change was made against.
pub fn update_share(client: &Client, token: &str, id: &str, revision: i64, mut changes: Value) -> Result<i64, ApiError> {
    if let Value::Object(map) = &mut changes {
        map.insert("revision".into(), revision.into());
    }
    let answer = client.authed(token, Method::Patch, &format!("/api/shares/{}", encode(id)), Some(&changes), FAILURE)?;
    Ok(answer.get("revision").and_then(Value::as_i64).unwrap_or(revision + 1))
}

pub fn access_changes(access: &Access) -> Value {
    json!({ "visibility": access.visibility, "emails": access.emails, "workspaceId": access.workspace_id })
}

pub fn set_session_sync(client: &Client, token: &str, enabled: bool) -> Result<bool, ApiError> {
    let answer = client.authed(token, Method::Patch, "/api/cloud-sessions", Some(&json!({ "enabled": enabled })), FAILURE)?;
    Ok(answer.get("sessionsEnabled").and_then(Value::as_bool).unwrap_or(enabled))
}

/// A path segment, percent-encoded.
pub fn encode(segment: &str) -> String {
    segment
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// The server rejected the payload itself; retrying with the same content cannot succeed.
pub fn is_rejected(error: &ApiError) -> bool {
    matches!(error.status(), Some(400 | 413))
}

#[cfg(test)]
mod tests {
    use account::ServiceUrls;
    use agent_ui::thread::{AgentMessage, Notice, NoticeKind, Thought, UserMessage};
    use telemetry::mock_server::{MockServer, Response};

    use super::*;

    fn transcript() -> Transcript {
        Transcript {
            entries: vec![
                Entry::User(UserMessage { text: "Fix /Users/alex/code/app/src/main.rs please".into(), ..Default::default() }),
                Entry::Thought(Thought { text: "private reasoning".into(), ..Default::default() }),
                Entry::Agent(AgentMessage { message_id: None, text: "Edited `C:\\Users\\alex\\main.rs` and ~/notes.md".into(), ..Default::default() }),
                Entry::Notice(Notice { kind: NoticeKind::Stopped, text: "Stopped".into() }),
                Entry::Agent(AgentMessage { message_id: None, text: "  ".into(), ..Default::default() }),
            ],
            ..Default::default()
        }
    }

    #[test]
    fn a_session_snapshot_is_its_conversation_with_paths_redacted() {
        let messages = conversation(&transcript());
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0], ShareMessage { role: "user", content: "Fix [local path] please".into() });
        assert_eq!(messages[1].content, "Edited `[local path]` and [local path]");
        assert_eq!(conversation_markdown(&messages), "## You\n\nFix [local path] please\n\n## Agent\n\nEdited `[local path]` and [local path]");
        let draft = agent_draft("s1", "Fix main", &transcript(), Some(5));
        assert_eq!((draft.kind, draft.language.as_str(), draft.source_id.as_deref()), (ShareKind::Agent, "markdown", Some("s1")));
    }

    #[test]
    fn reads_the_saved_transcript() {
        let dir = std::env::temp_dir().join(format!("athas-share-{}", uuid::Uuid::new_v4()));
        agent_ui::persistence::save(&dir, "s2", &transcript()).unwrap();
        let draft = agent_draft_from_disk(&dir, "s2", "").unwrap();
        assert_eq!(draft.title, "Agent session");
        assert_eq!(draft.messages.len(), 2);
        assert!(agent_draft_from_disk(&dir, "missing", "x").is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn create_bodies_carry_only_the_chosen_restriction() {
        let draft = agent_draft("s1", "T", &transcript(), None);
        let access = Access { visibility: Visibility::Email, emails: parse_emails("a@x.com, b@y.com;c@z.com"), workspace_id: Some(4) };
        let body = create_body(&draft, "r1", true, &access);
        assert_eq!(body["visibility"], "email");
        assert_eq!(body["emails"], json!(["a@x.com", "b@y.com", "c@z.com"]));
        assert_eq!(body["workspaceId"], Value::Null);
        assert_eq!(body["kind"], "agent");
        assert_eq!(body["messages"][0]["role"], "user");
        let public = create_body(&draft, "r1", false, &Access::default());
        assert_eq!((public["visibility"].as_str(), public["emails"].as_array().map(Vec::len)), (Some("public"), Some(0)));
    }

    #[test]
    fn talks_to_the_shares_api() {
        let server = MockServer::start(|request| match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/api/shares") => Response::json(200, json!({
                "pro": true, "sessionsEnabled": false,
                "items": [{ "id": "a1", "title": "Fix", "kind": "agent", "visibility": "organization", "live": true, "revision": 3, "updatedAt": 1, "emails": [], "workspaceId": 9 }],
                "organizations": [{ "id": 9, "name": "Athas" }],
            })),
            ("POST", "/api/shares") => Response::json(200, json!({ "id": "n1", "url": "https://athas.dev/s/n1" })),
            ("PATCH", "/api/shares/a%201") => Response::json(200, json!({ "revision": 4 })),
            ("DELETE", "/api/shares/a1") => Response::json(200, json!({ "revoked": true })),
            ("PATCH", "/api/cloud-sessions") => Response::json(200, json!({ "sessionsEnabled": true })),
            _ => Response::json(413, json!({ "error": "Snapshot too large" })),
        });
        let client = Client::new(ServiceUrls::local(server.url()));
        let options = fetch_options(&client, "tok").unwrap();
        assert!(options.pro && !options.sessions_enabled);
        assert_eq!(options.items[0].visibility, Visibility::Organization);
        assert_eq!(options.organizations[0].name, "Athas");
        let created = create_share(&client, "tok", &json!({})).unwrap();
        assert_eq!(created.url, "https://athas.dev/s/n1");
        assert_eq!(update_share(&client, "tok", "a 1", 3, access_changes(&Access::default())).unwrap(), 4);
        revoke_share(&client, "tok", "a1").unwrap();
        assert!(set_session_sync(&client, "tok", true).unwrap());
        let requests = server.requests();
        assert_eq!(requests[2].json()["revision"], 3);
        assert_eq!(requests[2].json()["visibility"], "public");

        let error = revoke_share(&client, "tok", "missing").unwrap_err();
        assert!(is_rejected(&error));
        assert_eq!(error.to_string(), "Snapshot too large");
    }
}
