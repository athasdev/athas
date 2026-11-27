//! Driving a session that runs on another of your own machines. Session sync already publishes
//! every session as a private cloud session (`live_share`); this opens that snapshot's realtime
//! room from both ends, so the machine the agent runs on takes prompts from the machine you are
//! sitting at.
//!
//! The host joins the rooms of the sessions it syncs and answers `session.prompt`,
//! `session.stop` and `session.hello` by driving the live session and sending back
//! `session.state`. The viewer ([`crate::devices`]) joins the same room, sends those commands and
//! reads the conversation from the snapshot. Nothing but the command crosses the room: the agent,
//! its tools and the project stay on the host.
//!
//! Only this account's devices can hold a ticket for a private snapshot's room, and a host
//! ignores commands from its own device id. A device that would rather not be driven turns the
//! switch off in Settings → Account → Sharing ([`set_allowed`]); the setting stays on this
//! machine.

use std::{collections::HashMap, rc::Rc, sync::Arc};

use account::AccountStore;
use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{App, Global, Task};
use serde_json::{Map, Value, json};

use crate::{
    live_share::SessionSource,
    realtime::{self, RoomMember, RoomMessage, RoomTarget},
    room::{self, RoomConnection, TicketSource},
    sharing::{self, ShareOptions},
};

/// The viewer asks the host to send this text as a prompt.
pub const PROMPT: &str = "session.prompt";
/// The viewer asks the host to stop the turn in flight.
pub const STOP: &str = "session.stop";
/// The viewer asks how the session is doing, on joining the room.
pub const HELLO: &str = "session.hello";
/// The host's answer, and what it sends again whenever the session moves.
pub const STATE: &str = "session.state";

/// Room messages are capped at 16 KB; a prompt well under that leaves room for the envelope.
pub const MAX_PROMPT_CHARS: usize = 8_000;
/// How many of this device's sessions keep a room open. The sessions worked on most recently
/// win; the rest look offline to the other device until they are used again.
pub const MAX_HOSTED_ROOMS: usize = 8;

/// The setting that lets this device be driven from another; it stays on this machine (it is not
/// in `SYNCABLE_KEYS`).
const ALLOW_KEY: &str = "remoteSessionControl";

/// What a viewer asks the host to do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    Prompt(String),
    Stop,
    Hello,
}

/// How a session on the host is doing, as the host reports it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionState {
    /// The session is open on the host, so it can be driven.
    pub open: bool,
    /// A turn is in flight.
    pub running: bool,
    /// Prompts waiting behind the turn in flight.
    pub queued: usize,
    /// Why the last command was not taken.
    pub error: Option<String>,
}

impl SessionState {
    pub fn closed(error: impl Into<String>) -> Self {
        Self { error: Some(error.into()), ..Default::default() }
    }
}

/// Reads a command a viewer sent; `None` for anything else on the room.
pub fn parse_command(name: &str, data: &Map<String, Value>) -> Option<Command> {
    match name {
        PROMPT => {
            let text = data.get("text")?.as_str()?.trim();
            (!text.is_empty()).then(|| Command::Prompt(text.chars().take(MAX_PROMPT_CHARS).collect()))
        }
        STOP => Some(Command::Stop),
        HELLO => Some(Command::Hello),
        _ => None,
    }
}

/// The room message a viewer sends.
pub fn command_message(command: &Command) -> Value {
    match command {
        Command::Prompt(text) => {
            json!({ "type": "event", "name": PROMPT, "data": { "text": text.chars().take(MAX_PROMPT_CHARS).collect::<String>() } })
        }
        Command::Stop => json!({ "type": "event", "name": STOP, "data": {} }),
        Command::Hello => json!({ "type": "event", "name": HELLO, "data": {} }),
    }
}

/// The room message a host answers with.
pub fn state_message(state: &SessionState) -> Value {
    json!({
        "type": "event",
        "name": STATE,
        "data": { "open": state.open, "running": state.running, "queued": state.queued, "error": state.error },
    })
}

pub fn parse_state(data: &Map<String, Value>) -> SessionState {
    SessionState {
        open: data.get("open").and_then(Value::as_bool).unwrap_or_default(),
        running: data.get("running").and_then(Value::as_bool).unwrap_or_default(),
        queued: data.get("queued").and_then(Value::as_u64).unwrap_or_default() as usize,
        error: data.get("error").and_then(Value::as_str).filter(|error| !error.is_empty()).map(str::to_string),
    }
}

/// Carries out a command on the session with this id, and says how the session is doing. The
/// workbench installs one with [`set_handler`]; it drives the live `agent_ui` session.
pub type Handler = Rc<dyn Fn(&str, Command, &mut App) -> SessionState>;

struct Hosted {
    session_id: String,
    room: Rc<RoomConnection>,
    _pump: Task<()>,
}

/// The rooms this device keeps open for the sessions it syncs.
#[derive(Default)]
pub struct RemoteControl {
    handler: Option<Handler>,
    hosted: HashMap<String, Hosted>,
}

impl Global for RemoteControl {}

/// Whether this device takes commands from your other devices (on unless turned off).
pub fn allowed(cx: &App) -> bool {
    if cx.try_global::<settings::SettingsStore>().is_none() {
        return false;
    }
    settings::get(cx).extra.get(ALLOW_KEY).and_then(Value::as_bool).unwrap_or(true)
}

pub fn set_allowed(allow: bool, cx: &mut App) {
    settings::update(cx, move |settings| {
        settings.extra.insert(ALLOW_KEY.into(), Value::Bool(allow));
    });
}

/// Installs what carries out the commands; without one nothing is hosted.
pub fn set_handler(handler: Handler, cx: &mut App) {
    cx.default_global::<RemoteControl>().handler = Some(handler);
}

/// The share ids this device is listening on, for the tests and the settings page.
pub fn hosted_shares(cx: &App) -> Vec<String> {
    cx.try_global::<RemoteControl>().map(|control| control.hosted.keys().cloned().collect()).unwrap_or_default()
}

/// The shares of `sessions` this device should listen on: its own live private session
/// snapshots, the most recently used first, capped at [`MAX_HOSTED_ROOMS`].
pub fn shares_to_host(options: &ShareOptions, sessions: &[SessionSource], device_id: &str) -> Vec<(String, String)> {
    let mut hosted: Vec<(String, String, i64)> = options
        .items
        .iter()
        .filter(|item| item.is_synced_session() && item.device_id.as_deref() == Some(device_id))
        .filter_map(|item| {
            let source = item.source_id.as_deref()?;
            let session = sessions.iter().find(|session| session.id == source)?;
            Some((item.id.clone(), source.to_string(), session.updated_at))
        })
        .collect();
    hosted.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    hosted.truncate(MAX_HOSTED_ROOMS);
    hosted.into_iter().map(|(share, session, _)| (share, session)).collect()
}

/// A ticket source for a session snapshot's room, for either end.
pub fn ticket_source(share_id: &str, cx: &App) -> Option<TicketSource> {
    let store = AccountStore::global(cx)?;
    let store = store.read(cx);
    let (client, token) = (store.client().clone(), store.token()?.to_string());
    let (share_id, device) = (share_id.to_string(), sharing::device_id());
    Some(Arc::new(move || {
        realtime::request_room_ticket(&client, &token, &RoomTarget::Share(share_id.clone()), &device, realtime::now_ms()).map_err(|error| error.to_string())
    }))
}

/// Opens and closes the host's rooms to match what this device syncs; the sync loop calls this
/// after every pass.
pub fn sync(options: &ShareOptions, sessions: &[SessionSource], cx: &mut App) {
    let hosting = (allowed(cx) && options.sessions_enabled).then(|| shares_to_host(options, sessions, &sharing::device_id())).unwrap_or_default();
    let wanted: HashMap<String, String> = hosting.into_iter().collect();
    let drop_these: Vec<String> = cx
        .try_global::<RemoteControl>()
        .map(|control| control.hosted.keys().filter(|share| !wanted.contains_key(*share)).cloned().collect())
        .unwrap_or_default();
    if !drop_these.is_empty() {
        let control = cx.default_global::<RemoteControl>();
        for share in drop_these {
            control.hosted.remove(&share);
        }
    }
    let open_these: Vec<(String, String)> = wanted
        .into_iter()
        .filter(|(share, _)| !cx.try_global::<RemoteControl>().is_some_and(|control| control.hosted.contains_key(share)))
        .collect();
    for (share, session) in open_these {
        host_room(share, session, cx);
    }
}

/// Tells the other device how a session is doing now, so it does not wait for its next poll.
pub fn announce(session_id: &str, state: SessionState, cx: &mut App) {
    let Some(control) = cx.try_global::<RemoteControl>() else { return };
    let Some(hosted) = control.hosted.values().find(|hosted| hosted.session_id == session_id) else { return };
    hosted.room.send(&state_message(&state), false);
}

/// Everything this device hosts stops; sign-out and turning the switch off both land here.
pub fn stop_hosting(cx: &mut App) {
    if cx.has_global::<RemoteControl>() {
        cx.global_mut::<RemoteControl>().hosted.clear();
    }
}

fn host_room(share_id: String, session_id: String, cx: &mut App) {
    let Some(tickets) = ticket_source(&share_id, cx) else { return };
    let (sender, mut receiver) = mpsc::unbounded();
    let device = sharing::device_id();
    let room = Rc::new(room::connect(
        tickets,
        move |message| {
            if let RoomMessage::Event { from, name, data } = message
                && !is_me(&from, &device)
                && let Some(command) = parse_command(&name, &data)
            {
                sender.unbounded_send(command).ok();
            }
        },
        |_| {},
    ));
    let answering = room.clone();
    let session = session_id.clone();
    let pump = cx.spawn(async move |cx| {
        while let Some(command) = receiver.next().await {
            let session = session.clone();
            let state = cx.update(|cx| {
                let handler = cx.try_global::<RemoteControl>().and_then(|control| control.handler.clone());
                match handler {
                    Some(handler) if allowed(cx) => handler(&session, command, cx),
                    Some(_) => SessionState::closed("This device does not take prompts from your other devices."),
                    None => SessionState::closed("This device cannot run sessions."),
                }
            });
            answering.send(&state_message(&state), true);
        }
    });
    cx.default_global::<RemoteControl>().hosted.insert(share_id, Hosted { session_id, room, _pump: pump });
}

/// A room member that is this very device, whose own events are not commands.
fn is_me(member: &RoomMember, device_id: &str) -> bool {
    member.device_id.as_deref() == Some(device_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sharing::{ShareKind, SharedItem, Visibility};

    fn synced(id: &str, source: &str, device: &str) -> SharedItem {
        SharedItem {
            id: id.into(),
            kind: ShareKind::Agent,
            live: true,
            visibility: Visibility::Private,
            source_id: Some(source.into()),
            device_id: Some(device.into()),
            ..Default::default()
        }
    }

    fn session(id: &str, updated_at: i64) -> SessionSource {
        SessionSource { id: id.into(), title: id.into(), updated_at }
    }

    #[test]
    fn commands_survive_the_round_trip_and_junk_is_ignored() {
        let message = command_message(&Command::Prompt("Fix the build".into()));
        assert_eq!(message["name"], PROMPT);
        let data = message["data"].as_object().unwrap().clone();
        assert_eq!(parse_command(PROMPT, &data), Some(Command::Prompt("Fix the build".into())));
        let padded = Map::from_iter([("text".to_string(), json!("  Fix the build  "))]);
        assert_eq!(parse_command(PROMPT, &padded), Some(Command::Prompt("Fix the build".into())), "a prompt arrives trimmed");
        assert_eq!(parse_command(STOP, &Map::new()), Some(Command::Stop));
        assert_eq!(parse_command(HELLO, &Map::new()), Some(Command::Hello));
        assert_eq!(parse_command(PROMPT, &Map::from_iter([("text".to_string(), json!("   "))])), None);
        assert_eq!(parse_command(PROMPT, &Map::new()), None);
        assert_eq!(parse_command("session.other", &Map::new()), None);
    }

    #[test]
    fn a_prompt_is_cut_to_what_a_room_message_holds() {
        let long = "x".repeat(MAX_PROMPT_CHARS + 500);
        let message = command_message(&Command::Prompt(long));
        assert_eq!(message["data"]["text"].as_str().unwrap().len(), MAX_PROMPT_CHARS);
    }

    #[test]
    fn state_survives_the_round_trip() {
        let state = SessionState { open: true, running: true, queued: 2, error: None };
        assert_eq!(parse_state(state_message(&state)["data"].as_object().unwrap()), state);
        let refused = SessionState::closed("Not open here");
        assert_eq!(parse_state(state_message(&refused)["data"].as_object().unwrap()), refused);
        assert_eq!(parse_state(&Map::new()), SessionState::default());
    }

    #[test]
    fn only_this_devices_live_sessions_are_hosted_newest_first() {
        let options = ShareOptions {
            sessions_enabled: true,
            items: vec![
                synced("a", "chat-1", "mine"),
                synced("b", "chat-2", "mine"),
                // Another device's copy, a session that is not open here, and a team share.
                synced("c", "chat-3", "theirs"),
                synced("d", "chat-gone", "mine"),
                SharedItem { visibility: Visibility::Organization, ..synced("e", "chat-1", "mine") },
            ],
            ..Default::default()
        };
        let sessions = vec![session("chat-1", 10), session("chat-2", 20), session("chat-3", 30)];
        assert_eq!(shares_to_host(&options, &sessions, "mine"), vec![("b".into(), "chat-2".into()), ("a".into(), "chat-1".into())]);
    }

    #[test]
    fn no_more_rooms_than_the_cap() {
        let items: Vec<SharedItem> = (0..MAX_HOSTED_ROOMS + 4).map(|index| synced(&format!("s{index}"), &format!("chat-{index}"), "mine")).collect();
        let sessions: Vec<SessionSource> = (0..MAX_HOSTED_ROOMS + 4).map(|index| session(&format!("chat-{index}"), index as i64)).collect();
        let options = ShareOptions { sessions_enabled: true, items, ..Default::default() };
        let hosted = shares_to_host(&options, &sessions, "mine");
        assert_eq!(hosted.len(), MAX_HOSTED_ROOMS);
        assert_eq!(hosted[0].1, format!("chat-{}", MAX_HOSTED_ROOMS + 3), "the session used last keeps its room");
    }

    #[test]
    fn this_devices_own_events_are_not_commands() {
        let me = RoomMember { connection_id: "c".into(), user_id: 1, name: None, device_id: Some("mine".into()) };
        assert!(is_me(&me, "mine"));
        assert!(!is_me(&RoomMember { device_id: Some("theirs".into()), ..me.clone() }, "mine"));
        assert!(!is_me(&RoomMember { device_id: None, ..me }, "mine"));
    }
}
