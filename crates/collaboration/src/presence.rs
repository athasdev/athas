//! Team presence while signed in to a team (`useCollaborationPresence`): a heartbeat that tells
//! teammates which file or session is in front, following a teammate's file, notifications for
//! new inbox items, and the shared document of the file in front with its update stream, its
//! realtime room, and the cursor sent over the room (REST when the room is not open).
//!
//! The workbench tells it what is in front with [`set_context_provider`] and opens files for it
//! with [`set_file_opener`]; [`CollaborationRuntime::global`] holds what the Team view and the
//! Team settings show.

use std::{
    collections::HashSet,
    io::Read,
    path::PathBuf,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use account::{AccountStore, Client, api::Collaboration};
use futures::{StreamExt, channel::mpsc};
use gpui::{App, AppContext, Context, Entity, Global, Task};
use serde_json::{Value, json};

use crate::{
    realtime::{self, DocumentSnapshot, DocumentUpdate, PresenceUpdate, RoomMessage, RoomStatus, RoomTarget, StreamEvent},
    room::{self, RoomConnection},
    sharing,
    team_view::inbox_verb,
};

const TICK: Duration = Duration::from_millis(1_500);
const PRESENCE_HEARTBEAT: Duration = Duration::from_secs(60);
const VIEWPORT_THROTTLE: Duration = Duration::from_secs(2);
const STREAM_RECONNECT: Duration = Duration::from_secs(2);

/// What is in front of the user, as the workbench sees it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActiveContext {
    /// The file of the editor in front; untitled and virtual buffers have none.
    pub file_path: Option<String>,
    /// The title of the agent session in front.
    pub session_title: Option<String>,
    /// The editor's cursor: line, column and offset.
    pub cursor: Option<(usize, usize, usize)>,
    /// The editor's scroll top, scroll left and viewport height, in whole pixels.
    pub viewport: Option<(i32, i32, i32)>,
    /// The project open here, for mapping a followed teammate's paths.
    pub project_root: Option<String>,
}

pub type ContextProvider = Rc<dyn Fn(&App) -> ActiveContext>;
pub type FileOpener = Rc<dyn Fn(PathBuf, &mut App)>;

struct Hooks {
    context: ContextProvider,
    opener: FileOpener,
}

impl Global for Hooks {}

pub fn set_context_provider(cx: &mut App, context: ContextProvider) {
    let opener = cx.try_global::<Hooks>().map_or_else(|| Rc::new(|_: PathBuf, _: &mut App| {}) as FileOpener, |hooks| hooks.opener.clone());
    cx.set_global(Hooks { context, opener });
}

pub fn set_file_opener(cx: &mut App, opener: FileOpener) {
    let context = cx.try_global::<Hooks>().map_or_else(|| Rc::new(|_: &App| ActiveContext::default()) as ContextProvider, |hooks| hooks.context.clone());
    cx.set_global(Hooks { context, opener });
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum StreamStatus {
    #[default]
    Idle,
    Connecting,
    Live,
    Reconnecting,
    Error,
}

impl StreamStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Connecting => "connecting",
            Self::Live => "live",
            Self::Reconnecting => "reconnecting",
            Self::Error => "error",
        }
    }
}

/// The shared document of the file in front (`activeDocumentStream`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DocumentStream {
    pub status: StreamStatus,
    pub path: Option<String>,
    pub document_id: Option<i64>,
    pub last_server_version: i64,
    pub updates_received: usize,
    pub cursor_updates_sent: usize,
    pub viewport_updates_sent: usize,
    pub error: Option<String>,
    pub room: Option<RoomStatus>,
}

/// A teammate's cursor in a shared document, from the stream or the room.
#[derive(Clone, Debug, PartialEq)]
pub struct RemoteCursor {
    pub client_id: String,
    pub user_id: Option<i64>,
    pub document_id: i64,
    pub path: Option<String>,
    pub line: i64,
    pub column: i64,
}

/// The cursor a document update carries (`getCursorFromUpdate`).
pub fn cursor_from_update(update: &DocumentUpdate) -> Option<RemoteCursor> {
    if update.update_type != "cursor" {
        return None;
    }
    let cursor = update.operation.get("cursor")?.as_object()?;
    Some(RemoteCursor {
        client_id: update.client_id.clone(),
        user_id: update.actor_user_id,
        document_id: update.document_id,
        path: update.operation.get("path").and_then(Value::as_str).map(str::to_string),
        line: cursor.get("line")?.as_f64()? as i64,
        column: cursor.get("column")?.as_f64()? as i64,
    })
}

/// The Notification Center banner for new inbox items while Athas is in the background.
pub fn inbox_banner(fresh: &[account::api::TeamInboxItem]) -> Option<(String, String)> {
    let first = fresh.first()?;
    let title = if fresh.len() == 1 { "Athas Team".to_string() } else { format!("{} team updates", fresh.len()) };
    Some((title, describe_inbox_item(first)))
}

/// The notification line for an inbox item (`describeInboxItem`).
pub fn describe_inbox_item(item: &account::api::TeamInboxItem) -> String {
    let place = item.session_title.as_deref().map(|title| format!(" in {title}")).unwrap_or_default();
    format!("{} {}{place}", item.actor_name, inbox_verb(item.kind))
}

/// Unread inbox items not seen before; the first look only remembers what is there.
pub fn fresh_inbox_items<'a>(seen: &mut Option<HashSet<i64>>, inbox: &'a [account::api::TeamInboxItem]) -> Vec<&'a account::api::TeamInboxItem> {
    let unread: Vec<_> = inbox.iter().filter(|item| item.read_at.is_none()).collect();
    let Some(seen) = seen.as_mut() else {
        *seen = Some(unread.iter().map(|item| item.id).collect());
        return Vec::new();
    };
    unread.into_iter().filter(|item| seen.insert(item.id)).collect()
}

/// Where the followed teammate is: the file of their freshest online presence.
pub fn followed_file(team: &Collaboration, user_id: i64) -> Option<String> {
    team.presence
        .iter()
        .filter(|entry| entry.user_id == Some(user_id) && entry.status == "online")
        .max_by(|a, b| a.heartbeat_at.cmp(&b.heartbeat_at))
        .and_then(|entry| entry.active_file_path.clone())
}

enum StreamMessage {
    Registered(Option<Collaboration>, Option<DocumentSnapshot>),
    Event(StreamEvent),
    Reconnecting,
    Failed(String),
    Room(RoomStatus),
    RemotePresence(DocumentUpdate),
    RemoteLeft(String),
}

/// A running document stream, stopped when dropped.
struct StreamHandle {
    path: String,
    cancelled: Arc<AtomicBool>,
    room: Option<RoomConnection>,
    _pump: Task<()>,
}

impl Drop for StreamHandle {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }
}

pub struct CollaborationRuntime {
    pub following_user_id: Option<i64>,
    pub stream: DocumentStream,
    pub remote_cursors: Vec<RemoteCursor>,
    last_presence: Option<(PresenceUpdate, Instant)>,
    presence_online: bool,
    /// The session the last online heartbeat used, to say `offline` with once it is gone.
    online_as: Option<(Client, String)>,
    seen_inbox: Option<HashSet<i64>>,
    last_opened: Option<String>,
    last_cursor_key: Option<String>,
    /// The last viewport sent, and a changed one waiting out the throttle since when.
    last_viewport_key: Option<String>,
    pending_viewport: Option<(String, Instant)>,
    handle: Option<StreamHandle>,
    client_seq: Arc<AtomicU64>,
    _tick: Task<()>,
}

struct GlobalRuntime(Entity<CollaborationRuntime>);

impl Global for GlobalRuntime {}

/// The account session presence needs: the client, the token, and the team when it has one.
fn session(cx: &App) -> Option<(Client, String, Collaboration)> {
    let store = AccountStore::global(cx)?;
    let store = store.read(cx);
    let team = store.subscription()?.team()?.clone();
    Some((store.client().clone(), store.token()?.to_string(), team))
}

fn presence_enabled(team: &Collaboration) -> bool {
    team.settings
        .as_ref()
        .and_then(|settings| settings.get("sharedSettings"))
        .and_then(|shared| shared.get("presenceEnabled"))
        .and_then(Value::as_bool)
        != Some(false)
}

impl CollaborationRuntime {
    /// Starts presence for the app; call once after the account store exists.
    pub fn init(cx: &mut App) -> Entity<Self> {
        if let Some(runtime) = Self::global(cx) {
            return runtime;
        }
        let runtime = cx.new(|cx| Self {
            following_user_id: None,
            stream: DocumentStream::default(),
            remote_cursors: Vec::new(),
            last_presence: None,
            presence_online: false,
            online_as: None,
            seen_inbox: None,
            last_opened: None,
            last_cursor_key: None,
            last_viewport_key: None,
            pending_viewport: None,
            handle: None,
            client_seq: Arc::new(AtomicU64::new(0)),
            _tick: cx.spawn(async move |this: gpui::WeakEntity<CollaborationRuntime>, cx: &mut gpui::AsyncApp| {
                loop {
                    cx.background_executor().timer(TICK).await;
                    if this.update(cx, |this, cx| this.tick(cx)).is_err() {
                        break;
                    }
                }
            }),
        });
        cx.set_global(GlobalRuntime(runtime.clone()));
        runtime
    }

    pub fn global(cx: &App) -> Option<Entity<Self>> {
        cx.try_global::<GlobalRuntime>().map(|global| global.0.clone())
    }

    /// Follows a teammate's file, or stops with `None`.
    pub fn set_following(&mut self, user_id: Option<i64>, cx: &mut Context<Self>) {
        self.following_user_id = user_id;
        self.last_opened = None;
        self.last_presence = None;
        cx.notify();
    }

    fn tick(&mut self, cx: &mut Context<Self>) {
        let Some((client, token, team)) = session(cx) else {
            self.stop(cx);
            return;
        };
        let context = cx.try_global::<Hooks>().map(|hooks| (hooks.context)(cx)).unwrap_or_default();
        self.notify_inbox(&team, cx);
        if presence_enabled(&team) {
            self.heartbeat(&client, &token, &context, cx);
        } else {
            // Turned off (by an admin): say offline once, so the last file shown goes away.
            self.go_offline(cx);
        }
        self.follow(&team, &context, cx);
        if team.capabilities.realtime_documents {
            self.sync_stream(&client, &token, &context, cx);
            self.publish_cursor(&client, &token, &context, cx);
            self.publish_viewport(&client, &token, &context, cx);
        } else if self.handle.take().is_some() {
            self.stream = DocumentStream::default();
            cx.notify();
        }
    }

    /// Signed out or left the team: say goodbye once and drop the stream.
    fn go_offline(&mut self, cx: &mut Context<Self>) {
        if let Some((client, token)) = self.online_as.take() {
            let update = PresenceUpdate { online: false, active_file_path: None, following_user_id: None, cursor_label: None };
            cx.background_spawn(async move { realtime::update_presence(&client, &token, &sharing::device_id(), &update).ok() }).detach();
        }
        self.last_presence = None;
        self.presence_online = false;
    }

    fn stop(&mut self, cx: &mut Context<Self>) {
        self.go_offline(cx);
        self.handle = None;
        self.last_presence = None;
        self.seen_inbox = None;
        self.presence_online = false;
        if self.stream != DocumentStream::default() {
            self.stream = DocumentStream::default();
            self.remote_cursors.clear();
            cx.notify();
        }
    }

    fn heartbeat(&mut self, client: &Client, token: &str, context: &ActiveContext, cx: &mut Context<Self>) {
        let update = PresenceUpdate {
            online: true,
            active_file_path: context.file_path.clone(),
            following_user_id: self.following_user_id,
            cursor_label: context.session_title.clone(),
        };
        let due = match &self.last_presence {
            Some((last, at)) => *last != update || at.elapsed() >= PRESENCE_HEARTBEAT,
            None => true,
        };
        if !due {
            return;
        }
        self.last_presence = Some((update.clone(), Instant::now()));
        self.presence_online = true;
        self.online_as = Some((client.clone(), token.to_string()));
        let (client, token) = (client.clone(), token.to_string());
        let task = cx.background_spawn(async move { realtime::update_presence(&client, &token, &sharing::device_id(), &update) });
        cx.spawn(async move |_, cx| {
            if let Ok(Some(team)) = task.await {
                cx.update(|cx| apply_snapshot(team, cx));
            }
        })
        .detach();
    }

    fn notify_inbox(&mut self, team: &Collaboration, cx: &mut Context<Self>) {
        let fresh: Vec<_> = fresh_inbox_items(&mut self.seen_inbox, &team.inbox).into_iter().cloned().collect();
        if let Some((title, body)) = inbox_banner(&fresh)
            && cx.active_window().is_none()
        {
            notifications::send_os_notification(cx, &title, &body);
        }
        for item in fresh {
            let body = (!item.body.is_empty()).then(|| item.body.clone().into());
            notifications::notify(
                cx,
                notifications::NotificationKind::Info,
                notifications::NotificationCategory::Athas,
                describe_inbox_item(&item),
                body,
                Some(format!("team-inbox-{}", item.id).into()),
            );
        }
    }

    fn follow(&mut self, team: &Collaboration, context: &ActiveContext, cx: &mut Context<Self>) {
        let Some(user_id) = self.following_user_id else { return };
        let (Some(theirs), Some(root)) = (followed_file(team, user_id), context.project_root.as_deref()) else { return };
        let Some(path) = realtime::map_teammate_path(&theirs, root) else { return };
        if self.last_opened.as_deref() == Some(path.as_str()) || !std::path::Path::new(&path).exists() {
            return;
        }
        self.last_opened = Some(path.clone());
        if let Some(opener) = cx.try_global::<Hooks>().map(|hooks| hooks.opener.clone()) {
            opener(PathBuf::from(path), cx);
        }
    }

    fn sync_stream(&mut self, client: &Client, token: &str, context: &ActiveContext, cx: &mut Context<Self>) {
        let Some(path) = context.file_path.clone() else {
            if self.handle.take().is_some() {
                self.stream = DocumentStream::default();
                self.remote_cursors.clear();
                cx.notify();
            }
            return;
        };
        if self.handle.as_ref().is_some_and(|handle| handle.path == path) {
            return;
        }
        self.handle = None;
        self.remote_cursors.clear();
        self.last_cursor_key = None;
        self.stream = DocumentStream { status: StreamStatus::Connecting, path: Some(path.clone()), ..Default::default() };
        cx.notify();
        let cancelled = Arc::new(AtomicBool::new(false));
        let (sender, mut receiver) = mpsc::unbounded();
        spawn_stream(client.clone(), token.to_string(), path.clone(), cancelled.clone(), sender);
        let pump = cx.spawn(async move |this, cx| {
            while let Some(message) = receiver.next().await {
                if this.update(cx, |this, cx| this.on_stream(message, cx)).is_err() {
                    break;
                }
            }
        });
        self.handle = Some(StreamHandle { path, cancelled, room: None, _pump: pump });
    }

    fn on_stream(&mut self, message: StreamMessage, cx: &mut Context<Self>) {
        let local = sharing::device_id();
        match message {
            StreamMessage::Registered(team, document) => {
                if let Some(team) = team {
                    apply_snapshot(team, cx);
                }
                match document {
                    Some(document) => {
                        self.stream.document_id = Some(document.id);
                        self.stream.last_server_version = document.base_version;
                        self.open_room(document.id, cx);
                    }
                    None => {
                        self.stream.status = StreamStatus::Error;
                        self.stream.error = Some("Registered collaboration document was not returned by the account service.".into());
                    }
                }
            }
            StreamMessage::Event(StreamEvent::Ready { document, after_server_version }) => {
                self.stream.status = StreamStatus::Live;
                self.stream.document_id = Some(document.id);
                self.stream.last_server_version = self.stream.last_server_version.max(after_server_version).max(document.base_version);
                self.stream.error = None;
            }
            StreamMessage::Event(StreamEvent::Heartbeat { after_server_version, .. }) => {
                self.stream.last_server_version = self.stream.last_server_version.max(after_server_version);
            }
            StreamMessage::Event(StreamEvent::Update { update, .. }) => {
                self.stream.last_server_version = self.stream.last_server_version.max(update.server_version);
                self.stream.updates_received += 1;
                self.record_remote(update, &local);
            }
            StreamMessage::Event(StreamEvent::Error(error)) | StreamMessage::Failed(error) => {
                self.stream.status = StreamStatus::Error;
                self.stream.error = Some(error);
            }
            StreamMessage::Reconnecting => self.stream.status = StreamStatus::Reconnecting,
            StreamMessage::Room(status) => self.stream.room = Some(status),
            StreamMessage::RemotePresence(update) => self.record_remote(update, &local),
            StreamMessage::RemoteLeft(client_id) => self.remote_cursors.retain(|cursor| cursor.client_id != client_id),
        }
        cx.notify();
    }

    fn record_remote(&mut self, update: DocumentUpdate, local: &str) {
        if update.client_id == local {
            return;
        }
        if let Some(cursor) = cursor_from_update(&update) {
            self.remote_cursors.retain(|existing| existing.client_id != cursor.client_id);
            self.remote_cursors.push(cursor);
        }
    }

    fn open_room(&mut self, document_id: i64, cx: &mut Context<Self>) {
        let Some((client, token, _)) = session(cx) else { return };
        let Some(handle) = self.handle.as_mut() else { return };
        let (sender, mut receiver) = mpsc::unbounded();
        let device = sharing::device_id();
        let tickets: room::TicketSource = Arc::new(move || {
            realtime::request_room_ticket(&client, &token, &RoomTarget::Document(document_id), &device, realtime::now_ms()).map_err(|error| error.to_string())
        });
        let (messages, statuses) = (sender.clone(), sender);
        handle.room = Some(room::connect(
            tickets,
            move |message| {
                let forwarded = match message {
                    RoomMessage::Presence { from, data } => remote_update(document_id, &from, &data).map(StreamMessage::RemotePresence),
                    RoomMessage::Leave(member) => member.device_id.map(StreamMessage::RemoteLeft),
                    _ => None,
                };
                if let Some(message) = forwarded {
                    messages.unbounded_send(message).ok();
                }
            },
            move |status| {
                statuses.unbounded_send(StreamMessage::Room(status)).ok();
            },
        ));
        let pump = cx.spawn(async move |this, cx| {
            while let Some(message) = receiver.next().await {
                if this.update(cx, |this, cx| this.on_stream(message, cx)).is_err() {
                    break;
                }
            }
        });
        pump.detach();
    }

    /// Sends the cursor when it moved: over the room when open, otherwise as a document update.
    fn publish_cursor(&mut self, client: &Client, token: &str, context: &ActiveContext, cx: &mut Context<Self>) {
        let (Some(path), Some((line, column, offset)), Some(document_id)) = (context.file_path.clone(), context.cursor, self.stream.document_id) else { return };
        if self.stream.status != StreamStatus::Live {
            return;
        }
        let key = format!("{path}:{document_id}:{line}:{column}");
        if self.last_cursor_key.as_deref() == Some(key.as_str()) {
            return;
        }
        self.last_cursor_key = Some(key);
        let operation = json!({
            "source": "desktop-cursor",
            "path": path,
            "cursor": { "line": line, "column": column, "offset": offset },
            "selection": Value::Null,
            "followingUserId": self.following_user_id,
        });
        let room = self.handle.as_ref().and_then(|handle| handle.room.as_ref());
        if room.is_some_and(|room| room.is_open() && room.send(&json!({ "type": "presence", "data": { "updateType": "cursor", "operation": operation } }), false)) {
            self.stream.cursor_updates_sent += 1;
            cx.notify();
            return;
        }
        let (client, token) = (client.clone(), token.to_string());
        let seq = self.client_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let task = cx.background_spawn(async move { realtime::append_document_update(&client, &token, document_id, &sharing::device_id(), seq, "cursor", &operation) });
        cx.spawn(async move |this, cx| {
            if let Ok(team) = task.await {
                cx.update(|cx| {
                    if let Some(team) = team {
                        apply_snapshot(team, cx);
                    }
                });
                this.update(cx, |this, cx| {
                    this.stream.cursor_updates_sent += 1;
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    /// A `metadata` update with the scroll position, once it has held still for 2 s.
    fn publish_viewport(&mut self, client: &Client, token: &str, context: &ActiveContext, cx: &mut Context<Self>) {
        let (Some(path), Some((scroll_top, scroll_left, height)), Some(document_id)) = (context.file_path.clone(), context.viewport, self.stream.document_id) else {
            return;
        };
        if self.stream.status != StreamStatus::Live {
            return;
        }
        let key = viewport_key(&path, document_id, scroll_top, scroll_left, height);
        if self.last_viewport_key.as_deref() == Some(key.as_str()) {
            self.pending_viewport = None;
            return;
        }
        match &self.pending_viewport {
            Some((pending, since)) if *pending == key => {
                if since.elapsed() < VIEWPORT_THROTTLE {
                    return;
                }
            }
            _ => {
                self.pending_viewport = Some((key, Instant::now()));
                return;
            }
        }
        self.pending_viewport = None;
        self.last_viewport_key = Some(key);
        let operation = json!({
            "source": "desktop-viewport",
            "path": path,
            "viewport": { "scrollTop": scroll_top, "scrollLeft": scroll_left, "viewportHeight": height },
            "followingUserId": self.following_user_id,
        });
        let room = self.handle.as_ref().and_then(|handle| handle.room.as_ref());
        if room.is_some_and(|room| room.is_open() && room.send(&json!({ "type": "presence", "data": { "updateType": "metadata", "operation": operation } }), false)) {
            self.stream.viewport_updates_sent += 1;
            cx.notify();
            return;
        }
        let (client, token) = (client.clone(), token.to_string());
        let seq = self.client_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let task = cx.background_spawn(async move { realtime::append_document_update(&client, &token, document_id, &sharing::device_id(), seq, "metadata", &operation) });
        cx.spawn(async move |this, cx| {
            if let Ok(team) = task.await {
                cx.update(|cx| {
                    if let Some(team) = team {
                        apply_snapshot(team, cx);
                    }
                });
                this.update(cx, |this, cx| {
                    this.stream.viewport_updates_sent += 1;
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }
}

/// What makes two viewport updates the same, rounded to whole pixels.
pub fn viewport_key(path: &str, document_id: i64, scroll_top: i32, scroll_left: i32, height: i32) -> String {
    format!("{path}:{document_id}:{scroll_top}:{scroll_left}:{height}")
}

/// A relayed cursor, shaped like a stored document update (`toRemoteDocumentUpdate`).
pub fn remote_update(document_id: i64, from: &realtime::RoomMember, data: &serde_json::Map<String, Value>) -> Option<DocumentUpdate> {
    let update_type = data.get("updateType")?.as_str()?;
    if update_type != "cursor" && update_type != "metadata" {
        return None;
    }
    let operation = data.get("operation")?.as_object()?.clone();
    Some(DocumentUpdate {
        document_id,
        actor_user_id: Some(from.user_id),
        client_id: from.device_id.clone()?,
        update_type: update_type.to_string(),
        operation,
        ..Default::default()
    })
}

fn apply_snapshot(team: Collaboration, cx: &mut App) {
    if let Some(store) = AccountStore::global(cx) {
        store.update(cx, |store, cx| store.set_collaboration_snapshot(team, cx));
    }
}

/// Registers the document and follows its update stream on a thread, reconnecting after a pause
/// until cancelled.
fn spawn_stream(client: Client, token: String, path: String, cancelled: Arc<AtomicBool>, sender: mpsc::UnboundedSender<StreamMessage>) {
    std::thread::Builder::new()
        .name("athas-collaboration-stream".into())
        .spawn(move || {
            let team = match realtime::register_document(&client, &token, &path) {
                Ok(team) => team,
                Err(error) => {
                    sender.unbounded_send(StreamMessage::Failed(error.to_string())).ok();
                    return;
                }
            };
            let document = team.as_ref().and_then(|team| document_for(team, &path));
            sender.unbounded_send(StreamMessage::Registered(team, document.clone())).ok();
            let Some(document) = document else { return };
            let http = reqwest::blocking::Client::builder().timeout(None).build().unwrap_or_default();
            let mut after = document.base_version;
            // Failures in a row: the wait before reconnecting grows (to 30 s) instead of hitting
            // the server every 2 s while it is down.
            let mut attempt: u32 = 0;
            while !cancelled.load(Ordering::Relaxed) {
                let url = format!("{}/api/collaboration/documents/{}/events?afterVersion={after}&limit=100", client.urls().api_base, document.id);
                let response = http.get(url).header("Authorization", format!("Bearer {token}")).header("Accept", "text/event-stream").send();
                match response {
                    Ok(mut response) if response.status().is_success() => {
                        attempt = 0;
                        let mut buffer = String::new();
                        let mut chunk = [0u8; 4096];
                        while !cancelled.load(Ordering::Relaxed) {
                            let read = match response.read(&mut chunk) {
                                Ok(0) | Err(_) => break,
                                Ok(read) => read,
                            };
                            buffer.push_str(&String::from_utf8_lossy(&chunk[..read]));
                            for event in realtime::drain_stream_blocks(&mut buffer) {
                                match &event {
                                    StreamEvent::Ready { after_server_version, .. } | StreamEvent::Heartbeat { after_server_version, .. } => {
                                        after = after.max(*after_server_version)
                                    }
                                    StreamEvent::Update { update, .. } => after = after.max(update.server_version),
                                    StreamEvent::Error(_) => {}
                                }
                                sender.unbounded_send(StreamMessage::Event(event)).ok();
                            }
                        }
                    }
                    Ok(response) => {
                        sender.unbounded_send(StreamMessage::Failed(format!("Failed to stream collaboration document updates: {}", response.status().as_u16()))).ok();
                        return;
                    }
                    Err(_) => {}
                }
                if cancelled.load(Ordering::Relaxed) {
                    return;
                }
                sender.unbounded_send(StreamMessage::Reconnecting).ok();
                attempt = attempt.saturating_add(1);
                let jitter = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.5, |elapsed| f64::from(elapsed.subsec_nanos() % 1000) / 1000.0);
                std::thread::sleep(realtime::reconnect_delay(attempt, jitter).max(STREAM_RECONNECT));
            }
        })
        .ok();
}

fn document_for(team: &Collaboration, path: &str) -> Option<DocumentSnapshot> {
    team.documents.iter().find(|document| document.path == path).map(|document| DocumentSnapshot {
        id: document.id,
        path: document.path.clone(),
        base_version: document.base_version,
        updated_at: document.updated_at.clone(),
    })
}

#[cfg(test)]
mod tests {
    use account::api::{InboxKind, TeamInboxItem, TeamPresence};

    use super::*;

    #[test]
    fn inbox_notifies_only_items_that_arrive_later() {
        let item = |id, read: bool| TeamInboxItem {
            id,
            kind: InboxKind::Mention,
            actor_name: "Ada".into(),
            session_title: Some("Fix login".into()),
            read_at: read.then(|| "2026-11-12T00:00:00Z".into()),
            ..Default::default()
        };
        let mut seen = None;
        assert!(fresh_inbox_items(&mut seen, &[item(1, false), item(2, true)]).is_empty());
        let second = [item(1, false), item(3, false), item(4, true)];
        let fresh = fresh_inbox_items(&mut seen, &second);
        assert_eq!(fresh.iter().map(|item| item.id).collect::<Vec<_>>(), vec![3]);
        assert!(fresh_inbox_items(&mut seen, &[item(3, false)]).is_empty());
        assert_eq!(describe_inbox_item(&item(3, false)), "Ada mentioned you in Fix login");
        assert_eq!(inbox_banner(&[]), None);
        assert_eq!(viewport_key("/a.rs", 3, 120, 0, 600), "/a.rs:3:120:0:600");
        assert_ne!(viewport_key("/a.rs", 3, 120, 0, 600), viewport_key("/a.rs", 3, 140, 0, 600));
        assert_eq!(inbox_banner(&[item(3, false)]), Some(("Athas Team".into(), "Ada mentioned you in Fix login".into())));
        assert_eq!(inbox_banner(&[item(3, false), item(4, false)]).unwrap().0, "2 team updates");
        assert_eq!(describe_inbox_item(&TeamInboxItem { kind: InboxKind::Handoff, actor_name: "Sam".into(), ..Default::default() }), "Sam handed you a session");
    }

    #[test]
    fn following_uses_the_freshest_online_presence() {
        let presence = |id, status: &str, at: &str, path: &str| TeamPresence {
            id,
            user_id: Some(2),
            status: status.into(),
            heartbeat_at: Some(at.into()),
            active_file_path: Some(path.into()),
            ..Default::default()
        };
        let team = Collaboration {
            presence: vec![
                presence(1, "online", "2026-11-12T10:00:00Z", "/a.rs"),
                presence(2, "online", "2026-11-12T10:05:00Z", "/b.rs"),
                presence(3, "offline", "2026-11-12T10:09:00Z", "/c.rs"),
            ],
            ..Default::default()
        };
        assert_eq!(followed_file(&team, 2).as_deref(), Some("/b.rs"));
        assert_eq!(followed_file(&team, 3), None);
    }

    #[test]
    fn relayed_cursors_become_remote_cursors() {
        let from = realtime::RoomMember { connection_id: "c".into(), user_id: 2, name: None, device_id: Some("d2".into()) };
        let data = serde_json::from_value(json!({ "updateType": "cursor", "operation": { "path": "/a.rs", "cursor": { "line": 4, "column": 2, "offset": 40 } } })).unwrap();
        let update = remote_update(7, &from, &data).unwrap();
        let cursor = cursor_from_update(&update).unwrap();
        assert_eq!((cursor.line, cursor.column, cursor.document_id), (4, 2, 7));
        assert_eq!(cursor.path.as_deref(), Some("/a.rs"));
        let no_device = realtime::RoomMember { device_id: None, ..from };
        assert!(remote_update(7, &no_device, &data).is_none());
    }
}
