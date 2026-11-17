//! The `git.*` and `github.*` commands (`git-command-actions.ts`, `github-command-actions.ts`):
//! each opens Source Control or GitHub in the sidebar and hands the command to its panel.

use std::path::Path;

use gpui::{Context, Div, Stateful, Window, prelude::*};
use git_panel::GitCommand;
use github_panel::GitHubCommand;
use workspace::SidebarView;

use crate::{ShowGitHub, Workbench};

pub(crate) fn register(cx: &mut gpui::App) {
    git_panel::init(cx);
    // Discarded changes are kept in Local History first (`snapshotFilesBeforeDiscard`).
    if let Some(history) = local_history::LocalHistory::default_location() {
        let history = std::sync::Arc::new(history);
        git_panel::set_discard_snapshot(cx, std::sync::Arc::new(move |path: &Path| history.record(path, "discard", None).map(|_| ())));
    }
    github_panel::init(cx);
    keymap::register(cx, "view.showPullRequests", ShowGitHub);
}

impl Workbench {
    fn run_git_command(&mut self, command: GitCommand, window: &mut Window, cx: &mut Context<Self>) {
        self.show_sidebar_view(SidebarView::Git, window, cx);
        self.sync_tool_views(window, cx);
        if let Some((panel, _)) = &self.git_panel {
            panel.update(cx, |panel, cx| panel.run_command(command, window, cx));
        }
    }

    fn run_github_command(&mut self, command: GitHubCommand, window: &mut Window, cx: &mut Context<Self>) {
        self.show_sidebar_view(SidebarView::GitHub, window, cx);
        self.sync_tool_views(window, cx);
        if let Some((panel, _)) = &self.github_panel {
            panel.update(cx, |panel, cx| panel.run_command(command, cx));
        }
    }
}

/// The commands' handlers on the workbench root. Also keeps the workflow run watcher on the
/// project in front (`githubActionNotifications`).
pub(crate) fn handlers(root: Stateful<Div>, project: Option<&Path>, cx: &mut Context<Workbench>) -> Stateful<Div> {
    let git = |command: GitCommand| move |this: &mut Workbench, window: &mut Window, cx: &mut Context<Workbench>| this.run_git_command(command, window, cx);
    let stage_all = git(GitCommand::StageAll);
    let unstage_all = git(GitCommand::UnstageAll);
    let commit = git(GitCommand::Commit);
    let push = git(GitCommand::Push);
    let pull = git(GitCommand::Pull);
    let fetch = git(GitCommand::Fetch);
    let discard_all = git(GitCommand::DiscardAll);
    let refresh = git(GitCommand::Refresh);
    let root = root
        .on_action(cx.listener(move |this, _: &git_panel::StageAll, window, cx| stage_all(this, window, cx)))
        .on_action(cx.listener(move |this, _: &git_panel::UnstageAll, window, cx| unstage_all(this, window, cx)))
        .on_action(cx.listener(move |this, _: &git_panel::CommitChanges, window, cx| commit(this, window, cx)))
        .on_action(cx.listener(move |this, _: &git_panel::Push, window, cx| push(this, window, cx)))
        .on_action(cx.listener(move |this, _: &git_panel::Pull, window, cx| pull(this, window, cx)))
        .on_action(cx.listener(move |this, _: &git_panel::Fetch, window, cx| fetch(this, window, cx)))
        .on_action(cx.listener(move |this, _: &git_panel::DiscardAll, window, cx| discard_all(this, window, cx)))
        .on_action(cx.listener(move |this, _: &git_panel::Refresh, window, cx| refresh(this, window, cx)));
    github_handlers(root, project, cx)
}

/// The GitHub panel's handlers.
fn github_handlers(root: Stateful<Div>, project: Option<&Path>, cx: &mut Context<Workbench>) -> Stateful<Div> {
    let github_on = cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).core_features.github);
    github_panel::watch_actions(project.filter(|_| github_on), cx);
    github_panel::watch_notifications(project, cx);
    let github = |command: GitHubCommand| move |this: &mut Workbench, window: &mut Window, cx: &mut Context<Workbench>| this.run_github_command(command, window, cx);
    let new_release = github(GitHubCommand::NewRelease);
    let refresh_github = github(GitHubCommand::Refresh);
    let check_auth = github(GitHubCommand::CheckAuthentication);
    root.on_action(cx.listener(move |this, _: &github_panel::NewRelease, window, cx| new_release(this, window, cx)))
        .on_action(cx.listener(move |this, _: &github_panel::RefreshGitHub, window, cx| refresh_github(this, window, cx)))
        .on_action(cx.listener(move |this, _: &github_panel::CheckAuthentication, window, cx| check_auth(this, window, cx)))
        .on_action(cx.listener(|_, _: &github_panel::ConnectAccount, _, cx| account::open_service_url(cx, account::ServiceUrls::integrations)))
}
