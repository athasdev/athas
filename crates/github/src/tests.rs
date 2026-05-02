use crate::{IssueDetails, PullRequest, PullRequestComment, PullRequestDetails};
use serde_json::json;

#[test]
fn parses_pull_request_list_items_with_nullish_fields() {
   let payload = json!({
      "number": 570,
      "title": null,
      "state": "OPEN",
      "author": null,
      "createdAt": null,
      "updatedAt": "2026-03-27T10:00:00Z",
      "isDraft": null,
      "reviewDecision": null,
      "url": "https://github.com/athasdev/athas/pull/570",
      "headRefName": null,
      "baseRefName": "master",
      "additions": null,
      "deletions": 4
   });

   let pr: PullRequest = serde_json::from_value(payload).expect("PR list item should deserialize");

   assert_eq!(pr.title, "");
   assert_eq!(pr.author.login, "unknown");
   assert_eq!(pr.created_at, "");
   assert!(!pr.is_draft);
   assert_eq!(pr.head_ref, "");
   assert_eq!(pr.base_ref, "master");
   assert_eq!(pr.additions, 0);
   assert_eq!(pr.deletions, 4);
}

#[test]
fn parses_pull_request_details_with_sparse_fields() {
   let payload = json!({
      "number": 568,
      "title": "Example",
      "body": null,
      "state": "OPEN",
      "author": {"login": null, "avatarUrl": null},
      "createdAt": "2026-03-10T20:16:17Z",
      "updatedAt": null,
      "isDraft": false,
      "reviewDecision": null,
      "url": null,
      "headRefName": "fix/example",
      "baseRefName": null,
      "additions": 5,
      "deletions": null,
      "changedFiles": null,
      "commits": null,
      "statusCheckRollup": null,
      "reviewRequests": null,
      "mergeStateStatus": null,
      "mergeable": null,
      "labels": null,
      "assignees": null
   });

   let details: PullRequestDetails =
      serde_json::from_value(payload).expect("PR details should deserialize");

   assert_eq!(details.body, "");
   assert_eq!(details.author.login, "");
   assert_eq!(details.updated_at, "");
   assert_eq!(details.url, "");
   assert_eq!(details.base_ref, "");
   assert_eq!(details.deletions, 0);
   assert_eq!(details.changed_files, 0);
   assert!(details.commits.is_empty());
   assert!(details.status_checks.is_empty());
   assert!(details.review_requests.is_empty());
   assert!(details.labels.is_empty());
   assert!(details.assignees.is_empty());
}

#[test]
fn parses_pull_request_comments_with_missing_author_or_body() {
   let payload = json!({
      "author": null,
      "body": null,
      "createdAt": null
   });

   let comment: PullRequestComment =
      serde_json::from_value(payload).expect("PR comment should deserialize");

   assert_eq!(comment.author.login, "unknown");
   assert_eq!(comment.body, "");
   assert_eq!(comment.created_at, "");
}

#[test]
fn parses_issue_details_with_missing_nested_data() {
   let payload = json!({
      "number": 570,
      "title": null,
      "body": null,
      "state": null,
      "author": null,
      "createdAt": null,
      "updatedAt": null,
      "url": null,
      "labels": null,
      "assignees": null,
      "comments": null
   });

   let issue: IssueDetails =
      serde_json::from_value(payload).expect("Issue details should deserialize");

   assert_eq!(issue.title, "");
   assert_eq!(issue.body, "");
   assert_eq!(issue.state, "");
   assert_eq!(issue.author.login, "unknown");
   assert_eq!(issue.created_at, "");
   assert_eq!(issue.updated_at, "");
   assert_eq!(issue.url, "");
   assert!(issue.labels.is_empty());
   assert!(issue.assignees.is_empty());
   assert!(issue.comments.is_empty());
}
