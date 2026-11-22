//! What the views show, worked out from the API's models: states and their tones, groups,
//! filters, times and the pull request timeline. Nothing here touches GPUI.

use crate::gh::{
    IssueDetails, IssueListItem, PullRequest, PullRequestComment, PullRequestDetails, PullRequestReview, StatusCheck,
    WorkflowRunJob, WorkflowRunListItem, WorkflowRunStep,
};
use chrono::{DateTime, Utc};

/// The colour family a state is drawn in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Success,
    Error,
    Warning,
    Accent,
    Merged,
    Muted,
}

// Times.

pub fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.trim()).ok().map(|time| time.with_timezone(&Utc))
}

/// "just now", "5m ago", "2h ago", "yesterday", "3d ago", "2w ago" (`getTimeAgo`).
pub fn time_ago(value: &str, now: DateTime<Utc>) -> String {
    let Some(time) = parse_time(value) else { return value.to_string() };
    let minutes = (now - time).num_minutes();
    let days = (now - time).num_days();
    match minutes {
        ..1 => "just now".to_string(),
        1..60 => format!("{minutes}m ago"),
        60..1440 => format!("{}h ago", minutes / 60),
        _ if days == 1 => "yesterday".to_string(),
        _ if days < 7 => format!("{days}d ago"),
        _ => format!("{}w ago", days / 7),
    }
}

/// The time at the end of a sidebar row: "0m", "5m", "2h", "3d" (`getSidebarTime`).
pub fn sidebar_time(value: &str, now: DateTime<Utc>) -> String {
    let Some(time) = parse_time(value) else { return "—".to_string() };
    let minutes = (now - time).num_minutes().max(0);
    match minutes {
        ..60 => format!("{minutes}m"),
        60..1440 => format!("{}h", minutes / 60),
        _ => format!("{}d", minutes / 1440),
    }
}

pub fn format_duration(seconds: i64) -> String {
    let seconds = seconds.max(0);
    let (hours, minutes, rest) = (seconds / 3600, (seconds % 3600) / 60, seconds % 60);
    if hours > 0 {
        format!("{hours}h {minutes:02}m")
    } else if minutes > 0 {
        format!("{minutes}m {rest:02}s")
    } else {
        format!("{rest}s")
    }
}

/// How long something ran, or has been running while `active`.
pub fn elapsed(started: Option<&str>, completed: Option<&str>, active: bool, now: DateTime<Utc>) -> Option<String> {
    let started = parse_time(started?)?;
    let end = if active { now } else { parse_time(completed?)? };
    Some(format_duration((end - started).num_seconds()))
}

pub fn plural(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

pub fn short_sha(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

// Pull requests.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrStatus {
    Open,
    Draft,
    Merged,
    Closed,
}

impl PrStatus {
    pub fn of(state: &str, is_draft: bool, merged_at: Option<&str>) -> Self {
        if merged_at.is_some_and(|merged| !merged.is_empty()) || state.eq_ignore_ascii_case("merged") {
            PrStatus::Merged
        } else if state.eq_ignore_ascii_case("closed") {
            PrStatus::Closed
        } else if is_draft {
            PrStatus::Draft
        } else {
            PrStatus::Open
        }
    }

    pub fn of_details(pr: &PullRequestDetails) -> Self {
        Self::of(&pr.state, pr.is_draft, pr.merged_at.as_deref())
    }

    pub fn label(self) -> &'static str {
        match self {
            PrStatus::Open => "Open",
            PrStatus::Draft => "Draft",
            PrStatus::Merged => "Merged",
            PrStatus::Closed => "Closed",
        }
    }

    pub fn tone(self) -> Tone {
        match self {
            PrStatus::Open => Tone::Success,
            PrStatus::Draft => Tone::Muted,
            PrStatus::Merged => Tone::Merged,
            PrStatus::Closed => Tone::Error,
        }
    }
}

/// What the merge button says, and whether the pull request can be merged now (`getMergeStatusInfo`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeStatus {
    pub text: &'static str,
    pub tone: Tone,
    pub ready: bool,
}

pub fn merge_status(status: PrStatus, merge_state: Option<&str>, mergeable: Option<&str>, review_decision: Option<&str>) -> MergeStatus {
    let blocked = |text, tone| MergeStatus { text, tone, ready: false };
    match status {
        PrStatus::Merged => return blocked("Merged", Tone::Merged),
        PrStatus::Closed => return blocked("Closed without merging", Tone::Muted),
        _ => {}
    }
    let merge_state = merge_state.unwrap_or_default().to_lowercase();
    if matches!(mergeable, Some("false" | "CONFLICTING")) || merge_state == "dirty" {
        return blocked("Has conflicts", Tone::Error);
    }
    if status == PrStatus::Draft {
        return blocked("Draft", Tone::Muted);
    }
    match merge_state.as_str() {
        "blocked" => match review_decision {
            Some("CHANGES_REQUESTED") => blocked("Changes requested", Tone::Error),
            None | Some("REVIEW_REQUIRED") => blocked("Review required", Tone::Warning),
            _ => blocked("Blocked by checks", Tone::Warning),
        },
        "behind" => blocked("Behind base branch", Tone::Warning),
        "unstable" => MergeStatus { text: "Merge", tone: Tone::Warning, ready: true },
        "clean" | "has_hooks" => MergeStatus { text: "Merge", tone: Tone::Success, ready: true },
        _ => blocked("Checking mergeability", Tone::Muted),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum PrFilter {
    #[default]
    Open,
    Mine,
    ReviewRequests,
}

impl PrFilter {
    pub const ALL: [PrFilter; 3] = [PrFilter::Open, PrFilter::Mine, PrFilter::ReviewRequests];

    /// The value `github_list_prs` takes.
    pub fn api_value(self) -> &'static str {
        match self {
            PrFilter::Open => "all",
            PrFilter::Mine => "my-prs",
            PrFilter::ReviewRequests => "review-requests",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            PrFilter::Open => "Open PRs",
            PrFilter::Mine => "My PRs",
            PrFilter::ReviewRequests => "Review Requests",
        }
    }
}

fn matches(query: &str, values: &[&str]) -> bool {
    values.iter().any(|value| value.to_lowercase().contains(query))
}

/// `query` is already trimmed and lowercased.
pub fn pr_matches(pr: &PullRequest, query: &str) -> bool {
    query.is_empty()
        || matches(
            query,
            &[
                &pr.title,
                &format!("#{}", pr.number),
                &pr.author.login,
                &pr.head_ref,
                &pr.base_ref,
                &pr.state,
                pr.review_decision.as_deref().unwrap_or_default(),
                if pr.is_draft { "draft" } else { "" },
            ],
        )
}

// Issues.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum IssueFilter {
    #[default]
    Open,
    Closed,
    All,
}

impl IssueFilter {
    pub const ALL: [IssueFilter; 3] = [IssueFilter::Open, IssueFilter::Closed, IssueFilter::All];

    pub fn api_value(self) -> &'static str {
        match self {
            IssueFilter::Open => "open",
            IssueFilter::Closed => "closed",
            IssueFilter::All => "all",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            IssueFilter::Open => "Open Issues",
            IssueFilter::Closed => "Closed Issues",
            IssueFilter::All => "All Issues",
        }
    }
}

pub fn issue_is_open(state: &str) -> bool {
    state.eq_ignore_ascii_case("open")
}

/// Open, closed as completed, or closed as not planned: the icon colour of an issue.
pub fn issue_tone(state: &str, state_reason: Option<&str>) -> Tone {
    if issue_is_open(state) {
        Tone::Success
    } else if state_reason.is_some_and(|reason| reason.eq_ignore_ascii_case("not_planned")) {
        Tone::Muted
    } else {
        Tone::Merged
    }
}

pub fn issue_matches(issue: &IssueListItem, query: &str) -> bool {
    query.is_empty()
        || matches(query, &[&issue.title, &format!("#{}", issue.number), &issue.author.login, &issue.state])
        || issue.labels.iter().any(|label| label.name.to_lowercase().contains(query))
}

// Workflow runs.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Success,
    Failure,
    Cancelled,
    Skipped,
    ActionRequired,
    Neutral,
    Running,
    Queued,
    Waiting,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunState {
    pub phase: Phase,
    pub label: String,
    pub tone: Tone,
    pub is_active: bool,
    pub is_failed: bool,
}

fn humanize(value: &str) -> String {
    let text = value.replace('_', " ");
    let text = text.trim();
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => "Unknown".to_string(),
    }
}

/// `getWorkflowRunState`: the phase of a run, job or step from its status and conclusion.
pub fn run_state(status: Option<&str>, conclusion: Option<&str>) -> RunState {
    let status = status.unwrap_or_default().to_lowercase();
    let conclusion = conclusion.unwrap_or_default().to_lowercase();
    let state = |phase, label: &str, tone, is_active, is_failed| RunState { phase, label: label.to_string(), tone, is_active, is_failed };
    match conclusion.as_str() {
        "success" => return state(Phase::Success, "Success", Tone::Success, false, false),
        "failure" | "startup_failure" => return state(Phase::Failure, "Failed", Tone::Error, false, true),
        "timed_out" => return state(Phase::Failure, "Timed out", Tone::Error, false, true),
        "cancelled" => return state(Phase::Cancelled, "Cancelled", Tone::Muted, false, false),
        "skipped" => return state(Phase::Skipped, "Skipped", Tone::Muted, false, false),
        "action_required" => return state(Phase::ActionRequired, "Action required", Tone::Warning, false, false),
        "neutral" | "stale" => return state(Phase::Neutral, &humanize(&conclusion), Tone::Muted, false, false),
        _ => {}
    }
    match status.as_str() {
        "in_progress" => state(Phase::Running, "Running", Tone::Accent, true, false),
        "waiting" => state(Phase::Waiting, "Waiting", Tone::Warning, true, false),
        "queued" | "pending" | "requested" => state(Phase::Queued, "Queued", Tone::Warning, true, false),
        _ => state(Phase::Unknown, &humanize(if conclusion.is_empty() { &status } else { &conclusion }), Tone::Muted, false, false),
    }
}

pub fn run_title(display_title: Option<&str>, name: Option<&str>, workflow_name: Option<&str>, id: i64) -> String {
    [display_title, name, workflow_name]
        .into_iter()
        .flatten()
        .find(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("Run #{id}"))
}

pub fn list_run_title(run: &WorkflowRunListItem) -> String {
    run_title(run.display_title.as_deref(), run.name.as_deref(), run.workflow_name.as_deref(), run.database_id)
}

pub fn run_label(run_number: Option<i64>, id: i64) -> String {
    format!("#{}", run_number.unwrap_or(id))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum RunFilter {
    #[default]
    All,
    InProgress,
    Successful,
    Failed,
}

impl RunFilter {
    pub const ALL: [RunFilter; 4] = [RunFilter::All, RunFilter::InProgress, RunFilter::Successful, RunFilter::Failed];

    pub fn label(self) -> &'static str {
        match self {
            RunFilter::All => "All Runs",
            RunFilter::InProgress => "In Progress",
            RunFilter::Successful => "Successful",
            RunFilter::Failed => "Failed",
        }
    }

    pub fn matches(self, run: &WorkflowRunListItem) -> bool {
        let state = run_state(run.status.as_deref(), run.conclusion.as_deref());
        match self {
            RunFilter::All => true,
            RunFilter::InProgress => state.is_active,
            RunFilter::Successful => state.phase == Phase::Success,
            RunFilter::Failed => state.is_failed || state.phase == Phase::Cancelled,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ReleaseFilter {
    #[default]
    All,
    Published,
    Draft,
    Prerelease,
}

impl ReleaseFilter {
    pub const ALL: [ReleaseFilter; 4] = [ReleaseFilter::All, ReleaseFilter::Published, ReleaseFilter::Draft, ReleaseFilter::Prerelease];

    pub fn label(self) -> &'static str {
        match self {
            ReleaseFilter::All => "All Releases",
            ReleaseFilter::Published => "Stable",
            ReleaseFilter::Draft => "Drafts",
            ReleaseFilter::Prerelease => "Prereleases",
        }
    }
}

/// `matchesDelivery` for a release: the filter, then the query against its name, tag, target,
/// author and asset names.
pub fn release_matches(release: &crate::gh::Release, filter: ReleaseFilter, query: &str) -> bool {
    let matches_filter = match filter {
        ReleaseFilter::All => true,
        ReleaseFilter::Draft => release.draft,
        ReleaseFilter::Prerelease => !release.draft && release.prerelease,
        ReleaseFilter::Published => !release.draft && !release.prerelease,
    };
    let query = query.trim().to_lowercase();
    let fields = [release.name.clone(), Some(release.tag_name.clone()), Some(release.target_commitish.clone()), release.author.as_ref().map(|author| author.login.clone())];
    matches_filter
        && (query.is_empty()
            || fields.into_iter().flatten().chain(release.assets.iter().map(|asset| asset.name.clone())).any(|value| value.to_lowercase().contains(&query)))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum DeploymentFilter {
    #[default]
    All,
    Active,
    Pending,
    Failed,
    Inactive,
}

impl DeploymentFilter {
    pub const ALL: [DeploymentFilter; 5] = [DeploymentFilter::All, DeploymentFilter::Active, DeploymentFilter::Pending, DeploymentFilter::Failed, DeploymentFilter::Inactive];

    pub fn label(self) -> &'static str {
        match self {
            DeploymentFilter::All => "All Deployments",
            DeploymentFilter::Active => "Successful",
            DeploymentFilter::Pending => "In Progress",
            DeploymentFilter::Failed => "Failed",
            DeploymentFilter::Inactive => "Inactive",
        }
    }
}

pub fn deployment_matches(deployment: &crate::gh::Deployment, filter: DeploymentFilter, pending: bool, query: &str) -> bool {
    let state = deployment.statuses.first().map(|status| status.state.as_str());
    let matches_filter = filter == DeploymentFilter::All
        || (deployment.status_error.is_none()
            && match filter {
                DeploymentFilter::Active => state == Some("success"),
                DeploymentFilter::Pending => pending,
                DeploymentFilter::Failed => matches!(state, Some("failure" | "error")),
                DeploymentFilter::Inactive => state == Some("inactive"),
                DeploymentFilter::All => true,
            });
    let query = query.trim().to_lowercase();
    let fields = [
        Some(deployment.environment.clone()),
        Some(deployment.git_ref.clone()),
        Some(deployment.sha.clone()),
        deployment.description.clone(),
        deployment.creator.as_ref().map(|creator| creator.login.clone()),
        Some(deployment.id.to_string()),
    ];
    matches_filter && (query.is_empty() || fields.into_iter().flatten().any(|value| value.to_lowercase().contains(&query)))
}

pub fn run_matches(run: &WorkflowRunListItem, query: &str) -> bool {
    let opt = |value: &Option<String>| value.clone().unwrap_or_default();
    query.is_empty()
        || matches(
            query,
            &[
                &opt(&run.display_title),
                &opt(&run.name),
                &opt(&run.workflow_name),
                &opt(&run.event),
                &opt(&run.status),
                &opt(&run.conclusion),
                &opt(&run.head_branch),
                &opt(&run.head_sha),
                &opt(&run.head_commit_message),
                &run.actor.as_ref().map(|actor| actor.login.clone()).unwrap_or_default(),
                &run_label(run.run_number, run.database_id),
                &format!("#{}", run.database_id),
            ],
        )
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct JobSummary {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub running: usize,
    pub queued: usize,
    pub completed: usize,
}

pub fn summarize_jobs(jobs: &[WorkflowRunJob]) -> JobSummary {
    let mut summary = JobSummary { total: jobs.len(), ..Default::default() };
    for job in jobs {
        let state = run_state(job.status.as_deref(), job.conclusion.as_deref());
        if state.phase == Phase::Success {
            summary.succeeded += 1;
        } else if state.is_failed {
            summary.failed += 1;
        } else if state.phase == Phase::Running {
            summary.running += 1;
        } else if state.is_active {
            summary.queued += 1;
        }
        if !state.is_active {
            summary.completed += 1;
        }
    }
    summary
}

/// The job a run view opens on: the first failed, else running, else active, else the first.
pub fn initial_job(jobs: &[WorkflowRunJob]) -> Option<usize> {
    let state = |job: &WorkflowRunJob| run_state(job.status.as_deref(), job.conclusion.as_deref());
    jobs.iter()
        .position(|job| state(job).is_failed)
        .or_else(|| jobs.iter().position(|job| state(job).phase == Phase::Running))
        .or_else(|| jobs.iter().position(|job| state(job).is_active))
        .or((!jobs.is_empty()).then_some(0))
}

pub fn initial_step(steps: &[WorkflowRunStep]) -> Option<usize> {
    let state = |step: &WorkflowRunStep| run_state(step.status.as_deref(), step.conclusion.as_deref());
    if steps.is_empty() {
        return None;
    }
    steps
        .iter()
        .position(|step| state(step).is_failed)
        .or_else(|| steps.iter().position(|step| state(step).phase == Phase::Running))
        .or(Some(0))
}

/// Logs exist once a job has started.
pub fn job_has_logs(job: &WorkflowRunJob) -> bool {
    !matches!(run_state(job.status.as_deref(), job.conclusion.as_deref()).phase, Phase::Queued | Phase::Waiting | Phase::Skipped)
}

// Checks.

pub fn check_state(check: &StatusCheck) -> RunState {
    run_state(check.status.as_deref(), check.conclusion.as_deref())
}

/// Failed first, then running, then passed, then the rest.
pub fn check_priority(check: &StatusCheck) -> u8 {
    let state = check_state(check);
    if state.is_failed || check.conclusion.as_deref() == Some("ERROR") {
        0
    } else if state.is_active {
        1
    } else if state.phase == Phase::Success {
        2
    } else {
        3
    }
}

pub fn sorted_checks(checks: &[StatusCheck]) -> Vec<&StatusCheck> {
    let mut sorted: Vec<&StatusCheck> = checks.iter().collect();
    sorted.sort_by_key(|check| check_priority(check));
    sorted
}

pub fn checks_summary(checks: &[StatusCheck]) -> Option<(String, Tone)> {
    if checks.is_empty() {
        return None;
    }
    let count = |priority| checks.iter().filter(|check| check_priority(check) == priority).count();
    let (failed, pending, passed) = (count(0), count(1), count(2));
    Some(if failed > 0 {
        (format!("{failed} failed"), Tone::Error)
    } else if pending > 0 {
        (format!("{pending} pending"), Tone::Warning)
    } else if passed == checks.len() {
        (format!("{passed} checks passed"), Tone::Success)
    } else {
        (format!("{passed}/{} passed", checks.len()), Tone::Muted)
    })
}

// The pull request timeline.

#[derive(Clone, Debug, PartialEq)]
pub struct Commit {
    pub sha: String,
    pub headline: String,
    pub author: String,
    pub authored_at: String,
    pub url: String,
}

/// The commits `github_get_pr_details` returns as JSON values.
pub fn commits(pr: &PullRequestDetails) -> Vec<Commit> {
    pr.commits
        .iter()
        .filter_map(|value| {
            let string = |key: &str| value.get(key).and_then(|value| value.as_str()).unwrap_or_default().to_string();
            let sha = [string("sha"), string("oid")].into_iter().find(|sha| !sha.is_empty())?;
            let message = string("message");
            let author = value.get("author");
            let author_field = |key: &str| author.and_then(|author| author.get(key)).and_then(|value| value.as_str()).unwrap_or_default();
            let author = [author_field("login"), author_field("name")].into_iter().find(|name| !name.is_empty()).unwrap_or("Unknown");
            Some(Commit {
                headline: message.lines().next().unwrap_or_default().trim().to_string(),
                author: author.to_string(),
                authored_at: string("authoredDate"),
                url: string("url"),
                sha,
            })
        })
        .collect()
}

#[derive(Clone, Debug)]
pub enum TimelineEvent<'a> {
    Opened { commit_count: usize },
    Commit(&'a Commit),
    Review(&'a PullRequestReview),
    Comment(&'a PullRequestComment),
    Merged,
    Closed,
}

pub fn pr_timeline<'a>(pr: &'a PullRequestDetails, commits: &'a [Commit], comments: &'a [PullRequestComment]) -> Vec<(String, TimelineEvent<'a>)> {
    let mut events = vec![(pr.created_at.clone(), TimelineEvent::Opened { commit_count: commits.len() })];
    events.extend(commits.iter().filter(|commit| !commit.authored_at.is_empty()).map(|commit| (commit.authored_at.clone(), TimelineEvent::Commit(commit))));
    events.extend(pr.reviews.iter().filter_map(|review| Some((review.submitted_at.clone()?, TimelineEvent::Review(review)))));
    events.extend(comments.iter().map(|comment| (comment.created_at.clone(), TimelineEvent::Comment(comment))));
    if let Some(merged) = pr.merged_at.clone() {
        events.push((merged, TimelineEvent::Merged));
    } else if let Some(closed) = pr.closed_at.clone() {
        events.push((closed, TimelineEvent::Closed));
    }
    // A stable sort keeps "opened" first when a commit shares its timestamp.
    events.sort_by_key(|(at, _)| parse_time(at));
    events
}

/// A reviewer and where their review stands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reviewer {
    pub login: String,
    pub state: ReviewerState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewerState {
    Requested,
    Approved,
    ChangesRequested,
    Commented,
}

impl ReviewerState {
    pub fn label(self) -> &'static str {
        match self {
            ReviewerState::Requested => "Requested",
            ReviewerState::Approved => "Approved",
            ReviewerState::ChangesRequested => "Changes requested",
            ReviewerState::Commented => "Commented",
        }
    }
}

pub fn reviewers(pr: &PullRequestDetails) -> Vec<Reviewer> {
    let requested: Vec<Reviewer> =
        pr.review_requests.iter().map(|request| Reviewer { login: request.login.clone(), state: ReviewerState::Requested }).collect();
    let mut rows: Vec<Reviewer> = Vec::new();
    // The latest review of each person decides their state.
    for review in &pr.reviews {
        if requested.iter().any(|row| row.login.eq_ignore_ascii_case(&review.login)) {
            continue;
        }
        let state = match review.state.as_str() {
            "APPROVED" => ReviewerState::Approved,
            "CHANGES_REQUESTED" => ReviewerState::ChangesRequested,
            _ => ReviewerState::Commented,
        };
        match rows.iter_mut().find(|row| row.login == review.login) {
            Some(row) if state != ReviewerState::Commented => row.state = state,
            Some(_) => {}
            None => rows.push(Reviewer { login: review.login.clone(), state }),
        }
    }
    rows.extend(requested);
    rows
}

pub fn review_decision_badge(decision: Option<&str>) -> Option<(&'static str, Tone)> {
    match decision? {
        "APPROVED" => Some(("Approved", Tone::Success)),
        "CHANGES_REQUESTED" => Some(("Changes requested", Tone::Error)),
        "REVIEW_REQUIRED" => Some(("Review required", Tone::Warning)),
        _ => None,
    }
}

// Issues' activity.

#[derive(Clone, Debug)]
pub enum IssueEvent<'a> {
    Opened,
    Comment(&'a crate::gh::IssueComment),
    Closed,
}

pub fn issue_timeline(issue: &IssueDetails) -> Vec<(String, IssueEvent<'_>)> {
    let mut events = vec![(issue.created_at.clone(), IssueEvent::Opened)];
    events.extend(issue.comments.iter().map(|comment| (comment.created_at.clone(), IssueEvent::Comment(comment))));
    if !issue_is_open(&issue.state)
        && let Some(closed) = issue.closed_at.clone()
    {
        events.push((closed, IssueEvent::Closed));
    }
    events.sort_by_key(|(at, _)| parse_time(at));
    events
}

/// A label's colour as GitHub stores it (`"d73a4a"`), as RGB in 0..1.
pub fn label_rgb(color: &str) -> Option<(f32, f32, f32)> {
    let hex = color.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.is_ascii() {
        return None;
    }
    let channel = |range: std::ops::Range<usize>| u8::from_str_radix(&hex[range], 16).ok().map(|value| value as f32 / 255.);
    Some((channel(0..2)?, channel(2..4)?, channel(4..6)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 11, 12, 0, 0).unwrap()
    }

    #[test]
    fn formats_relative_times() {
        assert_eq!(time_ago("2026-11-11T11:59:40Z", now()), "just now");
        assert_eq!(time_ago("2026-11-11T11:55:00Z", now()), "5m ago");
        assert_eq!(time_ago("2026-11-11T09:00:00Z", now()), "3h ago");
        assert_eq!(time_ago("2026-11-10T09:00:00Z", now()), "yesterday");
        assert_eq!(time_ago("2026-11-07T09:00:00Z", now()), "4d ago");
        assert_eq!(time_ago("2026-10-20T09:00:00Z", now()), "3w ago");
        assert_eq!(time_ago("garbage", now()), "garbage");
        assert_eq!(sidebar_time("2026-11-11T11:59:40Z", now()), "0m");
        assert_eq!(sidebar_time("2026-10-20T12:00:00Z", now()), "22d");
        assert_eq!(sidebar_time("", now()), "—");
    }

    #[test]
    fn formats_durations() {
        assert_eq!(format_duration(42), "42s");
        assert_eq!(format_duration(125), "2m 05s");
        assert_eq!(format_duration(3720), "1h 02m");
        assert_eq!(elapsed(Some("2026-11-11T11:58:00Z"), None, true, now()).as_deref(), Some("2m 00s"));
        assert_eq!(elapsed(Some("2026-11-11T11:58:00Z"), Some("2026-11-11T11:58:30Z"), false, now()).as_deref(), Some("30s"));
        assert_eq!(elapsed(None, None, true, now()), None);
    }

    #[test]
    fn maps_pull_request_status() {
        assert_eq!(PrStatus::of("OPEN", false, None), PrStatus::Open);
        assert_eq!(PrStatus::of("open", true, None), PrStatus::Draft);
        assert_eq!(PrStatus::of("CLOSED", false, Some("2026-01-01T00:00:00Z")), PrStatus::Merged);
        assert_eq!(PrStatus::of("CLOSED", false, None), PrStatus::Closed);
        assert_eq!(PrStatus::Merged.tone(), Tone::Merged);
    }

    #[test]
    fn explains_merge_status() {
        let status = |merge_state, mergeable, review| merge_status(PrStatus::Open, merge_state, mergeable, review);
        assert_eq!(status(Some("clean"), Some("MERGEABLE"), None).ready, true);
        assert_eq!(status(Some("unstable"), None, None).tone, Tone::Warning);
        assert_eq!(status(Some("dirty"), None, None).text, "Has conflicts");
        assert_eq!(status(Some("clean"), Some("CONFLICTING"), None).text, "Has conflicts");
        assert_eq!(status(Some("blocked"), None, Some("CHANGES_REQUESTED")).text, "Changes requested");
        assert_eq!(status(Some("blocked"), None, None).text, "Review required");
        assert_eq!(status(Some("blocked"), None, Some("APPROVED")).text, "Blocked by checks");
        assert_eq!(status(Some("behind"), None, None).text, "Behind base branch");
        assert_eq!(status(None, None, None).text, "Checking mergeability");
        assert_eq!(merge_status(PrStatus::Draft, Some("clean"), None, None).text, "Draft");
        assert_eq!(merge_status(PrStatus::Merged, None, None, None).text, "Merged");
    }

    #[test]
    fn maps_workflow_states() {
        let state = |status, conclusion| run_state(Some(status), Some(conclusion));
        assert_eq!(state("completed", "success").phase, Phase::Success);
        assert!(state("completed", "failure").is_failed);
        assert_eq!(state("completed", "timed_out").label, "Timed out");
        assert_eq!(state("completed", "cancelled").tone, Tone::Muted);
        assert_eq!(state("completed", "action_required").tone, Tone::Warning);
        assert_eq!(state("completed", "stale").label, "Stale");
        assert!(state("in_progress", "").is_active);
        assert_eq!(state("IN_PROGRESS", "").phase, Phase::Running);
        assert_eq!(state("waiting", "").phase, Phase::Waiting);
        assert_eq!(state("pending", "").phase, Phase::Queued);
        assert_eq!(run_state(Some("weird_status"), None).label, "Weird status");
        assert_eq!(run_state(None, None).label, "Unknown");
    }

    #[test]
    fn picks_titles_and_labels() {
        assert_eq!(run_title(Some(""), Some("CI"), None, 7), "CI");
        assert_eq!(run_title(None, None, None, 7), "Run #7");
        assert_eq!(run_label(Some(12), 99), "#12");
        assert_eq!(run_label(None, 99), "#99");
    }

    #[test]
    fn reads_label_colours() {
        assert_eq!(label_rgb("ff0000"), Some((1., 0., 0.)));
        assert_eq!(label_rgb("#00ff00"), Some((0., 1., 0.)));
        assert_eq!(label_rgb("nope"), None);
    }

    #[test]
    fn issue_tones() {
        assert_eq!(issue_tone("OPEN", None), Tone::Success);
        assert_eq!(issue_tone("CLOSED", Some("COMPLETED")), Tone::Merged);
        assert_eq!(issue_tone("closed", Some("not_planned")), Tone::Muted);
    }
}
