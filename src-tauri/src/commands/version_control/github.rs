use crate::secure_storage::{get_secret, remove_secret, store_secret};
pub use athas_github::{
   IssueDetails, IssueListItem, PullRequest, PullRequestComment, PullRequestDetails,
   PullRequestFile, WorkflowRunDetails, WorkflowRunListItem,
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

#[tauri::command]
pub async fn github_check_cli_auth(app: tauri::AppHandle) -> Result<bool, String> {
   run_blocking(move || athas_github::github_check_cli_auth(app)).await
}

#[tauri::command]
pub async fn github_list_prs(
   app: tauri::AppHandle,
   repo_path: String,
   filter: String,
) -> Result<Vec<PullRequest>, String> {
   run_blocking(move || athas_github::github_list_prs(app, repo_path, filter)).await
}

#[tauri::command]
pub async fn github_get_current_user(app: tauri::AppHandle) -> Result<String, String> {
   run_blocking(move || athas_github::github_get_current_user(app)).await
}

#[tauri::command]
pub async fn github_list_issues(
   app: tauri::AppHandle,
   repo_path: String,
) -> Result<Vec<IssueListItem>, String> {
   run_blocking(move || athas_github::github_list_issues(app, repo_path)).await
}

#[tauri::command]
pub async fn github_list_workflow_runs(
   app: tauri::AppHandle,
   repo_path: String,
) -> Result<Vec<WorkflowRunListItem>, String> {
   run_blocking(move || athas_github::github_list_workflow_runs(app, repo_path)).await
}

#[tauri::command]
pub async fn github_open_pr_in_browser(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<(), String> {
   run_blocking(move || athas_github::github_open_pr_in_browser(app, repo_path, pr_number)).await
}

#[tauri::command]
pub async fn github_checkout_pr(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<(), String> {
   run_blocking(move || athas_github::github_checkout_pr(app, repo_path, pr_number)).await
}

#[tauri::command]
pub async fn github_get_pr_details(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<PullRequestDetails, String> {
   run_blocking(move || athas_github::github_get_pr_details(app, repo_path, pr_number)).await
}

#[tauri::command]
pub async fn github_get_pr_diff(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<String, String> {
   run_blocking(move || athas_github::github_get_pr_diff(app, repo_path, pr_number)).await
}

#[tauri::command]
pub async fn github_get_pr_files(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestFile>, String> {
   run_blocking(move || athas_github::github_get_pr_files(app, repo_path, pr_number)).await
}

#[tauri::command]
pub async fn github_get_pr_comments(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestComment>, String> {
   run_blocking(move || athas_github::github_get_pr_comments(app, repo_path, pr_number)).await
}

#[tauri::command]
pub async fn github_get_issue_details(
   app: tauri::AppHandle,
   repo_path: String,
   issue_number: i64,
) -> Result<IssueDetails, String> {
   run_blocking(move || athas_github::github_get_issue_details(app, repo_path, issue_number)).await
}

#[tauri::command]
pub async fn github_get_workflow_run_details(
   app: tauri::AppHandle,
   repo_path: String,
   run_id: i64,
) -> Result<WorkflowRunDetails, String> {
   run_blocking(move || athas_github::github_get_workflow_run_details(app, repo_path, run_id)).await
}

#[tauri::command]
pub async fn store_github_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
   store_secret(&app, "github_token", &token)
}

#[tauri::command]
pub async fn get_github_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
   get_secret(&app, "github_token")
}

#[tauri::command]
pub async fn remove_github_token(app: tauri::AppHandle) -> Result<(), String> {
   remove_secret(&app, "github_token")
}
