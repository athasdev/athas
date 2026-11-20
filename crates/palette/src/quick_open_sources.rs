//! What quick open's Git and GitHub sections list (`use-git-section.tsx`,
//! `use-github-section.tsx`). The workbench loads them; this filters and names them.

use std::path::PathBuf;

use gpui::{AnyElement, App, IntoElement, ParentElement, SharedString, Styled, div, px};
use theme::ActiveTheme;
use ui::typography;
use util::search_match::matches_search_query;

/// A changed file of the repository, `path` relative to its root.
#[derive(Clone, Debug, PartialEq)]
pub struct QuickOpenGitChange {
    pub path: String,
    pub staged: bool,
    /// `M`, `A`, `D`, `U` or `R`.
    pub status: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct QuickOpenCommit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

/// The repository quick open's Git section shows.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QuickOpenGit {
    pub repo: PathBuf,
    pub current_branch: Option<String>,
    pub changes: Vec<QuickOpenGitChange>,
    pub branches: Vec<String>,
    pub commits: Vec<QuickOpenCommit>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct QuickOpenPullRequest {
    pub number: i64,
    pub title: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub draft: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct QuickOpenIssue {
    pub number: i64,
    pub title: String,
    pub author: String,
    pub labels: Vec<String>,
}

/// The repository's open pull requests and issues, or why there are none to show.
#[derive(Clone, Debug, PartialEq)]
pub enum QuickOpenGitHub {
    /// The project is not a GitHub repository.
    NoRepository,
    SignedOut,
    Loaded { pull_requests: Vec<QuickOpenPullRequest>, issues: Vec<QuickOpenIssue> },
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum GitRow {
    Change(usize),
    Branch(usize),
    Commit(usize),
}

impl GitRow {
    pub(crate) fn group(&self) -> &'static str {
        match self {
            GitRow::Change(_) => "Changes",
            GitRow::Branch(_) => "Branches",
            GitRow::Commit(_) => "Commits",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum GitHubRow {
    PullRequest(usize),
    Issue(usize),
}

impl GitHubRow {
    pub(crate) fn group(&self) -> &'static str {
        match self {
            GitHubRow::PullRequest(_) => "Pull requests",
            GitHubRow::Issue(_) => "Issues",
        }
    }
}

pub(crate) fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

pub(crate) fn folder(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(folder, _)| folder)
}

/// Changes, then branches, then commits that match the query.
pub(crate) fn git_rows(git: &QuickOpenGit, query: &str) -> Vec<GitRow> {
    let changes = git.changes.iter().enumerate().filter(|(_, change)| matches_search_query(query, [Some(change.path.as_str())])).map(|(index, _)| GitRow::Change(index));
    let branches = git.branches.iter().enumerate().filter(|(_, branch)| matches_search_query(query, [Some(branch.as_str())])).map(|(index, _)| GitRow::Branch(index));
    let commits = git
        .commits
        .iter()
        .enumerate()
        .filter(|(_, commit)| matches_search_query(query, [Some(commit.message.as_str()), Some(commit.hash.as_str()), Some(commit.author.as_str())]))
        .map(|(index, _)| GitRow::Commit(index));
    changes.chain(branches).chain(commits).collect()
}

/// Pull requests, then issues that match the query.
pub(crate) fn github_rows(pull_requests: &[QuickOpenPullRequest], issues: &[QuickOpenIssue], query: &str) -> Vec<GitHubRow> {
    let prs = pull_requests
        .iter()
        .enumerate()
        .filter(|(_, pr)| {
            let number = format!("#{}", pr.number);
            matches_search_query(query, [Some(pr.title.as_str()), Some(number.as_str()), Some(pr.author.as_str()), Some(pr.head.as_str())])
        })
        .map(|(index, _)| GitHubRow::PullRequest(index));
    let issues = issues
        .iter()
        .enumerate()
        .filter(|(_, issue)| {
            let number = format!("#{}", issue.number);
            let fields = [Some(issue.title.as_str()), Some(number.as_str()), Some(issue.author.as_str())];
            matches_search_query(query, fields.into_iter().chain(issue.labels.iter().map(|label| Some(label.as_str()))))
        })
        .map(|(index, _)| GitHubRow::Issue(index));
    prs.chain(issues).collect()
}

/// Byte offsets of the query's characters where the title contains it, case aside, for the
/// row's match highlight.
pub(crate) fn substring_positions(text: &str, query: &str) -> Vec<usize> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Vec::new();
    }
    let lower: Vec<(usize, char)> = text.char_indices().flat_map(|(offset, character)| character.to_lowercase().map(move |lower| (offset, lower))).collect();
    let needle: Vec<char> = query.chars().collect();
    lower
        .windows(needle.len())
        .find(|window| window.iter().map(|(_, character)| *character).eq(needle.iter().copied()))
        .map(|window| {
            let mut offsets: Vec<usize> = window.iter().map(|(offset, _)| *offset).collect();
            offsets.dedup();
            offsets
        })
        .unwrap_or_default()
}

/// Small pills at a row's end (`CommandItemBadge`).
pub(crate) fn badges(labels: Vec<SharedString>, selected: bool, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .items_center()
        .gap(px(4.))
        .children(labels.into_iter().map(|label| {
            div()
                .flex_none()
                .px(px(6.))
                .rounded_full()
                .bg(if selected { colors.primary_foreground.opacity(0.2) } else { colors.accent })
                .text_size(typography::TEXT_CAPTION)
                .text_color(if selected { colors.primary_foreground } else { colors.muted_foreground })
                .child(label)
        }))
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git() -> QuickOpenGit {
        QuickOpenGit {
            repo: PathBuf::from("/repo"),
            current_branch: Some("main".into()),
            changes: vec![
                QuickOpenGitChange { path: "src/main.rs".into(), staged: true, status: "M" },
                QuickOpenGitChange { path: "README.md".into(), staged: false, status: "U" },
            ],
            branches: vec!["main".into(), "feature/quick-open".into()],
            commits: vec![QuickOpenCommit { hash: "abc1234def".into(), message: "Add quick open sections".into(), author: "Ada".into(), date: "2026-11-10".into() }],
        }
    }

    #[test]
    fn git_rows_keep_the_section_order_and_match_loosely() {
        assert_eq!(git_rows(&git(), "").len(), 5);
        assert_eq!(git_rows(&git(), "quick"), [GitRow::Branch(1), GitRow::Commit(0)]);
        assert_eq!(git_rows(&git(), "main.rs"), [GitRow::Change(0)]);
        assert_eq!(git_rows(&git(), "abc123"), [GitRow::Commit(0)]);
        assert_eq!(git_rows(&git(), "ada"), [GitRow::Commit(0)]);
    }

    #[test]
    fn github_rows_match_numbers_authors_branches_and_labels() {
        let prs = vec![QuickOpenPullRequest { number: 12, title: "Port tabs".into(), author: "ada".into(), head: "tabs".into(), base: "main".into(), draft: false }];
        let issues = vec![QuickOpenIssue { number: 7, title: "Crash on start".into(), author: "bob".into(), labels: vec!["bug".into()] }];
        assert_eq!(github_rows(&prs, &issues, ""), [GitHubRow::PullRequest(0), GitHubRow::Issue(0)]);
        assert_eq!(github_rows(&prs, &issues, "#12"), [GitHubRow::PullRequest(0)]);
        assert_eq!(github_rows(&prs, &issues, "bug"), [GitHubRow::Issue(0)]);
        assert_eq!(github_rows(&prs, &issues, "tabs"), [GitHubRow::PullRequest(0)]);
    }

    #[test]
    fn highlights_the_matched_substring() {
        assert_eq!(substring_positions("Add Quick open", "quick"), [4, 5, 6, 7, 8]);
        assert!(substring_positions("abc", "x").is_empty());
        assert_eq!(folder("src/a/b.rs"), "src/a");
        assert_eq!(file_name("src/a/b.rs"), "b.rs");
    }
}
