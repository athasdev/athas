//! Workflow run notifications (`githubActionNotifications`, `github-actions-watcher.tsx`): the
//! project's runs are polled in the background, and runs of the signed-in user that start or
//! finish are reported.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::gh::WorkflowRunListItem;
use chrono::{DateTime, Utc};
use gpui::{App, AsyncApp, Global, SharedString, Task};
use notifications::{NotificationCategory, NotificationKind};

use crate::{model, repo, store};

const ACTIVE_POLL: Duration = Duration::from_secs(15);
const IDLE_POLL: Duration = Duration::from_secs(60);
/// A run first seen finished counts as news when it finished this recently.
const RECENT_WINDOW_SECONDS: i64 = 10 * 60;
const MAX_INDIVIDUAL_NOTIFICATIONS: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChangeKind {
    Started,
    Completed,
}

#[derive(Clone, Debug)]
pub(crate) struct RunChange {
    pub kind: ChangeKind,
    pub run: WorkflowRunListItem,
}

fn is_active(run: &WorkflowRunListItem) -> bool {
    model::run_state(run.status.as_deref(), run.conclusion.as_deref()).is_active
}

/// What changed between two polls (`diffWorkflowRuns`); nothing on the first.
pub(crate) fn diff_runs(previous: Option<&[WorkflowRunListItem]>, next: &[WorkflowRunListItem], now: DateTime<Utc>) -> Vec<RunChange> {
    let Some(previous) = previous else { return Vec::new() };
    let previous: HashMap<i64, &WorkflowRunListItem> = previous.iter().map(|run| (run.database_id, run)).collect();
    let mut changes = Vec::new();
    for run in next {
        let active = is_active(run);
        let kind = match previous.get(&run.database_id) {
            None if active => Some(ChangeKind::Started),
            None => run
                .updated_at
                .as_deref()
                .and_then(model::parse_time)
                .filter(|time| (now - *time).num_seconds() <= RECENT_WINDOW_SECONDS)
                .map(|_| ChangeKind::Completed),
            Some(old) => {
                let attempt_changed = matches!((run.run_attempt, old.run_attempt), (Some(new), Some(old)) if new != old);
                if active && (!is_active(old) || attempt_changed) {
                    Some(ChangeKind::Started)
                } else if !active && is_active(old) {
                    Some(ChangeKind::Completed)
                } else {
                    None
                }
            }
        };
        if let Some(kind) = kind {
            changes.push(RunChange { kind, run: run.clone() });
        }
    }
    changes
}

/// The run was started by `user`, by login, ignoring case.
pub(crate) fn started_by(run: &WorkflowRunListItem, user: &str) -> bool {
    [&run.actor, &run.triggering_actor].into_iter().flatten().any(|actor| actor.login.eq_ignore_ascii_case(user))
}

/// The message, description and kind a change is reported with (`describeWorkflowRunChange`).
pub(crate) fn describe(change: &RunChange, now: DateTime<Utc>) -> (String, String, NotificationKind) {
    let run = &change.run;
    let state = model::run_state(run.status.as_deref(), run.conclusion.as_deref());
    let workflow = [run.workflow_name.as_deref(), run.name.as_deref()].into_iter().flatten().find(|name| !name.is_empty()).unwrap_or("Workflow");
    let title = model::list_run_title(run);
    let context: Vec<String> = [run.head_branch.clone(), Some(model::run_label(run.run_number, run.database_id))].into_iter().flatten().filter(|part| !part.is_empty()).collect();
    let attempt = run.run_attempt.filter(|attempt| *attempt > 1).map(|attempt| format!(" (attempt {attempt})")).unwrap_or_default();
    let mut description = vec![title];
    description.extend(context);
    if change.kind == ChangeKind::Started {
        return (format!("{workflow} started{attempt}"), description.join(" · "), NotificationKind::Info);
    }
    if let Some(duration) = model::elapsed(run.run_started_at.as_deref().or(run.created_at.as_deref()), run.updated_at.as_deref(), false, now) {
        description.push(format!("in {duration}"));
    }
    let (outcome, kind) = match state.phase {
        model::Phase::Success => ("passed".to_string(), NotificationKind::Success),
        model::Phase::Cancelled => ("was cancelled".to_string(), NotificationKind::Warning),
        _ if state.is_failed => ("failed".to_string(), NotificationKind::Error),
        _ => (state.label.to_lowercase(), NotificationKind::Info),
    };
    (format!("{workflow} {outcome}{attempt}"), description.join(" · "), kind)
}

fn enabled(cx: &App) -> bool {
    cx.try_global::<settings::SettingsStore>().is_some_and(|_| settings::get(cx).github_action_notifications)
}

#[derive(Default)]
struct Watchers(HashMap<PathBuf, Task<()>>);

impl Global for Watchers {}

/// Watches the workflow runs of the project at `root` while `githubActionNotifications` is on.
/// Called whenever the project in front may have changed; turning the setting off stops every
/// watcher.
pub fn watch_actions(root: Option<&Path>, cx: &mut App) {
    if !enabled(cx) {
        if cx.try_global::<Watchers>().is_some_and(|watchers| !watchers.0.is_empty()) {
            cx.global_mut::<Watchers>().0.clear();
        }
        return;
    }
    let Some(root) = root else { return };
    if cx.try_global::<Watchers>().is_some_and(|watchers| watchers.0.contains_key(root)) {
        return;
    }
    let task = cx.spawn({
        let root = root.to_path_buf();
        async move |cx: &mut AsyncApp| watch(root, cx).await
    });
    cx.default_global::<Watchers>().0.insert(root.to_path_buf(), task);
}

async fn watch(root: PathBuf, cx: &mut AsyncApp) {
    let detected = cx.background_executor().spawn(async move { repo::detect(&root) }).await;
    let Ok(repository) = detected else { return };
    let path = repository.root.to_string_lossy().into_owned();
    let mut previous: Option<Vec<WorkflowRunListItem>> = None;
    loop {
        let mut delay = IDLE_POLL;
        if cx.update(|cx| enabled(cx)) {
            let auth = cx.update(|cx| store::check_auth(false, cx)).await;
            if let Some(token) = auth.token() {
                let fetch = {
                    let (path, token) = (path.clone(), token.clone());
                    cx.background_executor().spawn(async move { crate::gh::github_list_workflow_runs(path, Some(token)) })
                };
                if let Ok(runs) = fetch.await {
                    if runs.iter().any(is_active) {
                        delay = ACTIVE_POLL;
                    }
                    let changes = diff_runs(previous.as_deref(), &runs, Utc::now());
                    previous = Some(runs);
                    if !changes.is_empty() {
                        let user = cx.update(store::current_user).await;
                        let relevant = relevant_changes(changes, user, path.clone(), token, cx).await;
                        cx.update(|cx| report(&relevant, cx));
                    }
                }
            }
        }
        cx.background_executor().timer(delay).await;
    }
}

/// The changes to runs the user started, or of pull requests they wrote, are assigned to or are
/// asked to review (`filterRelevantWorkflowChanges`).
async fn relevant_changes(changes: Vec<RunChange>, user: Option<String>, path: String, token: String, cx: &mut AsyncApp) -> Vec<RunChange> {
    let Some(user) = user else { return Vec::new() };
    cx.background_executor()
        .spawn(async move {
            let mut pull_requests: HashMap<i64, bool> = HashMap::new();
            changes
                .into_iter()
                .filter(|change| {
                    started_by(&change.run, &user)
                        || change.run.pull_request_numbers.iter().any(|number| {
                            *pull_requests.entry(*number).or_insert_with(|| {
                                crate::gh::github_get_pr_details(path.clone(), *number, Some(token.clone())).is_ok_and(|pr| {
                                    pr.author.login.eq_ignore_ascii_case(&user)
                                        || pr.assignees.iter().any(|person| person.login.eq_ignore_ascii_case(&user))
                                        || pr.review_requests.iter().any(|person| person.login.eq_ignore_ascii_case(&user))
                                })
                            })
                        })
                })
                .collect()
        })
        .await
}

fn report(changes: &[RunChange], cx: &mut App) {
    if changes.is_empty() || !enabled(cx) {
        return;
    }
    let now = Utc::now();
    for change in changes.iter().take(MAX_INDIVIDUAL_NOTIFICATIONS) {
        let (message, description, kind) = describe(change, now);
        let attempt = change.run.run_attempt.unwrap_or(1);
        let kind_id = if change.kind == ChangeKind::Started { "started" } else { "completed" };
        let id: SharedString = format!("github-action:{}:{attempt}:{kind_id}", change.run.database_id).into();
        notifications::notify(cx, kind, NotificationCategory::GitHub, message, Some(description.into()), Some(id));
    }
    let overflow = changes.len().saturating_sub(MAX_INDIVIDUAL_NOTIFICATIONS);
    if overflow > 0 {
        let message = format!("{overflow} more workflow run{} changed", if overflow == 1 { "" } else { "s" });
        notifications::notify(cx, NotificationKind::Info, NotificationCategory::GitHub, message, None, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gh::PullRequestAuthor;

    fn run(id: i64, status: &str, conclusion: Option<&str>, updated: &str) -> WorkflowRunListItem {
        serde_json::from_value(serde_json::json!({
            "databaseId": id,
            "workflowName": "CI",
            "status": status,
            "conclusion": conclusion,
            "updatedAt": updated,
            "runStartedAt": "2026-11-11T11:58:00Z",
            "runNumber": id,
            "headBranch": "main",
        }))
        .unwrap()
    }

    fn now() -> DateTime<Utc> {
        model::parse_time("2026-11-11T12:00:00Z").unwrap()
    }

    #[test]
    fn diffs_runs_between_polls() {
        let running = run(1, "in_progress", None, "2026-11-11T11:59:00Z");
        assert!(diff_runs(None, &[running.clone()], now()).is_empty(), "the first poll reports nothing");

        let done = run(1, "completed", Some("success"), "2026-11-11T12:00:00Z");
        let changes = diff_runs(Some(&[running.clone()]), &[done.clone()], now());
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, ChangeKind::Completed);

        let fresh = run(2, "queued", None, "2026-11-11T12:00:00Z");
        let old_done = run(3, "completed", Some("failure"), "2026-11-11T09:00:00Z");
        let changes = diff_runs(Some(&[done.clone()]), &[done, fresh, old_done], now());
        assert_eq!(changes.iter().map(|change| (change.run.database_id, change.kind)).collect::<Vec<_>>(), [(2, ChangeKind::Started)]);
    }

    #[test]
    fn describes_finished_runs() {
        let change = RunChange { kind: ChangeKind::Completed, run: run(7, "completed", Some("failure"), "2026-11-11T12:00:00Z") };
        let (message, description, kind) = describe(&change, now());
        assert_eq!(message, "CI failed");
        assert_eq!(kind, NotificationKind::Error);
        assert!(description.contains("main · #7"));
        assert!(description.ends_with("in 2m 00s"));
    }

    #[test]
    fn matches_the_user_who_started_a_run() {
        let mut item = run(1, "queued", None, "2026-11-11T12:00:00Z");
        assert!(!started_by(&item, "octocat"));
        item.triggering_actor = Some(PullRequestAuthor { login: "OctoCat".into(), avatar_url: None });
        assert!(started_by(&item, "octocat"));
    }
}
