//! `github.*`: the web workbench's GitHub views, answered with the old app's `github` crate. The
//! token is found here the way the desktop finds it (`GITHUB_TOKEN` or `GH_TOKEN`, then the `gh`
//! CLI) and never leaves the server. Answers are the crate's types as they serialise.

use std::{
    path::Path,
    sync::{Arc, RwLock},
};

use athas_github as gh;
use serde::Serialize;
use serde_json::{Map, Value};
use web_protocol::{
    CallError,
    github::{AuthState, GitHubCall, Remote, RepositoryInfo, TokenStatus},
};

use crate::Workspace;

/// What makes the calls that reach GitHub; tests put a stand-in here.
pub type Backend = Arc<dyn Fn(GitHubCall) -> Result<Value, String> + Send + Sync>;

pub(crate) struct GitHub {
    backend: RwLock<Backend>,
}

impl Default for GitHub {
    fn default() -> Self {
        Self { backend: RwLock::new(Arc::new(execute)) }
    }
}

impl GitHub {
    pub(crate) fn set_backend(&self, backend: Backend) {
        *self.backend.write().unwrap_or_else(|poisoned| poisoned.into_inner()) = backend;
    }

    fn backend(&self) -> Backend {
        self.backend.read().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }
}

pub(crate) fn call(workspace: &Workspace, method: &str, params: &Map<String, Value>) -> Result<Value, CallError> {
    let call = GitHubCall::from_method(method, params)?;
    if let Some(path) = call.path()
        && !Path::new(path).starts_with(&workspace.root)
    {
        return Err(CallError::invalid(format!("{path} is outside the workspace.")));
    }
    if let GitHubCall::UploadReleaseAsset { file, .. } = &call
        && !Path::new(file).starts_with(&workspace.root)
    {
        return Err(CallError::invalid(format!("{file} is outside the workspace.")));
    }
    if let GitHubCall::Repository { path } = &call {
        return to_value(repository(Path::new(path)));
    }
    if let GitHubCall::DraftStatus { path } = &call {
        return to_value(github_panel::draft::status_summary(Path::new(path)));
    }
    if let GitHubCall::DraftDiff { path, base, head } = &call {
        return to_value(github_panel::draft::diff_summary(Path::new(path), base, head));
    }
    (workspace.github.backend())(call).map_err(|error| CallError::new("github_failed", error))
}

fn to_value(value: impl Serialize) -> Result<Value, CallError> {
    serde_json::to_value(value).map_err(|error| CallError::new("error", error.to_string()))
}

/// The repository's remotes and branch; `None` outside a repository.
fn repository(path: &Path) -> Option<RepositoryInfo> {
    let repository = git2::Repository::discover(path).ok()?;
    let root = repository.workdir().unwrap_or(path).to_string_lossy().trim_end_matches('/').to_string();
    let head = repository.head().ok();
    let branch = head.as_ref().filter(|head| head.is_branch()).and_then(|head| head.shorthand()).map(str::to_string);
    let upstream = branch.as_ref().and_then(|branch| repository.config().ok()?.get_string(&format!("branch.{branch}.remote")).ok());
    let remotes = repository
        .remotes()
        .map(|names| {
            names
                .iter()
                .flatten()
                .filter_map(|name| Some(Remote { name: name.to_string(), url: repository.find_remote(name).ok()?.url()?.to_string() }))
                .collect()
        })
        .unwrap_or_default();
    Some(RepositoryInfo { root, branch, upstream, remotes })
}

fn env_token() -> Option<String> {
    ["GITHUB_TOKEN", "GH_TOKEN"].iter().find_map(|key| gh::non_blank(std::env::var(key).ok()))
}

fn find_token() -> gh::ResolvedGitHubToken {
    gh::resolve_token(
        gh::TokenSourcePreference::Auto,
        gh::TokenSources { personal_access_token: env_token, athas_account_token: || None, gh_cli_token: gh::cached_gh_cli_token },
    )
}

fn auth() -> AuthState {
    let resolved = find_token();
    let (Some(token), Some(source)) = (resolved.token, resolved.source) else {
        return AuthState::Missing { gh_installed: gh::is_gh_cli_installed(), rejected: false };
    };
    match gh::github_check_auth(Some(token)) {
        Ok(gh::GitHubAuthStatus::Authenticated) => AuthState::Authenticated {
            source: serde_json::to_value(source).ok().and_then(|source| source.as_str().map(str::to_string)).unwrap_or_default(),
        },
        Ok(gh::GitHubAuthStatus::NotAuthenticated) => {
            gh::invalidate_gh_cli_token_cache();
            AuthState::Missing { gh_installed: gh::is_gh_cli_installed(), rejected: true }
        }
        Err(error) => AuthState::Unavailable { error },
    }
}

fn token_status() -> Result<TokenStatus, String> {
    let status = gh::github_token_status(find_token(), env_token().is_some(), false)?;
    Ok(TokenStatus {
        source: status.source.and_then(|source| serde_json::to_value(source).ok()?.as_str().map(str::to_string)),
        has_environment_token: status.has_personal_access_token,
        gh_cli_installed: status.gh_cli_installed,
        login: status.login,
        scopes: status.scopes,
    })
}

fn json(value: Result<impl Serialize, String>) -> Result<Value, String> {
    serde_json::to_value(value?).map_err(|error| error.to_string())
}

/// Makes `call` against GitHub with the server's token.
pub fn execute(call: GitHubCall) -> Result<Value, String> {
    use GitHubCall::*;
    if let Auth = call {
        return json(Ok(auth()));
    }
    if let TokenStatus { reread } = call {
        if reread {
            gh::invalidate_gh_cli_token_cache();
        }
        return json(token_status());
    }
    let token = find_token().token;
    match call {
        Auth | TokenStatus { .. } | Repository { .. } | DraftStatus { .. } | DraftDiff { .. } => unreachable!("answered above"),
        CurrentUser => json(gh::github_get_current_user(token)),
        ListNotifications => json(gh::github_list_notifications(token)),
        ResolveNotificationRun { repository, check_suite_id, title, updated_at } => {
            json(gh::github_resolve_notification_workflow_run(repository, check_suite_id, title, updated_at, token))
        }
        ListPrs { path, filter } => json(gh::github_list_prs(path, filter, token)),
        ListIssues { path, state } => json(gh::github_list_issues(path, state, token)),
        ListWorkflowRuns { path } => json(gh::github_list_workflow_runs(path, token)),
        ListWorkflows { path } => json(gh::github_list_workflows(path, token)),
        ListLabels { path } => json(gh::github_list_labels(path, token)),
        ListMilestones { path } => json(gh::github_list_milestones(path, token)),
        ListIssueTypes { path } => json(gh::github_list_issue_types(path, token)),
        CreateIssue { path, title, body, labels, assignees, milestone, issue_type } => {
            json(gh::github_create_issue(path, title, body, labels, assignees, milestone, issue_type, token))
        }
        UpdateIssue { path, number, title, body, labels, assignees, milestone, issue_type } => {
            json(gh::github_update_issue(path, number, title, body, labels, assignees, milestone, issue_type, token))
        }
        UpdateIssueState { path, number, state, reason } => json(gh::github_update_issue_state(path, number, state, reason, token)),
        AddIssueComment { path, number, body } => json(gh::github_add_issue_comment(path, number, body, token)),
        UpdateIssueComment { path, id, body } => json(gh::github_update_issue_comment(path, id, body, token)),
        DeleteIssueComment { path, id } => json(gh::github_delete_issue_comment(path, id, token)),
        LockIssue { path, number, reason } => json(gh::github_lock_issue(path, number, reason, token)),
        UnlockIssue { path, number } => json(gh::github_unlock_issue(path, number, token)),
        CreatePullRequest { path, title, body, head, base, draft, labels, assignees } => {
            json(gh::github_create_pull_request(path, title, body, head, base, draft, labels, assignees, token))
        }
        UpdatePullRequest { path, number, title, body, labels, assignees } => json(gh::github_update_pull_request(path, number, title, body, labels, assignees, token)),
        AddPrComment { path, number, body } => json(gh::github_add_pr_comment(path, number, body, token)),
        SubmitPrReview { path, number, event, body } => json(gh::github_submit_pr_review(path, number, event, body, token)),
        MergePullRequest { path, number, method } => json(gh::github_merge_pull_request(path, number, method, token)),
        ClosePullRequest { path, number } => json(gh::github_close_pull_request(path, number, token)),
        DispatchWorkflow { path, workflow_id, reference } => json(gh::github_dispatch_workflow(path, workflow_id, reference, token)),
        CheckoutPr { path, number } => json(gh::github_checkout_pr(path, number, token)),
        PrDetails { path, number } => json(gh::github_get_pr_details(path, number, token)),
        PrDiff { path, number } => json(gh::github_get_pr_diff(path, number, token)),
        PrFiles { path, number } => json(gh::github_get_pr_files(path, number, token)),
        PrComments { path, number } => json(gh::github_get_pr_comments(path, number, token)),
        IssueDetails { path, number } => json(gh::github_get_issue_details(path, number, token)),
        WorkflowRunDetails { path, run_id } => json(gh::github_get_workflow_run_details(path, run_id, token)),
        RerunWorkflowRun { path, run_id, failed_only } => json(gh::github_rerun_workflow_run(path, run_id, failed_only, token)),
        CancelWorkflowRun { path, run_id } => json(gh::github_cancel_workflow_run(path, run_id, token)),
        WorkflowJobLogs { path, job_id } => json(gh::github_get_workflow_job_logs(path, job_id, token)),
        ListReleases { path, page } => json(gh::github_list_releases(path, page, token)),
        Release { path, id } => json(gh::github_get_release(path, id, token)),
        SaveRelease { path, id, input } => {
            let input: gh::ReleaseInput = serde_json::from_value(input).map_err(|error| format!("Invalid release: {error}"))?;
            json(gh::github_save_release(path, id, input, token))
        }
        PublishRelease { path, id, make_latest } => json(gh::github_publish_release(path, id, make_latest, token)),
        DeleteRelease { path, id } => json(gh::github_delete_release(path, id, token)),
        GenerateReleaseNotes { path, tag, target, previous_tag } => gh::github_generate_release_notes(path, tag, target, previous_tag, token),
        ListDeployments { path, page } => json(gh::github_list_deployments(path, page, token)),
        Deployment { path, id } => json(gh::github_get_deployment(path, id, token)),
        DeactivateDeployment { path, id } => json(gh::github_deactivate_deployment(path, id, token)),
        UploadReleaseAsset { path, id, file } => json(gh::github_upload_release_asset(path, id, file, token)),
        DeleteReleaseAsset { path, id } => json(gh::github_delete_release_asset(path, id, token)),
    }
}
