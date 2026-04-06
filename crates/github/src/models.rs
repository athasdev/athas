use crate::serde_helpers::{
   deserialize_author_or_default, deserialize_bool_or_default, deserialize_i64_or_default,
   deserialize_review_requests, deserialize_status_checks, deserialize_string_or_default,
   deserialize_vec_or_default,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequest {
   pub number: i64,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[serde(rename = "isDraft")]
   #[serde(default, deserialize_with = "deserialize_bool_or_default")]
   pub is_draft: bool,
   #[serde(rename = "reviewDecision")]
   pub review_decision: Option<String>,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename(serialize = "headRef", deserialize = "headRefName"))]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub head_ref: String,
   #[serde(rename(serialize = "baseRef", deserialize = "baseRefName"))]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub base_ref: String,
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub additions: i64,
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestAuthor {
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub login: String,
   #[serde(rename = "avatarUrl", default)]
   pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StatusCheck {
   #[serde(default)]
   pub name: Option<String>,
   #[serde(default)]
   pub status: Option<String>,
   #[serde(default)]
   pub conclusion: Option<String>,
   #[serde(rename = "workflowName", default)]
   pub workflow_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LinkedIssue {
   #[serde(default)]
   pub number: i64,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewRequest {
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub login: String,
   #[serde(rename = "avatarUrl", default)]
   pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Label {
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub name: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestDetails {
   pub number: i64,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[serde(rename = "isDraft")]
   #[serde(default, deserialize_with = "deserialize_bool_or_default")]
   pub is_draft: bool,
   #[serde(rename = "reviewDecision")]
   pub review_decision: Option<String>,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename(serialize = "headRef", deserialize = "headRefName"))]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub head_ref: String,
   #[serde(rename(serialize = "baseRef", deserialize = "baseRefName"))]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub base_ref: String,
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub additions: i64,
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub deletions: i64,
   #[serde(rename = "changedFiles")]
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub changed_files: i64,
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub commits: Vec<serde_json::Value>,
   #[serde(
      rename = "statusCheckRollup",
      default,
      deserialize_with = "deserialize_status_checks"
   )]
   pub status_checks: Vec<StatusCheck>,
   #[serde(rename = "closingIssuesReferences", default)]
   pub linked_issues: Vec<LinkedIssue>,
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
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub labels: Vec<Label>,
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub assignees: Vec<PullRequestAuthor>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestFile {
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub path: String,
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub additions: i64,
   #[serde(default, deserialize_with = "deserialize_i64_or_default")]
   pub deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestComment {
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[serde(rename = "createdAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueListItem {
   pub number: i64,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(rename = "updatedAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub labels: Vec<Label>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueComment {
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[serde(rename = "createdAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueDetails {
   pub number: i64,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub title: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub body: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub state: String,
   #[serde(default, deserialize_with = "deserialize_author_or_default")]
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub updated_at: String,
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub labels: Vec<Label>,
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub assignees: Vec<PullRequestAuthor>,
   #[serde(default, deserialize_with = "deserialize_vec_or_default")]
   pub comments: Vec<IssueComment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowRunStep {
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub name: String,
   #[serde(default)]
   pub status: Option<String>,
   #[serde(default)]
   pub conclusion: Option<String>,
   #[serde(default)]
   pub number: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowRunJob {
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
   #[serde(default)]
   pub steps: Vec<WorkflowRunStep>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename = "headBranch", default)]
   pub head_branch: Option<String>,
   #[serde(rename = "headSha", default)]
   pub head_sha: Option<String>,
   #[serde(default)]
   pub jobs: Vec<WorkflowRunJob>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
   #[serde(default, deserialize_with = "deserialize_string_or_default")]
   pub url: String,
   #[serde(rename = "headBranch", default)]
   pub head_branch: Option<String>,
   #[serde(rename = "headSha", default)]
   pub head_sha: Option<String>,
}

impl Default for PullRequestAuthor {
   fn default() -> Self {
      Self {
         login: "unknown".to_string(),
         avatar_url: None,
      }
   }
}
