use crate::secure_storage::{get_secret, remove_secret, store_secret};
pub use athas_github::{
   IssueDetails, IssueListItem, Label, PullRequest, PullRequestComment, PullRequestDetails,
   PullRequestFile, WorkflowListItem, WorkflowRunDetails, WorkflowRunListItem,
};

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
   T: Send + 'static,
   F: FnOnce() -> Result<T, String> + Send + 'static,
{
   tauri::async_runtime::spawn_blocking(operation)
      .await
      .map_err(|error| format!("GitHub command task failed: {}", error))?
}

fn get_stored_github_token(app: &crate::app_runtime::AppHandle) -> Option<String> {
   get_secret(app, "github_token")
      .ok()
      .flatten()
      .map(|token| token.trim().to_string())
      .filter(|token| !token.is_empty())
}

#[tauri::command]
pub async fn github_check_auth(
   app: crate::app_runtime::AppHandle,
) -> Result<athas_github::GitHubAuthStatus, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_check_auth(github_token)).await
}

#[tauri::command]
pub async fn github_list_prs(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   filter: String,
) -> Result<Vec<PullRequest>, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_list_prs(repo_path, filter, github_token)).await
}

#[tauri::command]
pub async fn github_get_current_user(app: crate::app_runtime::AppHandle) -> Result<String, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_get_current_user(github_token)).await
}

#[tauri::command]
pub async fn github_list_issues(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   state: Option<String>,
) -> Result<Vec<IssueListItem>, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_list_issues(
         repo_path,
         state.unwrap_or_else(|| "open".to_string()),
         github_token,
      )
   })
   .await
}

#[tauri::command]
pub async fn github_list_workflow_runs(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
) -> Result<Vec<WorkflowRunListItem>, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_list_workflow_runs(repo_path, github_token)).await
}

#[tauri::command]
pub async fn github_list_workflows(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
) -> Result<Vec<WorkflowListItem>, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_list_workflows(repo_path, github_token)).await
}

#[tauri::command]
pub async fn github_list_labels(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
) -> Result<Vec<Label>, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_list_labels(repo_path, github_token)).await
}

#[tauri::command]
pub async fn github_create_issue(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   title: String,
   body: String,
   labels: Vec<String>,
   assignees: Vec<String>,
) -> Result<IssueListItem, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_create_issue(repo_path, title, body, labels, assignees, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_update_issue(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   issue_number: i64,
   title: String,
   body: String,
) -> Result<IssueDetails, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_update_issue(repo_path, issue_number, title, body, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_create_pull_request(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   title: String,
   body: String,
   head: String,
   base: String,
   draft: bool,
   labels: Vec<String>,
   assignees: Vec<String>,
) -> Result<PullRequest, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_create_pull_request(
         repo_path,
         title,
         body,
         head,
         base,
         draft,
         labels,
         assignees,
         github_token,
      )
   })
   .await
}

#[tauri::command]
pub async fn github_update_pull_request(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
   title: String,
   body: String,
) -> Result<PullRequestDetails, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_update_pull_request(repo_path, pr_number, title, body, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_add_pr_comment(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
   body: String,
) -> Result<PullRequestComment, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_add_pr_comment(repo_path, pr_number, body, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_submit_pr_review(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
   event: String,
   body: String,
) -> Result<(), String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_submit_pr_review(repo_path, pr_number, event, body, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_merge_pull_request(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
   method: String,
) -> Result<PullRequestDetails, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_merge_pull_request(repo_path, pr_number, method, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_close_pull_request(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<PullRequestDetails, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_close_pull_request(repo_path, pr_number, github_token))
      .await
}

#[tauri::command]
pub async fn github_dispatch_workflow(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   workflow_id: i64,
   reference: String,
) -> Result<(), String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_dispatch_workflow(repo_path, workflow_id, reference, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_checkout_pr(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<(), String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_checkout_pr(repo_path, pr_number, github_token)).await
}

#[tauri::command]
pub async fn github_get_pr_details(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<PullRequestDetails, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_get_pr_details(repo_path, pr_number, github_token))
      .await
}

#[tauri::command]
pub async fn github_get_pr_diff(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<String, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_get_pr_diff(repo_path, pr_number, github_token)).await
}

#[tauri::command]
pub async fn github_get_pr_files(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestFile>, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_get_pr_files(repo_path, pr_number, github_token)).await
}

#[tauri::command]
pub async fn github_get_pr_comments(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestComment>, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_get_pr_comments(repo_path, pr_number, github_token))
      .await
}

#[tauri::command]
pub async fn github_get_issue_details(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   issue_number: i64,
) -> Result<IssueDetails, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_get_issue_details(repo_path, issue_number, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_get_workflow_run_details(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   run_id: i64,
) -> Result<WorkflowRunDetails, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || {
      athas_github::github_get_workflow_run_details(repo_path, run_id, github_token)
   })
   .await
}

#[tauri::command]
pub async fn github_get_workflow_job_logs(
   app: crate::app_runtime::AppHandle,
   repo_path: String,
   job_id: i64,
) -> Result<String, String> {
   let github_token = get_stored_github_token(&app);
   run_blocking(move || athas_github::github_get_workflow_job_logs(repo_path, job_id, github_token))
      .await
}

#[tauri::command]
pub async fn store_github_token(
   app: crate::app_runtime::AppHandle,
   token: String,
) -> Result<(), String> {
   store_secret(&app, "github_token", &token)
}

#[tauri::command]
pub async fn get_github_token(
   app: crate::app_runtime::AppHandle,
) -> Result<Option<String>, String> {
   get_secret(&app, "github_token")
}

#[tauri::command]
pub async fn remove_github_token(app: crate::app_runtime::AppHandle) -> Result<(), String> {
   remove_secret(&app, "github_token")
}
