//! The views' logic against JSON shaped like `athas-github`'s models, as recorded from the API.

use crate::gh::{IssueListItem, PullRequest, PullRequestComment, PullRequestDetails, WorkflowRunJob, WorkflowRunListItem};
use chrono::{Local, TimeZone};
use serde_json::json;

use crate::model::{self, Phase, PrFilter, ReviewerState, RunFilter, TimelineEvent, Tone};

fn pull_requests() -> Vec<PullRequest> {
    serde_json::from_value(json!([
        {"number": 41, "title": "Port the GitHub panel", "state": "OPEN", "author": {"login": "mehmet", "avatarUrl": null},
         "createdAt": "2026-11-10T08:00:00Z", "updatedAt": "2026-11-11T09:00:00Z", "isDraft": false, "reviewDecision": null,
         "url": "https://github.com/athasdev/athas/pull/41", "headRefName": "gpui-github", "baseRefName": "main", "additions": 900, "deletions": 12},
        {"number": 40, "title": "WIP: terminal tabs", "state": "OPEN", "author": {"login": "ana"}, "createdAt": "2026-11-01T08:00:00Z",
         "updatedAt": "2026-11-02T08:00:00Z", "isDraft": true, "url": "https://github.com/athasdev/athas/pull/40",
         "headRefName": "tabs", "baseRefName": "main", "additions": 3, "deletions": 1},
        {"number": 39, "title": null, "state": "OPEN", "author": null, "isDraft": null}
    ]))
    .unwrap()
}

fn details() -> PullRequestDetails {
    serde_json::from_value(json!({
        "number": 41, "title": "Port the GitHub panel", "body": "## Summary\nPorts it.", "state": "OPEN",
        "author": {"login": "mehmet"}, "createdAt": "2026-11-10T08:00:00Z", "updatedAt": "2026-11-11T09:00:00Z",
        "isDraft": false, "reviewDecision": "CHANGES_REQUESTED", "url": "https://github.com/athasdev/athas/pull/41",
        "headRefName": "gpui-github", "baseRefName": "main", "additions": 900, "deletions": 12, "changedFiles": 14,
        "commits": [
            {"sha": "abcdef1234567", "message": "Add panel\n\nBody", "authoredDate": "2026-11-10T08:30:00Z", "url": "https://github.com/c/1", "author": {"login": "mehmet", "name": "Mehmet"}},
            {"sha": "1234567abcdef", "message": "Fix tests", "authoredDate": "2026-11-10T10:00:00Z", "url": "", "author": {"login": "", "name": "Bot"}}
        ],
        "statusCheckRollup": {"contexts": {"nodes": [
            {"name": "lint", "status": "COMPLETED", "conclusion": "SUCCESS"},
            {"name": "test", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "https://github.com/athasdev/athas/actions/runs/7/job/8"},
            {"name": "build", "status": "IN_PROGRESS", "conclusion": null}
        ]}},
        "closingIssuesReferences": [{"number": 12, "url": "https://github.com/athasdev/athas/issues/12"}],
        "reviewRequests": [{"login": "ana"}],
        "mergeStateStatus": "blocked", "mergeable": "MERGEABLE",
        "reviews": [
            {"login": "ana", "state": "COMMENTED", "body": "", "submittedAt": "2026-11-10T09:00:00Z"},
            {"login": "lee", "state": "COMMENTED", "body": "Looks close", "submittedAt": "2026-11-10T11:00:00Z"},
            {"login": "lee", "state": "CHANGES_REQUESTED", "body": "", "submittedAt": "2026-11-10T12:00:00Z"}
        ],
        "labels": [{"name": "port", "color": "5319e7"}],
        "assignees": [{"login": "mehmet"}]
    }))
    .unwrap()
}

fn comments() -> Vec<PullRequestComment> {
    serde_json::from_value(json!([
        {"id": 1, "author": {"login": "ana"}, "body": "Nice", "createdAt": "2026-11-10T09:30:00Z", "updatedAt": "2026-11-10T09:30:00Z", "url": "u1"}
    ]))
    .unwrap()
}

#[test]
fn groups_and_filters_pull_requests() {
    let prs = pull_requests();
    assert_eq!(prs[2].author.login, "unknown");
    let all: Vec<&PullRequest> = prs.iter().collect();
    let groups = model::group_pull_requests(&all, PrFilter::Open);
    let summary: Vec<_> = groups.iter().map(|group| (group.title.as_str(), group.items.iter().map(|pr| pr.number).collect::<Vec<_>>())).collect();
    assert_eq!(summary, [("Open", vec![41, 39]), ("Drafts", vec![40])]);
    assert_eq!(model::group_pull_requests(&all, PrFilter::ReviewRequests)[0].title, "Review requested");

    let matching = |query: &str| prs.iter().filter(|pr| model::pr_matches(pr, query)).map(|pr| pr.number).collect::<Vec<_>>();
    assert_eq!(matching("draft"), [40]);
    assert_eq!(matching("#41"), [41]);
    assert_eq!(matching("gpui-github"), [41]);
    assert_eq!(matching("ana"), [40]);
    assert_eq!(matching("").len(), 3);
}

#[test]
fn builds_the_pull_request_page() {
    let pr = details();
    assert_eq!(model::PrStatus::of_details(&pr), model::PrStatus::Open);
    assert_eq!(model::merge_status(model::PrStatus::Open, pr.merge_state_status.as_deref(), pr.mergeable.as_deref(), pr.review_decision.as_deref()).text, "Changes requested");

    let commits = model::commits(&pr);
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].headline, "Add panel");
    assert_eq!(commits[1].author, "Bot");

    let reviewers = model::reviewers(&pr);
    assert_eq!(
        reviewers.iter().map(|row| (row.login.as_str(), row.state)).collect::<Vec<_>>(),
        [("lee", ReviewerState::ChangesRequested), ("ana", ReviewerState::Requested)]
    );

    let comments = comments();
    let events = model::pr_timeline(&pr, &commits, &comments);
    let kinds: Vec<&str> = events
        .iter()
        .map(|(_, event)| match event {
            TimelineEvent::Opened { .. } => "opened",
            TimelineEvent::Commit(_) => "commit",
            TimelineEvent::Review(_) => "review",
            TimelineEvent::Comment(_) => "comment",
            TimelineEvent::Merged => "merged",
            TimelineEvent::Closed => "closed",
        })
        .collect();
    assert_eq!(kinds, ["opened", "commit", "review", "comment", "commit", "review", "review"]);
}

#[test]
fn summarizes_and_orders_checks() {
    let pr = details();
    assert_eq!(model::checks_summary(&pr.status_checks), Some(("1 failed".to_string(), Tone::Error)));
    let order: Vec<_> = model::sorted_checks(&pr.status_checks).iter().map(|check| check.name.clone().unwrap_or_default()).collect();
    assert_eq!(order, ["test", "build", "lint"]);
    assert_eq!(model::checks_summary(&[]), None);
}

#[test]
fn groups_issues() {
    let issues: Vec<IssueListItem> = serde_json::from_value(json!([
        {"number": 5, "title": "Crash on open", "state": "OPEN", "author": {"login": "a"}, "updatedAt": "2026-11-11T00:00:00Z", "url": "", "labels": [{"name": "bug", "color": "d73a4a"}]},
        {"number": 4, "title": "Old", "state": "CLOSED", "author": {"login": "b"}, "updatedAt": "2026-10-11T00:00:00Z", "url": "", "labels": []}
    ]))
    .unwrap();
    let all: Vec<&IssueListItem> = issues.iter().collect();
    let groups = model::group_issues(&all);
    assert_eq!(groups.iter().map(|group| group.title.as_str()).collect::<Vec<_>>(), ["Open", "Closed"]);
    assert!(model::issue_matches(&issues[0], "bug"));
    assert!(!model::issue_matches(&issues[1], "bug"));
}

#[test]
fn groups_and_filters_runs() {
    let runs: Vec<WorkflowRunListItem> = serde_json::from_value(json!([
        {"databaseId": 1, "displayTitle": "CI", "status": "completed", "conclusion": "success", "createdAt": "2026-11-11T08:00:00Z", "url": "", "headBranch": "main"},
        {"databaseId": 2, "name": "Release", "status": "in_progress", "createdAt": "2026-11-11T09:00:00Z", "url": ""},
        {"databaseId": 3, "workflowName": "Nightly", "status": "completed", "conclusion": "cancelled", "createdAt": "2026-11-09T09:00:00Z", "url": "", "runNumber": 88},
        {"databaseId": 4, "status": "completed", "conclusion": "failure", "url": ""}
    ]))
    .unwrap();
    assert_eq!(runs.iter().map(model::list_run_title).collect::<Vec<_>>(), ["CI", "Release", "Nightly", "Run #4"]);
    let ids = |filter: RunFilter| runs.iter().filter(|run| filter.matches(run)).map(|run| run.database_id).collect::<Vec<_>>();
    assert_eq!(ids(RunFilter::InProgress), [2]);
    assert_eq!(ids(RunFilter::Successful), [1]);
    assert_eq!(ids(RunFilter::Failed), [3, 4]);
    assert!(model::run_matches(&runs[2], "#88"));

    let all: Vec<&WorkflowRunListItem> = runs.iter().collect();
    let today = Local.with_ymd_and_hms(2026, 11, 11, 23, 0, 0).unwrap();
    let groups = model::group_runs_by_day(&all, today);
    let ids: Vec<Vec<i64>> = groups.iter().map(|group| group.items.iter().map(|run| run.database_id).collect()).collect();
    assert_eq!(ids.last(), Some(&vec![4]));
    assert_eq!(groups.last().map(|group| group.title.as_str()), Some("Unknown"));
    assert_eq!(ids.iter().flatten().count(), 4);
}

#[test]
fn summarizes_jobs_and_picks_where_to_open() {
    let jobs: Vec<WorkflowRunJob> = serde_json::from_value(json!([
        {"id": 1, "name": "lint", "status": "completed", "conclusion": "success", "steps": []},
        {"id": 2, "name": "test", "status": "completed", "conclusion": "failure", "steps": [
            {"name": "Set up job", "status": "completed", "conclusion": "success"},
            {"name": "cargo test", "status": "completed", "conclusion": "failure"}
        ]},
        {"id": 3, "name": "build", "status": "in_progress", "steps": []},
        {"id": 4, "name": "deploy", "status": "queued", "steps": []}
    ]))
    .unwrap();
    let summary = model::summarize_jobs(&jobs);
    assert_eq!((summary.total, summary.succeeded, summary.failed, summary.running, summary.queued, summary.completed), (4, 1, 1, 1, 1, 2));
    assert_eq!(model::initial_job(&jobs), Some(1));
    assert_eq!(model::initial_step(&jobs[1].steps), Some(1));
    assert!(!model::job_has_logs(&jobs[3]));
    assert_eq!(model::run_state(jobs[2].status.as_deref(), None).phase, Phase::Running);
}
