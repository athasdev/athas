//! The GitHub calls the web workbench's GitHub views relay to the workspace server. The server
//! holds the token and makes each call with the old app's `github` crate; the browser never sees
//! the token.
//!
//! A call travels as `github.<op>` with the variant's fields as params, so `ListPrs { path,
//! filter }` is `github.listPrs` with `{ "path": …, "filter": … }`. `path` is the repository
//! folder on the server, which must be the workspace root or inside it.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::CallError;

pub const METHOD_PREFIX: &str = "github.";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum GitHubCall {
    /// Finds the server's token and asks GitHub whether it works ([`AuthState`]).
    Auth,
    /// What Settings > Git > GitHub Account shows for the server's token ([`TokenStatus`]);
    /// `reread` asks the `gh` CLI again.
    TokenStatus {
        #[serde(default)]
        reread: bool,
    },
    /// The repository's remotes and branch, read from git ([`RepositoryInfo`]).
    Repository { path: String },
    /// The working tree's status as the AI draft prompt lists it, a string.
    DraftStatus { path: String },
    /// The changes from `base` to `head` as the AI draft prompt lists them, a string.
    DraftDiff { path: String, base: String, head: String },
    CurrentUser,
    ListNotifications,
    ResolveNotificationRun { repository: String, check_suite_id: Option<i64>, title: String, updated_at: String },
    ListPrs { path: String, filter: String },
    ListIssues { path: String, state: String },
    ListWorkflowRuns { path: String },
    ListWorkflows { path: String },
    ListLabels { path: String },
    ListMilestones { path: String },
    ListIssueTypes { path: String },
    CreateIssue { path: String, title: String, body: String, labels: Vec<String>, assignees: Vec<String>, milestone: Option<i64>, issue_type: Option<String> },
    UpdateIssue { path: String, number: i64, title: String, body: String, labels: Vec<String>, assignees: Vec<String>, milestone: Option<i64>, issue_type: Option<String> },
    UpdateIssueState { path: String, number: i64, state: String, reason: Option<String> },
    AddIssueComment { path: String, number: i64, body: String },
    UpdateIssueComment { path: String, id: i64, body: String },
    DeleteIssueComment { path: String, id: i64 },
    LockIssue { path: String, number: i64, reason: Option<String> },
    UnlockIssue { path: String, number: i64 },
    CreatePullRequest { path: String, title: String, body: String, head: String, base: String, draft: bool, labels: Vec<String>, assignees: Vec<String> },
    UpdatePullRequest { path: String, number: i64, title: String, body: String, labels: Vec<String>, assignees: Vec<String> },
    AddPrComment { path: String, number: i64, body: String },
    SubmitPrReview { path: String, number: i64, event: String, body: String },
    MergePullRequest { path: String, number: i64, method: String },
    ClosePullRequest { path: String, number: i64 },
    DispatchWorkflow { path: String, workflow_id: i64, reference: String },
    CheckoutPr { path: String, number: i64 },
    PrDetails { path: String, number: i64 },
    PrDiff { path: String, number: i64 },
    PrFiles { path: String, number: i64 },
    PrComments { path: String, number: i64 },
    IssueDetails { path: String, number: i64 },
    WorkflowRunDetails { path: String, run_id: i64 },
    RerunWorkflowRun { path: String, run_id: i64, failed_only: bool },
    CancelWorkflowRun { path: String, run_id: i64 },
    WorkflowJobLogs { path: String, job_id: i64 },
    ListReleases { path: String, page: u32 },
    Release { path: String, id: i64 },
    /// `input` is the crate's `ReleaseInput`.
    SaveRelease { path: String, id: Option<i64>, input: Value },
    PublishRelease { path: String, id: i64, make_latest: bool },
    DeleteRelease { path: String, id: i64 },
    GenerateReleaseNotes { path: String, tag: String, target: String, previous_tag: Option<String> },
    ListDeployments { path: String, page: u32 },
    Deployment { path: String, id: i64 },
    DeactivateDeployment { path: String, id: i64 },
    /// `file` is a path on the server.
    UploadReleaseAsset { path: String, id: i64, file: String },
    DeleteReleaseAsset { path: String, id: i64 },
}

impl GitHubCall {
    /// The protocol method and its params.
    pub fn to_method(&self) -> (String, Value) {
        let mut value = serde_json::to_value(self).unwrap_or_default();
        let op = value.as_object_mut().and_then(|fields| fields.remove("op")).and_then(|op| op.as_str().map(str::to_string)).unwrap_or_default();
        (format!("{METHOD_PREFIX}{op}"), value)
    }

    /// The call a `github.*` method names.
    pub fn from_method(method: &str, params: &Map<String, Value>) -> Result<Self, CallError> {
        let op = method.strip_prefix(METHOD_PREFIX).ok_or_else(|| CallError::invalid(format!("Unknown method {method}.")))?;
        let mut fields = params.clone();
        fields.insert("op".into(), Value::String(op.into()));
        serde_json::from_value(Value::Object(fields)).map_err(|error| CallError::invalid(format!("Invalid {method}: {error}")))
    }

    /// The repository folder the call works in, when it works in one.
    pub fn path(&self) -> Option<&str> {
        use GitHubCall::*;
        match self {
            Auth | TokenStatus { .. } | CurrentUser | ListNotifications | ResolveNotificationRun { .. } => None,
            Repository { path }
            | DraftStatus { path }
            | DraftDiff { path, .. }
            | ListPrs { path, .. }
            | ListIssues { path, .. }
            | ListWorkflowRuns { path }
            | ListWorkflows { path }
            | ListLabels { path }
            | ListMilestones { path }
            | ListIssueTypes { path }
            | CreateIssue { path, .. }
            | UpdateIssue { path, .. }
            | UpdateIssueState { path, .. }
            | AddIssueComment { path, .. }
            | UpdateIssueComment { path, .. }
            | DeleteIssueComment { path, .. }
            | LockIssue { path, .. }
            | UnlockIssue { path, .. }
            | CreatePullRequest { path, .. }
            | UpdatePullRequest { path, .. }
            | AddPrComment { path, .. }
            | SubmitPrReview { path, .. }
            | MergePullRequest { path, .. }
            | ClosePullRequest { path, .. }
            | DispatchWorkflow { path, .. }
            | CheckoutPr { path, .. }
            | PrDetails { path, .. }
            | PrDiff { path, .. }
            | PrFiles { path, .. }
            | PrComments { path, .. }
            | IssueDetails { path, .. }
            | WorkflowRunDetails { path, .. }
            | RerunWorkflowRun { path, .. }
            | CancelWorkflowRun { path, .. }
            | WorkflowJobLogs { path, .. }
            | ListReleases { path, .. }
            | Release { path, .. }
            | SaveRelease { path, .. }
            | PublishRelease { path, .. }
            | DeleteRelease { path, .. }
            | GenerateReleaseNotes { path, .. }
            | ListDeployments { path, .. }
            | Deployment { path, .. }
            | DeactivateDeployment { path, .. }
            | UploadReleaseAsset { path, .. }
            | DeleteReleaseAsset { path, .. } => Some(path),
        }
    }
}

/// The answer to [`GitHubCall::Auth`]. `source` is the crate's `GitHubTokenSource` as it
/// serialises (`ghCli`, `personalAccessToken`, `athas`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AuthState {
    Authenticated { source: String },
    Missing { gh_installed: bool, rejected: bool },
    Unavailable { error: String },
}

/// The answer to [`GitHubCall::TokenStatus`]: which of the server's credentials is active and
/// whom it belongs to, never the token. `source` is as in [`AuthState::Authenticated`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatus {
    pub source: Option<String>,
    /// `GITHUB_TOKEN` or `GH_TOKEN` is set where the server runs.
    pub has_environment_token: bool,
    pub gh_cli_installed: bool,
    /// The account the active token belongs to; `None` when GitHub rejected it.
    pub login: Option<String>,
    pub scopes: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Remote {
    pub name: String,
    pub url: String,
}

/// The answer to [`GitHubCall::Repository`]; `None` (JSON `null`) outside a repository.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    /// The working tree's root on the server.
    pub root: String,
    pub branch: Option<String>,
    /// The current branch's `branch.<name>.remote`.
    pub upstream: Option<String>,
    pub remotes: Vec<Remote>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calls_travel_as_methods_with_camel_case_params() {
        let call = GitHubCall::RerunWorkflowRun { path: "/w".into(), run_id: 7, failed_only: true };
        let (method, params) = call.to_method();
        assert_eq!(method, "github.rerunWorkflowRun");
        assert_eq!(params, serde_json::json!({ "path": "/w", "runId": 7, "failedOnly": true }));
        assert_eq!(GitHubCall::from_method(&method, params.as_object().unwrap()).unwrap(), call);
        assert_eq!(GitHubCall::Auth.to_method().0, "github.auth");
        assert_eq!(GitHubCall::from_method("github.auth", &Map::new()).unwrap(), GitHubCall::Auth);
        assert_eq!(call.path(), Some("/w"));
    }

    #[test]
    fn rejects_unknown_and_malformed_calls() {
        assert!(GitHubCall::from_method("github.deleteRepository", &Map::new()).is_err());
        assert!(GitHubCall::from_method("github.listPrs", &Map::new()).is_err());
        assert!(GitHubCall::from_method("git.status", &Map::new()).is_err());
    }

    #[test]
    fn auth_states_are_tagged() {
        let state = AuthState::Missing { gh_installed: true, rejected: false };
        assert_eq!(serde_json::to_value(&state).unwrap(), serde_json::json!({ "state": "missing", "ghInstalled": true, "rejected": false }));
    }
}
