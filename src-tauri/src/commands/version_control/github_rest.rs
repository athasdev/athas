use athas_github::{
   IssueComment, IssueDetails, IssueListItem, Label, LinkedIssue, PullRequest, PullRequestAuthor,
   PullRequestComment, PullRequestDetails, PullRequestFile, ReviewRequest, StatusCheck,
   WorkflowRunDetails, WorkflowRunJob, WorkflowRunListItem, WorkflowRunStep,
};
use athas_version_control::git as git_backend;
use reqwest::{
   Client,
   header::{ACCEPT, HeaderMap, HeaderValue, USER_AGENT},
};
use serde::{Deserialize, de::DeserializeOwned};

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const GITHUB_API_VERSION: &str = "2022-11-28";
const DEFAULT_PER_PAGE: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubRepoSlug {
   pub owner: String,
   pub repo: String,
}

pub async fn fetch_current_user_with_pat(token: &str) -> Result<String, String> {
   let client = GitHubRestClient::new(token)?;
   let user: RestUser = client.get_json("/user").await?;
   Ok(user.login)
}

pub async fn list_prs_with_pat(
   repo_path: &str,
   filter: &str,
   token: &str,
   current_user: Option<&str>,
) -> Result<Vec<PullRequest>, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   let mut pulls: Vec<RestPullRequestSummary> = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/pulls?state=open&per_page={DEFAULT_PER_PAGE}",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;

   let filtered = match filter {
      "my-prs" => {
         let Some(user) = current_user else {
            return Ok(Vec::new());
         };
         pulls
            .drain(..)
            .filter(|pr| pr.user.login.eq_ignore_ascii_case(user))
            .collect()
      }
      "review-requests" => {
         let Some(user) = current_user else {
            return Ok(Vec::new());
         };
         pulls
            .drain(..)
            .filter(|pr| {
               pr.requested_reviewers
                  .iter()
                  .any(|reviewer| reviewer.login.eq_ignore_ascii_case(user))
            })
            .collect()
      }
      _ => pulls,
   };

   Ok(filtered.into_iter().map(map_pull_request_summary).collect())
}

pub async fn get_pr_details_with_pat(
   repo_path: &str,
   pr_number: i64,
   token: &str,
) -> Result<PullRequestDetails, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   let pr: RestPullRequestDetails = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/pulls/{pr_number}",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;

   let commits: Vec<serde_json::Value> = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/pulls/{pr_number}/commits?per_page=100",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await
      .unwrap_or_default();

   let reviews: Vec<RestPullRequestReview> = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/pulls/{pr_number}/reviews?per_page=100",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await
      .unwrap_or_default();

   let status_checks = match pr.head.sha.as_deref() {
      Some(head_sha) if !head_sha.is_empty() => fetch_status_checks(&client, &slug, head_sha)
         .await
         .unwrap_or_default(),
      _ => Vec::new(),
   };

   let merge_state_status = pr
      .mergeable_state
      .as_deref()
      .map(|state| state.to_uppercase());
   let mergeable = match pr.mergeable {
      Some(true) => Some("MERGEABLE".to_string()),
      Some(false) => Some("CONFLICTING".to_string()),
      None => None,
   };
   let review_requests = pr
      .requested_reviewers
      .iter()
      .map(map_review_request)
      .collect();

   Ok(PullRequestDetails {
      number: pr.number,
      title: pr.title,
      body: pr.body.unwrap_or_default(),
      state: pr.state,
      author: map_author(&pr.user),
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      is_draft: pr.draft.unwrap_or(false),
      review_decision: derive_review_decision(&reviews, &pr.requested_reviewers),
      url: pr.html_url,
      head_ref: pr.head.reference,
      base_ref: pr.base.reference,
      additions: pr.additions.unwrap_or_default(),
      deletions: pr.deletions.unwrap_or_default(),
      changed_files: pr.changed_files.unwrap_or_default(),
      commits,
      status_checks,
      linked_issues: Vec::<LinkedIssue>::new(),
      review_requests,
      merge_state_status,
      mergeable,
      labels: pr.labels.iter().map(map_label).collect(),
      assignees: pr.assignees.iter().map(map_author).collect(),
   })
}

pub async fn get_pr_diff_with_pat(
   repo_path: &str,
   pr_number: i64,
   token: &str,
) -> Result<String, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   client
      .get_text(
         &format!(
            "/repos/{owner}/{repo}/pulls/{pr_number}",
            owner = slug.owner,
            repo = slug.repo
         ),
         Some("application/vnd.github.diff"),
      )
      .await
}

pub async fn get_pr_files_with_pat(
   repo_path: &str,
   pr_number: i64,
   token: &str,
) -> Result<Vec<PullRequestFile>, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   let files: Vec<RestPullRequestFile> = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/pulls/{pr_number}/files?per_page=100",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;

   Ok(files
      .into_iter()
      .map(|file| PullRequestFile {
         path: file.filename,
         additions: file.additions.unwrap_or_default(),
         deletions: file.deletions.unwrap_or_default(),
      })
      .collect())
}

pub async fn get_pr_comments_with_pat(
   repo_path: &str,
   pr_number: i64,
   token: &str,
) -> Result<Vec<PullRequestComment>, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   let comments: Vec<RestIssueComment> = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/issues/{pr_number}/comments?per_page=100",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;

   Ok(comments
      .into_iter()
      .map(|comment| PullRequestComment {
         author: map_author(&comment.user),
         body: comment.body.unwrap_or_default(),
         created_at: comment.created_at,
      })
      .collect())
}

pub async fn list_issues_with_pat(
   repo_path: &str,
   token: &str,
) -> Result<Vec<IssueListItem>, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   let issues: Vec<RestIssueListItem> = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/issues?state=open&per_page={DEFAULT_PER_PAGE}",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;

   Ok(issues
      .into_iter()
      .filter(|issue| !issue.is_pull_request())
      .map(|issue| IssueListItem {
         number: issue.number,
         title: issue.title,
         state: issue.state,
         author: map_author(&issue.user),
         updated_at: issue.updated_at,
         url: issue.html_url,
         labels: issue.labels.iter().map(map_label).collect(),
      })
      .collect())
}

pub async fn get_issue_details_with_pat(
   repo_path: &str,
   issue_number: i64,
   token: &str,
) -> Result<IssueDetails, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   let issue: RestIssueDetails = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/issues/{issue_number}",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;
   let comments: Vec<RestIssueComment> = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/issues/{issue_number}/comments?per_page=100",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await
      .unwrap_or_default();

   Ok(IssueDetails {
      number: issue.number,
      title: issue.title,
      body: issue.body.unwrap_or_default(),
      state: issue.state,
      author: map_author(&issue.user),
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      url: issue.html_url,
      labels: issue.labels.iter().map(map_label).collect(),
      assignees: issue.assignees.iter().map(map_author).collect(),
      comments: comments
         .into_iter()
         .map(|comment| IssueComment {
            author: map_author(&comment.user),
            body: comment.body.unwrap_or_default(),
            created_at: comment.created_at,
         })
         .collect(),
   })
}

pub async fn list_workflow_runs_with_pat(
   repo_path: &str,
   token: &str,
) -> Result<Vec<WorkflowRunListItem>, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   let response: RestWorkflowRunsResponse = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/actions/runs?per_page={DEFAULT_PER_PAGE}",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;

   Ok(response
      .workflow_runs
      .into_iter()
      .map(map_workflow_run_list_item)
      .collect())
}

pub async fn get_workflow_run_details_with_pat(
   repo_path: &str,
   run_id: i64,
   token: &str,
) -> Result<WorkflowRunDetails, String> {
   let slug = resolve_repo_slug(repo_path)?;
   let client = GitHubRestClient::new(token)?;
   let run: RestWorkflowRunDetails = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/actions/runs/{run_id}",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;
   let jobs_response: RestWorkflowJobsResponse = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/actions/runs/{run_id}/jobs?per_page=100",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await
      .unwrap_or_default();

   let workflow_name = run.name.clone();

   Ok(WorkflowRunDetails {
      database_id: run.id,
      name: run.name,
      display_title: run.display_title,
      workflow_name,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      updated_at: run.updated_at,
      url: run.html_url,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      jobs: jobs_response
         .jobs
         .into_iter()
         .map(map_workflow_job)
         .collect(),
   })
}

pub fn resolve_repo_slug(repo_path: &str) -> Result<GitHubRepoSlug, String> {
   let remotes = git_backend::git_get_remotes(repo_path.to_string())?;
   select_github_remote_slug(&remotes)
}

fn select_github_remote_slug(remotes: &[git_backend::GitRemote]) -> Result<GitHubRepoSlug, String> {
   if let Some(remote) = remotes.iter().find(|remote| remote.name == "origin")
      && let Some(slug) = parse_github_remote_url(&remote.url)
   {
      return Ok(slug);
   }

   remotes
      .iter()
      .find_map(|remote| parse_github_remote_url(&remote.url))
      .ok_or_else(|| "Repository is not linked to GitHub.".to_string())
}

fn parse_github_remote_url(url: &str) -> Option<GitHubRepoSlug> {
   let trimmed = url.trim();
   if trimmed.is_empty() {
      return None;
   }

   if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
      return parse_owner_repo_path(rest);
   }

   if let Ok(parsed) = reqwest::Url::parse(trimmed) {
      let host = parsed.host_str()?;
      if !host.eq_ignore_ascii_case("github.com") {
         return None;
      }

      return parse_owner_repo_path(parsed.path().trim_start_matches('/'));
   }

   None
}

fn parse_owner_repo_path(path: &str) -> Option<GitHubRepoSlug> {
   let normalized = path.trim_end_matches('/').trim_end_matches(".git");
   let mut segments = normalized.split('/').filter(|segment| !segment.is_empty());
   let owner = segments.next()?.to_string();
   let repo = segments.next()?.to_string();
   Some(GitHubRepoSlug { owner, repo })
}

async fn fetch_status_checks(
   client: &GitHubRestClient,
   slug: &GitHubRepoSlug,
   head_sha: &str,
) -> Result<Vec<StatusCheck>, String> {
   let response: RestCheckRunsResponse = client
      .get_json(&format!(
         "/repos/{owner}/{repo}/commits/{head_sha}/check-runs?per_page=100",
         owner = slug.owner,
         repo = slug.repo
      ))
      .await?;

   Ok(response
      .check_runs
      .into_iter()
      .map(|check| StatusCheck {
         name: Some(check.name),
         status: check.status,
         conclusion: check.conclusion,
         workflow_name: check
            .app
            .and_then(|app| app.name)
            .or(check.check_suite.and_then(|suite| suite.head_branch)),
      })
      .collect())
}

fn derive_review_decision(
   reviews: &[RestPullRequestReview],
   requested_reviewers: &[RestUser],
) -> Option<String> {
   let mut has_approval = false;
   for review in reviews.iter().rev() {
      match review.state.as_deref() {
         Some("CHANGES_REQUESTED") => return Some("CHANGES_REQUESTED".to_string()),
         Some("APPROVED") => has_approval = true,
         _ => {}
      }
   }

   if has_approval {
      return Some("APPROVED".to_string());
   }

   if !requested_reviewers.is_empty() {
      return Some("REVIEW_REQUIRED".to_string());
   }

   None
}

fn map_pull_request_summary(pr: RestPullRequestSummary) -> PullRequest {
   PullRequest {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: map_author(&pr.user),
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      is_draft: pr.draft.unwrap_or(false),
      review_decision: None,
      url: pr.html_url,
      head_ref: pr.head.reference,
      base_ref: pr.base.reference,
      additions: pr.additions.unwrap_or_default(),
      deletions: pr.deletions.unwrap_or_default(),
   }
}

fn map_author(user: &RestUser) -> PullRequestAuthor {
   PullRequestAuthor {
      login: user.login.clone(),
      avatar_url: user.avatar_url.clone(),
   }
}

fn map_label(label: &RestLabel) -> Label {
   Label {
      name: label.name.clone(),
      color: label.color.clone().unwrap_or_default(),
   }
}

fn map_review_request(user: &RestUser) -> ReviewRequest {
   ReviewRequest {
      login: user.login.clone(),
      avatar_url: user.avatar_url.clone(),
   }
}

fn map_workflow_run_list_item(run: RestWorkflowRunListItem) -> WorkflowRunListItem {
   let workflow_name = run.name.clone();

   WorkflowRunListItem {
      database_id: run.id,
      display_title: run.display_title,
      name: run.name,
      workflow_name,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      updated_at: run.updated_at,
      url: run.html_url,
      head_branch: run.head_branch,
      head_sha: run.head_sha,
   }
}

fn map_workflow_job(job: RestWorkflowJob) -> WorkflowRunJob {
   WorkflowRunJob {
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      url: job.html_url,
      steps: job
         .steps
         .unwrap_or_default()
         .into_iter()
         .map(|step| WorkflowRunStep {
            name: step.name,
            status: step.status,
            conclusion: step.conclusion,
            number: step.number,
         })
         .collect(),
   }
}

struct GitHubRestClient {
   client: Client,
   token: String,
}

impl GitHubRestClient {
   fn new(token: &str) -> Result<Self, String> {
      let mut headers = HeaderMap::new();
      headers.insert(USER_AGENT, HeaderValue::from_static("athas"));
      headers.insert(
         ACCEPT,
         HeaderValue::from_static("application/vnd.github+json"),
      );
      headers.insert(
         "X-GitHub-Api-Version",
         HeaderValue::from_static(GITHUB_API_VERSION),
      );

      let client = Client::builder()
         .default_headers(headers)
         .build()
         .map_err(|error| format!("Failed to create GitHub API client: {error}"))?;

      Ok(Self {
         client,
         token: token.to_string(),
      })
   }

   async fn get_json<T>(&self, path: &str) -> Result<T, String>
   where
      T: DeserializeOwned,
   {
      let response = self
         .client
         .get(format!("{GITHUB_API_BASE_URL}{path}"))
         .bearer_auth(&self.token)
         .send()
         .await
         .map_err(|error| format!("GitHub API request failed: {error}"))?;

      parse_github_json_response(response).await
   }

   async fn get_text(&self, path: &str, accept: Option<&str>) -> Result<String, String> {
      let mut request = self
         .client
         .get(format!("{GITHUB_API_BASE_URL}{path}"))
         .bearer_auth(&self.token);

      if let Some(accept) = accept {
         request = request.header(ACCEPT, accept);
      }

      let response = request
         .send()
         .await
         .map_err(|error| format!("GitHub API request failed: {error}"))?;

      parse_github_text_response(response).await
   }
}

async fn parse_github_json_response<T>(response: reqwest::Response) -> Result<T, String>
where
   T: DeserializeOwned,
{
   let status = response.status();
   let body = response
      .text()
      .await
      .map_err(|error| format!("Failed to read GitHub API response: {error}"))?;

   if !status.is_success() {
      return Err(extract_github_error_message(status.as_u16(), &body));
   }

   serde_json::from_str(&body)
      .map_err(|error| format!("Failed to parse GitHub API response: {error}"))
}

async fn parse_github_text_response(response: reqwest::Response) -> Result<String, String> {
   let status = response.status();
   let body = response
      .text()
      .await
      .map_err(|error| format!("Failed to read GitHub API response: {error}"))?;

   if !status.is_success() {
      return Err(extract_github_error_message(status.as_u16(), &body));
   }

   Ok(body)
}

fn extract_github_error_message(status_code: u16, body: &str) -> String {
   let message = serde_json::from_str::<serde_json::Value>(body)
      .ok()
      .and_then(|value| {
         value
            .get("message")
            .and_then(|message| message.as_str())
            .map(str::to_string)
      })
      .unwrap_or_else(|| body.trim().to_string())
      .trim()
      .to_string();

   if message.is_empty() {
      format!("GitHub API request failed with status {status_code}.")
   } else {
      format!("GitHub API request failed ({status_code}): {message}")
   }
}

#[derive(Debug, Deserialize, Clone)]
struct RestUser {
   login: String,
   #[serde(default)]
   avatar_url: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct RestBranchRef {
   #[serde(rename = "ref")]
   reference: String,
   #[serde(default)]
   sha: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct RestLabel {
   name: String,
   #[serde(default)]
   color: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RestPullRequestSummary {
   number: i64,
   title: String,
   state: String,
   user: RestUser,
   created_at: String,
   updated_at: String,
   #[serde(default)]
   draft: Option<bool>,
   html_url: String,
   head: RestBranchRef,
   base: RestBranchRef,
   #[serde(default)]
   additions: Option<i64>,
   #[serde(default)]
   deletions: Option<i64>,
   #[serde(default)]
   requested_reviewers: Vec<RestUser>,
}

#[derive(Debug, Deserialize)]
struct RestPullRequestDetails {
   number: i64,
   title: String,
   #[serde(default)]
   body: Option<String>,
   state: String,
   user: RestUser,
   created_at: String,
   updated_at: String,
   #[serde(default)]
   draft: Option<bool>,
   html_url: String,
   head: RestBranchRef,
   base: RestBranchRef,
   #[serde(default)]
   additions: Option<i64>,
   #[serde(default)]
   deletions: Option<i64>,
   #[serde(default)]
   changed_files: Option<i64>,
   #[serde(default)]
   requested_reviewers: Vec<RestUser>,
   #[serde(default)]
   mergeable_state: Option<String>,
   #[serde(default)]
   mergeable: Option<bool>,
   #[serde(default)]
   labels: Vec<RestLabel>,
   #[serde(default)]
   assignees: Vec<RestUser>,
}

#[derive(Debug, Deserialize)]
struct RestPullRequestFile {
   filename: String,
   #[serde(default)]
   additions: Option<i64>,
   #[serde(default)]
   deletions: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct RestIssueComment {
   user: RestUser,
   #[serde(default)]
   body: Option<String>,
   created_at: String,
}

#[derive(Debug, Deserialize)]
struct RestPullRequestReview {
   #[serde(default)]
   state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RestIssueListItem {
   number: i64,
   title: String,
   state: String,
   user: RestUser,
   updated_at: String,
   html_url: String,
   #[serde(default)]
   labels: Vec<RestLabel>,
   #[serde(default)]
   pull_request: Option<serde_json::Value>,
}

impl RestIssueListItem {
   fn is_pull_request(&self) -> bool {
      self.pull_request.is_some()
   }
}

#[derive(Debug, Deserialize)]
struct RestIssueDetails {
   number: i64,
   title: String,
   #[serde(default)]
   body: Option<String>,
   state: String,
   user: RestUser,
   created_at: String,
   updated_at: String,
   html_url: String,
   #[serde(default)]
   labels: Vec<RestLabel>,
   #[serde(default)]
   assignees: Vec<RestUser>,
}

#[derive(Debug, Deserialize)]
struct RestWorkflowRunListItem {
   id: i64,
   #[serde(default)]
   display_title: Option<String>,
   #[serde(default)]
   name: Option<String>,
   #[serde(default)]
   event: Option<String>,
   #[serde(default)]
   status: Option<String>,
   #[serde(default)]
   conclusion: Option<String>,
   #[serde(default)]
   updated_at: Option<String>,
   html_url: String,
   #[serde(default)]
   head_branch: Option<String>,
   #[serde(default)]
   head_sha: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RestWorkflowRunsResponse {
   #[serde(default)]
   workflow_runs: Vec<RestWorkflowRunListItem>,
}

#[derive(Debug, Deserialize)]
struct RestWorkflowRunDetails {
   id: i64,
   #[serde(default)]
   name: Option<String>,
   #[serde(default)]
   display_title: Option<String>,
   #[serde(default)]
   event: Option<String>,
   #[serde(default)]
   status: Option<String>,
   #[serde(default)]
   conclusion: Option<String>,
   #[serde(default)]
   created_at: Option<String>,
   #[serde(default)]
   updated_at: Option<String>,
   html_url: String,
   #[serde(default)]
   head_branch: Option<String>,
   #[serde(default)]
   head_sha: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RestWorkflowJob {
   name: String,
   #[serde(default)]
   status: Option<String>,
   #[serde(default)]
   conclusion: Option<String>,
   #[serde(default)]
   started_at: Option<String>,
   #[serde(default)]
   completed_at: Option<String>,
   #[serde(default)]
   html_url: Option<String>,
   #[serde(default)]
   steps: Option<Vec<RestWorkflowStep>>,
}

#[derive(Debug, Deserialize)]
struct RestWorkflowStep {
   name: String,
   #[serde(default)]
   status: Option<String>,
   #[serde(default)]
   conclusion: Option<String>,
   #[serde(default)]
   number: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
struct RestWorkflowJobsResponse {
   #[serde(default)]
   jobs: Vec<RestWorkflowJob>,
}

#[derive(Debug, Deserialize)]
struct RestCheckRunApp {
   #[serde(default)]
   name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RestCheckSuite {
   #[serde(default)]
   head_branch: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RestCheckRun {
   name: String,
   #[serde(default)]
   status: Option<String>,
   #[serde(default)]
   conclusion: Option<String>,
   #[serde(default)]
   app: Option<RestCheckRunApp>,
   #[serde(default)]
   check_suite: Option<RestCheckSuite>,
}

#[derive(Debug, Deserialize)]
struct RestCheckRunsResponse {
   #[serde(default)]
   check_runs: Vec<RestCheckRun>,
}

#[cfg(test)]
mod tests {
   use super::{GitHubRepoSlug, parse_github_remote_url, select_github_remote_slug};
   use athas_version_control::git::GitRemote;

   #[test]
   fn parses_https_github_remote_url() {
      let slug = parse_github_remote_url("https://github.com/athasdev/athas.git");
      assert_eq!(
         slug,
         Some(GitHubRepoSlug {
            owner: "athasdev".to_string(),
            repo: "athas".to_string(),
         })
      );
   }

   #[test]
   fn parses_ssh_github_remote_url() {
      let slug = parse_github_remote_url("git@github.com:athasdev/athas.git");
      assert_eq!(
         slug,
         Some(GitHubRepoSlug {
            owner: "athasdev".to_string(),
            repo: "athas".to_string(),
         })
      );
   }

   #[test]
   fn prefers_origin_when_it_is_github() {
      let slug = select_github_remote_slug(&[
         GitRemote {
            name: "upstream".to_string(),
            url: "https://github.com/other/repo.git".to_string(),
         },
         GitRemote {
            name: "origin".to_string(),
            url: "https://github.com/athasdev/athas.git".to_string(),
         },
      ])
      .expect("origin GitHub remote should be selected");

      assert_eq!(
         slug,
         GitHubRepoSlug {
            owner: "athasdev".to_string(),
            repo: "athas".to_string(),
         }
      );
   }

   #[test]
   fn falls_back_to_first_github_remote_when_origin_is_not_github() {
      let slug = select_github_remote_slug(&[
         GitRemote {
            name: "origin".to_string(),
            url: "git@gitlab.com:athasdev/athas.git".to_string(),
         },
         GitRemote {
            name: "upstream".to_string(),
            url: "https://github.com/athasdev/athas.git".to_string(),
         },
      ])
      .expect("first GitHub remote should be selected");

      assert_eq!(
         slug,
         GitHubRepoSlug {
            owner: "athasdev".to_string(),
            repo: "athas".to_string(),
         }
      );
   }

   #[test]
   fn errors_when_repository_has_no_github_remote() {
      let error = select_github_remote_slug(&[GitRemote {
         name: "origin".to_string(),
         url: "git@gitlab.com:athasdev/athas.git".to_string(),
      }])
      .expect_err("non-GitHub remotes should fail");

      assert_eq!(error, "Repository is not linked to GitHub.");
   }
}
