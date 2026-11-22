//! Folding runs of tool calls (`lib/tool-call-groups.ts`): two or more steps in a row read as one
//! summary line ("Read 4 files, edited 2 files, ran 1 command") until the user opens them. A run
//! with a step still going shows that step's title instead.

use std::{collections::HashSet, ops::Range, path::PathBuf};

use gpui::{AnyElement, ClickEvent, Context, IntoElement, ParentElement, Styled, div, prelude::*, px};
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, typography};

use crate::{
    SessionView, diff,
    thread::{Entry, ToolCall, ToolKind, ToolStatus},
};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ActivitySummary {
    /// Kinds in the order the agent first used them, with distinct files (file kinds) or calls.
    pub steps: Vec<(ToolKind, usize)>,
    pub failed: usize,
    /// The title of the step still running.
    pub running: Option<String>,
    /// What a command that outlived its turn runs, such as a dev server.
    pub background: Option<String>,
    pub additions: usize,
    pub deletions: usize,
    /// When the first step started, when the calls carry a start time.
    pub started_at: Option<u64>,
    /// From the first start to the last finish, once every step has finished and was timed.
    pub duration_ms: Option<u64>,
}

/// Where a step stands once its turn is taken into account (`getToolCallPhase`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepPhase {
    Running,
    /// Still going after its turn ended, started while this app runs: a process that outlived
    /// the turn, such as a dev server.
    Background,
    /// Left unfinished by a turn from before this app started.
    Stale,
    Settled,
}

fn app_started_ms() -> u64 {
    static STARTED: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    *STARTED.get_or_init(crate::thread::now_ms)
}

/// Notes when this app started, so steps of earlier runs are not taken as still going.
pub fn mark_app_started() {
    app_started_ms();
}

pub fn step_phase(call: &ToolCall, streaming: bool) -> StepPhase {
    if !matches!(call.status, ToolStatus::Pending | ToolStatus::InProgress) {
        return if call.status == ToolStatus::WaitingForPermission && streaming { StepPhase::Running } else { StepPhase::Settled };
    }
    if streaming {
        StepPhase::Running
    } else if call.started_at.is_some_and(|started| started >= app_started_ms()) {
        StepPhase::Background
    } else {
        StepPhase::Stale
    }
}

/// A short running time such as "8s" or "2m 05s" (`lib/elapsed-time.ts`).
pub fn format_elapsed(seconds: u64) -> String {
    if seconds < 60 {
        return format!("{seconds}s");
    }
    format!("{}m {:02}s", seconds / 60, seconds % 60)
}

/// Whole seconds, shown only once a step took long enough for the number to mean something.
pub fn format_duration(ms: Option<u64>) -> Option<String> {
    ms.filter(|ms| *ms >= 1000).map(|ms| format_elapsed((ms + 500) / 1000))
}

/// The run of tool calls and thoughts in a row that holds `index`: one group, however short.
pub fn run_at(entries: &[Entry], index: usize) -> Option<Range<usize>> {
    let is_call = |index: usize| matches!(entries.get(index), Some(Entry::ToolCall(_) | Entry::Thought(_)));
    if !is_call(index) {
        return None;
    }
    let mut start = index;
    while start > 0 && is_call(start - 1) {
        start -= 1;
    }
    let mut end = index + 1;
    while is_call(end) {
        end += 1;
    }
    Some(start..end)
}

fn is_file_kind(kind: ToolKind) -> bool {
    matches!(kind, ToolKind::Read | ToolKind::Edit | ToolKind::Delete | ToolKind::Move)
}

pub fn summarize<'a>(calls: impl IntoIterator<Item = &'a ToolCall>) -> ActivitySummary {
    summarize_live(calls, true)
}

/// [`summarize`] knowing whether the turn still runs: steps left going after it are background
/// processes, or stale.
pub fn summarize_live<'a>(calls: impl IntoIterator<Item = &'a ToolCall>, streaming: bool) -> ActivitySummary {
    let mut summary = ActivitySummary::default();
    let mut targets: Vec<(ToolKind, HashSet<PathBuf>, usize)> = Vec::new();
    let mut ended_at: Option<u64> = None;
    let mut all_timed = true;
    for call in calls {
        if call.kind == ToolKind::Think {
            continue;
        }
        let phase = step_phase(call, streaming);
        if call.started_at.is_none() || (call.duration_ms.is_none() && !matches!(phase, StepPhase::Running | StepPhase::Background)) {
            all_timed = false;
        }
        if let Some(start) = call.started_at {
            summary.started_at = Some(summary.started_at.map_or(start, |earliest| earliest.min(start)));
            if let Some(duration) = call.duration_ms {
                ended_at = Some(ended_at.map_or(start + duration, |latest| latest.max(start + duration)));
            }
        }
        match (phase, call.status) {
            (StepPhase::Running, _) => {
                summary.running.get_or_insert_with(|| call.label());
            }
            (StepPhase::Background, _) => {
                summary.background.get_or_insert_with(|| call.label());
            }
            (_, ToolStatus::Failed) => summary.failed += 1,
            _ => {}
        }
        for (_, old, new) in call.diffs() {
            let (additions, deletions) = diff::stats(&diff::diff_rows(old.unwrap_or(""), new));
            summary.additions += additions;
            summary.deletions += deletions;
        }
        let position = match targets.iter().position(|(kind, _, _)| *kind == call.kind) {
            Some(position) => position,
            None => {
                targets.push((call.kind, HashSet::new(), 0));
                targets.len() - 1
            }
        };
        let (_, paths, count) = &mut targets[position];
        if is_file_kind(call.kind) {
            let mut found: Vec<PathBuf> = call.diffs().map(|(path, _, _)| path.clone()).collect();
            if found.is_empty() {
                found = call.locations.iter().map(|location| location.path.clone()).collect();
            }
            if found.is_empty() {
                found.push(PathBuf::from(format!("\u{0}{}", call.id)));
            }
            paths.extend(found);
            *count = paths.len();
        } else {
            *count += 1;
        }
    }
    summary.steps = targets.into_iter().map(|(kind, _, count)| (kind, count)).collect();
    if summary.running.is_none() && all_timed && !summary.steps.is_empty()
        && let (Some(start), Some(end)) = (summary.started_at, ended_at)
    {
        summary.duration_ms = Some(end.saturating_sub(start));
    }
    summary
}

fn plural(count: usize, one: &str) -> String {
    format!("{count} {one}{}", if count == 1 { "" } else { "s" })
}

fn describe_step(kind: ToolKind, count: usize) -> String {
    match kind {
        ToolKind::Read => format!("read {}", plural(count, "file")),
        ToolKind::Edit => format!("edited {}", plural(count, "file")),
        ToolKind::Delete => format!("deleted {}", plural(count, "file")),
        ToolKind::Move => format!("moved {}", plural(count, "file")),
        ToolKind::Search => match count {
            1 => "searched once".into(),
            2 => "searched twice".into(),
            _ => format!("searched {count} times"),
        },
        ToolKind::Execute => format!("ran {}", plural(count, "command")),
        ToolKind::Fetch => format!("fetched {}", plural(count, "page")),
        ToolKind::SwitchMode => "switched mode".into(),
        ToolKind::Think => "thought".into(),
        ToolKind::Other => format!("used {}", plural(count, "tool")),
    }
}

/// "Read 4 files, edited 2 files, ran 1 command", in the order the agent worked.
pub fn describe(summary: &ActivitySummary) -> String {
    let text = summary.steps.iter().map(|(kind, count)| describe_step(*kind, *count)).collect::<Vec<_>>().join(", ");
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => "Thought".into(),
    }
}

pub(crate) fn group_key(entries: &[Entry], run: &Range<usize>) -> String {
    match entries.get(run.start) {
        Some(Entry::ToolCall(call)) => format!("group-{}", call.id),
        _ => format!("group-{}", run.start),
    }
}

impl SessionView {
    /// Whether `index` belongs to a group but is not its first entry: the first entry draws the
    /// whole group (header and, while open, every step in one scrolling box), so it draws nothing.
    pub(crate) fn folded_away(&self, index: usize) -> bool {
        run_at(&self.transcript.entries, index).is_some_and(|run| index != run.start)
    }

    /// The last entry that draws something: the first of a group that ends the transcript.
    pub(crate) fn last_drawn_entry(&self) -> Option<usize> {
        let last = self.transcript.entries.len().checked_sub(1)?;
        Some(run_at(&self.transcript.entries, last).map_or(last, |run| run.start))
    }

    /// The group starting at `index`, when it is open: its steps in order.
    pub(crate) fn open_run_at(&self, index: usize) -> Option<Range<usize>> {
        run_at(&self.transcript.entries, index).filter(|run| run.start == index && self.group_open(run))
    }

    fn group_open(&self, run: &Range<usize>) -> bool {
        let key = group_key(&self.transcript.entries, run);
        let entries = &self.transcript.entries[run.clone()];
        // Only a step asking for permission opens its run on its own; failed steps and edits stay
        // folded until the user opens them (the summary line shows "N failed" and +/-).
        let waiting = entries.iter().any(|entry| matches!(entry, Entry::ToolCall(call) if call.status == ToolStatus::WaitingForPermission));
        waiting || self.expanded.contains(&key)
    }

    fn toggle_group(&mut self, run: Range<usize>, cx: &mut Context<Self>) {
        let key = group_key(&self.transcript.entries, &run);
        if self.group_open(&run) {
            self.expanded.remove(&key);
            self.collapsed.insert(key);
        } else {
            self.collapsed.remove(&key);
            self.expanded.insert(key);
        }
        for index in run {
            self.entry_changed(index);
        }
        cx.notify();
    }

    /// The summary row a group starts with, at its first entry.
    pub(crate) fn render_group_header(&self, index: usize, cx: &mut Context<Self>) -> Option<AnyElement> {
        let run = run_at(&self.transcript.entries, index).filter(|run| run.start == index)?;
        let calls = self.transcript.entries[run.clone()].iter().filter_map(|entry| match entry {
            Entry::ToolCall(call) => Some(call),
            _ => None,
        });
        let live = self.is_running() && run.end == self.transcript.entries.len();
        let summary = summarize_live(calls, live);
        let open = self.group_open(&run);
        let colors = cx.theme().colors.clone();
        let (mut started, mut ended) = (summary.started_at, summary.started_at.zip(summary.duration_ms).map(|(start, ms)| start + ms));
        for entry in &self.transcript.entries[run.clone()] {
            if let Entry::Thought(thought) = entry {
                started = [started, thought.started_at].into_iter().flatten().min();
                ended = [ended, thought.updated_at].into_iter().flatten().max();
            }
        }
        let thinking = live && summary.running.is_none() && matches!(self.transcript.entries.get(run.end - 1), Some(Entry::Thought(_)));
        // One title for the whole group: what it is doing while it works, how long it took after.
        let (title, detail) = if live {
            let elapsed = started.map_or(0, |start| crate::thread::now_ms().saturating_sub(start) / 1000);
            let title = if elapsed > 0 { format!("Working {}", format_elapsed(elapsed)) } else { "Working".to_string() };
            (title, summary.running.clone().or_else(|| thinking.then(|| "Thinking".to_string())))
        } else {
            let seconds = started.zip(ended).map(|(start, end)| (end.saturating_sub(start) + 500) / 1000);
            let title = seconds.map_or_else(|| "Worked".to_string(), |seconds| format!("Worked for {}", format_elapsed(seconds.max(1))));
            (title, summary.background.as_ref().map(|background| format!("{background} still running")))
        };
        let running = live;
        let dot = !live && summary.background.is_some();
        // `canReview`: the run changed lines and the chat has edits waiting for review.
        let can_review = self.review_totals.0 > 0 && summary.additions + summary.deletions > 0;
        Some(
            div()
                .id(("tool-group", index))
                .group("tool-group")
                .flex()
                .items_center()
                .gap(px(6.))
                .py(px(2.))
                .text_size(typography::TEXT_SM)
                .text_color(colors.muted_foreground)
                .hover(|style| style.text_color(colors.foreground))
                .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| this.toggle_group(run.clone(), cx)))
                .child(if dot {
                    div().flex_none().size(px(14.)).flex().items_center().justify_center().child(div().size(px(6.)).rounded_full().bg(colors.success)).into_any_element()
                } else if running {
                    // A spinner while it works, the error mark once a step failed, else the list.
                    crate::render::busy_spinner(("tool-group", index), if summary.failed > 0 { colors.destructive } else { colors.muted_foreground })
                } else {
                    let (icon, color) = if summary.failed > 0 {
                        (IconName::WarningCircle, colors.destructive)
                    } else {
                        (IconName::ListChecks, colors.subtle_foreground)
                    };
                    Icon::new(icon).size(IconSize::Small).color(color).into_any_element()
                })
                .child(
                    div()
                        .min_w_0()
                        .flex()
                        .items_baseline()
                        .overflow_hidden()
                        .child(div().flex_none().child(title))
                        // The live step's text shimmers (`<Shimmer active={isRunning}>`).
                        .children(detail.map(|detail| {
                            div().min_w_0().truncate().child(ui::Shimmer::new(("tool-group-detail", index), format!(" · {detail}")).active(running))
                        })),
                )
                .when(summary.additions + summary.deletions > 0, |this| {
                    this.child(div().text_color(colors.git_added).child(format!("+{}", summary.additions)))
                        .child(div().text_color(colors.git_deleted).child(format!("-{}", summary.deletions)))
                })
                .when(summary.failed > 0, |this| this.child(div().text_color(colors.destructive).child(format!("{} failed", summary.failed))))
                .child(Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(colors.subtle_foreground))
                .when(can_review, |this| {
                    this.child(
                        div().flex_none().invisible().group_hover("tool-group", |style| style.visible()).child(
                            ui::Button::new(("tool-group-review", index), "Review")
                                .leading_icon(IconName::GitDiff)
                                .variant(ui::ButtonVariant::Ghost)
                                .size(ui::ButtonSize::XSmall)
                                .tooltip("Review the chat's unreviewed changes")
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                                    cx.stop_propagation();
                                    this.open_review(cx);
                                })),
                        ),
                    )
                })
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thread::{Location, ToolContent};

    fn call(id: &str, kind: ToolKind, path: &str, status: ToolStatus) -> ToolCall {
        ToolCall { id: id.into(), title: format!("{kind:?} {path}"), kind, status, locations: vec![Location { path: path.into(), line: None }], ..Default::default() }
    }

    #[test]
    fn runs_fold_and_read_as_steps() {
        let mut edit = call("e", ToolKind::Edit, "/p/a.rs", ToolStatus::Completed);
        edit.content = vec![ToolContent::Diff { path: "/p/a.rs".into(), old_text: Some("a\n".into()), new_text: "b\nc\n".into() }];
        let entries = vec![
            Entry::ToolCall(call("1", ToolKind::Read, "/p/a.rs", ToolStatus::Completed)),
            Entry::ToolCall(call("2", ToolKind::Read, "/p/a.rs", ToolStatus::Completed)),
            Entry::ToolCall(call("3", ToolKind::Read, "/p/b.rs", ToolStatus::Completed)),
            Entry::ToolCall(edit),
            Entry::ToolCall(call("x", ToolKind::Execute, "", ToolStatus::Failed)),
        ];
        assert_eq!(run_at(&entries, 2), Some(0..5));
        let summary = summarize(entries.iter().filter_map(|entry| if let Entry::ToolCall(call) = entry { Some(call) } else { None }));
        assert_eq!(describe(&summary), "Read 2 files, edited 1 file, ran 1 command");
        assert_eq!((summary.additions, summary.deletions, summary.failed), (2, 1, 1));
        assert_eq!(summary.duration_ms, None);
    }

    #[test]
    fn timed_runs_report_how_long_they_worked() {
        let mut first = call("1", ToolKind::Read, "/p/a.rs", ToolStatus::Completed);
        (first.started_at, first.duration_ms) = (Some(1_000), Some(2_000));
        let mut second = call("2", ToolKind::Execute, "", ToolStatus::Completed);
        (second.started_at, second.duration_ms) = (Some(2_500), Some(9_000));
        let summary = summarize([&first, &second]);
        assert_eq!((summary.started_at, summary.duration_ms), (Some(1_000), Some(10_500)));
        assert_eq!(format_duration(summary.duration_ms).as_deref(), Some("11s"));
        assert_eq!(format_duration(Some(400)), None);
        assert_eq!(format_elapsed(125), "2m 05s");

        let mut running = call("3", ToolKind::Read, "/p/b.rs", ToolStatus::InProgress);
        running.started_at = Some(3_000);
        assert_eq!(summarize([&first, &running]).duration_ms, None);
        let outlived = summarize_live([&first, &running], false);
        assert_eq!(outlived.running, None);
        assert!(outlived.background.is_none(), "a step from before the app started is not still going");
    }

    #[test]
    fn calls_time_themselves_as_they_finish() {
        let mut call = call("1", ToolKind::Read, "/p/a.rs", ToolStatus::Pending);
        call.started_at = Some(crate::thread::now_ms() - 3_000);
        call.set_status(ToolStatus::Completed);
        assert!(call.duration_ms.is_some_and(|ms| ms >= 3_000));
    }

    #[test]
    fn thoughts_and_calls_share_one_group() {
        let entries = vec![
            Entry::Thought(Default::default()),
            Entry::ToolCall(call("1", ToolKind::Read, "/p/a.rs", ToolStatus::Completed)),
            Entry::Agent(Default::default()),
            Entry::ToolCall(call("2", ToolKind::Read, "/p/b.rs", ToolStatus::Completed)),
        ];
        assert_eq!(run_at(&entries, 1), Some(0..2));
        assert_eq!(run_at(&entries, 3), Some(3..4));
        assert_eq!(run_at(&entries, 2), None);
    }
}
