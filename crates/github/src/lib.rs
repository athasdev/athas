use serde::{Deserialize, Deserializer, Serialize};
use std::{
   env,
   ffi::OsStr,
   path::{Path, PathBuf},
   process::Command,
};
use tauri::{AppHandle, Manager};

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
   #[serde(rename(serialize = "headRef", deserialize = "headRefName"))]
   pub head_ref: String,
   #[serde(rename(serialize = "baseRef", deserialize = "baseRefName"))]
   pub base_ref: String,
   pub additions: i64,
   pub deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PullRequestAuthor {
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
   pub number: i64,
   pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewRequest {
   pub login: String,
   #[serde(rename = "avatarUrl", default)]
   pub avatar_url: Option<String>,
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
   #[serde(rename(serialize = "headRef", deserialize = "headRefName"))]
   pub head_ref: String,
   #[serde(rename(serialize = "baseRef", deserialize = "baseRefName"))]
   pub base_ref: String,
   pub additions: i64,
   pub deletions: i64,
   #[serde(rename = "changedFiles")]
   pub changed_files: i64,
   pub commits: Vec<serde_json::Value>,
   // New fields for enhanced PR info
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueListItem {
   pub number: i64,
   pub title: String,
   pub state: String,
   pub author: PullRequestAuthor,
   #[serde(rename = "updatedAt")]
   pub updated_at: String,
   pub url: String,
   #[serde(default)]
   pub labels: Vec<Label>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueComment {
   pub author: PullRequestAuthor,
   pub body: String,
   #[serde(rename = "createdAt")]
   pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueDetails {
   pub number: i64,
   pub title: String,
   pub body: String,
   pub state: String,
   pub author: PullRequestAuthor,
   #[serde(rename = "createdAt")]
   pub created_at: String,
   #[serde(rename = "updatedAt")]
   pub updated_at: String,
   pub url: String,
   #[serde(default)]
   pub labels: Vec<Label>,
   #[serde(default)]
   pub assignees: Vec<PullRequestAuthor>,
   #[serde(default)]
   pub comments: Vec<IssueComment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowRunStep {
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
   pub url: String,
   #[serde(rename = "headBranch", default)]
   pub head_branch: Option<String>,
   #[serde(rename = "headSha", default)]
   pub head_sha: Option<String>,
}

fn deserialize_status_checks<'de, D>(deserializer: D) -> Result<Vec<StatusCheck>, D::Error>
where
   D: Deserializer<'de>,
{
   let value = Option::<serde_json::Value>::deserialize(deserializer)?;
   let Some(value) = value else {
      return Ok(Vec::new());
   };

   let contexts = value
      .get("contexts")
      .and_then(|contexts| contexts.get("nodes"))
      .and_then(|nodes| nodes.as_array())
      .cloned()
      .unwrap_or_default();

   let mut checks = Vec::new();

   for context in contexts {
      let workflow_name = context
         .get("workflowName")
         .and_then(|value| value.as_str())
         .map(ToOwned::to_owned);

      let check = StatusCheck {
         name: context
            .get("name")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
         status: context
            .get("status")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
         conclusion: context
            .get("conclusion")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
         workflow_name,
      };

      if check.name.is_some() || check.status.is_some() || check.conclusion.is_some() {
         checks.push(check);
      }
   }

   Ok(checks)
}

fn deserialize_review_requests<'de, D>(deserializer: D) -> Result<Vec<ReviewRequest>, D::Error>
where
   D: Deserializer<'de>,
{
   let values = Vec::<serde_json::Value>::deserialize(deserializer).unwrap_or_default();
   let mut review_requests = Vec::new();

   for value in values {
      let reviewer = value.get("requestedReviewer").unwrap_or(&value);
      let login = reviewer
         .get("login")
         .and_then(|value| value.as_str())
         .map(ToOwned::to_owned);

      if let Some(login) = login {
         review_requests.push(ReviewRequest {
            login,
            avatar_url: reviewer
               .get("avatarUrl")
               .and_then(|value| value.as_str())
               .map(ToOwned::to_owned),
         });
      }
   }

   Ok(review_requests)
}

pub fn github_check_cli_auth(app: AppHandle) -> Result<bool, String> {
   let output = gh_command(&app, None)
      .args(["auth", "status"])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      if !stderr.trim().is_empty() {
         log::warn!("GitHub CLI auth check failed: {}", stderr.trim());
      }
   }

   Ok(output.status.success())
}

pub fn github_list_prs(
   app: AppHandle,
   repo_path: String,
   filter: String,
) -> Result<Vec<PullRequest>, String> {
   let repo_dir = Path::new(&repo_path);

   // Build the gh pr list command with JSON output
   let json_fields = "number,title,state,author,createdAt,updatedAt,isDraft,reviewDecision,url,\
                      headRefName,baseRefName,additions,deletions";

   let mut args = vec!["pr", "list", "--json", json_fields];

   // Get username outside the match to ensure it lives long enough
   let username = if filter == "my-prs" {
      get_github_username(&app).ok()
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

   let output = gh_command(&app, Some(repo_dir))
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
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to list issues: {}", stderr));
   }

   let stdout = String::from_utf8_lossy(&output.stdout);
   let issues: Vec<IssueListItem> =
      serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse issues: {}", e))?;

   Ok(issues)
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
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to list workflow runs: {}", stderr));
   }

   let stdout = String::from_utf8_lossy(&output.stdout);
   let runs: Vec<WorkflowRunListItem> =
      serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse workflow runs: {}", e))?;

   Ok(runs)
}

fn get_github_username(app: &AppHandle) -> Result<String, String> {
   let output = gh_command(app, None)
      .args(["api", "user", "--jq", ".login"])
      .output()
      .map_err(|e| format!("Failed to get GitHub username: {}", e))?;

   if !output.status.success() {
      return Err("Not authenticated with GitHub CLI".to_string());
   }

   let username = String::from_utf8_lossy(&output.stdout).trim().to_string();
   Ok(username)
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
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to open PR in browser: {}", stderr));
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
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to checkout PR: {}", stderr));
   }

   Ok(())
}

pub fn github_get_pr_details(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<PullRequestDetails, String> {
   let repo_dir = Path::new(&repo_path);
   let pr_num_str = pr_number.to_string();

   let json_fields = "number,title,body,state,author,createdAt,updatedAt,isDraft,reviewDecision,\
                      url,headRefName,baseRefName,additions,deletions,changedFiles,commits,\
                      statusCheckRollup,reviewRequests,mergeStateStatus,mergeable,labels,assignees";

   let output = gh_command(&app, Some(repo_dir))
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

pub fn github_get_pr_diff(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<String, String> {
   let repo_dir = Path::new(&repo_path);
   let pr_num_str = pr_number.to_string();

   let output = gh_command(&app, Some(repo_dir))
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

pub fn github_get_pr_files(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestFile>, String> {
   let repo_dir = Path::new(&repo_path);
   let pr_num_str = pr_number.to_string();

   let output = gh_command(&app, Some(repo_dir))
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

pub fn github_get_pr_comments(
   app: AppHandle,
   repo_path: String,
   pr_number: i64,
) -> Result<Vec<PullRequestComment>, String> {
   let repo_dir = Path::new(&repo_path);
   let pr_num_str = pr_number.to_string();

   let output = gh_command(&app, Some(repo_dir))
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

pub fn github_get_issue_details(
   app: AppHandle,
   repo_path: String,
   issue_number: i64,
) -> Result<IssueDetails, String> {
   let repo_dir = Path::new(&repo_path);
   let issue_num_str = issue_number.to_string();
   let json_fields =
      "number,title,body,state,author,createdAt,updatedAt,url,labels,assignees,comments";

   let output = gh_command(&app, Some(repo_dir))
      .args(["issue", "view", &issue_num_str, "--json", json_fields])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to get issue details: {}", stderr));
   }

   let stdout = String::from_utf8_lossy(&output.stdout);
   let issue: IssueDetails =
      serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse issue details: {}", e))?;

   Ok(issue)
}

pub fn github_get_workflow_run_details(
   app: AppHandle,
   repo_path: String,
   run_id: i64,
) -> Result<WorkflowRunDetails, String> {
   let repo_dir = Path::new(&repo_path);
   let run_id_str = run_id.to_string();
   let json_fields = "databaseId,name,displayTitle,workflowName,event,status,conclusion,createdAt,\
                      updatedAt,url,headBranch,headSha,jobs";

   let output = gh_command(&app, Some(repo_dir))
      .args(["run", "view", &run_id_str, "--json", json_fields])
      .output()
      .map_err(|e| format!("Failed to execute gh command: {}", e))?;

   if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to get workflow run details: {}", stderr));
   }

   let stdout = String::from_utf8_lossy(&output.stdout);
   let run: WorkflowRunDetails = serde_json::from_str(&stdout)
      .map_err(|e| format!("Failed to parse workflow run details: {}", e))?;

   Ok(run)
}

fn gh_command(app: &AppHandle, repo_dir: Option<&Path>) -> Command {
   let mut command = Command::new("gh");

   if let Some(dir) = repo_dir {
      command.current_dir(dir);
   }

   let has_explicit_config_dir =
      matches!(env::var_os("GH_CONFIG_DIR"), Some(dir) if !dir.is_empty());

   if !has_explicit_config_dir && let Some(config_dir) = resolve_gh_config_dir(app) {
      command.env("GH_CONFIG_DIR", config_dir);
   }

   command
}

fn resolve_gh_config_dir(app: &AppHandle) -> Option<PathBuf> {
   let home_dir = app.path().home_dir().ok();
   resolve_gh_config_dir_from_sources(
      env::var_os("GH_CONFIG_DIR").as_deref(),
      env::var_os("XDG_CONFIG_HOME").as_deref(),
      env::var_os("APPDATA").as_deref(),
      home_dir.as_deref(),
      cfg!(target_os = "windows"),
   )
}

fn resolve_gh_config_dir_from_sources(
   gh_config_dir: Option<&OsStr>,
   xdg_config_home: Option<&OsStr>,
   app_data: Option<&OsStr>,
   home_dir: Option<&Path>,
   is_windows: bool,
) -> Option<PathBuf> {
   if let Some(dir) = gh_config_dir.filter(|dir| !dir.is_empty()) {
      return Some(PathBuf::from(dir));
   }

   if let Some(dir) = xdg_config_home.filter(|dir| !dir.is_empty()) {
      return Some(PathBuf::from(dir).join("gh"));
   }

   if is_windows && let Some(dir) = app_data.filter(|dir| !dir.is_empty()) {
      return Some(PathBuf::from(dir).join("GitHub CLI"));
   }

   home_dir.map(|dir| dir.join(".config").join("gh"))
}

#[cfg(test)]
mod tests {
   use super::resolve_gh_config_dir_from_sources;
   use std::{
      ffi::OsStr,
      path::{Path, PathBuf},
   };

   #[test]
   fn prefers_explicit_gh_config_dir() {
      let config_dir = resolve_gh_config_dir_from_sources(
         Some(OsStr::new("/tmp/gh-config")),
         Some(OsStr::new("/tmp/xdg")),
         Some(OsStr::new("C:\\Users\\user\\AppData\\Roaming")),
         Some(Path::new("/home/fsos")),
         false,
      );

      assert_eq!(config_dir, Some("/tmp/gh-config".into()));
   }

   #[test]
   fn uses_xdg_config_home_before_home_fallback() {
      let config_dir = resolve_gh_config_dir_from_sources(
         None,
         Some(OsStr::new("/tmp/xdg")),
         None,
         Some(Path::new("/home/fsos")),
         false,
      );

      assert_eq!(config_dir, Some("/tmp/xdg/gh".into()));
   }

   #[test]
   fn uses_windows_appdata_when_requested() {
      let config_dir = resolve_gh_config_dir_from_sources(
         None,
         None,
         Some(OsStr::new("C:\\Users\\user\\AppData\\Roaming")),
         Some(Path::new("C:\\Users\\user")),
         true,
      );

      assert_eq!(
         config_dir,
         Some(PathBuf::from("C:\\Users\\user\\AppData\\Roaming").join("GitHub CLI"))
      );
   }

   #[test]
   fn falls_back_to_home_config_dir() {
      let config_dir =
         resolve_gh_config_dir_from_sources(None, None, None, Some(Path::new("/home/fsos")), false);

      assert_eq!(config_dir, Some("/home/fsos/.config/gh".into()));
   }
}
