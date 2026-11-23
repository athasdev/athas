//! The session's side column: quiet boxes on the right of the conversation (Environment,
//! Context, Changes, Running, Plan, Connectors, Cost), each folding from its title and shown
//! only when it has something to say. The column hides when the session view is narrow, and
//! the session header's toggle puts it away; both choices are kept in the settings.

use ui::WithScrollbar as _;
use std::{path::PathBuf, time::Duration};

use ui::scale::px;
use gpui::{
    AnyElement, AnyView, App, ClickEvent, Context, Entity, Hsla, IntoElement, ParentElement, Pixels, Render, SharedString, Styled,
    Subscription, Task, WeakEntity, Window, div, prelude::*, relative,
};
use serde_json::Value;
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, typography};

use crate::{
    SessionView, builtin,
    cloud::{CloudRun, api::RunStatus, environment},
    context_budget::estimate_tokens,
    summary::{self, SessionSummary},
    thread::{Entry, PlanStatus, ToolContent, ToolStatus},
};

/// Files listed in the Changes box before "N more".
const MAX_BOX_CHANGES: usize = 8;
/// The column's width.
fn side_column_width() -> Pixels { px(268.) }
/// Below this width of the session view the column stays hidden.
fn side_min_view_width() -> Pixels { px(900.) }
/// Settings keys: whether the column shows, and the boxes folded away.
const SHOWN_KEY: &str = "agentSessionSidePanel";
const COLLAPSED_KEY: &str = "agentSessionCollapsedBoxes";

/// Whether the session's side column is turned on (it still hides in a narrow view).
pub fn side_panel_shown(cx: &App) -> bool {
    cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).extra.get(SHOWN_KEY).and_then(Value::as_bool).unwrap_or(true))
}

/// Shows or puts away the session's side column (the session header's toggle).
pub fn toggle_side_panel(cx: &mut App) {
    if cx.try_global::<settings::SettingsStore>().is_none() {
        return;
    }
    let shown = side_panel_shown(cx);
    settings::update(cx, |settings| {
        settings.extra.insert(SHOWN_KEY.into(), Value::Bool(!shown));
    });
    cx.refresh_windows();
}

/// Shows the side column with one box unfolded (More actions > Plan).
pub fn reveal_box(id: &str, cx: &mut App) {
    if cx.try_global::<settings::SettingsStore>().is_none() {
        return;
    }
    let mut collapsed = collapsed_boxes(cx);
    collapsed.retain(|box_id| box_id != id);
    settings::update(cx, |settings| {
        settings.extra.insert(SHOWN_KEY.into(), Value::Bool(true));
        settings.extra.insert(COLLAPSED_KEY.into(), Value::Array(collapsed.into_iter().map(Value::String).collect()));
    });
    cx.refresh_windows();
}

fn collapsed_boxes(cx: &App) -> Vec<String> {
    if cx.try_global::<settings::SettingsStore>().is_none() {
        return Vec::new();
    }
    settings::get(cx)
        .extra
        .get(COLLAPSED_KEY)
        .and_then(Value::as_array)
        .map(|ids| ids.iter().filter_map(|id| id.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

impl SessionView {
    /// The conversation with the side column beside it, when the view is wide enough and the
    /// column is on. The view's width is measured each frame; crossing the threshold redraws.
    pub(crate) fn with_side_column(&mut self, body: AnyElement, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let wide = self.side_wide.unwrap_or_else(|| window.viewport_size().width >= side_min_view_width() + px(300.));
        let show = wide && side_panel_shown(cx);
        let side = show.then(|| {
            let view = match &self.side_boxes {
                Some(view) => view.clone(),
                None => {
                    let session = cx.entity();
                    let this: &SessionView = self;
                    let view = cx.new(|cx| SessionDockView::new(&session, this, cx));
                    self.side_boxes = Some(view.clone());
                    view
                }
            };
            div().flex_none().w(side_column_width()).h_full().min_h_0().flex().flex_col().child(AnyView::from(view))
        });
        let weak = cx.weak_entity();
        let measured = self.side_wide;
        div()
            .relative()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_row()
            .child(
                gpui::canvas(
                    move |bounds, _, cx| {
                        let now = bounds.size.width >= side_min_view_width();
                        if measured != Some(now) {
                            cx.defer(move |cx| {
                                weak.update(cx, |this, cx| {
                                    if this.side_wide != Some(now) {
                                        this.side_wide = Some(now);
                                        cx.notify();
                                    }
                                })
                                .ok();
                            });
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .child(div().flex_1().min_w_0().min_h_0().flex().flex_col().child(body))
            .children(side)
            .into_any_element()
    }
}

/// What the boxes of a cloud session show (`cloud-session-boxes.tsx`): its repository and
/// branch, and the run it sent last.
#[derive(Clone, PartialEq)]
struct CloudState {
    repo: Option<String>,
    branch: Option<String>,
    run: Option<CloudRun>,
}

impl CloudState {
    fn of(session: &SessionView) -> Option<Self> {
        let cloud = session.transcript.cloud.as_ref()?;
        Some(Self { repo: cloud.repo.clone(), branch: cloud.branch.clone(), run: session.last_cloud_run.clone() })
    }

    fn working(&self) -> bool {
        self.run.as_ref().is_some_and(|run| matches!(run.status, RunStatus::Queued | RunStatus::Running))
    }
}

/// The Context box's reading: tokens in the window, its size, and what fills it.
#[derive(Clone, Debug, PartialEq)]
struct ContextState {
    used: u64,
    /// 0 when the agent does not say how big its window is.
    size: u64,
    /// The count is Athas's estimate, not the agent's.
    estimated: bool,
    /// What fills the window, largest first, estimated from the conversation.
    parts: Vec<(&'static str, u64)>,
    can_compact: bool,
    running: bool,
}

impl ContextState {
    fn of(session: &SessionView, summary: &SessionSummary) -> Option<Self> {
        let (mut messages, mut tools, mut thinking) = (0u64, 0u64, 0u64);
        for entry in &session.transcript.entries {
            match entry {
                Entry::User(message) => messages += estimate_tokens(&message.text) as u64,
                Entry::Agent(message) => messages += estimate_tokens(&message.text) as u64,
                Entry::Thought(thought) => thinking += estimate_tokens(&thought.text) as u64,
                Entry::ToolCall(call) => {
                    tools += estimate_tokens(&call.title) as u64;
                    for content in &call.content {
                        tools += match content {
                            ToolContent::Text { text } => estimate_tokens(text) as u64,
                            ToolContent::Diff { old_text, new_text, .. } => (estimate_tokens(new_text) + old_text.as_deref().map_or(0, estimate_tokens)) as u64,
                            ToolContent::Terminal { .. } => 0,
                        };
                    }
                    tools += call.terminal_output.as_deref().map_or(0, estimate_tokens) as u64;
                }
                Entry::Notice(_) => {}
            }
        }
        let rules = session.rules_budget.as_ref().map_or(0, |(_, rules)| estimate_tokens(rules) as u64);
        let mut parts: Vec<(&'static str, u64)> = vec![("Messages", messages), ("Tool results", tools), ("Thinking", thinking), ("Project rules", rules)];
        let estimate: u64 = parts.iter().map(|(_, tokens)| tokens).sum();
        let (used, size, estimated) = match summary.context {
            Some(context) => (context.used, context.size, false),
            None if estimate > 0 => (estimate, 0, true),
            None => return None,
        };
        if !estimated {
            // The agent's count is the truth: the estimate is scaled into it, and what is left
            // is its own instructions and tools.
            if estimate > used && estimate > 0 {
                let scale = used as f64 / estimate as f64;
                for part in &mut parts {
                    part.1 = (part.1 as f64 * scale) as u64;
                }
            }
            let counted: u64 = parts.iter().map(|(_, tokens)| tokens).sum();
            parts.push(("System and tools", used.saturating_sub(counted)));
        }
        parts.retain(|(_, tokens)| *tokens > 0);
        parts.sort_by(|a, b| b.1.cmp(&a.1));
        let can_compact = builtin::is_builtin(&session.info.agent) || session.transcript.commands.iter().any(|command| command.name == "compact");
        Some(Self { used, size, estimated, parts, can_compact, running: session.is_running() })
    }

    fn percent(&self) -> Option<f32> {
        (self.size > 0).then(|| (self.used as f32 / self.size as f32 * 100.).clamp(0., 100.))
    }
}

pub struct SessionDockView {
    session: WeakEntity<SessionView>,
    summary: SessionSummary,
    cloud: Option<CloudState>,
    context: Option<ContextState>,
    skipped_mcp: Vec<String>,
    pull_request: Option<crate::pull_request::BranchPullRequest>,
    refresh: Option<Task<()>>,
    _observe: Subscription,
}

impl SessionDockView {
    /// `current` is the session's state now: the view is made while the session draws.
    pub(crate) fn new(session: &Entity<SessionView>, current: &SessionView, cx: &mut Context<Self>) -> Self {
        let observe = cx.observe(session, |this, _, cx| this.schedule_refresh(cx));
        let mut this = Self {
            session: session.downgrade(),
            summary: SessionSummary::default(),
            cloud: None,
            context: None,
            skipped_mcp: Vec::new(),
            pull_request: None,
            refresh: None,
            _observe: observe,
        };
        this.read_session(current);
        this
    }

    /// Takes what the boxes show from the session; whether anything changed.
    fn read_session(&mut self, session: &SessionView) -> bool {
        let summary = session.summary();
        let cloud = CloudState::of(session);
        let context = ContextState::of(session, &summary);
        let pull_request = session.pull_request().cloned();
        let changed = summary != self.summary || cloud != self.cloud || context != self.context || session.skipped_mcp != self.skipped_mcp || pull_request != self.pull_request;
        if changed {
            self.summary = summary;
            self.cloud = cloud;
            self.context = context;
            self.skipped_mcp = session.skipped_mcp.clone();
            self.pull_request = pull_request;
        }
        changed
    }

    /// Streaming changes the session many times a second; the boxes follow a few times a second.
    fn schedule_refresh(&mut self, cx: &mut Context<Self>) {
        if self.refresh.is_some() {
            return;
        }
        self.refresh = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(200)).await;
            this.update(cx, |this, cx| {
                this.refresh = None;
                let Some(session) = this.session.upgrade() else { return };
                if this.read_session(session.read(cx)) {
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    fn with_session(&self, cx: &mut Context<Self>, f: impl FnOnce(&mut SessionView, &mut Context<SessionView>)) {
        if let Some(session) = self.session.upgrade() {
            session.update(cx, f);
        }
    }

    fn toggle(&mut self, id: &'static str, cx: &mut Context<Self>) {
        let mut collapsed = collapsed_boxes(cx);
        if collapsed.iter().any(|box_id| box_id == id) {
            collapsed.retain(|box_id| box_id != id);
        } else {
            collapsed.push(id.to_string());
        }
        if cx.try_global::<settings::SettingsStore>().is_some() {
            settings::update(cx, |settings| {
                settings.extra.insert(COLLAPSED_KEY.into(), Value::Array(collapsed.into_iter().map(Value::String).collect()));
            });
        }
        cx.notify();
    }

    /// One box: a quiet title that folds it, a short reading beside the title, and its rows.
    fn section(&self, id: &'static str, title: &'static str, reading: Option<AnyElement>, rows: Vec<AnyElement>, collapsed: &[String], cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let expanded = !collapsed.iter().any(|box_id| box_id == id);
        let group = SharedString::from(format!("side-box-{id}"));
        div()
            .flex()
            .flex_col()
            .min_w_0()
            .px(px(12.))
            .py(px(10.))
            .rounded(ui::metrics::island_radius())
            .bg(colors.surface.opacity(0.55))
            .child(
                div()
                    .id(SharedString::from(format!("side-box-title-{id}")))
                    .group(group.clone())
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .h(px(18.))
                    .text_size(typography::text_caption())
                    .text_color(colors.subtle_foreground)
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle(id, cx)))
                    .child(div().font_weight(typography::MEDIUM).hover(|style| style.text_color(colors.muted_foreground)).child(title))
                    .child(
                        div()
                            .invisible()
                            .group_hover(group, |style| style.visible())
                            .child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(colors.subtle_foreground)),
                    )
                    .child(div().flex_1())
                    .children(reading),
            )
            .when(expanded, |this| this.child(div().flex().flex_col().min_w_0().gap(px(2.)).pt(px(8.)).children(rows)))
            .into_any_element()
    }
}

/// The enabled MCP servers from the settings, which go along to the session's agent.
fn connectors(cx: &App) -> Vec<String> {
    let Some(_) = cx.try_global::<settings::SettingsStore>() else { return Vec::new() };
    settings::get(cx)
        .mcp_servers
        .iter()
        .filter_map(|value| serde_json::from_value::<ai_mcp::McpServerSetting>(value.clone()).ok())
        .filter(|server| server.enabled && !server.name.trim().is_empty())
        .map(|server| server.name.trim().to_string())
        .collect()
}

/// The context fill at which the Context box offers "Compact session".
const COMPACT_SUGGEST_PERCENT: f32 = 70.;

/// A plain row: an icon, a label (with a quieter line under it), and a value at the end.
fn row(icon: Option<IconName>, label: impl Into<SharedString>, detail: Option<String>, trailing: Option<AnyElement>, cx: &App) -> gpui::Div {
    row_with(icon, label, detail, false, trailing, cx)
}

/// A row whose quieter text sits beside the label, on the same line.
fn inline_row(icon: Option<IconName>, label: impl Into<SharedString>, detail: Option<String>, trailing: Option<AnyElement>, cx: &App) -> gpui::Div {
    row_with(icon, label, detail, true, trailing, cx)
}

fn row_with(icon: Option<IconName>, label: impl Into<SharedString>, detail: Option<String>, inline: bool, trailing: Option<AnyElement>, cx: &App) -> gpui::Div {
    let leading = icon.map(|icon| Icon::new(icon).size(IconSize::XSmall).color(cx.theme().colors.subtle_foreground).into_any_element());
    row_parts(leading, label, detail, inline, trailing, cx)
}

/// A changed file's row: the icon theme's icon for it, its name and folder on one line.
fn file_row(name: String, folder: Option<String>, trailing: Option<AnyElement>, cx: &App) -> gpui::Div {
    let icon = extensions::file_icon(&name, px(14.), cx)
        .unwrap_or_else(|| Icon::new(IconName::File).size(IconSize::XSmall).color(cx.theme().colors.subtle_foreground).into_any_element());
    row_parts(Some(icon), name, folder, true, trailing, cx)
}

fn row_parts(leading: Option<AnyElement>, label: impl Into<SharedString>, detail: Option<String>, inline: bool, trailing: Option<AnyElement>, cx: &App) -> gpui::Div {
    let colors = &cx.theme().colors;
    let detail = detail.map(|detail| div().truncate().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(detail));
    div()
        .flex()
        .items_center()
        .gap(px(8.))
        .min_w_0()
        .min_h(px(24.))
        .text_size(typography::text_sm())
        .text_color(colors.muted_foreground)
        .children(leading.map(|leading| div().flex().flex_none().child(leading)))
        .child(if inline {
            div()
                .flex()
                .items_baseline()
                .gap(px(6.))
                .flex_1()
                .min_w_0()
                .child(div().truncate().child(label.into()))
                .children(detail.map(|detail| detail.flex_1().min_w_0()))
        } else {
            div().flex().flex_col().flex_1().min_w_0().child(div().truncate().child(label.into())).children(detail)
        })
        .children(trailing.map(|trailing| div().flex().flex_none().items_center().child(trailing)))
}

fn note(text: impl Into<SharedString>, cx: &App) -> AnyElement {
    div().text_size(typography::text_sm()).text_color(cx.theme().colors.subtle_foreground).child(text.into()).into_any_element()
}

fn reading(text: impl Into<SharedString>, cx: &App) -> AnyElement {
    div().text_size(typography::text_caption()).text_color(cx.theme().colors.subtle_foreground).child(text.into()).into_any_element()
}

fn diff_stats(additions: usize, deletions: usize, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .gap(px(4.))
        .text_size(typography::text_caption())
        .when(additions > 0, |this| this.child(div().text_color(colors.git_added).child(format!("+{additions}"))))
        .when(deletions > 0, |this| this.child(div().text_color(colors.git_deleted).child(format!("−{deletions}"))))
        .into_any_element()
}

/// A thin bar of coloured segments over the track; `fractions` add up to at most 1.
fn segmented_bar(segments: &[(f32, Hsla)], cx: &App) -> AnyElement {
    div()
        .flex()
        .h(px(4.))
        .w_full()
        .rounded(ui::metrics::radius_sm())
        .overflow_hidden()
        .bg(cx.theme().colors.divider)
        .children(segments.iter().filter(|(fraction, _)| *fraction > 0.).map(|(fraction, color)| div().h_full().flex_none().bg(*color).w(relative(fraction.clamp(0., 1.)))))
        .into_any_element()
}

fn dot(color: Hsla) -> AnyElement {
    div().size(px(14.)).flex().items_center().justify_center().child(div().size(px(6.)).rounded_full().bg(color)).into_any_element()
}

fn location_of(workspace: &std::path::Path) -> (IconName, String) {
    let workspace = workspace.to_string_lossy();
    if let Some(rest) = workspace.strip_prefix("remote://") {
        (IconName::Remote, format!("SSH · {}", rest.split('/').next().unwrap_or_default()))
    } else if let Some(rest) = workspace.strip_prefix("wsl://") {
        (IconName::TerminalWindow, format!("WSL · {}", rest.split('/').next().unwrap_or_default()))
    } else {
        (IconName::Laptop, if cfg!(target_os = "macos") { "This Mac" } else if cfg!(target_os = "windows") { "This PC" } else { "This computer" }.to_string())
    }
}

impl Render for SessionDockView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let summary = self.summary.clone();
        let colors = cx.theme().colors.clone();
        let collapsed = collapsed_boxes(cx);
        let mut boxes = Vec::new();

        let mut environment: Vec<AnyElement> = Vec::new();
        let cloud = self.cloud.clone();
        if let Some(cloud) = &cloud {
            let billing = if cloud.run.as_ref().and_then(|run| run.billing.as_deref()) == Some("own-key") { "Your API key" } else { "Athas credit" };
            environment.push(row(Some(IconName::Cloud), "Cloud sandbox", Some(billing.into()), None, cx).into_any_element());
            environment.push(row(Some(IconName::Github), cloud.repo.clone().unwrap_or_else(|| "No repository".into()), None, None, cx).into_any_element());
            environment.push(row(Some(IconName::GitBranch), cloud.branch.clone().unwrap_or_else(|| "Default branch".into()), None, None, cx).into_any_element());
            if let Some(branch) = cloud.run.as_ref().map(|run| run.branch.clone()).filter(|branch| !branch.is_empty()) {
                environment.push(row(Some(IconName::GitBranch), branch, Some("Pushes to".into()), None, cx).into_any_element());
            }
        } else if let Some(info) = &summary.environment {
            let (icon, place) = location_of(&info.workspace);
            environment.push(row(Some(icon), place, None, None, cx).into_any_element());
            environment.push(inline_row(Some(IconName::Folder), info.name.clone(), Some(info.workspace.display().to_string()), None, cx).into_any_element());
            if let Some(branch) = &info.branch {
                environment.push(row(Some(IconName::GitBranch), branch.clone(), None, None, cx).into_any_element());
            }
            if let Some(pull_request) = self.pull_request.clone() {
                let (number, title) = (pull_request.number, pull_request.title.clone());
                environment.push(
                    row(
                        Some(IconName::GitPullRequest),
                        pull_request.title.clone(),
                        Some(format!("#{} · {}", pull_request.number, pull_request.head_ref)),
                        Some(reading(pull_request.state_label(), cx)),
                        cx,
                    )
                    .id("env-pull-request")
                    .rounded(ui::metrics::radius_md())
                    .hover(|style| style.text_color(colors.foreground))
                    .on_click(move |_, _, cx| workbench_api::open_resource(cx, "github-pr", &number.to_string(), &format!("#{number} {title}")))
                    .into_any_element(),
                );
            }
        }
        if !environment.is_empty() {
            boxes.push(self.section("environment", "Environment", None, environment, &collapsed, cx));
        }

        if let Some(context) = self.context.clone() {
            let percent = context.percent();
            let palette = [colors.primary, colors.merged, colors.warning, colors.success, colors.info];
            let mut rows: Vec<AnyElement> = Vec::new();
            let headline = match percent {
                Some(percent) => format!("{}% used", percent.round()),
                None if context.estimated => format!("About {} tokens", summary::format_tokens(context.used)),
                None => format!("{} tokens", summary::format_tokens(context.used)),
            };
            let amount = (context.size > 0).then(|| format!("{} / {}", summary::format_tokens(context.used), summary::format_tokens(context.size)));
            rows.push(
                div()
                    .flex()
                    .items_baseline()
                    .gap(px(8.))
                    .text_size(typography::text_sm())
                    .child(div().text_color(colors.foreground).child(headline))
                    .child(div().flex_1())
                    .children(amount.map(|amount| div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(amount)))
                    .into_any_element(),
            );
            let total = if context.size > 0 { context.size } else { context.used.max(1) };
            let segments: Vec<(f32, Hsla)> = context.parts.iter().enumerate().map(|(index, (_, tokens))| (*tokens as f32 / total as f32, palette[index % palette.len()])).collect();
            rows.push(div().pt(px(6.)).pb(px(8.)).child(segmented_bar(&segments, cx)).into_any_element());
            for (index, (label, tokens)) in context.parts.iter().enumerate() {
                rows.push(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(2.))
                        .min_w_0()
                        .child(dot(palette[index % palette.len()]))
                        .child(row(None, *label, None, Some(reading(summary::format_tokens(*tokens), cx)), cx).min_h(px(22.)).flex_1())
                        .into_any_element(),
                );
            }
            if context.size > context.used {
                rows.push(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(2.))
                        .child(dot(colors.divider))
                        .child(row(None, "Free space", None, Some(reading(summary::format_tokens(context.size - context.used), cx)), cx).min_h(px(22.)).flex_1())
                        .into_any_element(),
                );
            }
            if let Some(cost) = &summary.cost {
                if let Some(total) = cost.cost.as_ref() {
                    rows.push(div().h(px(6.)).into_any_element());
                    rows.push(row(None, "Cost", None, Some(reading(summary::format_cost(total), cx)), cx).min_h(px(22.)).into_any_element());
                }
                if let (Some(input), Some(output)) = (cost.input_tokens, cost.output_tokens) {
                    rows.push(
                        row(None, "Read / written", None, Some(reading(format!("{} / {}", summary::format_tokens(input), summary::format_tokens(output)), cx)), cx)
                            .min_h(px(22.))
                            .into_any_element(),
                    );
                }
            }
            // Compacting is offered once the context is filling up.
            if context.can_compact && percent.is_some_and(|percent| percent >= COMPACT_SUGGEST_PERCENT) {
                rows.push(
                    div()
                        .flex()
                        .pt(px(8.))
                        .child(
                            Button::new("compact-session", "Compact session")
                                .leading_icon(IconName::ArrowsIn)
                                .variant(ButtonVariant::Outline)
                                .size(ButtonSize::Small)
                                .disabled(context.running)
                                .tooltip(if context.running { "Wait for the current response to finish" } else { "Summarise earlier messages to free up context" })
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                                    this.with_session(cx, |session, cx| {
                                        if builtin::is_builtin(&session.info.agent) {
                                            session.compact(cx);
                                        } else {
                                            session.send("/compact".into(), cx);
                                        }
                                    })
                                })),
                        )
                        .into_any_element(),
                );
            }
            let reading_text = percent.map(|percent| format!("{}%", percent.round()));
            boxes.push(self.section("context", "Context", reading_text.map(|text| reading(text, cx)), rows, &collapsed, cx));
        }

        let changes = &summary.changes;
        let mut change_rows: Vec<AnyElement> = Vec::new();
        let root = summary.environment.as_ref().map(|environment| environment.workspace.clone());
        for (index, change) in changes.files.iter().take(MAX_BOX_CHANGES).enumerate() {
            let name = change.path.file_name().map_or_else(|| change.path.display().to_string(), |name| name.to_string_lossy().into_owned());
            let folder = change
                .path
                .parent()
                .map(|parent| match &root {
                    Some(root) => parent.strip_prefix(root).unwrap_or(parent).display().to_string(),
                    None => parent.display().to_string(),
                })
                .unwrap_or_default();
            let path: PathBuf = change.path.clone();
            let failed = change.status == ToolStatus::Failed;
            change_rows.push(
                file_row(name, (!folder.is_empty()).then_some(folder), Some(diff_stats(change.additions, change.deletions, cx)), cx)
                    .id(("side-change", index))
                    .px(px(4.))
                    .mx(px(-4.))
                    .rounded(ui::metrics::radius_md())
                    .when(failed, |this| this.text_color(colors.destructive))
                    .hover(|style| style.bg(colors.accent).text_color(colors.foreground))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.with_session(cx, |session, cx| session.open_net_diff(&path, cx))))
                    .into_any_element(),
            );
        }
        let hidden = changes.files.len().saturating_sub(MAX_BOX_CHANGES);
        if hidden > 0 {
            let label = format!("{hidden} more {}", if hidden == 1 { "file" } else { "files" });
            change_rows.push(
                row(Some(IconName::GitDiff), label, None, None, cx)
                    .id("side-changes-more")
                    .hover(|style| style.text_color(colors.foreground))
                    .on_click(|_, window, cx| window.dispatch_action(Box::new(crate::review::ReviewAgentChanges), cx))
                    .into_any_element(),
            );
        }
        if let Some(run) = cloud.as_ref().and_then(|cloud| cloud.run.clone())
            && let Some(url) = run.pr_url.clone()
        {
            let number = environment::parse_pull_request_url(&url).map(|(_, number)| format!("#{number} · ")).unwrap_or_default();
            change_rows.insert(
                0,
                row(Some(IconName::GitPullRequest), run.title.clone(), Some(format!("{number}{}", run.branch)), Some(ui::Badge::new("Draft").tone(ui::Tone::Success).into_any_element()), cx)
                    .id("cloud-pull-request")
                    .hover(|style| style.text_color(colors.foreground))
                    .on_click(move |_, _, cx| cx.open_url(&url))
                    .into_any_element(),
            );
        }
        if !change_rows.is_empty() {
            // The totals open every change in one review.
            let change_reading = (!changes.files.is_empty()).then(|| {
                div()
                    .id("side-changes-total")
                    .px(px(4.))
                    .mr(px(-4.))
                    .rounded(ui::metrics::radius())
                    .hover(|style| style.bg(colors.accent))
                    .tooltip(ui::Tooltip::text("Review all changes"))
                    .on_click(|_, window, cx| {
                        cx.stop_propagation();
                        window.dispatch_action(Box::new(crate::review::ReviewAgentChanges), cx);
                    })
                    .child(diff_stats(changes.additions, changes.deletions, cx))
                    .into_any_element()
            });
            boxes.push(self.section("changes", "Changes", change_reading, change_rows, &collapsed, cx));
        }

        if let Some(plan) = &summary.plan {
            let total = plan.entries.len();
            let streaming = summary.turn_running;
            let mut rows = vec![div().pb(px(6.)).child(segmented_bar(&[(plan.done as f32 / total.max(1) as f32, colors.success)], cx)).into_any_element()];
            for (index, entry) in plan.entries.iter().enumerate() {
                let done = entry.status == PlanStatus::Completed;
                let running = entry.status == PlanStatus::InProgress;
                let mark = if done {
                    Icon::new(IconName::Check).size(IconSize::XSmall).color(colors.success).into_any_element()
                } else if running && streaming {
                    ui::Spinner::new(("side-plan-step", index)).compact().into_any_element()
                } else if running {
                    Icon::new(IconName::CircleDot).size(IconSize::XSmall).color(colors.primary).into_any_element()
                } else {
                    Icon::new(IconName::CircleDotted).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element()
                };
                rows.push(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(8.))
                        .min_w_0()
                        .py(px(2.))
                        .text_size(typography::text_sm())
                        .text_color(if done { colors.subtle_foreground } else if running { colors.foreground } else { colors.muted_foreground })
                        .child(div().mt(px(2.)).flex().flex_none().size(px(14.)).items_center().justify_center().child(mark))
                        .child(div().flex_1().min_w_0().child(entry.content.clone()))
                        .into_any_element(),
                );
            }
            boxes.push(self.section("plan", "Plan", Some(reading(format!("{} of {total} done", plan.done), cx)), rows, &collapsed, cx));
        }

        let mut running_rows: Vec<AnyElement> = Vec::new();
        if let Some(run) = cloud.as_ref().filter(|cloud| cloud.working()).and_then(|cloud| cloud.run.clone()) {
            let seconds = environment::run_sandbox_seconds(&run, chrono::Utc::now().timestamp_millis());
            let label = if run.status == RunStatus::Queued { "Starting sandbox".to_string() } else { format!("Sandbox · {}", environment::format_sandbox_time(seconds)) };
            running_rows.push(
                div()
                    .flex()
                    .items_center()
                    .gap(px(2.))
                    .child(dot(colors.success))
                    .child(
                        row(
                            None,
                            label,
                            Some(format!("Up to {} min", run.max_minutes)),
                            Some(
                                Button::icon("cloud-stop", IconName::Stop)
                                    .variant(ButtonVariant::Ghost)
                                    .size(ButtonSize::XSmall)
                                    .tooltip("Stop run")
                                    .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.with_session(cx, |session, cx| session.cancel_cloud_run(cx))))
                                    .into_any_element(),
                            ),
                            cx,
                        )
                        .flex_1(),
                    )
                    .into_any_element(),
            );
        }
        for (index, url) in summary.servers.iter().enumerate() {
            let label = url.trim_start_matches("http://").trim_start_matches("https://").trim_end_matches('/').to_string();
            let url = url.clone();
            running_rows.push(
                div()
                    .id(("side-server", index))
                    .flex()
                    .items_center()
                    .gap(px(2.))
                    .rounded(ui::metrics::radius_md())
                    .hover(|style| style.bg(colors.accent))
                    .child(dot(colors.success))
                    .child(row(None, label, None, Some(Icon::new(IconName::Globe).size(IconSize::XSmall).color(colors.subtle_foreground).into_any_element()), cx).flex_1())
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        let url = url.clone();
                        this.with_session(cx, |_, cx| cx.emit(crate::SessionViewEvent::OpenBrowser(Some(url))));
                    }))
                    .into_any_element(),
            );
        }
        for command in &summary.running {
            let short: String = command.command.lines().next().unwrap_or_default().chars().take(60).collect();
            running_rows.push(div().flex().items_center().gap(px(2.)).child(dot(colors.success)).child(row(None, short, None, None, cx).flex_1()).into_any_element());
        }
        if !running_rows.is_empty() {
            boxes.push(self.section("running", "Running", None, running_rows, &collapsed, cx));
        }

        let connectors = connectors(cx);
        if !connectors.is_empty() {
            let rows = connectors
                .iter()
                .map(|name| {
                    let skipped = self.skipped_mcp.contains(name);
                    row(Some(IconName::PlugsConnected), name.clone(), skipped.then(|| "This agent cannot use it".to_string()), None, cx)
                        .when(skipped, |this| this.text_color(colors.subtle_foreground))
                        .into_any_element()
                })
                .collect();
            let manage = div()
                .flex()
                .items_center()
                .gap(px(4.))
                .child(reading(connectors.len().to_string(), cx))
                .child(
                    Button::icon("manage-connectors", IconName::Settings)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::XSmall)
                        .tooltip("Manage MCP servers")
                        .on_click(|_, _, cx| workbench_api::open_settings(cx, Some("ai"), Some("MCP servers"))),
                )
                .into_any_element();
            boxes.push(self.section("connectors", "Connectors", Some(manage), rows, &collapsed, cx));
        }

        if let Some(run) = cloud.as_ref().and_then(|cloud| cloud.run.clone()) {
            let spent = environment::run_spent_micros(&run);
            let label = if run.billing.as_deref() == Some("own-key") { "Sandbox time, models on your key" } else { "Sandbox time and models" };
            let rows = match run.spend_cap_micros.filter(|cap| *cap > 0) {
                Some(cap) => vec![
                    div().pb(px(6.)).child(segmented_bar(&[(spent as f32 / cap as f32, if spent >= cap { colors.warning } else { colors.primary })], cx)).into_any_element(),
                    row(None, label, None, Some(reading(format!("{} of {}", environment::format_credit_micros(spent), environment::format_credit_micros(cap)), cx)), cx).into_any_element(),
                ],
                None => vec![note(format!("{} so far · {}", environment::format_credit_micros(spent), label.to_lowercase()), cx)],
            };
            boxes.push(self.section("cloud-cost", "Cost", Some(reading(environment::format_credit_micros(spent), cx)), rows, &collapsed, cx));
        }

        div()
            .id("session-side")
            .size_full()
            .min_h_0()
            .flex()
            .flex_col()
            .gap(px(8.))
            .overflow_y_scroll()
            .scrollbar(window, cx)
            .pt(px(12.))
            .pb(px(12.))
            .pr(px(12.))
            .font_family(typography::ui_font())
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .children(boxes)
    }
}
