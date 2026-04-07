use crate::{
   cli::{get_github_username, gh_command, resolve_gh_binary},
   models::{
      IssueDetails, IssueListItem, PullRequest, PullRequestComment, PullRequestDetails,
      PullRequestFile, WorkflowRunDetails, WorkflowRunListItem,
   },
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitHubCliStatus {
   Authenticated,
   NotAuthenticated,
   NotInstalled,
}

pub fn github_check_cli_status(app: AppHandle) -> Result<GitHubCliStatus, String> {
   let binary = resolve_gh_binary();
   let exe_name = if cfg!(target_os = "windows") {
      "gh.exe"
   } else {
      "gh"
   };

   // If resolve returned the bare name, check if it's actually reachable
   if binary == exe_name
      && std::process::Command::new(&binary)
         .arg("--version")
         .output()
         .is_err()
   {
      return Ok(GitHubCliStatus::NotInstalled);
   }

   let output = gh_command(&app, None)
      .args(["auth", "status"])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if output.status.success() {
      Ok(GitHubCliStatus::Authenticated)
   } else {
      Ok(GitHubCliStatus::NotAuthenticated)
   }
}

pub fn github_list_prs(
   app: AppHandle,
   repo_path: String,
   filter: String,
) -> Result<Vec<PullRequest>, String> {
   let repo_dir = Path::new(&repo_path);
   let json_fields = "number,title,state,author,createdAt,updatedAt,isDraft,reviewDecision,url,\
                      headRefName,baseRefName,additions,deletions";
   let mut args = vec!["pr", "list", "--json", json_fields];

   let username = if filter == "my-prs" {
      get_github_username(&app).ok()
   } else {
      None
   };

   match filter.as_str() {
      "my-prs" => {
         if let Some(ref user) = username {
            args.push("--author");
            args.push(user);
         }
      }
      "review-requests" => {
         args.push("--search");
         args.push("review-requested:@me");
      }
      _ => {}
   }

   let output = gh_command(&app, Some(repo_dir))
      .args(&args)
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to list PRs: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   serde_json::from_str(&String::from_utf8_lossy(&output.stdout))
      .map_err(|e| format!("Failed to parse PR data: {}", e))
}

pub fn github_get_current_user(app: AppHandle) -> Result<String, String> {
   get_github_username(&app)
}

pub fn github_list_issues(app: AppHandle, repo_path: String) -> Result<Vec<IssueListItem>, String> {
   let repo_dir = Path::new(&repo_path);
   let json_fields = "number,title,state,author,updatedAt,url,labels";

   let output = gh_command(&app, Some(repo_dir))
      .args([
         "issue",
         "list",
         "--state",
         "open",
         "--limit",
         "50",
         "--json",
         json_fields,
      ])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to list issues: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   serde_json::from_str(&String::from_utf8_lossy(&output.stdout))
      .map_err(|e| format!("Failed to parse issues: {}", e))
}

pub fn github_list_workflow_runs(
   app: AppHandle,
   repo_path: String,
) -> Result<Vec<WorkflowRunListItem>, String> {
   let repo_dir = Path::new(&repo_path);
   let json_fields = "databaseId,displayTitle,name,workflowName,event,status,conclusion,updatedAt,\
                      url,headBranch,headSha";

   let output = gh_command(&app, Some(repo_dir))
      .args(["run", "list", "--limit", "50", "--json", json_fields])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to list workflow runs: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   serde_json::from_str(&String::from_utf8_lossy(&output.stdout))
      .map_err(|e| format!("Failed to parse workflow runs: {}", e))
}

pub fn github_open_pr_in_browser(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<(), String> {
   let repo_dir = Path::new(&repo_path);
   let output = gh_command(&app, Some(repo_dir))
      .args(["pr", "view", &pr_number.to_string(), "--web"])
      .output()
      .map_err(|e| format!("Failed to open PR: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to open PR in browser: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   Ok(())
}

pub fn github_checkout_pr(app: AppHandle, repo_path: String, pr_number: i64) -> Result<(), String> {
   let repo_dir = Path::new(&repo_path);
   let output = gh_command(&app, Some(repo_dir))
      .args(["pr", "checkout", &pr_number.to_string()])
      .output()
      .map_err(|e| format!("Failed to checkout PR: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to checkout PR: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   Ok(())
}

pub fn github_get_pr_details(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<PullRequestDetails, String> {
   let repo_dir = Path::new(&repo_path);
   let json_fields = "number,title,body,state,author,createdAt,updatedAt,isDraft,reviewDecision,\
                      url,headRefName,baseRefName,additions,deletions,changedFiles,commits,\
                      statusCheckRollup,reviewRequests,mergeStateStatus,mergeable,labels,assignees";

   let output = gh_command(&app, Some(repo_dir))
      .args(["pr", "view", &pr_number.to_string(), "--json", json_fields])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to get PR details: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   serde_json::from_str(&String::from_utf8_lossy(&output.stdout))
      .map_err(|e| format!("Failed to parse PR details: {}", e))
}

pub fn github_get_pr_diff(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<String, String> {
   let repo_dir = Path::new(&repo_path);
   let output = gh_command(&app, Some(repo_dir))
      .args(["pr", "diff", &pr_number.to_string()])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to get PR diff: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn github_get_pr_files(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestFile>, String> {
   #[derive(Deserialize)]
   struct FilesResponse {
      files: Vec<PullRequestFile>,
   }

   let repo_dir = Path::new(&repo_path);
   let output = gh_command(&app, Some(repo_dir))
      .args(["pr", "view", &pr_number.to_string(), "--json", "files"])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to get PR files: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   serde_json::from_str::<FilesResponse>(&String::from_utf8_lossy(&output.stdout))
      .map(|response| response.files)
      .map_err(|e| format!("Failed to parse PR files: {}", e))
}

pub fn github_get_pr_comments(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestComment>, String> {
   #[derive(Deserialize)]
   struct CommentsResponse {
      comments: Vec<PullRequestComment>,
   }

   let repo_dir = Path::new(&repo_path);
   let output = gh_command(&app, Some(repo_dir))
      .args(["pr", "view", &pr_number.to_string(), "--json", "comments"])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to get PR comments: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   serde_json::from_str::<CommentsResponse>(&String::from_utf8_lossy(&output.stdout))
      .map(|response| response.comments)
      .map_err(|e| format!("Failed to parse PR comments: {}", e))
}

pub fn github_get_issue_details(
   app: AppHandle,
   repo_path: String,
   issue_number: i64,
) -> Result<IssueDetails, String> {
   let repo_dir = Path::new(&repo_path);
   let json_fields =
      "number,title,body,state,author,createdAt,updatedAt,url,labels,assignees,comments";

   let output = gh_command(&app, Some(repo_dir))
      .args([
         "issue",
         "view",
         &issue_number.to_string(),
         "--json",
         json_fields,
      ])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to get issue details: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   serde_json::from_str(&String::from_utf8_lossy(&output.stdout))
      .map_err(|e| format!("Failed to parse issue details: {}", e))
}

pub fn github_get_workflow_run_details(
   app: AppHandle,
   repo_path: String,
   run_id: i64,
) -> Result<WorkflowRunDetails, String> {
   let repo_dir = Path::new(&repo_path);
   let json_fields = "databaseId,name,displayTitle,workflowName,event,status,conclusion,createdAt,\
                      updatedAt,url,headBranch,headSha,jobs";

   let output = gh_command(&app, Some(repo_dir))
      .args(["run", "view", &run_id.to_string(), "--json", json_fields])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      return Err(format!(
         "Failed to get workflow run details: {}",
         String::from_utf8_lossy(&output.stderr)
      ));
   }

   serde_json::from_str(&String::from_utf8_lossy(&output.stdout))
      .map_err(|e| format!("Failed to parse workflow run details: {}", e))
}
