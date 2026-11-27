//! Your other machines, in the centre: the sessions this account syncs from each of them, and
//! one of those sessions opened for driving.
//!
//! The conversation comes from the session's cloud snapshot (REST, refreshed on a timer); the
//! prompt goes the other way over the snapshot's realtime room, which the machine running the
//! agent is listening on ([`crate::remote_control`]). The agent, its tools and the project never
//! leave that machine — only the prompt travels.

use std::{collections::HashSet, rc::Rc, time::Duration};

use account::widgets;
use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{
    AnyElement, App, Context, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ParentElement, Render, SharedString, Styled,
    Subscription, Task, Window, div, prelude::*,
};
use theme::ActiveTheme;
use ui::scale::px;
use ui::{
    Button, ButtonSize, ButtonVariant, EmptyState, IconName, PaneTitle, SidebarListItem, TextInput, TextInputEvent, WithScrollbar, pane_actions,
    pane_header, typography,
};

use crate::{
    call::call,
    realtime::{RoomMessage, RoomStatus},
    remote_control::{self, Command, SessionState},
    room::{self, RoomConnection},
    sharing::{self, SharedItem, SharedSnapshot},
};

/// How often the list of devices and the open conversation are read again.
const LIST_REFRESH: Duration = Duration::from_secs(10);
const SESSION_REFRESH: Duration = Duration::from_secs(5);
/// After a prompt the host needs a moment to take it and sync the answer back.
const AFTER_PROMPT: Duration = Duration::from_millis(1200);

/// The centre view kind of the devices list, and of one session on another device.
pub const DEVICES_KIND: &str = "devices";
pub const DEVICE_SESSION_KIND: &str = "device-session";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DevicesEvent {
    /// Open a session that runs on another device, in its own tab.
    OpenSession { share_id: String, title: String },
}

/// `1764201600000` as "4 minutes ago".
fn relative_ms(timestamp: i64) -> String {
    if timestamp <= 0 {
        return String::new();
    }
    chrono::DateTime::from_timestamp_millis(timestamp).map(|time| widgets::relative_time(Some(&time.to_rfc3339()))).unwrap_or_default()
}

/// This account's synced sessions grouped by the device they run on, the device used last
/// first, and this device last of all.
pub fn by_device(items: &[SharedItem], device_id: &str) -> Vec<(String, bool, Vec<SharedItem>)> {
    let mut groups: Vec<(String, bool, Vec<SharedItem>)> = Vec::new();
    let mut sessions: Vec<&SharedItem> = items.iter().filter(|item| item.is_synced_session()).collect();
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    for session in sessions {
        let Some(device) = session.device_id.clone() else { continue };
        let here = device == device_id;
        match groups.iter_mut().find(|(id, _, _)| *id == device) {
            Some((_, _, group)) => group.push(session.clone()),
            None => groups.push((device, here, vec![session.clone()])),
        }
    }
    groups.sort_by_key(|(_, here, _)| *here);
    groups
}

pub struct DevicesView {
    items: Vec<SharedItem>,
    sessions_enabled: bool,
    error: Option<String>,
    loaded: bool,
    focus_handle: FocusHandle,
    _poll: Task<()>,
}

impl EventEmitter<DevicesEvent> for DevicesView {}

impl Focusable for DevicesView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl DevicesView {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let poll = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(LIST_REFRESH).await;
                if this.update(cx, |this, cx| this.load(cx)).is_err() {
                    break;
                }
            }
        });
        let mut view = Self { items: Vec::new(), sessions_enabled: false, error: None, loaded: false, focus_handle: cx.focus_handle(), _poll: poll };
        view.load(cx);
        view
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        call(cx, sharing::fetch_options, |this, result, cx| {
            this.loaded = true;
            match result {
                Ok(options) => {
                    this.items = options.items;
                    this.sessions_enabled = options.sessions_enabled;
                    this.error = None;
                }
                Err(error) => this.error = Some(error.to_string()),
            }
            cx.notify();
        });
    }

    fn render_device(&self, index: usize, label: &str, here: bool, sessions: &[SharedItem], cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let rows: Vec<AnyElement> = sessions
            .iter()
            .enumerate()
            .map(|(row, item)| {
                let (share_id, title) = (item.id.clone(), item.title.clone());
                SidebarListItem::new(("device-session", index * 1000 + row), item.title.clone())
                    .in_content()
                    .leading(ui::Icon::new(IconName::Terminal).size(ui::IconSize::Small))
                    .description(relative_ms(item.updated_at))
                    // A session already running here opens from its own tab, not from this list.
                    .when(!here, |row| {
                        row.on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(DevicesEvent::OpenSession { share_id: share_id.clone(), title: title.clone() })
                        }))
                    })
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .px(px(6.))
                    .pb(px(4.))
                    .text_size(typography::text_sm())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.muted_foreground)
                    .child(ui::Icon::new(if here { IconName::Monitor } else { IconName::Laptop }).size(ui::IconSize::Small))
                    .child(SharedString::from(label.to_string()))
                    .child(div().text_color(colors.subtle_foreground).child(sessions.len().to_string()))
                    .child(div().flex_1())
                    .when(here, |this| this.child(div().text_color(colors.subtle_foreground).child("This device"))),
            )
            .children(rows)
            .into_any_element()
    }
}

impl Render for DevicesView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let device_id = sharing::device_id();
        let groups = by_device(&self.items, &device_id);
        let elsewhere = groups.iter().filter(|(_, here, _)| !here).count();
        let label = |group: &(String, bool, Vec<SharedItem>)| group.2.first().map(SharedItem::device_label).unwrap_or_else(|| "Unknown device".into());
        let sections: Vec<AnyElement> =
            groups.iter().enumerate().map(|(index, group)| self.render_device(index, &label(group), group.1, &group.2, cx)).collect();

        let body: AnyElement = if !self.loaded {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::text_sm())
                .text_color(colors.subtle_foreground)
                .child("Looking for your devices…")
                .into_any_element()
        } else if !self.sessions_enabled {
            EmptyState::new("Session sync is off")
                .icon(IconName::CloudSlash)
                .message("Turn on session sync in Settings → Account to reach the sessions on your other machines.")
                .into_any_element()
        } else if elsewhere == 0 {
            EmptyState::new("No other devices yet")
                .icon(IconName::Laptop)
                .message("Sign in to Athas on another machine with session sync on, and its sessions show up here.")
                .into_any_element()
        } else {
            div()
                .id("devices-scroll")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .px(px(12.))
                .py(px(10.))
                .gap(px(14.))
                .children(self.error.clone().map(|error| widgets::error_text(error, cx)))
                .children(sections)
                .scrollbar(window, cx)
                .into_any_element()
        };

        div()
            .id("devices-view")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .font_family(typography::ui_font())
            .child(
                pane_header(cx)
                    .child(PaneTitle::new("Devices").icon(IconName::Laptop).detail(format!("{elsewhere} other")))
                    .child(pane_actions().child(
                        Button::icon("devices-refresh", IconName::ArrowClockwise).size(ButtonSize::Small).tooltip("Refresh").on_click(cx.listener(
                            |this, _, _, cx| this.load(cx),
                        )),
                    )),
            )
            .child(body)
    }
}

/// A prompt sent from here, and how long the conversation was when it went: the host redacts
/// local paths on the way out, so a prompt is not always found again word for word.
struct Pending {
    text: String,
    prompts_before: usize,
}

/// How many prompts a conversation holds.
fn prompt_count(snapshot: Option<&SharedSnapshot>) -> usize {
    snapshot.map_or(0, |snapshot| snapshot.messages.iter().filter(|message| message.role == "user").count())
}

/// Where the next prompt sent from here will land in the conversation.
fn next_prompt_position(snapshot: Option<&SharedSnapshot>, pending: &[Pending]) -> usize {
    prompt_count(snapshot) + pending.len()
}

/// Drops the prompts the host has taken: the conversation now reaches past where they landed.
fn settle_pending(pending: &mut Vec<Pending>, prompts: usize) {
    pending.retain(|waiting| prompts <= waiting.prompts_before);
}

/// What the room told this view.
enum RoomUpdate {
    Status(RoomStatus),
    Members(HashSet<String>),
    Joined(String),
    Left(String),
    State(SessionState),
}

pub struct DeviceSessionView {
    share_id: String,
    title: String,
    snapshot: Option<SharedSnapshot>,
    /// The prompts sent from here that the host's snapshot has not caught up with yet.
    pending: Vec<Pending>,
    state: SessionState,
    status: RoomStatus,
    /// The devices in the room, by device id.
    members: HashSet<String>,
    error: Option<String>,
    composer: Entity<TextInput>,
    room: Option<Rc<RoomConnection>>,
    focus_handle: FocusHandle,
    _subscriptions: Vec<Subscription>,
    _pump: Option<Task<()>>,
    _poll: Task<()>,
}

impl Focusable for DeviceSessionView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl DeviceSessionView {
    pub fn new(share_id: String, title: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let composer = cx.new(|cx| TextInput::new(window, cx).placeholder("Send a prompt to this session"));
        let subscriptions = vec![cx.subscribe(&composer, |this, _, event: &TextInputEvent, cx| match event {
            TextInputEvent::Confirmed => this.send(cx),
            TextInputEvent::Changed(_) => cx.notify(),
            _ => {}
        })];
        let poll = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(SESSION_REFRESH).await;
                if this.update(cx, |this, cx| this.load(cx)).is_err() {
                    break;
                }
            }
        });
        let mut view = Self {
            share_id,
            title,
            snapshot: None,
            pending: Vec::new(),
            state: SessionState::default(),
            status: RoomStatus::Connecting,
            members: HashSet::new(),
            error: None,
            composer,
            room: None,
            focus_handle: cx.focus_handle(),
            _subscriptions: subscriptions,
            _pump: None,
            _poll: poll,
        };
        view.load(cx);
        view.open_room(cx);
        view
    }

    pub fn share_id(&self) -> &str {
        &self.share_id
    }

    /// The device the session runs on, once the snapshot says which one it is.
    fn host_device(&self) -> Option<&str> {
        self.snapshot.as_ref()?.device_id.as_deref()
    }

    fn host_label(&self) -> String {
        match &self.snapshot {
            Some(snapshot) => SharedItem { device_id: snapshot.device_id.clone(), device_name: snapshot.device_name.clone(), ..Default::default() }.device_label(),
            None => "another device".into(),
        }
    }

    /// Whether the machine that runs this session is in the room now.
    fn host_online(&self) -> bool {
        self.host_device().is_some_and(|device| self.members.contains(device))
    }

    /// What the header says, and whether a prompt can be sent.
    fn connection(&self) -> (String, bool) {
        if !self.host_online() {
            return match self.status {
                RoomStatus::Unavailable => ("Live control is off for this account".into(), false),
                RoomStatus::Connecting | RoomStatus::Reconnecting => ("Connecting…".into(), false),
                // Not knowing which it is, the view says what it can see: no room was joined.
                _ => (format!("Not connected to {}", self.host_label()), false),
            };
        }
        if let Some(error) = &self.state.error {
            return (error.clone(), false);
        }
        if self.state.running {
            return (format!("Running on {}", self.host_label()), true);
        }
        (format!("Live on {}", self.host_label()), true)
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let share_id = self.share_id.clone();
        call(cx, move |client, token| sharing::fetch_share(client, token, &share_id), |this, result, cx| {
            match result {
                Ok(snapshot) => {
                    if !snapshot.title.trim().is_empty() {
                        this.title = snapshot.title.clone();
                    }
                    settle_pending(&mut this.pending, prompt_count(Some(&snapshot)));
                    this.snapshot = Some(snapshot);
                    this.error = None;
                }
                Err(error) => this.error = Some(error.to_string()),
            }
            cx.notify();
        });
    }

    fn open_room(&mut self, cx: &mut Context<Self>) {
        let Some(tickets) = remote_control::ticket_source(&self.share_id, cx) else {
            self.status = RoomStatus::Unavailable;
            return;
        };
        let (sender, mut receiver) = mpsc::unbounded();
        let statuses = sender.clone();
        let room = Rc::new(room::connect(
            tickets,
            move |message| {
                let update = match message {
                    RoomMessage::Welcome { members, .. } => Some(RoomUpdate::Members(members.into_iter().filter_map(|member| member.device_id).collect())),
                    RoomMessage::Join(member) => member.device_id.map(RoomUpdate::Joined),
                    RoomMessage::Leave(member) => member.device_id.map(RoomUpdate::Left),
                    RoomMessage::Event { name, data, .. } if name == remote_control::STATE => Some(RoomUpdate::State(remote_control::parse_state(&data))),
                    _ => None,
                };
                if let Some(update) = update {
                    sender.unbounded_send(update).ok();
                }
            },
            move |status| {
                statuses.unbounded_send(RoomUpdate::Status(status)).ok();
            },
        ));
        self.room = Some(room);
        self._pump = Some(cx.spawn(async move |this, cx| {
            while let Some(update) = receiver.next().await {
                if this.update(cx, |this, cx| this.on_room(update, cx)).is_err() {
                    break;
                }
            }
        }));
    }

    fn on_room(&mut self, update: RoomUpdate, cx: &mut Context<Self>) {
        match update {
            RoomUpdate::Status(status) => {
                self.status = status;
                if status == RoomStatus::Open {
                    self.ask_for_state();
                }
            }
            RoomUpdate::Members(members) => {
                self.members = members;
                self.ask_for_state();
            }
            RoomUpdate::Joined(device) => {
                self.members.insert(device);
                self.ask_for_state();
            }
            RoomUpdate::Left(device) => {
                self.members.remove(&device);
            }
            RoomUpdate::State(state) => {
                let was_running = self.state.running;
                self.state = state;
                if was_running != self.state.running {
                    self.load(cx);
                }
            }
        }
        cx.notify();
    }

    fn ask_for_state(&self) {
        if let Some(room) = &self.room {
            room.send(&remote_control::command_message(&Command::Hello), true);
        }
    }

    fn send(&mut self, cx: &mut Context<Self>) {
        let text = self.composer.read(cx).text().trim().to_string();
        if text.is_empty() || !self.connection().1 {
            return;
        }
        let Some(room) = self.room.clone() else { return };
        if !room.send(&remote_control::command_message(&Command::Prompt(text.clone())), true) {
            self.error = Some("Could not reach that device. It may have gone offline.".into());
            cx.notify();
            return;
        }
        self.composer.update(cx, |input, cx| input.set_text("", cx));
        let prompts_before = next_prompt_position(self.snapshot.as_ref(), &self.pending);
        self.pending.push(Pending { text, prompts_before });
        self.error = None;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(AFTER_PROMPT).await;
            this.update(cx, |this, cx| this.load(cx)).ok();
        })
        .detach();
        cx.notify();
    }

    fn stop(&mut self, cx: &mut Context<Self>) {
        if let Some(room) = &self.room {
            room.send(&remote_control::command_message(&Command::Stop), true);
        }
        cx.notify();
    }

    fn render_message(&self, index: usize, role: &str, content: &str, pending: bool, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let user = role == "user";
        div()
            .id(("device-message", index))
            .flex()
            .flex_col()
            .gap(px(4.))
            .p(px(10.))
            .rounded(ui::metrics::radius_lg())
            .when(user, |this| this.bg(colors.selected))
            .when(pending, |this| this.opacity(0.6))
            .child(
                div()
                    .text_size(typography::text_caption())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.subtle_foreground)
                    .child(if pending { "Sending" } else if user { "Prompt" } else { "Agent" }),
            )
            .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(SharedString::from(content.to_string())))
            .into_any_element()
    }
}

impl Render for DeviceSessionView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let (connection, can_send) = self.connection();
        let snapshot = self.snapshot.clone();
        let mut messages: Vec<AnyElement> = snapshot
            .as_ref()
            .map(|snapshot| {
                snapshot.messages.iter().enumerate().map(|(index, message)| self.render_message(index, &message.role, &message.content, false, cx)).collect()
            })
            .unwrap_or_default();
        let offset = messages.len();
        messages.extend(self.pending.iter().enumerate().map(|(index, pending)| self.render_message(offset + index, "user", &pending.text, true, cx)));
        let composer_ready = can_send && !self.composer.read(cx).text().trim().is_empty();

        let body: AnyElement = match &snapshot {
            None => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::text_sm())
                .text_color(colors.subtle_foreground)
                .child(self.error.clone().unwrap_or_else(|| "Opening the session…".into()))
                .into_any_element(),
            Some(_) => div()
                .id("device-session-scroll")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .px(px(20.))
                .py(px(12.))
                .gap(px(10.))
                .children(self.error.clone().map(|error| widgets::error_text(error, cx)))
                .when(messages.is_empty(), |this| {
                    this.child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("This session has no messages yet."))
                })
                .children(messages)
                .scrollbar(window, cx)
                .into_any_element(),
        };

        div()
            .id("device-session-view")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .font_family(typography::ui_font())
            .child(
                pane_header(cx)
                    .child(PaneTitle::new(self.title.clone()).icon(IconName::Laptop).detail(connection))
                    .child(pane_actions().gap(px(6.)).child(
                        Button::new("device-session-stop", "Stop").variant(ButtonVariant::Ghost).size(ButtonSize::Small).disabled(!self.state.running).on_click(
                            cx.listener(|this, _, _, cx| this.stop(cx)),
                        ),
                    )),
            )
            .child(body)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(20.))
                    .py(px(10.))
                    .border_t_1()
                    .border_color(colors.divider)
                    .child(div().flex_1().child(self.composer.clone()))
                    .child(
                        Button::new("device-session-send", "Send")
                            .disabled(!composer_ready)
                            .on_click(cx.listener(|this, _, _, cx| this.send(cx))),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sharing::{ShareKind, SnapshotMessage, Visibility};

    fn item(id: &str, device: &str, name: Option<&str>, updated_at: i64) -> SharedItem {
        SharedItem {
            id: id.into(),
            title: id.into(),
            kind: ShareKind::Agent,
            live: true,
            visibility: Visibility::Private,
            source_id: Some(format!("chat-{id}")),
            device_id: Some(device.into()),
            device_name: name.map(str::to_string),
            updated_at,
            ..Default::default()
        }
    }

    #[test]
    fn sessions_group_by_device_with_this_one_last() {
        let items = vec![
            item("a", "mine", Some("My Mac"), 10),
            item("b", "theirs", Some("Work PC"), 30),
            item("c", "theirs", Some("Work PC"), 20),
            SharedItem { visibility: Visibility::Public, ..item("d", "theirs", None, 40) },
        ];
        let groups = by_device(&items, "mine");
        assert_eq!(groups.len(), 2);
        assert_eq!((groups[0].0.as_str(), groups[0].1), ("theirs", false));
        assert_eq!(groups[0].2.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(), vec!["b", "c"], "newest first, public shares left out");
        assert_eq!((groups[1].0.as_str(), groups[1].1), ("mine", true));
    }

    #[test]
    fn a_prompt_stops_showing_as_sent_once_the_host_has_it() {
        let mut pending = vec![Pending { text: "one".into(), prompts_before: 3 }, Pending { text: "two".into(), prompts_before: 4 }];
        settle_pending(&mut pending, 3);
        assert_eq!(pending.len(), 2, "nothing arrived yet");
        settle_pending(&mut pending, 4);
        assert_eq!(pending.iter().map(|waiting| waiting.text.as_str()).collect::<Vec<_>>(), vec!["two"], "the first one landed");
        settle_pending(&mut pending, 5);
        assert!(pending.is_empty());
    }

    #[test]
    fn prompts_queue_behind_each_other() {
        let snapshot = SharedSnapshot {
            messages: vec![
                SnapshotMessage { role: "user".into(), content: "a".into() },
                SnapshotMessage { role: "assistant".into(), content: "b".into() },
            ],
            ..Default::default()
        };
        assert_eq!(prompt_count(Some(&snapshot)), 1);
        let pending = vec![Pending { text: "two".into(), prompts_before: 1 }];
        assert_eq!(next_prompt_position(Some(&snapshot), &pending), 2);
        assert_eq!(next_prompt_position(None, &[]), 0);
    }

    #[test]
    fn a_device_without_a_name_is_still_told_apart() {
        assert_eq!(item("a", "mine", Some("My Mac"), 0).device_label(), "My Mac");
        assert_eq!(item("a", "abcdef0123", None, 0).device_label(), "Device abcdef");
        assert_eq!(SharedItem::default().device_label(), "Unknown device");
    }
}
