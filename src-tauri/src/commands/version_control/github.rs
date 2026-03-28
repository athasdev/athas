use crate::secure_storage::{get_secret, remove_secret, store_secret};
pub use athas_github::{
   IssueDetails, IssueListItem, PullRequest, PullRequestComment, PullRequestDetails,
   PullRequestFile, WorkflowRunDetails, WorkflowRunListItem,
};

#[tauri::command]
pub fn github_check_cli_auth(app: tauri::AppHandle) -> Result<bool, String> {
   athas_github::github_check_cli_auth(app)
}

#[tauri::command]
pub fn github_list_prs(
   app: tauri::AppHandle,
   repo_path: String,
   filter: String,
) -> Result<Vec<PullRequest>, String> {
   athas_github::github_list_prs(app, repo_path, filter)
}

#[tauri::command]
pub fn github_get_current_user(app: tauri::AppHandle) -> Result<String, String> {
   athas_github::github_get_current_user(app)
}

#[tauri::command]
pub fn github_list_issues(
   app: tauri::AppHandle,
   repo_path: String,
) -> Result<Vec<IssueListItem>, String> {
   athas_github::github_list_issues(app, repo_path)
}

#[tauri::command]
pub fn github_list_workflow_runs(
   app: tauri::AppHandle,
   repo_path: String,
) -> Result<Vec<WorkflowRunListItem>, String> {
   athas_github::github_list_workflow_runs(app, repo_path)
}

#[tauri::command]
pub fn github_open_pr_in_browser(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<(), String> {
   athas_github::github_open_pr_in_browser(app, repo_path, pr_number)
}

#[tauri::command]
pub fn github_checkout_pr(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<(), String> {
   athas_github::github_checkout_pr(app, repo_path, pr_number)
}

#[tauri::command]
pub fn github_get_pr_details(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<PullRequestDetails, String> {
   athas_github::github_get_pr_details(app, repo_path, pr_number)
}

#[tauri::command]
pub fn github_get_pr_diff(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<String, String> {
   athas_github::github_get_pr_diff(app, repo_path, pr_number)
}

#[tauri::command]
pub fn github_get_pr_files(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestFile>, String> {
   athas_github::github_get_pr_files(app, repo_path, pr_number)
}

#[tauri::command]
pub fn github_get_pr_comments(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestComment>, String> {
   athas_github::github_get_pr_comments(app, repo_path, pr_number)
}

#[tauri::command]
pub fn github_get_issue_details(
   app: tauri::AppHandle,
   repo_path: String,
   issue_number: i64,
) -> Result<IssueDetails, String> {
   athas_github::github_get_issue_details(app, repo_path, issue_number)
}

#[tauri::command]
pub fn github_get_workflow_run_details(
   app: tauri::AppHandle,
   repo_path: String,
   run_id: i64,
) -> Result<WorkflowRunDetails, String> {
   athas_github::github_get_workflow_run_details(app, repo_path, run_id)
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
