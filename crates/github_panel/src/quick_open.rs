//! Quick open's GitHub section (`use-github-section.tsx`): the repository's open pull requests and
//! issues, from the same requests and cache as the sidebar lists.

use std::{path::PathBuf, sync::Arc};

use gpui::{App, AppContext, Task};
use palette::{QuickOpenGitHub, QuickOpenIssue, QuickOpenPullRequest};

use crate::{
    gh::{IssueListItem, PullRequest},
    model::{IssueFilter, PrFilter},
    repo, store,
};

/// Loads what the section lists for the project at `root`.
pub fn load(root: PathBuf, cx: &mut App) -> Task<QuickOpenGitHub> {
    let auth = store::check_auth(false, cx);
    cx.spawn(async move |cx| {
        let auth = auth.await;
        let Some(token) = auth.token() else { return QuickOpenGitHub::SignedOut };
        let found = cx.background_spawn(async move { repo::detect(&root) }).await;
        let Ok(repository) = found else { return QuickOpenGitHub::NoRepository };
        let path = repository.root.to_string_lossy().into_owned();
        let pr_key = format!("{path}|prs|{}", PrFilter::default().api_value());
        let issue_key = format!("{path}|issues|{}", IssueFilter::default().api_value());
        let (pr_filter, issue_filter) = (PrFilter::default().api_value().to_string(), IssueFilter::default().api_value().to_string());
        let fetch = cx.background_spawn(async move {
            let pull_requests = crate::gh::github_list_prs(path.clone(), pr_filter, Some(token.clone())).ok();
            let issues = crate::gh::github_list_issues(path, issue_filter, Some(token)).ok();
            (pull_requests, issues)
        });
        let (pull_requests, issues) = fetch.await;
        cx.update(|cx| {
            let pull_requests = match pull_requests {
                Some(list) => {
                    let list = Arc::new(list);
                    store::put(pr_key, list.clone(), cx);
                    Some(list)
                }
                None => store::get::<Vec<PullRequest>>(&pr_key, cx),
            };
            let issues = match issues {
                Some(list) => {
                    let list = Arc::new(list);
                    store::put(issue_key, list.clone(), cx);
                    Some(list)
                }
                None => store::get::<Vec<IssueListItem>>(&issue_key, cx),
            };
            QuickOpenGitHub::Loaded {
                pull_requests: pull_requests.iter().flat_map(|list| list.iter()).map(pull_request).collect(),
                issues: issues.iter().flat_map(|list| list.iter()).map(issue).collect(),
            }
        })
    })
}

fn pull_request(pr: &PullRequest) -> QuickOpenPullRequest {
    QuickOpenPullRequest { number: pr.number, title: pr.title.clone(), author: pr.author.login.clone(), head: pr.head_ref.clone(), base: pr.base_ref.clone(), draft: pr.is_draft }
}

fn issue(issue: &IssueListItem) -> QuickOpenIssue {
    QuickOpenIssue { number: issue.number, title: issue.title.clone(), author: issue.author.login.clone(), labels: issue.labels.iter().map(|label| label.name.clone()).collect() }
}

/// The open issues of the project at `root` as (number, title, url, updated at), for the project
/// dashboard's suggestions; `None` until GitHub is signed in, so nothing asks for a token.
pub fn open_issues(root: PathBuf, cx: &mut App) -> Option<Task<Vec<(u64, String, String, String)>>> {
    let token = store::auth(cx)?.token()?;
    Some(cx.spawn(async move |cx| {
        let filter = IssueFilter::default().api_value().to_string();
        let fetched = cx
            .background_spawn(async move {
                let repository = repo::detect(&root).ok()?;
                let path = repository.root.to_string_lossy().into_owned();
                let key = format!("{path}|issues|{filter}");
                crate::gh::github_list_issues(path, filter, Some(token)).ok().map(|list| (key, list))
            })
            .await;
        let Some((key, list)) = fetched else { return Vec::new() };
        let list = Arc::new(list);
        cx.update(|cx| store::put(key, list.clone(), cx));
        list.iter().map(|issue| (issue.number.max(0) as u64, issue.title.clone(), issue.url.clone(), issue.updated_at.clone())).collect()
    }))
}

/// One open pull request as the project dashboard lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct ProjectPullRequest {
    pub number: i64,
    pub title: String,
    pub author: String,
    pub head: String,
    pub draft: bool,
    /// RFC 3339.
    pub updated_at: String,
}

/// The open pull requests of the project at `root` (`pullRequestListQuery(path, "all")`), for the
/// project dashboard; `None` until GitHub is signed in, and the task's `None` when the request
/// failed.
pub fn open_pull_requests(root: PathBuf, cx: &mut App) -> Option<Task<Option<Vec<ProjectPullRequest>>>> {
    let token = store::auth(cx)?.token()?;
    Some(cx.spawn(async move |cx| {
        let filter = PrFilter::default().api_value().to_string();
        let (key, list) = cx
            .background_spawn(async move {
                let repository = repo::detect(&root).ok()?;
                let path = repository.root.to_string_lossy().into_owned();
                let key = format!("{path}|prs|{filter}");
                crate::gh::github_list_prs(path, filter, Some(token)).ok().map(|list| (key, list))
            })
            .await?;
        let list = Arc::new(list);
        cx.update(|cx| store::put(key, list.clone(), cx));
        Some(
            list.iter()
                .map(|pr| ProjectPullRequest {
                    number: pr.number,
                    title: pr.title.clone(),
                    author: pr.author.login.clone(),
                    head: pr.head_ref.clone(),
                    draft: pr.is_draft,
                    updated_at: pr.updated_at.clone(),
                })
                .collect(),
        )
    }))
}
