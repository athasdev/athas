use crate::secure_storage::{get_secret, remove_secret, store_secret};
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command};
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequest {
   pub number: i64,
   pub title: String,
   pub state: String,
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   pub updated_at: String,
   #[serde(rename = "isDraft")]
   pub is_draft: bool,
   #[serde(rename = "reviewDecision")]
   pub review_decision: Option<String>,
   pub url: String,
   #[serde(rename = "headRefName")]
   pub head_ref: String,
   #[serde(rename = "baseRefName")]
   pub base_ref: String,
   pub additions: i64,
   pub deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestAuthor {
   pub login: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StatusCheck {
   pub name: String,
   pub status: String,
   pub conclusion: Option<String>,
   #[serde(rename = "workflowName")]
   pub workflow_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LinkedIssue {
   pub number: i64,
   pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Label {
   pub name: String,
   pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestDetails {
   pub number: i64,
   pub title: String,
   pub body: String,
   pub state: String,
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   pub updated_at: String,
   #[serde(rename = "isDraft")]
   pub is_draft: bool,
   #[serde(rename = "reviewDecision")]
   pub review_decision: Option<String>,
   pub url: String,
   #[serde(rename = "headRefName")]
   pub head_ref: String,
   #[serde(rename = "baseRefName")]
   pub base_ref: String,
   pub additions: i64,
   pub deletions: i64,
   #[serde(rename = "changedFiles")]
   pub changed_files: i64,
   pub commits: Vec<serde_json::Value>,
   // New fields for enhanced PR info
   #[serde(rename = "statusCheckRollup", default)]
   pub status_checks: Vec<StatusCheck>,
   #[serde(rename = "closingIssuesReferences", default)]
   pub linked_issues: Vec<LinkedIssue>,
   #[serde(rename = "reviewRequests", default)]
   pub review_requests: Vec<serde_json::Value>,
   #[serde(rename = "mergeStateStatus", default)]
   pub merge_state_status: Option<String>,
   #[serde(default)]
   pub mergeable: Option<String>,
   #[serde(default)]
   pub labels: Vec<Label>,
   #[serde(default)]
   pub assignees: Vec<PullRequestAuthor>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestFile {
   pub path: String,
   pub additions: i64,
   pub deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestComment {
   pub author: PullRequestAuthor,
   pub body: String,
   #[serde(rename = "createdAt")]
   pub created_at: String,
}

#[command]
pub fn github_check_cli_auth() -> Result<bool, String> {
   let output = Command::new("gh")
      .args(["auth", "status"])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   Ok(output.status.success())
}

#[command]
pub fn github_list_prs(repo_path: String, filter: String) -> Result<Vec<PullRequest>, String> {
   let repo_dir = Path::new(&repo_path);

   // Build the gh pr list command with JSON output
   let json_fields = "number,title,state,author,createdAt,updatedAt,isDraft,reviewDecision,url,\
                      headRefName,baseRefName,additions,deletions";

   let mut args = vec!["pr", "list", "--json", json_fields];

   // Get username outside the match to ensure it lives long enough
   let username = if filter == "my-prs" {
      get_github_username().ok()
   } else {
      None
   };

   // Add filter based on type
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
      _ => {
         // "all" - no additional filters, show all open PRs
      }
   }

   let output = Command::new("gh")
      .current_dir(repo_dir)
      .args(&args)
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to list PRs: {}", stderr));
   }

   let stdout = String::from_utf8_lossy(&output.stdout);
   let prs: Vec<PullRequest> =
      serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse PR data: {}", e))?;

   Ok(prs)
}

#[command]
pub fn github_get_current_user() -> Result<String, String> {
   get_github_username()
}

fn get_github_username() -> Result<String, String> {
   let output = Command::new("gh")
      .args(["api", "user", "--jq", ".login"])
      .output()
      .map_err(|e| format!("Failed to get GitHub username: {}", e))?;

   if !output.status.success() {
      return Err("Not authenticated with GitHub CLI".to_string());
   }

   let username = String::from_utf8_lossy(&output.stdout).trim().to_string();
   Ok(username)
}

#[command]
pub fn github_open_pr_in_browser(repo_path: String, pr_number: i64) -> Result<(), String> {
   let repo_dir = Path::new(&repo_path);

   let output = Command::new("gh")
      .current_dir(repo_dir)
      .args(["pr", "view", &pr_number.to_string(), "--web"])
      .output()
      .map_err(|e| format!("Failed to open PR: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to open PR in browser: {}", stderr));
   }

   Ok(())
}

#[command]
pub fn github_checkout_pr(repo_path: String, pr_number: i64) -> Result<(), String> {
   let repo_dir = Path::new(&repo_path);

   let output = Command::new("gh")
      .current_dir(repo_dir)
      .args(["pr", "checkout", &pr_number.to_string()])
      .output()
      .map_err(|e| format!("Failed to checkout PR: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to checkout PR: {}", stderr));
   }

   Ok(())
}

#[command]
pub fn github_get_pr_details(
   repo_path: String,
   pr_number: i64,
) -> Result<PullRequestDetails, String> {
   let repo_dir = Path::new(&repo_path);
   let pr_num_str = pr_number.to_string();

   let json_fields = "number,title,body,state,author,createdAt,updatedAt,isDraft,reviewDecision,\
                      url,headRefName,baseRefName,additions,deletions,changedFiles,commits,\
                      statusCheckRollup,closingIssuesReferences,reviewRequests,mergeStateStatus,\
                      mergeable,labels,assignees";

   let output = Command::new("gh")
      .current_dir(repo_dir)
      .args(["pr", "view", &pr_num_str, "--json", json_fields])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to get PR details: {}", stderr));
   }

   let stdout = String::from_utf8_lossy(&output.stdout);
   let pr: PullRequestDetails =
      serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse PR details: {}", e))?;

   Ok(pr)
}

#[command]
pub fn github_get_pr_diff(repo_path: String, pr_number: i64) -> Result<String, String> {
   let repo_dir = Path::new(&repo_path);
   let pr_num_str = pr_number.to_string();

   let output = Command::new("gh")
      .current_dir(repo_dir)
      .args(["pr", "diff", &pr_num_str])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to get PR diff: {}", stderr));
   }

   let diff = String::from_utf8_lossy(&output.stdout).to_string();
   Ok(diff)
}

#[command]
pub fn github_get_pr_files(
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestFile>, String> {
   let repo_dir = Path::new(&repo_path);
   let pr_num_str = pr_number.to_string();

   let output = Command::new("gh")
      .current_dir(repo_dir)
      .args(["pr", "view", &pr_num_str, "--json", "files"])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to get PR files: {}", stderr));
   }

   let stdout = String::from_utf8_lossy(&output.stdout);

   #[derive(Deserialize)]
   struct FilesResponse {
      files: Vec<PullRequestFile>,
   }

   let response: FilesResponse =
      serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse PR files: {}", e))?;

   Ok(response.files)
}

#[command]
pub fn github_get_pr_comments(
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestComment>, String> {
   let repo_dir = Path::new(&repo_path);
   let pr_num_str = pr_number.to_string();

   let output = Command::new("gh")
      .current_dir(repo_dir)
      .args(["pr", "view", &pr_num_str, "--json", "comments"])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to get PR comments: {}", stderr));
   }

   let stdout = String::from_utf8_lossy(&output.stdout);

   #[derive(Deserialize)]
   struct CommentsResponse {
      comments: Vec<PullRequestComment>,
   }

   let response: CommentsResponse =
      serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse PR comments: {}", e))?;

   Ok(response.comments)
}

#[command]
pub async fn store_github_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
   store_secret(&app, "github_token", &token)
}

#[command]
pub async fn get_github_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
   get_secret(&app, "github_token")
}

#[command]
pub async fn remove_github_token(app: tauri::AppHandle) -> Result<(), String> {
   remove_secret(&app, "github_token")
}
