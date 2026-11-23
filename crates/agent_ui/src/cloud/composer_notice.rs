//! What stands between a Cloud composer and a run it can start (`cloud-composer-notice.tsx`):
//! an agent that only runs locally, GitHub not connected, or no repository to run in. It shows
//! over the composer of a cloud session that has not started yet, under the composer notice.

use ui::scale::px;
use gpui::{AnyElement, ClickEvent, Context, IntoElement, ParentElement, Styled, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, typography};

use super::{CloudError, session::CloudEnvironment};
use crate::SessionView;

/// What the session learned about the repositories it could run in (`useCloudTargets`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CloudTargets {
    pub repos_loading: bool,
    /// The repository or branch list said GitHub is not connected.
    pub github_not_connected: bool,
    /// The project's own GitHub repository was looked for.
    pub project_repo_resolved: bool,
    pub project_repo: Option<String>,
}

impl CloudTargets {
    /// Notes what a repository or branch request answered.
    pub fn heard<T>(&mut self, result: &Result<T, CloudError>) {
        self.github_not_connected = matches!(result, Err(CloudError::Http { code: Some(code), .. }) if code == "github_not_connected");
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloudNoticeAction {
    UseClaudeCode,
    ConnectGithub,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CloudNotice {
    pub id: &'static str,
    pub icon: IconName,
    pub title: &'static str,
    pub description: String,
    pub action: Option<(CloudNoticeAction, &'static str)>,
}

/// The notice for a cloud session's composer, if one applies. `locked` is a session that already
/// has a conversation; where it runs is settled then.
pub fn resolve(cloud_agents: bool, environment: Option<&CloudEnvironment>, locked: bool, agent: &str, agent_name: &str, can_change_agent: bool, targets: &CloudTargets) -> Option<CloudNotice> {
    let environment = environment?;
    if !cloud_agents || locked {
        return None;
    }
    if super::session::cloud_agent(agent).is_none() {
        let who = if crate::builtin::is_builtin(agent) { "This model".to_string() } else { agent_name.to_string() };
        return Some(CloudNotice {
            id: "agent",
            icon: IconName::Warning,
            title: "Cloud runs use Claude Code or Codex",
            description: format!("{who} only runs on this machine."),
            action: can_change_agent.then_some((CloudNoticeAction::UseClaudeCode, "Use Claude Code")),
        });
    }
    if targets.github_not_connected {
        return Some(CloudNotice {
            id: "github",
            icon: IconName::CloudWarning,
            title: "Connect GitHub",
            description: "Cloud agents clone your repository and open a pull request through GitHub.".into(),
            action: Some((CloudNoticeAction::ConnectGithub, "Connect GitHub")),
        });
    }
    if environment.repo.is_none() && targets.project_repo_resolved && !targets.repos_loading && targets.project_repo.is_none() {
        return Some(CloudNotice {
            id: "repo",
            icon: IconName::CloudWarning,
            title: "Choose a repository",
            description: "This project has no GitHub remote. Pick the repository the agent clones.".into(),
            action: None,
        });
    }
    None
}

impl SessionView {
    /// Looks up the project's repository and whether GitHub is connected, for the notice.
    pub(crate) fn load_cloud_targets(&mut self, cx: &mut Context<Self>) {
        self.cloud_targets.project_repo = self.info.cwd.as_deref().and_then(crate::chat_link::project_repository).map(|(owner, name)| format!("{owner}/{name}"));
        self.cloud_targets.project_repo_resolved = true;
        if std::env::var_os("ATHAS_AGENT_FIXTURE").is_some() {
            return;
        }
        self.cloud_targets.repos_loading = true;
        let client = super::CloudClient::from_account(cx);
        cx.spawn(async move |this, cx| {
            let repos = cx.background_spawn(async move { client.repos() }).await;
            this.update(cx, |this, cx| {
                this.cloud_targets.repos_loading = false;
                this.cloud_targets.heard(&repos);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Whether the account can run agents in the cloud (`useProFeature().hasCloudAgents`); the
    /// composer's environment chip and its notice show only then.
    pub(crate) fn has_cloud_agents(cx: &gpui::App) -> bool {
        account::AccountStore::global(cx).is_some_and(|store| {
            let store = store.read(cx);
            account::gates::has_capability(store.subscription(), account::gates::Capability::CloudAgents)
        }) || std::env::var_os("ATHAS_AGENT_FIXTURE").is_some()
    }

    fn cloud_notice(&self, cx: &gpui::App) -> Option<CloudNotice> {
        let cloud_agents = Self::has_cloud_agents(cx);
        let locked = !self.transcript.entries.is_empty();
        let can_change_agent = !matches!(self.agent, crate::session_view::AgentState::Ready(_) | crate::session_view::AgentState::Starting);
        resolve(cloud_agents, self.transcript.cloud.as_ref(), locked, &self.info.agent, &self.agent_name(), can_change_agent, &self.cloud_targets)
    }

    pub(crate) fn render_cloud_composer_notice(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let notice = self.cloud_notice(cx)?;
        let colors = cx.theme().colors.clone();
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(12.))
                .px(px(12.))
                .py(px(8.))
                .rounded(ui::metrics::radius_lg())
                .border_1()
                .border_color(colors.border)
                .bg(colors.raised)
                .id(notice.id)
                .child(Icon::new(notice.icon).size(IconSize::Small).color(colors.warning))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(notice.title))
                        .child(div().text_size(typography::text_caption()).text_color(colors.muted_foreground).child(notice.description.clone())),
                )
                .children(notice.action.map(|(action, label)| {
                    Button::new("cloud-notice-action", label).variant(ButtonVariant::Default).size(ButtonSize::Small).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| match action {
                        CloudNoticeAction::UseClaudeCode => this.set_agent(super::session::session_agent("claude-code").to_string(), cx),
                        CloudNoticeAction::ConnectGithub => account::open_service_url(cx, account::ServiceUrls::integrations),
                    }))
                }))
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cloud(repo: Option<&str>) -> CloudEnvironment {
        CloudEnvironment { repo: repo.map(str::to_string), ..Default::default() }
    }

    #[test]
    fn the_notice_names_what_blocks_a_cloud_run() {
        let targets = CloudTargets { project_repo_resolved: true, ..Default::default() };
        assert_eq!(resolve(true, None, false, "claude-code", "Claude Code", true, &targets), None);
        assert_eq!(resolve(false, Some(&cloud(None)), false, "gemini", "Gemini", true, &targets), None);
        assert_eq!(resolve(true, Some(&cloud(None)), true, "gemini", "Gemini", true, &targets), None);

        let agent = resolve(true, Some(&cloud(None)), false, "gemini", "Gemini CLI", true, &targets).unwrap();
        assert_eq!((agent.id, agent.description.as_str()), ("agent", "Gemini CLI only runs on this machine."));
        assert_eq!(agent.action.map(|(action, _)| action), Some(CloudNoticeAction::UseClaudeCode));
        let builtin = resolve(true, Some(&cloud(None)), false, crate::builtin::AGENT_ID, "Athas", false, &targets).unwrap();
        assert_eq!((builtin.description.as_str(), builtin.action), ("This model only runs on this machine.", None));

        let github = CloudTargets { github_not_connected: true, ..targets.clone() };
        assert_eq!(resolve(true, Some(&cloud(Some("a/b"))), false, "codex", "Codex", true, &github).unwrap().id, "github");

        assert_eq!(resolve(true, Some(&cloud(None)), false, "codex", "Codex", true, &targets).unwrap().id, "repo");
        assert_eq!(resolve(true, Some(&cloud(Some("a/b"))), false, "codex", "Codex", true, &targets), None);
        let loading = CloudTargets { repos_loading: true, ..targets };
        assert_eq!(resolve(true, Some(&cloud(None)), false, "codex", "Codex", true, &loading), None);
    }

    #[test]
    fn a_github_error_is_remembered_until_a_list_loads() {
        let mut targets = CloudTargets::default();
        targets.heard::<()>(&Err(CloudError::Http { status: 403, code: Some("github_not_connected".into()), message: String::new() }));
        assert!(targets.github_not_connected);
        targets.heard(&Ok(()));
        assert!(!targets.github_not_connected);
    }
}
