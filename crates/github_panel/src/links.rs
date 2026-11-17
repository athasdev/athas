//! Links to the project's own pull requests, issues and runs open as Athas tabs; every other
//! link opens in the browser.

use gpui::{App, Global};

/// The repository the GitHub panel shows, as `owner/name`.
pub(crate) struct CurrentRepo(pub String);

impl Global for CurrentRepo {}

/// The tab a GitHub URL of `repo` opens as: (kind, id, title).
pub(crate) fn resource_for(url: &str, repo: &str) -> Option<(&'static str, String, String)> {
    let rest = url.strip_prefix("https://github.com/")?;
    let rest = rest.strip_prefix(repo)?.strip_prefix('/')?;
    let rest = rest.split(['#', '?']).next()?;
    let parts: Vec<&str> = rest.split('/').collect();
    let number = |part: &str| part.parse::<u64>().ok().map(|n| n.to_string());
    match parts.as_slice() {
        ["pull", n, ..] => number(n).map(|n| ("github-pr", n.clone(), format!("#{n}"))),
        ["issues", n] => number(n).map(|n| ("github-issue", n.clone(), format!("#{n}"))),
        ["actions", "runs", n, ..] => number(n).map(|n| ("github-run", n.clone(), format!("Run {n}"))),
        _ => None,
    }
}

/// The repository the GitHub panel shows, as `owner/name`, once it knows.
pub(crate) fn current_repo(cx: &App) -> Option<String> {
    cx.try_global::<CurrentRepo>().map(|repo| repo.0.clone())
}

pub(crate) fn open(cx: &mut App, url: &str) {
    let repo = cx.try_global::<CurrentRepo>().map(|repo| repo.0.clone());
    match repo.and_then(|repo| resource_for(url, &repo)) {
        Some((kind, id, title)) => workbench_api::open_resource(cx, kind, &id, &title),
        None => cx.open_url(url),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_repository_links_become_tabs() {
        let repo = "athasdev/athas";
        assert_eq!(resource_for("https://github.com/athasdev/athas/pull/789", repo).unwrap().0, "github-pr");
        assert_eq!(resource_for("https://github.com/athasdev/athas/issues/12#issuecomment-1", repo).unwrap().1, "12");
        assert_eq!(resource_for("https://github.com/athasdev/athas/actions/runs/42/job/7", repo).unwrap().0, "github-run");
        assert!(resource_for("https://github.com/other/repo/pull/1", repo).is_none());
        assert!(resource_for("https://github.com/athasdev/athas/blob/main/x.rs", repo).is_none());
    }
}
