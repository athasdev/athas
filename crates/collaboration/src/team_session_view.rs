//! A shared session in its own tab (`components/team-session-view.tsx`): the conversation, then
//! comments and reviews under it. The owner asks for reviews and hands it off; others approve or
//! request changes; anyone can continue it here. It refreshes every five seconds while live.

use ui::WithScrollbar as _;
use std::time::Duration;

use account::{AccountStore, widgets};
use gpui::{
    AnyElement, App, Context, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ParentElement, Render, SharedString, Styled,
    Subscription, Task, Window, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{Avatar, Button, ButtonSize, ButtonVariant, IconName, PaneTitle, TextInput, TextInputEvent, pane_actions, pane_header, typography};

use crate::{
    call::call,
    team::{self, CommentKind, TeamComment, TeamSessionDetail},
    team_view::review_badge,
};

const LIVE_REFRESH: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, PartialEq)]
pub enum TeamSessionEvent {
    /// Start a local session with this conversation (the host creates it with `agent_ui`).
    Continue(TeamSessionDetail),
}

/// Sending the session to a teammate: for a review, or to hand it off.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SendTo {
    Review,
    HandOff,
}

impl SendTo {
    fn title(self) -> &'static str {
        match self {
            Self::Review => "Who should review this session?",
            Self::HandOff => "Who should continue this session?",
        }
    }

    /// The note's placeholder, as the original's prompts word it.
    fn note_placeholder(self) -> &'static str {
        match self {
            Self::Review => "What to look at",
            Self::HandOff => "What's left to do",
        }
    }
}

pub struct TeamSessionView {
    share_id: String,
    title: String,
    detail: Option<TeamSessionDetail>,
    error: Option<String>,
    busy: bool,
    comment: Entity<TextInput>,
    note: Entity<TextInput>,
    sending: Option<SendTo>,
    focus_handle: FocusHandle,
    _subscriptions: Vec<Subscription>,
    _poll: Task<()>,
}

impl EventEmitter<TeamSessionEvent> for TeamSessionView {}

impl Focusable for TeamSessionView {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl TeamSessionView {
    /// `send` opens the teammate picker at once, as the Hand Off and Request Review commands do.
    pub fn new(share_id: String, title: String, send: Option<SendTo>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let comment = cx.new(|cx| TextInput::new(window, cx).placeholder("Comment, or @mention a teammate"));
        let note = cx.new(|cx| TextInput::new(window, cx).placeholder(send.map_or("Add a note (optional)", SendTo::note_placeholder)));
        let subscriptions = vec![
            cx.subscribe(&comment, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Confirmed => this.post(CommentKind::Comment, cx),
                TextInputEvent::Changed(_) => cx.notify(),
                _ => {}
            }),
            cx.subscribe(&note, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Cancelled => {
                    this.sending = None;
                    cx.notify();
                }
                _ => {}
            }),
        ];
        let poll = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(LIVE_REFRESH).await;
                let live = this.read_with(cx, |this, _| this.detail.as_ref().is_some_and(|detail| detail.session.live));
                match live {
                    Ok(true) => {
                        this.update(cx, |this, cx| this.load(cx)).ok();
                    }
                    Ok(false) => {}
                    Err(_) => break,
                }
            }
        });
        let mut view = Self {
            share_id,
            title,
            detail: None,
            error: None,
            busy: false,
            comment,
            note,
            sending: send,
            focus_handle: cx.focus_handle(),
            _subscriptions: subscriptions,
            _poll: poll,
        };
        view.load(cx);
        view
    }

    pub fn share_id(&self) -> &str {
        &self.share_id
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let share_id = self.share_id.clone();
        call(cx, move |client, token| team::fetch_session(client, token, &share_id), |this, result, cx| {
            match result {
                Ok(detail) => {
                    this.title = detail.session.title.clone();
                    this.detail = Some(detail);
                    this.error = None;
                }
                Err(error) => this.error = Some(error.to_string()),
            }
            cx.notify();
        });
    }

    fn after_action(&mut self, result: Result<(), account::ApiError>, cx: &mut Context<Self>) {
        self.busy = false;
        match result {
            Ok(()) => {
                self.load(cx);
                if let Some(store) = AccountStore::global(cx) {
                    store.update(cx, |store, cx| store.schedule_subscription_refresh(cx));
                }
            }
            Err(error) => {
                notifications::error(cx, error.to_string(), None);
            }
        }
        cx.notify();
    }

    fn post(&mut self, kind: CommentKind, cx: &mut Context<Self>) {
        let body = self.comment.read(cx).text().trim().to_string();
        if self.busy || (kind == CommentKind::Comment && body.is_empty()) {
            return;
        }
        self.busy = true;
        let share_id = self.share_id.clone();
        call(cx, move |client, token| team::add_comment(client, token, &share_id, kind, &body, None, None), |this, result, cx| {
            this.busy = false;
            match result {
                Ok(comments) => {
                    if let Some(detail) = &mut this.detail {
                        detail.comments = comments;
                    }
                    this.comment.update(cx, |input, cx| input.set_text("", cx));
                    if let Some(store) = AccountStore::global(cx) {
                        store.update(cx, |store, cx| store.schedule_subscription_refresh(cx));
                    }
                }
                Err(error) => {
                    notifications::error(cx, error.to_string(), None);
                }
            }
            cx.notify();
        });
        cx.notify();
    }

    fn send(&mut self, to: SendTo, user_id: i64, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.sending = None;
        let note = self.note.read(cx).text().trim().to_string();
        self.note.update(cx, |input, cx| input.set_text("", cx));
        let share_id = self.share_id.clone();
        call(
            cx,
            move |client, token| match to {
                SendTo::Review => team::request_review(client, token, &share_id, &[user_id], &note),
                SendTo::HandOff => team::hand_off(client, token, &share_id, user_id, &note),
            },
            |this, result, cx| {
                if result.is_ok() {
                    notifications::info(cx, "Sent");
                }
                this.after_action(result, cx)
            },
        );
        cx.notify();
    }

    /// Active teammates other than you.
    fn teammates(&self, cx: &App) -> Vec<(i64, String)> {
        let Some(store) = AccountStore::global(cx) else { return Vec::new() };
        let store = store.read(cx);
        let me = store.user().map(|user| user.id);
        store
            .subscription()
            .and_then(|subscription| subscription.team())
            .map(|team| {
                team.members
                    .iter()
                    .filter(|member| member.status == "active" && member.user_id.is_some() && member.user_id != me)
                    .filter_map(|member| Some((member.user_id?, member.name.clone())))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn is_owner(&self, cx: &App) -> bool {
        let me = AccountStore::global(cx).and_then(|store| store.read(cx).user().map(|user| user.id));
        self.detail.as_ref().is_some_and(|detail| Some(detail.session.owner_user_id) == me)
    }

    fn render_actions(&self, cx: &mut Context<Self>) -> AnyElement {
        let owner = self.is_owner(cx);
        let busy = self.busy;
        let mut actions = Vec::new();
        if owner {
            for (id, label, to) in [("team-request-review", "Request Review", SendTo::Review), ("team-hand-off", "Hand Off", SendTo::HandOff)] {
                actions.push(
                    Button::new(id, label)
                        .size(ButtonSize::Small)
                        .disabled(busy)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.sending = Some(to);
                            this.note.update(cx, |input, cx| {
                                input.set_placeholder(to.note_placeholder(), cx);
                                input.focus(window, cx);
                            });
                            cx.notify();
                        }))
                        .into_any_element(),
                );
            }
        } else {
            actions.push(
                Button::new("team-approve", "Approve")
                    .size(ButtonSize::Small)
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| this.post(CommentKind::Approve, cx)))
                    .into_any_element(),
            );
            actions.push(
                Button::new("team-request-changes", "Request Changes")
                    .size(ButtonSize::Small)
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| this.post(CommentKind::RequestChanges, cx)))
                    .into_any_element(),
            );
        }
        actions.push(
            Button::new("team-continue", "Continue Here")
                .size(ButtonSize::Small)
                .variant(ButtonVariant::Accent)
                .disabled(self.detail.is_none())
                .on_click(cx.listener(|this, _, _, cx| {
                    if let Some(detail) = this.detail.clone() {
                        cx.emit(TeamSessionEvent::Continue(detail));
                    }
                }))
                .into_any_element(),
        );
        actions.push(
            Button::icon("team-session-refresh", IconName::ArrowClockwise)
                .size(ButtonSize::Small)
                .tooltip("Refresh")
                .on_click(cx.listener(|this, _, _, cx| this.load(cx)))
                .into_any_element(),
        );
        pane_actions().gap(px(6.)).children(actions).into_any_element()
    }

    fn render_picker(&self, to: SendTo, cx: &mut Context<Self>) -> AnyElement {
        let teammates = self.teammates(cx);
        let colors = cx.theme().colors.clone();
        let choices: Vec<AnyElement> = if teammates.is_empty() {
            vec![div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("Invite a teammate from the dashboard first").into_any_element()]
        } else {
            teammates
                .into_iter()
                .map(|(user_id, name)| {
                    Button::new(("teammate", user_id as u64), name.clone())
                        .leading(Avatar::new(&name))
                        .on_click(cx.listener(move |this, _, _, cx| this.send(to, user_id, cx)))
                        .into_any_element()
                })
                .collect()
        };
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(12.))
            .rounded(ui::metrics::ISLAND_RADIUS)
            .bg(colors.raised)
            .shadow(cx.theme().shadows.raised.clone())
            .child(div().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).child(to.title()))
            .child(self.note.clone())
            .child(div().flex().flex_wrap().gap(px(6.)).children(choices))
            .child(
                div().child(
                    Button::new("team-send-cancel", "Cancel").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| {
                        this.sending = None;
                        cx.notify();
                    })),
                ),
            )
            .into_any_element()
    }

    fn render_message(&self, index: usize, role: &str, content: &str, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let user = role == "user";
        div()
            .id(("team-message", index))
            .flex()
            .flex_col()
            .gap(px(4.))
            .p(px(10.))
            .rounded(ui::metrics::RADIUS_LG)
            .when(user, |this| this.bg(colors.selected))
            .child(
                div()
                    .text_size(typography::TEXT_CAPTION)
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.subtle_foreground)
                    .child(if user { "Prompt" } else { "Agent" }),
            )
            .child(div().text_size(typography::TEXT_SM).text_color(colors.foreground).child(SharedString::from(content.to_string())))
            .into_any_element()
    }

    fn render_comment(&self, comment: &TeamComment, cx: &App) -> AnyElement {
        let colors = &cx.theme().colors;
        let mut location = comment.file_path.clone().unwrap_or_default();
        if let (false, Some(line)) = (location.is_empty(), comment.line) {
            location.push_str(&format!(":{line}"));
        }
        div()
            .flex()
            .gap(px(10.))
            .child(Avatar::new(&comment.author_name).size(px(24.)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_baseline()
                            .gap(px(6.))
                            .text_size(typography::TEXT_SM)
                            .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(comment.author_name.clone()))
                            .children(comment.kind.verb().map(|verb| div().text_color(colors.muted_foreground).child(verb)))
                            .when(!location.is_empty(), |this| this.child(div().font_family(typography::MONO_FONT).text_color(colors.subtle_foreground).child(location)))
                            .child(div().text_color(colors.subtle_foreground).child(widgets::relative_time(comment.created_at.as_deref()))),
                    )
                    .when(!comment.body.is_empty(), |this| this.child(div().text_size(typography::TEXT_SM).text_color(colors.foreground).child(comment.body.clone()))),
            )
            .into_any_element()
    }
}

impl Render for TeamSessionView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let detail = self.detail.clone();
        let header_detail = detail.as_ref().map(|detail| {
            let mut text = detail.session.owner_name.clone();
            if detail.session.live {
                text.push_str(" · Live");
            }
            text
        });
        let badge = detail.as_ref().and_then(|detail| review_badge(detail.session.review_state, cx));
        let actions = self.render_actions(cx);
        let picker = self.sending.map(|to| self.render_picker(to, cx));

        let body: AnyElement = match &detail {
            None => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::TEXT_SM)
                .text_color(colors.subtle_foreground)
                .child(self.error.clone().unwrap_or_else(|| "Opening the shared session…".into()))
                .into_any_element(),
            Some(detail) => {
                let messages: Vec<AnyElement> =
                    detail.messages.iter().enumerate().map(|(index, message)| self.render_message(index, &message.role, &message.content, cx)).collect();
                let comments: Vec<AnyElement> = detail.comments.iter().map(|comment| self.render_comment(comment, cx)).collect();
                let can_post = !self.busy && !self.comment.read(cx).text().trim().is_empty();
                div()
                    .id("team-session-scroll")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(20.))
                    .py(px(12.))
                    .gap(px(12.))
                    .children(picker)
                    .children(self.error.clone().map(|error| widgets::error_text(error, cx)))
                    .when(messages.is_empty(), |this| this.child(div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("This session has no messages yet.")))
                    .children(messages)
                    .child(div().h(px(1.)).bg(colors.divider))
                    .child(
                        div()
                            .text_size(typography::TEXT_SM)
                            .font_weight(typography::MEDIUM)
                            .text_color(colors.muted_foreground)
                            .child(if comments.is_empty() { "No comments yet".to_string() } else { format!("Comments · {}", comments.len()) }),
                    )
                    .children(comments)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(div().flex_1().child(self.comment.clone()))
                            .child(Button::new("team-comment", "Comment").disabled(!can_post).on_click(cx.listener(|this, _, _, cx| this.post(CommentKind::Comment, cx)))),
                    )
                    .scrollbar(_window, cx)
                    .into_any_element()
            }
        };

        div()
            .id("team-session-view")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .font_family(typography::UI_FONT)
            .child(
                pane_header(cx)
                    .child(match header_detail {
                        Some(detail) => PaneTitle::new(self.title.clone()).icon(IconName::Users).detail(detail),
                        None => PaneTitle::new(self.title.clone()).icon(IconName::Users),
                    })
                    .children(badge.map(|(label, tone)| widgets::badge(label, Some(tone), cx)))
                    .child(actions),
            )
            .child(body)
    }
}
