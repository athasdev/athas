//! The GitHub commands end to end against `MockGitHub`: request shape, response mapping, and how
//! HTTP failures surface to the frontend.

use super::{
   delivery::*,
   mock_github::{MockGitHub, MockResponse, RecordedRequest},
   *,
};
use serde_json::{Value, json};

const REPO: &str = "github://octo/app";

fn token() -> Option<String> {
   Some("test-token".to_string())
}

fn query(request: &RecordedRequest) -> Vec<(String, String)> {
   reqwest::Url::parse(&format!("http://localhost/?{}", request.query))
      .unwrap()
      .query_pairs()
      .map(|(key, value)| (key.into_owned(), value.into_owned()))
      .collect()
}

fn query_value(request: &RecordedRequest, key: &str) -> Option<String> {
   query(request)
      .into_iter()
      .find(|(name, _)| name == key)
      .map(|(_, value)| value)
}

fn user(login: &str) -> Value {
   json!({ "login": login, "avatar_url": format!("https://avatars/{login}") })
}

fn rest_pr(number: i64, login: &str) -> Value {
   json!({
      "number": number,
      "title": format!("PR {number}"),
      "state": "open",
      "user": user(login),
      "created_at": "2026-01-01T00:00:00Z",
      "updated_at": "2026-01-02T00:00:00Z",
      "draft": true,
      "html_url": format!("https://github.com/octo/app/pull/{number}"),
      "head": { "ref": "feature", "sha": "abc123" },
      "base": { "ref": "main", "sha": "def456" },
      "additions": 10,
      "deletions": 2,
      "changed_files": 3,
      "body": "Body",
      "mergeable": true,
      "mergeable_state": "clean",
      "labels": [{ "name": "bug", "color": "ff0000" }],
      "assignees": [user("helper")]
   })
}

fn rest_issue(number: i64) -> Value {
   json!({
      "number": number,
      "title": format!("Issue {number}"),
      "state": "closed",
      "user": user("reporter"),
      "created_at": "2026-02-01T00:00:00Z",
      "updated_at": "2026-02-02T00:00:00Z",
      "html_url": format!("https://github.com/octo/app/issues/{number}"),
      "body": "Steps",
      "labels": [{ "name": "bug" }],
      "assignees": [user("fixer")],
      "state_reason": "completed",
      "locked": true,
      "active_lock_reason": "resolved",
      "milestone": { "number": 3, "title": "v1", "state": "open", "due_on": null },
      "type": { "id": 9, "name": "Bug", "description": "Something broke" },
      "closed_at": "2026-02-03T00:00:00Z",
      "closed_by": user("fixer")
   })
}

fn rest_comment(id: i64) -> Value {
   json!({
      "id": id,
      "user": user("commenter"),
      "body": format!("comment {id}"),
      "created_at": "2026-03-01T00:00:00Z",
      "updated_at": "2026-03-01T00:00:00Z",
      "html_url": format!("https://github.com/octo/app/issues/1#issuecomment-{id}")
   })
}

/// Routes every request `github_get_pr_details` makes after loading the pull request.
fn mock_pr_extras(mock: &MockGitHub, number: i64) {
   let base = format!("/repos/octo/app/pulls/{number}");
   mock
      .json(
         "GET",
         &format!("{base}/commits"),
         json!([{
            "sha": "abc123",
            "html_url": "https://github.com/octo/app/commit/abc123",
            "commit": {
               "message": "Fix things",
               "author": { "name": "Ada", "email": "ada@example.com", "date": "2026-01-01T00:00:00Z" }
            },
            "author": null
         }]),
      )
      .json(
         "GET",
         &format!("{base}/requested_reviewers"),
         json!({ "users": [user("reviewer")], "teams": [{ "slug": "core" }, { "slug": null }] }),
      )
      .json(
         "GET",
         "/repos/octo/app/commits/abc123/check-runs",
         json!({ "check_runs": [{
            "id": 5,
            "name": "test",
            "status": "completed",
            "conclusion": "success",
            "html_url": "https://github.com/octo/app/runs/5",
            "check_suite": { "app": { "name": "GitHub Actions" } }
         }]}),
      )
      .json(
         "GET",
         &format!("{base}/reviews"),
         json!([
            { "user": user("reviewer"), "state": "APPROVED", "body": "", "submitted_at": "t1" },
            { "user": user("other"), "state": "CHANGES_REQUESTED", "body": "Fix", "submitted_at": "t2" },
            { "user": user("other"), "state": "COMMENTED", "body": "nit", "submitted_at": "t3" },
            { "user": null, "state": "APPROVED" },
            { "user": user("ghost"), "state": "DISMISSED" }
         ]),
      );
}

#[test]
fn sends_github_headers_and_trims_the_token() {
   let mock = MockGitHub::start();
   mock.json("GET", "/user", json!({ "login": "octocat" }));

   assert_eq!(
      github_get_current_user(Some("  secret  ".to_string())).unwrap(),
      "octocat"
   );

   let request = mock.request("GET", "/user");
   assert_eq!(request.header("authorization"), Some("Bearer secret"));
   assert_eq!(request.header("accept"), Some(GITHUB_JSON_ACCEPT));
   assert_eq!(
      request.header("x-github-api-version"),
      Some(GITHUB_API_VERSION)
   );
   assert_eq!(request.header("user-agent"), Some(USER_AGENT_VALUE));
}

#[test]
fn checks_authentication_status() {
   let mock = MockGitHub::start();
   mock.on(
      "GET",
      "/user",
      vec![
         MockResponse::json(200, json!({ "login": "octocat" })),
         MockResponse::json(401, json!({ "message": "Bad credentials" })),
         MockResponse::json(503, json!({ "message": "Unavailable" })),
      ],
   );

   assert!(matches!(
      github_check_auth(None).unwrap(),
      GitHubAuthStatus::NotAuthenticated
   ));
   assert!(matches!(
      github_check_auth(Some(" ".to_string())).unwrap(),
      GitHubAuthStatus::NotAuthenticated
   ));
   assert!(mock.requests().is_empty(), "no token means no request");

   assert!(matches!(
      github_check_auth(token()).unwrap(),
      GitHubAuthStatus::Authenticated
   ));
   assert!(matches!(
      github_check_auth(token()).unwrap(),
      GitHubAuthStatus::NotAuthenticated
   ));
   let error = github_check_auth(token()).err().unwrap();
   assert!(error.contains("503"), "{error}");
   assert!(error.contains("Unavailable"), "{error}");
}

#[test]
fn describes_token_scopes_and_hides_rejected_tokens() {
   let mock = MockGitHub::start();
   mock.on(
      "GET",
      "/user",
      vec![
         MockResponse::json(200, json!({ "login": "octocat" }))
            .header("X-OAuth-Scopes", " repo, read:org "),
         MockResponse::json(200, json!({ "login": "fine-grained" })).header("X-OAuth-Scopes", ""),
         MockResponse::json(401, json!({ "message": "Bad credentials" })),
         MockResponse::json(500, json!({ "message": "Server error" })),
      ],
   );

   assert!(github_describe_token(None).unwrap().is_none());

   let identity = github_describe_token(token()).unwrap().unwrap();
   assert_eq!(identity.login, "octocat");
   assert_eq!(identity.scopes.as_deref(), Some("repo, read:org"));

   let identity = github_describe_token(token()).unwrap().unwrap();
   assert_eq!(identity.login, "fine-grained");
   assert!(identity.scopes.is_none());

   assert!(github_describe_token(token()).unwrap().is_none());
   assert!(
      github_describe_token(token())
         .err()
         .unwrap()
         .contains("Server error")
   );
}

#[test]
fn maps_http_failures_to_actionable_errors() {
   let mock = MockGitHub::start();
   mock.on(
      "GET",
      "/user",
      vec![
         MockResponse::json(401, json!({ "message": "Bad credentials" })),
         MockResponse::json(403, json!({ "message": "API rate limit exceeded" }))
            .header("x-ratelimit-remaining", "0")
            .header("x-ratelimit-reset", "1760000000"),
         MockResponse::json(403, json!({ "message": "API rate limit exceeded" }))
            .header("x-ratelimit-remaining", "0"),
         MockResponse::json(429, json!({ "message": "Too many" })).header("retry-after", "30"),
         MockResponse::json(
            403,
            json!({ "message": "You have exceeded a secondary rate limit" }),
         ),
         MockResponse::json(
            403,
            json!({ "message": "Abuse detection mechanism triggered" }),
         ),
         MockResponse::json(503, json!({})).header("retry-after", "5"),
         MockResponse::json(
            403,
            json!({ "message": "Resource not accessible by integration" }),
         ),
         MockResponse::text(500, "upstream exploded"),
         MockResponse::json(422, json!({ "message": "Validation Failed" })),
         MockResponse::text(200, "not json"),
         MockResponse::json(200, json!({ "unexpected": true })),
      ],
   );

   let expected = [
      "GitHub authentication failed. Connect GitHub in Athas and try again.",
      "GitHub API rate limit reached. Try again after the limit resets. Reset epoch: 1760000000.",
      "GitHub API rate limit reached. Try again after the limit resets.",
      "GitHub API temporarily rate limited the request. Try again shortly. Retry after 30 seconds.",
      "GitHub API temporarily rate limited the request. Try again shortly.",
      "GitHub API temporarily rate limited the request. Try again shortly.",
      "GitHub API temporarily rate limited the request. Try again shortly. Retry after 5 seconds.",
      "GitHub API request failed (403 Forbidden): Resource not accessible by integration",
      "GitHub API request failed (500 Internal Server Error): upstream exploded",
      "GitHub API request failed (422 Unprocessable Entity): Validation Failed",
   ];
   for message in expected {
      assert_eq!(github_get_current_user(token()).unwrap_err(), message);
   }
   for _ in 0..2 {
      let error = github_get_current_user(token()).unwrap_err();
      assert!(
         error.starts_with("Failed to parse GitHub API response"),
         "{error}"
      );
   }
}

#[test]
fn reports_unreachable_servers_and_missing_accounts() {
   let mock = MockGitHub::start();
   let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
   let address = closed.local_addr().unwrap();
   drop(closed);
   let mut api = GitHubApi::new(token()).unwrap();
   api.api_base = format!("http://{address}");

   let error = get_current_user(&api).unwrap_err();
   assert!(error.starts_with("Failed to call GitHub API"), "{error}");

   for error in [
      github_get_current_user(None).unwrap_err(),
      github_list_prs(REPO.into(), "all".into(), None).unwrap_err(),
      github_list_releases(REPO.into(), 1, Some("  ".into())).unwrap_err(),
   ] {
      assert!(error.starts_with("GitHub account required"), "{error}");
   }
   assert_eq!(
      github_list_issues("github://bad".into(), "open".into(), token()).unwrap_err(),
      "Repository is not a Git repository"
   );
   assert!(mock.requests().is_empty());
}

#[test]
fn lists_pull_requests_by_filter() {
   let mock = MockGitHub::start();
   mock
      .json(
         "GET",
         "/repos/octo/app/pulls",
         json!([rest_pr(1, "octocat"), rest_pr(2, "someone"), { "number": 3 }]),
      )
      .json("GET", "/user", json!({ "login": "octocat" }));

   let all = github_list_prs(REPO.into(), "all".into(), token()).unwrap();
   assert_eq!(all.len(), 3);
   assert_eq!(all[0].state, "OPEN");
   assert_eq!(all[0].author.login, "octocat");
   assert!(all[0].is_draft);
   assert_eq!(
      (all[0].head_ref.as_str(), all[0].base_ref.as_str()),
      ("feature", "main")
   );
   assert_eq!((all[0].additions, all[0].deletions), (10, 2));
   assert_eq!(all[2].author.login, "unknown");
   assert_eq!(all[2].title, "");

   let request = mock.request("GET", "/repos/octo/app/pulls");
   assert_eq!(
      query(&request),
      vec![
         ("state".to_string(), "open".to_string()),
         ("sort".to_string(), "updated".to_string()),
         ("direction".to_string(), "desc".to_string()),
         ("per_page".to_string(), "50".to_string()),
      ]
   );

   let mine = github_list_prs(REPO.into(), "my-prs".into(), token()).unwrap();
   assert_eq!(mine.iter().map(|pr| pr.number).collect::<Vec<_>>(), vec![1]);
}

#[test]
fn review_request_filter_searches_and_falls_back_to_issue_data() {
   let mock = MockGitHub::start();
   mock
      .json("GET", "/user", json!({ "login": "octocat" }))
      .json(
         "GET",
         "/search/issues",
         json!({ "items": [
            { "number": 7, "title": "Seven", "state": "open" },
            { "number": 8, "title": "Eight", "state": "open", "updated_at": "u8",
              "html_url": "https://github.com/octo/app/pull/8", "user": user("dev") }
         ]}),
      )
      .json("GET", "/repos/octo/app/pulls/7", rest_pr(7, "dev"));

   let prs = github_list_prs(REPO.into(), "review-requests".into(), token()).unwrap();

   assert_eq!(prs.len(), 2);
   assert_eq!(
      prs[0].head_ref, "feature",
      "full pull request data when available"
   );
   assert_eq!(prs[1].number, 8);
   assert_eq!(prs[1].state, "OPEN");
   assert_eq!(
      prs[1].head_ref, "",
      "placeholder when the pull request cannot load"
   );
   assert_eq!(prs[1].url, "https://github.com/octo/app/pull/8");
   assert_eq!(prs[1].author.login, "dev");

   let search = mock.request("GET", "/search/issues");
   assert_eq!(
      query_value(&search, "q").as_deref(),
      Some("repo:octo/app is:pr is:open review-requested:octocat")
   );
   assert_eq!(query_value(&search, "per_page").as_deref(), Some("30"));
}

#[test]
fn lists_issues_without_pull_requests_and_normalizes_state() {
   let mock = MockGitHub::start();
   mock.json(
      "GET",
      "/repos/octo/app/issues",
      json!([
         rest_issue(1),
         { "number": 2, "pull_request": { "url": "x" } },
         { "number": 3, "labels": [{ "name": null, "color": null }] }
      ]),
   );

   let issues = github_list_issues(REPO.into(), "closed".into(), token()).unwrap();
   assert_eq!(
      issues.iter().map(|issue| issue.number).collect::<Vec<_>>(),
      vec![1, 3]
   );
   assert_eq!(issues[0].state, "CLOSED");
   assert_eq!(issues[0].labels[0].name, "bug");
   assert_eq!(issues[1].labels[0].name, "");

   for (requested, sent) in [("all", "all"), ("open", "open"), ("weird", "open")] {
      github_list_issues(REPO.into(), requested.into(), token()).unwrap();
      let request = mock.request("GET", "/repos/octo/app/issues");
      assert_eq!(query_value(&request, "state").as_deref(), Some(sent));
   }
}

#[test]
fn loads_issue_details_with_every_comment_page() {
   let mock = MockGitHub::start();
   let first_page: Vec<Value> = (1..=100).map(rest_comment).collect();
   mock
      .json("GET", "/repos/octo/app/issues/1", rest_issue(1))
      .json(
         "GET",
         "/repos/octo/app/issues/1/comments?per_page=100&page=1",
         json!(first_page),
      )
      .json(
         "GET",
         "/repos/octo/app/issues/1/comments?per_page=100&page=2",
         json!([rest_comment(101)]),
      );

   let details = github_get_issue_details(REPO.into(), 1, token()).unwrap();

   assert_eq!(details.comments.len(), 101);
   assert_eq!(details.comments[100].body, "comment 101");
   assert_eq!(details.state, "CLOSED");
   assert_eq!(details.state_reason.as_deref(), Some("completed"));
   assert!(details.locked);
   assert_eq!(details.active_lock_reason.as_deref(), Some("resolved"));
   assert_eq!(details.milestone.as_ref().unwrap().title, "v1");
   assert_eq!(details.issue_type.as_ref().unwrap().name, "Bug");
   assert_eq!(details.closed_by.as_ref().unwrap().login, "fixer");
   assert_eq!(details.assignees[0].login, "fixer");
}

#[test]
fn creates_and_updates_issues() {
   let mock = MockGitHub::start();
   mock
      .json("POST", "/repos/octo/app/issues", rest_issue(5))
      .json("PATCH", "/repos/octo/app/issues/5", rest_issue(5))
      .json("GET", "/repos/octo/app/issues/5", rest_issue(5))
      .json("GET", "/repos/octo/app/issues/5/comments", json!([]));

   for result in [
      github_create_issue(
         REPO.into(),
         "  ".into(),
         String::new(),
         vec![],
         vec![],
         None,
         None,
         token(),
      )
      .map(drop),
      github_update_issue(
         REPO.into(),
         5,
         String::new(),
         String::new(),
         vec![],
         vec![],
         None,
         None,
         token(),
      )
      .map(drop),
   ] {
      assert_eq!(result.unwrap_err(), "Issue title is required.");
   }
   assert!(mock.requests().is_empty());

   let created = github_create_issue(
      REPO.into(),
      "  New bug  ".into(),
      "  Details  ".into(),
      vec!["bug".into()],
      vec!["octocat".into()],
      Some(3),
      Some("Bug".into()),
      token(),
   )
   .unwrap();
   assert_eq!(created.number, 5);
   assert_eq!(
      mock.request("POST", "/repos/octo/app/issues").json(),
      json!({
         "title": "New bug",
         "body": "Details",
         "labels": ["bug"],
         "assignees": ["octocat"],
         "milestone": 3,
         "type": "Bug"
      })
   );

   github_create_issue(
      REPO.into(),
      "Plain".into(),
      String::new(),
      vec![],
      vec![],
      None,
      Some(" ".into()),
      token(),
   )
   .unwrap();
   let body = mock.request("POST", "/repos/octo/app/issues").json();
   assert!(body.get("milestone").is_none());
   assert!(body.get("type").is_none());

   let updated = github_update_issue(
      REPO.into(),
      5,
      "Renamed".into(),
      "Body".into(),
      vec![],
      vec![],
      None,
      Some("".into()),
      token(),
   )
   .unwrap();
   assert_eq!(updated.number, 5);
   assert_eq!(
      mock.request("PATCH", "/repos/octo/app/issues/5").json(),
      json!({
         "title": "Renamed",
         "body": "Body",
         "labels": [],
         "assignees": [],
         "milestone": null,
         "type": null
      })
   );
}

#[test]
fn changes_issue_state_with_valid_reasons_only() {
   let mock = MockGitHub::start();
   mock
      .json("PATCH", "/repos/octo/app/issues/4", rest_issue(4))
      .json("GET", "/repos/octo/app/issues/4", rest_issue(4))
      .json("GET", "/repos/octo/app/issues/4/comments", json!([]));

   assert_eq!(
      github_update_issue_state(REPO.into(), 4, "merged".into(), None, token()).unwrap_err(),
      "Issue state must be open or closed."
   );
   for (state, reason) in [("open", "completed"), ("closed", "reopened")] {
      assert_eq!(
         github_update_issue_state(REPO.into(), 4, state.into(), Some(reason.into()), token())
            .unwrap_err(),
         "Unsupported issue state reason."
      );
   }
   assert!(mock.requests().is_empty());

   github_update_issue_state(
      REPO.into(),
      4,
      "CLOSED".into(),
      Some("Not_Planned".into()),
      token(),
   )
   .unwrap();
   assert_eq!(
      mock.request("PATCH", "/repos/octo/app/issues/4").json(),
      json!({ "state": "closed", "state_reason": "not_planned" })
   );

   github_update_issue_state(REPO.into(), 4, "open".into(), None, token()).unwrap();
   assert_eq!(
      mock.request("PATCH", "/repos/octo/app/issues/4").json(),
      json!({ "state": "open", "state_reason": null })
   );
}

#[test]
fn manages_issue_comments_and_locks() {
   let mock = MockGitHub::start();
   mock
      .json(
         "POST",
         "/repos/octo/app/issues/1/comments",
         rest_comment(11),
      )
      .json(
         "PATCH",
         "/repos/octo/app/issues/comments/11",
         rest_comment(11),
      )
      .on(
         "DELETE",
         "/repos/octo/app/issues/comments/11",
         vec![MockResponse::empty(204)],
      )
      .on(
         "PUT",
         "/repos/octo/app/issues/1/lock",
         vec![MockResponse::empty(204)],
      )
      .on(
         "DELETE",
         "/repos/octo/app/issues/1/lock",
         vec![
            MockResponse::empty(204),
            MockResponse::json(404, json!({ "message": "Not locked" })),
         ],
      );

   for error in [
      github_add_issue_comment(REPO.into(), 1, " ".into(), token()).unwrap_err(),
      github_update_issue_comment(REPO.into(), 11, String::new(), token()).unwrap_err(),
   ] {
      assert_eq!(error, "Comment body is required.");
   }
   assert_eq!(
      github_lock_issue(REPO.into(), 1, Some("because".into()), token()).unwrap_err(),
      "Unsupported issue lock reason."
   );
   assert!(mock.requests().is_empty());

   let comment = github_add_issue_comment(REPO.into(), 1, " Hello ".into(), token()).unwrap();
   assert_eq!(comment.id, 11);
   assert_eq!(comment.author.login, "commenter");
   assert_eq!(
      mock
         .request("POST", "/repos/octo/app/issues/1/comments")
         .json(),
      json!({ "body": "Hello" })
   );

   github_update_issue_comment(REPO.into(), 11, "Edited".into(), token()).unwrap();
   assert_eq!(
      mock
         .request("PATCH", "/repos/octo/app/issues/comments/11")
         .json(),
      json!({ "body": "Edited" })
   );
   github_delete_issue_comment(REPO.into(), 11, token()).unwrap();

   github_lock_issue(REPO.into(), 1, Some("Too Heated".into()), token()).unwrap();
   assert_eq!(
      mock.request("PUT", "/repos/octo/app/issues/1/lock").json(),
      json!({ "lock_reason": "too heated" })
   );
   github_lock_issue(REPO.into(), 1, None, token()).unwrap();
   assert_eq!(
      mock.request("PUT", "/repos/octo/app/issues/1/lock").json(),
      json!({ "lock_reason": null })
   );

   github_unlock_issue(REPO.into(), 1, token()).unwrap();
   assert!(
      github_unlock_issue(REPO.into(), 1, token())
         .unwrap_err()
         .contains("Not locked")
   );
}

#[test]
fn lists_repository_metadata() {
   let mock = MockGitHub::start();
   mock
      .json(
         "GET",
         "/repos/octo/app/labels",
         json!([{ "name": "bug", "color": "f00" }]),
      )
      .json(
         "GET",
         "/repos/octo/app/milestones",
         json!([{ "number": 1, "title": "v1", "state": "closed", "due_on": "2026-12-01" }]),
      )
      .json(
         "GET",
         "/repos/octo/app/issue-types",
         json!([{ "id": 4, "name": "Task", "description": null }]),
      )
      .json(
         "GET",
         "/repos/octo/app/pulls/2/files",
         json!([{ "filename": "src/main.rs", "additions": 3, "deletions": 1 }, {}]),
      )
      .json(
         "GET",
         "/repos/octo/app/issues/2/comments",
         json!([rest_comment(1), {}]),
      );

   let labels = github_list_labels(REPO.into(), token()).unwrap();
   assert_eq!(
      (labels[0].name.as_str(), labels[0].color.as_str()),
      ("bug", "f00")
   );

   let milestones = github_list_milestones(REPO.into(), token()).unwrap();
   assert_eq!(milestones[0].due_on.as_deref(), Some("2026-12-01"));
   assert_eq!(
      query_value(&mock.request("GET", "/repos/octo/app/milestones"), "state").as_deref(),
      Some("all")
   );

   let issue_types = github_list_issue_types(REPO.into(), token()).unwrap();
   assert_eq!(
      (issue_types[0].id, issue_types[0].name.as_str()),
      (4, "Task")
   );

   let files = github_get_pr_files(REPO.into(), 2, token()).unwrap();
   assert_eq!(files[0].path, "src/main.rs");
   assert_eq!((files[1].path.as_str(), files[1].additions), ("", 0));

   let comments = github_get_pr_comments(REPO.into(), 2, token()).unwrap();
   assert_eq!(comments[0].body, "comment 1");
   assert_eq!(comments[1].author.login, "unknown");
}

#[test]
fn creates_pull_requests_and_applies_labels_afterwards() {
   let mock = MockGitHub::start();
   mock
      .json("POST", "/repos/octo/app/pulls", rest_pr(12, "octocat"))
      .json("PATCH", "/repos/octo/app/issues/12", rest_issue(12));

   let cases = [
      (" ", "feature", "main", "Pull request title is required."),
      (
         "Title",
         " ",
         "main",
         "Pull request head branch is required.",
      ),
      (
         "Title",
         "feature",
         "",
         "Pull request base branch is required.",
      ),
   ];
   for (title, head, base, message) in cases {
      let error = github_create_pull_request(
         REPO.into(),
         title.into(),
         String::new(),
         head.into(),
         base.into(),
         false,
         vec![],
         vec![],
         token(),
      )
      .unwrap_err();
      assert_eq!(error, message);
   }

   let pr = github_create_pull_request(
      REPO.into(),
      " Add feature ".into(),
      " Body ".into(),
      " feature ".into(),
      " main ".into(),
      true,
      vec![],
      vec![],
      token(),
   )
   .unwrap();
   assert_eq!(pr.number, 12);
   assert_eq!(
      mock.request("POST", "/repos/octo/app/pulls").json(),
      json!({
         "title": "Add feature",
         "body": "Body",
         "head": "feature",
         "base": "main",
         "draft": true,
         "maintainer_can_modify": true
      })
   );
   assert!(
      !mock
         .paths()
         .contains(&"PATCH /repos/octo/app/issues/12".to_string()),
      "no follow-up edit without labels or assignees"
   );

   github_create_pull_request(
      REPO.into(),
      "Labeled".into(),
      String::new(),
      "feature".into(),
      "main".into(),
      false,
      vec!["bug".into()],
      vec!["octocat".into()],
      token(),
   )
   .unwrap();
   assert_eq!(
      mock.request("PATCH", "/repos/octo/app/issues/12").json(),
      json!({ "labels": ["bug"], "assignees": ["octocat"] })
   );
}

#[test]
fn loads_pull_request_details_with_reviews_and_checks() {
   let mock = MockGitHub::start();
   mock.json("GET", "/repos/octo/app/pulls/1", rest_pr(1, "octocat"));
   mock_pr_extras(&mock, 1);

   let details = github_get_pr_details(REPO.into(), 1, token()).unwrap();

   assert_eq!(details.body, "Body");
   assert_eq!(details.changed_files, 3);
   assert_eq!(details.mergeable.as_deref(), Some("true"));
   assert_eq!(details.merge_state_status.as_deref(), Some("clean"));
   assert_eq!(details.labels[0].name, "bug");
   assert_eq!(details.assignees[0].login, "helper");
   assert_eq!(
      details.review_decision.as_deref(),
      Some("CHANGES_REQUESTED")
   );
   assert_eq!(
      details
         .review_requests
         .iter()
         .map(|request| request.login.as_str())
         .collect::<Vec<_>>(),
      vec!["reviewer", "core"]
   );
   assert_eq!(details.reviews.len(), 2);
   assert_eq!(details.reviews[1].state, "CHANGES_REQUESTED");
   assert_eq!(
      details.status_checks[0].status.as_deref(),
      Some("COMPLETED")
   );
   assert_eq!(
      details.status_checks[0].conclusion.as_deref(),
      Some("SUCCESS")
   );
   assert_eq!(
      details.status_checks[0].workflow_name.as_deref(),
      Some("GitHub Actions")
   );
   assert_eq!(
      details.commits[0],
      json!({
         "sha": "abc123",
         "message": "Fix things",
         "authoredDate": "2026-01-01T00:00:00Z",
         "url": "https://github.com/octo/app/commit/abc123",
         "author": { "login": "Ada", "name": "Ada", "email": "ada@example.com" }
      })
   );
   assert_eq!(
      query_value(
         &mock.request("GET", "/repos/octo/app/pulls/1/reviews"),
         "per_page"
      )
      .as_deref(),
      Some("100")
   );
}

#[test]
fn pull_request_details_tolerate_missing_review_data() {
   let mock = MockGitHub::start();
   let mut pr = rest_pr(2, "octocat");
   pr["head"] = json!({ "ref": "feature" });
   mock
      .json("GET", "/repos/octo/app/pulls/2", pr)
      .json("GET", "/repos/octo/app/pulls/2/commits", json!([{}]))
      .on(
         "GET",
         "/repos/octo/app/pulls/2/requested_reviewers",
         vec![MockResponse::json(500, json!({ "message": "boom" }))],
      );

   let details = github_get_pr_details(REPO.into(), 2, token()).unwrap();

   assert!(details.review_requests.is_empty());
   assert!(details.reviews.is_empty());
   assert!(details.status_checks.is_empty());
   assert!(details.review_decision.is_none());
   assert_eq!(details.commits[0]["sha"], "");
   assert!(
      !mock.paths().iter().any(|path| path.contains("check-runs")),
      "no head sha means no check lookup"
   );

   mock.on(
      "GET",
      "/repos/octo/app/pulls/2/commits",
      vec![MockResponse::json(
         500,
         json!({ "message": "commits failed" }),
      )],
   );
   assert!(
      github_get_pr_details(REPO.into(), 2, token())
         .unwrap_err()
         .contains("commits failed")
   );
}

#[test]
fn updates_merges_and_closes_pull_requests() {
   let mock = MockGitHub::start();
   let mut closed = rest_pr(1, "octocat");
   closed["state"] = json!("closed");
   mock
      .json("PATCH", "/repos/octo/app/pulls/1", rest_pr(1, "octocat"))
      .json("PATCH", "/repos/octo/app/issues/1", rest_issue(1))
      .json("GET", "/repos/octo/app/pulls/1", rest_pr(1, "octocat"))
      .json(
         "PUT",
         "/repos/octo/app/pulls/1/merge",
         json!({ "merged": true }),
      );
   mock_pr_extras(&mock, 1);

   assert_eq!(
      github_update_pull_request(
         REPO.into(),
         1,
         " ".into(),
         String::new(),
         vec![],
         vec![],
         token()
      )
      .unwrap_err(),
      "Pull request title is required."
   );

   let details = github_update_pull_request(
      REPO.into(),
      1,
      " New title ".into(),
      " New body ".into(),
      vec!["bug".into()],
      vec![],
      token(),
   )
   .unwrap();
   assert_eq!(details.number, 1);
   assert_eq!(
      mock.request("PATCH", "/repos/octo/app/pulls/1").json(),
      json!({ "title": "New title", "body": "New body" })
   );
   assert_eq!(
      mock.request("PATCH", "/repos/octo/app/issues/1").json(),
      json!({ "labels": ["bug"], "assignees": [] })
   );

   for (requested, sent) in [
      ("merge", "merge"),
      ("rebase", "rebase"),
      ("other", "squash"),
   ] {
      github_merge_pull_request(REPO.into(), 1, requested.into(), token()).unwrap();
      assert_eq!(
         mock.request("PUT", "/repos/octo/app/pulls/1/merge").json(),
         json!({ "merge_method": sent })
      );
   }

   mock.json("PATCH", "/repos/octo/app/pulls/1", closed);
   let details = github_close_pull_request(REPO.into(), 1, token()).unwrap();
   assert_eq!(details.state, "CLOSED");
   assert_eq!(
      mock.request("PATCH", "/repos/octo/app/pulls/1").json(),
      json!({ "state": "closed" })
   );
}

#[test]
fn submits_reviews_and_comments_on_pull_requests() {
   let mock = MockGitHub::start();
   mock
      .json(
         "POST",
         "/repos/octo/app/pulls/1/reviews",
         json!({ "id": 1 }),
      )
      .json("POST", "/repos/octo/app/issues/1/comments", rest_comment(3));

   assert_eq!(
      github_submit_pr_review(REPO.into(), 1, "DISMISS".into(), "x".into(), token()).unwrap_err(),
      "Unsupported pull request review event."
   );
   for event in ["REQUEST_CHANGES", "COMMENT"] {
      assert_eq!(
         github_submit_pr_review(REPO.into(), 1, event.into(), " ".into(), token()).unwrap_err(),
         "Review body is required."
      );
   }
   assert_eq!(
      github_add_pr_comment(REPO.into(), 1, String::new(), token()).unwrap_err(),
      "Comment body is required."
   );
   assert!(mock.requests().is_empty());

   github_submit_pr_review(REPO.into(), 1, "APPROVE".into(), " ".into(), token()).unwrap();
   assert_eq!(
      mock
         .request("POST", "/repos/octo/app/pulls/1/reviews")
         .json(),
      json!({ "event": "APPROVE" })
   );
   github_submit_pr_review(
      REPO.into(),
      1,
      "REQUEST_CHANGES".into(),
      " Please fix ".into(),
      token(),
   )
   .unwrap();
   assert_eq!(
      mock
         .request("POST", "/repos/octo/app/pulls/1/reviews")
         .json(),
      json!({ "event": "REQUEST_CHANGES", "body": "Please fix" })
   );

   let comment = github_add_pr_comment(REPO.into(), 1, " Looks good ".into(), token()).unwrap();
   assert_eq!(comment.id, 3);
   assert_eq!(
      mock
         .request("POST", "/repos/octo/app/issues/1/comments")
         .json(),
      json!({ "body": "Looks good" })
   );
}

#[test]
fn fetches_diffs_and_job_logs_as_text() {
   let mock = MockGitHub::start();
   mock
      .on(
         "GET",
         "/repos/octo/app/pulls/1",
         vec![MockResponse::text(200, "diff --git a/x b/x\n")],
      )
      .on(
         "GET",
         "/repos/octo/app/actions/jobs/9/logs",
         vec![
            MockResponse::text(200, "step 1\nstep 2\n"),
            MockResponse::text(
               404,
               "<?xml version=\"1.0\"?><Error><Code>BlobNotFound</Code></Error>",
            ),
         ],
      );

   assert_eq!(
      github_get_pr_diff(REPO.into(), 1, token()).unwrap(),
      "diff --git a/x b/x\n"
   );
   assert_eq!(
      mock
         .request("GET", "/repos/octo/app/pulls/1")
         .header("accept"),
      Some("application/vnd.github.v3.diff")
   );

   assert_eq!(
      github_get_workflow_job_logs(REPO.into(), 9, token()).unwrap(),
      "step 1\nstep 2\n"
   );
   assert_eq!(
      github_get_workflow_job_logs(REPO.into(), 9, token()).unwrap_err(),
      format!("GitHub API request failed (404 Not Found): {WORKFLOW_JOB_LOGS_UNAVAILABLE_MESSAGE}")
   );
}

#[test]
fn lists_and_controls_workflow_runs() {
   let mock = MockGitHub::start();
   let run = json!({
      "id": 77,
      "check_suite_id": 700,
      "name": "CI",
      "display_title": "Fix build",
      "event": "push",
      "status": "completed",
      "conclusion": "failure",
      "updated_at": "2026-01-01T00:00:00Z",
      "run_number": 12,
      "run_attempt": 2,
      "workflow_id": 5,
      "actor": user("octocat"),
      "head_commit": { "message": "\n" },
      "html_url": "https://github.com/octo/app/actions/runs/77",
      "head_branch": "main",
      "head_sha": "abc"
   });
   mock
      .json(
         "GET",
         "/repos/octo/app/actions/runs",
         json!({ "workflow_runs": [run] }),
      )
      .json("GET", "/repos/octo/app/actions/runs/77", run.clone())
      .json(
         "GET",
         "/repos/octo/app/actions/runs/77/jobs",
         json!({ "jobs": [{
            "id": 1,
            "name": "build",
            "status": "completed",
            "conclusion": "failure",
            "runner_name": "ubuntu",
            "labels": ["ubuntu-latest"],
            "steps": [{ "name": "Checkout", "status": "completed", "conclusion": "success", "number": 1 }]
         }, {}]}),
      )
      .json(
         "GET",
         "/repos/octo/app/actions/workflows",
         json!({ "workflows": [{ "id": 5, "name": "CI", "path": ".github/workflows/ci.yml", "state": "active" }] }),
      )
      .on(
         "POST",
         "/repos/octo/app/actions/workflows/5/dispatches",
         vec![MockResponse::empty(204)],
      )
      .on(
         "POST",
         "/repos/octo/app/actions/runs/77/rerun",
         vec![MockResponse::empty(201)],
      )
      .on(
         "POST",
         "/repos/octo/app/actions/runs/77/rerun-failed-jobs",
         vec![MockResponse::empty(201)],
      )
      .on(
         "POST",
         "/repos/octo/app/actions/runs/77/cancel",
         vec![MockResponse::json(409, json!({ "message": "Cannot cancel a completed run" }))],
      );

   let runs = github_list_workflow_runs(REPO.into(), token()).unwrap();
   assert_eq!(runs[0].database_id, 77);
   assert_eq!(runs[0].workflow_name.as_deref(), Some("CI"));
   assert_eq!(
      runs[0].head_commit_message, None,
      "blank commit summaries are dropped"
   );

   let details = github_get_workflow_run_details(REPO.into(), 77, token()).unwrap();
   assert_eq!(details.actor.as_ref().unwrap().login, "octocat");
   assert_eq!(details.jobs.len(), 2);
   assert_eq!(details.jobs[0].labels, vec!["ubuntu-latest"]);
   assert_eq!(details.jobs[0].steps[0].name, "Checkout");
   assert_eq!(details.jobs[1].name, "");
   assert!(details.jobs[1].steps.is_empty());

   let workflows = github_list_workflows(REPO.into(), token()).unwrap();
   assert_eq!(workflows[0].path, ".github/workflows/ci.yml");

   assert_eq!(
      github_dispatch_workflow(REPO.into(), 0, "main".into(), token()).unwrap_err(),
      "Workflow is required."
   );
   assert_eq!(
      github_dispatch_workflow(REPO.into(), 5, " ".into(), token()).unwrap_err(),
      "Workflow ref is required."
   );
   github_dispatch_workflow(REPO.into(), 5, " main ".into(), token()).unwrap();
   assert_eq!(
      mock
         .request("POST", "/repos/octo/app/actions/workflows/5/dispatches")
         .json(),
      json!({ "ref": "main" })
   );

   github_rerun_workflow_run(REPO.into(), 77, false, token()).unwrap();
   github_rerun_workflow_run(REPO.into(), 77, true, token()).unwrap();
   assert!(
      github_cancel_workflow_run(REPO.into(), 77, token())
         .unwrap_err()
         .contains("Cannot cancel a completed run")
   );
   assert!(mock.paths().ends_with(&[
      "POST /repos/octo/app/actions/runs/77/rerun".to_string(),
      "POST /repos/octo/app/actions/runs/77/rerun-failed-jobs".to_string(),
      "POST /repos/octo/app/actions/runs/77/cancel".to_string(),
   ]));
}

#[test]
fn lists_notifications_with_web_urls() {
   let mock = MockGitHub::start();
   mock.json(
      "GET",
      "/notifications",
      json!([
         {
            "id": "1",
            "unread": true,
            "reason": "review_requested",
            "updated_at": "2026-01-01T00:00:00Z",
            "repository": { "full_name": "octo/app", "html_url": "https://github.com/octo/app" },
            "subject": {
               "title": "Fix",
               "url": "https://api.github.com/repos/octo/app/pulls/4",
               "type": "PullRequest"
            }
         },
         {
            "id": "2",
            "repository": { "full_name": "octo/app", "html_url": "https://github.com/octo/app" },
            "subject": { "title": "Release", "url": null, "type": "Release" }
         }
      ]),
   );

   let notifications = github_list_notifications(token()).unwrap();

   assert_eq!(notifications[0].url, "https://github.com/octo/app/pull/4");
   assert!(notifications[0].unread);
   assert_eq!(notifications[0].subject_type, "PullRequest");
   assert_eq!(notifications[1].url, "https://github.com/octo/app");
   assert!(!notifications[1].unread);
   assert_eq!(
      query(&mock.request("GET", "/notifications")),
      vec![
         ("all".to_string(), "false".to_string()),
         ("participating".to_string(), "false".to_string()),
         ("per_page".to_string(), "50".to_string()),
      ]
   );
}

#[test]
fn resolves_workflow_runs_for_notifications() {
   let mock = MockGitHub::start();
   mock.json(
      "GET",
      "/repos/octo/app/actions/runs",
      json!({ "workflow_runs": [
         { "id": 1, "check_suite_id": 10, "name": "CI", "head_branch": "main", "conclusion": "success" },
         { "id": 2, "check_suite_id": 20, "name": "CI", "head_branch": "main", "status": "in progress" }
      ]}),
   );

   assert_eq!(
      github_resolve_notification_workflow_run(
         "not a repo".into(),
         None,
         String::new(),
         String::new(),
         token()
      )
      .unwrap_err(),
      "Invalid GitHub repository name"
   );

   let by_suite = github_resolve_notification_workflow_run(
      "octo/app".into(),
      Some(20),
      String::new(),
      String::new(),
      token(),
   )
   .unwrap()
   .unwrap();
   assert_eq!(by_suite.database_id, 2);

   let by_title = github_resolve_notification_workflow_run(
      "octo/app".into(),
      Some(99),
      "CI workflow run in progress for main branch".into(),
      String::new(),
      token(),
   )
   .unwrap()
   .unwrap();
   assert_eq!(by_title.database_id, 2);

   assert!(
      github_resolve_notification_workflow_run(
         "octo/app".into(),
         None,
         "Deploy workflow run failed for main branch".into(),
         String::new(),
         token(),
      )
      .unwrap()
      .is_none()
   );
   assert_eq!(
      query_value(
         &mock.request("GET", "/repos/octo/app/actions/runs"),
         "per_page"
      )
      .as_deref(),
      Some("100")
   );
}

fn init_repo(remote_url: &str) -> (tempfile::TempDir, git2::Repository) {
   let dir = tempfile::tempdir().unwrap();
   let repo = git2::Repository::init(dir.path()).unwrap();
   {
      let mut config = repo.config().unwrap();
      config.set_str("user.name", "Test").unwrap();
      config.set_str("user.email", "test@example.com").unwrap();
      // Any fetch fails immediately instead of reaching the network.
      config.set_str("protocol.allow", "never").unwrap();
      config.set_str("core.sshCommand", "false").unwrap();
   }
   repo.remote("origin", remote_url).unwrap();
   let tree_id = repo.index().unwrap().write_tree().unwrap();
   {
      let tree = repo.find_tree(tree_id).unwrap();
      let signature = repo.signature().unwrap();
      repo
         .commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
         .unwrap();
   }
   (dir, repo)
}

#[test]
fn resolves_local_repositories_through_their_github_remote() {
   let mock = MockGitHub::start();
   mock.json("GET", "/repos/octo/app/labels", json!([]));
   let (dir, repo) = init_repo("git@github.com:octo/app.git");
   repo
      .remote("mirror", "https://gitlab.com/octo/app.git")
      .unwrap();

   github_list_labels(dir.path().to_string_lossy().into_owned(), token()).unwrap();
   assert_eq!(mock.paths(), vec!["GET /repos/octo/app/labels".to_string()]);

   let (other, _) = init_repo("https://gitlab.com/octo/app.git");
   assert_eq!(
      github_list_labels(other.path().to_string_lossy().into_owned(), token()).unwrap_err(),
      "No github.com remote found for this repository"
   );
   let not_a_repo = tempfile::tempdir().unwrap();
   assert_eq!(
      github_list_labels(not_a_repo.path().to_string_lossy().into_owned(), token()).unwrap_err(),
      "Repository is not a Git repository"
   );
}

#[test]
fn checks_out_pull_requests_into_local_branches() {
   let mock = MockGitHub::start();
   mock
      .json("GET", "/repos/octo/app/pulls/5", rest_pr(5, "octocat"))
      .json("GET", "/repos/octo/app/pulls/6", rest_pr(6, "octocat"));
   let (dir, repo) = init_repo("git@github.com:octo/app.git");
   let head = repo.head().unwrap().peel_to_commit().unwrap();
   repo.branch("pr-5", &head, false).unwrap();
   let path = dir.path().to_string_lossy().into_owned();

   github_checkout_pr(path.clone(), 5, token()).unwrap();
   assert_eq!(repo.head().unwrap().shorthand(), Some("pr-5"));

   let error = github_checkout_pr(path.clone(), 6, token()).unwrap_err();
   assert!(!error.is_empty(), "fetch failures surface git's stderr");
   assert_eq!(repo.head().unwrap().shorthand(), Some("pr-5"));

   assert!(
      github_checkout_pr(path, 7, token())
         .unwrap_err()
         .contains("Not Found"),
      "the pull request must exist before git runs"
   );
}

fn release(id: i64, draft: bool) -> Value {
   json!({
      "id": id,
      "tag_name": "v1.0.0",
      "target_commitish": "main",
      "name": "v1",
      "body": "Notes",
      "draft": draft,
      "prerelease": false,
      "html_url": format!("https://github.com/octo/app/releases/{id}"),
      "created_at": "2026-01-01T00:00:00Z",
      "published_at": null,
      "author": user("octocat"),
      "assets": [],
      "zipball_url": null,
      "tarball_url": null,
      "discussion_url": null
   })
}

fn asset(id: i64) -> Value {
   json!({
      "id": id,
      "name": format!("asset-{id}.zip"),
      "label": null,
      "size": 3,
      "download_count": 0,
      "browser_download_url": format!("https://github.com/octo/app/releases/download/v1/asset-{id}.zip"),
      "content_type": "application/zip",
      "state": "uploaded",
      "digest": null
   })
}

fn release_input(tag: &str, target: &str) -> ReleaseInput {
   ReleaseInput {
      tag_name: tag.to_string(),
      target_commitish: target.to_string(),
      name: "v1".to_string(),
      body: "Notes".to_string(),
      prerelease: false,
   }
}

#[test]
fn lists_and_loads_releases_with_paginated_assets() {
   let mock = MockGitHub::start();
   let first_page: Vec<Value> = (1..=100).map(asset).collect();
   mock
      .json(
         "GET",
         "/repos/octo/app/releases",
         json!([release(1, false)]),
      )
      .json("GET", "/repos/octo/app/releases/1", release(1, false))
      .json(
         "GET",
         "/repos/octo/app/releases/1/assets?per_page=100&page=1",
         json!(first_page),
      )
      .json(
         "GET",
         "/repos/octo/app/releases/1/assets?per_page=100&page=2",
         json!([]),
      );

   assert_eq!(
      github_list_releases(REPO.into(), 0, token()).unwrap_err(),
      "Page must be greater than zero"
   );
   assert_eq!(
      github_get_release(REPO.into(), 0, token()).unwrap_err(),
      "Invalid GitHub resource ID"
   );

   let releases = github_list_releases(REPO.into(), 2, token()).unwrap();
   assert_eq!(releases[0].tag_name, "v1.0.0");
   assert!(!releases[0].immutable);
   assert_eq!(
      query(&mock.request("GET", "/repos/octo/app/releases")),
      vec![
         ("per_page".to_string(), "20".to_string()),
         ("page".to_string(), "2".to_string()),
      ]
   );

   let loaded = github_get_release(REPO.into(), 1, token()).unwrap();
   assert_eq!(loaded.assets.len(), 100);
   assert_eq!(loaded.assets[99].name, "asset-100.zip");
}

#[test]
fn saves_publishes_and_deletes_releases() {
   let mock = MockGitHub::start();
   mock
      .json("POST", "/repos/octo/app/releases", release(2, true))
      .json("PATCH", "/repos/octo/app/releases/2", release(2, false))
      .on(
         "DELETE",
         "/repos/octo/app/releases/2",
         vec![MockResponse::empty(204)],
      )
      .json(
         "POST",
         "/repos/octo/app/releases/generate-notes",
         json!({ "name": "v1", "body": "## Changes" }),
      );

   assert_eq!(
      github_save_release(REPO.into(), None, release_input(" ", "main"), token()).unwrap_err(),
      "A release tag is required"
   );
   assert_eq!(
      github_save_release(REPO.into(), None, release_input("v1", ""), token()).unwrap_err(),
      "A target branch or commit is required"
   );
   assert_eq!(
      github_save_release(REPO.into(), Some(-1), release_input("v1", "main"), token()).unwrap_err(),
      "Invalid GitHub resource ID"
   );
   assert_eq!(
      github_generate_release_notes(REPO.into(), "v1".into(), " ".into(), None, token())
         .unwrap_err(),
      "A tag and target are required"
   );
   assert!(mock.requests().is_empty());

   let draft =
      github_save_release(REPO.into(), None, release_input("v1.0.0", "main"), token()).unwrap();
   assert!(draft.draft);
   assert_eq!(
      mock.request("POST", "/repos/octo/app/releases").json(),
      json!({
         "tag_name": "v1.0.0",
         "target_commitish": "main",
         "name": "v1",
         "body": "Notes",
         "prerelease": false,
         "draft": true
      })
   );

   github_save_release(
      REPO.into(),
      Some(2),
      release_input("v1.0.0", "main"),
      token(),
   )
   .unwrap();
   assert!(
      mock
         .request("PATCH", "/repos/octo/app/releases/2")
         .json()
         .get("draft")
         .is_none(),
      "editing keeps the release's draft state"
   );

   for (latest, sent) in [(true, "true"), (false, "false")] {
      let published = github_publish_release(REPO.into(), 2, latest, token()).unwrap();
      assert!(!published.draft);
      assert_eq!(
         mock.request("PATCH", "/repos/octo/app/releases/2").json(),
         json!({ "draft": false, "make_latest": sent })
      );
   }
   assert!(github_publish_release(REPO.into(), 0, true, token()).is_err());

   github_delete_release(REPO.into(), 2, token()).unwrap();
   assert!(github_delete_release(REPO.into(), 0, token()).is_err());

   let notes = github_generate_release_notes(
      REPO.into(),
      "v1.1.0".into(),
      "main".into(),
      Some("v1.0.0".into()),
      token(),
   )
   .unwrap();
   assert_eq!(notes["body"], "## Changes");
   assert_eq!(
      mock
         .request("POST", "/repos/octo/app/releases/generate-notes")
         .json(),
      json!({ "tag_name": "v1.1.0", "target_commitish": "main", "previous_tag_name": "v1.0.0" })
   );
   github_generate_release_notes(
      REPO.into(),
      "v1.1.0".into(),
      "main".into(),
      Some(" ".into()),
      token(),
   )
   .unwrap();
   assert!(
      mock
         .request("POST", "/repos/octo/app/releases/generate-notes")
         .json()
         .get("previous_tag_name")
         .is_none()
   );
}

#[test]
fn uploads_and_deletes_release_assets() {
   let mock = MockGitHub::start();
   mock
      .json("POST", "/repos/octo/app/releases/3/assets", asset(40))
      .on(
         "DELETE",
         "/repos/octo/app/releases/assets/40",
         vec![MockResponse::empty(204)],
      );
   let dir = tempfile::tempdir().unwrap();
   let file = dir.path().join("build output.zip");
   std::fs::write(&file, b"zip").unwrap();
   let file = file.to_string_lossy().into_owned();

   assert_eq!(
      github_upload_release_asset(REPO.into(), 0, file.clone(), token()).unwrap_err(),
      "Invalid GitHub resource ID"
   );
   assert!(
      github_upload_release_asset(
         REPO.into(),
         3,
         dir.path()
            .join("missing.zip")
            .to_string_lossy()
            .into_owned(),
         token()
      )
      .unwrap_err()
      .starts_with("Cannot open asset")
   );
   assert_eq!(
      github_upload_release_asset(
         REPO.into(),
         3,
         dir.path().to_string_lossy().into_owned(),
         token()
      )
      .unwrap_err(),
      "Release assets must be regular files"
   );

   let uploaded = github_upload_release_asset(REPO.into(), 3, file, token()).unwrap();
   assert_eq!(uploaded.id, 40);
   let request = mock.request("POST", "/repos/octo/app/releases/3/assets");
   assert_eq!(
      query_value(&request, "name").as_deref(),
      Some("build output.zip")
   );
   assert_eq!(
      request.header("content-type"),
      Some("application/octet-stream")
   );
   assert_eq!(request.body, b"zip");
   assert_eq!(request.header("authorization"), Some("Bearer test-token"));

   github_delete_release_asset(REPO.into(), 40, token()).unwrap();
   assert!(github_delete_release_asset(REPO.into(), 0, token()).is_err());
}

#[test]
fn lists_deployments_with_their_latest_status() {
   let mock = MockGitHub::start();
   let deployment = |id: i64| {
      json!({
         "id": id,
         "sha": "abc",
         "ref": "main",
         "task": "deploy",
         "environment": "production",
         "created_at": "2026-01-01T00:00:00Z",
         "updated_at": "2026-01-01T00:00:00Z",
         "creator": user("octocat")
      })
   };
   let status = |id: i64, state: &str| {
      json!({
         "id": id,
         "state": state,
         "created_at": "2026-01-01T00:00:00Z",
         "creator": null
      })
   };
   let deployments: Vec<Value> = (1..=5).map(deployment).collect();
   mock.json("GET", "/repos/octo/app/deployments", json!(deployments));
   for id in [1, 2, 4, 5] {
      mock.json(
         "GET",
         &format!("/repos/octo/app/deployments/{id}/statuses"),
         json!([status(id * 10, "success")]),
      );
   }
   mock
      .on(
         "GET",
         "/repos/octo/app/deployments/3/statuses",
         vec![MockResponse::json(
            500,
            json!({ "message": "status unavailable" }),
         )],
      )
      .json("GET", "/repos/octo/app/deployments/1", deployment(1))
      .json(
         "POST",
         "/repos/octo/app/deployments/1/statuses",
         status(99, "inactive"),
      );

   assert!(github_list_deployments(REPO.into(), 0, token()).is_err());
   let listed = github_list_deployments(REPO.into(), 1, token()).unwrap();
   assert_eq!(listed.len(), 5);
   for deployment in &listed {
      if deployment.id == 3 {
         assert!(deployment.statuses.is_empty());
         assert!(
            deployment
               .status_error
               .as_deref()
               .unwrap()
               .contains("status unavailable")
         );
      } else {
         assert_eq!(deployment.statuses[0].id, deployment.id * 10);
         assert!(deployment.status_error.is_none());
      }
   }
   let status_request = mock.request("GET", "/repos/octo/app/deployments/5/statuses");
   assert_eq!(
      query_value(&status_request, "per_page").as_deref(),
      Some("1")
   );

   let loaded = github_get_deployment(REPO.into(), 1, token()).unwrap();
   assert_eq!(loaded.statuses[0].state, "success");
   assert!(github_get_deployment(REPO.into(), -4, token()).is_err());

   let deactivated = github_deactivate_deployment(REPO.into(), 1, token()).unwrap();
   assert_eq!(deactivated.state, "inactive");
   assert_eq!(
      mock
         .request("POST", "/repos/octo/app/deployments/1/statuses")
         .json(),
      json!({ "state": "inactive", "auto_inactive": false })
   );
   assert!(github_deactivate_deployment(REPO.into(), 0, token()).is_err());
}

#[test]
fn mock_server_is_scoped_to_the_test_thread() {
   let mock = MockGitHub::start();
   assert_eq!(
      GitHubApi::new(None).unwrap().api_base,
      mock.url().to_string()
   );
   drop(mock);
   let api = GitHubApi::new(None).unwrap();
   assert_eq!(api.api_base, GITHUB_API_BASE);
   assert_eq!(api.uploads_base, GITHUB_UPLOADS_BASE);
}
