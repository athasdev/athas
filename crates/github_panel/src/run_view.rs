//! A workflow run in the centre (`github-action-viewer.tsx`): its summary and job progress, the
//! jobs and their steps, and the selected job's log.

use std::{collections::HashMap, ops::Range, path::PathBuf, sync::Arc, time::Duration};

use crate::gh::{WorkflowRunDetails, WorkflowRunJob};
use chrono::Utc;
use gpui::{
    Anchor, AnyElement, App, ClickEvent, ClipboardItem, Context, Entity, FocusHandle, Focusable, FontWeight, HighlightStyle, Hsla, IntoElement,
    ListAlignment, ListHorizontalSizingBehavior, ListOffset, ListState, Render, ScrollStrategy, SharedString, StyledText, Subscription, Task, UniformListScrollHandle, Window, div, prelude::*, px,
    list, relative, uniform_list,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{
    Button, ButtonSize, ButtonTone, ButtonVariant, Icon, IconName, IconSize, InputAppearance, MenuEntry, OpenMenu, Scrollbar, TextInput, TextInputEvent,
    WithScrollbar, metrics, typography,
};

use crate::{
    RunAction,
    logs::{self, LogColor, LogLevel, LogLine},
    menus::{self, MenuHost, below},
    model::{self, Tone},
    store,
    widgets::{Summary, badge, fill_message, meta_chip, rail, run_status_icon, tone_color, user_chip},
};

/// How often a running workflow and its log are re-read.
const ACTIVE_POLL_TICKS: usize = 15;

pub struct RunView {
    root: PathBuf,
    run_id: i64,
    focus_handle: FocusHandle,
    details: Option<Arc<WorkflowRunDetails>>,
    error: Option<SharedString>,
    loading: bool,
    job: Option<i64>,
    step: Option<usize>,
    logs: HashMap<i64, Arc<Vec<LogLine>>>,
    log_errors: HashMap<i64, SharedString>,
    loading_log: Option<i64>,
    timestamps: bool,
    /// Indices into the selected job's log that pass the step and the filter.
    visible: Arc<Vec<usize>>,
    highlight: Option<usize>,
    /// Error and warning lines among the visible ones, and the one Next/Previous problem landed on.
    problems: Arc<Vec<usize>>,
    problem_counts: (usize, usize),
    active_problem: Option<usize>,
    wrap: bool,
    /// `##[group]` lines folded shut, by line index.
    collapsed_groups: std::collections::HashSet<usize>,
    wrap_list: ListState,
    busy: Option<RunAction>,
    notice: Option<(SharedString, Tone)>,
    log_filter: Entity<TextInput>,
    log_scroll: UniformListScrollHandle,
    open_menu: Option<OpenMenu>,
    _subscriptions: Vec<Subscription>,
    _tick: Task<()>,
}

impl Focusable for RunView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl MenuHost for RunView {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu> {
        &mut self.open_menu
    }
}

pub(crate) fn details_key(root: &std::path::Path, run_id: i64) -> String {
    format!("{}|run|{run_id}", root.display())
}

fn job_state(job: &WorkflowRunJob) -> model::RunState {
    model::run_state(job.status.as_deref(), job.conclusion.as_deref())
}

impl RunView {
    pub fn new(root: PathBuf, run_id: i64, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let log_filter = cx.new(|cx| TextInput::new(window, cx).placeholder("Filter log").appearance(InputAppearance::Bare).leading_icon(IconName::Search));
        let subscriptions = vec![cx.subscribe(&log_filter, |this, input, event: &TextInputEvent, cx| match event {
            TextInputEvent::Changed(_) => {
                this.update_visible(cx);
                cx.notify();
            }
            TextInputEvent::Cancelled => input.update(cx, |input, cx| input.set_text("", cx)),
            _ => {}
        })];
        // Durations tick every second while the run is going; the run and its log reload every 15.
        let tick = cx.spawn_in(window, async move |this, cx| {
            let mut ticks = 0usize;
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                ticks += 1;
                let alive = this.update_in(cx, |this, window, cx| {
                    if !this.is_active() {
                        return;
                    }
                    cx.notify();
                    if ticks.is_multiple_of(ACTIVE_POLL_TICKS) && window.is_window_active() {
                        this.load(cx);
                        if let Some(job) = this.job {
                            this.load_log(job, true, cx);
                        }
                    }
                });
                if alive.is_err() {
                    break;
                }
            }
        });
        let details = store::get::<WorkflowRunDetails>(&details_key(&root, run_id), cx);
        let mut view = Self {
            root,
            run_id,
            focus_handle: cx.focus_handle(),
            details: None,
            error: None,
            loading: false,
            job: None,
            step: None,
            logs: HashMap::new(),
            log_errors: HashMap::new(),
            loading_log: None,
            timestamps: false,
            visible: Arc::default(),
            highlight: None,
            problems: Arc::default(),
            problem_counts: (0, 0),
            active_problem: None,
            wrap: false,
            collapsed_groups: Default::default(),
            wrap_list: ListState::new(0, ListAlignment::Top, px(800.)),
            busy: None,
            notice: None,
            log_filter,
            log_scroll: UniformListScrollHandle::new(),
            open_menu: None,
            _subscriptions: subscriptions,
            _tick: tick,
        };
        if let Some(details) = details {
            view.apply_details(details, cx);
        }
        view.load(cx);
        view
    }

    fn path(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn is_active(&self) -> bool {
        self.details.as_ref().is_some_and(|details| model::run_state(details.status.as_deref(), details.conclusion.as_deref()).is_active)
    }

    fn selected_job(&self) -> Option<&WorkflowRunJob> {
        let details = self.details.as_ref()?;
        details.jobs.iter().find(|job| job.id.is_some() && job.id == self.job)
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        if self.loading {
            return;
        }
        self.loading = true;
        cx.notify();
        let (path, run_id) = (self.path(), self.run_id);
        store::fetch(cx, move |token| crate::gh::github_get_workflow_run_details(path, run_id, Some(token)), |this, result, cx| {
            this.loading = false;
            match result {
                Ok(details) => {
                    let details = Arc::new(details);
                    store::put(details_key(&this.root, this.run_id), details.clone(), cx);
                    this.error = None;
                    this.apply_details(details, cx);
                }
                Err(error) => this.error = Some(error.into()),
            }
            cx.notify();
        });
    }

    fn apply_details(&mut self, details: Arc<WorkflowRunDetails>, cx: &mut Context<Self>) {
        let was_active = self.selected_job().is_some_and(|job| job_state(job).is_active);
        self.details = Some(details.clone());
        let still_there = self.job.is_some_and(|id| details.jobs.iter().any(|job| job.id == Some(id)));
        if !still_there {
            let initial = model::initial_job(&details.jobs).map(|index| &details.jobs[index]);
            self.job = initial.and_then(|job| job.id);
            self.step = initial.and_then(|job| model::initial_step(&job.steps));
        }
        if let Some(job) = self.job {
            // Fetch the final log once when the selected job finishes.
            let finished = was_active && self.selected_job().is_some_and(|job| !job_state(job).is_active);
            self.load_log(job, finished, cx);
        }
        self.update_visible(cx);
    }

    fn load_log(&mut self, job_id: i64, force: bool, cx: &mut Context<Self>) {
        let Some(job) = self.details.as_ref().and_then(|details| details.jobs.iter().find(|job| job.id == Some(job_id))) else { return };
        if !model::job_has_logs(job) || self.loading_log == Some(job_id) || (!force && self.logs.contains_key(&job_id)) {
            return;
        }
        self.loading_log = Some(job_id);
        self.log_errors.remove(&job_id);
        cx.notify();
        let path = self.path();
        store::fetch(
            cx,
            move |token| crate::gh::github_get_workflow_job_logs(path, job_id, Some(token)).map(|raw| logs::parse(&raw)),
            move |this, result, cx| {
                if this.loading_log == Some(job_id) {
                    this.loading_log = None;
                }
                match result {
                    Ok(lines) => {
                        this.logs.insert(job_id, Arc::new(lines));
                    }
                    Err(error) => {
                        this.log_errors.insert(job_id, error.into());
                    }
                }
                this.update_visible(cx);
                cx.notify();
            },
        );
    }

    /// Works out which log lines show, and the line a failed step opens on.
    fn update_visible(&mut self, cx: &mut Context<Self>) {
        let query = self.log_filter.read(cx).text().trim().to_lowercase();
        let Some(job) = self.selected_job() else {
            self.set_visible(Vec::new(), None);
            return;
        };
        let Some(lines) = self.job.and_then(|id| self.logs.get(&id)).cloned() else {
            self.set_visible(Vec::new(), None);
            return;
        };
        let ranges = logs::step_ranges(&lines, &job.steps);
        let range = self.step.and_then(|step| ranges.get(step).cloned().flatten()).unwrap_or(0..lines.len());
        let slice = &lines[range.start.min(lines.len())..range.end.min(lines.len())];
        let subject_failed = match self.step.and_then(|step| job.steps.get(step)) {
            Some(step) => model::run_state(step.status.as_deref(), step.conclusion.as_deref()).is_failed,
            None => job_state(job).is_failed,
        };
        let highlight = (query.is_empty() && subject_failed).then(|| logs::first_problem(slice).map(|offset| slice[offset].index)).flatten();
        let matching: Vec<usize> = slice.iter().filter(|line| logs::line_matches(line, &query)).map(|line| line.index).collect();
        let visible = logs::fold(&lines, &matching, &self.collapsed_groups);
        let problem = |level| visible.iter().filter(|index| lines.get(**index).is_some_and(|line| line.level == Some(level))).count();
        self.problem_counts = (problem(LogLevel::Error), problem(LogLevel::Warning));
        self.problems = Arc::new(visible.iter().copied().filter(|index| lines.get(*index).is_some_and(|line| matches!(line.level, Some(LogLevel::Error | LogLevel::Warning)))).collect());
        let changed = highlight != self.highlight;
        self.set_visible(visible, highlight);
        // Jump to the first problem when it changes, not on every reload.
        if changed && self.active_problem.is_none() && let Some(line) = highlight {
            self.reveal_line(line);
        }
    }

    fn set_visible(&mut self, visible: Vec<usize>, highlight: Option<usize>) {
        let old = self.visible.clone();
        if visible.len() >= old.len() && visible[..old.len()] == old[..] {
            self.wrap_list.splice(old.len()..old.len(), visible.len() - old.len());
        } else {
            self.wrap_list.reset(visible.len());
        }
        self.highlight = highlight;
        self.visible = Arc::new(visible);
    }

    fn reveal_line(&self, line: usize) {
        let Some(row) = self.visible.iter().position(|index| *index == line) else { return };
        self.log_scroll.scroll_to_item(row, ScrollStrategy::Center);
        self.wrap_list.scroll_to(ListOffset { item_ix: row.saturating_sub(3), offset_in_item: px(0.) });
    }

    fn jump_to_problem(&mut self, forward: bool, cx: &mut Context<Self>) {
        let Some(line) = logs::adjacent_problem(&self.problems, self.active_problem.or(self.highlight), forward) else { return };
        self.active_problem = Some(line);
        self.reveal_line(line);
        cx.notify();
    }

    fn select(&mut self, job_id: i64, step: Option<usize>, cx: &mut Context<Self>) {
        let job_changed = self.job != Some(job_id);
        self.job = Some(job_id);
        self.step = match step {
            Some(step) => Some(step),
            None => self.selected_job().and_then(|job| model::initial_step(&job.steps)),
        };
        if job_changed {
            self.log_filter.update(cx, |input, cx| input.set_text("", cx));
            self.collapsed_groups.clear();
        }
        self.active_problem = None;
        self.log_scroll.scroll_to_item(0, ScrollStrategy::Top);
        self.load_log(job_id, false, cx);
        self.update_visible(cx);
        cx.notify();
    }

    fn run_action(&mut self, action: RunAction, cx: &mut Context<Self>) {
        if self.busy.is_some() {
            return;
        }
        self.busy = Some(action);
        cx.notify();
        let (path, run_id) = (self.path(), self.run_id);
        store::fetch(cx, move |token| action.perform(path, run_id, token), move |this, result, cx| {
            this.busy = None;
            this.notice = Some(match result {
                Ok(()) => (action.done_message().into(), Tone::Success),
                Err(error) => (error.into(), Tone::Error),
            });
            this.load(cx);
            cx.notify();
        });
    }

    /// Folds or unfolds one `##[group]`.
    fn toggle_group(&mut self, line: usize, cx: &mut Context<Self>) {
        if !self.collapsed_groups.remove(&line) {
            self.collapsed_groups.insert(line);
        }
        self.update_visible(cx);
        cx.notify();
    }

    fn foldable_groups(&self) -> Vec<usize> {
        self.job.and_then(|id| self.logs.get(&id)).map(|lines| logs::foldable_groups(lines)).unwrap_or_default()
    }

    fn set_all_groups(&mut self, collapsed: bool, cx: &mut Context<Self>) {
        self.collapsed_groups = if collapsed { self.foldable_groups().into_iter().collect() } else { Default::default() };
        self.update_visible(cx);
        cx.notify();
    }

    /// Copy logs: the visible lines, as the log shows them.
    fn copy_logs(&mut self, cx: &mut Context<Self>) {
        use notifications::{NotificationCategory, NotificationKind};
        match self.log_text().filter(|text| !text.is_empty()) {
            Some(text) => {
                cx.write_to_clipboard(ClipboardItem::new_string(text));
                notifications::notify(cx, NotificationKind::Success, NotificationCategory::GitHub, "Logs copied", None, None);
            }
            None => {
                notifications::notify(cx, NotificationKind::Error, NotificationCategory::GitHub, "No log lines to copy.", None, None);
            }
        }
    }

    /// Export log: the visible lines saved to `run-<number>-<step or job>.log`.
    fn export_logs(&mut self, cx: &mut Context<Self>) {
        use notifications::{NotificationCategory, NotificationKind};
        let Some(text) = self.log_text().filter(|text| !text.is_empty()) else {
            notifications::notify(cx, NotificationKind::Error, NotificationCategory::GitHub, "No log lines to export.", None, None);
            return;
        };
        let job = self.selected_job();
        let subject = job
            .and_then(|job| self.step.and_then(|step| job.steps.get(step)).map(|step| step.name.clone()))
            .or_else(|| job.map(|job| job.name.clone()))
            .unwrap_or_else(|| "job".into());
        let run = self.details.as_ref().and_then(|details| details.run_number).map_or_else(|| self.run_id.to_string(), |number| number.to_string());
        let name = logs::export_file_name(&run, &subject);
        let directory = dirs_home();
        let path = cx.prompt_for_new_path(&directory, Some(&name));
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(path))) = path.await else { return };
            let written = write_file(&path, &text);
            cx.update(|cx| match written {
                Ok(()) => {
                    notifications::notify(cx, NotificationKind::Success, NotificationCategory::GitHub, "Log exported", None, None);
                }
                Err(error) => {
                    notifications::notify(cx, NotificationKind::Error, NotificationCategory::GitHub, error, None, None);
                }
            });
        })
        .detach();
    }

    fn log_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let foldable = !self.foldable_groups().is_empty();
        let has_rows = !self.visible.is_empty();
        let has_lines = self.job.and_then(|id| self.logs.get(&id)).is_some_and(|lines| !lines.is_empty());
        vec![
            crate::menus::item("Collapse all groups", cx, |this, _, cx| this.set_all_groups(true, cx)).disabled(!foldable).into(),
            crate::menus::item("Expand all groups", cx, |this, _, cx| this.set_all_groups(false, cx)).disabled(!foldable).into(),
            crate::menus::item("Find in logs", cx, |this, window, cx| {
                let focus = this.log_filter.focus_handle(cx);
                window.focus(&focus, cx);
            })
            .disabled(!has_rows)
            .into(),
            crate::menus::item("Export log", cx, |this, _, cx| this.export_logs(cx)).icon(IconName::Download).disabled(!has_lines).into(),
        ]
    }

    fn log_text(&self) -> Option<String> {
        let lines = self.logs.get(&self.job?)?;
        Some(logs::format_text(self.visible.iter().filter_map(|index| lines.get(*index)), self.timestamps))
    }

    fn render_summary(&self, details: &WorkflowRunDetails, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let state = model::run_state(details.status.as_deref(), details.conclusion.as_deref());
        let title = model::run_title(details.display_title.as_deref(), details.name.as_deref(), details.workflow_name.as_deref(), details.database_id);
        let repository_url = crate::pr_view::repository_url(&details.url);
        let mut badges = vec![badge(state.label.clone(), state.tone, colors).into_any_element()];
        if let Some(attempt) = details.run_attempt.filter(|attempt| *attempt > 1) {
            badges.push(badge(format!("Attempt {attempt}"), Tone::Warning, colors).into_any_element());
        }
        let started = details.run_started_at.as_deref().or(details.created_at.as_deref());
        let duration = model::elapsed(started, details.updated_at.as_deref(), state.is_active, now);
        let mut meta: Vec<AnyElement> = Vec::new();
        if let Some(workflow) = &details.workflow_name {
            let url = format!("{repository_url}/actions?query={}", url_encode(&format!("workflow:\"{workflow}\"")));
            meta.push(meta_chip("run-workflow", Some(IconName::Bolt), workflow.clone(), Some(url), false, colors).into_any_element());
        }
        meta.push(meta_chip("run-number", None, model::run_label(details.run_number, details.database_id), Some(details.url.clone()), true, colors).into_any_element());
        if let Some(branch) = &details.head_branch {
            meta.push(meta_chip("run-branch", Some(IconName::GitBranch), branch.clone(), Some(format!("{repository_url}/tree/{branch}")), true, colors).into_any_element());
        }
        if let Some(sha) = &details.head_sha {
            // The commit opens in Athas's commit view (`openCommitDiffBuffer`), titled with its message.
            let id = format!("{}|{sha}", self.root.to_string_lossy());
            let label = format!("{} {}", model::short_sha(sha), details.head_commit_message.as_deref().and_then(|message| message.lines().next()).unwrap_or(title.as_str()));
            let hover = colors.foreground;
            meta.push(
                meta_chip("run-sha", Some(IconName::GitCommit), model::short_sha(sha).to_string(), None, true, colors)
                    .hover(move |style| style.text_color(hover))
                    .on_click(move |_, _, cx| workbench_api::open_resource(cx, crate::pr_view::COMMIT_KIND, &id, &label))
                    .into_any_element(),
            );
        }
        if let Some(event) = &details.event {
            meta.push(div().child(event.clone()).into_any_element());
        }
        if let Some(actor) = &details.actor {
            meta.push(user_chip("run-actor", &actor.login, colors).into_any_element());
        }
        if let Some(started) = started {
            meta.push(div().child(format!("{} {}", if state.is_active { "Started" } else { "Ran" }, model::time_ago(started, now))).into_any_element());
        }
        if let Some(duration) = duration {
            meta.push(div().when(state.is_active, |this| this.text_color(colors.primary)).child(duration).into_any_element());
        }

        let mut actions: Vec<AnyElement> = Vec::new();
        let working = self.busy.is_some();
        if self.loading {
            actions.push(crate::widgets::caption("Refreshing…", colors).mr(px(4.)).into_any_element());
        }
        if state.is_active {
            actions.push(
                Button::new("run-cancel", if working { "Cancelling…" } else { "Cancel" })
                    .leading_icon(IconName::Stop)
                    .variant(ButtonVariant::Ghost)
                    .tone(ButtonTone::Danger)
                    .size(ButtonSize::Small)
                    .disabled(working)
                    .on_click(cx.listener(|this, _, _, cx| this.run_action(RunAction::Cancel, cx)))
                    .into_any_element(),
            );
        } else if state.is_failed {
            actions.push(
                Button::new("run-rerun-menu", if working { "Working…" } else { "Re-run" })
                    .leading_icon(IconName::ArrowClockwise)
                    .trailing_icon(IconName::ChevronDown)
                    .size(ButtonSize::Small)
                    .disabled(working)
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let entries: Vec<MenuEntry> = vec![
                            menus::item("Re-run failed jobs", cx, |this, _, cx| this.run_action(RunAction::RerunFailed, cx)).icon(IconName::ArrowCounterClockwise).into(),
                            menus::item("Re-run all jobs", cx, |this, _, cx| this.run_action(RunAction::Rerun, cx)).icon(IconName::ArrowClockwise).into(),
                        ];
                        menus::show(this, "run-rerun", entries, below(event), Anchor::TopRight, window, cx);
                    }))
                    .into_any_element(),
            );
        } else {
            actions.push(
                Button::new("run-rerun", if working { "Working…" } else { "Re-run" })
                    .leading_icon(IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .disabled(working)
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let entries: Vec<MenuEntry> = vec![
                            MenuEntry::Label("Re-run every job of this run?".into()),
                            menus::item("Re-run all jobs", cx, |this, _, cx| this.run_action(RunAction::Rerun, cx)).icon(IconName::ArrowClockwise).into(),
                        ];
                        menus::show(this, "run-rerun", entries, below(event), Anchor::TopRight, window, cx);
                    }))
                    .into_any_element(),
            );
        }
        let url = details.url.clone();
        actions.push(Button::icon("run-open-browser", IconName::OpenExternal).size(ButtonSize::Small).tooltip("Open on GitHub").on_click(move |_, _, cx| cx.open_url(&url)).into_any_element());
        actions.push(
            Button::icon("run-actions", IconName::Dots)
                .size(ButtonSize::Small)
                .active(menus::is_open(&self.open_menu, "run-actions"))
                .tooltip("Action run actions")
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                    let Some(details) = this.details.clone() else { return };
                    let mut entries: Vec<MenuEntry> = vec![
                        menus::item(if this.loading { "Refreshing…" } else { "Refresh" }, cx, |this, _, cx| {
                            this.load(cx);
                            if let Some(job) = this.job {
                                this.load_log(job, true, cx);
                            }
                        })
                        .icon(IconName::ArrowClockwise)
                        .into(),
                        menus::copy_named("Copy link", "Run link", details.url.clone()).icon(IconName::Link).into(),
                    ];
                    if let Some(sha) = &details.head_sha {
                        entries.push(menus::copy("Copy commit SHA", sha.clone()).icon(IconName::GitCommit).into());
                    }
                    menus::show(this, "run-actions", entries, below(event), Anchor::TopRight, window, cx);
                }))
                .into_any_element(),
        );

        let summary = model::summarize_jobs(&details.jobs);
        let aside = (summary.total > 0).then(|| {
            let label = if summary.failed > 0 {
                format!("{} of {} jobs failed", summary.failed, summary.total)
            } else if state.is_active {
                format!("{} of {} jobs finished", summary.completed, summary.total)
            } else {
                format!("{} of {} jobs passed", summary.succeeded, summary.total)
            };
            let fill = if summary.failed > 0 {
                colors.destructive
            } else if state.phase == model::Phase::Success {
                colors.success
            } else if state.is_active {
                colors.primary
            } else {
                colors.subtle_foreground
            };
            let fraction = summary.completed as f32 / summary.total as f32;
            let count = |count: usize, label: &str, color: Hsla| (count > 0).then(|| div().text_color(color).child(format!("{count} {label}")));
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .text_size(typography::TEXT_SM)
                        .text_color(colors.subtle_foreground)
                        .child(div().min_w_0().truncate().child(label))
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .gap(px(8.))
                                .children(count(summary.failed, "failed", colors.destructive))
                                .children(count(summary.running, "running", colors.primary))
                                .children(count(summary.queued, "queued", colors.warning))
                                .children(count(summary.succeeded, "passed", colors.success)),
                        ),
                )
                .child(div().h(px(4.)).w_full().rounded_full().bg(colors.segment_track).child(div().h_full().w(relative(fraction)).rounded_full().bg(fill)))
                .into_any_element()
        });
        let icon = run_status_icon(&state, IconSize::Custom(px(20.)), colors);
        let description = details
            .head_commit_message
            .as_deref()
            .map(|message| message.lines().next().unwrap_or_default().to_string())
            .filter(|message| *message != title && !message.is_empty())
            .map(SharedString::from);
        Summary { icon: icon.into_any_element(), title: crate::widgets::title_text(title), badges, description, meta, actions, aside }.render(colors).into_any_element()
    }

    fn render_jobs(&self, details: &WorkflowRunDetails, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let mut list = div().id("run-jobs").flex().flex_col().gap(px(2.)).w(px(288.)).flex_none().min_h_0().overflow_y_scroll().bg(colors.surface).p(px(8.));
        if details.jobs.is_empty() {
            return list.child(crate::widgets::list_message("No jobs reported for this run yet", None, None, colors)).scrollbar(window, cx).into_any_element();
        }
        let hover = colors.foreground;
        for (job_index, job) in details.jobs.iter().enumerate() {
            let state = job_state(job);
            let selected = job.id.is_some() && job.id == self.job;
            let duration = model::elapsed(job.started_at.as_deref(), job.completed_at.as_deref(), state.is_active, now);
            let job_id = job.id;
            list = list.child(
                div()
                    .id(SharedString::from(format!("run-job-{job_index}")))
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .h(metrics::LIST_ROW)
                    .px(px(8.))
                    .rounded(metrics::RADIUS_MD)
                    .text_size(typography::TEXT_SM)
                    .text_color(if selected { colors.foreground } else { colors.muted_foreground })
                    .when(selected, |this| this.bg(colors.selected).font_weight(typography::MEDIUM))
                    .hover(move |style| style.text_color(hover))
                    .child(Icon::new(if selected { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .child(run_status_icon(&state, IconSize::Small, colors))
                    .child(div().flex_1().min_w_0().truncate().child(job.name.clone()))
                    .child(
                        div()
                            .flex_none()
                            .text_size(typography::TEXT_CAPTION)
                            .text_color(if state.is_active { colors.primary } else { colors.subtle_foreground })
                            .child(duration.unwrap_or_else(|| state.label.clone())),
                    )
                    .when_some(job_id, |this, id| this.on_click(cx.listener(move |this, _, _, cx| this.select(id, None, cx))))
                    .on_mouse_down(gpui::MouseButton::Right, {
                        let entries = job_menu_entries(job, None);
                        cx.listener(move |this, event: &gpui::MouseDownEvent, window, cx| {
                            menus::show(this, &format!("job:{job_index}"), entries(), event.position, gpui::Anchor::TopLeft, window, cx)
                        })
                    }),
            );
            if !selected {
                continue;
            }
            let mut steps = div().flex().flex_col().gap(px(1.)).my(px(4.)).ml(px(12.)).pl(px(6.)).border_l_1().border_color(colors.divider);
            if job.steps.is_empty() {
                steps = steps.child(div().px(px(8.)).py(px(6.)).text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child("No steps reported yet"));
            }
            for (step_index, step) in job.steps.iter().enumerate() {
                let state = model::run_state(step.status.as_deref(), step.conclusion.as_deref());
                let active = self.step == Some(step_index);
                let duration = model::elapsed(step.started_at.as_deref(), step.completed_at.as_deref(), state.is_active, now);
                steps = steps.child(
                    div()
                        .id(SharedString::from(format!("run-step-{job_index}-{step_index}")))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .h(px(26.))
                        .px(px(8.))
                        .rounded(metrics::RADIUS_MD)
                        .text_size(typography::TEXT_SM)
                        .text_color(if active { colors.foreground } else { colors.muted_foreground })
                        .when(active, |this| this.bg(colors.selected))
                        .hover(move |style| style.text_color(hover))
                        .child(div().w(px(16.)).flex_none().text_right().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(step.number.unwrap_or(step_index as i64 + 1).to_string()))
                        .child(run_status_icon(&state, IconSize::XSmall, colors))
                        .child(div().flex_1().min_w_0().truncate().child(step.name.clone()))
                        .children(duration.map(|duration| div().flex_none().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(duration)))
                        .when_some(job_id, |this, id| this.on_click(cx.listener(move |this, _, _, cx| this.select(id, Some(step_index), cx))))
                        .on_mouse_down(gpui::MouseButton::Right, {
                            let entries = job_menu_entries(job, Some(step.name.clone()));
                            cx.listener(move |this, event: &gpui::MouseDownEvent, window, cx| {
                                menus::show(this, &format!("step:{job_index}:{step_index}"), entries(), event.position, gpui::Anchor::TopLeft, window, cx)
                            })
                        }),
                );
            }
            list = list.child(steps);
        }
        list.scrollbar(window, cx).into_any_element()
    }

    fn render_log(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let job = self.selected_job();
        let step = job.and_then(|job| self.step.and_then(|step| job.steps.get(step)));
        let title = match (job, step) {
            (Some(job), Some(step)) => format!("{} / {}", job.name, step.name),
            (Some(job), None) => job.name.clone(),
            _ => "Log".to_string(),
        };
        let job_url = job.and_then(|job| job.url.clone());
        let has_lines = self.job.and_then(|id| self.logs.get(&id)).is_some_and(|lines| !lines.is_empty());
        let toolbar = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .h(px(40.))
            .px(px(12.))
            .border_b_1()
            .border_color(colors.divider)
            .child(div().flex_1().min_w_0().truncate().text_size(typography::TEXT_SM).font_weight(typography::MEDIUM).child(title))
            .when(self.problem_counts.0 + self.problem_counts.1 > 0, |this| {
                let (errors, warnings) = self.problem_counts;
                let tone = if errors > 0 { colors.destructive } else { colors.warning };
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(2.))
                        .mr(px(4.))
                        .child(Button::icon("run-log-prev-problem", IconName::ArrowUp).size(ButtonSize::Small).tooltip("Previous problem").on_click(cx.listener(|this, _, _, cx| this.jump_to_problem(false, cx))))
                        .child(
                            div()
                                .id("run-log-problems")
                                .px(px(6.))
                                .py(px(2.))
                                .rounded(metrics::RADIUS)
                                .text_size(typography::TEXT_CAPTION)
                                .text_color(tone)
                                .hover(|this| this.bg(colors.accent))
                                .child(logs::problem_label(errors, warnings))
                                .on_click(cx.listener(|this, _, _, cx| this.jump_to_problem(true, cx))),
                        )
                        .child(Button::icon("run-log-next-problem", IconName::ArrowDown).size(ButtonSize::Small).tooltip("Next problem").on_click(cx.listener(|this, _, _, cx| this.jump_to_problem(true, cx)))),
                )
            })
            .child(div().w(px(200.)).flex_none().child(self.log_filter.clone()))
            .child(
                Button::icon("run-log-timestamps", IconName::Clock)
                    .size(ButtonSize::Small)
                    .active(self.timestamps)
                    .tooltip(if self.timestamps { "Hide timestamps" } else { "Show timestamps" })
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.timestamps = !this.timestamps;
                        cx.notify();
                    })),
            )
            .child(
                Button::icon("run-log-wrap", IconName::TextAlignJustify)
                    .size(ButtonSize::Small)
                    .active(self.wrap)
                    .tooltip(if self.wrap { "Disable line wrap" } else { "Wrap long lines" })
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.wrap = !this.wrap;
                        if let Some(line) = this.active_problem.or(this.highlight) {
                            this.reveal_line(line);
                        }
                        cx.notify();
                    })),
            )
            .child(
                Button::icon("run-log-copy", IconName::Copy)
                    .size(ButtonSize::Small)
                    .tooltip("Copy logs")
                    .disabled(!has_lines)
                    .on_click(cx.listener(|this, _, _, cx| this.copy_logs(cx))),
            )
            .child(
                Button::icon("run-log-refresh", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .tooltip("Refresh logs")
                    .disabled(!job.is_some_and(model::job_has_logs) || self.loading_log.is_some())
                    .on_click(cx.listener(|this, _, _, cx| {
                        if let Some(job) = this.job {
                            this.load_log(job, true, cx);
                        }
                    })),
            )
            .children(job_url.map(|url| Button::icon("run-log-open", IconName::OpenExternal).size(ButtonSize::Small).tooltip("Open job on GitHub").on_click(move |_, _, cx| cx.open_url(&url))))
            .child(
                Button::icon("run-log-more", IconName::Dots)
                    .size(ButtonSize::Small)
                    .tooltip("More log actions")
                    .active(crate::menus::is_open(&self.open_menu, "run-log-more"))
                    .on_click(cx.listener(|this, event: &gpui::ClickEvent, window, cx| {
                        let entries = this.log_menu(cx);
                        let position = event.position();
                        crate::menus::show(this, "run-log-more", entries, gpui::point(position.x, position.y + px(8.)), gpui::Anchor::TopRight, window, cx);
                    })),
            );

        let body = match job {
            None => fill_message("Select a job to see its log", None, None, colors).into_any_element(),
            Some(job) if !model::job_has_logs(job) => {
                let state = job_state(job);
                fill_message(format!("{} — logs appear once the job starts", state.label), None, None, colors).into_any_element()
            }
            Some(job) => {
                let id = job.id.unwrap_or_default();
                match (self.logs.get(&id), self.log_errors.get(&id)) {
                    (None, Some(error)) => fill_message(
                        error.clone(),
                        None,
                        Some(Button::new("run-log-retry", "Retry").size(ButtonSize::Small).on_click(cx.listener(move |this, _, _, cx| this.load_log(id, true, cx))).into_any_element()),
                        colors,
                    )
                    .into_any_element(),
                    (None, None) => fill_message("Loading log…", None, None, colors).into_any_element(),
                    (Some(_), _) if self.visible.is_empty() => {
                        let empty = if self.log_filter.read(cx).text().trim().is_empty() { "This step wrote no output" } else { "No matching lines" };
                        fill_message(empty, None, None, colors).into_any_element()
                    }
                    (Some(_), _) if self.wrap => ui::with_scrollbar(
                        list(self.wrap_list.clone(), cx.processor(|this, row: usize, _window, cx| this.render_log_rows(row..row + 1, cx).pop().unwrap_or_else(|| div().into_any_element())))
                            .flex_1()
                            .min_h_0()
                            .py(px(6.)),
                        Scrollbar::list("run-log-wrap-scrollbar", &self.wrap_list),
                    )
                    .into_any_element(),
                    (Some(lines), _) => {
                        let widest = self.visible.iter().enumerate().max_by_key(|(_, index)| lines.get(**index).map_or(0, |line| line.text.len())).map(|(row, _)| row);
                        let log = uniform_list("run-log", self.visible.len(), cx.processor(|this, range: Range<usize>, _window, cx| this.render_log_rows(range, cx)))
                            .with_horizontal_sizing_behavior(ListHorizontalSizingBehavior::Unconstrained)
                            .with_width_from_item(widest)
                            .track_scroll(&self.log_scroll)
                            .flex_1()
                            .min_h_0()
                            .py(px(6.));
                        ui::with_scrollbar(log, Scrollbar::uniform("run-log-scrollbar", &self.log_scroll)).into_any_element()
                    }
                }
            }
        };
        div().flex().flex_col().flex_1().min_w_0().min_h_0().child(toolbar).child(body).into_any_element()
    }

    fn render_log_rows(&mut self, range: Range<usize>, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let Some(lines) = self.job.and_then(|id| self.logs.get(&id)).cloned() else { return Vec::new() };
        let visible = self.visible.clone();
        let wrap = self.wrap;
        visible[range.start.min(visible.len())..range.end.min(visible.len())]
            .iter()
            .filter_map(|index| lines.get(*index))
            .map(|line| {
                let highlighted = self.active_problem.or(self.highlight) == Some(line.index);
                let (bg, level_color) = match line.level {
                    Some(LogLevel::Error) => (Some(colors.destructive_soft), Some(colors.destructive)),
                    Some(LogLevel::Warning) => (Some(colors.warning_soft), Some(colors.warning)),
                    Some(LogLevel::Notice) => (None, Some(colors.info)),
                    Some(LogLevel::Command) => (None, Some(colors.primary)),
                    Some(LogLevel::Debug) => (None, Some(colors.subtle_foreground)),
                    Some(LogLevel::Group) => (None, Some(colors.foreground)),
                    Some(LogLevel::EndGroup) | None => (None, None),
                };
                div()
                    .flex()
                    .map(|this| if wrap { this.items_start().min_h(px(20.)).py(px(1.)).w_full() } else { this.items_center().h(px(20.)).min_w_full().whitespace_nowrap() })
                    .pr(px(16.))
                    .font_family(typography::MONO_FONT)
                    .text_size(typography::TEXT_SM)
                    .when_some(bg, |this, bg| this.bg(bg))
                    .when(highlighted, |this| this.bg(colors.destructive.opacity(0.2)))
                    .child(div().w(px(52.)).flex_none().pr(px(12.)).text_right().text_color(colors.subtle_foreground).child((line.index + 1).to_string()))
                    .when(self.timestamps, |this| {
                        this.child(div().flex_none().pr(px(10.)).text_color(colors.subtle_foreground).child(line.timestamp.as_deref().map(short_timestamp).unwrap_or_default()))
                    })
                    .when(line.level == Some(LogLevel::Group), |this| {
                        let index = line.index;
                        let collapsed = self.collapsed_groups.contains(&index);
                        this.child(
                            div()
                                .id(("run-log-fold", index))
                                .flex()
                                .flex_none()
                                .items_center()
                                .pr(px(4.))
                                .child(Icon::new(if collapsed { IconName::ChevronRight } else { IconName::ChevronDown }).size(IconSize::XSmall).color(colors.subtle_foreground))
                                .on_click(cx.listener(move |this, _, _, cx| this.toggle_group(index, cx))),
                        )
                    })
                    .child(div().when(wrap, |this| this.flex_1().min_w_0()).child(log_text(line, level_color, &colors)))
                    .into_any_element()
            })
            .collect()
    }

    #[cfg(feature = "snapshot")]
    pub(crate) fn snapshot(&mut self, state: &str, log: &str, cx: &mut Context<Self>) {
        self.error = None;
        if let Some(job) = self.job {
            self.loading_log = None;
            self.log_errors.remove(&job);
            self.logs.insert(job, Arc::new(logs::parse(log)));
        }
        self.step = None;
        self.wrap = state.contains("wrap");
        self.update_visible(cx);
        if state.contains("next") {
            self.jump_to_problem(true, cx);
            self.jump_to_problem(true, cx);
        }
        cx.notify();
    }

    fn render_notice(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (message, tone) = self.notice.clone()?;
        let theme = cx.theme().clone();
        Some(
            div()
                .absolute()
                .bottom(px(16.))
                .right(px(16.))
                .max_w(px(420.))
                .flex()
                .items_start()
                .gap(px(8.))
                .p(px(10.))
                .rounded(metrics::RADIUS_LG)
                .bg(colors.overlay)
                .shadow(theme.shadows.popover.clone())
                .text_size(typography::TEXT_SM)
                .child(Icon::new(if tone == Tone::Error { IconName::WarningCircle } else { IconName::CheckCircle }).size(IconSize::Small).color(tone_color(tone, colors)))
                .child(div().flex_1().min_w_0().text_color(colors.foreground).child(message))
                .child(Button::icon("run-notice-close", IconName::X).size(ButtonSize::XSmall).on_click(cx.listener(|this, _, _, cx| {
                    this.notice = None;
                    cx.notify();
                })))
                .into_any_element(),
        )
    }
}

/// `2026-11-11T10:00:05.1234567Z` → `10:00:05`.
fn short_timestamp(stamp: &str) -> String {
    stamp.split_once('T').map(|(_, time)| time.split('.').next().unwrap_or(time).trim_end_matches('Z').to_string()).unwrap_or_else(|| stamp.to_string())
}

fn url_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn ansi_color(color: LogColor, colors: &ThemeColors) -> Hsla {
    let index = match color {
        LogColor::Red => 1,
        LogColor::Green => 2,
        LogColor::Yellow => 3,
        LogColor::Blue => 4,
        LogColor::Magenta => 5,
        LogColor::Cyan => 6,
        LogColor::Gray => 8,
    };
    colors.terminal[index]
}

/// A log line's text in its level's colour, or with its ANSI colours.
fn log_text(line: &LogLine, level_color: Option<Hsla>, colors: &ThemeColors) -> AnyElement {
    if let Some(color) = level_color {
        let weight = if line.level == Some(LogLevel::Group) { FontWeight::SEMIBOLD } else { FontWeight::NORMAL };
        return div().text_color(color).font_weight(weight).child(display_text(&line.text)).into_any_element();
    }
    let mut text = String::new();
    let mut highlights = Vec::new();
    for segment in &line.segments {
        let segment_text = display_text(&segment.text);
        let start = text.len();
        text.push_str(&segment_text);
        if segment.color.is_some() || segment.bold {
            let highlight = HighlightStyle {
                color: segment.color.map(|color| ansi_color(color, colors)),
                font_weight: segment.bold.then_some(FontWeight::BOLD),
                ..Default::default()
            };
            highlights.push((start..text.len(), highlight));
        }
    }
    if text.is_empty() {
        text.push(' ');
    }
    div().text_color(colors.foreground).child(StyledText::new(text).with_highlights(highlights)).into_any_element()
}

fn display_text(text: &str) -> String {
    text.replace('\t', "    ")
}

impl Render for RunView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let container = div()
            .id("run-view")
            .track_focus(&self.focus_handle)
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_color(colors.foreground);
        let Some(details) = self.details.clone() else {
            let body = match &self.error {
                Some(error) => fill_message(
                    format!("Run #{}", self.run_id),
                    Some(error.clone()),
                    Some(Button::new("run-retry", "Retry").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.load(cx))).into_any_element()),
                    &colors,
                ),
                None => fill_message("Loading action run…", None, None, &colors),
            };
            return container.child(body);
        };
        container
            .child(div().flex_none().pt(px(20.)).pb(px(16.)).border_b_1().border_color(colors.divider).child(rail(self.render_summary(&details, &colors, cx))))
            .when_some(self.error.clone(), |this, error| this.child(rail(div().py(px(6.)).text_size(typography::TEXT_SM).text_color(colors.destructive).child(error))))
            .child(div().flex().flex_1().min_h_0().child(self.render_jobs(&details, &colors, window, cx)).child(self.render_log(&colors, cx)))
            .children(self.render_notice(&colors, cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortens_timestamps_and_encodes_queries() {
        assert_eq!(short_timestamp("2026-11-11T10:00:05.1234567Z"), "10:00:05");
        assert_eq!(url_encode("workflow:\"CI build\""), "workflow%3A%22CI%20build%22");
    }
}

/// A job's or step's context menu (`github-action-jobs-panel.tsx`): copy the step's or job's name,
/// open the job on GitHub, copy its link.
fn job_menu_entries(job: &WorkflowRunJob, step: Option<String>) -> std::rc::Rc<dyn Fn() -> Vec<ui::MenuEntry>> {
    let (name, url) = (job.name.clone(), job.url.clone());
    std::rc::Rc::new(move || {
        let mut entries: Vec<ui::MenuEntry> = Vec::new();
        if let Some(step) = &step {
            entries.push(menus::copy("Copy step name", step.clone()).icon(IconName::Copy).into());
        }
        entries.push(menus::copy("Copy job name", name.clone()).icon(IconName::Copy).into());
        if let Some(url) = &url {
            entries.push(ui::MenuEntry::Separator);
            entries.push(menus::link("Open job on GitHub", url.clone()).icon(IconName::OpenExternal).into());
            entries.push(menus::copy("Copy job link", url.clone()).icon(IconName::Link).into());
        }
        entries
    })
}

#[cfg(not(target_family = "wasm"))]
fn dirs_home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(target_family = "wasm")]
fn dirs_home() -> PathBuf {
    PathBuf::from(".")
}

#[cfg(not(target_family = "wasm"))]
fn write_file(path: &std::path::Path, text: &str) -> Result<(), String> {
    std::fs::write(path, text).map_err(|error| error.to_string())
}

#[cfg(target_family = "wasm")]
fn write_file(_path: &std::path::Path, _text: &str) -> Result<(), String> {
    Err("Saving files is not available in the browser.".into())
}

impl RunView {
    /// Who triggered the run and its state, once loaded (detached title bars).
    pub(crate) fn chrome(&self) -> Option<(String, String, model::Tone)> {
        let details = self.details.as_ref()?;
        let state = model::run_state(details.status.as_deref(), details.conclusion.as_deref());
        Some((details.actor.as_ref().map(|actor| actor.login.clone()).unwrap_or_default(), state.label, state.tone))
    }
}
