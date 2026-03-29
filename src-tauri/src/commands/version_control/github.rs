use super::{
   github_auth::{
      GitHubAuthSource, GitHubAuthStatus, remove_pat_fallback, resolve_github_auth,
      store_pat_fallback,
   },
   github_rest::{
      get_issue_details_with_pat, get_pr_comments_with_pat, get_pr_details_with_pat,
      get_pr_diff_with_pat, get_pr_files_with_pat, get_workflow_run_details_with_pat,
      list_issues_with_pat, list_prs_with_pat, list_workflow_runs_with_pat,
   },
};
use crate::secure_storage::get_secret;
pub use athas_github::{
   IssueDetails, IssueListItem, PullRequest, PullRequestComment, PullRequestDetails,
   PullRequestFile, WorkflowRunDetails, WorkflowRunListItem,
};

const GITHUB_PAT_SECRET_KEY: &str = "github_token";

#[tauri::command]
pub fn github_check_cli_auth(app: tauri::AppHandle) -> Result<bool, String> {
   athas_github::github_check_cli_auth(app)
}

#[tauri::command]
pub async fn github_get_auth_status(app: tauri::AppHandle) -> Result<GitHubAuthStatus, String> {
   Ok(resolve_github_auth(&app).await?.status)
}

#[tauri::command]
pub async fn github_list_prs(
   app: tauri::AppHandle,
   repo_path: String,
   filter: String,
) -> Result<Vec<PullRequest>, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_list_prs(app, repo_path, filter),
      GitHubAuthSource::Pat => {
         list_prs_with_pat(
            &repo_path,
            &filter,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
            resolved.status.current_user.as_deref(),
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_get_current_user(app: tauri::AppHandle) -> Result<String, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_get_current_user(app),
      GitHubAuthSource::Pat => resolved
         .status
         .current_user
         .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string()),
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_list_issues(
   app: tauri::AppHandle,
   repo_path: String,
) -> Result<Vec<IssueListItem>, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_list_issues(app, repo_path),
      GitHubAuthSource::Pat => {
         list_issues_with_pat(
            &repo_path,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_list_workflow_runs(
   app: tauri::AppHandle,
   repo_path: String,
) -> Result<Vec<WorkflowRunListItem>, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_list_workflow_runs(app, repo_path),
      GitHubAuthSource::Pat => {
         list_workflow_runs_with_pat(
            &repo_path,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
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
pub async fn github_checkout_pr(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<(), String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_checkout_pr(app, repo_path, pr_number),
      GitHubAuthSource::Pat => {
         Err("Checking out pull requests requires GitHub CLI authentication.".to_string())
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_get_pr_details(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<PullRequestDetails, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_get_pr_details(app, repo_path, pr_number),
      GitHubAuthSource::Pat => {
         get_pr_details_with_pat(
            &repo_path,
            pr_number,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_get_pr_diff(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<String, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_get_pr_diff(app, repo_path, pr_number),
      GitHubAuthSource::Pat => {
         get_pr_diff_with_pat(
            &repo_path,
            pr_number,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_get_pr_files(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestFile>, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_get_pr_files(app, repo_path, pr_number),
      GitHubAuthSource::Pat => {
         get_pr_files_with_pat(
            &repo_path,
            pr_number,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_get_pr_comments(
   app: tauri::AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestComment>, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_get_pr_comments(app, repo_path, pr_number),
      GitHubAuthSource::Pat => {
         get_pr_comments_with_pat(
            &repo_path,
            pr_number,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_get_issue_details(
   app: tauri::AppHandle,
   repo_path: String,
   issue_number: i64,
) -> Result<IssueDetails, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_get_issue_details(app, repo_path, issue_number),
      GitHubAuthSource::Pat => {
         get_issue_details_with_pat(
            &repo_path,
            issue_number,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn github_get_workflow_run_details(
   app: tauri::AppHandle,
   repo_path: String,
   run_id: i64,
) -> Result<WorkflowRunDetails, String> {
   let resolved = resolve_github_auth(&app).await?;
   match resolved.status.source {
      GitHubAuthSource::Gh => athas_github::github_get_workflow_run_details(app, repo_path, run_id),
      GitHubAuthSource::Pat => {
         get_workflow_run_details_with_pat(
            &repo_path,
            run_id,
            resolved
               .pat_token
               .as_deref()
               .ok_or_else(|| "GitHub PAT fallback is unavailable.".to_string())?,
         )
         .await
      }
      GitHubAuthSource::None => Err(build_auth_error(&resolved.status)),
   }
}

#[tauri::command]
pub async fn store_github_pat_fallback(
   app: tauri::AppHandle,
   token: String,
) -> Result<GitHubAuthStatus, String> {
   store_pat_fallback(&app, &token).await
}

#[tauri::command]
pub async fn remove_github_pat_fallback(app: tauri::AppHandle) -> Result<GitHubAuthStatus, String> {
   remove_pat_fallback(&app).await
}

#[tauri::command]
pub async fn store_github_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
   store_pat_fallback(&app, &token).await.map(|_| ())
}

#[tauri::command]
pub async fn get_github_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
   get_secret(&app, GITHUB_PAT_SECRET_KEY)
}

#[tauri::command]
pub async fn remove_github_token(app: tauri::AppHandle) -> Result<(), String> {
   remove_pat_fallback(&app).await.map(|_| ())
}

fn build_auth_error(status: &GitHubAuthStatus) -> String {
   if !status.cli_available {
      return "GitHub CLI is not installed. Install GitHub CLI or add a personal access token \
              fallback."
         .to_string();
   }

   if status.has_stored_pat {
      return "GitHub authentication is unavailable. Reconnect GitHub CLI or replace the stored \
              personal access token."
         .to_string();
   }

   "GitHub CLI is not authenticated. Run `gh auth login` or add a personal access token fallback."
      .to_string()
}
