//! The GitHub inbox (`useGitHubNotifications`): the account's unread notifications, polled every
//! minute while GitHub is on, kept under the GitHub tab of the notifications list. Opening one
//! shows its pull request, issue or workflow run when it belongs to the project open here, and
//! the page on github.com otherwise (`getGitHubNotificationTarget`). A check suite is first matched
//! to its workflow run (`github-action-viewer.tsx`).

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::gh::GitHubNotification;
use gpui::{App, AsyncApp, Global, Task};
use notifications::{NotificationAction, NotificationCategory, NotificationKind};

use crate::{repo, store};

const POLL: Duration = Duration::from_secs(60);

/// Where a notification leads.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    PullRequest(i64),
    Issue(i64),
    Run(i64),
    /// A check suite's run, found when it is opened; `same_repository` opens it in Athas.
    CheckSuite { repository: String, check_suite_id: Option<i64>, title: String, updated_at: String, same_repository: bool },
    External(String),
}

/// The check suite in a notification's `subject_url` (`parseGitHubCheckSuiteId`).
pub fn check_suite_id(subject_url: &str) -> Option<i64> {
    let path = subject_url.split(['?', '#']).next()?;
    let rest = &path[path.find("/check-suites/")? + "/check-suites/".len()..];
    let id = rest.split('/').next()?;
    if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    id.parse().ok()
}

/// The page a notification leads to when Athas cannot show it (`getGitHubNotificationFallbackUrl`).
pub fn fallback_url(notification: &GitHubNotification) -> String {
    let repository = format!("https://github.com/{}", notification.repository_full_name);
    match notification.subject_type.as_str() {
        "CheckSuite" => format!("{repository}/actions"),
        "Release" => format!("{repository}/releases"),
        _ if !notification.url.is_empty() => notification.url.clone(),
        _ => repository,
    }
}

/// Opens it in Athas when it is a pull request, issue or run of `project` (an `owner/name`).
pub fn target(notification: &GitHubNotification, project: Option<&str>) -> Target {
    let prefix = format!("https://github.com/{}/", notification.repository_full_name);
    let same_repository = project.is_some_and(|project| project.eq_ignore_ascii_case(&notification.repository_full_name));
    if same_repository && let Some(rest) = notification.url.strip_prefix(&prefix) {
        let parts: Vec<&str> = rest.split(['/', '#', '?']).collect();
        match parts.as_slice() {
            ["pull", number, ..] => {
                if let Ok(number) = number.parse() {
                    return Target::PullRequest(number);
                }
            }
            ["issues", number, ..] => {
                if let Ok(number) = number.parse() {
                    return Target::Issue(number);
                }
            }
            ["actions", "runs", id, ..] => {
                if let Ok(id) = id.parse() {
                    return Target::Run(id);
                }
            }
            _ => {}
        }
    }
    if notification.subject_type == "CheckSuite" && repo::parse_github_remote_url(&format!("https://github.com/{}", notification.repository_full_name)).is_some() {
        return Target::CheckSuite {
            repository: notification.repository_full_name.clone(),
            check_suite_id: check_suite_id(&notification.subject_url),
            title: notification.title.clone(),
            updated_at: notification.updated_at.clone(),
            same_repository,
        };
    }
    Target::External(fallback_url(notification))
}

/// The line under a GitHub notification's title: its repository and why it came, such as
/// "acme/web · Review requested".
fn description(notification: &GitHubNotification) -> String {
    let reason = notification.reason.replace('_', " ");
    let mut chars = reason.chars();
    let reason: String = chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default();
    [notification.repository_full_name.as_str(), reason.as_str()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}

fn open(target: Target, title: String, cx: &mut App) {
    match target {
        Target::PullRequest(number) => workbench_api::open_resource(cx, "github-pr", &number.to_string(), &title),
        Target::Issue(number) => workbench_api::open_resource(cx, "github-issue", &number.to_string(), &title),
        Target::Run(id) => workbench_api::open_resource(cx, "github-run", &id.to_string(), &title),
        Target::CheckSuite { repository, check_suite_id, title: notification_title, updated_at, same_repository } => {
            let auth = store::check_auth(false, cx);
            cx.spawn(async move |cx: &mut AsyncApp| {
                let auth = auth.await;
                let resolved = match auth.token() {
                    Some(token) => {
                        cx.background_executor()
                            .spawn(async move { crate::gh::github_resolve_notification_workflow_run(repository, check_suite_id, notification_title, updated_at, Some(token)) })
                            .await
                    }
                    None => Err(store::auth_message(&auth)),
                };
                cx.update(|cx| match resolved {
                    Ok(Some(run)) if same_repository => {
                        let title = run.display_title.clone().or_else(|| run.name.clone()).unwrap_or(title);
                        workbench_api::open_resource(cx, "github-run", &run.database_id.to_string(), &title);
                    }
                    Ok(Some(run)) => cx.open_url(&run.url),
                    Ok(None) => {
                        notifications::error(cx, "Could not match this notification to a GitHub Actions run.", None);
                    }
                    Err(error) => {
                        notifications::error(cx, error, None);
                    }
                });
            })
            .detach();
        }
        Target::External(url) => cx.open_url(&url),
    }
}

/// Records the notifications not recorded before; returns how many were new.
pub(crate) fn record(notifications: &[GitHubNotification], project: Option<&str>, seen: &mut HashSet<String>, cx: &mut App) -> usize {
    let mut fresh = 0;
    for notification in notifications.iter().filter(|notification| notification.unread).rev() {
        if !seen.insert(notification.id.clone()) {
            continue;
        }
        fresh += 1;
        let target = target(notification, project);
        let title = notification.title.clone();
        let action = NotificationAction::new("Open", move |_, cx| open(target.clone(), title.clone(), cx));
        notifications::record(
            cx,
            NotificationKind::Info,
            NotificationCategory::GitHub,
            notification.title.clone(),
            Some(description(notification).into()),
            format!("github-notification-{}", notification.id).into(),
            Some(action),
        );
    }
    fresh
}

struct Inbox {
    root: Option<PathBuf>,
    _task: Task<()>,
}

impl Global for Inbox {}

fn enabled(cx: &App) -> bool {
    cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).core_features.github)
}

/// Polls the inbox while GitHub is on; `root` is the project in front, for opening its pull
/// requests, issues and runs in Athas. Called whenever the project in front may have changed.
pub fn watch_notifications(root: Option<&Path>, cx: &mut App) {
    if !enabled(cx) {
        cx.remove_global::<Inbox>();
        notifications::set_loading(cx, NotificationCategory::GitHub, false);
        return;
    }
    let root = root.map(Path::to_path_buf);
    if cx.try_global::<Inbox>().is_some_and(|inbox| inbox.root == root) {
        return;
    }
    let task = cx.spawn({
        let root = root.clone();
        async move |cx: &mut AsyncApp| watch(root, cx).await
    });
    cx.set_global(Inbox { root, _task: task });
}

async fn watch(root: Option<PathBuf>, cx: &mut AsyncApp) {
    let project = match root {
        Some(root) => cx.background_executor().spawn(async move { repo::detect(&root).ok().map(|repository| repository.slug.full_name()) }).await,
        None => None,
    };
    let mut seen = HashSet::new();
    let mut first = true;
    loop {
        let auth = cx.update(|cx| store::check_auth(false, cx)).await;
        if let Some(token) = auth.token() {
            // Until the first list arrives the Inbox shows GitHub as loading, not empty.
            if first {
                cx.update(|cx| notifications::set_loading(cx, NotificationCategory::GitHub, true));
            }
            let fetched = cx.background_executor().spawn(async move { crate::gh::github_list_notifications(Some(token)) }).await;
            cx.update(|cx| {
                if let Ok(notifications) = &fetched {
                    record(notifications, project.as_deref(), &mut seen, cx);
                }
                notifications::set_loading(cx, NotificationCategory::GitHub, false);
            });
            first = false;
        }
        cx.background_executor().timer(POLL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notification(id: &str, subject: &str, url: &str) -> GitHubNotification {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "title": format!("Title {id}"),
            "subjectType": subject,
            "reason": "review_requested",
            "unread": true,
            "updatedAt": "2026-11-12T10:00:00Z",
            "repositoryFullName": "acme/web",
            "url": url,
            "subjectUrl": "",
        }))
        .unwrap()
    }

    #[test]
    fn notifications_of_the_open_project_open_in_athas() {
        let pr = notification("1", "PullRequest", "https://github.com/acme/web/pull/42");
        assert_eq!(target(&pr, Some("acme/web")), Target::PullRequest(42));
        assert_eq!(target(&pr, Some("ACME/Web")), Target::PullRequest(42));
        assert_eq!(target(&pr, Some("acme/other")), Target::External("https://github.com/acme/web/pull/42".into()));
        assert_eq!(target(&notification("2", "Issue", "https://github.com/acme/web/issues/7#issuecomment-1"), Some("acme/web")), Target::Issue(7));
        assert_eq!(target(&notification("3", "CheckSuite", "https://github.com/acme/web/actions/runs/99"), Some("acme/web")), Target::Run(99));
        let mut suite = notification("4", "CheckSuite", "");
        suite.subject_url = "https://api.github.com/repos/acme/web/check-suites/123".into();
        assert_eq!(
            target(&suite, None),
            Target::CheckSuite { repository: "acme/web".into(), check_suite_id: Some(123), title: "Title 4".into(), updated_at: "2026-11-12T10:00:00Z".into(), same_repository: false }
        );
        assert!(matches!(target(&suite, Some("acme/web")), Target::CheckSuite { same_repository: true, .. }));
        suite.repository_full_name = "not a repository".into();
        assert!(matches!(target(&suite, None), Target::External(_)));
        assert_eq!(check_suite_id("https://api.github.com/repos/a/b/check-suites/9/runs"), Some(9));
        assert_eq!(check_suite_id("https://api.github.com/repos/a/b/check-suites/x"), None);
        assert_eq!(check_suite_id(""), None);
        assert_eq!(target(&notification("5", "Release", "https://github.com/acme/web/releases/tag/v1"), None), Target::External("https://github.com/acme/web/releases".into()));
        assert_eq!(description(&pr), "acme/web · Review requested");
    }

    #[gpui::test]
    fn unread_notifications_are_recorded_once(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            let mut seen = HashSet::new();
            let mut read = notification("3", "Issue", "");
            read.unread = false;
            let list = vec![notification("1", "PullRequest", ""), notification("2", "Issue", ""), read];
            assert_eq!(record(&list, None, &mut seen, cx), 2);
            assert_eq!(record(&list, None, &mut seen, cx), 0);
            let store = cx.global::<notifications::Notifications>();
            let github: Vec<_> = store.items().iter().filter(|item| item.category == NotificationCategory::GitHub).collect();
            assert_eq!(github.len(), 2);
            assert_eq!(github[0].message.as_ref(), "Title 1");
            assert!(github.iter().all(|item| item.action.is_some()));
            assert_eq!(store.toasts().count(), 0);
        });
    }
}
