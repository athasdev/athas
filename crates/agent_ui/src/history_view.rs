//! Session history: every saved session, searchable by title and transcript, newest first.
//! Picking one asks the workbench to open it.
//!
//! Drawn after Athas's `components/history` and `session-panel/components/session-browser-view.tsx`.

use std::{path::PathBuf, sync::Arc, time::Duration};

use gpui::{
    AppContext as _, ClickEvent, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ParentElement, Render, Styled,
    Subscription, Task, Window, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{AlertDialog, WithScrollbar, ConfirmOptions, EmptyState, IconName, SidebarListItem, TextInput, TextInputEvent, metrics, pane_header, typography};

use crate::history::{self, SearchHit};

#[derive(Clone, Debug, PartialEq)]
pub enum HistoryEvent {
    /// Open the saved session with this id.
    OpenSession(String),
    /// Import an agent's own session (`session/list`) into a new session of the project.
    ImportSession(crate::outside_sessions::OutsideSession),
}

pub struct HistoryView {
    dir: Option<PathBuf>,
    input: Entity<TextInput>,
    query: String,
    hits: Option<Arc<Vec<SearchHit>>>,
    search: Option<Task<()>>,
    /// The project whose agents are asked for their own sessions.
    project: Option<PathBuf>,
    outside: Option<Vec<crate::outside_sessions::OutsideSession>>,
    /// Where each agent with more sessions goes on (Load more).
    next: Vec<(String, String)>,
    /// The agents that could not list on the last load.
    errors: Vec<String>,
    /// The one agent whose sessions are shown (`AgentSessionsBrowser` is per agent); `None` lists all.
    agent: Option<String>,
    /// The Athas session holding an agent session, by its id: those rows read Open chat.
    holders: std::collections::HashMap<String, String>,
    finding: Option<Task<()>>,
    /// The outside session being deleted.
    deleting: Option<(String, Task<()>)>,
    confirm: Option<(Entity<AlertDialog>, Subscription)>,
    _subscription: Subscription,
}

impl EventEmitter<HistoryEvent> for HistoryView {}

impl Focusable for HistoryView {
    fn focus_handle(&self, cx: &gpui::App) -> FocusHandle {
        self.input.focus_handle(cx)
    }
}

impl HistoryView {
    /// History of the sessions saved under `dev.athas.gpui/sessions/`.
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_dir(crate::persistence::sessions_dir(), window, cx)
    }

    pub fn with_dir(dir: Option<PathBuf>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder("Search sessions").leading_icon(IconName::Search));
        let subscription = cx.subscribe(&input, |this, _, event: &TextInputEvent, cx| {
            if let TextInputEvent::Changed(query) = event {
                this.query = query.to_string();
                this.run_search(Duration::from_millis(120), cx);
            }
        });
        let mut this = Self { dir, input, query: String::new(), hits: None, search: None, project: None, outside: None, next: Vec::new(), errors: Vec::new(), agent: None, holders: Default::default(), finding: None, deleting: None, confirm: None, _subscription: subscription };
        this.run_search(Duration::ZERO, cx);
        this
    }

    /// Searches in the background, after typing pauses for `delay`.
    fn run_search(&mut self, delay: Duration, cx: &mut Context<Self>) {
        let Some(dir) = self.dir.clone() else {
            self.hits = Some(Arc::new(Vec::new()));
            return;
        };
        let query = self.query.clone();
        self.search = Some(cx.spawn(async move |this, cx| {
            if !delay.is_zero() {
                cx.background_executor().timer(delay).await;
            }
            let hits = cx.background_spawn(async move { history::search(&dir, &query) }).await;
            this.update(cx, |this, cx| {
                this.hits = Some(Arc::new(hits));
                this.search = None;
                cx.notify();
            })
            .ok();
        }));
    }

    /// The project whose agents' own sessions can be imported.
    pub fn set_project(&mut self, project: Option<PathBuf>, cx: &mut Context<Self>) {
        self.project = project;
        cx.notify();
    }

    /// Shows one agent's sessions, as picking its tab does (`openAgentSessions(agentId)`), and
    /// lists them; `None` shows every agent's.
    pub fn set_agent(&mut self, agent: Option<String>, cx: &mut Context<Self>) {
        self.agent = agent;
        self.find_outside_sessions(cx);
        cx.notify();
    }

    /// Asks the project's agents for the first page of the sessions they keep; those Athas
    /// already holds are listed with Open chat (`AgentSessionsBrowser`).
    fn find_outside_sessions(&mut self, cx: &mut Context<Self>) {
        self.load_page(false, cx);
    }

    /// Shows `page` as the agents' sessions, as a first listing would, with `holders` marking
    /// those Athas holds (headless renders and tests, which start no agent).
    pub fn show_agent_sessions(&mut self, page: crate::outside_sessions::SessionPage, holders: std::collections::HashMap<String, String>, cx: &mut Context<Self>) {
        self.outside = Some(page.sessions);
        self.next = page.next;
        self.errors = page.errors;
        self.holders = holders;
        cx.notify();
    }

    /// The next page of each agent that has more (Load more).
    fn load_more(&mut self, cx: &mut Context<Self>) {
        self.load_page(true, cx);
    }

    fn load_page(&mut self, more: bool, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else { return };
        let next: Vec<(String, String)> = self.next.iter().filter(|(agent, _)| self.agent.as_ref().is_none_or(|only| only == agent)).cloned().collect();
        if self.finding.is_some() || (more && next.is_empty()) {
            return;
        }
        let list = crate::outside_sessions::list_page(project, more.then_some(next), cx);
        self.finding = Some(cx.spawn(async move |this, cx| {
            let page = list.await;
            let holders = cx.background_spawn(async { crate::outside_sessions::holders() }).await;
            this.update(cx, |this, cx| {
                this.holders = holders;
                if more {
                    let asked: Vec<String> = page.next.iter().map(|(agent, _)| agent.clone()).collect();
                    let only = this.agent.clone();
                    this.next.retain(|(agent, _)| only.as_ref().is_some_and(|only| only != agent) && !asked.contains(agent));
                    this.next.extend(page.next);
                } else {
                    this.next = page.next;
                }
                this.errors = page.errors;
                match (&mut this.outside, more) {
                    (Some(outside), true) => outside.extend(page.sessions),
                    _ => this.outside = Some(page.sessions),
                }
                this.finding = None;
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    /// Asks before deleting an agent's session from the agent; it cannot be undone.
    fn confirm_delete(&mut self, session: crate::outside_sessions::OutsideSession, window: &mut Window, cx: &mut Context<Self>) {
        let view = cx.weak_entity();
        let title = if session.title.is_empty() { session.session_id.clone() } else { session.title.clone() };
        let dialog = AlertDialog::confirm(
            "Delete agent session",
            format!("Delete \u{201c}{title}\u{201d} from the agent? This cannot be undone."),
            ConfirmOptions { confirm_label: "Delete".into(), cancel_label: "Cancel".into(), destructive: true },
            move |_, cx| {
                view.update(cx, |this, cx| this.delete_outside(session.clone(), cx)).ok();
            },
            cx,
        );
        let subscription = cx.subscribe_in(&dialog, window, |this, _, _: &DismissEvent, window, cx| {
            this.confirm = None;
            window.focus(&this.input.focus_handle(cx), cx);
            cx.notify();
        });
        window.focus(&dialog.focus_handle(cx), cx);
        self.confirm = Some((dialog, subscription));
        cx.notify();
    }

    fn delete_outside(&mut self, session: crate::outside_sessions::OutsideSession, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else { return };
        let delete = crate::outside_sessions::delete(&session, project, cx);
        let id = session.session_id.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = delete.await;
            this.update(cx, |this, cx| {
                this.deleting = None;
                match result {
                    Ok(()) => {
                        if let Some(outside) = &mut this.outside {
                            outside.retain(|candidate| candidate.session_id != session.session_id);
                        }
                    }
                    Err(error) => {
                        notifications::error(cx, "Couldn't delete the session", Some(error.into()));
                    }
                }
                cx.notify();
            })
            .ok();
        });
        self.deleting = Some((id, task));
        cx.notify();
    }

    fn render_outside(&self, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        self.project.as_ref()?;
        let colors = cx.theme().colors.clone();
        let header = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .px(metrics::PANE_INSET)
            .py(px(4.))
            .text_size(typography::TEXT_SM)
            .text_color(colors.muted_foreground)
            .child(div().flex_1().child("Agent sessions"))
            .child(
                ui::Button::new("find-outside-sessions", if self.finding.is_some() && self.outside.is_none() { "Looking…" } else if self.outside.is_some() { "Look again" } else { "Find" })
                    .variant(ui::ButtonVariant::Ghost)
                    .size(ui::ButtonSize::Small)
                    .disabled(self.finding.is_some())
                    .tooltip("Ask Claude Code and Codex for the sessions they keep for this project")
                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.find_outside_sessions(cx))),
            );
        let filter = self.agent.clone();
        let shown: Option<Vec<crate::outside_sessions::OutsideSession>> =
            self.outside.as_ref().map(|sessions| sessions.iter().filter(|session| filter.as_ref().is_none_or(|only| *only == session.agent)).cloned().collect());
        let agents: Vec<String> = self.outside.as_ref().map_or_else(Vec::new, |sessions| {
            let mut agents: Vec<String> = Vec::new();
            for session in sessions {
                if !agents.contains(&session.agent) {
                    agents.push(session.agent.clone());
                }
            }
            agents
        });
        let mut rows: Vec<gpui::AnyElement> = Vec::new();
        if agents.len() > 1 || filter.is_some() {
            let chip = |id: &'static str, label: String, value: Option<String>, cx: &mut Context<Self>| {
                let selected = value == filter;
                ui::Button::new(gpui::SharedString::from(format!("{id}-{}", value.as_deref().unwrap_or("all"))), label)
                    .variant(ui::ButtonVariant::Tab)
                    .active(selected)
                    .size(ui::ButtonSize::XSmall)
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        this.agent = value.clone();
                        cx.notify();
                    }))
                    .into_any_element()
            };
            let mut chips = vec![chip("outside-agent", "All agents".into(), None, cx)];
            for agent in &agents {
                chips.push(chip("outside-agent", crate::acp::agents::display_name(agent), Some(agent.clone()), cx));
            }
            rows.push(div().flex().flex_wrap().gap(px(4.)).px(metrics::PANE_INSET).pb(px(4.)).children(chips).into_any_element());
        }
        rows.extend(self.errors.iter().map(|error| {
            div().px(metrics::PANE_INSET).pb(px(4.)).text_size(typography::TEXT_SM).text_color(colors.destructive).child(error.clone()).into_any_element()
        }));
        rows.extend(match &shown {
            Some(sessions) if sessions.is_empty() && !self.errors.is_empty() => Vec::new(),
            Some(sessions) if sessions.is_empty() => {
                vec![div().px(metrics::PANE_INSET).pb(px(6.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("No agent sessions for this project.").into_any_element()]
            }
            Some(sessions) => sessions
                .iter()
                .enumerate()
                .map(|(index, session)| {
                    let picked = session.clone();
                    let doomed = session.clone();
                    // `describeSession`: Updated with the age, or the session's id when the agent gave no time.
                    let updated = match session.updated_ms() {
                        0 => session.session_id.clone(),
                        ms => format!("Updated {}", workspace::relative_time(ms, workspace::now_ms())),
                    };
                    let busy = self.deleting.is_some();
                    let holder = self.holders.get(&session.session_id).cloned();
                    let event = match &holder {
                        Some(id) => HistoryEvent::OpenSession(id.clone()),
                        None => HistoryEvent::ImportSession(picked.clone()),
                    };
                    let button_event = event.clone();
                    let trailing = div()
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .when(self.deleting.as_ref().is_some_and(|(id, _)| *id == session.session_id), |this| this.child(ui::Spinner::new(("deleting-outside", index))))
                        .child(
                            ui::Button::new(("import-outside", index), if holder.is_some() { "Open chat" } else { "Import" })
                                .variant(ui::ButtonVariant::Outline)
                                .size(ui::ButtonSize::XSmall)
                                .disabled(busy)
                                .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| {
                                    cx.stop_propagation();
                                    cx.emit(button_event.clone());
                                })),
                        )
                        .when(session.deletable, |this| {
                            this.child(
                                ui::Button::icon(("delete-outside", index), IconName::Trash)
                                    .variant(ui::ButtonVariant::Ghost)
                                    .tone(ui::ButtonTone::Danger)
                                    .size(ui::ButtonSize::XSmall)
                                    .disabled(busy || holder.is_some())
                                    .tooltip(format!("Delete {}", session.title))
                                    .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                                        cx.stop_propagation();
                                        this.confirm_delete(doomed.clone(), window, cx);
                                    })),
                            )
                        });
                    let title = if session.title.is_empty() { "Untitled session".to_string() } else { session.title.clone() };
                    SidebarListItem::new(("outside", index), title)
                        .leading_icon(if holder.is_some() { IconName::ChatBubbleText } else { IconName::Download })
                        .description(format!("{} · {updated}", crate::acp::agents::display_name(&session.agent)))
                        .trailing(trailing)
                        .in_content()
                        .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| cx.emit(event.clone())))
                        .into_any_element()
                })
                .collect(),
            None => Vec::new(),
        });
        let more = self.next.iter().any(|(agent, _)| filter.as_ref().is_none_or(|only| only == agent));
        if self.outside.is_some() && more {
            rows.push(
                div()
                    .flex()
                    .px(metrics::PANE_INSET)
                    .py(px(4.))
                    .child(
                        ui::Button::new("load-more-outside", "Load more")
                            .variant(ui::ButtonVariant::Outline)
                            .size(ui::ButtonSize::Small)
                            .disabled(self.finding.is_some())
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.load_more(cx))),
                    )
                    .into_any_element(),
            );
        }
        if self.finding.is_some() && self.outside.is_some() {
            rows.push(div().px(metrics::PANE_INSET).pb(px(6.)).child(ui::Spinner::new("loading-outside").label("Loading sessions").show_label()).into_any_element());
        }
        Some(div().flex().flex_col().px(px(8.)).pb(px(4.)).child(header).children(rows).into_any_element())
    }

    fn open(&mut self, id: String, cx: &mut Context<Self>) {
        cx.emit(HistoryEvent::OpenSession(id));
    }
}

fn age(modified: std::time::SystemTime) -> String {
    let millis = |time: std::time::SystemTime| time.duration_since(std::time::UNIX_EPOCH).map_or(0, |duration| duration.as_millis() as u64);
    workspace::relative_time(millis(modified), workspace::now_ms())
}

impl Render for HistoryView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let body = match &self.hits {
            None => div().p(px(16.)).text_color(colors.subtle_foreground).child("Loading sessions…").into_any_element(),
            Some(hits) if hits.is_empty() => {
                let (title, message) = if self.query.trim().is_empty() {
                    ("No sessions yet", "Sessions you start are saved here.")
                } else {
                    ("No matches", "No session mentions that.")
                };
                div().flex_1().flex().items_center().justify_center().child(EmptyState::new(title).message(message).icon(IconName::History)).into_any_element()
            }
            Some(hits) => {
                let rows = hits.iter().enumerate().map(|(index, hit)| {
                    let id = hit.session.id.clone();
                    let detail = if hit.snippet.is_empty() {
                        format!("{} entries", hit.session.entries)
                    } else {
                        hit.snippet.clone()
                    };
                    SidebarListItem::new(("history", index), hit.session.title.clone())
                        .leading_icon(IconName::ChatBubbleText)
                        .description(detail)
                        .trailing(div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(age(hit.session.modified)))
                        .in_content()
                        .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.open(id.clone(), cx)))
                });
                div().id("history-results").flex_1().min_h_0().overflow_y_scroll().px(px(8.)).py(px(4.)).children(rows).scrollbar(window, cx).into_any_element()
            }
        };
        let count = self.hits.as_ref().map(|hits| hits.len());
        div()
            .id("session-history")
            .key_context("SessionHistory")
            .size_full()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_BASE)
            .text_color(colors.foreground)
            .child(
                pane_header(cx)
                    .gap(px(8.))
                    .child(div().font_weight(typography::MEDIUM).child("Session history"))
                    .child(div().flex_1())
                    .children(count.map(|count| {
                        div().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(format!("{count} {}", if count == 1 { "session" } else { "sessions" }))
                    })),
            )
            .child(div().px(metrics::PANE_INSET).py(px(8.)).child(self.input.clone()))
            .children(self.render_outside(cx))
            .child(body)
            .children(self.confirm.as_ref().map(|(dialog, _)| {
                gpui::deferred(div().id("history-confirm-layer").absolute().inset_0().bg(colors.scrim).flex().items_center().justify_center().occlude().child(dialog.clone()))
                    .with_priority(2)
            }))
    }
}
