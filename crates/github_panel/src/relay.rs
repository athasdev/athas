//! The GitHub client of the web workbench: each `github_*` function the panel calls, with the
//! desktop client's signature, asked of the workspace server (`github.*` in `web_protocol`). The
//! server holds the token, so the `token` arguments are ignored.
//!
//! The crate's pull request types serialise a few fields under other names than GitHub sends
//! (`headRef` for `headRefName`, `statusChecks` for `statusCheckRollup`…), so those answers are
//! put back into GitHub's shape before the shared types read them.

use std::sync::{Arc, RwLock};

use serde::de::DeserializeOwned;
use serde_json::{Value, json};
pub use web_protocol::github::TokenStatus;
use web_protocol::github::{AuthState, GitHubCall, RepositoryInfo};

use crate::gh::{
    Deployment, DeploymentStatus, GitHubNotification, IssueComment, IssueDetails, IssueListItem, IssueMilestone, IssueType, Label,
    PullRequest, PullRequestComment, PullRequestDetails, PullRequestFile, Release, ReleaseAsset, ReleaseInput, WorkflowListItem,
    WorkflowRunDetails, WorkflowRunListItem,
};

/// How the relay reaches the workspace server.
pub trait GitHubTransport: Send + Sync {
    /// Runs one protocol method and waits for its answer.
    fn call(&self, method: &str, params: Value) -> Result<Value, String>;
}

static TRANSPORT: RwLock<Option<Arc<dyn GitHubTransport>>> = RwLock::new(None);

/// Sends the GitHub views' calls to the workspace server from now on.
pub fn set_transport(transport: Arc<dyn GitHubTransport>) {
    *TRANSPORT.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(transport);
}

fn transport() -> Result<Arc<dyn GitHubTransport>, String> {
    TRANSPORT.read().unwrap_or_else(|poisoned| poisoned.into_inner()).clone().ok_or_else(|| "GitHub is not available without a workspace server.".to_string())
}

/// Runs any protocol method, such as `git.branches`.
pub fn call_method(method: &str, params: Value) -> Result<Value, String> {
    transport()?.call(method, params)
}

fn call_value(call: GitHubCall) -> Result<Value, String> {
    let (method, params) = call.to_method();
    call_method(&method, params)
}

fn call<T: DeserializeOwned>(call: GitHubCall) -> Result<T, String> {
    parse(call_value(call)?)
}

fn parse<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| format!("The workspace server's GitHub answer could not be read: {error}"))
}

fn done(call: GitHubCall) -> Result<(), String> {
    call_value(call).map(|_| ())
}

/// A pull request as the crate serialised it, back in GitHub's shape.
pub fn pull_request_value(mut value: Value) -> Value {
    let Some(fields) = value.as_object_mut() else { return value };
    for (sent, read) in [("headRef", "headRefName"), ("baseRef", "baseRefName"), ("linkedIssues", "closingIssuesReferences")] {
        if let Some(field) = fields.remove(sent) {
            fields.insert(read.into(), field);
        }
    }
    if let Some(checks) = fields.remove("statusChecks") {
        fields.insert("statusCheckRollup".into(), json!({ "contexts": { "nodes": checks } }));
    }
    value
}

fn pull_request<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    parse(pull_request_value(value))
}

fn pull_requests(value: Value) -> Result<Vec<PullRequest>, String> {
    match value {
        Value::Array(items) => items.into_iter().map(pull_request).collect(),
        other => parse(other),
    }
}

pub fn auth_state() -> Result<AuthState, String> {
    call(GitHubCall::Auth)
}

/// One of the AI draft prompt's summaries ([`GitHubCall::DraftStatus`], [`GitHubCall::DraftDiff`]).
pub fn draft_summary(summary: GitHubCall) -> Result<String, String> {
    call(summary)
}

/// The server's credential for Settings; `reread` asks its `gh` CLI again.
pub fn token_status(reread: bool) -> Result<TokenStatus, String> {
    call(GitHubCall::TokenStatus { reread })
}

pub fn repository(path: String) -> Result<Option<RepositoryInfo>, String> {
    call(GitHubCall::Repository { path })
}

/// The server's `gh` answers are its own; there is no cache here.
pub fn invalidate_gh_cli_token_cache() {}

pub fn github_get_current_user(_token: Option<String>) -> Result<String, String> {
    call(GitHubCall::CurrentUser)
}

pub fn github_list_notifications(_token: Option<String>) -> Result<Vec<GitHubNotification>, String> {
    call(GitHubCall::ListNotifications)
}

pub fn github_resolve_notification_workflow_run(
    repository: String,
    check_suite_id: Option<i64>,
    title: String,
    updated_at: String,
    _token: Option<String>,
) -> Result<Option<WorkflowRunListItem>, String> {
    call(GitHubCall::ResolveNotificationRun { repository, check_suite_id, title, updated_at })
}

pub fn github_list_prs(path: String, filter: String, _token: Option<String>) -> Result<Vec<PullRequest>, String> {
    pull_requests(call_value(GitHubCall::ListPrs { path, filter })?)
}

pub fn github_list_issues(path: String, state: String, _token: Option<String>) -> Result<Vec<IssueListItem>, String> {
    call(GitHubCall::ListIssues { path, state })
}

pub fn github_list_workflow_runs(path: String, _token: Option<String>) -> Result<Vec<WorkflowRunListItem>, String> {
    call(GitHubCall::ListWorkflowRuns { path })
}

pub fn github_list_workflows(path: String, _token: Option<String>) -> Result<Vec<WorkflowListItem>, String> {
    call(GitHubCall::ListWorkflows { path })
}

pub fn github_list_labels(path: String, _token: Option<String>) -> Result<Vec<Label>, String> {
    call(GitHubCall::ListLabels { path })
}

pub fn github_list_milestones(path: String, _token: Option<String>) -> Result<Vec<IssueMilestone>, String> {
    call(GitHubCall::ListMilestones { path })
}

pub fn github_list_issue_types(path: String, _token: Option<String>) -> Result<Vec<IssueType>, String> {
    call(GitHubCall::ListIssueTypes { path })
}

#[allow(clippy::too_many_arguments)]
pub fn github_create_issue(
    path: String,
    title: String,
    body: String,
    labels: Vec<String>,
    assignees: Vec<String>,
    milestone: Option<i64>,
    issue_type: Option<String>,
    _token: Option<String>,
) -> Result<IssueListItem, String> {
    call(GitHubCall::CreateIssue { path, title, body, labels, assignees, milestone, issue_type })
}

#[allow(clippy::too_many_arguments)]
pub fn github_update_issue(
    path: String,
    number: i64,
    title: String,
    body: String,
    labels: Vec<String>,
    assignees: Vec<String>,
    milestone: Option<i64>,
    issue_type: Option<String>,
    _token: Option<String>,
) -> Result<IssueDetails, String> {
    call(GitHubCall::UpdateIssue { path, number, title, body, labels, assignees, milestone, issue_type })
}

pub fn github_update_issue_state(path: String, number: i64, state: String, reason: Option<String>, _token: Option<String>) -> Result<IssueDetails, String> {
    call(GitHubCall::UpdateIssueState { path, number, state, reason })
}

pub fn github_add_issue_comment(path: String, number: i64, body: String, _token: Option<String>) -> Result<IssueComment, String> {
    call(GitHubCall::AddIssueComment { path, number, body })
}

pub fn github_update_issue_comment(path: String, id: i64, body: String, _token: Option<String>) -> Result<IssueComment, String> {
    call(GitHubCall::UpdateIssueComment { path, id, body })
}

pub fn github_delete_issue_comment(path: String, id: i64, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::DeleteIssueComment { path, id })
}

pub fn github_lock_issue(path: String, number: i64, reason: Option<String>, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::LockIssue { path, number, reason })
}

pub fn github_unlock_issue(path: String, number: i64, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::UnlockIssue { path, number })
}

#[allow(clippy::too_many_arguments)]
pub fn github_create_pull_request(
    path: String,
    title: String,
    body: String,
    head: String,
    base: String,
    draft: bool,
    labels: Vec<String>,
    assignees: Vec<String>,
    _token: Option<String>,
) -> Result<PullRequest, String> {
    pull_request(call_value(GitHubCall::CreatePullRequest { path, title, body, head, base, draft, labels, assignees })?)
}

pub fn github_update_pull_request(
    path: String,
    number: i64,
    title: String,
    body: String,
    labels: Vec<String>,
    assignees: Vec<String>,
    _token: Option<String>,
) -> Result<PullRequestDetails, String> {
    pull_request(call_value(GitHubCall::UpdatePullRequest { path, number, title, body, labels, assignees })?)
}

pub fn github_add_pr_comment(path: String, number: i64, body: String, _token: Option<String>) -> Result<PullRequestComment, String> {
    call(GitHubCall::AddPrComment { path, number, body })
}

pub fn github_submit_pr_review(path: String, number: i64, event: String, body: String, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::SubmitPrReview { path, number, event, body })
}

pub fn github_merge_pull_request(path: String, number: i64, method: String, _token: Option<String>) -> Result<PullRequestDetails, String> {
    pull_request(call_value(GitHubCall::MergePullRequest { path, number, method })?)
}

pub fn github_close_pull_request(path: String, number: i64, _token: Option<String>) -> Result<PullRequestDetails, String> {
    pull_request(call_value(GitHubCall::ClosePullRequest { path, number })?)
}

pub fn github_dispatch_workflow(path: String, workflow_id: i64, reference: String, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::DispatchWorkflow { path, workflow_id, reference })
}

pub fn github_checkout_pr(path: String, number: i64, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::CheckoutPr { path, number })
}

pub fn github_get_pr_details(path: String, number: i64, _token: Option<String>) -> Result<PullRequestDetails, String> {
    pull_request(call_value(GitHubCall::PrDetails { path, number })?)
}

pub fn github_get_pr_diff(path: String, number: i64, _token: Option<String>) -> Result<String, String> {
    call(GitHubCall::PrDiff { path, number })
}

pub fn github_get_pr_files(path: String, number: i64, _token: Option<String>) -> Result<Vec<PullRequestFile>, String> {
    call(GitHubCall::PrFiles { path, number })
}

pub fn github_get_pr_comments(path: String, number: i64, _token: Option<String>) -> Result<Vec<PullRequestComment>, String> {
    call(GitHubCall::PrComments { path, number })
}

pub fn github_get_issue_details(path: String, number: i64, _token: Option<String>) -> Result<IssueDetails, String> {
    call(GitHubCall::IssueDetails { path, number })
}

pub fn github_get_workflow_run_details(path: String, run_id: i64, _token: Option<String>) -> Result<WorkflowRunDetails, String> {
    call(GitHubCall::WorkflowRunDetails { path, run_id })
}

pub fn github_rerun_workflow_run(path: String, run_id: i64, failed_only: bool, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::RerunWorkflowRun { path, run_id, failed_only })
}

pub fn github_cancel_workflow_run(path: String, run_id: i64, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::CancelWorkflowRun { path, run_id })
}

pub fn github_get_workflow_job_logs(path: String, job_id: i64, _token: Option<String>) -> Result<String, String> {
    call(GitHubCall::WorkflowJobLogs { path, job_id })
}

pub fn github_list_releases(path: String, page: u32, _token: Option<String>) -> Result<Vec<Release>, String> {
    call(GitHubCall::ListReleases { path, page })
}

pub fn github_get_release(path: String, id: i64, _token: Option<String>) -> Result<Release, String> {
    call(GitHubCall::Release { path, id })
}

pub fn github_save_release(path: String, id: Option<i64>, input: ReleaseInput, _token: Option<String>) -> Result<Release, String> {
    let input = serde_json::to_value(input).map_err(|error| error.to_string())?;
    call(GitHubCall::SaveRelease { path, id, input })
}

pub fn github_publish_release(path: String, id: i64, make_latest: bool, _token: Option<String>) -> Result<Release, String> {
    call(GitHubCall::PublishRelease { path, id, make_latest })
}

pub fn github_delete_release(path: String, id: i64, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::DeleteRelease { path, id })
}

pub fn github_generate_release_notes(path: String, tag: String, target: String, previous_tag: Option<String>, _token: Option<String>) -> Result<Value, String> {
    call_value(GitHubCall::GenerateReleaseNotes { path, tag, target, previous_tag })
}

pub fn github_list_deployments(path: String, page: u32, _token: Option<String>) -> Result<Vec<Deployment>, String> {
    call(GitHubCall::ListDeployments { path, page })
}

pub fn github_get_deployment(path: String, id: i64, _token: Option<String>) -> Result<Deployment, String> {
    call(GitHubCall::Deployment { path, id })
}

pub fn github_deactivate_deployment(path: String, id: i64, _token: Option<String>) -> Result<DeploymentStatus, String> {
    call(GitHubCall::DeactivateDeployment { path, id })
}

pub fn github_upload_release_asset(path: String, id: i64, file: String, _token: Option<String>) -> Result<ReleaseAsset, String> {
    call(GitHubCall::UploadReleaseAsset { path, id, file })
}

pub fn github_delete_release_asset(path: String, id: i64, _token: Option<String>) -> Result<(), String> {
    done(GitHubCall::DeleteReleaseAsset { path, id })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn pull_requests_read_back_what_the_crate_sent() {
        let details: PullRequestDetails = serde_json::from_value(json!({
            "number": 41, "title": "Port", "body": "b", "state": "OPEN", "author": {"login": "mehmet", "avatarUrl": "a"},
            "createdAt": "c", "updatedAt": "u", "isDraft": true, "reviewDecision": "APPROVED", "url": "https://github.com/a/b/pull/41",
            "headRefName": "feature", "baseRefName": "main", "additions": 9, "deletions": 1, "changedFiles": 2,
            "commits": [{"sha": "abc"}],
            "statusCheckRollup": {"contexts": {"nodes": [
                {"id": 7, "name": "test", "status": "COMPLETED", "conclusion": "FAILURE", "workflowName": "CI", "detailsUrl": "https://x/1"},
                {"name": "lint", "status": "IN_PROGRESS"}
            ]}},
            "closingIssuesReferences": [{"number": 12, "url": "https://github.com/a/b/issues/12"}],
            "reviewRequests": [{"requestedReviewer": {"login": "ana", "avatarUrl": "v"}}],
            "mergeStateStatus": "CLEAN", "mergeable": "MERGEABLE", "mergedAt": null, "mergedBy": {"login": "lee"}, "closedAt": null,
            "reviews": [{"login": "lee", "state": "APPROVED", "body": "", "submittedAt": "s"}],
            "labels": [{"name": "port", "color": "5319e7"}], "assignees": [{"login": "mehmet"}]
        }))
        .unwrap();
        let sent = serde_json::to_value(&details).unwrap();
        assert_eq!(sent["headRef"], "feature");
        let read: PullRequestDetails = pull_request(sent.clone()).unwrap();
        assert_eq!(serde_json::to_value(&read).unwrap(), sent);
        assert_eq!((read.status_checks.len(), read.status_checks[0].workflow_name.as_deref()), (2, Some("CI")));
        assert_eq!((read.linked_issues[0].number, read.review_requests[0].login.as_str()), (12, "ana"));

        let list: Vec<PullRequest> = serde_json::from_value(json!([{ "number": 1, "title": "t", "headRefName": "h", "baseRefName": "m", "author": null }])).unwrap();
        let read = pull_requests(serde_json::to_value(&list).unwrap()).unwrap();
        assert_eq!((read[0].head_ref.as_str(), read[0].base_ref.as_str()), ("h", "m"));
    }
}
