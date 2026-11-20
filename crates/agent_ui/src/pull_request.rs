//! Where the pull request of a session's branch stands, and what that makes the session's status.
//!
//! Ported from Athas's `hooks/use-session-pull-request.ts`, `services/session-status.ts` and
//! `session-panel/hooks/use-branch-pull-request.ts`. The app installs a [`Source`] that asks
//! GitHub through the GitHub panel's client; without one (tests, snapshots) nothing is polled.

use std::{path::PathBuf, sync::Arc, time::Duration};

use gpui::{App, AppContext as _, Context, Global};
use workspace::SessionStatus;

use crate::session_view::SessionView;

/// How often an open session asks GitHub again, as the GitHub panel's idle poll.
const POLL: Duration = Duration::from_secs(60);

/// Branches that are a repository's trunk rather than a session's own work.
const TRUNK_BRANCHES: &[&str] = &["main", "master", "trunk", "develop"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PullRequestState {
    Open,
    Merged,
    Closed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BranchPullRequest {
    pub number: i64,
    pub title: String,
    pub head_ref: String,
    pub state: PullRequestState,
    pub draft: bool,
}

impl BranchPullRequest {
    /// "Draft", "OPEN", "MERGED" or "CLOSED", as the dock's row shows it.
    pub fn state_label(&self) -> &'static str {
        match self.state {
            PullRequestState::Open if self.draft => "Draft",
            PullRequestState::Open => "OPEN",
            PullRequestState::Merged => "MERGED",
            PullRequestState::Closed => "CLOSED",
        }
    }
}

/// Asks GitHub about the pull request of `branch` in the repository at `repo`; `remembered` is
/// the number found for it before, looked up once more when it left the open list.
pub type Lookup = dyn Fn(PathBuf, String, Option<i64>) -> Result<Option<BranchPullRequest>, String> + Send + Sync;

#[derive(Clone)]
pub struct Source(pub Arc<Lookup>);

impl Global for Source {}

/// Lets open sessions ask GitHub about their branch's pull request.
pub fn install(source: Source, cx: &mut App) {
    cx.set_global(source);
}

/// The branch a session works on, when it is not the trunk.
pub fn session_branch(branch: Option<&str>) -> Option<&str> {
    branch.filter(|branch| !TRUNK_BRANCHES.contains(branch))
}

/// The number of the pull request a GitHub pull request URL points at.
pub fn pull_request_number(url: &str) -> Option<i64> {
    let rest = &url[url.find("/pull/")? + "/pull/".len()..];
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    rest[..end].parse().ok()
}

/// Where a pull request stands, from GitHub's details of it.
pub fn read_state(state: &str, merged_at: Option<&str>) -> PullRequestState {
    let state = state.to_uppercase();
    if merged_at.is_some_and(|merged| !merged.is_empty()) || state == "MERGED" {
        PullRequestState::Merged
    } else if state == "OPEN" {
        PullRequestState::Open
    } else {
        PullRequestState::Closed
    }
}

/// The status a session row shows once its pull request is known (`getSessionStatus`): needing
/// input, running and failing come first, a merge beats edits waiting for review, and those beat
/// an open pull request.
pub fn overlay(status: SessionStatus, pull_request: Option<PullRequestState>) -> SessionStatus {
    match (status, pull_request) {
        (SessionStatus::Idle | SessionStatus::ReviewReady, Some(PullRequestState::Merged)) => SessionStatus::Merged,
        (SessionStatus::Idle, Some(PullRequestState::Open)) => SessionStatus::PrOpen,
        (status, _) => status,
    }
}

/// The real lookup, through the GitHub panel's client: on the desktop with the token the panel
/// finds, on the web through the workspace server, which holds its own. The open pull requests of
/// the repository first, then the details of the one found before when it is no longer open.
pub fn github_source(cx: &App) -> Source {
    let preference = github_panel::gh::TokenSourcePreference::from_setting(
        cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).github_token_source.as_str()),
    );
    Source(Arc::new(move |repo: PathBuf, branch: String, remembered: Option<i64>| {
        let Some(token) = github_token(preference) else { return Ok(None) };
        let path = repo.to_string_lossy().into_owned();
        let open = github_panel::gh::github_list_prs(path.clone(), "all".to_string(), token.clone())?;
        let matches: Vec<_> = open.iter().filter(|pull_request| pull_request.head_ref == branch).collect();
        let found = matches.iter().find(|pull_request| pull_request.state.eq_ignore_ascii_case("open")).or(matches.first());
        if let Some(pull_request) = found {
            return Ok(Some(BranchPullRequest {
                number: pull_request.number,
                title: pull_request.title.clone(),
                head_ref: pull_request.head_ref.clone(),
                state: read_state(&pull_request.state, None),
                draft: pull_request.is_draft,
            }));
        }
        let Some(number) = remembered else { return Ok(None) };
        let details = github_panel::gh::github_get_pr_details(path, number, token)?;
        Ok(Some(BranchPullRequest {
            number,
            title: details.title.clone(),
            head_ref: details.head_ref.clone(),
            state: read_state(&details.state, details.merged_at.as_deref()),
            draft: details.is_draft,
        }))
    }))
}

/// The token to send: `None` outside means no token, so nothing is asked.
#[cfg(not(target_family = "wasm"))]
fn github_token(preference: github_panel::gh::TokenSourcePreference) -> Option<Option<String>> {
    github_panel::auth::find_token(preference).map(|token| Some(token.value))
}

#[cfg(target_family = "wasm")]
fn github_token(_preference: github_panel::gh::TokenSourcePreference) -> Option<Option<String>> {
    Some(None)
}

/// The branch checked out at `repo`: read from git on the desktop, asked of the workspace server
/// on the web.
#[cfg(not(target_family = "wasm"))]
fn current_branch(repo: &std::path::Path) -> Option<String> {
    crate::summary::git_branch(repo)
}

#[cfg(target_family = "wasm")]
fn current_branch(repo: &std::path::Path) -> Option<String> {
    github_panel::gh::repository(repo.to_string_lossy().into_owned()).ok().flatten()?.branch
}

/// A session with no view open, whose pull request the sidebar still follows.
#[derive(Clone, Debug, PartialEq)]
pub struct ClosedSession {
    pub id: String,
    pub repo: PathBuf,
    pub branch: Option<String>,
    pub status: SessionStatus,
}

/// The pull request each closed session's branch was last seen open in, so its merge is noticed
/// after the branch leaves the open list (`session-pull-requests.store.ts`).
#[derive(Default)]
struct Remembered(std::collections::HashMap<String, i64>);

impl Global for Remembered {}

const MAX_REMEMBERED: usize = 300;

/// Whether the sidebar can ask about a session: a local folder, and a branch of its own or a
/// pull request seen before.
pub fn follows(repo: &str, branch: Option<&str>, remembered: bool) -> bool {
    !repo.is_empty() && !repo.contains("://") && (session_branch(branch).is_some() || remembered)
}

/// The status a closed session shows: what it was before its pull request was laid over it,
/// with the pull request found now.
pub fn closed_status(status: SessionStatus, pull_request: Option<PullRequestState>) -> SessionStatus {
    let base = match status {
        SessionStatus::PrOpen | SessionStatus::Merged => SessionStatus::Idle,
        status => status,
    };
    overlay(base, pull_request)
}

/// Asks GitHub about the pull requests of closed sessions' branches (the sidebar's poll, every
/// minute), and answers each session's status where it changed. `None` without a [`Source`] or
/// with the GitHub feature off.
pub fn poll_closed_sessions(sessions: Vec<ClosedSession>, cx: &App) -> Option<gpui::Task<Vec<(String, SessionStatus)>>> {
    let source = cx.try_global::<Source>().cloned()?;
    let github_on = cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).core_features.github);
    if !github_on {
        return None;
    }
    let remembered = cx.try_global::<Remembered>().map(|remembered| remembered.0.clone()).unwrap_or_default();
    let sessions: Vec<(ClosedSession, Option<i64>)> = sessions
        .into_iter()
        .map(|session| {
            let number = remembered.get(&session.id).copied();
            (session, number)
        })
        .filter(|(session, number)| follows(&session.repo.to_string_lossy(), session.branch.as_deref(), number.is_some()))
        .collect();
    if sessions.is_empty() {
        return None;
    }
    Some(cx.spawn(async move |cx| {
        let found = cx
            .background_spawn(async move {
                sessions
                    .into_iter()
                    .filter_map(|(session, number)| {
                        let branch = session_branch(session.branch.as_deref()).unwrap_or_default().to_string();
                        let pull_request = (source.0)(session.repo.clone(), branch, number).ok()?;
                        Some((session, pull_request))
                    })
                    .collect::<Vec<_>>()
            })
            .await;
        cx.update(|cx| {
            let remembered = &mut cx.default_global::<Remembered>().0;
            let mut changed = Vec::new();
            for (session, pull_request) in found {
                if let Some(pull_request) = pull_request.as_ref().filter(|pull_request| pull_request.state == PullRequestState::Open) {
                    if remembered.len() >= MAX_REMEMBERED && !remembered.contains_key(&session.id) {
                        remembered.clear();
                    }
                    remembered.insert(session.id.clone(), pull_request.number);
                }
                let status = closed_status(session.status, pull_request.map(|pull_request| pull_request.state));
                if status != session.status {
                    changed.push((session.id, status));
                }
            }
            changed
        })
    }))
}

impl SessionView {
    /// Asks GitHub about the session's branch now and every minute while the view lives, when
    /// the app installed a [`Source`] and the GitHub feature is on.
    pub(crate) fn watch_pull_request(&mut self, cx: &mut Context<Self>) {
        let Some(source) = cx.try_global::<Source>().cloned() else { return };
        let github_on = cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).core_features.github);
        let Some(cwd) = self.info.cwd.clone().filter(|_| github_on) else { return };
        self.pull_request_poll = Some(cx.spawn(async move |this, cx| {
            loop {
                let remembered = this.update(cx, |this, _| this.pull_request.as_ref().map(|pull_request| pull_request.number)).ok().flatten();
                let lookup = source.clone();
                let repo = cwd.clone();
                let found = cx
                    .background_spawn(async move {
                        let branch = current_branch(&repo);
                        let branch = session_branch(branch.as_deref())?.to_string();
                        Some((lookup.0)(repo, branch, remembered))
                    })
                    .await;
                let keep_going = this
                    .update(cx, |this, cx| {
                        match found {
                            Some(Ok(pull_request)) => this.set_pull_request(pull_request, cx),
                            Some(Err(_)) => {}
                            None => this.set_pull_request(None, cx),
                        }
                    })
                    .is_ok();
                if !keep_going {
                    return;
                }
                cx.background_executor().timer(POLL).await;
            }
        }));
    }

    pub(crate) fn set_pull_request(&mut self, pull_request: Option<BranchPullRequest>, cx: &mut Context<Self>) {
        if self.pull_request == pull_request {
            return;
        }
        self.pull_request = pull_request;
        self.show_status(cx);
        cx.notify();
    }

    pub fn pull_request(&self) -> Option<&BranchPullRequest> {
        self.pull_request.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_pull_request_urls_and_states() {
        assert_eq!(pull_request_number("https://github.com/athasdev/athas/pull/913"), Some(913));
        assert_eq!(pull_request_number("https://github.com/athasdev/athas/pull/913/files?x=1"), Some(913));
        assert_eq!(pull_request_number("https://github.com/athasdev/athas/issues/913"), None);
        assert_eq!(read_state("closed", Some("2026-11-01T00:00:00Z")), PullRequestState::Merged);
        assert_eq!(read_state("OPEN", None), PullRequestState::Open);
        assert_eq!(read_state("closed", None), PullRequestState::Closed);
        assert_eq!(session_branch(Some("main")), None);
        assert_eq!(session_branch(Some("feature/dock")), Some("feature/dock"));
    }

    #[test]
    fn a_pull_request_shows_on_quiet_sessions_only() {
        assert_eq!(overlay(SessionStatus::Idle, Some(PullRequestState::Open)), SessionStatus::PrOpen);
        assert_eq!(overlay(SessionStatus::ReviewReady, Some(PullRequestState::Open)), SessionStatus::ReviewReady);
        assert_eq!(overlay(SessionStatus::ReviewReady, Some(PullRequestState::Merged)), SessionStatus::Merged);
        assert_eq!(overlay(SessionStatus::Running, Some(PullRequestState::Merged)), SessionStatus::Running);
        assert_eq!(overlay(SessionStatus::Idle, Some(PullRequestState::Closed)), SessionStatus::Idle);
    }

    #[test]
    fn closed_sessions_follow_their_pull_request() {
        assert!(follows("/w/app", Some("feature/x"), false));
        assert!(!follows("/w/app", Some("main"), false));
        assert!(follows("/w/app", Some("main"), true));
        assert!(!follows("remote://host/w", Some("feature/x"), false));
        assert_eq!(closed_status(SessionStatus::Idle, Some(PullRequestState::Open)), SessionStatus::PrOpen);
        assert_eq!(closed_status(SessionStatus::PrOpen, Some(PullRequestState::Merged)), SessionStatus::Merged);
        assert_eq!(closed_status(SessionStatus::PrOpen, Some(PullRequestState::Closed)), SessionStatus::Idle);
        assert_eq!(closed_status(SessionStatus::Merged, None), SessionStatus::Idle);
    }
}
