//! Keeps live shares current (`sharing-runtime.tsx`): every 3 s while signed in, the open files
//! and agent sessions that have a live share from this device are sent again when they changed,
//! and with session sync on every session is published as a private cloud session.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    rc::Rc,
    time::Duration,
};

use account::{AccountStore, ApiError, Client, Method};
use gpui::{App, Global, Task};
use serde_json::{Value, json};

use crate::sharing::{self, ShareDraft, ShareKind, ShareOptions, Visibility};

const SYNC_INTERVAL: Duration = Duration::from_secs(3);
const MAX_CONTENT: usize = 500_000;
const MAX_TITLE: usize = 200;

/// An agent session that may be shared, and when it last changed.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionSource {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

/// What can be kept live: drafts of the open files and the agent sessions.
#[derive(Clone, Debug, Default)]
pub struct Sources {
    pub buffers: Vec<ShareDraft>,
    pub sessions: Vec<SessionSource>,
    pub sessions_dir: Option<PathBuf>,
}

pub type SourcesProvider = Rc<dyn Fn(&App) -> Sources>;

struct LiveShare {
    provider: SourcesProvider,
    _task: Task<()>,
}

impl Global for LiveShare {}

fn session_title(title: &str) -> String {
    let title: String = title.trim().chars().take(MAX_TITLE).collect();
    if title.is_empty() { "Untitled session".into() } else { title }
}

/// What a sync pass remembers between passes.
#[derive(Default)]
pub struct LiveSync {
    /// Share id → the revision and content last sent.
    sent: HashMap<String, String>,
    /// Source id → the request id of its cloud session.
    requests: HashMap<String, String>,
    /// Source id → a cloud-session payload the server refused, not retried until it changes.
    rejected: HashMap<String, String>,
    /// Session id → its draft at a given change time.
    loaded: HashMap<String, (i64, Option<ShareDraft>)>,
}

impl LiveSync {
    fn session_draft(&mut self, dir: &Path, session: &SessionSource, device_id: &str) -> Option<ShareDraft> {
        if let Some((at, draft)) = self.loaded.get(&session.id)
            && *at == session.updated_at
        {
            return draft.clone();
        }
        let draft = sharing::agent_draft_from_disk(dir, &session.id, &session.title).map(|mut draft| {
            draft.title = session_title(&session.title);
            draft.source_updated_at = Some(session.updated_at);
            draft.device_id = Some(device_id.to_string());
            draft
        });
        self.loaded.insert(session.id.clone(), (session.updated_at, draft.clone()));
        draft
    }

    /// One pass; blocking, so run it off the main thread.
    pub fn sync(&mut self, client: &Client, token: &str, device_id: &str, sources: &Sources) -> Result<(), ApiError> {
        let options = sharing::fetch_options(client, token)?;
        let live_here = |source: &str| {
            options.items.iter().any(|item| item.live && item.source_id.as_deref() == Some(source) && item.device_id.as_deref() == Some(device_id))
        };
        let mut drafts: Vec<ShareDraft> = Vec::new();
        if let Some(dir) = &sources.sessions_dir {
            let mut sessions = sources.sessions.clone();
            sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            for session in sessions.iter().filter(|session| options.sessions_enabled || live_here(&session.id)) {
                if let Some(draft) = self.session_draft(dir, session, device_id).filter(|draft| !draft.content.is_empty() && draft.content.len() <= MAX_CONTENT) {
                    drafts.push(draft);
                }
            }
        }
        drafts.extend(sources.buffers.iter().filter(|draft| draft.content.len() <= MAX_CONTENT).cloned());

        let mut first_error = None;
        for draft in &drafts {
            if let Err(error) = self.sync_draft(client, token, device_id, &options, draft) {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    fn sync_draft(&mut self, client: &Client, token: &str, device_id: &str, options: &ShareOptions, draft: &ShareDraft) -> Result<(), ApiError> {
        let Some(source) = draft.source_id.clone() else { return Ok(()) };
        let private_here = options
            .items
            .iter()
            .any(|item| item.visibility == Visibility::Private && item.source_id.as_deref() == Some(&source) && item.device_id.as_deref() == Some(device_id));
        let excluded = options.excluded_sources.iter().any(|item| item.device_id == device_id && item.source_id == source);
        if options.sessions_enabled && !excluded && draft.kind == ShareKind::Agent && !private_here {
            let request_id = self.requests.entry(source.clone()).or_insert_with(|| uuid::Uuid::new_v4().to_string()).clone();
            let mut payload = sharing::create_body(draft, &request_id, true, &sharing::Access { visibility: Visibility::Private, ..Default::default() });
            if let Value::Object(map) = &mut payload {
                map.remove("emails");
                map.remove("workspaceId");
            }
            let signature = payload.to_string();
            if self.rejected.get(&source) != Some(&signature) {
                match client.authed(token, Method::Post, "/api/cloud-sessions", Some(&payload), "Could not sync sessions") {
                    Ok(_) => {
                        self.rejected.remove(&source);
                    }
                    Err(error) => {
                        if sharing::is_rejected(&error) {
                            self.rejected.insert(source.clone(), signature);
                        }
                        return Err(error);
                    }
                }
            }
        }
        for item in &options.items {
            if !item.live
                || item.device_id.as_deref() != Some(device_id)
                || item.source_id.as_deref() != Some(&source)
                || (item.visibility == Visibility::Private && !options.sessions_enabled)
            {
                continue;
            }
            let changes = json!({
                "sourceUpdatedAt": draft.source_updated_at,
                "title": draft.title,
                "content": draft.content,
                "messages": draft.messages,
                "language": draft.language,
            });
            let signature = changes.to_string();
            if self.sent.get(&item.id) == Some(&format!("{}:{signature}", item.revision)) {
                continue;
            }
            let revision = sharing::update_share(client, token, &item.id, item.revision, changes)?;
            self.sent.insert(item.id.clone(), format!("{revision}:{signature}"));
        }
        Ok(())
    }
}

/// Starts the sync loop with what the workbench can share; calling it again only swaps the
/// provider.
pub fn start(provider: SourcesProvider, cx: &mut App) {
    if cx.has_global::<LiveShare>() {
        cx.global_mut::<LiveShare>().provider = provider;
        return;
    }
    let task = cx.spawn(async move |cx| {
        let mut live = LiveSync::default();
        loop {
            cx.background_executor().timer(SYNC_INTERVAL).await;
            let pass = cx.update(|cx| {
                let store = AccountStore::global(cx)?;
                let store = store.read(cx);
                let (client, token) = (store.client().clone(), store.token()?.to_string());
                let provider = cx.try_global::<LiveShare>()?.provider.clone();
                Some((client, token, provider(cx)))
            });
            let Some((client, token, sources)) = pass else { continue };
            live = cx
                .background_executor()
                .spawn(async move {
                    let _ = live.sync(&client, &token, &sharing::device_id(), &sources);
                    live
                })
                .await;
        }
    });
    cx.set_global(LiveShare { provider, _task: task });
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use account::ServiceUrls;
    use telemetry::mock_server::{MockServer, Response};

    use super::*;

    fn buffer(content: &str) -> ShareDraft {
        sharing::editor_draft("/p/main.rs", "main.rs", "rust", content.into(), None)
    }

    #[test]
    fn live_shares_are_sent_again_only_when_they_change() {
        let revision = Arc::new(Mutex::new(3));
        let served = revision.clone();
        let server = MockServer::start(move |request| match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/api/shares") => Response::json(200, json!({
                "sessionsEnabled": false,
                "items": [
                    { "id": "s1", "title": "main.rs", "kind": "buffer", "visibility": "public", "live": true, "sourceId": "/p/main.rs", "deviceId": "dev", "revision": *served.lock().unwrap() },
                    { "id": "s2", "title": "other", "kind": "buffer", "visibility": "public", "live": true, "sourceId": "/p/main.rs", "deviceId": "another device", "revision": 1 },
                    { "id": "s3", "title": "snapshot", "kind": "buffer", "visibility": "public", "live": false, "sourceId": "/p/main.rs", "deviceId": "dev", "revision": 1 },
                ],
            })),
            ("PATCH", "/api/shares/s1") => {
                let mut revision = served.lock().unwrap();
                *revision += 1;
                Response::json(200, json!({ "revision": *revision }))
            }
            _ => Response::json(404, json!({ "error": "unexpected" })),
        });
        let client = Client::new(ServiceUrls::local(server.url()));
        let mut live = LiveSync::default();
        let sources = Sources { buffers: vec![buffer("fn main() {}")], ..Default::default() };
        live.sync(&client, "tok", "dev", &sources).unwrap();
        live.sync(&client, "tok", "dev", &sources).unwrap();
        let patches: Vec<_> = server.requests().into_iter().filter(|request| request.method == "PATCH").collect();
        assert_eq!(patches.len(), 1, "unchanged content is not sent twice");
        assert_eq!(patches[0].json()["content"], "fn main() {}");
        assert_eq!(patches[0].json()["revision"], 3);

        let edited = Sources { buffers: vec![buffer("fn main() { run() }")], ..Default::default() };
        live.sync(&client, "tok", "dev", &edited).unwrap();
        let patches: Vec<_> = server.requests().into_iter().filter(|request| request.method == "PATCH").collect();
        assert_eq!(patches.len(), 2);
        assert_eq!(patches[1].json()["revision"], 4);
        assert_eq!(*revision.lock().unwrap(), 5);
    }

    #[test]
    fn session_sync_publishes_sessions_as_private_cloud_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = agent_ui::thread::Transcript {
            entries: vec![agent_ui::thread::Entry::User(agent_ui::thread::UserMessage { text: "Fix the build".into(), ..Default::default() })],
            ..Default::default()
        };
        agent_ui::persistence::save(dir.path(), "chat-1", &transcript).unwrap();
        let server = MockServer::start(|request| match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/api/shares") => Response::json(200, json!({ "sessionsEnabled": true, "items": [], "excludedSources": [{ "sourceId": "chat-2", "deviceId": "dev" }] })),
            ("POST", "/api/cloud-sessions") => Response::json(413, json!({ "error": "Snapshot too large" })),
            _ => Response::json(404, json!({})),
        });
        let client = Client::new(ServiceUrls::local(server.url()));
        let mut live = LiveSync::default();
        let sources = Sources {
            sessions: vec![SessionSource { id: "chat-1".into(), title: "  ".into(), updated_at: 7 }],
            sessions_dir: Some(dir.path().to_path_buf()),
            ..Default::default()
        };
        assert!(live.sync(&client, "tok", "dev", &sources).is_err());
        assert!(live.sync(&client, "tok", "dev", &sources).is_ok(), "a refused payload is not retried until it changes");
        let posts: Vec<_> = server.requests().into_iter().filter(|request| request.method == "POST").collect();
        assert_eq!(posts.len(), 1);
        let body = posts[0].json();
        assert_eq!((body["visibility"].as_str(), body["live"].as_bool(), body["kind"].as_str()), (Some("private"), Some(true), Some("agent")));
        assert_eq!(body["title"], "Untitled session");
        assert_eq!(body["sourceUpdatedAt"], 7);
        assert_eq!(body["deviceId"], "dev");
    }
}
