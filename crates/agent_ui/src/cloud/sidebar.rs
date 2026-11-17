//! Cloud runs in the sidebar (`use-cloud-sidebar-entries.ts`, `cloud-run-sidebar.ts`): runs
//! started elsewhere (another device, or before runs became sessions) under the project whose
//! GitHub repository they ran on, the rest under Cloud. A run a session already follows is listed
//! as that session instead.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::Duration,
};

use gpui::{App, AppContext as _, Global};
use serde::Deserialize;

use super::{CloudClient, CloudRun};

/// Finished runs older than this stay on the server but leave the sidebar.
pub const CLOUD_RUN_SIDEBAR_DAYS: u64 = 14;
/// How often the list is fetched while a run works, and otherwise.
const ACTIVE_POLL: Duration = Duration::from_secs(5);
const IDLE_POLL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CloudSidebarGroups {
    /// Runs with no session here yet, by the project whose repository they ran on.
    pub runs_by_project: HashMap<String, Vec<CloudRun>>,
    /// Runs on repositories no open project pushes to.
    pub other_runs: Vec<CloudRun>,
}

/// When the run was created, in milliseconds since the epoch (0 when unknown).
pub fn created_ms(run: &CloudRun) -> u64 {
    chrono::DateTime::parse_from_rfc3339(&run.created_at).map_or(0, |date| date.timestamp_millis().max(0) as u64)
}

/// Groups `runs` by the project whose repository (`owner/name`, by project id) they ran on,
/// leaving out runs in `adopted` and finished runs older than [`CLOUD_RUN_SIDEBAR_DAYS`].
pub fn group_cloud_sidebar_entries(runs: &[CloudRun], adopted: &HashSet<String>, project_repos: &[(String, Option<String>)], now_ms: u64) -> CloudSidebarGroups {
    let cutoff = now_ms.saturating_sub(CLOUD_RUN_SIDEBAR_DAYS * 86_400_000);
    let mut groups = CloudSidebarGroups::default();
    for run in runs {
        if adopted.contains(&run.id) || (!run.status.is_active() && created_ms(run) < cutoff) {
            continue;
        }
        let project = project_repos.iter().find(|(_, repo)| repo.as_deref().is_some_and(|repo| repo.eq_ignore_ascii_case(&run.repo)));
        match project {
            Some((id, _)) => groups.runs_by_project.entry(id.clone()).or_default().push(run.clone()),
            None => groups.other_runs.push(run.clone()),
        }
    }
    groups
}

/// The user's cloud runs, the runs each saved session follows, and each project's repository.
#[derive(Default)]
pub struct CloudSidebar {
    pub runs: Vec<CloudRun>,
    followed: HashMap<String, Vec<String>>,
    scanning: HashSet<String>,
    repos: HashMap<PathBuf, Option<String>>,
    watching: bool,
}

impl Global for CloudSidebar {}

fn can_list(cx: &App) -> bool {
    account::AccountStore::global(cx).is_some_and(|store| {
        let store = store.read(cx);
        store.token().is_some() && store.features().cloud_agents
    })
}

/// Keeps the runs fresh: every few seconds while one works, every minute otherwise.
pub fn watch(cx: &mut App) {
    let sidebar = cx.default_global::<CloudSidebar>();
    if sidebar.watching {
        return;
    }
    sidebar.watching = true;
    cx.spawn(async move |cx| {
        loop {
            let fetch = cx.update(|cx| can_list(cx).then(|| CloudClient::from_account(cx)));
            let mut active = false;
            match fetch {
                Some(client) => {
                    let runs = cx.background_spawn(async move { client.list_runs() }).await;
                    if let Ok(runs) = runs {
                        active = runs.iter().any(|run| run.status.is_active());
                        cx.update(|cx| set_runs(runs, cx));
                    }
                }
                None => cx.update(|cx| set_runs(Vec::new(), cx)),
            }
            cx.background_executor().timer(if active { ACTIVE_POLL } else { IDLE_POLL }).await;
        }
    })
    .detach();
}

fn set_runs(runs: Vec<CloudRun>, cx: &mut App) {
    let sidebar = cx.default_global::<CloudSidebar>();
    if sidebar.runs != runs {
        sidebar.runs = runs;
        cx.refresh_windows();
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct SavedCloud {
    cloud: Option<SavedEnvironment>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct SavedEnvironment {
    runs: Vec<SavedRun>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct SavedRun {
    run_id: Option<String>,
}

/// The runs a saved transcript follows.
pub fn followed_runs(json: &str) -> Vec<String> {
    serde_json::from_str::<SavedCloud>(json).ok().and_then(|saved| saved.cloud).map(|cloud| cloud.runs.into_iter().filter_map(|run| run.run_id).collect()).unwrap_or_default()
}

/// The runs the saved sessions follow, reading the ones not read yet in the background.
pub fn followed_by_sessions<'a>(sessions: impl IntoIterator<Item = &'a str>, cx: &mut App) -> HashSet<String> {
    let sidebar = cx.default_global::<CloudSidebar>();
    let mut followed = HashSet::new();
    let mut unread = Vec::new();
    for id in sessions {
        match sidebar.followed.get(id) {
            Some(runs) => followed.extend(runs.iter().cloned()),
            None if !sidebar.scanning.contains(id) => unread.push(id.to_string()),
            None => {}
        }
    }
    if unread.is_empty() || sidebar.runs.is_empty() {
        return followed;
    }
    sidebar.scanning.extend(unread.iter().cloned());
    let Some(dir) = crate::persistence::sessions_dir() else { return followed };
    let work = cx.background_spawn(async move {
        unread
            .into_iter()
            .map(|id| {
                let path = dir.join(crate::persistence::file_name(&id));
                let runs = std::fs::read_to_string(path).map(|json| followed_runs(&json)).unwrap_or_default();
                (id, runs)
            })
            .collect::<Vec<_>>()
    });
    cx.spawn(async move |cx| {
        let read = work.await;
        cx.update(|cx| {
            let sidebar = cx.default_global::<CloudSidebar>();
            for (id, runs) in read {
                sidebar.scanning.remove(&id);
                sidebar.followed.insert(id, runs);
            }
            cx.refresh_windows();
        });
    })
    .detach();
    followed
}

/// The GitHub repository of the project at `path`, as `owner/name`, read once.
pub fn project_repo(path: &Path, cx: &mut App) -> Option<String> {
    cx.default_global::<CloudSidebar>()
        .repos
        .entry(path.to_path_buf())
        .or_insert_with(|| crate::chat_link::project_repository(path).map(|(owner, name)| format!("{owner}/{name}")))
        .clone()
}

/// The runs last fetched; empty without cloud agents.
pub fn runs(cx: &App) -> &[CloudRun] {
    cx.try_global::<CloudSidebar>().map_or(&[], |sidebar| sidebar.runs.as_slice())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::RunStatus;

    fn run(id: &str, repo: &str, status: RunStatus, created_at: &str) -> CloudRun {
        CloudRun { id: id.into(), repo: repo.into(), status, created_at: created_at.into(), ..Default::default() }
    }

    #[test]
    fn groups_runs_by_project_repository() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-12T00:00:00Z").unwrap().timestamp_millis() as u64;
        let runs = vec![
            run("a", "athasdev/athas", RunStatus::Succeeded, "2026-11-10T00:00:00Z"),
            run("b", "other/repo", RunStatus::Failed, "2026-11-11T00:00:00Z"),
            run("c", "AthasDev/Athas", RunStatus::Succeeded, "2026-10-01T00:00:00Z"),
            run("d", "athasdev/athas", RunStatus::Running, "2026-10-01T00:00:00Z"),
            run("e", "athasdev/athas", RunStatus::Succeeded, "2026-11-11T00:00:00Z"),
        ];
        let adopted = HashSet::from(["e".to_string()]);
        let projects = vec![("p1".to_string(), Some("athasdev/athas".to_string())), ("p2".to_string(), None)];
        let groups = group_cloud_sidebar_entries(&runs, &adopted, &projects, now);
        let ids: Vec<&str> = groups.runs_by_project["p1"].iter().map(|run| run.id.as_str()).collect();
        assert_eq!(ids, ["a", "d"], "old finished runs leave, old active ones stay, adopted ones are sessions");
        assert_eq!(groups.other_runs.len(), 1);
        assert_eq!(groups.other_runs[0].id, "b");
    }

    #[test]
    fn reads_the_runs_a_saved_session_follows() {
        let json = r#"{"entries":[],"cloud":{"repo":"a/b","runs":[{"entry":1,"runId":"r1"},{"entry":3,"error":"no"}]}}"#;
        assert_eq!(followed_runs(json), ["r1"]);
        assert!(followed_runs(r#"{"entries":[]}"#).is_empty());
    }
}
