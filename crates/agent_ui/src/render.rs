//! How a session looks: the start screen, the transcript (messages, thoughts, tool calls,
//! notices), the plan, the agent's questions and the composer with its pickers.
//!
//! Drawn after Athas's `features/ai/components/{chat,messages,input}` and `src/ui/{bubble,marker}`.

use std::{path::PathBuf, rc::Rc};

use ui::scale::px;
use gpui::{
    AnyElement, App, ClickEvent, Context, ExternalPaths, FontStyle, FontWeight, HighlightStyle, Hsla, InteractiveText, IntoElement,
    MouseButton, SharedString, StrikethroughStyle, StyledText, UnderlineStyle, Window, div, list, prelude::*,
};
use theme::ActiveTheme;
use ui::WithScrollbar as _;
use ui::{Button, ButtonSize, ButtonTone, ButtonVariant, Icon, IconName, IconSize, MenuEntry, MenuItem, OpenMenu, TooltipExt as _, metrics, typography};

use crate::{
    acp::{agents, schema},
    builtin,
    diff::{self, LineKind},
    mentions::{self, Attachment, FileGroup, Trigger},
    selection::{Selecting, SpanPath},
    session_input::{ComposerAction, CompletionItem},
    markdown::{Block, Inline},
    session_view::{AgentState, SessionView},
    thread::{Entry, NoticeKind, PlanStatus, ToolCall, ToolContent, ToolKind, ToolStatus},
};

/// The transcript's column, as wide as Athas's `chatContentWidth`.
pub(crate) const CONTENT_WIDTH: f32 = 760.;
/// The side padding every page of the session (chat, overview, issues) keeps around its column.
pub(crate) const CONTENT_PADDING: f32 = 24.;
const OUTPUT_LINE_LIMIT: usize = 200;
/// How tall an open tool step grows before its body scrolls.
const TOOL_BODY_MAX_HEIGHT: f32 = 320.;
/// How tall an open group of steps grows before it scrolls: about seven and a half rows, so the
/// cut row shows there is more.
const TOOL_GROUP_MAX_HEIGHT: f32 = 225.;
/// Rows a diff shows inside the transcript before the user asks for the rest (`DIFF_PREVIEW_ROWS`).
const DIFF_PREVIEW_ROWS: usize = 16;
/// A diff row's height; the diff box sets it as its line height.
pub(crate) const DIFF_ROW_HEIGHT: f32 = 19.;
/// A prompt shows this many lines until the user asks for the rest.
const PROMPT_LINES: usize = 8;

impl Render for SessionView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if window.is_window_active() {
            self.seen_at = Some(web_time::Instant::now());
        }
        self.schedule_elapsed_tick(cx);
        self.schedule_waiting_tick(cx);
        if builtin::is_builtin(&self.info.agent) {
            self.load_rules_budget(cx);
        }
        let colors = cx.theme().colors.clone();
        let empty = self.transcript.entries.is_empty();
        // A session taken over from the agent is still loading its history: the new-chat screen
        // ("Where should we begin?", the suggestions, the recent prompts) would say the opposite
        // of what is happening.
        let body = if empty && self.replaying {
            div()
                .id("agent-loading")
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(10.))
                .px(px(24.))
                .child(busy_spinner("agent-loading", colors.subtle_foreground))
                .child(
                    div()
                        .text_size(typography::text_sm())
                        .text_color(colors.muted_foreground)
                        .child(format!("Loading this conversation from {}…", self.agent_name())),
                )
                .into_any_element()
        } else if empty {
            div()
                .id("agent-start")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .px(px(24.))
                .child(
                    div()
                        .w_full()
                        .max_w(px(680.))
                        .flex()
                        .flex_col()
                        .gap(px(20.))
                        .child(
                            div()
                                .w_full()
                                .text_center()
                                .text_size(typography::text_lg())
                                .font_weight(typography::SEMIBOLD)
                                .child("Where should we begin?"),
                        )
                        .children(self.render_agent_state(cx))
                        .child(self.render_composer(window, cx))
                        .child(self.render_shortcuts(cx)),
                )
                .into_any_element()
        } else {
            self.anchor_room = self.last_drawn_entry().and_then(|last| self.anchor_min_height(last));
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                .children(self.render_message_search(cx))
                .child(ui::with_scrollbar(
                    list(self.list.clone(), cx.processor(|this, index: usize, window, cx| this.render_entry(index, window, cx)))
                        .flex_1()
                        .size_full(),
                    ui::Scrollbar::list("transcript-scrollbar", &self.list),
                ))
                .child(
                    div()
                        .flex_none()
                        .w_full()
                        .flex()
                        .justify_center()
                        .px(px(CONTENT_PADDING))
                        .pb(px(12.))
                        .child(
                            div()
                                .w_full()
                                .max_w(px(CONTENT_WIDTH))
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .children(self.render_agent_state(cx))
                                .children(self.render_plan(cx))
                                .children(self.render_review_bar(cx))
                                .children(self.render_permission(cx))
                                .children(self.render_elicitation(window, cx))
                                .child(self.render_composer(window, cx)),
                        ),
                )
                .into_any_element()
        };
        let body = self.with_side_column(body, window, cx);
        div()
            .id("agent-session")
            .group("agent-session")
            .key_context("AgentSession")
            // The whole chat takes a drop, not only the composer: a file dropped on the
            // transcript is as clearly meant for the next prompt as one dropped on the box.
            .drag_over::<ExternalPaths>(|style, _, _, _| style)
            .on_drop(cx.listener(|this, paths: &ExternalPaths, _, cx| this.attach_paths(paths.paths().to_vec(), cx)))
            .drag_over::<ui::DraggedResource>(|style, _, _, _| style)
            .on_drop(cx.listener(|this, resource: &ui::DraggedResource, _, cx| this.attach_dragged_resource(resource, cx)))
            .drag_over::<file_tree::DraggedEntry>(|style, _, _, _| style)
            .on_drop(cx.listener(|this, entry: &file_tree::DraggedEntry, _, cx| this.attach_dragged_entry(entry, cx)))
            // A press anywhere puts the transcript's selection away, unless it is about to
            // extend it; the run of text pressed then starts a new one as the press bubbles.
            .capture_any_mouse_down(cx.listener(|this, event: &gpui::MouseDownEvent, _, cx| {
                if event.button == MouseButton::Left {
                    this.clear_text_selection(event.modifiers.shift, cx);
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _: &gpui::MouseUpEvent, _, _| this.end_text_selection()))
            .on_action(cx.listener(SessionView::copy_text_selection))
            .on_action(cx.listener(|this, _: &crate::review::KeepAllAgentChanges, _, cx| this.review_all(true, cx)))
            .on_action(cx.listener(|this, _: &crate::review::RejectAllAgentChanges, _, cx| this.review_all(false, cx)))
            .on_action(cx.listener(|this, _: &crate::review::ReviewAgentChanges, _, cx| this.open_review(cx)))
            .on_action(cx.listener(|this, _: &crate::session_commands::OpenChatTranscript, _, cx| this.open_chat_transcript(cx)))
            .on_action(cx.listener(|this, _: &crate::session_commands::ToggleFollowAgent, _, cx| this.toggle_follow_agent(cx)))
            .on_action(cx.listener(|this, _: &crate::session_commands::CycleAgentMode, _, cx| this.cycle_mode(cx)))
            .on_action(cx.listener(|this, _: &crate::session_commands::LogOutOfAgent, _, cx| this.log_out_of_agent(cx)))
            .on_action(cx.listener(|this, _: &crate::session_commands::RestartAgent, _, cx| this.restart_agent(cx)))
            .on_action(cx.listener(|this, _: &crate::session_commands::OpenAgentCliInTerminal, _, cx| this.open_agent_cli(cx)))
            .on_action(cx.listener(|this, _: &crate::message_search::SearchMessages, window, cx| this.toggle_message_search(window, cx)))
            .size_full()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::ui_font())
            .text_size(typography::text_base())
            .text_color(colors.foreground)
            .child(body)
            .child(self.render_session_drop_hint(cx))
            .children(self.render_effort_popover(cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

impl SessionView {
    /// The sheet that says the chat takes what is being dragged, over the whole view. It never
    /// takes the mouse itself: the composer's own drop target stays in front of it.
    fn render_session_drop_hint(&self, cx: &Context<Self>) -> impl IntoElement {
        let colors = colors(cx);
        div()
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(colors.background.opacity(0.8))
            .invisible()
            .group_drag_over::<ExternalPaths>("agent-session", |style| style.visible())
            .group_drag_over::<ui::DraggedResource>("agent-session", |style| style.visible())
            .group_drag_over::<file_tree::DraggedEntry>("agent-session", |style| style.visible())
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(16.))
                    .py(px(12.))
                    .rounded(metrics::radius_xl())
                    .border_1()
                    .border_color(colors.primary)
                    .bg(colors.primary_soft)
                    .text_size(typography::text_sm())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.primary)
                    .child(Icon::new(IconName::FilePlus).size(IconSize::Small).color(colors.primary))
                    .child("Drop to add as context"),
            )
    }
}

impl SessionView {
    fn render_entry(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(entry) = self.transcript.entries.get(index).cloned() else { return div().into_any_element() };
        // A step of a group is drawn by the group's first entry, which also notes its text.
        if self.folded_away(index) {
            return div().into_any_element();
        }
        // The runs of text this entry draws are noted as they are drawn, for the selection.
        self.forget_drawn_runs(index);
        if let Some(run) = crate::tool_groups::run_at(&self.transcript.entries, index) {
            for step in run {
                self.forget_drawn_runs(step);
            }
        }
        let first = index == 0;
        // The last entry that draws anything: a group at the end is drawn by its first entry.
        let last = self.last_drawn_entry() == Some(index);
        // Measured in `render`, before the list lays out: reading the list's state from inside
        // its own item callback panics (the list holds its state mutably while it lays out).
        let pinned_room = if last { self.anchor_room } else { None };
        // A user message starts a turn: more room above it. A reply the agent writes as several
        // messages, with nothing between them, reads as one: no gap, no second block.
        let joined = matches!(entry, Entry::Agent(_)) && matches!(self.transcript.entries.get(index.wrapping_sub(1)), Some(Entry::Agent(_)));
        let top = match entry {
            Entry::User(_) if !first => px(20.),
            _ if first => px(16.),
            _ if joined => px(0.),
            _ => px(6.),
        };
        let content = match entry {
            Entry::User(message) => self.render_user_message(index, &message, cx),
            Entry::Agent(message) => self.render_agent_message(index, &message.text, cx),
            Entry::Thought(_) | Entry::ToolCall(_) => {
                match self.render_group_header(index, cx) {
                    // A group: its summary, and while open all its steps in one box that shows
                    // about eight rows and scrolls the rest. It follows the newest step while the
                    // agent works.
                    Some(header) => {
                        let steps: Vec<AnyElement> = self
                            .open_run_at(index)
                            .into_iter()
                            .flatten()
                            .filter_map(|step| match self.transcript.entries.get(step) {
                                Some(Entry::ToolCall(call)) => Some(self.render_tool_call(step, call, false, window, cx)),
                                Some(Entry::Thought(thought)) => Some(self.render_thought(step, &thought.text, cx)),
                                _ => None,
                            })
                            .collect();
                        let body = (!steps.is_empty()).then(|| {
                            let (handle, seen) = window
                                .use_keyed_state(("tool-group-scroll", index), cx, |_, _| (gpui::ScrollHandle::new(), Rc::new(std::cell::Cell::new(0usize))))
                                .read(cx)
                                .clone();
                            // Follow a new step while the turn runs; otherwise leave the scroll where the user put it.
                            if steps.len() > seen.get() {
                                if self.is_running() && seen.get() > 0 {
                                    handle.scroll_to_bottom();
                                }
                                seen.set(steps.len());
                            }
                            div()
                                .id(("tool-group-steps", index))
                                .max_h(px(TOOL_GROUP_MAX_HEIGHT))
                                .overflow_y_scroll()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .min_w_0()
                                .children(steps)
                                .scrollbar_with(&handle)
                        });
                        div().flex().flex_col().gap(px(6.)).child(header).children(body).into_any_element()
                    }
                    None => div().into_any_element(),
                }
            }
            Entry::Notice(notice) if notice.kind == NoticeKind::Error => self.render_error(index, &notice.text, cx),
            Entry::Notice(notice) if notice.kind == NoticeKind::Warning => self.render_stop_notice(index, &notice.text, cx),
            Entry::Notice(notice) => {
                let sel = self.selecting(cx);
                render_notice(notice.kind, &notice.text, SpanPath::entry(index).child(0), &sel, cx)
            }
        };
        div()
            .w_full()
            .flex()
            .justify_center()
            .px(px(CONTENT_PADDING))
            .pt(top)
            .when(last, |this| this.pb(px(16.)))
            .when_some(pinned_room, |this, room| this.min_h(room).items_start())
            .child({
                let (active, matched) = self.message_match_state(index);
                let colors = cx.theme().colors.clone();
                div()
                    .w_full()
                    .max_w(px(CONTENT_WIDTH))
                    .min_w_0()
                    .when(matched, |this| this.p(px(6.)).rounded(metrics::island_radius()).border_1().border_color(if active { colors.primary } else { colors.border }))
                    .child(content)
            })
            .into_any_element()
    }

    /// A failed turn: its headline and next step, what can be done about it, and the raw error
    /// on request (`ChatErrorBlock`).
    /// `AgentStopNotice`: why the turn ended early, as a warning with what to do next. The
    /// latest one cut short by a limit offers Continue (`getAgentStopFollowUpActions`).
    fn render_stop_notice(&self, index: usize, text: &str, cx: &mut Context<Self>) -> AnyElement {
        let notice = crate::stop_notice::StopNotice::from_text(text);
        let (title, description) = match notice {
            Some(notice) => (notice.title().to_string(), notice.description().to_string()),
            None => text.split_once('\n').map_or((text.to_string(), String::new()), |(title, rest)| (title.to_string(), rest.to_string())),
        };
        let latest = !self.is_running() && !self.transcript.entries[index + 1..].iter().any(|entry| matches!(entry, Entry::User(_) | Entry::Agent(_)));
        let alert = ui::Alert::new().tone(ui::Tone::Warning).icon(IconName::Warning).title(title).when(!description.is_empty(), |alert| alert.description(description));
        let alert = if latest && notice.is_some_and(|notice| notice.can_continue()) {
            alert.action(
                Button::new(("stop-continue", index), "Continue")
                    .leading_icon(IconName::Play)
                    .size(ButtonSize::Small)
                    .tooltip(crate::stop_notice::CONTINUE_PROMPT)
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.send(crate::stop_notice::CONTINUE_PROMPT.to_string(), cx))),
            )
        } else {
            alert
        };
        alert.into_any_element()
    }

    fn render_error(&self, index: usize, text: &str, cx: &mut Context<Self>) -> AnyElement {
        use crate::turn_error::Action;
        let is_acp = !builtin::is_builtin(&self.info.agent);
        let hosted = !is_acp
            && cx.try_global::<settings::SettingsStore>().is_some_and(|_| builtin::session_provider(crate::intelligence::task_provider(settings::get(cx), "agent"), &self.transcript).provider_id == "athas");
        let offline = self.offline_errors.contains(&(index, text.to_string()));
        let failure = crate::turn_error::describe_for(text, is_acp, offline, hosted);
        let auth_choice = (self.auth_choice_entry() == Some(index)).then(|| self.render_auth_choice_inline(cx)).flatten();
        if auth_choice.is_none() && failure.title == "Error" && failure.details.is_empty() && failure.actions.is_empty() {
            // An agent that stops on a limit says so in its reply and then fails the turn with the
            // same words; the line in red adds nothing but a second answer to read.
            if said_already(&self.transcript.entries[..index], text) {
                return div().into_any_element();
            }
            let sel = self.selecting(cx);
            return render_notice(NoticeKind::Error, text, SpanPath::entry(index).child(0), &sel, cx);
        }
        let colors = colors(cx);
        let key = format!("error-details-{index}");
        let open = self.expanded.contains(&key);
        let latest = !self.transcript.entries[index + 1..].iter().any(|entry| matches!(entry, Entry::User(_)));
        let mut buttons: Vec<AnyElement> = Vec::new();
        let can_retry = failure.actions.contains(&Action::Retry) && latest && !self.is_running();
        if failure.provider_settings {
            use crate::turn_error::Recovery;
            let (recovery, label, model_settings) = failure.recovery(hosted, can_retry);
            let signing_in = recovery == Recovery::SignIn && account::AccountStore::global(cx).is_some_and(|store| store.read(cx).state().login_url().is_some());
            buttons.push(
                Button::new(("error-recover", index), if signing_in { "Waiting for browser…" } else { label })
                    .size(ButtonSize::Small)
                    .disabled(signing_in)
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| match &recovery {
                        Recovery::StartNewChat => cx.defer(|cx| {
                            if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action("agent.newChat")) {
                                cx.dispatch_action(action.as_ref());
                            }
                        }),
                        Recovery::OpenBilling(url) => {
                            let urls = account::urls(cx);
                            cx.open_url(&crate::turn_error::resolve_billing_url(url.as_deref(), &urls.api_base, &urls.website, &urls.billing()));
                        }
                        Recovery::SignIn => {
                            if let Some(store) = account::AccountStore::global(cx) {
                                store.update(cx, |store, cx| store.sign_in(cx));
                            }
                        }
                        Recovery::ConfigureProvider => {
                            let provider = cx
                                .try_global::<settings::SettingsStore>()
                                .map(|_| builtin::session_provider(crate::intelligence::task_provider(settings::get(cx), "agent"), &this.transcript).provider_id);
                            workbench_api::open_provider_api_key(cx, provider.as_deref());
                        }
                        Recovery::ConfigureModels => workbench_api::open_settings(cx, Some("ai"), None),
                        Recovery::Retry => this.retry_turn_before(index, cx),
                    }))
                    .into_any_element(),
            );
            if signing_in {
                buttons.push(
                    Button::new(("error-reopen-sign-in", index), "Open sign-in page")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .on_click(|_, _, cx| {
                            if let Some(store) = account::AccountStore::global(cx) {
                                store.update(cx, |store, cx| store.reopen_sign_in(cx));
                            }
                        })
                        .into_any_element(),
                );
                buttons.push(
                    Button::new(("error-cancel-sign-in", index), "Cancel")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .on_click(|_, _, cx| {
                            if let Some(store) = account::AccountStore::global(cx) {
                                store.update(cx, |store, cx| store.cancel_sign_in(cx));
                            }
                        })
                        .into_any_element(),
                );
            } else if model_settings {
                buttons.push(
                    Button::new(("error-model-settings", index), "Model settings")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .on_click(|_, _, cx| workbench_api::open_settings(cx, Some("ai"), None))
                        .into_any_element(),
                );
            }
        }
        for action in &failure.actions {
            let button = match action {
                Action::Retry if failure.provider_settings => continue,
                Action::Retry if can_retry => Button::new(("error-retry", index), "Try again")
                    .leading_icon(IconName::ArrowClockwise)
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.retry_turn_before(index, cx))),
                Action::RestartAgent | Action::OpenAgentTerminal if auth_choice.is_some() => continue,
                Action::RestartAgent => Button::new(("error-restart", index), "Restart agent session")
                    .leading_icon(IconName::Terminal)
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.restart_agent(cx))),
                Action::OpenAgentTerminal => Button::new(("error-terminal", index), "Open agent terminal")
                    .variant(ButtonVariant::Ghost)
                    .leading_icon(IconName::Terminal)
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.open_agent_cli(cx))),
                Action::Retry => continue,
            };
            buttons.push(button.size(ButtonSize::Small).into_any_element());
        }
        if !failure.details.is_empty() {
            buttons.push(
                Button::new(("error-details", index), if open { "Hide details" } else { "Details" })
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .leading_icon(if open { IconName::ChevronDown } else { IconName::ChevronRight })
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle_expanded(key.clone(), index, cx)))
                    .into_any_element(),
            );
        }
        let details = failure.details.clone();
        let card = div()
            .flex()
            .items_start()
            .gap(px(8.))
            .px(px(10.))
            .py(px(8.))
            .rounded(metrics::radius_lg())
            .bg(colors.destructive_soft)
            .text_size(typography::text_sm())
            .line_height(px(19.))
            .child(div().pt(px(2.)).child(Icon::new(IconName::WarningCircle).size(IconSize::Medium).color(colors.destructive)))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(
                        div()
                            .flex()
                            .gap(px(6.))
                            .child(div().font_weight(typography::MEDIUM).text_color(colors.destructive).child(failure.title.clone()))
                            .children(failure.code.clone().map(|code| div().text_color(colors.subtle_foreground).child(code))),
                    )
                    .when(failure.message != failure.title, |this| {
                        let sel = self.selecting(cx);
                        this.child(div().text_color(colors.muted_foreground).child(selectable_text(&failure.message, SpanPath::entry(index).child(0), &sel, cx)))
                    })
                    .when(!buttons.is_empty(), |this| this.child(div().mt(px(6.)).flex().flex_wrap().items_center().gap(px(6.)).children(buttons)))
                    .children(failure.setup_hint.filter(|_| auth_choice.is_none()).map(|hint| div().mt(px(4.)).text_color(colors.muted_foreground).child(hint)))
                    .children(auth_choice.map(|choice| div().mt(px(6.)).child(choice)))
                    .when(open, |this| {
                        let sel = self.selecting(cx);
                        this.child(div().mt(px(6.)).child(code_box(&details, SpanPath::entry(index).child(1), &sel, cx)))
                    }),
            );
        card.into_any_element()
    }

    fn render_user_message(&self, index: usize, message: &crate::thread::UserMessage, cx: &mut Context<Self>) -> AnyElement {
        let text = message.text.as_str();
        let colors = cx.theme().colors.clone();
        let chips: Vec<AnyElement> = message
            .attachments
            .iter()
            .map(|path| {
                let label = path.to_string_lossy();
                let (icon, label) = match label.strip_prefix('@') {
                    Some(session) => (IconName::ChatBubbleText, session.to_string()),
                    None if label.starts_with('/') && !label[1..].contains('/') => (IconName::BookOpen, label.into_owned()),
                    None if mentions::image_media_type(path).is_some() && !path.is_absolute() => (IconName::Image, label.into_owned()),
                    None => (IconName::File, path.file_name().map_or_else(|| label.to_string(), |name| name.to_string_lossy().into_owned())),
                };
                attachment_chip(icon, label, cx).into_any_element()
            })
            .collect();
        let thumbnails: Vec<AnyElement> = message
            .images
            .iter()
            .enumerate()
            .filter_map(|(position, image)| {
                let decoded = self.thumbnail(image)?;
                Some(
                    div()
                        .id(SharedString::from(format!("prompt-image-{index}-{position}")))
                        .size(px(64.))
                        .flex_none()
                        .overflow_hidden()
                        .rounded(metrics::radius_md())
                        .border_1()
                        .border_color(colors.border)
                        .child(gpui::img(decoded).size_full().object_fit(gpui::ObjectFit::Cover))
                        .anchored_tooltip({
                            let text: SharedString = format!("Attached image {}", position + 1).into();
                            move || ui::Tooltip::new(text.clone())
                        })
                        .into_any_element(),
                )
            })
            .collect();
        let query = self.message_search.as_ref().map(|search| search.input.read(cx).text().trim().to_lowercase()).unwrap_or_default();
        let matched = !query.is_empty() && text.to_lowercase().contains(&query);
        let long = prompt_is_long(text);
        let key = format!("prompt-{index}");
        let open = matched || self.expanded.contains(&key);
        let mut highlights = Vec::new();
        if !query.is_empty() {
            let lowered = text.to_lowercase();
            if lowered.len() == text.len() {
                let style = HighlightStyle { background_color: Some(colors.primary.opacity(0.25)), ..Default::default() };
                highlights = lowered.match_indices(query.as_str()).map(|(at, found)| (at..at + found.len(), style)).collect();
            }
        }
        let path = SpanPath::entry(index).child(0);
        let body = StyledText::new(text.to_string()).with_highlights(self.selecting(cx).highlights(&path, text, highlights));
        let layout = body.layout().clone();
        let copy = text.to_string();
        let restorable = self.checkpoint_turns.contains(&index) && !self.is_running();
        let sent_at = message.time_of_day();
        div()
            .id(("user-turn", index))
            .group("user-turn")
            .w_full()
            .flex()
            .flex_col()
            .items_end()
            .gap(px(4.))
            .when(!thumbnails.is_empty(), |this| this.child(div().flex().flex_wrap().justify_end().gap(px(6.)).max_w(gpui::relative(0.85)).children(thumbnails)))
            .when(!chips.is_empty(), |this| this.child(div().flex().flex_wrap().justify_end().gap(px(4.)).max_w(gpui::relative(0.85)).children(chips)))
            .child(
                div()
                    .id(("user-message", index))
                    .max_w(gpui::relative(0.85))
                    .min_w_0()
                    .px(px(12.))
                    .py(px(8.))
                    .rounded(metrics::radius_lg())
                    .bg(colors.accent)
                    .text_color(colors.foreground)
                    .line_height(px(20.))
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(px(4.))
                    .child(
                        crate::selection::draggable(div().min_w_0(), path, layout, cx)
                            .when(long && !open, |this| this.max_h(px(20. * PROMPT_LINES as f32)).overflow_hidden())
                            .child(body),
                    )
                    .when(long && !matched, |this| {
                        this.child(
                            Button::new(("prompt-more", index), if open { "Show less" } else { "Show more" })
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::XSmall)
                                .leading_icon(if open { IconName::ChevronUp } else { IconName::ChevronDown })
                                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle_expanded(key.clone(), index, cx))),
                        )
                    }),
            )
            .when(!self.is_running(), |this| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .min_h(px(24.))
                        .gap(px(2.))
                        .text_size(typography::text_sm())
                        .text_color(colors.subtle_foreground)
                        .invisible()
                        .group_hover("user-turn", |style| style.visible())
                        .children(sent_at.map(|time| div().px(px(4.)).child(time)))
                        .child(
                            Button::icon(("copy-prompt", index), IconName::Copy)
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::XSmall)
                                .tooltip("Copy prompt")
                                .on_click(move |_, _, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(copy.clone()))),
                        )
                        .child(
                            Button::icon(("edit-prompt", index), IconName::PencilLine)
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::XSmall)
                                .tooltip("Edit and send again")
                                .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| this.edit_prompt(index, window, cx))),
                        )
                        .when(restorable, |this| {
                            this.child(
                                Button::new(("restore-checkpoint", index), "Restore checkpoint")
                                    .variant(ButtonVariant::Ghost)
                                    .size(ButtonSize::XSmall)
                                    .leading_icon(IconName::ArrowCounterClockwise)
                                    .tooltip("Put the files back as they were before this message")
                                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.restore_checkpoint(index, cx))),
                            )
                        }),
                )
            })
            .into_any_element()
    }

    fn render_agent_message(&self, index: usize, text: &str, cx: &mut Context<Self>) -> AnyElement {
        let (text, follow_ups) = crate::follow_ups::extract(text);
        let text = text.as_str();
        let plan = crate::plan_block::has_plan_block(text).then(|| crate::plan_block::parse_plan(text)).flatten();
        let blocks = self.markdown(index, text);
        let colors = cx.theme().colors.clone();
        let running_last = self.is_running() && index + 1 == self.transcript.entries.len();
        let last_answer = !self.is_running() && !self.transcript.entries[index + 1..].iter().any(|entry| matches!(entry, Entry::Agent(_) | Entry::User(_)));
        let chips: Vec<AnyElement> = if last_answer {
            follow_ups
                .into_iter()
                .enumerate()
                .map(|(chip, action)| {
                    let prompt = action.prompt.clone();
                    Button::new(("follow-up", chip), action.label.clone())
                        .leading_icon(action.icon_name())
                        .variant(ButtonVariant::Default)
                        .size(ButtonSize::Small)
                        .tooltip(action.prompt.clone())
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.send(prompt.clone(), cx)))
                        .into_any_element()
                })
                .collect()
        } else {
            Vec::new()
        };
        let views: Vec<AnyElement> = match &self.transcript.entries[index] {
            Entry::Agent(message) => message
                .ui
                .iter()
                .enumerate()
                .filter_map(|(view_index, view)| crate::extension_hooks::generative_view(&format!("{}-m{index}-{view_index}", self.info.id), view, cx))
                .map(|view| view.into_any_element())
                .collect(),
            _ => Vec::new(),
        };
        let images: Vec<AnyElement> = match &self.transcript.entries[index] {
            Entry::Agent(message) => message
                .images
                .iter()
                .enumerate()
                .filter_map(|(position, image)| {
                    let decoded = self.thumbnail(image)?;
                    Some(
                        div()
                            .id(SharedString::from(format!("reply-image-{index}-{position}")))
                            .size(px(96.))
                            .flex_none()
                            .overflow_hidden()
                            .rounded(metrics::radius_md())
                            .border_1()
                            .border_color(colors.border)
                            .child(gpui::img(decoded).size_full().object_fit(gpui::ObjectFit::Cover))
                            .anchored_tooltip({
                                let text: SharedString = format!("Generated image {} · {}", position + 1, image.media_type).into();
                                move || ui::Tooltip::new(text.clone())
                            })
                            .into_any_element(),
                    )
                })
                .collect(),
            _ => Vec::new(),
        };
        let reply_actions = (!running_last).then(|| self.render_reply_actions(index, &colors, cx)).flatten();
        div()
            .id(("agent-message", index))
            .group(TURN_TAIL)
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(8.))
            .line_height(px(20.))
            .when(!images.is_empty(), |this| this.child(div().flex().flex_wrap().gap(px(6.)).children(images)))
            .when(!views.is_empty(), |this| this.child(div().flex().flex_col().gap(px(8.)).children(views)))
            .map(|this| match &plan {
                Some(plan) => this.child(self.render_plan_block(index, plan, running_last, cx)),
                None => {
                    let sel = self.selecting(cx);
                    this.children(render_blocks(&blocks, &SpanPath::entry(index).child(0), &sel, cx))
                }
            })
            .when(!chips.is_empty(), |this| this.child(div().flex().flex_wrap().gap(px(6.)).children(chips)))
            .children(self.render_cloud_tool_calls(index, cx))
            .children(self.render_cloud_run_actions(index, cx))
            // While the reply is still being written it has no row yet: the words under it keep
            // moving, and half a reply is not one to copy or fork from.
            .children(reply_actions)
            .text_color(colors.foreground)
            .into_any_element()
    }

    /// Starts a session of this one's history up to and including `index`. The fork gets its own
    /// copy of the transcript, cut there, so neither conversation can disturb the other.
    fn fork_from(&mut self, index: usize, cx: &mut Context<Self>) {
        let mut transcript = self.transcript.clone();
        transcript.entries.truncate(index + 1);
        let title = crate::summary::fork_title(&self.info.title);
        cx.emit(crate::SessionViewEvent::Fork { title, transcript: Box::new(transcript) });
    }

    /// What one reply said, as Copy writes it out: its own words, without the follow-up block.
    fn reply_text(&self, index: usize) -> String {
        match self.transcript.entries.get(index) {
            Some(Entry::Agent(message)) => crate::follow_ups::extract(&message.text).0.trim().to_string(),
            _ => String::new(),
        }
    }

    /// The row under a reply, on hover: Copy, Fork chat from here, and when it arrived.
    ///
    /// It used to belong to the *turn* and was drawn under whichever entry happened to end it —
    /// an agent message, or an error notice — and only when the turn had text. An agent that
    /// writes, runs a tool, then writes again makes one turn of several replies, so the row
    /// appeared under the last of them and nowhere else, which read as it appearing at random.
    /// Every reply carries its own row now, and each control means the same thing: this reply.
    fn render_reply_actions(&self, index: usize, colors: &theme::ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let text = self.reply_text(index);
        if text.is_empty() {
            return None;
        }
        let at = match self.transcript.entries.get(index) {
            Some(Entry::Agent(message)) => message.time_of_day(),
            _ => None,
        };
        let copy = text.clone();
        Some(
            div()
                .flex()
                .items_center()
                .min_h(px(24.))
                .gap(px(2.))
                .text_size(typography::text_sm())
                .text_color(colors.subtle_foreground)
                .invisible()
                .group_hover(TURN_TAIL, |style| style.visible())
                .child(
                    Button::icon(("copy-message", index), IconName::Copy)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .tooltip("Copy response as Markdown")
                        .on_click(move |_, _, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(copy.clone()))),
                )
                .child(
                    Button::icon(("fork-chat", index), IconName::GitBranch)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .tooltip("Fork chat from here")
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.fork_from(index, cx))),
                )
                .children(at.map(|time| div().px(px(4.)).child(time)))
                .into_any_element(),
        )
    }

    /// A `[PLAN_BLOCK]` plan between the text around it (`PlanBlockDisplay`): its steps, each
    /// opening on its description, and Execute Plan once the reply is complete.
    fn render_plan_block(&self, index: usize, plan: &crate::plan_block::ParsedPlan, streaming: bool, cx: &mut Context<Self>) -> AnyElement {
        let colors = colors(cx);
        let executing = self.executing_plans.contains(&index);
        let count = plan.steps.len();
        let steps: Vec<AnyElement> = plan
            .steps
            .iter()
            .map(|step| {
                let key = format!("plan-{index}-{}", step.index);
                let expanded = self.expanded.contains(&key);
                let current = executing && step.index == 0;
                let has_description = !step.description.is_empty();
                let (icon, color) = if current { (IconName::Play, colors.primary) } else { (IconName::CircleDotted, colors.subtle_foreground) };
                div()
                    .flex()
                    .flex_col()
                    .rounded(metrics::radius_md())
                    .border_1()
                    .border_color(if current { colors.primary } else { colors.border })
                    .when(current, |this| this.bg(colors.primary_soft))
                    .child(
                        div()
                            .id(SharedString::from(key.clone()))
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .px(px(8.))
                            .py(px(6.))
                            .rounded(metrics::radius_md())
                            .hover(|style| style.bg(colors.accent))
                            .child(Icon::new(icon).size(IconSize::Small).color(color))
                            .child(div().flex_1().min_w_0().font_weight(FontWeight::MEDIUM).text_color(colors.foreground).child(format!("{}. {}", step.index + 1, step.title)))
                            .when(has_description, |this| {
                                this.child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::Small).color(colors.subtle_foreground))
                            })
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                                if has_description {
                                    this.toggle_expanded(key.clone(), index, cx);
                                }
                            })),
                    )
                    .when(expanded && has_description, |this| {
                        let blocks = crate::markdown::parse(&step.description);
                        this.child(
                            div()
                                .border_t_1()
                                .border_color(colors.border)
                                .px(px(12.))
                                .py(px(10.))
                                .text_size(typography::text_sm())
                                .text_color(colors.muted_foreground)
                                .children(render_blocks(&blocks, &SpanPath::entry(index).child(2).child(step.index), &self.selecting(cx), cx)),
                        )
                    })
                    .into_any_element()
            })
            .collect();
        let first = plan.steps.first().cloned();
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .when(!plan.before_plan.is_empty(), |this| this.children(render_blocks(&crate::markdown::parse(&plan.before_plan), &SpanPath::entry(index).child(1), &self.selecting(cx), cx)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .rounded(metrics::radius_lg())
                    .border_1()
                    .border_color(colors.primary)
                    .bg(colors.primary_soft)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .px(px(12.))
                            .pt(px(10.))
                            .pb(px(6.))
                            .text_color(colors.primary)
                            .child(Icon::new(IconName::ListChecks).size(IconSize::Small).color(colors.primary))
                            .child(div().font_weight(FontWeight::MEDIUM).child(format!("Plan ({count} {})", if count == 1 { "step" } else { "steps" }))),
                    )
                    .child(div().flex().flex_col().gap(px(6.)).px(px(12.)).pb(px(10.)).children(steps))
                    .when_some(first.filter(|_| !streaming), |this, first| {
                        this.child(
                            div().flex().px(px(12.)).py(px(8.)).border_t_1().border_color(colors.primary).child(
                                Button::new(("execute-plan", index), "Execute Plan").variant(ButtonVariant::Accent).size(ButtonSize::Small).leading_icon(IconName::Play).on_click(cx.listener(
                                    move |this, _: &ClickEvent, _, cx| {
                                        this.executing_plans.insert(index);
                                        this.entry_changed(index);
                                        this.send(crate::plan_block::execute_step_prompt(&first), cx);
                                    },
                                )),
                            ),
                        )
                    }),
            )
            .when(!plan.after_plan.is_empty(), |this| this.children(render_blocks(&crate::markdown::parse(&plan.after_plan), &SpanPath::entry(index).child(3), &self.selecting(cx), cx)))
            .into_any_element()
    }

    /// The steps a cloud run took, read from its log (`CloudSessionSync`'s tool calls).
    fn render_cloud_tool_calls(&self, index: usize, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::cloud::transcript::CallStatus;
        let calls = self.cloud_tool_calls.get(&index).filter(|calls| !calls.is_empty())?;
        let colors = colors(cx);
        let rows = calls.iter().enumerate().map(|(position, call)| {
            let (icon, color, status) = match call.status {
                CallStatus::InProgress => (IconName::CircleDotted, colors.muted_foreground, Some("Running")),
                CallStatus::Failed => (IconName::WarningCircle, colors.destructive, Some("Failed")),
                CallStatus::Completed => (
                    match call.kind {
                        Some("execute") => IconName::Terminal,
                        Some("edit") => IconName::PencilLine,
                        Some("fetch") => IconName::Globe,
                        _ => IconName::Wrench,
                    },
                    colors.subtle_foreground,
                    None,
                ),
            };
            let detail = call.detail().map(|detail| {
                let line = crate::shell_command::first_line(detail);
                if call.kind == Some("execute") { crate::shell_command::clean_command(line) } else { line.to_string() }
            });
            let duration = call.duration_ms.and_then(|duration| crate::tool_groups::format_duration(Some(duration)));
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .min_h(px(22.))
                .min_w_0()
                .text_size(typography::text_sm())
                .text_color(colors.muted_foreground)
                .child(match call.status {
                    CallStatus::InProgress => busy_spinner(("cloud-call", position), colors.muted_foreground),
                    _ => Icon::new(icon).size(IconSize::Small).color(color).into_any_element(),
                })
                .child(div().flex_none().text_color(colors.foreground).child(call.name.clone()))
                .children(detail.map(|detail| div().min_w_0().flex_shrink(1.).truncate().child(detail)))
                .children(status.map(|status| div().flex_none().text_size(typography::text_caption()).text_color(color).child(status)))
                .children(duration.map(|duration| div().flex_none().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(duration)))
        });
        Some(div().flex().flex_col().gap(px(2.)).children(rows).into_any_element())
    }

    fn render_thought(&self, index: usize, text: &str, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let key = format!("thought-{index}");
        let expanded = self.expanded.contains(&key);
        let thinking = self.is_running() && index + 1 == self.transcript.entries.len();
        let label = if thinking { "Thinking" } else { "Thought" };
        let toggle_key = key.clone();
        div()
            .w_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .id(("thought", index))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(24.))
                    .w_full()
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .hover(|style| style.text_color(colors.foreground))
                    .child(Icon::new(IconName::Brain).size(IconSize::Small).color(if thinking { colors.primary } else { colors.subtle_foreground }))
                    .child(label)
                    .child(disclosure(expanded, colors.subtle_foreground))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle_expanded(toggle_key.clone(), index, cx))),
            )
            .when(expanded, |this| {
                this.child(
                    div()
                        .ml(px(20.))
                        .mt(px(2.))
                        .mb(px(6.))
                        .text_size(typography::text_sm())
                        .line_height(px(19.))
                        .text_color(colors.muted_foreground)
                        .child({
                            let sel = self.selecting(cx);
                            selectable_text(text.trim(), SpanPath::entry(index).child(0), &sel, cx)
                        }),
                )
            })
            .into_any_element()
    }

    /// `capped`: the open body gets its own height limit; a step inside a group is not capped
    /// again, since the group's box already scrolls.
    fn render_tool_call(&self, index: usize, call: &ToolCall, capped: bool, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        use crate::tool_summary::Phase;
        let colors = cx.theme().colors.clone();
        let expanded = self.is_expanded(&call.id, index);
        let body = self.tool_call_body(index, call, cx);
        let has_body = !body.is_empty();
        // A `!` command runs on its own, not with the agent's turn.
        let user_command = call.id.starts_with(crate::session_view::USER_COMMAND_PREFIX);
        let command_running = user_command && self.user_commands.contains_key(&call.id);
        let summary = crate::tool_summary::summarize(call, if user_command { command_running } else { self.is_running() }, self.info.cwd.as_deref());
        let waiting = call.status == ToolStatus::WaitingForPermission;
        let icon: AnyElement = match summary.phase {
            Phase::Background => div().size(px(14.)).flex().items_center().justify_center().child(div().size(px(6.)).rounded_full().bg(colors.success)).into_any_element(),
            // The step is working: the arc turns, rather than a ring of dots standing still.
            Phase::Running if !waiting => busy_spinner(("tool-call", index), colors.muted_foreground),
            phase => {
                let (icon, color) = match phase {
                    Phase::Running => (IconName::Key, colors.warning),
                    Phase::Failed => (IconName::WarningCircle, colors.destructive),
                    _ => (kind_icon(summary.kind), colors.subtle_foreground),
                };
                Icon::new(icon).size(IconSize::Small).color(color).into_any_element()
            }
        };
        let caption = |text: String, color: Hsla| div().flex_none().text_size(typography::text_caption()).text_color(color).child(text).into_any_element();
        let status: Option<AnyElement> = match summary.phase {
            Phase::Failed => Some(caption("Failed".into(), colors.destructive)),
            Phase::Declined => Some(caption("Declined".into(), colors.subtle_foreground)),
            Phase::Cancelled => Some(caption("Cancelled".into(), colors.subtle_foreground)),
            Phase::Running if waiting => Some(caption("Waiting for you".into(), colors.warning)),
            _ if summary.additions + summary.deletions > 0 => Some(
                div()
                    .flex()
                    .flex_none()
                    .gap(px(4.))
                    .text_size(typography::text_caption())
                    .child(div().text_color(colors.git_added).child(format!("+{}", summary.additions)))
                    .child(div().text_color(colors.git_deleted).child(format!("-{}", summary.deletions)))
                    .into_any_element(),
            ),
            Phase::Done => summary.count.map(|count| caption(if count == 1 { "1 result".into() } else { format!("{count} results") }, colors.subtle_foreground)),
            _ => None,
        };
        // A `!` command from the composer reads as `ChatTerminalCommand` does: Stopped, Exit N,
        // Done, or Interrupted when it no longer runs (Athas restarted).
        let command_stopping = command_running && self.user_commands.get(&call.id).is_some_and(|command| command.is_stopping());
        let status = if user_command {
            match call.status {
                _ if command_stopping => Some(caption("Stopping…".into(), colors.subtle_foreground)),
                _ if command_running => Some(caption("Running…".into(), colors.subtle_foreground)),
                _ if call.timed_out => Some(caption("Timed out after 60 seconds".into(), colors.destructive)),
                ToolStatus::Canceled => Some(caption("Stopped".into(), colors.subtle_foreground)),
                ToolStatus::Failed => Some(caption(call.exit_code.map_or_else(|| "Failed".into(), |code| format!("Exit {code}")), colors.destructive)),
                ToolStatus::Completed => Some(caption("Done".into(), colors.subtle_foreground)),
                _ => Some(caption("Interrupted".into(), colors.warning)),
            }
        } else {
            status
        };
        let command_output = call
            .terminal_output
            .as_deref()
            .filter(|_| user_command)
            .map(|output| crate::acp::host::plain_terminal_text(output).trim_end().to_string())
            .filter(|output| !output.is_empty());
        let duration = if summary.phase == Phase::Running { None } else { crate::tool_groups::format_duration(call.duration_ms) };
        let toggle_id = call.id.clone();
        // `canOpenFile`: the file the call is about, at the line a location gives.
        let location = summary.path.clone().filter(|_| summary.kind != ToolKind::Execute).map(|path| {
            let path = match &self.info.cwd {
                Some(cwd) if path.is_relative() => cwd.join(path),
                _ => path,
            };
            let line = call.locations.iter().find(|location| location.path == path).and_then(|location| location.line);
            (path, line)
        });
        // `canOpenDiff`: only the change this call recorded, not one against HEAD.
        let can_open_diff = call.diffs().next().is_some();
        // A thought reads "Thought" with its first line; one on its own reads "Thought for 3s"
        // (`ThoughtRow`).
        let thought = summary.kind == ToolKind::Think;
        let lone_thought = thought && crate::tool_groups::run_at(&self.transcript.entries, index).is_none();
        let thought_text = call
            .content
            .iter()
            .find_map(|content| match content {
                ToolContent::Text { text } => Some(text.trim().lines().next().unwrap_or_default().trim().to_string()),
                _ => None,
            })
            .or_else(|| {
                let text = call.raw_output.as_ref().filter(|_| thought && call.content.is_empty()).map(crate::tool_summary::raw_output_text)?;
                Some(text.trim().lines().next().unwrap_or_default().trim().to_string())
            });
        let (verb, target) = if lone_thought {
            (duration.as_ref().map_or_else(|| "Thought".to_string(), |duration| format!("Thought for {duration}")), None)
        } else if thought {
            ("Thought".to_string(), thought_text.filter(|line| !line.is_empty()))
        } else {
            (summary.verb.clone(), summary.target.clone())
        };
        let duration = if lone_thought { None } else { duration };
        let running_text = summary.phase == Phase::Running && !waiting;
        div()
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .id(("tool-call", index))
                    .group("tool-row")
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .min_h(px(24.))
                    .w_full()
                    .min_w_0()
                    .text_size(typography::text_sm())
                    .text_color(colors.muted_foreground)
                    .when(has_body, |this| {
                        this.hover(|style| style.text_color(colors.foreground))
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle_expanded(toggle_id.clone(), index, cx)))
                    })
                    .child(icon)
                    .child(
                        div()
                            .min_w_0()
                            .flex_shrink(1.)
                            .truncate()
                            .child(
                                div()
                                    .flex()
                                    .items_baseline()
                                    .gap(px(4.))
                                    .min_w_0()
                                    // A running step's text shimmers (`<Shimmer active={isRunning}>`).
                                    .child(
                                        div()
                                            .flex_none()
                                            .child(ui::Shimmer::new(("tool-verb", index), verb).active(running_text)),
                                    )
                                    .children(target.map(|target| {
                                        div()
                                            .min_w_0()
                                            .truncate()
                                            .text_color(if thought { colors.subtle_foreground } else { colors.foreground })
                                            .child(ui::Shimmer::new(("tool-target", index), target).active(running_text))
                                    })),
                            ),
                    )
                    .children(status)
                    .children(duration.map(|duration| div().flex_none().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(duration)))
                    .when(has_body, |this| this.child(disclosure(expanded, colors.subtle_foreground)))
                    .when(command_running || command_output.is_some(), |this| {
                        let call_id = call.id.clone();
                        this.child(
                            div()
                                .flex_none()
                                .flex()
                                .items_center()
                                .when(command_running, |this| {
                                    this.child(
                                        Button::icon(("stop-command", index), IconName::Stop)
                                            .variant(ButtonVariant::Ghost)
                                            .size(ButtonSize::XSmall)
                                            .tooltip("Stop command")
                                            .disabled(command_stopping)
                                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.stop_user_command(&call_id, cx))),
                                    )
                                })
                                .children(command_output.map(|output| {
                                    Button::icon(("copy-command-output", index), IconName::Copy)
                                        .variant(ButtonVariant::Ghost)
                                        .size(ButtonSize::XSmall)
                                        .tooltip("Copy command output")
                                        .on_click(move |_, _, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(output.clone())))
                                })),
                        )
                    })
                    .when(can_open_diff || location.is_some(), |this| {
                        let call_id = call.id.clone();
                        this.child(
                            div()
                                .flex_none()
                                .flex()
                                .items_center()
                                .invisible()
                                .group_hover("tool-row", |style| style.visible())
                                .when(can_open_diff, |this| {
                                    this.child(
                                        Button::icon(("open-diff", index), IconName::GitDiff)
                                            .variant(ButtonVariant::Ghost)
                                            .size(ButtonSize::XSmall)
                                            .tooltip("Open diff")
                                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.open_tool_diff(&call_id, cx))),
                                    )
                                })
                                .children(location.map(|(path, line)| {
                                    Button::icon(("open-location", index), IconName::FileText)
                                        .variant(ButtonVariant::Ghost)
                                        .size(ButtonSize::XSmall)
                                        .tooltip("Open file")
                                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.open_location(path.clone(), line, cx)))
                                })),
                        )
                    }),
            )
            .when(expanded && has_body, |this| {
                // One height for every open step; longer output scrolls inside it.
                this.child(
                    div()
                        .id(("tool-call-body", index))
                        .ml(px(20.))
                        .mt(px(4.))
                        .mb(px(8.))
                        .when(capped, |this| this.max_h(px(TOOL_BODY_MAX_HEIGHT)))
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .min_w_0()
                        .children(body)
                        .scrollbar(window, cx),
                )
            })
            .into_any_element()
    }

    /// Where the next part of a tool call's body sits among the runs of text the entry draws:
    /// parts go into `body` in reading order, so its length places the one about to be pushed.
    fn part_path(&self, index: usize, body: &[AnyElement]) -> SpanPath {
        SpanPath::entry(index).child(body.len())
    }

    fn tool_call_body(&self, index: usize, call: &ToolCall, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut body = Vec::new();
        // "The prompt above the composer is the request": while a permission asks about this call,
        // its text, diffs, command and files show there, not a second time in the row.
        if self.permissions.iter().any(|permission| permission.tool_call_id == call.id) {
            return body;
        }
        if let Some(command) = call.command()
            && call.kind == ToolKind::Execute
        {
            body.push(code_box(&format!("$ {command}"), self.part_path(index, &body), &self.selecting(cx), cx));
        }
        let diff_count = call.diffs().count();
        // `showInput`: the arguments of a tool Athas has no words for, and of a mode switch.
        let kind = crate::tool_summary::summarize(call, false, None).kind;
        let input_text = matches!(kind, ToolKind::Other | ToolKind::SwitchMode)
            .then(|| call.raw_input.as_ref())
            .flatten()
            .filter(|input| !input.is_null() && input.as_object().is_none_or(|object| !object.is_empty()))
            .map(|input| match input {
                serde_json::Value::String(text) => text.clone(),
                input => serde_json::to_string_pretty(input).unwrap_or_default(),
            });
        let mut input_shown = false;
        for (content_index, content) in call.content.iter().enumerate() {
            if !matches!(content, ToolContent::Diff { .. })
                && !input_shown
                && let Some(input) = &input_text
            {
                body.push(code_box(&last_lines(input, OUTPUT_LINE_LIMIT), self.part_path(index, &body), &self.selecting(cx), cx));
                input_shown = true;
            }
            match content {
                ToolContent::Text { text } if kind == ToolKind::Think => {
                    let path = self.part_path(index, &body);
                    let sel = self.selecting(cx);
                    body.push(
                        div()
                            .text_size(typography::text_sm())
                            .line_height(px(19.))
                            .text_color(colors(cx).muted_foreground)
                            .child(selectable_text(text.trim(), path, &sel, cx))
                            .into_any_element(),
                    );
                }
                ToolContent::Text { text } => {
                    let blocks = Rc::new(crate::markdown::parse(text));
                    let path = self.part_path(index, &body);
                    let sel = self.selecting(cx);
                    body.push(
                        div()
                            .text_size(typography::text_sm())
                            .line_height(px(19.))
                            .text_color(colors(cx).muted_foreground)
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .children(render_blocks(&blocks, &path, &sel, cx))
                            .into_any_element(),
                    );
                }
                ToolContent::Diff { path, old_text, new_text } => {
                    body.push(self.render_diff(index, content_index, path, old_text.as_deref(), new_text, diff_count > 1, cx));
                }
                ToolContent::Terminal { terminal_id } => {
                    if let Some(snapshot) = self.terminal_output(terminal_id) {
                        let output = crate::acp::host::plain_terminal_text(&snapshot.output);
                        let output = output.trim_end();
                        let mut text = format!("$ {}", snapshot.command);
                        if !output.is_empty() {
                            text.push('\n');
                            if snapshot.truncated {
                                text.push_str("…\n");
                            }
                            text.push_str(output);
                        }
                        body.push(code_box(&last_lines(&text, OUTPUT_LINE_LIMIT), self.part_path(index, &body), &self.selecting(cx), cx));
                        // `describeAcpTerminalExit`, under the output once the command ended.
                        if let Some(exit) = &snapshot.exit {
                            let reason = match (&exit.signal, exit.code) {
                                (Some(signal), _) if signal == "released" => "Stopped when the agent released the terminal".to_string(),
                                (Some(signal), _) if signal == "pty_error" => "The terminal failed".to_string(),
                                (Some(signal), _) => format!("Ended by signal {signal}"),
                                (None, Some(code)) => format!("Exited with code {code}"),
                                (None, None) => "Exited".to_string(),
                            };
                            let failed = exit.signal.is_some() || exit.code.is_some_and(|code| code != 0);
                            let palette = colors(cx);
                            body.push(
                                div()
                                    .text_size(typography::text_sm())
                                    .text_color(if failed { palette.destructive } else { palette.subtle_foreground })
                                    .child(reason)
                                    .into_any_element(),
                            );
                        }
                    }
                }
            }
        }
        if !input_shown && let Some(input) = &input_text {
            body.push(code_box(&last_lines(input, OUTPUT_LINE_LIMIT), self.part_path(index, &body), &self.selecting(cx), cx));
        }
        if let Some(output) = &call.terminal_output
            && !output.trim().is_empty()
        {
            body.push(code_box(&last_lines(crate::acp::host::plain_terminal_text(output).trim_end(), OUTPUT_LINE_LIMIT), self.part_path(index, &body), &self.selecting(cx), cx));
        } else if call.id.starts_with(crate::session_view::USER_COMMAND_PREFIX) {
            let text = if self.user_commands.contains_key(&call.id) {
                "Waiting for output…"
            } else if matches!(call.status, ToolStatus::InProgress | ToolStatus::Pending) {
                "This command is no longer running. Type it again to rerun."
            } else {
                "No output"
            };
            body.push(div().text_size(typography::text_sm()).text_color(colors(cx).subtle_foreground).child(text).into_any_element());
        }
        if let Some(rows) = crate::tool_locations::location_tree(&call.locations, self.info.cwd.as_deref()) {
            body.push(self.render_location_tree(index, rows, cx));
        }
        if call.content.is_empty()
            && let Some(output) = &call.raw_output
        {
            // With no content, the raw output reads as text (`getOutputText`).
            let text = crate::tool_summary::raw_output_text(output);
            if !text.trim().is_empty() {
                if kind == ToolKind::Think {
                    let path = self.part_path(index, &body);
                    let sel = self.selecting(cx);
                    body.push(div().text_size(typography::text_sm()).line_height(px(19.)).text_color(colors(cx).muted_foreground).child(selectable_text(text.trim(), path, &sel, cx)).into_any_element());
                } else {
                    body.push(code_box(&last_lines(text.trim_end(), OUTPUT_LINE_LIMIT), self.part_path(index, &body), &self.selecting(cx), cx));
                }
            }
            for (view_index, view) in crate::extension_hooks::structured_views(output).into_iter().enumerate() {
                if let Some(view) = crate::extension_hooks::generative_view(&format!("{}-{view_index}", call.id), view, cx) {
                    body.push(view.into_any_element());
                }
            }
        }
        body
    }

    /// The files a call touches, as a tree; each file opens at its line.
    fn render_location_tree(&self, index: usize, rows: Vec<crate::tool_locations::TreeRow>, cx: &mut Context<Self>) -> AnyElement {
        let colors = colors(cx);
        div()
            .flex()
            .flex_col()
            .text_size(typography::text_sm())
            .children(rows.into_iter().enumerate().map(|(row_index, row)| {
                let (depth, name, open) = match row {
                    crate::tool_locations::TreeRow::Folder { depth, name } => (depth, name, None),
                    crate::tool_locations::TreeRow::File { depth, name, path, line } => (depth, name, Some((path, line))),
                };
                let icon = match open.is_some() {
                    true => extensions::file_icon(&name, px(14.), cx)
                        .unwrap_or_else(|| Icon::new(IconName::FileText).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element()),
                    false => Icon::new(IconName::Folder).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element(),
                };
                let line = open.as_ref().and_then(|(_, line)| *line);
                div()
                    .id(gpui::ElementId::NamedInteger(format!("tool-location-{index}").into(), row_index as u64))
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .h(px(22.))
                    .pl(px(6. + depth as f32 * 14.))
                    .pr(px(6.))
                    .rounded(metrics::radius_md())
                    .text_color(colors.muted_foreground)
                    .child(icon)
                    .child(div().min_w_0().truncate().child(name))
                    .children(line.map(|line| div().flex_none().text_color(colors.subtle_foreground).child(format!("line {line}"))))
                    .when_some(open, |this, (path, line)| {
                        this.hover(|style| style.bg(colors.accent).text_color(colors.foreground))
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.open_location(path.clone(), line, cx)))
                    })
            }))
            .into_any_element()
    }

    /// `ExtensionDiffPreview`: the call's change to one file, a header before each hunk and both
    /// line numbers beside every line, highlighted for the file's language. `caption` names the
    /// file above its lines with the counts (the fold toggle); the tool row already does when the
    /// call edits one file.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn render_diff(
        &self,
        index: usize,
        content_index: usize,
        path: &PathBuf,
        old: Option<&str>,
        new: &str,
        caption: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use crate::diff::NumberedRow;
        let colors = colors(cx);
        let rows = diff::diff_rows(old.unwrap_or(""), new);
        let (added, removed) = diff::stats(&rows);
        let numbered = diff::numbered_rows(&rows);
        // The transcript shows a preview; the whole diff is on the Changes page.
        let fold_key = format!("diff-fold-{index}-{content_index}");
        let folded = caption && self.expanded.contains(&fold_key);
        let shown = numbered.len().min(DIFF_PREVIEW_ROWS);
        let hidden = numbered.len() - shown;
        let display = display_path(path, self.info.cwd.as_deref());
        let open = path.clone();

        // Highlighted as one text so tokens that depend on earlier lines stay right.
        let language = path.extension().map(|extension| extension.to_string_lossy().into_owned());
        let code = numbered[..shown].iter().map(|row| if let NumberedRow::Line { text, .. } = row { text.as_str() } else { "" }).collect::<Vec<_>>().join("\n");
        let spans = code_line_spans(language.as_deref(), &code);
        let theme = cx.theme().clone();
        let lines: Vec<AnyElement> = if numbered.is_empty() {
            // A no-op edit still says so.
            vec![div().px(px(10.)).text_color(colors.subtle_foreground).child("No changes").into_any_element()]
        } else {
            numbered[..shown].iter().enumerate().map(|(row, item)| diff_row(row, item, &spans, &colors, &theme)).collect()
        };
        let diff_box = div()
            .w_full()
            .min_w_0()
            .rounded(metrics::radius_lg())
            .bg(colors.raised)
            .shadow(cx.theme().shadows.raised.clone())
            .overflow_hidden()
            .when(caption, |this| {
                this.child(
                    div()
                        .id(("diff-path", index * 100 + content_index))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .min_h(px(32.))
                        .px(px(10.))
                        .bg(colors.surface)
                        .when(!folded, |this| this.border_b_1().border_color(colors.divider))
                        .text_size(typography::text_sm())
                        .hover(|style| style.bg(colors.accent))
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                            if !this.expanded.remove(&fold_key) {
                                this.expanded.insert(fold_key.clone());
                            }
                            this.entry_changed(index);
                            cx.notify();
                        }))
                        .child(disclosure(!folded, colors.subtle_foreground))
                        .child(div().flex_1().min_w_0().truncate().font_family(typography::MONO_FONT).text_color(colors.foreground).child(display))
                        .when(added > 0, |this| this.child(div().flex_none().text_color(colors.git_added).child(format!("+{added}"))))
                        .when(removed > 0, |this| this.child(div().flex_none().text_color(colors.git_deleted).child(format!("-{removed}"))))
                        .child(
                            Button::icon(("diff-open", index * 100 + content_index), IconName::SquareArrowUp)
                                .size(ButtonSize::XSmall)
                                .tooltip("Open file")
                                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                                    cx.stop_propagation();
                                    this.open_file(open.clone(), cx);
                                })),
                        ),
                )
            })
            .when(!folded, |this| {
                this.child(
                    div()
                        .id(("diff", index * 100 + content_index))
                        .overflow_x_scroll()
                        .bg(colors.background)
                        .font_family(typography::MONO_FONT)
                        .text_size(typography::text_caption())
                        .line_height(px(DIFF_ROW_HEIGHT))
                        .child(div().flex().flex_col().min_w_full().children(lines)),
                )
            });
        div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .min_w_0()
            .child(diff_box)
            .when(hidden > 0 && !folded, |this| {
                this.child(
                    div()
                        .id(("expand-diff", index * 100 + content_index))
                        .self_start()
                        .text_size(typography::text_sm())
                        .text_color(colors.primary)
                        .hover(|style| style.underline())
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.open_review(cx)))
                        .child(format!("Show all {} lines", numbered.len())),
                )
            })
            .into_any_element()
    }

    /// "N files changed" with Review, Reject all and Keep all, while the agent's edits wait.
    fn render_review_bar(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (files, added, removed) = self.review_totals;
        if files == 0 {
            return None;
        }
        let colors = colors(cx);
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .h(px(34.))
                .px(px(10.))
                .rounded(metrics::radius_lg())
                .border_1()
                .border_color(colors.border)
                .bg(colors.raised)
                .text_size(typography::text_sm())
                .child(Icon::new(IconName::GitDiff).size(IconSize::XSmall).color(colors.muted_foreground))
                .child(div().child(format!("{files} {} changed", if files == 1 { "file" } else { "files" })))
                .child(div().text_color(colors.git_added).child(format!("+{added}")))
                .child(div().text_color(colors.git_deleted).child(format!("−{removed}")))
                .child(div().flex_1())
                .child(
                    Button::new("review-reject-all", "Reject all")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.review_all(false, cx))),
                )
                .child(
                    Button::new("review-keep-all", "Keep all")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.review_all(true, cx))),
                )
                .child(
                    Button::new("review-open", "Review")
                        .variant(ButtonVariant::Default)
                        .size(ButtonSize::XSmall)
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.open_review(cx))),
                )
                .into_any_element(),
        )
    }

    /// What keeps the agent from answering: not installed, starting up.
    fn render_agent_state(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let colors = colors(cx);
        match &self.agent {
            AgentState::NotInstalled { name, hint } => Some({
                let registry = crate::agent_registry::AgentRegistry::global(cx);
                let id = agents::catalog_id(&self.info.agent).to_string();
                let (installing, install_error, installable) = {
                    let registry = registry.read(cx);
                    let installable = registry.agent(&id).is_some_and(|agent| agent.unavailable.is_none() && agent.install.is_some());
                    let missing = registry.agent(&id).and_then(|agent| agent.install.as_ref()).and_then(|install| registry.tools().missing_for(&install.runtime));
                    let error = registry.error(&id).map(str::to_string).or_else(|| missing.map(|missing| format!("{missing} to install it here.")));
                    (registry.operation(&id).is_some(), error, installable && missing.is_none())
                };
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .p(px(10.))
                    .rounded(metrics::radius_lg())
                    .bg(colors.warning_soft)
                    .text_size(typography::text_sm())
                    .child(Icon::new(IconName::Warning).size(IconSize::Small).color(colors.warning))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .min_w_0()
                            .child(div().font_weight(typography::MEDIUM).child(format!("{name} is not installed")))
                            .child(div().text_color(colors.muted_foreground).child(format!(
                                "Install it here or from Settings > AI > Agents, or run: {hint}"
                            )))
                            .children(install_error.map(|error| div().text_color(colors.destructive).child(error))),
                    )
                    .child(div().flex_1())
                    .when(installable, |this| {
                        this.child(
                            Button::new("install-agent", if installing { "Installing…" } else { "Install" })
                                .variant(ButtonVariant::Default)
                                .size(ButtonSize::Small)
                                .leading_icon(IconName::Download)
                                .disabled(installing)
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.install_agent(cx))),
                        )
                    })
                    .into_any_element()
            }),
            AgentState::Starting => Some(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(px(24.))
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child(busy_spinner("agent-starting", colors.subtle_foreground))
                    .child(format!("Starting {}…", self.agent_name()))
                    .into_any_element(),
            ),
            _ => {
                let waited = self.awaiting_first_response()?;
                let stalled = waited >= crate::session_view::STILL_WAITING;
                let seconds = waited.as_secs();
                Some(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .h(px(24.))
                        .text_size(typography::text_sm())
                        .text_color(colors.subtle_foreground)
                        .child(busy_spinner("agent-waiting", colors.subtle_foreground))
                        .child(if stalled { "Still waiting for the agent…" } else { "Waiting for response…" })
                        .when(seconds > 0, |this| this.child(crate::tool_groups::format_elapsed(seconds)))
                        .when(stalled, |this| {
                            this.child(
                                Button::new("retry-stalled", "Retry")
                                    .variant(ButtonVariant::Ghost)
                                    .size(ButtonSize::XSmall)
                                    .leading_icon(IconName::ArrowClockwise)
                                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.retry_stalled_turn(cx))),
                            )
                        })
                        .into_any_element(),
                )
            }
        }
    }

    fn render_plan(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.transcript.plan.is_empty() {
            return None;
        }
        let colors = colors(cx);
        let done = self.transcript.plan.iter().filter(|entry| entry.status == PlanStatus::Completed).count();
        let total = self.transcript.plan.len();
        let collapsed = self.plan_collapsed;
        let current = self.transcript.plan.iter().find(|entry| entry.status == PlanStatus::InProgress).map(|entry| entry.content.clone());
        Some(
            div()
                .w_full()
                .flex()
                .flex_col()
                .rounded(metrics::radius_lg())
                .bg(colors.raised)
                .shadow(cx.theme().shadows.raised.clone())
                .text_size(typography::text_sm())
                .child(
                    div()
                        .id("plan-header")
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .h(px(30.))
                        .px(px(10.))
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                            this.plan_collapsed = !this.plan_collapsed;
                            cx.notify();
                        }))
                        .child(Icon::new(IconName::ListChecks).size(IconSize::Small).color(colors.primary))
                        .child(div().font_weight(typography::MEDIUM).child("Plan"))
                        .child(div().text_color(colors.subtle_foreground).child(format!("{done}/{total}")))
                        .when_some(current.filter(|_| collapsed), |this, current| {
                            this.child(div().min_w_0().flex_1().truncate().text_color(colors.muted_foreground).child(current))
                        })
                        .child(div().flex_1())
                        .child(disclosure(!collapsed, colors.subtle_foreground)),
                )
                .when(!collapsed, |this| {
                    this.child(div().flex().flex_col().gap(px(2.)).px(px(10.)).pb(px(8.)).children(self.transcript.plan.iter().map(
                        |entry| {
                            let (icon, color, text) = match entry.status {
                                PlanStatus::Completed => (IconName::CheckCircle, colors.success, colors.subtle_foreground),
                                PlanStatus::InProgress => (IconName::CircleDot, colors.primary, colors.foreground),
                                PlanStatus::Pending => (IconName::CircleDotted, colors.subtle_foreground, colors.muted_foreground),
                            };
                            div()
                                .flex()
                                .items_start()
                                .gap(px(8.))
                                .py(px(2.))
                                .child(div().pt(px(2.)).child(Icon::new(icon).size(IconSize::XSmall).color(color)))
                                .child(
                                    div()
                                        .min_w_0()
                                        .text_color(text)
                                        .when(entry.status == PlanStatus::Completed, |this| this.line_through())
                                        .child(entry.content.clone()),
                                )
                        },
                    )))
                })
                .into_any_element(),
        )
    }

    fn render_permission(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let permission = self.permissions.front()?;
        let colors = colors(cx);
        let queued = self.permissions.len() - 1;
        let options: Vec<AnyElement> = if permission.options.is_empty() {
            // `fallbackOptions`: an agent that sends no options still gets a Deny and an Allow.
            [(false, "Deny", ButtonVariant::Ghost, ButtonTone::Danger, "⎋", "Deny once"), (true, "Allow", ButtonVariant::Default, ButtonTone::Default, "↩", "Allow once")]
                .into_iter()
                .map(|(approved, label, variant, tone, shortcut, tooltip)| {
                    Button::new(("permission-fallback", usize::from(approved)), label)
                        .variant(variant)
                        .tone(tone)
                        .size(ButtonSize::Small)
                        .tooltip(tooltip)
                        .shortcut(shortcut)
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.answer_permission_plainly(approved, cx)))
                        .into_any_element()
                })
                .collect()
        } else {
            permission
                .options
                .iter()
                .enumerate()
                .map(|(index, option)| {
                    let (label, variant, tone) = match option.kind {
                        schema::PermissionOptionKind::AllowOnce => ("Allow", ButtonVariant::Default, ButtonTone::Default),
                        schema::PermissionOptionKind::AllowAlways => ("Always", ButtonVariant::Accent, ButtonTone::Default),
                        schema::PermissionOptionKind::RejectOnce => ("Deny", ButtonVariant::Ghost, ButtonTone::Danger),
                        schema::PermissionOptionKind::RejectAlways => ("Never", ButtonVariant::Ghost, ButtonTone::Danger),
                        _ => (option.name.as_str(), ButtonVariant::Ghost, ButtonTone::Default),
                    };
                    let id = option.option_id.clone();
                    let shortcut = match option.kind {
                        schema::PermissionOptionKind::AllowOnce => Some("↩"),
                        schema::PermissionOptionKind::AllowAlways => Some("⌘↩"),
                        schema::PermissionOptionKind::RejectOnce => Some("⎋"),
                        _ => None,
                    };
                    // `getOptionTooltip`: what the choice means, not the agent's own wording.
                    let tooltip = match option.kind {
                        schema::PermissionOptionKind::AllowOnce => "Allow once".to_string(),
                        schema::PermissionOptionKind::AllowAlways => "Always allow this request type".to_string(),
                        schema::PermissionOptionKind::RejectOnce => "Deny once".to_string(),
                        schema::PermissionOptionKind::RejectAlways => "Always deny this request type".to_string(),
                        _ => option.name.clone(),
                    };
                    let button = Button::new(("permission-option", index), label.to_string())
                        .variant(variant)
                        .tone(tone)
                        .size(ButtonSize::Small)
                        .tooltip(tooltip);
                    let button = match shortcut {
                        Some(shortcut) => button.shortcut(shortcut),
                        None => button,
                    };
                    button
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.answer_permission(id.clone(), cx)))
                        .into_any_element()
                })
                .collect()
        };
        let call = self.transcript.entries.iter().enumerate().rev().find_map(|(index, entry)| match entry {
            Entry::ToolCall(call) if call.id == permission.tool_call_id => Some((index, call)),
            _ => None,
        });
        // `createAcpDiffViewNode`: each file the call would change as its full diff.
        let diffs: Vec<AnyElement> = call
            .map(|(index, call)| {
                call.content
                    .iter()
                    .enumerate()
                    .filter_map(|(content_index, content)| match content {
                        ToolContent::Diff { path, old_text, new_text } => Some(self.render_diff(index, content_index, path, old_text.as_deref(), new_text, true, cx)),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let locations = call.and_then(|(index, call)| crate::tool_locations::location_tree(&call.locations, self.info.cwd.as_deref()).map(|rows| self.render_location_tree(index, rows, cx)));
        let preview = call
            .and_then(|(_, call)| crate::permission_preview::preview(call, self.info.cwd.as_deref()))
            .or_else(|| locations.is_some().then(Default::default));
        let block = |text: String, mono: bool| {
            div()
                .w_full()
                .max_h(px(160.))
                .overflow_hidden()
                .px(px(10.))
                .py(px(6.))
                .rounded(metrics::radius_md())
                .border_1()
                .border_color(colors.border)
                .bg(colors.raised)
                .text_size(typography::text_sm())
                .text_color(colors.muted_foreground)
                .when(mono, |this| this.font_family(typography::MONO_FONT))
                .child(text)
        };
        let preview = preview.map(|preview| {
            div()
                .id("permission-preview")
                .w_full()
                .max_h(px(288.))
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(6.))
                .children(diffs)
                .children(preview.command.map(|command| block(command, true)))
                .children(preview.text.map(|text| block(text, false)))
                .children(preview.input_summary.map(|summary| block(summary, true)))
                .children(locations)
        });
        let bar = div()
            .w_full()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.))
            .px(px(10.))
            .py(px(6.))
            .rounded(metrics::radius_xl())
            .bg(colors.raised)
            .shadow(cx.theme().shadows.raised.clone())
            .text_size(typography::text_sm())
            .child(Icon::new(IconName::Key).size(IconSize::Small).color(colors.subtle_foreground))
            .child(
                // "Permission / what it would do", the summary in the mono face.
                div()
                    .flex_1()
                    .min_w(px(160.))
                    .flex()
                    .items_center()
                    .text_color(colors.foreground)
                    .child(div().flex_none().font_weight(typography::MEDIUM).text_color(colors.muted_foreground).child("Permission"))
                    .child(div().flex_none().px(px(6.)).text_color(colors.subtle_foreground).child("/"))
                    .child(div().min_w_0().truncate().font_family(typography::MONO_FONT).child(if permission.title.is_empty() {
                        "The agent asks for permission".to_string()
                    } else {
                        permission.title.clone()
                    })),
            )
            .when(queued > 0, |this| this.child(ui::Badge::new(format!("+{queued}"))))
            .child(div().ml_auto().flex().flex_none().flex_wrap().justify_end().items_center().gap(px(4.)).children(options));
        Some(div().w_full().flex().flex_col().gap(px(6.)).children(preview).child(bar).into_any_element())
    }

    /// An agent's `elicitation/create`: a form stepped through one field at a time, or a link to
    /// open. Decline lets the agent go on without an answer; Cancel abandons what it was doing.
    fn render_elicitation(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::elicitation::{Link, Mode, QuestionKind, TextKind};
        let queued = self.elicitations.len().checked_sub(1)?;
        let agent = self.agent_name();
        let colors = colors(cx);
        let view = cx.entity().downgrade();
        let pending = self.elicitations.front_mut()?;
        if let Mode::Form { questions, .. } = &pending.elicitation.mode
            && let Some(question) = questions.get(pending.step)
        {
            let wants_input = match &question.kind {
                QuestionKind::Choice { other_field, .. } => other_field.is_some(),
                _ => true,
            };
            if wants_input && !pending.inputs.contains_key(&question.name) {
                let text = pending.answers.get(&question.name).map(|answer| answer.text.clone()).unwrap_or_default();
                let placeholder = match &question.kind {
                    QuestionKind::Choice { .. } => "Something else",
                    QuestionKind::Number { .. } => "A number",
                    QuestionKind::Text { kind: TextKind::Email, .. } => "name@example.com",
                    QuestionKind::Text { kind: TextKind::Url, .. } => "https://",
                    QuestionKind::Text { kind: TextKind::Date, .. } => "YYYY-MM-DD",
                    QuestionKind::Text { kind: TextKind::DateTime, .. } => "YYYY-MM-DDTHH:MM",
                    QuestionKind::Text { .. } => "Your answer",
                };
                let masked = matches!(question.kind, QuestionKind::Text { kind: TextKind::Password, .. });
                let last = pending.step + 1 == questions.len();
                let input = cx.new(|cx| {
                    let mut input = ui::TextInput::new(window, cx).placeholder(placeholder);
                    if masked {
                        input = input.masked();
                    }
                    input.set_text(text, cx);
                    input
                });
                let view = view.clone();
                cx.subscribe(&input, move |_, _, event: &ui::TextInputEvent, cx| {
                    if matches!(event, ui::TextInputEvent::Confirmed) {
                        let _ = view.update(cx, |this, cx| if last { this.answer_elicitation("accept", cx) } else { this.elicitation_step(true, false, cx) });
                    }
                })
                .detach();
                pending.inputs.insert(question.name.clone(), input);
            }
        }
        let pending = self.elicitations.front()?;
        let ghost = |id: &'static str, label: &'static str, tooltip: &'static str, action: &'static str, tone: ButtonTone, cx: &mut Context<Self>| {
            Button::new(id, label)
                .variant(ButtonVariant::Ghost)
                .tone(tone)
                .size(ButtonSize::Small)
                .tooltip(tooltip)
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.answer_elicitation(action, cx)))
        };
        let header_icon = if matches!(pending.elicitation.mode, Mode::Url { .. }) { IconName::Link } else { IconName::Question };
        let mut header = div()
            .flex()
            .items_start()
            .gap(px(8.))
            .child(div().pt(px(2.)).child(Icon::new(header_icon).size(IconSize::Small).color(colors.subtle_foreground)))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(if matches!(pending.elicitation.mode, Mode::Url { .. }) {
                        format!("{agent} asks you to open a link")
                    } else {
                        format!("{agent} is asking")
                    }))
                    .child(div().text_color(colors.foreground).child(pending.elicitation.message.clone())),
            )
            .when(queued > 0, |this| this.child(div().flex_none().text_color(colors.subtle_foreground).child(format!("+{queued}"))));
        let mut body: Vec<AnyElement> = Vec::new();
        match &pending.elicitation.mode {
            Mode::Url { url, link, .. } => {
                if pending.waiting {
                    header = header.child(
                        Button::new("elicitation-dismiss", "Dismiss")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.dismiss_elicitation(cx))),
                    );
                } else {
                    header = header
                        .child(ghost("elicitation-decline", "Decline", "Don't open it; the agent continues without it", "decline", ButtonTone::Default, cx))
                        .child(ghost("elicitation-cancel", "Cancel", "Cancel what the agent was doing", "cancel", ButtonTone::Danger, cx));
                }
                match link {
                    Link::Openable { host, insecure, punycode, .. } => {
                        body.push(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(2.))
                                .child(div().font_weight(FontWeight::MEDIUM).text_color(colors.foreground).child(host.clone()))
                                .child(div().text_size(typography::text_caption()).text_color(colors.muted_foreground).child(url.clone()))
                                .into_any_element(),
                        );
                        if *punycode {
                            body.push(
                                div()
                                    .text_color(colors.warning)
                                    .child("This address uses international characters that can imitate a familiar site. Check it before signing in.")
                                    .into_any_element(),
                            );
                        }
                        if *insecure {
                            body.push(
                                div()
                                    .text_color(colors.warning)
                                    .child("This link is not encrypted (http). Anything you type there can be read on the way.")
                                    .into_any_element(),
                            );
                        }
                        let label = if pending.waiting { "Open again" } else { "Open in browser" };
                        body.push(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .when(pending.waiting, |this| {
                                    this.child(div().flex_1().text_color(colors.muted_foreground).child("Waiting for the agent to hear back…"))
                                })
                                .when(!pending.waiting, |this| this.child(div().flex_1()))
                                .child(
                                    Button::new("elicitation-open", label)
                                        .variant(if pending.waiting { ButtonVariant::Default } else { ButtonVariant::Accent })
                                        .size(ButtonSize::Small)
                                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.open_elicitation_link(cx))),
                                )
                                .into_any_element(),
                        );
                    }
                    Link::Refused(reason) => {
                        body.push(div().text_size(typography::text_caption()).text_color(colors.muted_foreground).child(url.clone()).into_any_element());
                        body.push(div().text_color(colors.destructive).child(reason.clone()).into_any_element());
                    }
                }
            }
            Mode::Form { title, description, questions, unanswerable } => {
                header = header
                    .child(ghost("elicitation-decline", "Decline", "Don't answer; the agent continues without it", "decline", ButtonTone::Default, cx))
                    .child(ghost("elicitation-cancel", "Cancel", "Cancel what the agent was doing", "cancel", ButtonTone::Danger, cx));
                if title.is_some() || description.is_some() {
                    body.push(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .children(title.clone().map(|title| div().font_weight(FontWeight::MEDIUM).text_color(colors.foreground).child(title)))
                            .children(description.clone().map(|description| div().text_color(colors.muted_foreground).child(description)))
                            .into_any_element(),
                    );
                }
                if *unanswerable {
                    body.push(
                        div()
                            .text_color(colors.muted_foreground)
                            .child("This asks for something Athas can't show yet. Decline to let the agent continue without it.")
                            .into_any_element(),
                    );
                } else if let Some(question) = questions.get(pending.step) {
                    let step = pending.step;
                    let total = questions.len();
                    let answer = pending.answers.get(&question.name).cloned().unwrap_or_default();
                    body.push(
                        div()
                            .flex()
                            .items_baseline()
                            .gap(px(6.))
                            .child(div().font_weight(FontWeight::MEDIUM).text_color(colors.foreground).child(question.title.clone()))
                            .when(!question.required, |this| this.child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child("Optional")))
                            .when(total > 1, |this| {
                                this.child(div().flex_1()).child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(format!("{} of {total}", step + 1)))
                            })
                            .into_any_element(),
                    );
                    if let Some(description) = &question.description {
                        body.push(div().text_color(colors.muted_foreground).child(description.clone()).into_any_element());
                    }
                    if let QuestionKind::Choice { options, multiple, .. } = &question.kind {
                        let rows = options.iter().enumerate().map(|(index, option)| {
                            let chosen = answer.chosen.contains(&option.value);
                            let name = question.name.clone();
                            let value = option.value.clone();
                            let mark = match (*multiple, chosen) {
                                (true, true) => IconName::Check,
                                (true, false) => IconName::Square,
                                (false, true) => IconName::CircleDot,
                                (false, false) => IconName::CircleDotted,
                            };
                            div()
                                .id(("elicitation-option", index))
                                .flex()
                                .items_start()
                                .gap(px(8.))
                                .px(px(8.))
                                .py(px(4.))
                                .rounded(metrics::radius_lg())
                                .when(chosen, |this| this.bg(colors.selected))
                                .hover(|this| this.bg(colors.accent))
                                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.choose_elicitation_option(&name, &value, cx)))
                                .child(div().pt(px(2.)).child(Icon::new(mark).size(IconSize::Small).color(if chosen { colors.primary } else { colors.subtle_foreground })))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .flex()
                                        .flex_col()
                                        .gap(px(2.))
                                        .child(div().text_color(colors.foreground).child(option.label.clone()))
                                        .children(option.description.clone().map(|text| div().text_size(typography::text_caption()).text_color(colors.muted_foreground).child(text)))
                                        .children(option.preview.clone().map(|preview| {
                                            div()
                                                .mt(px(2.))
                                                .px(px(6.))
                                                .py(px(4.))
                                                .rounded(metrics::radius_md())
                                                .bg(colors.background)
                                                .font_family(typography::MONO_FONT)
                                                .text_size(typography::text_caption())
                                                .child(preview)
                                        })),
                                )
                        });
                        body.push(div().flex().flex_col().gap(px(2.)).children(rows).into_any_element());
                    }
                    if let Some(input) = pending.inputs.get(&question.name) {
                        body.push(input.clone().into_any_element());
                    }
                    if let Some(error) = &pending.error {
                        body.push(div().text_color(colors.destructive).child(error.clone()).into_any_element());
                    }
                    let last = step + 1 == total;
                    body.push(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(4.))
                            .child(div().flex_1())
                            .when(step > 0, |this| {
                                this.child(
                                    Button::new("elicitation-previous", "Back")
                                        .variant(ButtonVariant::Ghost)
                                        .size(ButtonSize::Small)
                                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.elicitation_step(false, false, cx))),
                                )
                            })
                            .when(!question.required && !last, |this| {
                                this.child(
                                    Button::new("elicitation-skip", "Skip")
                                        .variant(ButtonVariant::Ghost)
                                        .size(ButtonSize::Small)
                                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.elicitation_step(true, true, cx))),
                                )
                            })
                            .child(if last {
                                Button::new("elicitation-submit", "Send answer")
                                    .variant(ButtonVariant::Accent)
                                    .size(ButtonSize::Small)
                                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.answer_elicitation("accept", cx)))
                            } else {
                                Button::new("elicitation-next", "Next")
                                    .variant(ButtonVariant::Accent)
                                    .size(ButtonSize::Small)
                                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.elicitation_step(true, false, cx)))
                            })
                            .into_any_element(),
                    );
                } else {
                    body.push(
                        div()
                            .flex()
                            .justify_end()
                            .child(
                                Button::new("elicitation-continue", "Continue")
                                    .variant(ButtonVariant::Accent)
                                    .size(ButtonSize::Small)
                                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.answer_elicitation("accept", cx))),
                            )
                            .into_any_element(),
                    );
                }
            }
        }
        Some(
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(10.))
                .p(px(10.))
                .rounded(metrics::radius_xl())
                .bg(colors.raised)
                .shadow(cx.theme().shadows.raised.clone())
                .text_size(typography::text_sm())
                .child(header)
                .children(body)
                .into_any_element(),
        )
    }

    /// The attachments summed up by kind; a group opens on its items, each removable
    /// (`ComposerAttachments`).
    /// The composer's attachments. A handful show one chip each — its icon, its name and a way to
    /// take it off — because "2 files" never said *which* files; past that they fall back to a chip
    /// per kind that opens on its items.
    fn render_attachment_groups(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::attachment_groups;
        let groups = attachment_groups::groups(&self.attachments);
        if groups.is_empty() {
            return None;
        }
        let colors = colors(cx);
        let items: Vec<(attachment_groups::Kind, Vec<usize>)> =
            groups.iter().flat_map(|group| group.items.iter().map(|indices| (group.kind, indices.clone()))).collect();
        let every: Vec<usize> = groups.iter().flat_map(|group| group.items.iter().flatten().copied()).collect();
        let clear_all = (items.len() > 1).then(|| {
            Button::new("clear-attachments", "Clear all")
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::XSmall)
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                    let every = every.clone();
                    this.remove_attachments(&every, cx);
                    this.open_attachment_group = None;
                }))
        });

        // Few enough to name: a chip each.
        if items.len() <= ATTACHMENT_CHIPS {
            let mut chips: Vec<AnyElement> = Vec::new();
            for (position, (kind, indices)) in items.iter().enumerate() {
                if let Some(chip) = self.render_attachment_chip(position, *kind, indices, &colors, cx) {
                    chips.push(chip);
                }
            }
            return Some(div().flex().flex_wrap().items_center().gap(px(4.)).children(chips).children(clear_all).into_any_element());
        }

        let open = self.open_attachment_group.and_then(|kind| groups.iter().find(|group| group.kind == kind)).cloned();
        let open_kind = open.as_ref().map(|group| group.kind);
        // Collected before the panel asks for `cx` again. A group of one names what it holds:
        // "1 folder" says less than "ui/".
        let mut chips: Vec<AnyElement> = Vec::new();
        for (position, group) in groups.iter().enumerate() {
            let kind = group.kind;
            if let [indices] = group.items.as_slice()
                && let Some(chip) = self.render_attachment_chip(position, kind, indices, &colors, cx)
            {
                chips.push(chip);
                continue;
            }
            let active = open_kind == Some(kind);
            chips.push(
                div()
                    .id(SharedString::from(format!("attachment-group-{kind:?}")))
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .h(px(22.))
                    .px(px(6.))
                    .rounded(metrics::radius_md())
                    .text_size(typography::text_sm())
                    .text_color(if active { colors.foreground } else { colors.muted_foreground })
                    .when(active, |this| this.bg(colors.accent))
                    .hover(|style| style.bg(colors.accent).text_color(colors.foreground))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        this.open_attachment_group = if this.open_attachment_group == Some(kind) { None } else { Some(kind) };
                        cx.notify();
                    }))
                    .child(Icon::new(attachment_kind_icon(kind)).size(IconSize::XSmall))
                    .child(div().text_color(colors.foreground).child(group.items.len().to_string()))
                    .child(group.noun)
                    .child(Icon::new(if active { IconName::ChevronUp } else { IconName::ChevronDown }).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .into_any_element(),
            );
        }
        let panel = open.map(|group| {
            let kind = group.kind;
            let all: Vec<usize> = group.items.iter().flatten().copied().collect();
            let mut rows: Vec<AnyElement> = Vec::new();
            for (position, indices) in group.items.iter().enumerate() {
                if let Some(row) = self.render_attachment_row(position, kind, indices, &colors, cx) {
                    rows.push(row);
                }
            }
            div()
                .flex()
                .flex_col()
                .gap(px(1.))
                .p(px(4.))
                .rounded(metrics::radius_md())
                .bg(colors.surface)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .pl(px(4.))
                        .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(group.label.clone()))
                        .child(
                            Button::new("clear-attachment-group", "Clear")
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::XSmall)
                                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                                    this.remove_attachments(&all, cx);
                                    this.open_attachment_group = None;
                                })),
                        ),
                )
                .child(div().id("attachment-group-items").flex().flex_col().gap(px(1.)).max_h(px(256.)).overflow_y_scroll().children(rows))
        });
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .children(panel)
                .child(div().flex().flex_wrap().items_center().gap(px(4.)).children(chips).children(clear_all))
                .into_any_element(),
        )
    }

    /// One attachment as a chip: what it is, and an × that takes it off. Files and tabs open on a
    /// click, as their chips do in a sent prompt.
    fn render_attachment_chip(
        &self,
        position: usize,
        kind: crate::attachment_groups::Kind,
        indices: &[usize],
        colors: &theme::ThemeColors,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let attachment = self.attachments.get(*indices.first()?)?;
        let (name, description) = attachment_description(attachment, self.info.cwd.as_deref());
        let leading = self.attachment_media(attachment, kind, px(16.), colors, cx);
        let open = attachment_target(attachment);
        let indices = indices.to_vec();
        let tooltip = if description.is_empty() || description == name { name.clone() } else { format!("{name} — {description}") };
        let remove_label = format!("Remove {name} from context");
        Some(
            div()
                .id(SharedString::from(format!("attachment-chip-{position}")))
                .flex()
                .items_center()
                .gap(px(4.))
                .h(px(22.))
                .pl(px(6.))
                .pr(px(2.))
                .rounded(metrics::radius_md())
                .bg(colors.accent)
                .text_size(typography::text_sm())
                .text_color(colors.foreground)
                .tooltip(ui::Tooltip::text(tooltip))
                .child(leading)
                .child(div().max_w(px(180.)).min_w_0().truncate().child(name))
                .child(
                    Button::icon(SharedString::from(format!("remove-attachment-chip-{position}")), IconName::X)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .tooltip(remove_label)
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                            cx.stop_propagation();
                            this.remove_attachments(&indices, cx);
                        })),
                )
                .when_some(open, |this, open| this.cursor_pointer().on_click(move |_: &ClickEvent, _, cx| open(cx)))
                .into_any_element(),
        )
    }

    /// One attachment as a row of an open group.
    fn render_attachment_row(
        &self,
        position: usize,
        kind: crate::attachment_groups::Kind,
        indices: &[usize],
        colors: &theme::ThemeColors,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let attachment = self.attachments.get(*indices.first()?)?;
        let (name, description) = attachment_description(attachment, self.info.cwd.as_deref());
        let media = self.attachment_media(attachment, kind, px(20.), colors, cx);
        let open = attachment_target(attachment);
        let indices = indices.to_vec();
        let remove_label = format!("Remove {name} from context");
        Some(
            div()
                .id(SharedString::from(format!("attachment-row-{position}")))
                .flex()
                .items_center()
                .gap(px(8.))
                .px(px(4.))
                .py(px(2.))
                .rounded(metrics::radius_md())
                .hover(|style| style.bg(colors.accent))
                .child(media)
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(div().truncate().text_size(typography::text_sm()).text_color(colors.foreground).child(name.clone()))
                        .children((!description.is_empty() && description != name).then(|| {
                            div().truncate().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(description)
                        })),
                )
                .child(
                    Button::icon(SharedString::from(format!("remove-attachment-{position}")), IconName::X)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .tooltip(remove_label)
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                            cx.stop_propagation();
                            this.remove_attachments(&indices, cx);
                        })),
                )
                .when_some(open, |this, open| this.cursor_pointer().on_click(move |_: &ClickEvent, _, cx| open(cx)))
                .into_any_element(),
        )
    }

    /// An attachment's picture: a pasted image shows itself, a file takes the icon theme's icon,
    /// anything else its kind's.
    fn attachment_media(&self, attachment: &Attachment, kind: crate::attachment_groups::Kind, size: gpui::Pixels, colors: &theme::ThemeColors, cx: &App) -> AnyElement {
        if let Attachment::Image { media_type, data, .. } = attachment
            && let Some(image) = self.thumbnail(&crate::thread::MessageImage { media_type: media_type.clone(), data: data.clone() })
        {
            return div()
                .size(size)
                .flex_none()
                .overflow_hidden()
                .rounded(metrics::radius())
                .child(gpui::img(image).size_full().object_fit(gpui::ObjectFit::Cover))
                .into_any_element();
        }
        extensions::file_icon(&attachment.label(), size * 0.75, cx)
            .unwrap_or_else(|| Icon::new(attachment_kind_icon(kind)).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element())
    }

    fn render_composer(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = colors(cx);
        let running = self.is_running();
        let has_text = !self.composer.read(cx).text().trim().is_empty();
        let terminal_command = crate::user_command::composer_command(self.composer.read(cx).text()).map(str::to_string);
        let terminal_mode = terminal_command.is_some();
        let terminal_enabled = terminal_enabled(cx);
        let has_content = has_text || !self.attachments.is_empty();
        let send_button = |tooltip: &'static str, cx: &mut Context<Self>| {
            Button::icon("send-prompt", IconName::ArrowUp)
                .variant(ButtonVariant::Accent)
                .size(ButtonSize::Small)
                .disabled(!has_content)
                .tooltip(tooltip)
                .shortcut("↩")
                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.submit(window, cx)))
        };
        // `sendControls`: Run command for a `!command`; while a turn runs, Interrupt and send now
        // and Send after current response beside Stop once something is typed; otherwise Send.
        let send: Vec<Button> = if terminal_mode {
            vec![
                Button::icon("send-prompt", IconName::Play)
                    .variant(ButtonVariant::Accent)
                    .size(ButtonSize::Small)
                    .disabled(!terminal_enabled || terminal_command.as_deref().is_none_or(str::is_empty))
                    .tooltip("Run command")
                    .shortcut("↩")
                    .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.submit(window, cx))),
            ]
        } else if running || (self.user_command_running() && !has_text) {
            let mut buttons = Vec::new();
            if has_content && running {
                buttons.push(
                    Button::icon("interrupt-send", IconName::Bolt)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .tooltip("Interrupt and send now")
                        .shortcut("⌘↩")
                        .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.submit_now(window, cx))),
                );
                buttons.push(send_button("Send after current response", cx).variant(ButtonVariant::Ghost).tone(ButtonTone::Accent));
            }
            buttons.push(
                Button::icon("stop-turn", IconName::Stop)
                    .variant(ButtonVariant::Default)
                    .size(ButtonSize::Small)
                    .tooltip("Stop generation")
                    .shortcut("⎋")
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.stop(cx))),
            );
            buttons
        } else {
            vec![send_button("Send message", cx)]
        };
        let composer = self.composer.clone();
        let attachments = self.render_attachment_groups(cx);
        let composer_box = div()
            .id("composer-box")
            .group("composer-box")
            .relative()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(6.))
            .p(px(10.))
            .rounded(metrics::radius_xl())
            .bg(colors.raised)
            .shadow(cx.theme().shadows.raised.clone())
            .cursor_text()
            .drag_over::<ExternalPaths>(move |style, _, _, _| style.border_1().border_color(colors.primary))
            .on_drop(cx.listener(|this, paths: &ExternalPaths, _, cx| this.attach_paths(paths.paths().to_vec(), cx)))
            .drag_over::<ui::DraggedResource>(move |style, _, _, _| style.border_1().border_color(colors.primary))
            .on_drop(cx.listener(|this, resource: &ui::DraggedResource, _, cx| this.attach_dragged_resource(resource, cx)))
            .drag_over::<file_tree::DraggedEntry>(move |style, _, _, _| style.border_1().border_color(colors.primary))
            .on_drop(cx.listener(|this, entry: &file_tree::DraggedEntry, _, cx| this.attach_dragged_entry(entry, cx)))
            .on_mouse_down(MouseButton::Left, move |_, window, cx| composer.update(cx, |composer, cx| composer.focus(window, cx)))
            .when(!terminal_mode, |this| this.children(attachments))
            .when(terminal_mode, |this| {
                // The Terminal badge and the folder the command runs in.
                let folder = self.info.cwd.as_ref().and_then(|cwd| cwd.file_name()).map(|name| name.to_string_lossy().into_owned());
                let title = self.info.cwd.as_ref().map(|cwd| cwd.display().to_string()).unwrap_or_default();
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .min_w_0()
                        .child(ui::Badge::new("Terminal").icon(IconName::Terminal).tone(ui::Tone::Accent))
                        .child(
                            div()
                                .id("terminal-folder")
                                .min_w_0()
                                .truncate()
                                .text_size(typography::text_sm())
                                .text_color(colors.muted_foreground)
                                .when(!title.is_empty(), |this| {
                                    let title: SharedString = title.into();
                                    this.anchored_tooltip(move || ui::Tooltip::new(title.clone()))
                                })
                                .child(folder.unwrap_or_else(|| "Default directory".into())),
                        ),
                )
            })
            .when_some(self.input_notice.clone(), |this, notice| {
                this.child(div().text_size(typography::text_caption()).text_color(colors.warning).child(notice))
            })
            .child(div().px(px(2.)).min_h(px(40.)).child(self.composer.clone()))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(2.))
                    .cursor_default()
                    .when(terminal_mode, |this| {
                        // The terminal toolbar: how to run, or that Terminal is off, and Back to chat.
                        this.child(
                            div()
                                .px(px(6.))
                                .min_w_0()
                                .truncate()
                                .text_size(typography::text_sm())
                                .text_color(colors.muted_foreground)
                                .child(if terminal_enabled { "Enter to run · Output appears in chat" } else { "Enable Terminal in Settings to run commands" }),
                        )
                        .child(div().flex_1())
                        .child(
                            Button::new("back-to-chat", "Back to chat")
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::XSmall)
                                .tooltip("Back to chat")
                                .shortcut("⎋")
                                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.leave_terminal_mode(window, cx))),
                        )
                    })
                    .when(!terminal_mode, |this| this.children(self.render_pickers(cx)).child(div().flex_1()))
                    .when(cfg!(target_os = "macos") && !terminal_mode, |this| {
                        let supported = crate::voice::supported();
                        let listening = self.voice.as_ref().is_some_and(|voice| voice.is_listening());
                        let tooltip = if !supported {
                            "Voice input is unavailable in macOS development builds. Use a packaged build.".to_string()
                        } else if listening {
                            self.voice.as_ref().map(|voice| voice.interim.clone()).filter(|interim| !interim.is_empty()).unwrap_or_else(|| "Stop voice input".into())
                        } else {
                            "Start voice input".into()
                        };
                        this.child(
                            Button::icon("voice-input", IconName::Microphone)
                                .variant(ButtonVariant::Ghost)
                                .tone(if listening { ButtonTone::Accent } else { ButtonTone::Default })
                                .size(ButtonSize::Small)
                                .active(listening)
                                .disabled(!supported)
                                .tooltip(tooltip)
                                .on_click(cx.listener(|this, _: &ClickEvent, window, cx| this.toggle_voice(window, cx))),
                        )
                    })
                    .children(send),
            )
            .child(
                // `ComposerDropHint`: covers the box while something droppable is over it.
                div()
                    .absolute()
                    .inset_0()
                    .rounded(metrics::radius_xl())
                    .bg(colors.primary_soft)
                    .flex()
                    .items_center()
                    .justify_center()
                    .gap(px(6.))
                    .text_size(typography::text_sm())
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.primary)
                    .invisible()
                    .group_drag_over::<ExternalPaths>("composer-box", |style| style.visible())
                    .group_drag_over::<ui::DraggedResource>("composer-box", |style| style.visible())
                    .group_drag_over::<file_tree::DraggedEntry>("composer-box", |style| style.visible())
                    .child(Icon::new(IconName::FilePlus).size(IconSize::Small).color(colors.primary))
                    .child("Drop to add as context"),
            );
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(6.))
            .when(!terminal_mode, |this| {
                this.children(self.render_completion(cx))
                    .children(self.render_composer_notice(cx))
                    .children(self.render_cloud_composer_notice(cx))
                    .children(self.render_queue(cx))
            })
            .child(composer_box)
            .into_any_element()
    }

    /// Where a cloud run stands, under the reply it fills (`CloudRunCard`): working with a way to
    /// stop it, the pull request it opened, how it ended, or why it could not start with what
    /// fixes that.
    fn render_cloud_run_actions(&self, index: usize, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::cloud::{RunStatus, environment::{self, ProblemAction}};
        let entry = self.transcript.cloud.as_ref()?.runs.iter().find(|run| run.entry == index)?.clone();
        let colors = colors(cx);
        if entry.error.is_some() {
            let mut buttons = Vec::new();
            let fix = entry.action.filter(|action| *action != ProblemAction::Retry);
            if let Some(action) = fix {
                let label = match action {
                    ProblemAction::SignIn => "Sign in",
                    ProblemAction::ConnectGithub => "Connect GitHub",
                    ProblemAction::OpenBilling => "Add credit",
                    ProblemAction::SeePlans => "See plans",
                    ProblemAction::Retry => "Try again",
                };
                buttons.push(Button::new(("cloud-fix", index), label).size(ButtonSize::Small).on_click(move |_, window, cx| match action {
                    ProblemAction::SignIn => window.dispatch_action(Box::new(account::SignIn), cx),
                    ProblemAction::OpenBilling | ProblemAction::SeePlans => window.dispatch_action(Box::new(account::ManageBilling), cx),
                    _ => window.dispatch_action(Box::new(account::ManageAccount), cx),
                }));
            }
            if !self.is_running() {
                buttons.push(
                    Button::new(("cloud-retry", index), if fix.is_some() { "Retry" } else { "Try again" })
                        .leading_icon(IconName::ArrowClockwise)
                        .variant(if fix.is_some() { ButtonVariant::Ghost } else { ButtonVariant::Default })
                        .size(ButtonSize::Small)
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.retry_cloud_run(index, cx))),
                );
            }
            return Some(div().flex().gap(px(6.)).children(buttons).into_any_element());
        }
        let id = entry.run_id.clone()?;
        let open_log = {
            let id = id.clone();
            Button::new(("cloud-log", index), "Log")
                .leading_icon(IconName::Terminal)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .on_click(move |_, _, cx| workbench_api::open_resource(cx, crate::cloud::RUN_KIND, &id, "Cloud run"))
        };
        let Some(run) = self.last_cloud_run.clone().filter(|run| run.id == id) else {
            return Some(div().flex().child(open_log).into_any_element());
        };
        let seconds = environment::run_sandbox_seconds(&run, chrono::Utc::now().timestamp_millis());
        let spent = environment::run_spent_micros(&run);
        let mut meta = if run.status == RunStatus::Queued { "Starting sandbox".to_string() } else { format!("{} in the sandbox", environment::format_sandbox_time(seconds)) };
        if spent > 0 {
            meta.push_str(&format!(" · {} {}", environment::format_credit_micros(spent), if run.billing.as_deref() == Some("own-key") { "sandbox" } else { "credit" }));
        }
        let row = |icon: AnyElement, title: String, description: Option<String>, actions: Vec<AnyElement>| {
            div()
                .flex()
                .items_center()
                .gap(px(10.))
                .px(px(12.))
                .py(px(8.))
                .min_w_0()
                .child(div().flex_none().child(icon))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(div().truncate().text_color(colors.foreground).child(title))
                        .children(description.map(|description| div().truncate().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(description))),
                )
                .child(div().flex_none().flex().items_center().gap(px(4.)).children(actions))
                .into_any_element()
        };
        let icon = |name: IconName, color| Icon::new(name).size(IconSize::Small).color(color).into_any_element();
        let rows = match run.status {
            RunStatus::Queued | RunStatus::Running => {
                let title = if run.status == RunStatus::Queued { "Starting the sandbox" } else { "Working in the cloud" };
                let stop = Button::new(("cloud-stop", index), "Stop")
                    .leading_icon(IconName::Stop)
                    .variant(ButtonVariant::Ghost)
                    .tone(ui::ButtonTone::Danger)
                    .size(ButtonSize::Small)
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.cancel_cloud_run(cx)));
                vec![row(
                    ui::Spinner::new(("cloud-spinner", index)).compact().label("Running in the cloud").into_any_element(),
                    title.to_string(),
                    Some(format!("{} · {} · {meta}", run.repo, run.base_branch)),
                    vec![open_log.into_any_element(), stop.into_any_element()],
                )]
            }
            RunStatus::Succeeded if run.pr_url.is_some() => {
                let url = run.pr_url.clone().unwrap_or_default();
                let target = match environment::parse_pull_request_url(&url) {
                    Some((repo, number)) => format!("{repo} #{number}"),
                    None => run.repo.clone(),
                };
                let open = Button::new(("cloud-open-pr", index), "Open on GitHub")
                    .leading_icon(IconName::BrandGithub)
                    .size(ButtonSize::Small)
                    .on_click(move |_, _, cx| cx.open_url(&url));
                vec![
                    row(
                        icon(IconName::GitPullRequest, colors.success),
                        run.title.clone(),
                        Some(format!("{target} · {} → {}", run.branch, run.base_branch)),
                        vec![ui::Badge::new("Draft").tone(ui::Tone::Success).into_any_element()],
                    ),
                    row(icon(IconName::Cloud, colors.subtle_foreground), meta, None, vec![open_log.into_any_element(), open.into_any_element()]),
                ]
            }
            status => {
                let (icon_name, color, title, description) = match status {
                    RunStatus::Failed => (
                        IconName::WarningCircle,
                        colors.destructive,
                        "The run failed",
                        run.error.clone().filter(|error| !error.trim().is_empty()).unwrap_or_else(|| "The agent stopped before it opened a pull request.".into()),
                    ),
                    RunStatus::Cancelled => (IconName::MinusCircle, colors.subtle_foreground, "Run stopped", meta),
                    _ => (IconName::Cloud, colors.subtle_foreground, "Finished without changes to push", meta),
                };
                vec![row(icon(icon_name, color), title.to_string(), Some(description), vec![open_log.into_any_element()])]
            }
        };
        Some(
            div()
                .mt(px(8.))
                .flex()
                .flex_col()
                .rounded(metrics::radius_lg())
                .border_1()
                .border_color(colors.border)
                .bg(colors.raised)
                .text_size(typography::text_sm())
                .children(rows)
                .into_any_element(),
        )
    }

    /// The `@` and `/` menu, above the composer.
    fn render_completion(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let completion = self.completion.as_ref()?;
        let colors = colors(cx);
        let root = self.info.cwd.clone();
        let rows = completion.items.iter().enumerate().map(|(index, item)| {
            let selected = index == completion.selected;
            let mut badge = None;
            let (icon, label, detail) = match item {
                CompletionItem::File { relative, group, .. } => {
                    let name = relative.rsplit('/').next().unwrap_or(relative).to_string();
                    let folder = relative.strip_suffix(&name).unwrap_or_default().trim_end_matches('/').to_string();
                    badge = match group {
                        FileGroup::Open => Some(div().child("open").into_any_element()),
                        FileGroup::Recent => Some(Icon::new(IconName::Clock).size(IconSize::XSmall).color(colors.muted_foreground).into_any_element()),
                        FileGroup::Files => None,
                    };
                    (IconName::File, name, folder)
                }
                CompletionItem::Session { title, .. } => (IconName::ChatBubbleText, title.clone(), "Session".to_string()),
                CompletionItem::Command { name, description, hint } => {
                    let detail = match hint {
                        Some(hint) if description.is_empty() => hint.clone(),
                        _ => description.clone(),
                    };
                    (IconName::Terminal, format!("/{name}"), detail)
                }
                CompletionItem::Skill { command, description, .. } => {
                    let detail = if description.is_empty() { "Skill".to_string() } else { format!("Skill · {description}") };
                    (IconName::BookOpen, format!("/{command}"), detail)
                }
                CompletionItem::Action { name, description, action } => {
                    let icon = match action {
                        ComposerAction::Mode(_) => IconName::Sliders,
                        ComposerAction::Review => IconName::GitDiff,
                        ComposerAction::New => IconName::Plus,
                        ComposerAction::Compact => IconName::ArrowsIn,
                        ComposerAction::Clear => IconName::Broom,
                    };
                    (icon, format!("/{name}"), description.clone())
                }
            };
            let heading = match item {
                CompletionItem::File { group, .. } if index == 0 || !matches!(&completion.items[index - 1], CompletionItem::File { group: previous, .. } if previous == group) => group.heading(),
                _ => None,
            };
            let row = div()
                .id(("completion", index))
                .flex()
                .items_center()
                .gap(px(8.))
                .h(ui::metrics::list_row())
                .px(px(8.))
                .rounded(metrics::radius_md())
                .when(selected, |this| this.bg(colors.selected))
                .when(!selected, |this| this.hover(|style| style.bg(colors.accent)))
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.accept_completion(index, cx)))
                .child(match item {
                    CompletionItem::File { .. } => extensions::file_icon(&label, px(14.), cx)
                        .unwrap_or_else(|| Icon::new(icon).size(IconSize::Small).color(if selected { colors.foreground } else { colors.subtle_foreground }).into_any_element()),
                    _ => Icon::new(icon).size(IconSize::Small).color(if selected { colors.foreground } else { colors.subtle_foreground }).into_any_element(),
                })
                .child(div().flex_none().max_w(px(260.)).truncate().text_color(colors.foreground).child(label))
                .child(div().flex_1().min_w_0().truncate().text_color(colors.subtle_foreground).child(detail))
                .when_some(badge, |this, badge| {
                    this.child(
                        div().flex_none().px(px(4.)).rounded(metrics::radius()).bg(colors.accent).text_size(typography::text_caption()).text_color(colors.muted_foreground).child(badge),
                    )
                });
            div()
                .flex()
                .flex_col()
                .gap(px(1.))
                .when_some(heading, |this, heading| {
                    this.child(div().flex().items_center().h(px(22.)).px(px(8.)).font_weight(typography::MEDIUM).text_color(colors.subtle_foreground).child(heading))
                })
                .child(row)
        });
        let title = match completion.trigger {
            Trigger::Mention { .. } if root.is_some() => "Files and sessions",
            Trigger::Mention { .. } => "Sessions",
            Trigger::Slash { .. } => "Commands",
        };
        Some(
            div()
                .id("composer-completion")
                .w_full()
                .flex()
                .flex_col()
                .gap(px(1.))
                .p(px(4.))
                .rounded(metrics::radius_xl())
                .bg(colors.overlay)
                .shadow(cx.theme().shadows.raised.clone())
                .text_size(typography::text_sm())
                .child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(22.))
                        .px(px(8.))
                        .text_size(typography::text_caption())
                        .text_color(colors.subtle_foreground)
                        .child(title)
                        .child(div().flex_1())
                        .child("↑↓ to move · ↩ to pick · esc to close"),
                )
                .children(rows)
                .into_any_element(),
        )
    }

    /// Prompts waiting for the running turn, with a way to drop each.
    fn render_queue(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.queue.is_empty() {
            return None;
        }
        let colors = colors(cx);
        let running = self.is_running();
        let count = self.queue.len();
        let rows = self.queue.iter().enumerate().map(|(index, queued)| {
            let text = queued.text.lines().next().unwrap_or_default().to_string();
            let extra = if queued.attachments.is_empty() { String::new() } else { format!(" +{}", queued.attachments.len()) };
            let editing = self.queued_edit.as_ref().filter(|edit| edit.id == queued.id).map(|edit| edit.input.clone());
            let action = |id: &'static str, icon: IconName, tooltip: &'static str| {
                Button::icon((id, index), icon).variant(ButtonVariant::Ghost).size(ButtonSize::XSmall).tooltip(tooltip)
            };
            let actions = if editing.is_some() {
                div()
                    .flex()
                    .flex_none()
                    .child(action("save-queued", IconName::Check, "Save queued message").shortcut("enter").on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.finish_queued_edit(true, cx))))
                    .child(action("cancel-queued", IconName::X, "Cancel editing").shortcut("escape").on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.finish_queued_edit(false, cx))))
            } else {
                div()
                    .flex()
                    .flex_none()
                    .child(action("send-queued-now", IconName::Bolt, "Send now").tone(ButtonTone::Accent).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.send_queued_now(index, cx))))
                    .when(count > 1, |this| {
                        this.child(action("queued-earlier", IconName::ArrowUp, "Move earlier").disabled(index == 0).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.move_queued(index, index - 1, cx))))
                            .child(action("queued-later", IconName::ArrowDown, "Move later").disabled(index + 1 == count).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.move_queued(index, index + 1, cx))))
                    })
                    .child(action("edit-queued", IconName::Pencil, "Edit queued message").on_click(cx.listener(move |this, _: &ClickEvent, window, cx| this.edit_queued(index, window, cx))))
                    .child(action("remove-queued", IconName::Trash, "Remove queued message").tone(ButtonTone::Danger).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.remove_queued(index, cx))))
            };
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .min_h(px(26.))
                .px(px(8.))
                .child(Icon::new(IconName::Clock).size(IconSize::XSmall).color(colors.subtle_foreground))
                .child(match editing {
                    Some(input) => div().flex_1().min_w_0().child(input).into_any_element(),
                    None => div().flex_1().min_w_0().truncate().text_color(colors.muted_foreground).child(format!("{text}{extra}")).into_any_element(),
                })
                .child(actions)
        });
        let note = if running { "Sends when the agent finishes" } else { "Press ↩ to send the next one" };
        Some(
            div()
                .w_full()
                .flex()
                .flex_col()
                .py(px(4.))
                .rounded(metrics::radius_xl())
                .bg(colors.raised)
                .shadow(cx.theme().shadows.raised.clone())
                .text_size(typography::text_sm())
                .child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(22.))
                        .px(px(8.))
                        .text_size(typography::text_caption())
                        .text_color(colors.subtle_foreground)
                        .child(format!("Queued ({})", self.queue.len()))
                        .child(div().flex_1())
                        .child(note),
                )
                .children(rows)
                .into_any_element(),
        )
    }

    /// Reads the project rules for the meter in the background, once until a turn ends.
    pub(crate) fn load_rules_budget(&mut self, cx: &mut Context<Self>) {
        // The attached files, open tabs and selections scope nested and glob rules (`rulePaths`);
        // the rules are read again when they change.
        let mut paths: Vec<PathBuf> = self.attachments.iter().filter_map(|attachment| if let Attachment::File(path) = attachment { Some(path.clone()) } else { None }).collect();
        paths.extend(crate::session_view::attached_editor_files(&self.attachments));
        paths.sort();
        paths.dedup();
        if self.rules_budget.as_ref().is_some_and(|(read_for, _)| *read_for == paths) || self.rules_budget_task.is_some() {
            return;
        }
        // The user's rules count with the project's, as `loadContextProjectRules` adds them.
        let user_rules = settings_or_default(cx).ai_user_rules;
        let root = self.info.cwd.clone();
        self.rules_budget_task = Some(cx.spawn(async move |this, cx| {
            let read_for = paths.clone();
            let rules = cx.background_spawn(async move { builtin::prompt::project_rules_section(root.as_deref(), &paths, &user_rules) }).await;
            this.update(cx, |this, cx| {
                this.rules_budget = Some((read_for, rules));
                this.rules_budget_task = None;
                cx.notify();
            })
            .ok();
        }));
    }


    /// The composer toolbar: Add context, the agent menu, and where a cloud session runs.
    fn render_pickers(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut pickers = vec![
            Button::icon("add-context", IconName::Plus)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip("Add context")
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_add_context_menu(event, window, cx)))
                .into_any_element(),
        ];
        // Reads as the model and its effort ("Opus 5.5 Medium"); the agent's mark leads it, and
        // before the agent offers a model it shows the agent's name.
        let option_of = |category| self.transcript.config_options.iter().find(|option| crate::chat_preferences::classify(option) == category && !option.choices.is_empty());
        let model = option_of(crate::chat_preferences::OptionCategory::Model).map(|option| option.current_name().to_string()).filter(|name| !name.is_empty());
        let effort = option_of(crate::chat_preferences::OptionCategory::ThoughtLevel).map(|option| {
            option.choices.iter().find(|choice| choice.value == option.current).map_or_else(|| option.current_name().to_string(), |choice| crate::chat_preferences::effort_label(&choice.value, &choice.name))
        });
        let label = model.unwrap_or_else(|| self.agent_name());
        pickers.push(
            picker_button("agent-picker", label, None, true)
                .secondary_label(effort.unwrap_or_default())
                .tooltip(self.agent_name())
                .leading(crate::model_vendor::agent_mark(&self.info.agent, px(14.), colors(cx).muted_foreground))
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_preferences_menu(event.position(), window, cx)))
                .into_any_element(),
        );
        // Once the session has a conversation, where it runs is settled: a local one hides the
        // chip, a cloud one keeps it, disabled, and its repository and branch move to the dock.
        let settled = self.transcript.entries.iter().any(|entry| matches!(entry, Entry::User(_) | Entry::Agent(_)));
        let cloud_session = self.transcript.cloud.is_some();
        // Shown by the account's cloud-agents capability, whatever the agent: Cloud with an agent
        // that runs only locally gets the composer notice offering one that does.
        let cloud_agents = Self::has_cloud_agents(cx);
        if cloud_agents && !(settled && !cloud_session) {
            let (label, icon) = if cloud_session { ("Cloud", IconName::Cloud) } else { ("Local", IconName::Laptop) };
            pickers.push(
                picker_button("environment-picker", label.to_string(), Some(icon), true)
                    .disabled(settled)
                    .tooltip(if settled { "This session runs in the cloud" } else { "Where the agent runs" })
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| this.open_environment_menu(event, window, cx)))
                    .into_any_element(),
            );
        }
        if let Some(cloud) = self.transcript.cloud.as_ref().filter(|_| cloud_agents && !settled) {
            let locked = !cloud.runs.is_empty();
            pickers.push(
                picker_button(
                    "cloud-repo-picker",
                    cloud.repo.as_deref().map_or_else(|| "Choose repository".to_string(), |repo| repo.split('/').nth(1).unwrap_or(repo).to_string()),
                    Some(IconName::Github),
                    true,
                )
                .tooltip(cloud.repo.clone().unwrap_or_else(|| "Choose the repository to clone".to_string()))
                    .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                        if !locked {
                            this.open_cloud_repo_menu(event, window, cx);
                        }
                    }))
                    .into_any_element(),
            );
            if cloud.repo.is_some() {
                pickers.push(
                    picker_button("cloud-branch-picker", cloud.branch.clone().unwrap_or_else(|| "Default branch".to_string()), Some(IconName::GitBranch), true)
                        .tooltip(cloud.branch.as_ref().map_or_else(|| "Choose the branch to start from".to_string(), |branch| format!("Starts from {branch}")))
                        .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                            if !locked {
                                this.open_cloud_branch_menu(event, window, cx);
                            }
                        }))
                        .into_any_element(),
                );
            }
        }
        // Mode, model, effort and the agent's other settings live in the agent menu.
        pickers
    }

    /// The agent picker's providers (`composer-agent-selector.tsx`): Athas on its credit, then
    /// each provider with a key; picking one runs the built-in agent on its first recommended
    /// model, or its first model.
    pub(crate) fn provider_entries(&self, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        use ai_providers::catalog;
        let builtin = builtin::is_builtin(&self.info.agent);
        let current = builtin.then(|| builtin::session_provider(crate::intelligence::task_provider(&settings_or_default(cx), "agent"), &self.transcript).provider_id);
        let signed_in = account::AccountStore::global(cx).is_some_and(|store| store.read(cx).is_signed_in());
        let view = cx.entity();
        let athas = {
            let view = view.clone();
            let already = current.as_deref() == Some(catalog::ATHAS);
            MenuItem::new("Athas").icon(crate::model_vendor::provider_icon(catalog::ATHAS)).checked(already).trailing_text(if signed_in { "Athas credit" } else { "Sign in" }).on_select(move |_, cx| {
                if !already {
                    view.update(cx, |this, cx| this.choose_provider(catalog::ATHAS, "auto", cx));
                }
            })
        };
        let mut entries = vec![MenuEntry::Item(athas)];
        let secrets: &dyn ai_providers::SecretStore =
            if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() { &ai_providers::MemorySecrets::default() } else { &crate::ai_settings::KeychainRef };
        let connected: Vec<&catalog::Provider> = catalog::PROVIDERS
            .iter()
            .filter(|provider| provider.id != catalog::ATHAS && provider.requires_api_key && ai_providers::secrets::api_key(secrets, provider).is_some())
            .collect();
        if !connected.is_empty() {
            entries.push(MenuEntry::Label("Your API keys".into()));
        }
        for provider in connected {
            let ids: Vec<&str> = provider.models.iter().map(|model| model.id).collect();
            let model = crate::model_vendor::recommended(ids.iter().copied()).first().or(ids.first()).map(|id| id.to_string());
            let already = current.as_deref() == Some(provider.id);
            let view = view.clone();
            let id = provider.id;
            let mut item = MenuItem::new(provider.name).icon(crate::model_vendor::provider_icon(id)).checked(already);
            if model.is_none() {
                item = item.disabled(true).trailing_text("No models available");
            }
            entries.push(MenuEntry::Item(item.on_select(move |_, cx| {
                if let (false, Some(model)) = (already, &model) {
                    view.update(cx, |this, cx| this.choose_provider(id, model, cx));
                }
            })));
        }
        entries
    }

    /// A config option's menu rows (`config-{id}`), and whether it is a model list long enough to
    /// search; a Codex model menu ends with its loading or error rows.
    pub(crate) fn config_option_entries(&mut self, id: &str, cx: &mut Context<Self>) -> Option<(Vec<MenuEntry>, bool)> {
        let option = self.transcript.config_options.iter().find(|option| option.id == id)?.clone();
        let view = cx.entity();
        let model_option = option.category.as_deref() == Some("model");
        let status_rows = if model_option { self.codex_model_status_rows(cx) } else { Vec::new() };
        if model_option && crate::model_vendor::is_long(option.choices.len()) {
            let ids: Vec<String> = option.choices.iter().map(|choice| choice.value.clone()).collect();
            let agent = self.info.agent.clone();
            let mut entries = crate::model_vendor::model_entries(&ids, |index| {
                let choice = &option.choices[index];
                let id = option.id.clone();
                let value = choice.value.clone();
                let view = view.clone();
                MenuItem::new(choice.name.clone())
                    .icon(crate::model_vendor::model_icon(&agent, &choice.value))
                    .checked(choice.value == option.current)
                    .on_select(move |_, cx| {
                        view.update(cx, |this, cx| this.set_config_option(id.clone(), value.clone(), cx));
                    })
            });
            entries.extend(status_rows);
            return Some((entries, true));
        }
        let mut entries = Vec::new();
        let mut group: Option<String> = None;
        for choice in &option.choices {
            if choice.group != group {
                group = choice.group.clone();
                if let Some(name) = &group {
                    entries.push(MenuEntry::Label(name.clone().into()));
                }
            }
            let id = option.id.clone();
            let value = choice.value.clone();
            let view = view.clone();
            entries.push(MenuEntry::Item(
                MenuItem::new(choice.name.clone()).checked(choice.value == option.current).on_select(move |_, cx| {
                    view.update(cx, |this, cx| this.set_config_option(id.clone(), value.clone(), cx));
                }),
            ));
        }
        entries.extend(status_rows);
        Some((entries, false))
    }

    /// An open model menu shows the list (or the read's state) that just arrived.
    pub(crate) fn refresh_open_model_menu(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.open_menu.as_ref().and_then(|menu| menu.key.strip_prefix("config-").map(str::to_string)) else { return };
        let Some((entries, searchable)) = self.config_option_entries(&id, cx) else { return };
        let Some(open) = &self.open_menu else { return };
        open.menu.update(cx, |menu, cx| {
            // A query being typed stays; an empty one loses nothing when the search is set again.
            if searchable && menu.query().is_empty() {
                menu.set_searchable("Search models…", "No matching models");
            }
            menu.set_entries(entries, cx);
        });
    }

    pub(crate) fn show_menu(&mut self, key: &str, entries: Vec<MenuEntry>, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.show_menu_at(key, entries, event.position(), window, cx);
    }

    pub(crate) fn show_menu_at(&mut self, key: &str, entries: Vec<MenuEntry>, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        self.open_menu = Some(OpenMenu::new(key.to_string(), entries, position, gpui::Anchor::BottomLeft, window, cx, |this, _| {
            this.open_menu = None;
        }));
        cx.notify();
    }
}

fn settings_or_default(cx: &App) -> settings::Settings {
    cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).clone()).unwrap_or_default()
}

/// Whether Settings' Terminal feature is on, which `!commands` need (`coreFeatures.terminal`).
pub(crate) fn terminal_enabled(cx: &App) -> bool {
    cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).core_features.terminal)
}

/// One row of a diff: a hunk header, or a line with its numbers, marker and highlighted text.
pub(crate) fn diff_row(row_index: usize, row: &crate::diff::NumberedRow, spans: &LineSpans, colors: &theme::ThemeColors, theme: &theme::Theme) -> AnyElement {
    use crate::diff::NumberedRow;
    let number = |value: Option<usize>| {
        div()
            .w(px(40.))
            .flex_none()
            .px(px(8.))
            .border_r_1()
            .border_color(colors.divider)
            .flex()
            .justify_end()
            .text_color(colors.subtle_foreground)
            .child(value.map(|value| value.to_string()).unwrap_or_default())
    };
    match row {
        NumberedRow::Header(range) => div()
            .flex()
            .min_w_full()
            .h(px(DIFF_ROW_HEIGHT))
            .bg(colors.surface)
            .text_color(colors.subtle_foreground)
            .child(div().w(px(100.)).flex_none().px(px(8.)).border_r_1().border_color(colors.divider).flex().justify_end().child("@@"))
            .child(div().px(px(10.)).whitespace_nowrap().child(range.clone()))
            .into_any_element(),
        NumberedRow::Line { kind, text, old, new } => {
            let (marker, bar, marker_color) = match kind {
                LineKind::Added => ("+", Some(colors.git_added), colors.git_added),
                LineKind::Removed => ("-", Some(colors.git_deleted), colors.git_deleted),
                LineKind::Context => (" ", None, colors.subtle_foreground),
            };
            let line_spans = spans.get(row_index).map(Vec::as_slice).unwrap_or_default();
            div()
                .relative()
                .flex()
                .min_w_full()
                .h(px(DIFF_ROW_HEIGHT))
                .when_some(bar, |this, bar| this.bg(bar.opacity(0.14)).child(div().absolute().left_0().top_0().bottom_0().w(px(2.)).bg(bar)))
                .child(number(*old))
                .child(number(*new))
                .child(div().w(px(20.)).flex_none().flex().justify_center().text_color(marker_color).child(marker))
                .child(div().pl(px(2.)).pr(px(10.)).whitespace_nowrap().text_color(colors.foreground).child(crate::inline_edit::styled_code_line(text, line_spans, theme)))
                .into_any_element()
        }
    }
}

fn colors(cx: &App) -> theme::ThemeColors {
    cx.theme().colors.clone()
}

/// A file, session or image that goes along with a prompt.
fn attachment_kind_icon(kind: crate::attachment_groups::Kind) -> IconName {
    use crate::attachment_groups::Kind;
    match kind {
        Kind::Files => IconName::File,
        Kind::Folders => IconName::Folder,
        Kind::Diffs => IconName::GitDiff,
        Kind::Images => IconName::Image,
        Kind::Selections => IconName::TextAlignLeft,
        Kind::Terminals => IconName::Terminal,
        Kind::GitHub => IconName::Github,
        Kind::Problems => IconName::Warning,
        Kind::Chats => IconName::ChatBubbleText,
        Kind::Skills => IconName::BookOpen,
        Kind::Other => IconName::Columns,
    }
}

/// An attachment's name and where it comes from, as its group lists it.
/// Where an attachment's chip goes when it is clicked, if anywhere.
fn attachment_target(attachment: &Attachment) -> Option<Box<dyn Fn(&mut App)>> {
    use crate::context_refs::ContextRef;
    match attachment {
        Attachment::File(path) => {
            let path = path.clone();
            Some(Box::new(move |cx: &mut App| workbench_api::open_file(cx, path.clone(), None)))
        }
        Attachment::Context { reference: ContextRef::Selection { path, start_line, .. }, .. } => {
            let (path, line) = (path.clone(), *start_line as u32);
            Some(Box::new(move |cx: &mut App| workbench_api::open_file(cx, path.clone(), Some(line))))
        }
        Attachment::Context { reference: ContextRef::Tab { path: Some(path), .. }, .. } => {
            let path = path.clone();
            Some(Box::new(move |cx: &mut App| workbench_api::open_file(cx, path.clone(), None)))
        }
        Attachment::Context { reference: ContextRef::Tab { kind: Some(kind), id: Some(id), title, .. }, .. } => {
            let (kind, id, title) = (kind.clone(), id.clone(), title.clone());
            Some(Box::new(move |cx: &mut App| workbench_api::open_resource(cx, &kind, &id, &title)))
        }
        _ => None,
    }
}

/// How many attachments show one chip each before they fall back to a chip per kind.
const ATTACHMENT_CHIPS: usize = 5;

/// Something is working: the arc that turns, in the colour of the text beside it. The box keeps
/// an icon's width so a row does not shift when the work ends.
pub(crate) fn busy_spinner(id: impl Into<gpui::ElementId>, color: Hsla) -> AnyElement {
    div()
        .flex_none()
        .size(px(14.))
        .flex()
        .items_center()
        .justify_center()
        .child(ui::Spinner::new(id).compact().color(color))
        .into_any_element()
}

/// The group a turn's last entry carries, so its actions show when the pointer is anywhere on it.
const TURN_TAIL: &str = "turn-tail";

/// The sentence an error carries, without the `… error: ` an RPC layer puts in front of it.
fn error_core(text: &str) -> &str {
    match text.split_once(": ") {
        Some((head, rest)) if head.len() <= 32 && head.to_lowercase().contains("error") => rest.trim(),
        _ => text.trim(),
    }
}

/// Whether the turn's reply already said what this error says. Agents that stop on a limit send
/// the sentence as a message and then fail the turn with the same words.
fn said_already(before: &[Entry], text: &str) -> bool {
    let core = error_core(text).to_lowercase();
    if core.chars().count() < 12 {
        return false;
    }
    before
        .iter()
        .rev()
        .take_while(|entry| !matches!(entry, Entry::User(_)))
        .any(|entry| matches!(entry, Entry::Agent(message) if message.text.trim().to_lowercase().contains(core.as_str())))
}

fn attachment_description(attachment: &Attachment, root: Option<&std::path::Path>) -> (String, String) {
    match attachment {
        Attachment::File(path) => (attachment.label(), display_path(path, root)),
        Attachment::Session { .. } => (attachment.label(), "Past chat".into()),
        Attachment::Image { .. } => (attachment.label(), "Pasted image".into()),
        Attachment::Skill { .. } => (attachment.label(), "Skill".into()),
        Attachment::Context { reference, .. } => reference.describe(root),
    }
}

/// A prompt's attachment as a chip. A file takes the icon theme's icon, as the lists do.
fn attachment_chip(icon: IconName, label: String, cx: &App) -> gpui::Div {
    let colors = &cx.theme().colors;
    let leading = match icon {
        IconName::File => extensions::file_icon(&label, px(12.), cx),
        _ => None,
    }
    .unwrap_or_else(|| Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element());
    div()
        .flex()
        .items_center()
        .gap(px(4.))
        .max_w(px(220.))
        .h(px(22.))
        .px(px(6.))
        .rounded(metrics::radius_md())
        .bg(colors.accent)
        .text_size(typography::text_caption())
        .text_color(colors.muted_foreground)
        .child(leading)
        .child(div().min_w_0().truncate().child(label))
}

fn picker_button(id: impl Into<gpui::ElementId>, label: String, icon: Option<IconName>, locked: bool) -> Button {
    let button = Button::new(id, label).variant(ButtonVariant::Ghost).size(ButtonSize::Small).regular_weight().shrinkable();
    let button = match icon {
        Some(icon) => button.leading_icon(icon),
        None => button,
    };
    if locked { button } else { button.trailing_icon(IconName::ChevronDown) }
}

fn disclosure(expanded: bool, color: Hsla) -> impl IntoElement {
    Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(color)
}

fn kind_icon(kind: ToolKind) -> IconName {
    match kind {
        ToolKind::Read => IconName::FileText,
        ToolKind::Edit => IconName::PencilLine,
        ToolKind::Delete => IconName::Trash,
        ToolKind::Move => IconName::ArrowsLeftRight,
        ToolKind::Search => IconName::Search,
        ToolKind::Execute => IconName::Terminal,
        ToolKind::Think => IconName::Brain,
        ToolKind::Fetch => IconName::Globe,
        ToolKind::SwitchMode => IconName::Sliders,
        ToolKind::Other => IconName::Wrench,
    }
}

fn render_notice(kind: NoticeKind, text: &str, path: SpanPath, sel: &Selecting, cx: &mut Context<SessionView>) -> AnyElement {
    let colors = colors(cx);
    let (icon, color) = match kind {
        NoticeKind::Error => (IconName::WarningCircle, colors.destructive),
        NoticeKind::Stopped => (IconName::Stop, colors.subtle_foreground),
        NoticeKind::Warning => (IconName::Warning, colors.warning),
        NoticeKind::Info => (IconName::Info, colors.subtle_foreground),
    };
    div()
        .flex()
        .items_start()
        .gap(px(8.))
        .py(px(2.))
        .text_size(typography::text_sm())
        .line_height(px(19.))
        .text_color(color)
        .child(div().pt(px(2.)).child(Icon::new(icon).size(IconSize::Small).color(color)))
        .child(selectable_text(text, path, sel, cx))
        .into_any_element()
}

/// A run of plain text the mouse can select, as the transcript's runs all are.
fn selectable_text(text: &str, path: SpanPath, sel: &Selecting, cx: &mut Context<SessionView>) -> gpui::Div {
    let styled = StyledText::new(text.to_string()).with_highlights(sel.highlights(&path, text, Vec::new()));
    let layout = styled.layout().clone();
    crate::selection::draggable(div().min_w_0(), path, layout, cx).child(styled)
}

fn code_box(text: &str, path: SpanPath, sel: &Selecting, cx: &mut Context<SessionView>) -> AnyElement {
    let colors = colors(cx);
    div()
        .w_full()
        .min_w_0()
        .px(px(10.))
        .py(px(8.))
        .rounded(metrics::radius_lg())
        .bg(colors.field)
        .border_1()
        .border_color(colors.border)
        .font_family(typography::MONO_FONT)
        .text_size(typography::text_caption())
        .line_height(px(17.))
        .text_color(colors.muted_foreground)
        .child(linked_text(text, colors.primary, path, sel, cx))
        .into_any_element()
}

/// Plain text with its web addresses underlined and opening in the browser.
fn linked_text(text: &str, link: Hsla, path: SpanPath, sel: &Selecting, cx: &mut Context<SessionView>) -> AnyElement {
    let ranges = crate::chat_link::web_urls(text);
    let highlights: Vec<_> = ranges
        .iter()
        .map(|range| {
            (range.clone(), HighlightStyle { color: Some(link), underline: Some(UnderlineStyle { thickness: px(1.), color: Some(link.opacity(0.4)), wavy: false }), ..Default::default() })
        })
        .collect();
    let highlights = sel.highlights(&path, text, highlights);
    let styled = StyledText::new(text.to_string()).with_highlights(highlights);
    let layout = styled.layout().clone();
    let holder = crate::selection::draggable(div().min_w_0(), path, layout, cx);
    if ranges.is_empty() {
        return holder.child(styled).into_any_element();
    }
    let urls: Vec<String> = ranges.iter().map(|range| text[range.clone()].to_string()).collect();
    let id = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        text.hash(&mut hasher);
        format!("linked-{:x}", hasher.finish())
    };
    holder
        .child(
            InteractiveText::new(SharedString::from(id), styled).on_click(ranges, move |index, _, cx| {
                if let Some(url) = urls.get(index) {
                    cx.open_url(url);
                }
            }),
        )
        .into_any_element()
}

/// Whether a prompt is long enough to be clamped: more lines than [`PROMPT_LINES`], counting
/// the wrapping of long lines at about eighty characters.
fn prompt_is_long(text: &str) -> bool {
    text.lines().map(|line| line.chars().count().div_ceil(80).max(1)).sum::<usize>() > PROMPT_LINES
}

fn last_lines(text: &str, limit: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= limit {
        return text.to_string();
    }
    format!("… {} earlier lines\n{}", lines.len() - limit, lines[lines.len() - limit..].join("\n"))
}

fn display_path(path: &std::path::Path, root: Option<&std::path::Path>) -> String {
    root.and_then(|root| path.strip_prefix(root).ok()).unwrap_or(path).display().to_string()
}

/// Draws Markdown blocks. `path` keeps element ids unique across the transcript and places
/// each run of text in the selection (`selection::SpanPath`).
fn render_blocks(blocks: &[Block], path: &SpanPath, sel: &Selecting, cx: &mut Context<SessionView>) -> Vec<AnyElement> {
    blocks.iter().enumerate().map(|(index, block)| render_block(block, &path.child(index), sel, cx)).collect()
}

fn render_block(block: &Block, path: &SpanPath, sel: &Selecting, cx: &mut Context<SessionView>) -> AnyElement {
    let colors = colors(cx);
    match block {
        Block::Heading { level, text } => {
            let size = match level {
                1 => px(18.),
                2 => typography::text_lg(),
                _ => typography::text_base(),
            };
            div()
                .pt(px(4.))
                .text_size(size)
                .font_weight(typography::SEMIBOLD)
                .child(render_inline(text, path, sel, cx))
                .into_any_element()
        }
        Block::Paragraph(text) => div().min_w_0().child(render_inline(text, path, sel, cx)).into_any_element(),
        Block::Code { language, code } => {
            let copy = code.clone();
            div()
                .w_full()
                .min_w_0()
                .rounded(metrics::radius_lg())
                .bg(colors.field)
                .border_1()
                .border_color(colors.border)
                .overflow_hidden()
                .group("code-block")
                .child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(26.))
                        .pl(px(10.))
                        .pr(px(4.))
                        .text_size(typography::text_caption())
                        .text_color(colors.subtle_foreground)
                        .child(div().flex_1().child(language.clone().unwrap_or_default()))
                        .child(
                            div().invisible().group_hover("code-block", |style| style.visible()).child(
                                Button::icon(SharedString::from(format!("copy-{path}")), IconName::Copy)
                                    .size(ButtonSize::XSmall)
                                    .tooltip("Copy")
                                    .on_click(move |_, _, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(copy.clone()))),
                            ),
                        ),
                )
                .child(
                    div()
                        .id(SharedString::from(format!("code-{path}")))
                        .overflow_x_scroll()
                        .px(px(10.))
                        .pb(px(8.))
                        .font_family(typography::MONO_FONT)
                        .text_size(typography::text_sm())
                        .line_height(px(19.))
                        .whitespace_nowrap()
                        .child({
                            let spans = code_line_spans(language.as_deref(), code);
                            let theme = cx.theme().clone();
                            let lines: Vec<AnyElement> = code
                                .split('\n')
                                .enumerate()
                                .map(|(row, line)| {
                                    let line_path = path.child(row);
                                    let drawn = crate::inline_edit::code_line_text(line);
                                    let highlights = sel.highlights(&line_path, &drawn, crate::inline_edit::code_line_highlights(line, spans.get(row).map(Vec::as_slice).unwrap_or_default(), &theme));
                                    let text = StyledText::new(drawn).with_highlights(highlights);
                                    let layout = text.layout().clone();
                                    crate::selection::draggable(div().min_h(px(19.)), line_path, layout, cx).child(text).into_any_element()
                                })
                                .collect();
                            div().flex().flex_col().children(lines)
                        }),
                )
                .into_any_element()
        }
        Block::List { start, items } => div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .children(items.iter().enumerate().map(|(index, item)| {
                let marker: AnyElement = match (item.checked, start) {
                    (Some(checked), _) => Icon::new(if checked { IconName::CheckCircle } else { IconName::CircleDotted })
                        .size(IconSize::XSmall)
                        .color(if checked { colors.success } else { colors.subtle_foreground })
                        .into_any_element(),
                    (None, Some(start)) => div().child(format!("{}.", start + index as u64)).into_any_element(),
                    (None, None) => div().child("•").into_any_element(),
                };
                div()
                    .flex()
                    .items_start()
                    .gap(px(6.))
                    .child(div().flex_none().min_w(px(16.)).flex().justify_end().pt(px(1.)).text_color(colors.subtle_foreground).child(marker))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .children(render_blocks(&item.blocks, &path.child(index), sel, cx)),
                    )
            }))
            .into_any_element(),
        Block::Quote(blocks) => div()
            .pl(px(10.))
            .border_l_2()
            .border_color(colors.border_strong)
            .text_color(colors.muted_foreground)
            .flex()
            .flex_col()
            .gap(px(6.))
            .children(render_blocks(blocks, path, sel, cx))
            .into_any_element(),
        Block::Rule => div().h(px(1.)).my(px(4.)).bg(colors.divider).into_any_element(),
        Block::Table { header, rows } => {
            let cell = |text: &Inline, cell_path: SpanPath, bold: bool, cx: &mut Context<SessionView>| {
                div()
                    .flex_1()
                    .min_w_0()
                    .px(px(8.))
                    .py(px(4.))
                    .when(bold, |this| this.font_weight(typography::MEDIUM))
                    .child(render_inline(text, &cell_path, sel, cx))
            };
            let header_row = div()
                .flex()
                .bg(colors.raised)
                .border_b_1()
                .border_color(colors.border)
                .children(header.iter().enumerate().map(|(index, text)| cell(text, path.child(0).child(index), true, cx)).collect::<Vec<_>>());
            let body_rows: Vec<AnyElement> = rows
                .iter()
                .enumerate()
                .map(|(row_index, row)| {
                    div()
                        .flex()
                        .when(row_index + 1 < rows.len(), |this| this.border_b_1().border_color(colors.divider))
                        .children(row.iter().enumerate().map(|(index, text)| cell(text, path.child(row_index + 1).child(index), false, cx)).collect::<Vec<_>>())
                        .into_any_element()
                })
                .collect();
            div()
                .w_full()
                .rounded(metrics::radius_lg())
                .border_1()
                .border_color(colors.border)
                .overflow_hidden()
                .text_size(typography::text_sm())
                .child(header_row)
                .children(body_rows)
                .into_any_element()
        }
    }
}

/// Inline text with emphasis, code and clickable links. Links to files in the project open them;
/// web links open in the browser.
fn render_inline(inline: &Inline, path: &SpanPath, sel: &Selecting, cx: &mut Context<SessionView>) -> AnyElement {
    let colors = colors(cx);
    // A GitHub link reads with its entity's icon before the text (`GitHubEntityIcon`); the icon
    // is drawn over non-breaking spaces so it wraps with the link.
    let (marked, marks) = inline.with_link_marks(LINK_ICON_SPACE, |href| matches!(crate::chat_link::target(href), crate::chat_link::LinkTarget::GitHub(_)));
    let inline = &marked;
    let mut highlights = Vec::new();
    let mut fonts = Vec::new();
    for span in &inline.spans {
        if marks.iter().any(|(range, _)| *range == span.range) {
            continue;
        }
        let style = &span.style;
        let mut highlight = HighlightStyle::default();
        if style.bold {
            highlight.font_weight = Some(FontWeight::SEMIBOLD);
        }
        if style.italic {
            highlight.font_style = Some(FontStyle::Italic);
        }
        if style.strikethrough {
            highlight.strikethrough = Some(StrikethroughStyle { thickness: px(1.), color: None });
        }
        if style.code {
            highlight.background_color = Some(colors.accent);
            fonts.push((span.range.clone(), SharedString::from(typography::MONO_FONT)));
        }
        // `TextLink`: the primary colour, not underlined at rest.
        if style.link.is_some() {
            highlight.color = Some(colors.primary);
        }
        highlights.push((span.range.clone(), highlight));
    }
    let highlights = sel.highlights(path, &inline.text, highlights);
    let text = StyledText::new(inline.text.clone()).with_highlights(highlights).with_font_family_overrides(fonts);
    let layout = text.layout().clone();
    let holder = crate::selection::draggable(div().min_w_0(), path.clone(), layout.clone(), cx);
    let links = inline.links();
    if links.is_empty() {
        return holder.child(text).into_any_element();
    }
    let ranges: Vec<std::ops::Range<usize>> = links.iter().map(|(range, _)| range.clone()).collect();
    let targets: Vec<String> = links.into_iter().map(|(_, target)| target).collect();
    let labels: Vec<String> = ranges.iter().map(|range| inline.text.get(range.clone()).unwrap_or_default().to_string()).collect();
    let view = cx.entity().downgrade();
    let card_targets: Vec<(std::ops::Range<usize>, String)> = ranges.iter().cloned().zip(targets.iter().cloned()).collect();
    let card_view = view.clone();
    let text = InteractiveText::new(SharedString::from(format!("inline-{path}")), text)
        .tooltip(move |position, _, cx| {
            let (_, href) = card_targets.iter().find(|(range, _)| range.contains(&position))?;
            let root = card_view.read_with(cx, |this, _| this.info.cwd.clone()).ok().flatten();
            let href = href.clone();
            Some(LinkCardView::build(href, root, cx))
        })
        .on_click(ranges, move |index, _, cx| {
            let Some(target) = targets.get(index) else { return };
            let label = labels.get(index).map(String::as_str).unwrap_or_default();
            if let Ok(Some(link)) = view.update(cx, |this, cx| this.file_link(target, label, cx)) {
                view.update(cx, |this, cx| this.open_location(link.path, link.line, cx)).ok();
                return;
            }
            if let crate::chat_link::LinkTarget::GitHub(entity) = crate::chat_link::target(target)
                && let Some((kind, id)) = entity.resource()
                && let Ok(Some(root)) = view.read_with(cx, |this, _| this.info.cwd.clone())
                && crate::chat_link::project_repository(&root).is_some_and(|repository| entity.belongs_to(&repository))
            {
                workbench_api::open_resource(cx, kind, &id, &entity.reference(true));
                return;
            }
            if (target.starts_with("http://") || target.starts_with("https://"))
                && let Ok(session) = view.read_with(cx, |this, _| this.info.id.clone())
            {
                workbench_api::request(cx, workbench_api::OpenRequest::SessionLink { session, url: target.clone() });
                return;
            }
            cx.open_url(target);
        })
        .into_any_element();
    if marks.is_empty() {
        return holder.child(text).into_any_element();
    }
    let icons: Vec<(std::ops::Range<usize>, IconName)> = marks.into_iter().filter_map(|(range, href)| Some((range, link_entity_icon(&href)?))).collect();
    let color = colors.subtle_foreground;
    holder
        .relative()
        .child(text)
        .child(
            gpui::canvas(
                |_, _, _| (),
                move |_, _, window, cx| {
                    for (range, icon) in &icons {
                        let (Some(start), Some(end)) = (layout.position_for_index(range.start), layout.position_for_index(range.end)) else { continue };
                        if start.y != end.y {
                            continue;
                        }
                        let line_height = layout.line_height();
                        let size = (end.x - start.x - px(4.)).min(line_height).max(px(8.));
                        let bounds = gpui::Bounds::new(gpui::point(start.x, start.y + (line_height - size) / 2.), gpui::size(size, size));
                        window.paint_svg(bounds, icon.path().into(), None, gpui::TransformationMatrix::unit(), color, cx).ok();
                    }
                },
            )
            .absolute()
            .top_0()
            .left_0()
            .size_full(),
        )
        .into_any_element()
}

/// Two figure spaces and a narrow one, all non-breaking: about the width of the original's
/// 16px icon and its 4px gap at the chat's text size.
pub(crate) const LINK_ICON_SPACE: &str = "\u{2007}\u{2007}\u{202F}";

/// The icon a GitHub link shows before its text, before its state is known.
fn link_entity_icon(href: &str) -> Option<IconName> {
    use crate::chat_link::{GitHubEntity, LinkTarget};
    let LinkTarget::GitHub(entity) = crate::chat_link::target(href) else { return None };
    Some(match entity {
        GitHubEntity::PullRequest { .. } => IconName::GitPullRequest,
        GitHubEntity::Issue { .. } => IconName::CircleDot,
        GitHubEntity::Commit { .. } => IconName::GitCommit,
        GitHubEntity::ActionRun { .. } => IconName::Play,
    })
}

/// What a link in an answer leads to, shown while the pointer rests on it (`LinkCard`).
/// A pull request's or issue's live title, state and author, as a link's hover card shows them.
#[derive(Clone, Debug, PartialEq, Eq)]
struct GitHubDetails {
    title: String,
    state: String,
    author: String,
}

/// A link's hover card; for a pull request or issue of the project's repository it asks GitHub
/// for the title and state when it opens (`GitHubCard`).
struct LinkCardView {
    href: String,
    root: Option<PathBuf>,
    details: Option<Result<GitHubDetails, ()>>,
    _lookup: Option<gpui::Task<()>>,
}

impl LinkCardView {
    fn build(href: String, root: Option<PathBuf>, cx: &mut App) -> gpui::AnyView {
        let preference = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).github_token_source.clone());
        cx.new(|cx| {
            let lookup = Self::lookup(&href, root.as_deref(), preference).map(|lookup| {
                cx.spawn(async move |this, cx| {
                    let found = cx.background_spawn(async move { lookup() }).await;
                    this.update(cx, |this: &mut Self, cx| {
                        this.details = Some(found.ok_or(()));
                        cx.notify();
                    })
                    .ok();
                })
            });
            Self { href, root, details: None, _lookup: lookup }
        })
        .into()
    }

    /// The GitHub call for a pull request or issue of the project's own repository.
    fn lookup(href: &str, root: Option<&std::path::Path>, preference: Option<String>) -> Option<impl FnOnce() -> Option<GitHubDetails> + Send + 'static> {
        use crate::chat_link::{GitHubEntity, LinkTarget};
        let LinkTarget::GitHub(entity) = crate::chat_link::target(href) else { return None };
        let root = root?;
        let repository = crate::chat_link::project_repository(root)?;
        if !entity.belongs_to(&repository) {
            return None;
        }
        let path = root.to_string_lossy().into_owned();
        let (pull_request, number) = match entity {
            GitHubEntity::PullRequest { number, .. } => (true, number as i64),
            GitHubEntity::Issue { number, .. } => (false, number as i64),
            _ => return None,
        };
        Some(move || {
            let token = github_token(preference.as_deref());
            if pull_request {
                let details = github_panel::gh::github_get_pr_details(path, number, token).ok()?;
                Some(GitHubDetails { title: details.title, state: details.state, author: details.author.login })
            } else {
                let details = github_panel::gh::github_get_issue_details(path, number, token).ok()?;
                Some(GitHubDetails { title: details.title, state: details.state, author: details.author.login })
            }
        })
    }
}

#[cfg(not(target_family = "wasm"))]
fn github_token(preference: Option<&str>) -> Option<String> {
    github_panel::auth::find_token(github_panel::gh::TokenSourcePreference::from_setting(preference)).map(|token| token.value)
}

#[cfg(target_family = "wasm")]
fn github_token(_preference: Option<&str>) -> Option<String> {
    None
}

impl Render for LinkCardView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let loading = self._lookup.is_some() && self.details.is_none();
        let details = self.details.clone().and_then(Result::ok);
        link_card(&self.href, self.root.as_deref(), details.as_ref(), loading, cx)
    }
}

fn link_card(href: &str, root: Option<&std::path::Path>, details: Option<&GitHubDetails>, loading: bool, cx: &App) -> ui::HoverCard {
    use crate::chat_link::{GitHubEntity, LinkTarget};
    let colors = colors(cx);
    let mut icon_color = colors.subtle_foreground;
    let (icon, title, meta, hint) = match crate::chat_link::target(href) {
        LinkTarget::GitHub(entity) => {
            let same = root.and_then(crate::chat_link::project_repository).is_some_and(|repository| entity.belongs_to(&repository));
            let state = details.map(|details| details.state.to_uppercase());
            icon_color = match state.as_deref() {
                Some("MERGED") => colors.merged,
                Some("CLOSED") => colors.destructive,
                Some("OPEN") => colors.success,
                _ => colors.subtle_foreground,
            };
            let icon = match entity {
                GitHubEntity::PullRequest { .. } if state.as_deref() == Some("MERGED") => IconName::GitMerge,
                GitHubEntity::PullRequest { .. } => IconName::GitPullRequest,
                GitHubEntity::Issue { .. } => IconName::CircleDot,
                GitHubEntity::Commit { .. } => IconName::GitCommit,
                GitHubEntity::ActionRun { .. } => IconName::Play,
            };
            let hint = if same && !matches!(entity, GitHubEntity::Commit { .. }) { "Opens in Athas" } else { "Opens on GitHub" };
            let reference = entity.reference(same);
            match details {
                Some(details) => {
                    let mut state = details.state.to_lowercase();
                    if let Some(first) = state.get_mut(0..1) {
                        first.make_ascii_uppercase();
                    }
                    let author = (!details.author.is_empty()).then(|| format!("by {}", details.author));
                    let meta = [Some(reference), Some(state), author].into_iter().flatten().collect::<Vec<_>>().join(" · ");
                    (icon, details.title.clone(), Some(meta), hint)
                }
                None => {
                    let url = href.trim().trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.").to_string();
                    // The project's own items read their reference alone once the lookup is over.
                    let meta = (loading || !same).then_some(url);
                    (icon, if loading { "Loading…".to_string() } else { reference }, meta, hint)
                }
            }
        }
        LinkTarget::Web { host, .. } => (IconName::Globe, host, Some(href.trim().to_string()), "Opens in your browser"),
        LinkTarget::Mail(address) => (IconName::Globe, address, None, "Opens your mail app"),
        LinkTarget::File { path, line } => {
            let shown = root.and_then(|root| std::path::Path::new(&path).strip_prefix(root).ok()).map_or(path.clone(), |relative| relative.display().to_string());
            (IconName::File, shown, line.map(|line| format!("Line {line}")), "Opens in the editor")
        }
    };
    ui::HoverCard::new().child(
        div()
            .flex()
            .items_start()
            .gap(px(10.))
            .min_w_0()
            .child(div().mt(px(2.)).flex_none().child(Icon::new(icon).size(IconSize::Small).color(icon_color)))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(title))
                    .children(meta.map(|meta| div().mt(px(2.)).truncate().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(meta)))
                    .child(div().mt(px(8.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(hint)),
            ),
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_error_the_reply_already_said_is_not_repeated() {
        use crate::thread::{AgentMessage, Entry};
        let limit = "You've hit your 5-hour limit · resets 7am (Europe/Istanbul)";
        let entries = vec![
            Entry::User(Default::default()),
            Entry::Agent(AgentMessage { text: limit.to_string(), ..Default::default() }),
        ];
        assert_eq!(error_core("Internal error: abc def ghij"), "abc def ghij");
        assert_eq!(error_core("no prefix here at all"), "no prefix here at all");
        assert!(said_already(&entries, &format!("Internal error: {limit}")));
        assert!(said_already(&entries, limit));
        // Something the reply did not say stays, and a few words are too little to match on.
        assert!(!said_already(&entries, "Internal error: the agent stopped unexpectedly"));
        assert!(!said_already(&entries, "Error: nope"));
        // A reply from an earlier turn is not this turn's.
        let earlier = vec![entries[1].clone(), Entry::User(Default::default())];
        assert!(!said_already(&earlier, limit));
    }

    use super::*;

    #[test]
    fn long_output_keeps_its_last_lines() {
        assert_eq!(last_lines("a\nb\nc", 2), "… 1 earlier lines\nb\nc");
    }
}

pub(crate) type LineSpans = Rc<Vec<Vec<(std::ops::Range<usize>, editor::SyntaxKind)>>>;

thread_local! {
    static CODE_SPANS: std::cell::RefCell<std::collections::HashMap<(Option<String>, String), LineSpans>> = Default::default();
}

/// Syntax spans of each line of a reply's code block, by the fence's language; kept per block so
/// a redraw does not parse it again.
pub(crate) fn code_line_spans(language: Option<&str>, code: &str) -> LineSpans {
    let key = (language.map(str::to_string), code.to_string());
    if let Some(spans) = CODE_SPANS.with(|cache| cache.borrow().get(&key).cloned()) {
        return spans;
    }
    let lower = language.unwrap_or_default().to_lowercase();
    let extension = editor::extension_for_language(&lower);
    let path = std::path::Path::new("snippet").with_extension(extension);
    let spans: LineSpans = if language.is_none() { Rc::new(Vec::new()) } else { Rc::new(crate::inline_edit::split_line_spans(editor::highlight_snippet(&path, code), code)) };
    CODE_SPANS.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.len() > 256 {
            cache.clear();
        }
        cache.insert(key, spans.clone());
    });
    spans
}

impl SessionView {
    /// The agent picker's choices: providers for the built-in agent, then every agent.
    pub(crate) fn agent_choice_entries(&mut self, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let current = if builtin::is_builtin(&self.info.agent) {
            builtin::AGENT_ID.to_string()
        } else if crate::codex::is_codex(&self.info.agent) {
            crate::codex::AGENT_ID.to_string()
        } else {
            agents::catalog_id(&self.info.agent).to_string()
        };
        let registry = crate::agent_registry::AgentRegistry::global(cx);
        let mut choices: Vec<(String, String)> = agents::KNOWN_AGENTS.iter().map(|agent| (agent.id.to_string(), agent.name.to_string())).collect();
        // Agents this app installed from the catalog or the ACP Registry.
        for agent in registry.read(cx).agents() {
            if !choices.iter().any(|(id, _)| *id == agent.id) && registry.read(cx).state(&agent.id).is_installed() {
                choices.push((agent.id.clone(), agent.name.clone()));
            }
        }
        let builtin_entry = {
            let view = cx.entity();
            MenuEntry::Item(MenuItem::new(builtin::NAME).icon(IconName::Sparkle).checked(current == builtin::AGENT_ID).on_select(move |_, cx| {
                view.update(cx, |this, cx| this.set_agent(builtin::AGENT_ID.to_string(), cx));
            }))
        };
        let mut entries: Vec<MenuEntry> = std::iter::once(builtin_entry)
            .chain(choices.into_iter().map(|(id, name)| {
                let view = cx.entity();
                let (state, operation, installable) = {
                    let registry = registry.read(cx);
                    let installable = registry.agent(&id).is_some_and(|agent| {
                        agent.unavailable.is_none() && agent.install.as_ref().is_some_and(|install| registry.tools().missing_for(&install.runtime).is_none())
                    });
                    (registry.state(&id), registry.operation(&id), installable)
                };
                let mut item = MenuItem::new(name).icon(crate::model_vendor::provider_icon(&id)).checked(current == id);
                if operation == Some(crate::agent_registry::Operation::Installing) {
                    item = item.shortcut("Installing…");
                } else if !state.is_installed() {
                    item = item.shortcut(if installable { "Install" } else { "Not installed" });
                }
                let install = !state.is_installed() && installable && operation.is_none();
                MenuEntry::Item(item.on_select(move |_, cx| {
                    view.update(cx, |this, cx| {
                        this.set_agent(id.clone(), cx);
                        if install {
                            this.install_agent(cx);
                        }
                    });
                }))
            }))
            .collect();
        let codex_entry = {
            let view = cx.entity();
            let mut item = MenuItem::new(crate::codex::NAME).icon(IconName::BrandOpenai).checked(current == crate::codex::AGENT_ID);
            if !crate::codex::is_installed() {
                item = item.shortcut("Not installed");
            }
            MenuEntry::Item(item.on_select(move |_, cx| {
                view.update(cx, |this, cx| this.set_agent(crate::codex::AGENT_ID.to_string(), cx));
            }))
        };
        entries.insert(1, codex_entry);
        entries.insert(0, MenuEntry::Label("Agents".into()));
        entries
    }
}
