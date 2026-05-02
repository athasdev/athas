use crate::models::{
   IssueComment, IssueDetails, IssueListItem, Label, PullRequest, PullRequestAuthor,
   PullRequestComment, PullRequestDetails, PullRequestFile, ReviewRequest, StatusCheck,
   WorkflowRunDetails, WorkflowRunJob, WorkflowRunListItem, WorkflowRunStep,
};
use git2::Repository;
use reqwest::{
   blocking::{Client, RequestBuilder, Response},
   header::{ACCEPT, AUTHORIZATION, HeaderMap, HeaderValue, USER_AGENT},
};
use serde::{Deserialize, Serialize};
use std::{
   path::Path,
   process::Command,
   sync::{LazyLock, Mutex},
   thread,
   time::{Duration, Instant},
};

const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_API_VERSION: &str = "2022-11-28";
const USER_AGENT_VALUE: &str = "Athas";
const GITHUB_REQUEST_INTERVAL: Duration = Duration::from_millis(200);

static GITHUB_REQUEST_GATE: LazyLock<Mutex<Instant>> = LazyLock::new(|| Mutex::new(Instant::now()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitHubAuthStatus {
   Authenticated,
   NotAuthenticated,
}

#[derive(Debug, Clone)]
struct RepoSlug {
   owner: String,
   name: String,
}

struct RepoRemote {
   slug: RepoSlug,
   remote_name: String,
}

struct GitHubApi {
   client: Client,
   github_token: Option<String>,
}

#[derive(Deserialize)]
struct RestUser {
   login: String,
   avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct RestLabel {
   name: Option<String>,
   color: Option<String>,
}

#[derive(Deserialize)]
struct RestBranchRef {
   #[serde(rename = "ref")]
   ref_name: Option<String>,
   sha: Option<String>,
}

#[derive(Deserialize)]
struct RestPullRequest {
   number: i64,
   title: Option<String>,
   state: Option<String>,
   user: Option<RestUser>,
   created_at: Option<String>,
   updated_at: Option<String>,
   draft: Option<bool>,
   html_url: Option<String>,
   head: Option<RestBranchRef>,
   base: Option<RestBranchRef>,
   additions: Option<i64>,
   deletions: Option<i64>,
   changed_files: Option<i64>,
   body: Option<String>,
   mergeable: Option<bool>,
   mergeable_state: Option<String>,
   labels: Option<Vec<RestLabel>>,
   assignees: Option<Vec<RestUser>>,
}

#[derive(Deserialize)]
struct RestIssue {
   number: i64,
   title: Option<String>,
   state: Option<String>,
   user: Option<RestUser>,
   created_at: Option<String>,
   updated_at: Option<String>,
   html_url: Option<String>,
   body: Option<String>,
   labels: Option<Vec<RestLabel>>,
   assignees: Option<Vec<RestUser>>,
   pull_request: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct RestComment {
   user: Option<RestUser>,
   body: Option<String>,
   created_at: Option<String>,
}

#[derive(Deserialize)]
struct RestPullRequestFile {
   filename: Option<String>,
   additions: Option<i64>,
   deletions: Option<i64>,
}

#[derive(Deserialize)]
struct ReviewRequestsResponse {
   users: Option<Vec<RestUser>>,
   teams: Option<Vec<RestTeam>>,
}

#[derive(Deserialize)]
struct RestTeam {
   slug: Option<String>,
}

#[derive(Deserialize)]
struct SearchIssuesResponse {
   items: Vec<RestIssue>,
}

#[derive(Deserialize)]
struct WorkflowRunsResponse {
   workflow_runs: Vec<RestWorkflowRun>,
}

#[derive(Deserialize)]
struct WorkflowJobsResponse {
   jobs: Vec<RestWorkflowJob>,
}

#[derive(Deserialize)]
struct CheckRunsResponse {
   check_runs: Vec<RestCheckRun>,
}

#[derive(Deserialize)]
struct RestCheckRun {
   id: Option<i64>,
   name: Option<String>,
   status: Option<String>,
   conclusion: Option<String>,
   check_suite: Option<RestCheckSuite>,
}

#[derive(Deserialize)]
struct RestCheckSuite {
   app: Option<RestCheckApp>,
}

#[derive(Deserialize)]
struct RestCheckApp {
   name: Option<String>,
}

#[derive(Deserialize)]
struct RestWorkflowRun {
   id: i64,
   name: Option<String>,
   display_title: Option<String>,
   event: Option<String>,
   status: Option<String>,
   conclusion: Option<String>,
   created_at: Option<String>,
   updated_at: Option<String>,
   html_url: Option<String>,
   head_branch: Option<String>,
   head_sha: Option<String>,
}

#[derive(Deserialize)]
struct RestWorkflowJob {
   id: Option<i64>,
   name: Option<String>,
   status: Option<String>,
   conclusion: Option<String>,
   started_at: Option<String>,
   completed_at: Option<String>,
   html_url: Option<String>,
   runner_name: Option<String>,
   labels: Option<Vec<String>>,
   steps: Option<Vec<RestWorkflowStep>>,
}

#[derive(Deserialize)]
struct RestWorkflowStep {
   name: Option<String>,
   status: Option<String>,
   conclusion: Option<String>,
   number: Option<i64>,
}

impl GitHubApi {
   fn new(github_token: Option<String>) -> Result<Self, String> {
      let client = Client::builder()
         .timeout(Duration::from_secs(30))
         .user_agent(USER_AGENT_VALUE)
         .build()
         .map_err(|e| format!("Failed to create GitHub API client: {e}"))?;

      Ok(Self {
         client,
         github_token: github_token.filter(|token| !token.trim().is_empty()),
      })
   }

   fn new_authenticated(github_token: Option<String>) -> Result<Self, String> {
      if github_token
         .as_deref()
         .is_none_or(|token| token.trim().is_empty())
      {
         return Err("GitHub account required. Connect GitHub in Athas and try again.".to_string());
      }

      Self::new(github_token)
   }

   fn get(&self, path: &str, accept: &str) -> RequestBuilder {
      self.apply_headers(self.client.get(format!("{GITHUB_API_BASE}{path}")), accept)
   }

   fn get_json<T>(&self, path: &str) -> Result<T, String>
   where
      T: for<'de> Deserialize<'de>,
   {
      self.get_json_with_query(path, &[])
   }

   fn get_json_with_query<T>(&self, path: &str, query: &[(&str, String)]) -> Result<T, String>
   where
      T: for<'de> Deserialize<'de>,
   {
      let mut request = self.get(path, "application/vnd.github+json");
      if !query.is_empty() {
         request = request.query(query);
      }

      let response = send_github_request(request)?;
      response
         .json::<T>()
         .map_err(|e| format!("Failed to parse GitHub API response: {e}"))
   }

   fn get_text(&self, path: &str, accept: &str) -> Result<String, String> {
      let response = send_github_request(self.get(path, accept))?;
      response
         .text()
         .map_err(|e| format!("Failed to read GitHub API response: {e}"))
   }

   fn apply_headers(&self, request: RequestBuilder, accept: &str) -> RequestBuilder {
      let mut headers = HeaderMap::new();
      headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_VALUE));
      headers.insert(
         "X-GitHub-Api-Version",
         HeaderValue::from_static(GITHUB_API_VERSION),
      );
      headers.insert(
         ACCEPT,
         HeaderValue::from_str(accept).unwrap_or_else(|_| HeaderValue::from_static("*/*")),
      );

      let request = request.headers(headers);
      if let Some(token) = &self.github_token {
         request.header(AUTHORIZATION, format!("Bearer {}", token.trim()))
      } else {
         request
      }
   }
}

fn send_github_request(request: RequestBuilder) -> Result<Response, String> {
   let mut next_allowed_request_at = GITHUB_REQUEST_GATE
      .lock()
      .map_err(|_| "GitHub API request queue failed.".to_string())?;

   let now = Instant::now();
   if *next_allowed_request_at > now {
      thread::sleep(*next_allowed_request_at - now);
   }

   let response = request
      .send()
      .map_err(|e| format!("Failed to call GitHub API: {e}"))?;
   *next_allowed_request_at = Instant::now() + GITHUB_REQUEST_INTERVAL;
   drop(next_allowed_request_at);

   if response.status().is_success() {
      return Ok(response);
   }

   let status = response.status();
   let rate_remaining = response
      .headers()
      .get("x-ratelimit-remaining")
      .and_then(|value| value.to_str().ok())
      .map(ToOwned::to_owned);
   let retry_after = response
      .headers()
      .get("retry-after")
      .and_then(|value| value.to_str().ok())
      .map(ToOwned::to_owned);
   let rate_reset = response
      .headers()
      .get("x-ratelimit-reset")
      .and_then(|value| value.to_str().ok())
      .map(ToOwned::to_owned);
   let body = response.text().unwrap_or_default();
   let parsed_message = parse_github_error_message(&body).unwrap_or_else(|| body.clone());
   let normalized_message = parsed_message.to_lowercase();

   if status.as_u16() == 401 {
      return Err(
         "GitHub authentication failed. Connect GitHub in Athas and try again.".to_string(),
      );
   }

   if status.as_u16() == 403 && rate_remaining.as_deref() == Some("0") {
      let reset_suffix = rate_reset
         .as_deref()
         .map(|reset| format!(" Reset epoch: {reset}."))
         .unwrap_or_default();
      return Err(format!(
         "GitHub API rate limit reached. Try again after the limit resets.{reset_suffix}"
      ));
   }

   if status.as_u16() == 429
      || retry_after.is_some()
      || (status.as_u16() == 403
         && (normalized_message.contains("secondary rate limit")
            || normalized_message.contains("abuse detection")
            || normalized_message.contains("rate limit")))
   {
      let retry_suffix = retry_after
         .as_deref()
         .map(|seconds| format!(" Retry after {seconds} seconds."))
         .unwrap_or_default();
      return Err(format!(
         "GitHub API temporarily rate limited the request. Try again shortly.{retry_suffix}"
      ));
   }

   Err(format!(
      "GitHub API request failed ({status}): {parsed_message}"
   ))
}

fn parse_github_error_message(body: &str) -> Option<String> {
   serde_json::from_str::<serde_json::Value>(body)
      .ok()
      .and_then(|value| {
         value
            .get("message")
            .and_then(|message| message.as_str())
            .map(String::from)
      })
}

fn resolve_repo_slug(repo_path: &str) -> Result<RepoSlug, String> {
   resolve_repo_remote(repo_path).map(|remote| remote.slug)
}

fn resolve_repo_remote(repo_path: &str) -> Result<RepoRemote, String> {
   let repository = Repository::discover(repo_path)
      .map_err(|_| "Repository is not a Git repository".to_string())?;

   let remote_names = repository
      .remotes()
      .map_err(|e| format!("Failed to read repository remotes: {e}"))?
      .iter()
      .flatten()
      .map(ToOwned::to_owned)
      .collect::<Vec<_>>();

   for remote_name in
      order_remote_names(remote_names, current_branch_remote(&repository).as_deref())
   {
      if let Ok(remote) = repository.find_remote(&remote_name)
         && let Some(url) = remote.url()
         && let Some(slug) = parse_github_remote_url(url)
      {
         return Ok(RepoRemote { slug, remote_name });
      }
   }

   Err("No github.com remote found for this repository".to_string())
}

fn current_branch_remote(repository: &Repository) -> Option<String> {
   let head = repository.head().ok()?;
   if !head.is_branch() {
      return None;
   }

   let branch_name = head.shorthand()?;
   repository
      .config()
      .ok()?
      .get_string(&format!("branch.{branch_name}.remote"))
      .ok()
      .filter(|remote| !remote.trim().is_empty())
}

fn order_remote_names(remote_names: Vec<String>, upstream_remote: Option<&str>) -> Vec<String> {
   let mut ordered = Vec::with_capacity(remote_names.len());

   if let Some(upstream_remote) = upstream_remote
      && remote_names.iter().any(|name| name == upstream_remote)
   {
      ordered.push(upstream_remote.to_string());
   }

   if remote_names.iter().any(|name| name == "origin")
      && !ordered.iter().any(|name| name == "origin")
   {
      ordered.push("origin".to_string());
   }

   for remote_name in remote_names {
      if !ordered.iter().any(|name| name == &remote_name) {
         ordered.push(remote_name);
      }
   }

   ordered
}

fn parse_github_remote_url(url: &str) -> Option<RepoSlug> {
   let trimmed = url.trim().trim_end_matches(".git");
   let path = trimmed
      .strip_prefix("git@github.com:")
      .or_else(|| trimmed.strip_prefix("ssh://git@github.com/"))
      .or_else(|| trimmed.strip_prefix("https://github.com/"))
      .or_else(|| trimmed.strip_prefix("http://github.com/"))
      .or_else(|| trimmed.strip_prefix("https://www.github.com/"))
      .or_else(|| trimmed.strip_prefix("http://www.github.com/"))?;

   let mut parts = path.split('/');
   let owner = parts.next()?.to_string();
   let name = parts.next()?.to_string();
   if parts.next().is_some() || !is_valid_repo_part(&owner) || !is_valid_repo_part(&name) {
      return None;
   }

   Some(RepoSlug { owner, name })
}

fn is_valid_repo_part(value: &str) -> bool {
   !value.is_empty()
      && value
         .bytes()
         .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn repo_path(slug: &RepoSlug, suffix: &str) -> String {
   format!(
      "/repos/{}/{}/{}",
      slug.owner,
      slug.name,
      suffix.trim_start_matches('/')
   )
}

fn user_to_author(user: Option<RestUser>) -> PullRequestAuthor {
   user
      .map(|user| PullRequestAuthor {
         login: user.login,
         avatar_url: user.avatar_url,
      })
      .unwrap_or_default()
}

fn labels_from_rest(labels: Option<Vec<RestLabel>>) -> Vec<Label> {
   labels
      .unwrap_or_default()
      .into_iter()
      .map(|label| Label {
         name: label.name.unwrap_or_default(),
         color: label.color.unwrap_or_default(),
      })
      .collect()
}

fn users_to_authors(users: Option<Vec<RestUser>>) -> Vec<PullRequestAuthor> {
   users
      .unwrap_or_default()
      .into_iter()
      .map(|user| PullRequestAuthor {
         login: user.login,
         avatar_url: user.avatar_url,
      })
      .collect()
}

fn pr_from_rest(pr: RestPullRequest) -> PullRequest {
   PullRequest {
      number: pr.number,
      title: pr.title.unwrap_or_default(),
      state: pr.state.unwrap_or_default().to_uppercase(),
      author: user_to_author(pr.user),
      created_at: pr.created_at.unwrap_or_default(),
      updated_at: pr.updated_at.unwrap_or_default(),
      is_draft: pr.draft.unwrap_or_default(),
      review_decision: None,
      url: pr.html_url.unwrap_or_default(),
      head_ref: pr.head.and_then(|head| head.ref_name).unwrap_or_default(),
      base_ref: pr.base.and_then(|base| base.ref_name).unwrap_or_default(),
      additions: pr.additions.unwrap_or_default(),
      deletions: pr.deletions.unwrap_or_default(),
   }
}

fn pr_details_from_rest(
   pr: RestPullRequest,
   commits: Vec<serde_json::Value>,
   files: Vec<PullRequestFile>,
   review_requests: Vec<ReviewRequest>,
   status_checks: Vec<StatusCheck>,
) -> PullRequestDetails {
   PullRequestDetails {
      number: pr.number,
      title: pr.title.unwrap_or_default(),
      body: pr.body.unwrap_or_default(),
      state: pr.state.unwrap_or_default().to_uppercase(),
      author: user_to_author(pr.user),
      created_at: pr.created_at.unwrap_or_default(),
      updated_at: pr.updated_at.unwrap_or_default(),
      is_draft: pr.draft.unwrap_or_default(),
      review_decision: None,
      url: pr.html_url.unwrap_or_default(),
      head_ref: pr.head.and_then(|head| head.ref_name).unwrap_or_default(),
      base_ref: pr.base.and_then(|base| base.ref_name).unwrap_or_default(),
      additions: pr.additions.unwrap_or_default(),
      deletions: pr.deletions.unwrap_or_default(),
      changed_files: pr
         .changed_files
         .unwrap_or_else(|| i64::try_from(files.len()).unwrap_or_default()),
      commits,
      status_checks,
      linked_issues: Vec::new(),
      review_requests,
      merge_state_status: pr.mergeable_state,
      mergeable: pr.mergeable.map(|value| value.to_string()),
      labels: labels_from_rest(pr.labels),
      assignees: users_to_authors(pr.assignees),
   }
}

fn issue_from_rest(issue: RestIssue) -> IssueListItem {
   IssueListItem {
      number: issue.number,
      title: issue.title.unwrap_or_default(),
      state: issue.state.unwrap_or_default().to_uppercase(),
      author: user_to_author(issue.user),
      updated_at: issue.updated_at.unwrap_or_default(),
      url: issue.html_url.unwrap_or_default(),
      labels: labels_from_rest(issue.labels),
   }
}

fn issue_details_from_rest(issue: RestIssue, comments: Vec<IssueComment>) -> IssueDetails {
   IssueDetails {
      number: issue.number,
      title: issue.title.unwrap_or_default(),
      body: issue.body.unwrap_or_default(),
      state: issue.state.unwrap_or_default().to_uppercase(),
      author: user_to_author(issue.user),
      created_at: issue.created_at.unwrap_or_default(),
      updated_at: issue.updated_at.unwrap_or_default(),
      url: issue.html_url.unwrap_or_default(),
      labels: labels_from_rest(issue.labels),
      assignees: users_to_authors(issue.assignees),
      comments,
   }
}

fn pr_file_from_rest(file: RestPullRequestFile) -> PullRequestFile {
   PullRequestFile {
      path: file.filename.unwrap_or_default(),
      additions: file.additions.unwrap_or_default(),
      deletions: file.deletions.unwrap_or_default(),
   }
}

fn pr_comment_from_rest(comment: RestComment) -> PullRequestComment {
   PullRequestComment {
      author: user_to_author(comment.user),
      body: comment.body.unwrap_or_default(),
      created_at: comment.created_at.unwrap_or_default(),
   }
}

fn issue_comment_from_rest(comment: RestComment) -> IssueComment {
   IssueComment {
      author: user_to_author(comment.user),
      body: comment.body.unwrap_or_default(),
      created_at: comment.created_at.unwrap_or_default(),
   }
}

fn workflow_run_from_rest(run: RestWorkflowRun) -> WorkflowRunListItem {
   WorkflowRunListItem {
      database_id: run.id,
      display_title: run.display_title,
      name: run.name.clone(),
      workflow_name: run.name,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      updated_at: run.updated_at,
      url: run.html_url.unwrap_or_default(),
      head_branch: run.head_branch,
      head_sha: run.head_sha,
   }
}

fn workflow_details_from_rest(
   run: RestWorkflowRun,
   jobs: Vec<WorkflowRunJob>,
) -> WorkflowRunDetails {
   WorkflowRunDetails {
      database_id: run.id,
      name: run.name.clone(),
      display_title: run.display_title,
      workflow_name: run.name,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      created_at: run.created_at,
      updated_at: run.updated_at,
      url: run.html_url.unwrap_or_default(),
      head_branch: run.head_branch,
      head_sha: run.head_sha,
      jobs,
   }
}

fn workflow_job_from_rest(job: RestWorkflowJob) -> WorkflowRunJob {
   WorkflowRunJob {
      id: job.id,
      name: job.name.unwrap_or_default(),
      status: job.status,
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      url: job.html_url,
      runner_name: job.runner_name,
      labels: job.labels.unwrap_or_default(),
      steps: job
         .steps
         .unwrap_or_default()
         .into_iter()
         .map(|step| WorkflowRunStep {
            name: step.name.unwrap_or_default(),
            status: step.status,
            conclusion: step.conclusion,
            number: step.number,
         })
         .collect(),
   }
}

fn get_current_user(api: &GitHubApi) -> Result<String, String> {
   let user: RestUser = api.get_json("/user")?;
   Ok(user.login)
}

pub fn github_check_auth(github_token: Option<String>) -> Result<GitHubAuthStatus, String> {
   if github_token
      .as_deref()
      .is_none_or(|token| token.trim().is_empty())
   {
      return Ok(GitHubAuthStatus::NotAuthenticated);
   }

   let api = GitHubApi::new_authenticated(github_token)?;
   match get_current_user(&api) {
      Ok(_) => Ok(GitHubAuthStatus::Authenticated),
      Err(_) => Ok(GitHubAuthStatus::NotAuthenticated),
   }
}

pub fn github_list_prs(
   repo_path_value: String,
   filter: String,
   github_token: Option<String>,
) -> Result<Vec<PullRequest>, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;

   if filter == "review-requests" {
      let username = get_current_user(&api)?;
      let query = format!(
         "repo:{}/{} is:pr is:open review-requested:{username}",
         slug.owner, slug.name
      );
      let response: SearchIssuesResponse = api.get_json_with_query(
         "/search/issues",
         &[
            ("q", query),
            ("sort", "updated".to_string()),
            ("order", "desc".to_string()),
            ("per_page", "30".to_string()),
         ],
      )?;
      let prs = response
         .items
         .into_iter()
         .take(30)
         .map(|issue| {
            api.get_json::<RestPullRequest>(&repo_path(&slug, &format!("pulls/{}", issue.number)))
               .map(pr_from_rest)
               .unwrap_or_else(|_| issue_to_pr_placeholder(issue))
         })
         .collect();
      return Ok(prs);
   }

   let mut prs: Vec<RestPullRequest> = api.get_json_with_query(
      &repo_path(&slug, "pulls"),
      &[
         ("state", "open".to_string()),
         ("sort", "updated".to_string()),
         ("direction", "desc".to_string()),
         ("per_page", "50".to_string()),
      ],
   )?;

   if filter == "my-prs" {
      let username = get_current_user(&api)?;
      prs.retain(|pr| pr.user.as_ref().is_some_and(|user| user.login == username));
   }

   Ok(prs.into_iter().map(pr_from_rest).collect())
}

fn issue_to_pr_placeholder(issue: RestIssue) -> PullRequest {
   PullRequest {
      number: issue.number,
      title: issue.title.unwrap_or_default(),
      state: issue.state.unwrap_or_default().to_uppercase(),
      author: user_to_author(issue.user),
      created_at: String::new(),
      updated_at: issue.updated_at.unwrap_or_default(),
      is_draft: false,
      review_decision: None,
      url: issue.html_url.unwrap_or_default(),
      head_ref: String::new(),
      base_ref: String::new(),
      additions: 0,
      deletions: 0,
   }
}

fn commit_value_from_rest(value: serde_json::Value) -> serde_json::Value {
   let commit = value.get("commit").unwrap_or(&serde_json::Value::Null);
   let commit_author = commit.get("author").unwrap_or(&serde_json::Value::Null);
   let github_author = value.get("author").unwrap_or(&serde_json::Value::Null);

   serde_json::json!({
      "sha": value.get("sha").and_then(|value| value.as_str()).unwrap_or_default(),
      "message": commit.get("message").and_then(|value| value.as_str()).unwrap_or_default(),
      "authoredDate": commit_author.get("date").and_then(|value| value.as_str()).unwrap_or_default(),
      "url": value.get("html_url").and_then(|value| value.as_str()).unwrap_or_default(),
      "author": {
         "login": github_author
            .get("login")
            .and_then(|value| value.as_str())
            .or_else(|| commit_author.get("name").and_then(|value| value.as_str()))
            .unwrap_or_default(),
         "name": commit_author.get("name").and_then(|value| value.as_str()).unwrap_or_default(),
         "email": commit_author.get("email").and_then(|value| value.as_str()).unwrap_or_default(),
      }
   })
}

pub fn github_get_current_user(github_token: Option<String>) -> Result<String, String> {
   let api = GitHubApi::new_authenticated(github_token)?;
   get_current_user(&api)
}

pub fn github_list_issues(
   repo_path_value: String,
   github_token: Option<String>,
) -> Result<Vec<IssueListItem>, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   let issues: Vec<RestIssue> = api.get_json_with_query(
      &repo_path(&slug, "issues"),
      &[
         ("state", "open".to_string()),
         ("sort", "updated".to_string()),
         ("direction", "desc".to_string()),
         ("per_page", "50".to_string()),
      ],
   )?;

   Ok(issues
      .into_iter()
      .filter(|issue| issue.pull_request.is_none())
      .map(issue_from_rest)
      .collect())
}

pub fn github_list_workflow_runs(
   repo_path_value: String,
   github_token: Option<String>,
) -> Result<Vec<WorkflowRunListItem>, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   let response: WorkflowRunsResponse = api.get_json_with_query(
      &repo_path(&slug, "actions/runs"),
      &[("per_page", "50".to_string())],
   )?;

   Ok(response
      .workflow_runs
      .into_iter()
      .map(workflow_run_from_rest)
      .collect())
}

pub fn github_checkout_pr(
   repo_path_value: String,
   pr_number: i64,
   github_token: Option<String>,
) -> Result<(), String> {
   let resolved_remote = resolve_repo_remote(&repo_path_value)?;
   let slug = resolved_remote.slug;
   let api = GitHubApi::new_authenticated(github_token)?;
   let _: RestPullRequest = api.get_json(&repo_path(&slug, &format!("pulls/{pr_number}")))?;

   let branch = format!("pr-{pr_number}");
   if git_branch_exists(Path::new(&repo_path_value), &branch) {
      return run_git(Path::new(&repo_path_value), &["switch", &branch]);
   }

   let refspec = format!("refs/pull/{pr_number}/head:refs/heads/{branch}");
   run_git(
      Path::new(&repo_path_value),
      &["fetch", &resolved_remote.remote_name, &refspec],
   )?;
   run_git(Path::new(&repo_path_value), &["switch", &branch])
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<(), String> {
   let output = Command::new("git")
      .current_dir(repo_path)
      .args(args)
      .output()
      .map_err(|e| format!("Failed to execute git: {e}"))?;

   if output.status.success() {
      Ok(())
   } else {
      Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
   }
}

fn git_branch_exists(repo_path: &Path, branch: &str) -> bool {
   Command::new("git")
      .current_dir(repo_path)
      .args(["rev-parse", "--verify", &format!("refs/heads/{branch}")])
      .output()
      .map(|output| output.status.success())
      .unwrap_or(false)
}

pub fn github_get_pr_details(
   repo_path_value: String,
   pr_number: i64,
   github_token: Option<String>,
) -> Result<PullRequestDetails, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   let pr: RestPullRequest = api.get_json(&repo_path(&slug, &format!("pulls/{pr_number}")))?;
   let head_sha = pr.head.as_ref().and_then(|head| head.sha.clone());
   let commits: Vec<serde_json::Value> =
      api.get_json(&repo_path(&slug, &format!("pulls/{pr_number}/commits")))?;
   let commits = commits.into_iter().map(commit_value_from_rest).collect();
   let files = github_get_pr_files(repo_path_value.clone(), pr_number, api.github_token.clone())?;
   let review_requests = get_review_requests(&api, &slug, pr_number).unwrap_or_default();
   let status_checks = head_sha
      .as_deref()
      .map(|sha| get_status_checks(&api, &slug, sha).unwrap_or_default())
      .unwrap_or_default();

   Ok(pr_details_from_rest(
      pr,
      commits,
      files,
      review_requests,
      status_checks,
   ))
}

fn get_review_requests(
   api: &GitHubApi,
   slug: &RepoSlug,
   pr_number: i64,
) -> Result<Vec<ReviewRequest>, String> {
   let response: ReviewRequestsResponse = api.get_json(&repo_path(
      slug,
      &format!("pulls/{pr_number}/requested_reviewers"),
   ))?;
   let mut requests = response
      .users
      .unwrap_or_default()
      .into_iter()
      .map(|user| ReviewRequest {
         login: user.login,
         avatar_url: user.avatar_url,
      })
      .collect::<Vec<_>>();

   requests.extend(
      response
         .teams
         .unwrap_or_default()
         .into_iter()
         .filter_map(|team| {
            team.slug.map(|slug| ReviewRequest {
               login: slug,
               avatar_url: None,
            })
         }),
   );

   Ok(requests)
}

fn get_status_checks(
   api: &GitHubApi,
   slug: &RepoSlug,
   head_sha: &str,
) -> Result<Vec<StatusCheck>, String> {
   let response: CheckRunsResponse = api.get_json_with_query(
      &repo_path(slug, &format!("commits/{head_sha}/check-runs")),
      &[("per_page", "100".to_string())],
   )?;

   Ok(response
      .check_runs
      .into_iter()
      .map(|check| StatusCheck {
         id: check.id,
         name: check.name,
         status: check.status.map(|status| status.to_uppercase()),
         conclusion: check.conclusion.map(|conclusion| conclusion.to_uppercase()),
         workflow_name: check
            .check_suite
            .and_then(|suite| suite.app)
            .and_then(|app| app.name),
      })
      .collect())
}

pub fn github_get_pr_diff(
   repo_path_value: String,
   pr_number: i64,
   github_token: Option<String>,
) -> Result<String, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   api.get_text(
      &repo_path(&slug, &format!("pulls/{pr_number}")),
      "application/vnd.github.v3.diff",
   )
}

pub fn github_get_pr_files(
   repo_path_value: String,
   pr_number: i64,
   github_token: Option<String>,
) -> Result<Vec<PullRequestFile>, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   let files: Vec<RestPullRequestFile> = api.get_json_with_query(
      &repo_path(&slug, &format!("pulls/{pr_number}/files")),
      &[("per_page", "100".to_string())],
   )?;

   Ok(files.into_iter().map(pr_file_from_rest).collect())
}

pub fn github_get_pr_comments(
   repo_path_value: String,
   pr_number: i64,
   github_token: Option<String>,
) -> Result<Vec<PullRequestComment>, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   let comments: Vec<RestComment> = api.get_json_with_query(
      &repo_path(&slug, &format!("issues/{pr_number}/comments")),
      &[("per_page", "100".to_string())],
   )?;

   Ok(comments.into_iter().map(pr_comment_from_rest).collect())
}

pub fn github_get_issue_details(
   repo_path_value: String,
   issue_number: i64,
   github_token: Option<String>,
) -> Result<IssueDetails, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   let issue: RestIssue = api.get_json(&repo_path(&slug, &format!("issues/{issue_number}")))?;
   let comments: Vec<RestComment> = api.get_json_with_query(
      &repo_path(&slug, &format!("issues/{issue_number}/comments")),
      &[("per_page", "100".to_string())],
   )?;

   Ok(issue_details_from_rest(
      issue,
      comments.into_iter().map(issue_comment_from_rest).collect(),
   ))
}

pub fn github_get_workflow_run_details(
   repo_path_value: String,
   run_id: i64,
   github_token: Option<String>,
) -> Result<WorkflowRunDetails, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   let run: RestWorkflowRun = api.get_json(&repo_path(&slug, &format!("actions/runs/{run_id}")))?;
   let response: WorkflowJobsResponse = api.get_json_with_query(
      &repo_path(&slug, &format!("actions/runs/{run_id}/jobs")),
      &[("per_page", "100".to_string())],
   )?;

   Ok(workflow_details_from_rest(
      run,
      response
         .jobs
         .into_iter()
         .map(workflow_job_from_rest)
         .collect(),
   ))
}

pub fn github_get_workflow_job_logs(
   repo_path_value: String,
   job_id: i64,
   github_token: Option<String>,
) -> Result<String, String> {
   let slug = resolve_repo_slug(&repo_path_value)?;
   let api = GitHubApi::new_authenticated(github_token)?;
   api.get_text(
      &repo_path(&slug, &format!("actions/jobs/{job_id}/logs")),
      "text/plain",
   )
}

#[cfg(test)]
mod api_tests {
   use super::{GitHubApi, order_remote_names, parse_github_remote_url};

   #[test]
   fn parses_https_github_remote() {
      let slug = parse_github_remote_url("https://github.com/athasdev/athas.git").unwrap();

      assert_eq!(slug.owner, "athasdev");
      assert_eq!(slug.name, "athas");
   }

   #[test]
   fn parses_ssh_github_remote() {
      let slug = parse_github_remote_url("git@github.com:athasdev/athas.git").unwrap();

      assert_eq!(slug.owner, "athasdev");
      assert_eq!(slug.name, "athas");
   }

   #[test]
   fn rejects_non_github_remote() {
      assert!(parse_github_remote_url("https://example.com/athasdev/athas.git").is_none());
   }

   #[test]
   fn rejects_nested_or_invalid_remote_paths() {
      assert!(parse_github_remote_url("https://github.com/athasdev/athas/extra.git").is_none());
      assert!(parse_github_remote_url("https://github.com/athasdev/../athas.git").is_none());
   }

   #[test]
   fn rejects_missing_authenticated_token() {
      assert!(GitHubApi::new_authenticated(None).is_err());
      assert!(GitHubApi::new_authenticated(Some("   ".to_string())).is_err());
   }

   #[test]
   fn orders_upstream_remote_before_origin_and_other_remotes() {
      let ordered = order_remote_names(
         vec![
            "origin".to_string(),
            "fork".to_string(),
            "upstream".to_string(),
         ],
         Some("upstream"),
      );

      assert_eq!(ordered, vec!["upstream", "origin", "fork"]);
   }

   #[test]
   fn orders_origin_before_other_remotes_without_upstream() {
      let ordered = order_remote_names(
         vec![
            "fork".to_string(),
            "origin".to_string(),
            "upstream".to_string(),
         ],
         None,
      );

      assert_eq!(ordered, vec!["origin", "fork", "upstream"]);
   }
}
