//! The team's REST calls (`collaboration-api.ts`): a shared session with its comments, reviews,
//! hand-offs and the inbox. The team snapshot itself (members, shared sessions, inbox, presence)
//! comes with the plan from `/api/auth/subscription`, so refreshing the plan refreshes the team.

use account::{ApiError, Client, Method, api::TeamSharedSession};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::sharing::encode;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommentKind {
    Approve,
    RequestChanges,
    #[default]
    #[serde(other)]
    Comment,
}

impl CommentKind {
    /// What the comment did, after its author's name.
    pub fn verb(self) -> Option<&'static str> {
        match self {
            Self::Comment => None,
            Self::Approve => Some("approved"),
            Self::RequestChanges => Some("requested changes"),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TeamComment {
    pub id: i64,
    pub share_id: String,
    pub author_user_id: i64,
    pub author_name: String,
    pub kind: CommentKind,
    pub body: String,
    pub file_path: Option<String>,
    pub line: Option<i64>,
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct TeamMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Mentionable {
    pub user_id: i64,
    pub name: String,
}

/// A session a teammate shared: its conversation, comments and who to mention.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct TeamSessionDetail {
    pub session: TeamSharedSession,
    pub messages: Vec<TeamMessage>,
    pub comments: Vec<TeamComment>,
    pub members: Vec<Mentionable>,
}

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ApiError> {
    serde_json::from_value(value).map_err(|error| ApiError::Malformed(format!("Unexpected answer from the team service: {error}")))
}

fn session_path(share_id: &str, rest: &str) -> String {
    format!("/api/collaboration/sessions/{}{rest}", encode(share_id))
}

pub fn fetch_session(client: &Client, token: &str, share_id: &str) -> Result<TeamSessionDetail, ApiError> {
    decode(client.authed(token, Method::Get, &session_path(share_id, ""), None, "Failed to open the shared session")?)
}

/// Comments on a shared session, approves it or requests changes; returns every comment.
pub fn add_comment(
    client: &Client,
    token: &str,
    share_id: &str,
    kind: CommentKind,
    body: &str,
    file_path: Option<&str>,
    line: Option<i64>,
) -> Result<Vec<TeamComment>, ApiError> {
    let input = json!({ "kind": kind, "body": body, "filePath": file_path, "line": line });
    let answer = client.authed(token, Method::Post, &session_path(share_id, "/comments"), Some(&input), "Failed to add the comment")?;
    decode(answer.get("comments").cloned().unwrap_or(Value::Array(Vec::new())))
}

/// Passes a shared session to a teammate, with an optional note.
pub fn hand_off(client: &Client, token: &str, share_id: &str, to_user_id: i64, note: &str) -> Result<(), ApiError> {
    let input = json!({ "toUserId": to_user_id, "note": note });
    client.authed(token, Method::Post, &session_path(share_id, "/handoff"), Some(&input), "Failed to hand off the session").map(|_| ())
}

/// Asks teammates to review a shared session.
pub fn request_review(client: &Client, token: &str, share_id: &str, user_ids: &[i64], note: &str) -> Result<(), ApiError> {
    let input = json!({ "userIds": user_ids, "note": note });
    client.authed(token, Method::Post, &session_path(share_id, "/review-request"), Some(&input), "Failed to request a review").map(|_| ())
}

/// Marks inbox items read: the given ids, or all of them.
pub fn mark_inbox_read(client: &Client, token: &str, ids: Option<&[i64]>) -> Result<(), ApiError> {
    let input = match ids {
        Some(ids) => json!({ "ids": ids }),
        None => json!({}),
    };
    client.authed(token, Method::Patch, "/api/collaboration/inbox", Some(&input), "Failed to update the inbox").map(|_| ())
}

#[cfg(test)]
mod tests {
    use account::{ServiceUrls, api::ReviewState};
    use telemetry::mock_server::{MockServer, Response};

    use super::*;

    #[test]
    fn talks_to_the_collaboration_api() {
        let server = MockServer::start(|request| match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/api/collaboration/sessions/sh%2F1") => Response::json(200, json!({
                "session": { "shareId": "sh/1", "title": "Fix login", "ownerUserId": 2, "ownerName": "Ana", "live": true, "reviewState": "changes_requested" },
                "messages": [{ "role": "user", "content": "Fix login" }],
                "comments": [{ "id": 1, "authorName": "Sam", "kind": "approve", "body": "" }],
                "members": [{ "userId": 2, "name": "Ana" }],
            })),
            ("POST", "/api/collaboration/sessions/sh%2F1/comments") => Response::json(200, json!({ "comments": [{ "id": 2, "kind": "comment", "body": "Nice" }] })),
            ("POST", _) => Response::json(200, json!({ "ok": true })),
            ("PATCH", "/api/collaboration/inbox") => Response::json(200, json!({ "ok": true })),
            _ => Response::json(403, json!({ "error": "Team plan required" })),
        });
        let client = Client::new(ServiceUrls::local(server.url()));
        let detail = fetch_session(&client, "tok", "sh/1").unwrap();
        assert_eq!(detail.session.review_state, ReviewState::ChangesRequested);
        assert_eq!(detail.comments[0].kind.verb(), Some("approved"));
        assert_eq!(detail.members[0].name, "Ana");
        let comments = add_comment(&client, "tok", "sh/1", CommentKind::RequestChanges, "Nice", Some("src/a.rs"), Some(3)).unwrap();
        assert_eq!(comments[0].body, "Nice");
        hand_off(&client, "tok", "sh/1", 2, "over to you").unwrap();
        request_review(&client, "tok", "sh/1", &[2, 3], "").unwrap();
        mark_inbox_read(&client, "tok", Some(&[5])).unwrap();
        mark_inbox_read(&client, "tok", None).unwrap();

        let requests = server.requests();
        assert_eq!(requests[1].json(), json!({ "kind": "request_changes", "body": "Nice", "filePath": "src/a.rs", "line": 3 }));
        assert_eq!(requests[2].path, "/api/collaboration/sessions/sh%2F1/handoff");
        assert_eq!(requests[2].json(), json!({ "toUserId": 2, "note": "over to you" }));
        assert_eq!(requests[3].json()["userIds"], json!([2, 3]));
        assert_eq!(requests[4].json(), json!({ "ids": [5] }));
        assert_eq!(requests[5].json(), json!({}));

        let error = fetch_session(&client, "tok", "other").unwrap_err();
        assert_eq!(error.to_string(), "Team plan required");
        assert!(!error.is_auth_invalid());
    }
}
