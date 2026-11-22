//! The Team view, a centre tab (`components/team-view.tsx`): what needs you (mentions,
//! hand-offs, review requests), the sessions teammates shared, who is here now, the members and
//! open invitations. The snapshot comes with the plan; the view refreshes it every 30 seconds
//! while it is open (Athas's realtime room is not ported, so polling is the only transport).

use std::time::Duration;

use account::{
    AccountStore,
    api::{Collaboration, InboxKind, ReviewState, TeamInboxItem, TeamMember, TeamSharedSession},
    state::Session,
    widgets,
};
use ui::scale::px;
use gpui::{
    AnyElement, App, Context, Entity, EventEmitter, FocusHandle, Focusable, Hsla, IntoElement, ParentElement, Render, SharedString, Styled,
    Subscription, Task, Window, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{Avatar, Button, ButtonSize, ButtonVariant, EmptyState, IconName, PaneTitle, Person, SidebarListItem, WithScrollbar, pane_actions, pane_header, typography};

use crate::{call::call, team};

const POLL_INTERVAL: Duration = Duration::from_secs(30);
const PRESENCE_FRESH_SECS: i64 = 2 * 60;
const INBOX_LIMIT: usize = 20;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TeamViewEvent {
    /// Open a shared session in its own tab (`TeamSessionView`).
    OpenSession { share_id: String, title: String },
}

pub fn inbox_verb(kind: InboxKind) -> &'static str {
    match kind {
        InboxKind::Mention => "mentioned you",
        InboxKind::Handoff => "handed you a session",
        InboxKind::ReviewRequest => "asked for your review",
        InboxKind::Review => "reviewed your session",
    }
}

/// The badge a session's review state shows, with its tone.
pub fn review_badge(state: ReviewState, cx: &App) -> Option<(&'static str, Hsla)> {
    let colors = &cx.theme().colors;
    match state {
        ReviewState::None => None,
        ReviewState::Requested => Some(("Review", colors.primary)),
        ReviewState::Approved => Some(("Approved", colors.success)),
        ReviewState::ChangesRequested => Some(("Changes", colors.warning)),
    }
}

/// Unread first, then as the server ordered them (newest first).
pub fn sorted_inbox(inbox: &[TeamInboxItem]) -> Vec<TeamInboxItem> {
    let mut items = inbox.to_vec();
    items.sort_by_key(|item| item.read_at.is_some());
    items
}

pub struct TeamView {
    store: Option<Entity<AccountStore>>,
    focus_handle: FocusHandle,
    error: Option<String>,
    _observe: Option<Subscription>,
    _observe_presence: Option<Subscription>,
    _poll: Task<()>,
}

impl EventEmitter<TeamViewEvent> for TeamView {}

impl Focusable for TeamView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl TeamView {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let store = AccountStore::global(cx);
        let observe = store.as_ref().map(|store| cx.observe(store, |_, _, cx| cx.notify()));
        if let Some(store) = &store {
            store.update(cx, |store, cx| store.refresh_subscription(cx)).detach();
        }
        let poll = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(POLL_INTERVAL).await;
                let Ok(Some(store)) = this.read_with(cx, |this, _| this.store.clone()) else { break };
                store.update(cx, |store, cx| store.refresh_subscription(cx)).await;
            }
        });
        let observe_presence = observe_following(cx);
        Self { store, focus_handle: cx.focus_handle(), error: None, _observe: observe, _observe_presence: observe_presence, _poll: poll }
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.error = None;
        if let Some(store) = &self.store {
            store.update(cx, |store, cx| store.refresh_subscription(cx)).detach();
        }
    }

    fn open_inbox_item(&mut self, item: &TeamInboxItem, cx: &mut Context<Self>) {
        if item.read_at.is_none() {
            let id = item.id;
            call(cx, move |client, token| team::mark_inbox_read(client, token, Some(&[id])), |this, result, cx| match result {
                Ok(()) => this.refresh(cx),
                Err(error) => {
                    this.error = Some(error.to_string());
                    cx.notify();
                }
            });
        }
        if let Some(share_id) = item.share_id.clone() {
            let title = item.session_title.clone().unwrap_or_else(|| "Shared session".into());
            cx.emit(TeamViewEvent::OpenSession { share_id, title });
        }
    }

    fn mark_all_read(&mut self, cx: &mut Context<Self>) {
        call(cx, |client, token| team::mark_inbox_read(client, token, None), |this, result, cx| match result {
            Ok(()) => this.refresh(cx),
            Err(error) => {
                this.error = Some(error.to_string());
                cx.notify();
            }
        });
    }

    fn render_section(&self, title: &str, count: Option<usize>, trailing: Option<AnyElement>, rows: Vec<AnyElement>, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
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
                    .child(SharedString::from(title.to_string()))
                    .children(count.map(|count| div().text_color(colors.subtle_foreground).child(count.to_string())))
                    .child(div().flex_1())
                    .children(trailing),
            )
            .children(rows)
            .into_any_element()
    }

    fn render_inbox(&self, inbox: &[TeamInboxItem], members: &[TeamMember], cx: &mut Context<Self>) -> Option<AnyElement> {
        if inbox.is_empty() {
            return None;
        }
        let colors = cx.theme().colors.clone();
        let unread = inbox.iter().filter(|item| item.read_at.is_none()).count();
        let rows = sorted_inbox(inbox)
            .into_iter()
            .take(INBOX_LIMIT)
            .map(|item| {
                let description = [item.session_title.clone(), Some(item.body.clone()).filter(|body| !body.is_empty())]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" · ");
                let trailing = if item.read_at.is_some() {
                    div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(widgets::relative_time(item.created_at.as_deref())).into_any_element()
                } else {
                    div().size(px(8.)).rounded_full().bg(colors.primary).into_any_element()
                };
                let label = format!("{} {}", item.actor_name, inbox_verb(item.kind));
                let row = SidebarListItem::new(("inbox", item.id as u64), label)
                    .in_content()
                    .leading(Avatar::person(&teammate(members, item.actor_user_id, &item.actor_name), cx))
                    .trailing(trailing)
                    .on_click(cx.listener(move |this, _, _, cx| this.open_inbox_item(&item, cx)));
                if description.is_empty() { row } else { row.description(description) }.into_any_element()
            })
            .collect();
        let mark_all = (unread > 0).then(|| {
            Button::new("team-mark-read", "Mark all read")
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::XSmall)
                .on_click(cx.listener(|this, _, _, cx| this.mark_all_read(cx)))
                .into_any_element()
        });
        Some(self.render_section("For You", (unread > 0).then_some(unread), mark_all, rows, cx))
    }

    fn render_sessions(&self, sessions: &[TeamSharedSession], members: &[TeamMember], cx: &mut Context<Self>) -> Option<AnyElement> {
        if sessions.is_empty() {
            return None;
        }
        let rows = sessions
            .iter()
            .enumerate()
            .map(|(index, session)| {
                let mut description = format!("{} · {}", session.owner_name, widgets::relative_time(session.updated_at.as_deref()));
                if session.comment_count > 0 {
                    description.push_str(&format!(" · {} comments", session.comment_count));
                }
                let share_id = session.share_id.clone();
                let title = session.title.clone();
                SidebarListItem::new(("team-session", index), session.title.clone())
                    .in_content()
                    .leading(presence_avatar(&teammate(members, Some(session.owner_user_id), &session.owner_name), session.live, cx))
                    .description(description)
                    .when_some(review_badge(session.review_state, cx), |row, (label, tone)| row.trailing(widgets::badge(label, Some(tone), cx)))
                    .on_click(cx.listener(move |_, _, _, cx| cx.emit(TeamViewEvent::OpenSession { share_id: share_id.clone(), title: title.clone() })))
                    .into_any_element()
            })
            .collect();
        Some(self.render_section("Shared Sessions", Some(sessions.len()), None, rows, cx))
    }

    fn render_here_now(&self, team: &Collaboration, me: Option<i64>, cx: &App) -> Option<AnyElement> {
        let now = chrono::Utc::now().timestamp();
        let online: Vec<_> = team
            .presence
            .iter()
            .filter(|entry| entry.status == "online" && entry.user_id.is_some() && entry.user_id != me)
            .filter(|entry| {
                entry
                    .heartbeat_at
                    .as_deref()
                    .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
                    .is_some_and(|at| now - at.timestamp() < PRESENCE_FRESH_SECS)
            })
            .collect();
        if online.is_empty() {
            return None;
        }
        let rows = online
            .iter()
            .map(|entry| {
                let name = team.members.iter().find(|member| member.user_id == entry.user_id).map_or("Teammate".to_string(), |member| member.name.clone());
                let person = teammate(&team.members, entry.user_id, &name);
                let detail = entry.cursor_label.clone().or_else(|| {
                    entry.active_file_path.as_deref().and_then(|path| path.rsplit(['/', '\\']).next()).map(str::to_string)
                });
                let following = entry.user_id.is_some() && following_user(cx) == entry.user_id;
                let user_id = entry.user_id;
                let colors = &cx.theme().colors;
                let row = SidebarListItem::new(("here-now", entry.id as u64), name.clone())
                    .in_content()
                    .active(following)
                    .leading(presence_avatar(&person, true, cx))
                    .when(following, |row| row.trailing(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Following")))
                    .on_click(move |_, _, cx| set_following(if following { None } else { user_id }, cx));
                match detail {
                    Some(detail) => row.description(detail),
                    None => row,
                }
                .into_any_element()
            })
            .collect();
        Some(self.render_section("Here Now", Some(online.len()), None, rows, cx))
    }

    fn render_members(&self, team: &Collaboration, cx: &App) -> Option<AnyElement> {
        if team.members.is_empty() {
            return None;
        }
        let colors = &cx.theme().colors;
        let rows = team
            .members
            .iter()
            .map(|member| {
                let mut trailing = vec![widgets::badge(member.role.clone(), None, cx).into_any_element()];
                if member.status != "active" && !member.status.is_empty() {
                    trailing.insert(0, div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(member.status.clone()).into_any_element());
                }
                SidebarListItem::new(("member", member.id as u64), member.name.clone())
                    .in_content()
                    .leading(Avatar::person(&Person::new(member.name.clone()).email(member.email.clone()).user_id(member.user_id.unwrap_or_default()), cx))
                    .description(member.email.clone())
                    .trailing(div().flex().items_center().gap(px(6.)).children(trailing))
                    .into_any_element()
            })
            .collect();
        Some(self.render_section("Members", Some(team.members.len()), None, rows, cx))
    }

    fn render_invitations(&self, team: &Collaboration, cx: &App) -> Option<AnyElement> {
        let pending: Vec<_> = team.invitations.iter().filter(|invite| invite.status == "pending").collect();
        if pending.is_empty() {
            return None;
        }
        let rows = pending
            .iter()
            .map(|invite| {
                SidebarListItem::new(("invite", invite.id as u64), invite.email.clone())
                    .in_content()
                    .leading_icon(IconName::User)
                    .trailing(widgets::badge(invite.role.clone(), None, cx))
                    .into_any_element()
            })
            .collect();
        Some(self.render_section("Invitations", Some(pending.len()), None, rows, cx))
    }

    fn render_body(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let urls = account::urls(cx);
        let Some(store) = self.store.clone() else {
            return centered(EmptyState::new("Accounts are not available in this build").icon(IconName::Users));
        };
        let (session, team, me) = {
            let store = store.read(cx);
            (store.state().session.clone(), store.subscription().and_then(|subscription| subscription.team()).cloned(), store.user().map(|user| user.id))
        };
        match session {
            Session::Loading => return centered(EmptyState::new("Loading your team…").icon(IconName::Users)),
            Session::SignedOut => {
                let store = store.clone();
                return centered(
                    EmptyState::new("Sign in to see your team")
                        .message("Shared sessions, reviews and hand-offs live in your Athas account.")
                        .icon(IconName::Users)
                        .action(Button::new("team-sign-in", "Sign In").variant(ButtonVariant::Accent).on_click(move |_, _, cx| store.update(cx, |store, cx| store.sign_in(cx)))),
                );
            }
            Session::Unverified(check) => {
                let store = store.clone();
                return centered(
                    EmptyState::new("Could not check your session")
                        .message(check.message)
                        .icon(IconName::CloudWarning)
                        .action(Button::new("team-retry", "Retry").on_click(move |_, _, cx| store.update(cx, |store, cx| store.retry_session_check(cx)))),
                );
            }
            Session::SignedIn { .. } => {}
        }
        let Some(team) = team else {
            let pricing = urls.pricing();
            return centered(
                EmptyState::new("Available on the Team plan")
                    .message("Share agent sessions with teammates, ask for reviews and hand work off.")
                    .icon(IconName::Users)
                    .action(Button::new("team-plans", "View Plans").variant(ButtonVariant::Accent).on_click(move |_, _, cx| cx.open_url(&pricing))),
            );
        };
        let sections: Vec<AnyElement> = [
            self.render_inbox(&team.inbox, &team.members, cx),
            self.render_sessions(&team.shared_sessions, &team.members, cx),
            self.render_here_now(&team, me, cx),
            self.render_members(&team, cx),
            self.render_invitations(&team, cx),
        ]
        .into_iter()
        .flatten()
        .collect();
        let colors = cx.theme().colors.clone();
        div()
            .id("team-scroll")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .px(px(12.))
            .pb(px(16.))
            .gap(px(16.))
            .children(self.error.clone().map(|error| div().px(px(6.)).child(widgets::error_text(error, cx))))
            .when(sections.is_empty(), |this| {
                this.child(div().px(px(6.)).py(px(8.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Nothing here yet"))
            })
            .children(sections)
            .scrollbar(window, cx)
            .into_any_element()
    }
}

fn centered(state: EmptyState) -> AnyElement {
    div().flex().flex_1().items_center().justify_center().child(state).into_any_element()
}

/// A teammate as an avatar needs them: the team knows their id, and the member list their
/// address, which is what finds their picture.
fn teammate(members: &[TeamMember], user_id: Option<i64>, name: &str) -> Person {
    let mut person = Person::new(name.to_string());
    if let Some(id) = user_id.filter(|id| *id != 0) {
        person = person.user_id(id);
        if let Some(member) = members.iter().find(|member| member.user_id == Some(id)) {
            person = person.email(member.email.clone());
        }
    }
    person
}

/// An avatar with a green dot while the person is online or the session is live.
fn presence_avatar(person: &Person, online: bool, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .relative()
        .child(Avatar::person(person, cx))
        .when(online, |this| {
            this.child(div().absolute().bottom(px(-1.)).right(px(-1.)).size(px(8.)).rounded_full().bg(colors.success).border_1().border_color(colors.background))
        })
        .into_any_element()
}

impl Render for TeamView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let workspace = self
            .store
            .as_ref()
            .and_then(|store| store.read(cx).subscription().and_then(|subscription| subscription.team()).and_then(|team| team.workspace.clone()))
            .map(|workspace| workspace.name);
        let signed_in = self.store.as_ref().is_some_and(|store| store.read(cx).is_signed_in());
        let dashboard = account::urls(cx).collaboration();
        let body = self.render_body(window, cx);
        div()
            .id("team-view")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .font_family(typography::UI_FONT)
            .child(
                pane_header(cx)
                    .child(match workspace {
                        Some(workspace) => PaneTitle::new("Team").icon(IconName::Users).detail(workspace),
                        None => PaneTitle::new("Team").icon(IconName::Users),
                    })
                    .when(signed_in, |this| {
                        this.child(
                            pane_actions()
                                .child(
                                    Button::icon("team-dashboard", IconName::OpenExternal)
                                        .size(ButtonSize::Small)
                                        .tooltip("Manage Team on the Web")
                                        .on_click(move |_, _, cx| cx.open_url(&dashboard)),
                                )
                                .child(
                                    Button::icon("team-refresh", IconName::ArrowClockwise)
                                        .size(ButtonSize::Small)
                                        .tooltip("Refresh")
                                        .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                                ),
                        )
                    }),
            )
            .child(body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unread_inbox_items_come_first() {
        let item = |id, read: bool| TeamInboxItem { id, read_at: read.then(|| "2026-11-11T09:00:00Z".to_string()), ..Default::default() };
        let sorted = sorted_inbox(&[item(1, true), item(2, false), item(3, true), item(4, false)]);
        assert_eq!(sorted.iter().map(|item| item.id).collect::<Vec<_>>(), vec![2, 4, 1, 3]);
        assert_eq!(inbox_verb(InboxKind::ReviewRequest), "asked for your review");
    }
}

#[cfg(not(target_family = "wasm"))]
fn observe_following(cx: &mut Context<TeamView>) -> Option<Subscription> {
    crate::presence::CollaborationRuntime::global(cx).map(|runtime| cx.observe(&runtime, |_, _, cx| cx.notify()))
}

#[cfg(target_family = "wasm")]
fn observe_following(_: &mut Context<TeamView>) -> Option<Subscription> {
    None
}

/// The teammate whose file this window follows.
pub fn following_user(cx: &App) -> Option<i64> {
    #[cfg(not(target_family = "wasm"))]
    return crate::presence::CollaborationRuntime::global(cx).and_then(|runtime| runtime.read(cx).following_user_id);
    #[cfg(target_family = "wasm")]
    {
        let _ = cx;
        None
    }
}

/// Follows a teammate's file, or stops following with `None`.
pub fn set_following(user_id: Option<i64>, cx: &mut App) {
    #[cfg(not(target_family = "wasm"))]
    if let Some(runtime) = crate::presence::CollaborationRuntime::global(cx) {
        runtime.update(cx, |runtime, cx| runtime.set_following(user_id, cx));
    }
    #[cfg(target_family = "wasm")]
    let _ = (user_id, cx);
}

/// The shared document stream of the file in front, as Team settings show it: its status, the
/// path and version, and whether it failed.
pub fn document_stream_summary(cx: &App) -> (&'static str, Option<String>, bool) {
    #[cfg(not(target_family = "wasm"))]
    if let Some(runtime) = crate::presence::CollaborationRuntime::global(cx) {
        let stream = &runtime.read(cx).stream;
        let detail = stream.path.as_ref().map(|path| format!("{path} · v{}", stream.last_server_version));
        return (stream.status.label(), detail, stream.status == crate::presence::StreamStatus::Error);
    }
    let _ = cx;
    ("idle", None, false)
}
