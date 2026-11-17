//! Chats that run in the cloud: a session turned to Cloud sends each prompt as a cloud run on its
//! repository and branch, and the run's log fills the reply. A follow-up starts the next run from
//! the branch the last one pushed when that one opened a pull request.
//!
//! Ported from Athas's `cloud-agents/services/cloud-session.ts`, `cloud-environment.ts`
//! (`getNextRunBaseBranch`), `components/composer-environment-controls.tsx` and
//! `components/cloud-session-sync.tsx`.

use std::time::Duration;

use gpui::{AppContext as _, ClickEvent, Context, Window};
use serde::{Deserialize, Serialize};
use ui::{IconName, MenuEntry, MenuItem};

use super::{CloudClient, CloudRun, RunStatus, StartRun, api::LogLine};
use crate::{session_view::SessionView, thread::Entry};

const POLL: Duration = Duration::from_secs(3);

/// The time limits a cloud run can have, in minutes.
pub const MAX_MINUTES_OPTIONS: [u64; 3] = [30, 60, 120];
pub const DEFAULT_MAX_MINUTES: u64 = 60;
const PREFERENCES_KEY: &str = "cloudAgentPreferences";

/// How cloud runs start: on the user's own Anthropic or OpenAI key instead of Athas credit, and
/// how long they may take.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CloudPreferences {
    pub use_own_key: bool,
    pub max_minutes: u64,
}

impl Default for CloudPreferences {
    fn default() -> Self {
        Self { use_own_key: false, max_minutes: DEFAULT_MAX_MINUTES }
    }
}

impl CloudPreferences {
    pub fn read(cx: &gpui::App) -> Self {
        if cx.try_global::<settings::SettingsStore>().is_none() {
            return Self::default();
        }
        settings::get(cx).extra.get(PREFERENCES_KEY).and_then(|value| serde_json::from_value(value.clone()).ok()).unwrap_or_default()
    }

    pub fn save(self, cx: &mut gpui::App) {
        if cx.try_global::<settings::SettingsStore>().is_none() {
            return;
        }
        let value = serde_json::to_value(self).unwrap_or_default();
        settings::update(cx, move |settings| {
            settings.extra.insert(PREFERENCES_KEY.into(), value);
        });
    }
}

/// "30 min", "1 hour", "2 hours".
/// The Local row's caption (`THIS_MACHINE`).
const THIS_MACHINE: &str = if cfg!(target_os = "macos") {
    "This Mac"
} else if cfg!(target_os = "windows") {
    "This PC"
} else {
    "This computer"
};

pub fn format_minutes(minutes: u64) -> String {
    match minutes {
        60 => "1 hour".into(),
        minutes if minutes % 60 == 0 => format!("{} hours", minutes / 60),
        minutes => format!("{minutes} min"),
    }
}

/// The key to send for `agent` when the user runs on their own key; an error naming what to add
/// when it is missing (`resolveCredentials`).
pub fn credentials(agent: &str, key: impl FnOnce(&str) -> Option<String>) -> Result<super::api::Credentials, String> {
    let openai = agent == "codex";
    let key = key(if openai { "openai" } else { "anthropic" })
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| format!("Add your {} API key in Settings > AI, or turn off \"Use my own API key\".", if openai { "OpenAI" } else { "Anthropic" }))?;
    Ok(if openai { super::api::Credentials { openai_api_key: Some(key), ..Default::default() } } else { super::api::Credentials { anthropic_api_key: Some(key), ..Default::default() } })
}

/// Where a session's prompts run when it runs in the cloud, and the runs it started.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CloudEnvironment {
    /// `owner/name` on GitHub.
    pub repo: Option<String>,
    /// The branch the first run starts from; the repository's default when `None`.
    pub branch: Option<String>,
    pub runs: Vec<CloudSessionRun>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CloudSessionRun {
    /// The agent message the run's log fills.
    pub entry: usize,
    pub run_id: Option<String>,
    /// Why the service refused the run.
    pub error: Option<String>,
    /// What fixes the refusal, such as connecting GitHub or adding credit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<super::environment::ProblemAction>,
}

/// The session agent a cloud run's agent is (`fromCloudAgentId`).
pub fn session_agent(cloud_agent: &str) -> &'static str {
    if cloud_agent == "codex" { "codex" } else { "claude-code" }
}

/// Runs waiting for the workbench to open them as sessions, by id.
#[derive(Default)]
struct PendingRuns(std::collections::HashMap<String, CloudRun>);

impl gpui::Global for PendingRuns {}

/// Opens a run started elsewhere as a session: the one that already follows it, or a new one.
pub fn open_run_as_session(run: CloudRun, cx: &mut gpui::App) {
    let id = run.id.clone();
    cx.default_global::<PendingRuns>().0.insert(id.clone(), run);
    workbench_api::request(cx, workbench_api::OpenRequest::CloudRunSession { run_id: id });
}

/// The run [`open_run_as_session`] left for the workbench.
pub fn take_pending_run(run_id: &str, cx: &mut gpui::App) -> Option<CloudRun> {
    cx.try_global::<PendingRuns>()?;
    cx.global_mut::<PendingRuns>().0.remove(run_id)
}

/// The cloud agent a session's agent runs as, when it can run in the cloud.
pub fn cloud_agent(agent: &str) -> Option<&'static str> {
    if crate::codex::is_codex(agent) {
        return Some("codex");
    }
    match crate::acp::agents::catalog_id(agent) {
        "claude-acp" | "claude-code" | "claude" => Some("claude-code"),
        _ => None,
    }
}

/// The branch the next run starts from: the last run's own branch when it finished with a pull
/// request, so a follow-up builds on it; else the session's branch.
pub fn next_base_branch(cloud: &CloudEnvironment, previous: Option<&CloudRun>) -> Option<String> {
    if let Some(run) = previous
        && run.status == RunStatus::Succeeded
        && run.pr_url.is_some()
        && !run.branch.is_empty()
    {
        return Some(run.branch.clone());
    }
    cloud.branch.clone()
}

/// Why a session cannot send its next prompt to the cloud (`getCloudSendBlocker`).
pub fn send_blocker(agent: &str, cloud: &CloudEnvironment, latest_active: bool) -> Option<&'static str> {
    if cloud_agent(agent).is_none() {
        return Some("Cloud runs use Claude Code or Codex. Switch the agent to run this in the cloud.");
    }
    if let Some(latest) = cloud.runs.last()
        && latest.error.is_none()
        && (latest.run_id.is_none() || latest_active)
    {
        return Some("The cloud run is still working. Stop it or wait for it to finish.");
    }
    if cloud.repo.is_none() {
        return Some("Pick a GitHub repository for the cloud run.");
    }
    None
}

/// The reply a run's log reads as so far.
pub fn reply_text(run: Option<&CloudRun>, log: &[LogLine]) -> String {
    let transcript = super::transcript::build(log);
    let mut text = transcript.content.trim().to_string();
    if let Some(run) = run {
        if text.is_empty() {
            text = match run.status {
                RunStatus::Queued => "_Waiting for a cloud machine…_".to_string(),
                status if status.is_active() => "_Working in the cloud…_".to_string(),
                _ => String::new(),
            };
        }
        if let Some(url) = &run.pr_url {
            text.push_str(&format!("\n\nPull request: {url}"));
        }
        if let Some(error) = run.error.as_deref().filter(|_| !run.status.is_active() && run.status != RunStatus::Succeeded) {
            text.push_str(&format!("\n\n**{}:** {error}", run.status.label()));
        }
    }
    text.trim().to_string()
}

impl SessionView {
    fn cloud_client(&self, cx: &gpui::App) -> CloudClient {
        CloudClient::from_account(cx)
    }

    /// Sets a new session to run in the cloud (`openNewCloudAgentChat`).
    pub fn start_in_cloud(&mut self, cx: &mut Context<Self>) {
        self.set_environment(true, cx);
    }

    /// Whether the session follows the cloud run `run_id`.
    pub fn follows_cloud_run(&self, run_id: &str) -> bool {
        self.transcript.cloud.as_ref().is_some_and(|cloud| cloud.runs.iter().any(|run| run.run_id.as_deref() == Some(run_id)))
    }

    pub fn cloud_environment(&self) -> Option<&CloudEnvironment> {
        self.transcript.cloud.as_ref()
    }

    /// Turns the session's runs to the cloud, or back to this machine (`setChatEnvironmentKind`).
    pub(crate) fn set_environment(&mut self, cloud: bool, cx: &mut Context<Self>) {
        if cloud {
            if self.transcript.cloud.is_none() {
                let repo = self.info.cwd.as_deref().and_then(crate::chat_link::project_repository).map(|(owner, name)| format!("{owner}/{name}"));
                self.transcript.cloud = Some(CloudEnvironment { repo, ..Default::default() });
            }
            if !self.cloud_targets.project_repo_resolved {
                self.load_cloud_targets(cx);
            }
        } else if self.transcript.cloud.as_ref().is_some_and(|cloud| cloud.runs.is_empty()) {
            self.transcript.cloud = None;
        } else if self.transcript.cloud.is_some() {
            notifications::info(cx, "This session already ran in the cloud; start a new chat to run on this machine.");
        }
        self.update_placeholder(cx);
        cx.notify();
    }

    pub(crate) fn open_environment_menu(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.open_environment_menu_at(event.position(), window, cx);
    }

    pub(crate) fn open_environment_menu_at(&mut self, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let view = cx.entity();
        let cloud = self.transcript.cloud.is_some();
        let capable = cloud_agent(&self.info.agent).is_some();
        let local_view = view.clone();
        let mut entries = vec![
            MenuEntry::Item(MenuItem::new("Local").icon(IconName::Laptop).trailing_text(THIS_MACHINE).checked(!cloud).on_select(move |_, cx| {
                local_view.update(cx, |this, cx| this.set_environment(false, cx));
            })),
            MenuEntry::Item(MenuItem::new("Cloud").icon(IconName::Cloud).trailing_text("Opens a pull request").checked(cloud).disabled(!capable && !cloud).on_select(move |_, cx| {
                view.update(cx, |this, cx| this.set_environment(true, cx));
            })),
        ];
        if cloud {
            let preferences = CloudPreferences::read(cx);
            let limits = MAX_MINUTES_OPTIONS
                .iter()
                .map(|minutes| {
                    let minutes = *minutes;
                    MenuEntry::Item(MenuItem::new(format_minutes(minutes)).checked(preferences.max_minutes == minutes).on_select(move |_, cx| {
                        CloudPreferences { max_minutes: minutes, ..CloudPreferences::read(cx) }.save(cx);
                    }))
                })
                .collect();
            entries.push(MenuEntry::Separator);
            entries.push(MenuEntry::Label("Cloud run".into()));
            entries.push(MenuEntry::Item(MenuItem::new("Time limit").trailing_text(format_minutes(preferences.max_minutes)).submenu(limits)));
            entries.push(MenuEntry::Item(MenuItem::new("Use my own API key").checked(preferences.use_own_key).on_select(|_, cx| {
                let preferences = CloudPreferences::read(cx);
                CloudPreferences { use_own_key: !preferences.use_own_key, ..preferences }.save(cx);
            })));
        }
        self.show_menu_at("environment", entries, position, window, cx);
    }

    /// The repositories the account's GitHub connection reaches, to run on.
    pub(crate) fn open_cloud_repo_menu(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        let position = event.position();
        let client = self.cloud_client(cx);
        let window_handle = window.window_handle();
        cx.spawn(async move |this, cx| {
            let repos = cx.background_spawn(async move { client.repos() }).await;
            cx.update_window(window_handle, |_, window, cx| {
                this.update(cx, |this, cx| {
                    let current = this.transcript.cloud.as_ref().and_then(|cloud| cloud.repo.clone());
                    let project_repo = this.info.cwd.clone().and_then(|cwd| super::sidebar::project_repo(&cwd, cx));
                    this.cloud_targets.heard(&repos);
                    let repos = repos.map(|repos| super::environment::order_repos(repos, project_repo.as_deref()));
                    let entries = match repos {
                        Ok(repos) if !repos.is_empty() => repos
                            .into_iter()
                            .map(|repo| {
                                let view = cx.entity();
                                let name = repo.full_name.clone();
                                let mut item = MenuItem::new(repo.full_name.clone()).icon(if repo.private { IconName::Lock } else { IconName::Github }).checked(current.as_deref() == Some(&repo.full_name));
                                if project_repo.as_deref().is_some_and(|project| project.eq_ignore_ascii_case(&repo.full_name)) {
                                    item = item.trailing_text("This project");
                                }
                                MenuEntry::Item(item.on_select(move |_, cx| {
                                    let name = name.clone();
                                    view.update(cx, |this, cx| {
                                        if let Some(cloud) = &mut this.transcript.cloud
                                            && cloud.repo.as_deref() != Some(&name)
                                        {
                                            cloud.repo = Some(name);
                                            cloud.branch = None;
                                        }
                                        cx.notify();
                                    });
                                }))
                            })
                            .collect(),
                        Ok(_) => vec![MenuEntry::Item(MenuItem::new("No repositories found").disabled(true))],
                        Err(super::api::CloudError::Http { code: Some(code), .. }) if code == "github_not_connected" => vec![
                            MenuEntry::Item(MenuItem::new("Connect GitHub to list your repositories.").disabled(true)),
                            MenuEntry::Item(MenuItem::new("Connect GitHub").icon(IconName::Github).trailing_text("↗").on_select(|_, cx| account::open_service_url(cx, account::ServiceUrls::integrations))),
                        ],
                        Err(_) => vec![MenuEntry::Item(MenuItem::new("Your other repositories could not be loaded.").disabled(true))],
                    };
                    this.open_menu = Some(ui::OpenMenu::new("cloud-repo", entries, position, gpui::Anchor::BottomLeft, window, cx, |this, _| this.open_menu = None));
                    if let Some(menu) = this.open_menu.take() {
                        this.open_menu = Some(menu.searchable("Search repositories…", "No matching repositories", cx));
                    }
                    cx.notify();
                })
            })
            .ok();
        })
        .detach();
    }

    /// The repository's branches, the first run's base.
    pub(crate) fn open_cloud_branch_menu(&mut self, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(repo) = self.transcript.cloud.as_ref().and_then(|cloud| cloud.repo.clone()) else { return };
        let position = event.position();
        let client = self.cloud_client(cx);
        let window_handle = window.window_handle();
        cx.spawn(async move |this, cx| {
            let branches = cx.background_spawn(async move { client.branches(&repo) }).await;
            cx.update_window(window_handle, |_, window, cx| {
                this.update(cx, |this, cx| {
                    let current = this.transcript.cloud.as_ref().and_then(|cloud| cloud.branch.clone());
                    this.cloud_targets.heard(&branches);
                    let entries = match branches {
                        Ok((_, branches)) if branches.is_empty() => vec![MenuEntry::Item(MenuItem::new("No branches found").disabled(true))],
                        Ok((default, branches)) => branches
                            .into_iter()
                            .map(|branch| {
                                let view = cx.entity();
                                let chosen = branch.clone();
                                let checked = current.as_ref().or(default.as_ref()) == Some(&branch);
                                let mut item = MenuItem::new(branch.clone()).icon(IconName::GitBranch).checked(checked);
                                if default.as_ref() == Some(&branch) {
                                    item = item.trailing_text("default");
                                }
                                MenuEntry::Item(item.on_select(move |_, cx| {
                                    let chosen = chosen.clone();
                                    view.update(cx, |this, cx| {
                                        if let Some(cloud) = &mut this.transcript.cloud {
                                            cloud.branch = Some(chosen);
                                        }
                                        cx.notify();
                                    });
                                }))
                            })
                            .collect(),
                        Err(error) => vec![MenuEntry::Item(MenuItem::new(error.to_string()).disabled(true))],
                    };
                    this.open_menu = Some(ui::OpenMenu::new("cloud-branch", entries, position, gpui::Anchor::BottomLeft, window, cx, |this, _| this.open_menu = None));
                    if let Some(menu) = this.open_menu.take() {
                        this.open_menu = Some(menu.searchable("Search branches…", "No matching branches", cx));
                    }
                    cx.notify();
                })
            })
            .ok();
        })
        .detach();
    }

    /// Sends `prompt` as the session's next cloud run (`startCloudSessionRun`); the prompt and an
    /// empty reply land in the transcript at once. `Err` says why it cannot run.
    pub(crate) fn send_to_cloud(&mut self, prompt: String, cx: &mut Context<Self>) -> Result<(), &'static str> {
        let cloud = self.transcript.cloud.clone().ok_or("This session does not run in the cloud.")?;
        if let Some(blocker) = send_blocker(&self.info.agent, &cloud, self.cloud_poll.is_some()) {
            return Err(blocker);
        }
        let agent = cloud_agent(&self.info.agent).ok_or("Cloud runs use Claude Code or Codex.")?;
        let first = self.transcript.first_prompt().is_none();
        let index = self.transcript.push_user(prompt.clone(), Vec::new());
        self.transcript.entries.push(Entry::Agent(crate::thread::AgentMessage { message_id: None, text: "_Starting cloud run…_".to_string(), ..Default::default() }));
        let entry = self.transcript.entries.len() - 1;
        self.entries_added(index, cx);
        if let Some(cloud) = &mut self.transcript.cloud {
            cloud.runs.push(CloudSessionRun { entry, ..Default::default() });
        }
        if first && let Some(title) = crate::title::title_from_prompt(&prompt) {
            self.set_title(title, cx);
        }
        let previous = self.last_cloud_run.clone();
        let base_branch = next_base_branch(&cloud, previous.as_ref());
        let input = StartRun { repo: cloud.repo.clone().unwrap_or_default(), base_branch: base_branch.unwrap_or_default(), prompt, agent: agent.to_string(), ..Default::default() };
        self.request_cloud_run(entry, input, cx);
        Ok(())
    }

    fn request_cloud_run(&mut self, entry: usize, mut input: StartRun, cx: &mut Context<Self>) {
        let client = self.cloud_client(cx);
        let preferences = CloudPreferences::read(cx);
        input.max_minutes = Some(preferences.max_minutes);
        if preferences.use_own_key {
            let keychain = ai_providers::Keychain::shared();
            match credentials(&input.agent, |provider| {
                use ai_providers::SecretStore as _;
                keychain.get(&ai_providers::secrets::provider_key_account(provider))
            }) {
                Ok(credentials) => input.credentials = Some(credentials),
                Err(error) => {
                    self.set_cloud_run(entry, |run| run.error = Some(error.clone()));
                    self.set_entry_text(entry, format!("**The cloud run did not start.** {error}"), cx);
                    self.finish_cloud_run(true, cx);
                    return;
                }
            }
        }
        self.set_running_status(cx);
        let project_repo = self.info.cwd.as_deref().and_then(crate::chat_link::project_repository).map(|(owner, name)| format!("{owner}/{name}"));
        let local_project = self.info.cwd.clone().filter(|_| project_repo.as_deref().is_some_and(|repo| repo.eq_ignore_ascii_case(&input.repo)));
        self.cloud_poll = Some(cx.spawn(async move |this, cx| {
            if input.base_branch.is_empty() {
                let repo = input.repo.clone();
                let lookup = client.clone();
                input.base_branch = cx
                    .background_spawn(async move {
                        let local = local_project.as_deref().and_then(crate::summary::git_branch);
                        let remote = lookup.branches(&repo).ok();
                        super::environment::pick_default_branch(local.as_deref(), remote.as_ref().map(|(default, branches)| (default.as_deref(), branches.as_slice())))
                    })
                    .await
                    .unwrap_or_else(|| "main".to_string());
            }
            let started = {
                let client = client.clone();
                cx.background_spawn(async move { client.start_run(&input) }).await
            };
            let run = match started {
                Ok(run) => run,
                Err(error) => {
                    this.update(cx, |this, cx| {
                        let problem = super::environment::describe_problem(&error);
                        this.set_cloud_run(entry, |run| {
                            run.error = Some(error.to_string());
                            run.action = problem.action.map(|(action, _)| action);
                        });
                        this.set_entry_text(entry, format!("**{}.** {}", problem.title.trim_end_matches('.'), problem.description), cx);
                        this.finish_cloud_run(true, cx);
                    })
                    .ok();
                    return;
                }
            };
            let id = run.id.clone();
            if this.update(cx, |this, _| this.set_cloud_run(entry, |entry_run| entry_run.run_id = Some(id.clone()))).is_err() {
                return;
            }
            follow_run(this, entry, client, run, cx).await;
        }));
        cx.notify();
    }

    /// Makes this empty session the session of a run started elsewhere (another device, or the
    /// Cloud Agents list): its prompt, the reply its log fills, and its repository
    /// (`openCloudRunSession`).
    pub fn adopt_cloud_run(&mut self, run: CloudRun, cx: &mut Context<Self>) {
        let prompt = run.prompt.as_deref().map(str::trim).filter(|prompt| !prompt.is_empty()).unwrap_or(&run.title).to_string();
        let index = self.transcript.push_user(prompt, Vec::new());
        self.entries_added(index, cx);
        self.transcript.entries.push(Entry::Agent(crate::thread::AgentMessage::default()));
        let entry = self.transcript.entries.len() - 1;
        self.entries_added(entry, cx);
        self.transcript.cloud = Some(CloudEnvironment {
            repo: Some(run.repo.clone()),
            branch: Some(run.base_branch.clone()).filter(|branch| !branch.is_empty()),
            runs: vec![CloudSessionRun { entry, run_id: Some(run.id.clone()), ..Default::default() }],
        });
        self.set_title(run.title.clone(), cx);
        let client = self.cloud_client(cx);
        if run.status.is_active() {
            self.set_running_status(cx);
        }
        self.cloud_poll = Some(cx.spawn(async move |this, cx| follow_run(this, entry, client, run, cx).await));
        cx.notify();
    }

    fn set_cloud_run(&mut self, entry: usize, update: impl FnOnce(&mut CloudSessionRun)) {
        if let Some(run) = self.transcript.cloud.as_mut().and_then(|cloud| cloud.runs.iter_mut().find(|run| run.entry == entry)) {
            update(run);
        }
    }

    fn set_entry_text(&mut self, entry: usize, text: String, cx: &mut Context<Self>) {
        if let Some(Entry::Agent(message)) = self.transcript.entries.get_mut(entry)
            && message.text != text
        {
            message.text = text;
            self.entry_changed(entry);
            cx.notify();
        }
    }

    fn finish_cloud_run(&mut self, failed: bool, cx: &mut Context<Self>) {
        self.cloud_poll = None;
        self.finish_cloud_status(failed, cx);
    }

    /// Sends a refused run's prompt again (`retryCloudRun`).
    pub(crate) fn retry_cloud_run(&mut self, entry: usize, cx: &mut Context<Self>) {
        let Some(cloud) = self.transcript.cloud.clone() else { return };
        let Some(agent) = cloud_agent(&self.info.agent) else { return };
        let prompt = self.transcript.entries[..entry.min(self.transcript.entries.len())].iter().rev().find_map(|candidate| match candidate {
            Entry::User(message) => Some(message.text.clone()),
            _ => None,
        });
        let (Some(prompt), Some(repo)) = (prompt, cloud.repo.clone()) else { return };
        self.set_cloud_run(entry, |run| {
            run.error = None;
            run.action = None;
        });
        self.set_entry_text(entry, "_Starting cloud run…_".to_string(), cx);
        let input = StartRun { repo, base_branch: next_base_branch(&cloud, self.last_cloud_run.as_ref()).unwrap_or_default(), prompt, agent: agent.to_string(), ..Default::default() };
        self.request_cloud_run(entry, input, cx);
    }

    /// Stops the cloud run going now.
    pub(crate) fn cancel_cloud_run(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.transcript.cloud.as_ref().and_then(|cloud| cloud.runs.last()).and_then(|run| run.run_id.clone()) else { return };
        let client = self.cloud_client(cx);
        cx.background_spawn(async move {
            let _ = client.cancel_run(&id);
        })
        .detach();
    }
}

/// Follows `run` into the reply at `entry` until it ends: its log as text, its tool calls under it.
async fn follow_run(this: gpui::WeakEntity<SessionView>, entry: usize, client: CloudClient, run: CloudRun, cx: &mut gpui::AsyncApp) {
    let id = run.id.clone();
    let mut log: Vec<LogLine> = Vec::new();
    let mut cursor = 0;
    let mut run = run;
    loop {
        let text = reply_text(Some(&run), &log);
        let calls = super::transcript::build(&log).tool_calls;
        let active = run.status.is_active();
        let failed = matches!(run.status, RunStatus::Failed);
        let snapshot = run.clone();
        let alive = this
            .update(cx, |this, cx| {
                if this.cloud_tool_calls.get(&entry) != Some(&calls) {
                    this.cloud_tool_calls.insert(entry, calls);
                    this.entry_changed(entry);
                }
                this.set_entry_text(entry, text, cx);
                this.last_cloud_run = Some(snapshot);
                if !active {
                    this.finish_cloud_run(failed, cx);
                }
            })
            .is_ok();
        if !alive || !active {
            return;
        }
        cx.background_executor().timer(POLL).await;
        let poll_client = client.clone();
        let poll_id = id.clone();
        let (fresh, lines) = cx.background_spawn(async move { (poll_client.get_run(&poll_id), poll_client.logs(&poll_id, cursor)) }).await;
        if let Ok(fresh) = fresh {
            run = fresh;
        }
        if let Ok((lines, next)) = lines {
            log.extend(lines);
            cursor = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(status: RunStatus, pr: bool) -> CloudRun {
        CloudRun { branch: "athas/fix-ci".into(), status, pr_url: pr.then(|| "https://github.com/a/b/pull/3".into()), ..Default::default() }
    }

    #[test]
    fn own_key_runs_send_the_agents_key_and_time_limits_read_plainly() {
        let codex = credentials("codex", |provider| (provider == "openai").then(|| "sk-test".to_string())).unwrap();
        assert_eq!(serde_json::to_value(&codex).unwrap(), serde_json::json!({ "openaiApiKey": "sk-test" }));
        assert_eq!(credentials("claude-code", |_| None).unwrap_err(), "Add your Anthropic API key in Settings > AI, or turn off \"Use my own API key\".");
        let input = StartRun { repo: "a/b".into(), max_minutes: Some(120), credentials: Some(codex), ..Default::default() };
        assert_eq!(serde_json::to_value(&input).unwrap()["credentials"]["openaiApiKey"], "sk-test");
        assert_eq!(MAX_MINUTES_OPTIONS.map(format_minutes), ["30 min", "1 hour", "2 hours"]);
        assert_eq!(CloudPreferences::default().max_minutes, 60);
    }

    #[test]
    fn a_follow_up_builds_on_the_last_runs_pull_request() {
        let cloud = CloudEnvironment { repo: Some("a/b".into()), branch: Some("main".into()), runs: Vec::new() };
        assert_eq!(next_base_branch(&cloud, Some(&run(RunStatus::Succeeded, true))).as_deref(), Some("athas/fix-ci"));
        assert_eq!(next_base_branch(&cloud, Some(&run(RunStatus::Succeeded, false))).as_deref(), Some("main"));
        assert_eq!(next_base_branch(&cloud, Some(&run(RunStatus::Failed, true))).as_deref(), Some("main"));
    }

    #[test]
    fn sending_waits_for_a_repository_and_the_running_run() {
        let mut cloud = CloudEnvironment::default();
        assert_eq!(send_blocker("gemini-cli", &cloud, false), Some("Cloud runs use Claude Code or Codex. Switch the agent to run this in the cloud."));
        assert_eq!(send_blocker("claude-acp", &cloud, false), Some("Pick a GitHub repository for the cloud run."));
        cloud.repo = Some("a/b".into());
        assert_eq!(send_blocker("claude-acp", &cloud, false), None);
        cloud.runs.push(CloudSessionRun { entry: 1, run_id: Some("r1".into()), ..Default::default() });
        assert!(send_blocker("claude-acp", &cloud, true).is_some());
        assert_eq!(send_blocker("claude-acp", &cloud, false), None);
    }
}
