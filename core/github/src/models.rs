use crate::serde_helpers::{
   deserialize_author_or_default, deserialize_bool_or_default, deserialize_i64_or_default,
   deserialize_review_requests, deserialize_status_checks, deserialize_string_or_default,
   deserialize_vec_or_default,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PullRequest {
   pub number: i64,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[specta(type = PullRequestAuthor)]
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[serde(rename = "isDraft")]
   #[specta(type = bool)]
   #[serde(default, deserialize_with = "deserialize_bool_or_default")]
   pub is_draft: bool,
   #[serde(rename = "reviewDecision")]
   pub review_decision: Option<String>,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename(serialize = "headRef", deserialize = "headRefName"))]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub head_ref: String,
   #[serde(rename(serialize = "baseRef", deserialize = "baseRefName"))]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub base_ref: String,
   #[specta(type = i64)]
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub additions: i64,
   #[specta(type = i64)]
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PullRequestAuthor {
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub login: String,
   #[serde(rename = "avatarUrl", default)]
   pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct StatusCheck {
   #[serde(default)]
   pub id: Option<i64>,
   #[serde(default)]
   pub name: Option<String>,
   #[serde(default)]
   pub status: Option<String>,
   #[serde(default)]
   pub conclusion: Option<String>,
   #[serde(rename = "workflowName", default)]
   pub workflow_name: Option<String>,
   #[serde(rename = "detailsUrl", default)]
   pub details_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct LinkedIssue {
   #[serde(default)]
   pub number: i64,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct ReviewRequest {
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub login: String,
   #[serde(rename = "avatarUrl", default)]
   pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PullRequestReview {
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub login: String,
   #[serde(rename = "avatarUrl", default)]
   pub avatar_url: Option<String>,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[serde(rename = "submittedAt", default)]
   pub submitted_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct Label {
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub name: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct GitHubNotification {
   pub id: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[serde(rename = "subjectType")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub subject_type: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub reason: String,
   #[specta(type = bool)]
   #[serde(default, deserialize_with = "deserialize_bool_or_default")]
   pub unread: bool,
   #[serde(rename = "updatedAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[serde(rename = "lastReadAt")]
   pub last_read_at: Option<String>,
   #[serde(rename = "repositoryFullName")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub repository_full_name: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename = "subjectUrl")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub subject_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PullRequestDetails {
   pub number: i64,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[specta(type = PullRequestAuthor)]
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[serde(rename = "isDraft")]
   #[specta(type = bool)]
   #[serde(default, deserialize_with = "deserialize_bool_or_default")]
   pub is_draft: bool,
   #[serde(rename = "reviewDecision")]
   pub review_decision: Option<String>,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename(serialize = "headRef", deserialize = "headRefName"))]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub head_ref: String,
   #[serde(rename(serialize = "baseRef", deserialize = "baseRefName"))]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub base_ref: String,
   #[specta(type = i64)]
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub additions: i64,
   #[specta(type = i64)]
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub deletions: i64,
   #[serde(rename = "changedFiles")]
   #[specta(type = i64)]
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub changed_files: i64,
   #[specta(type = Vec<serde_json::Value>)]
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub commits: Vec<serde_json::Value>,
   #[specta(type = Vec<StatusCheck>)]
   #[serde(
      rename(serialize = "statusChecks", deserialize = "statusCheckRollup"),
      default,
      deserialize_with = "deserialize_status_checks"
   )]
   pub status_checks: Vec<StatusCheck>,
   #[serde(
      rename(serialize = "linkedIssues", deserialize = "closingIssuesReferences"),
      default
   )]
   pub linked_issues: Vec<LinkedIssue>,
   #[specta(type = Vec<ReviewRequest>)]
   #[serde(
      rename = "reviewRequests",
      default,
      deserialize_with = "deserialize_review_requests"
   )]
   pub review_requests: Vec<ReviewRequest>,
   #[serde(rename = "mergeStateStatus", default)]
   pub merge_state_status: Option<String>,
   #[serde(default)]
   pub mergeable: Option<String>,
   #[serde(rename = "mergedAt", default)]
   pub merged_at: Option<String>,
   #[serde(rename = "mergedBy", default)]
   pub merged_by: Option<PullRequestAuthor>,
   #[serde(rename = "closedAt", default)]
   pub closed_at: Option<String>,
   #[specta(type = Vec<PullRequestReview>)]
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub reviews: Vec<PullRequestReview>,
   #[specta(type = Vec<Label>)]
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub labels: Vec<Label>,
   #[specta(type = Vec<PullRequestAuthor>)]
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub assignees: Vec<PullRequestAuthor>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PullRequestFile {
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub path: String,
   #[specta(type = i64)]
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub additions: i64,
   #[specta(type = i64)]
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct PullRequestComment {
   #[serde(default)]
   pub id: i64,
   #[specta(type = PullRequestAuthor)]
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[serde(rename = "createdAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct IssueListItem {
   pub number: i64,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[specta(type = PullRequestAuthor)]
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(rename = "updatedAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[specta(type = Vec<Label>)]
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub labels: Vec<Label>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct IssueComment {
   #[serde(default)]
   pub id: i64,
   #[specta(type = PullRequestAuthor)]
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[serde(rename = "createdAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct IssueMilestone {
   pub number: i64,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[serde(rename = "dueOn", default)]
   pub due_on: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct IssueType {
   pub id: i64,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub name: String,
   #[serde(default)]
   pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct IssueDetails {
   pub number: i64,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[specta(type = PullRequestAuthor)]
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[specta(type = Vec<Label>)]
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub labels: Vec<Label>,
   #[specta(type = Vec<PullRequestAuthor>)]
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub assignees: Vec<PullRequestAuthor>,
   #[serde(rename = "stateReason", default)]
   pub state_reason: Option<String>,
   #[serde(default)]
   pub locked: bool,
   #[serde(rename = "activeLockReason", default)]
   pub active_lock_reason: Option<String>,
   #[serde(default)]
   pub milestone: Option<IssueMilestone>,
   #[serde(rename = "issueType", default)]
   pub issue_type: Option<IssueType>,
   #[serde(rename = "closedAt", default)]
   pub closed_at: Option<String>,
   #[serde(rename = "closedBy", default)]
   pub closed_by: Option<PullRequestAuthor>,
   #[specta(type = Vec<IssueComment>)]
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub comments: Vec<IssueComment>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct WorkflowRunStep {
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub name: String,
   #[serde(default)]
   pub status: Option<String>,
   #[serde(default)]
   pub conclusion: Option<String>,
   #[serde(default)]
   pub number: Option<i64>,
   #[serde(rename = "startedAt", default)]
   pub started_at: Option<String>,
   #[serde(rename = "completedAt", default)]
   pub completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct WorkflowRunJob {
   #[serde(default)]
   pub id: Option<i64>,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub name: String,
   #[serde(default)]
   pub status: Option<String>,
   #[serde(default)]
   pub conclusion: Option<String>,
   #[serde(rename = "startedAt", default)]
   pub started_at: Option<String>,
   #[serde(rename = "completedAt", default)]
   pub completed_at: Option<String>,
   #[serde(default)]
   pub url: Option<String>,
   #[serde(rename = "runnerName", default)]
   pub runner_name: Option<String>,
   #[serde(default)]
   pub labels: Vec<String>,
   #[serde(default)]
   pub steps: Vec<WorkflowRunStep>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct WorkflowRunDetails {
   #[serde(rename = "databaseId")]
   pub database_id: i64,
   #[serde(default)]
   pub name: Option<String>,
   #[serde(rename = "displayTitle", default)]
   pub display_title: Option<String>,
   #[serde(rename = "workflowName", default)]
   pub workflow_name: Option<String>,
   #[serde(default)]
   pub event: Option<String>,
   #[serde(default)]
   pub status: Option<String>,
   #[serde(default)]
   pub conclusion: Option<String>,
   #[serde(rename = "createdAt", default)]
   pub created_at: Option<String>,
   #[serde(rename = "updatedAt", default)]
   pub updated_at: Option<String>,
   #[serde(rename = "runStartedAt", default)]
   pub run_started_at: Option<String>,
   #[serde(rename = "runNumber", default)]
   pub run_number: Option<i64>,
   #[serde(rename = "runAttempt", default)]
   pub run_attempt: Option<i64>,
   #[serde(rename = "workflowId", default)]
   pub workflow_id: Option<i64>,
   #[serde(default)]
   pub actor: Option<PullRequestAuthor>,
   #[serde(rename = "headCommitMessage", default)]
   pub head_commit_message: Option<String>,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename = "headBranch", default)]
   pub head_branch: Option<String>,
   #[serde(rename = "headSha", default)]
   pub head_sha: Option<String>,
   #[serde(default)]
   pub jobs: Vec<WorkflowRunJob>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct WorkflowRunListItem {
   #[serde(rename = "databaseId")]
   pub database_id: i64,
   #[serde(rename = "displayTitle", default)]
   pub display_title: Option<String>,
   #[serde(default)]
   pub name: Option<String>,
   #[serde(rename = "workflowName", default)]
   pub workflow_name: Option<String>,
   #[serde(default)]
   pub event: Option<String>,
   #[serde(default)]
   pub status: Option<String>,
   #[serde(default)]
   pub conclusion: Option<String>,
   #[serde(rename = "updatedAt", default)]
   pub updated_at: Option<String>,
   #[serde(rename = "createdAt", default)]
   pub created_at: Option<String>,
   #[serde(rename = "runStartedAt", default)]
   pub run_started_at: Option<String>,
   #[serde(rename = "runNumber", default)]
   pub run_number: Option<i64>,
   #[serde(rename = "runAttempt", default)]
   pub run_attempt: Option<i64>,
   #[serde(rename = "workflowId", default)]
   pub workflow_id: Option<i64>,
   #[serde(default)]
   pub actor: Option<PullRequestAuthor>,
   #[serde(rename = "triggeringActor", default)]
   pub triggering_actor: Option<PullRequestAuthor>,
   #[serde(rename = "pullRequestNumbers", default)]
   pub pull_request_numbers: Vec<i64>,
   #[serde(rename = "headCommitMessage", default)]
   pub head_commit_message: Option<String>,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename = "headBranch", default)]
   pub head_branch: Option<String>,
   #[serde(rename = "headSha", default)]
   pub head_sha: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct WorkflowListItem {
   pub id: i64,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub name: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub path: String,
   #[specta(type = String)]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
}

impl Default for PullRequestAuthor {
   fn default() -> Self {
      Self {
         login: "unknown".to_string(),
         avatar_url: None,
      }
   }
}
