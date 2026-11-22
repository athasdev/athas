//! The ACP inspector (kind `acp-inspector`): the JSON-RPC traffic between Athas and its ACP
//! agents, with requests paired to their responses, and what each side declared in `initialize`.
//!
//! Ported from Athas's `features/ai/acp-inspector`.

use std::{collections::HashSet, time::Duration};

use ui::scale::px;
use gpui::{
    App, ClickEvent, ClipboardItem, Context, Entity, FocusHandle, Focusable, IntoElement, ParentElement, Render, SharedString, Styled, Subscription,
    Task, Window, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{
    Badge, Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, ResourceSection, Select, SelectEvent, SelectOption, TextInput,
    TextInputEvent, ToggleGroup, ToggleOption, Tone, pane_header, typography,
};

use crate::acp::traffic::{self, Direction, Filter, Initialize, Kind, Message, Process};

pub const RESOURCE_KIND: &str = "acp-inspector";
const POLL: Duration = Duration::from_millis(150);
const ALL_SESSIONS: &str = "all";

#[derive(Clone, Copy, PartialEq)]
enum Tab {
    Messages,
    Capabilities,
}

pub struct AcpInspectorView {
    focus: FocusHandle,
    tab: Tab,
    processes: Vec<Process>,
    selected: Option<String>,
    messages: Vec<Message>,
    initialize: Initialize,
    revision: u64,
    query: Entity<TextInput>,
    direction: Option<Direction>,
    session: Entity<Select>,
    process_picker: Entity<Select>,
    expanded: HashSet<String>,
    /// The Inspector actions menu (Copy all, Export…, Clear).
    open_menu: Option<ui::OpenMenu>,
    _poll: Task<()>,
    _subscriptions: Vec<Subscription>,
}

impl Focusable for AcpInspectorView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl AcpInspectorView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let query = cx.new(|cx| TextInput::new(window, cx).placeholder("Filter by method or id").leading_icon(IconName::Search));
        let session = cx.new(|cx| Select::new(vec![SelectOption::new(ALL_SESSIONS, "All sessions")], ALL_SESSIONS, cx));
        let process_picker = cx.new(|cx| Select::new(Vec::new(), "", cx));
        let subscriptions = vec![
            cx.subscribe(&query, |_, _, event: &TextInputEvent, cx| {
                if matches!(event, TextInputEvent::Changed(_)) {
                    cx.notify();
                }
            }),
            cx.subscribe(&session, |_, _, event: &SelectEvent, cx| {
                if matches!(event, SelectEvent::Changed(_)) {
                    cx.notify();
                }
            }),
            cx.subscribe(&process_picker, |this, _, event: &SelectEvent, cx| {
                if let SelectEvent::Changed(key) = event {
                    this.select(Some(key.to_string()), cx);
                }
            }),
        ];
        let poll = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(POLL).await;
                let Ok(()) = this.update(cx, |this, cx| {
                    if traffic::revision() != this.revision {
                        this.refresh(cx);
                    }
                }) else {
                    return;
                };
            }
        });
        let mut this = Self {
            focus: cx.focus_handle(),
            tab: Tab::Messages,
            processes: Vec::new(),
            selected: None,
            messages: Vec::new(),
            initialize: Initialize::default(),
            revision: u64::MAX,
            query,
            direction: None,
            session,
            process_picker,
            expanded: HashSet::new(),
            open_menu: None,
            _poll: poll,
            _subscriptions: subscriptions,
        };
        this.refresh(cx);
        this
    }

    /// Opens the Capabilities tab; for previews.
    pub fn show_capabilities(&mut self, cx: &mut Context<Self>) {
        self.tab = Tab::Capabilities;
        cx.notify();
    }

    /// Unfolds the first prompt and its answer; for previews.
    pub fn expand_first(&mut self, cx: &mut Context<Self>) {
        if let Some(message) = self.messages.iter().find(|message| message.method.as_deref() == Some("session/prompt") && message.kind == Kind::Request) {
            self.expanded.insert(message.key.clone());
        }
        cx.notify();
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.revision = traffic::revision();
        self.processes = traffic::processes();
        if self.selected.as_ref().is_none_or(|key| !self.processes.iter().any(|process| &process.key == key)) {
            self.selected = self.processes.first().map(|process| process.key.clone());
        }
        let options: Vec<SelectOption> = self.processes.iter().map(|process| SelectOption::new(process.key.clone(), process.label())).collect();
        let selected = self.selected.clone().unwrap_or_default();
        self.process_picker.update(cx, |picker, cx| {
            picker.set_options(options, cx);
            picker.set_value(selected, cx);
        });
        let (entries, initialize) = self.selected.as_deref().and_then(traffic::backlog).unwrap_or_default();
        self.messages = traffic::messages(&entries);
        self.initialize = initialize;
        let mut sessions = vec![SelectOption::new(ALL_SESSIONS, "All sessions")];
        sessions.extend(traffic::session_ids(&self.messages).into_iter().map(|id| SelectOption::new(id.clone(), id)));
        self.session.update(cx, |select, cx| select.set_options(sessions, cx));
        cx.notify();
    }

    fn select(&mut self, key: Option<String>, cx: &mut Context<Self>) {
        if self.selected == key {
            return;
        }
        self.selected = key;
        self.expanded.clear();
        self.session.update(cx, |select, cx| select.set_value(ALL_SESSIONS, cx));
        self.refresh(cx);
    }

    fn filter(&self, cx: &App) -> Filter {
        let session = self.session.read(cx).value().to_string();
        Filter {
            query: self.query.read(cx).text().to_string(),
            direction: self.direction,
            session_id: (session != ALL_SESSIONS && !session.is_empty()).then_some(session),
        }
    }

    fn selected_process(&self) -> Option<&Process> {
        self.selected.as_ref().and_then(|key| self.processes.iter().find(|process| &process.key == key))
    }

    fn toggle(&mut self, key: &str, cx: &mut Context<Self>) {
        if !self.expanded.remove(key) {
            self.expanded.insert(key.to_string());
        }
        cx.notify();
    }

    fn render_messages(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        let colors = cx.theme().colors.clone();
        let filter = self.filter(cx);
        let visible = traffic::filter(&self.messages, &filter);
        if visible.is_empty() {
            let message = if self.messages.is_empty() { "No messages recorded for this process yet." } else { "No messages match the filter." };
            return div().flex().flex_1().justify_center().pt(px(48.)).child(EmptyState::new("No messages").message(message)).into_any_element();
        }
        let cell = |width: f32| div().flex_none().w(px(width)).truncate();
        let header = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .h(px(28.))
            .px(px(12.))
            .border_b_1()
            .border_color(colors.border)
            .text_size(typography::text_caption())
            .text_color(colors.subtle_foreground)
            .child(div().w(px(14.)))
            .child(cell(92.).child("Time"))
            .child(cell(64.).child("Direction"))
            .child(cell(96.).child("Type"))
            .child(div().flex_1().min_w_0().child("Method"))
            .child(cell(56.).child("Id"))
            .child(cell(64.).child("Latency"));
        let mut rows: Vec<gpui::AnyElement> = Vec::new();
        for message in visible {
            let open = self.expanded.contains(&message.key);
            let key = message.key.clone();
            let tone = if message.is_error {
                Tone::Danger
            } else {
                match message.kind {
                    Kind::Request => Tone::Accent,
                    Kind::Response => Tone::Success,
                    Kind::Stderr => Tone::Warning,
                    _ => Tone::Neutral,
                }
            };
            let direction_icon = match message.direction {
                Direction::In => IconName::ArrowLeft,
                Direction::Out => IconName::ArrowRight,
                Direction::Stderr => IconName::Terminal,
            };
            let latency = match (message.latency_ms, message.kind) {
                (Some(latency), _) => format!("{latency} ms"),
                (None, Kind::Request) => "Pending".to_string(),
                _ => String::new(),
            };
            let method = message.method.clone().unwrap_or_else(|| if message.kind == Kind::Stderr { message.raw.clone() } else { String::new() });
            rows.push(
                div()
                    .id(SharedString::from(format!("acp-row-{}", message.key)))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(ui::metrics::list_row())
                    .px(px(12.))
                    .text_size(typography::text_sm())
                    .when(open, |row| row.bg(colors.selected))
                    .hover(|row| row.bg(colors.accent))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle(&key, cx)))
                    .child(Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .child(cell(92.).font_family(typography::MONO_FONT).text_color(colors.muted_foreground).child(traffic::format_time(message.timestamp_ms)))
                    .child(
                        cell(64.)
                            .flex()
                            .items_center()
                            .gap(px(4.))
                            .text_color(colors.muted_foreground)
                            .child(Icon::new(direction_icon).size(IconSize::XSmall).color(colors.subtle_foreground))
                            .child(message.direction.label()),
                    )
                    .child(cell(96.).child(Badge::new(message.kind.label()).tone(tone)))
                    .child(div().flex_1().min_w_0().truncate().font_family(typography::MONO_FONT).child(method))
                    .child(cell(56.).font_family(typography::MONO_FONT).text_color(colors.muted_foreground).child(message.id.clone().unwrap_or_default()))
                    .child(cell(64.).text_color(colors.muted_foreground).child(latency))
                    .into_any_element(),
            );
            if open {
                rows.push(self.render_detail(message, cx));
            }
        }
        div().flex().flex_col().flex_1().min_h_0().child(header).child(div().id("acp-log").flex().flex_col().flex_1().min_h_0().overflow_y_scroll().children(rows)).into_any_element()
    }

    fn render_detail(&self, message: &Message, cx: &mut Context<Self>) -> gpui::AnyElement {
        let colors = cx.theme().colors.clone();
        let text = traffic::format_message(message);
        let partner = message.partner.as_ref().and_then(|key| self.messages.iter().find(|candidate| &candidate.key == key));
        let copy = text.clone();
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .pl(px(34.))
            .pr(px(12.))
            .pb(px(10.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .child(
                        Button::new(SharedString::from(format!("acp-copy-{}", message.key)), "Copy")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .leading_icon(IconName::Copy)
                            .on_click(move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()))),
                    )
                    .children(partner.map(|partner| {
                        let key = partner.key.clone();
                        Button::new(SharedString::from(format!("acp-partner-{}", message.key)), if partner.kind == Kind::Response { "Show response" } else { "Show request" })
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                                this.expanded.insert(key.clone());
                                cx.notify();
                            }))
                    }))
                    .children(message.session_id.clone().map(|id| div().font_family(typography::MONO_FONT).text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(id)))
                    .when(message.truncated, |row| row.child(Badge::new("Cut to the first 64 KiB").tone(Tone::Warning))),
            )
            .child(json_block(text, cx))
            .into_any_element()
    }

    fn render_capabilities(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        if self.initialize.request.is_none() {
            return div().flex().flex_1().justify_center().pt(px(48.)).child(EmptyState::new("No initialize yet").message("This agent process has not sent initialize yet.")).into_any_element();
        }
        let waiting = self.initialize.response.is_none();
        let sections: Vec<gpui::AnyElement> = traffic::initialize_summary(&self.initialize)
            .into_iter()
            .filter(|(title, value)| *title != "Initialize error" || value.is_some())
            .map(|(title, value)| {
                let text = match value {
                    Some(value) => serde_json::to_string_pretty(&value).unwrap_or_default(),
                    None if waiting && title != "Client info" && title != "Client capabilities" && title != "Initialize request" => "Waiting for the agent".to_string(),
                    None if title == "Auth methods" => "None".to_string(),
                    None => "—".to_string(),
                };
                ResourceSection::new(title).child(json_block(text, cx)).into_any_element()
            })
            .collect();
        div()
            .id("acp-capabilities")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .child(div().flex().flex_col().gap(px(24.)).px(px(16.)).py(px(16.)).max_w(px(860.)).children(sections))
            .into_any_element()
    }
}

fn json_block(text: String, cx: &App) -> impl IntoElement {
    let colors = &cx.theme().colors;
    div()
        .w_full()
        .px(px(10.))
        .py(px(8.))
        .rounded(ui::metrics::radius_md())
        .bg(colors.surface)
        .border_1()
        .border_color(colors.border)
        .font_family(typography::MONO_FONT)
        .text_size(typography::text_sm())
        .text_color(colors.foreground)
        .child(text)
}

impl AcpInspectorView {
    /// Saves the picked process's log as JSON Lines where the user chooses.
    fn export(&mut self, cx: &mut Context<Self>) {
        let Some(process) = self.selected_process().cloned() else { return };
        #[cfg(not(target_family = "wasm"))]
        let directory = dirs::download_dir().or_else(dirs::home_dir).unwrap_or_else(|| std::path::PathBuf::from("."));
        #[cfg(target_family = "wasm")]
        let directory = std::path::PathBuf::from(".");
        let name = traffic::export_file_name(&process.agent_id, workspace::now_ms());
        let path = cx.prompt_for_new_path(&directory, Some(&name));
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(path))) = path.await else { return };
            let result = cx
                .background_spawn(async move {
                    let export = traffic::export(&process.key).ok_or_else(|| "This agent process has no traffic log".to_string())?;
                    std::fs::write(&path, export).map_err(|error| format!("Failed to write {}: {error}", path.display()))
                })
                .await;
            cx.update(|cx| match result {
                Ok(()) => {
                    notifications::info(cx, "ACP traffic exported");
                }
                Err(error) => {
                    notifications::error(cx, format!("Couldn't export the log: {error}"), None);
                }
            });
        })
        .detach();
    }
}

impl Render for AcpInspectorView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let process = self.selected_process().cloned();
        let filter = self.filter(cx);
        let copy_all = traffic::format_messages(&traffic::filter(&self.messages, &filter));
        let header = pane_header(cx)
            .gap(px(8.))
            .child(Icon::new(IconName::ArrowsLeftRight).size(IconSize::Small).color(colors.muted_foreground))
            .child(div().font_weight(typography::MEDIUM).child("ACP Inspector"))
            .children(process.as_ref().map(|process| Badge::new(if process.running { "Running" } else { "Stopped" }).tone(if process.running { Tone::Success } else { Tone::Neutral })))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child(process.as_ref().and_then(|process| process.workspace.clone()).unwrap_or_else(|| "JSON-RPC traffic between Athas and its ACP agents".into())),
            )
            .when(!self.processes.is_empty(), |header| header.child(self.process_picker.clone()))
            .when(cfg!(not(target_family = "wasm")), |header| {
                let restart = process.clone();
                header.child(
                    Button::new("acp-restart", "Restart agent")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .leading_icon(IconName::ArrowClockwise)
                        .disabled(process.is_none())
                        .on_click(cx.listener(move |_, _: &ClickEvent, _, cx| {
                            let Some(process) = &restart else { return };
                            if crate::session_view::SessionView::restart_agent_process(&process.agent_id, process.workspace.as_deref(), cx) == 0 {
                                notifications::notify(
                                    cx,
                                    notifications::NotificationKind::Error,
                                    notifications::NotificationCategory::Athas,
                                    format!("Couldn't restart {}: no open session uses it", process.agent_name),
                                    None,
                                    None,
                                );
                            }
                        })),
                )
            })
            .child(
                Button::icon("acp-actions", IconName::Dots).size(ButtonSize::Small).tooltip("Inspector actions").on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                    let view = cx.entity();
                    let copy_all = copy_all.clone();
                    let (export_view, clear_view) = (view.clone(), view);
                    let entries = vec![
                        ui::MenuEntry::Item(ui::MenuItem::new("Copy all").disabled(this.messages.is_empty()).on_select(move |_, cx| cx.write_to_clipboard(ClipboardItem::new_string(copy_all.clone())))),
                        ui::MenuEntry::Item(ui::MenuItem::new("Export…").disabled(this.selected.is_none()).on_select(move |_, cx| export_view.update(cx, |this, cx| this.export(cx)))),
                        ui::MenuEntry::Item(ui::MenuItem::new("Clear").disabled(this.messages.is_empty()).on_select(move |_, cx| {
                            clear_view.update(cx, |this, cx| {
                                if let Some(key) = this.selected.clone() {
                                    traffic::clear(&key);
                                    this.expanded.clear();
                                    this.refresh(cx);
                                }
                            })
                        })),
                    ];
                    this.open_menu = Some(ui::OpenMenu::new("acp-actions", entries, event.position(), gpui::Anchor::TopRight, window, cx, |this, _| this.open_menu = None));
                    cx.notify();
                })),
            );
        let root = div()
            .id("acp-inspector")
            .key_context("AcpInspector")
            .track_focus(&self.focus)
            .size_full()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_size(typography::text_base())
            .text_color(colors.foreground)
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
            .child(header);
        if self.processes.is_empty() {
            return root
                .child(div().flex().flex_1().justify_center().pt(px(72.)).child(
                    EmptyState::new("No agent traffic yet").icon(IconName::ArrowsLeftRight).message("Start a chat with an ACP agent and its messages will show up here."),
                ))
                .into_any_element();
        }
        let tab_button = |id: &'static str, label: &'static str, icon: IconName, tab: Tab, cx: &mut Context<Self>| {
            Button::new(id, label).variant(ButtonVariant::Ghost).size(ButtonSize::Small).leading_icon(icon).active(self.tab == tab).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                this.tab = tab;
                cx.notify();
            }))
        };
        let direction = match self.direction {
            None => "all",
            Some(Direction::Out) => "out",
            Some(Direction::In) => "in",
            Some(Direction::Stderr) => "stderr",
        };
        let view = cx.entity().downgrade();
        let has_sessions = self.session.read(cx).value() != ALL_SESSIONS || !traffic::session_ids(&self.messages).is_empty();
        let tabs = div()
            .flex()
            .items_center()
            .flex_wrap()
            .gap(px(8.))
            .px(px(12.))
            .py(px(6.))
            .border_b_1()
            .border_color(colors.border)
            .child(tab_button("acp-tab-messages", "Messages", IconName::List, Tab::Messages, cx))
            .child(tab_button("acp-tab-capabilities", "Capabilities", IconName::BracketsCurly, Tab::Capabilities, cx))
            .when(self.tab == Tab::Messages, |tabs| {
                tabs.child(div().flex_1())
                    .child(div().w(px(208.)).child(self.query.clone()))
                    .child(
                        ToggleGroup::new(
                            "acp-direction",
                            vec![ToggleOption::new("all", "All"), ToggleOption::new("out", "Out"), ToggleOption::new("in", "In"), ToggleOption::new("stderr", "Stderr")],
                            direction,
                        )
                        .on_change(move |value, _, cx| {
                            view.update(cx, |this, cx| {
                                this.direction = match value.as_ref() {
                                    "out" => Some(Direction::Out),
                                    "in" => Some(Direction::In),
                                    "stderr" => Some(Direction::Stderr),
                                    _ => None,
                                };
                                cx.notify();
                            })
                            .ok();
                        }),
                    )
                    .when(has_sessions, |tabs| tabs.child(self.session.clone()))
            });
        let body = match self.tab {
            Tab::Messages => self.render_messages(cx),
            Tab::Capabilities => self.render_capabilities(cx),
        };
        root.child(tabs).child(body).into_any_element()
    }
}
