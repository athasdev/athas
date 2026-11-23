//! The cloud agents view (kind `cloud-runs`): cloud runs with a form to start one on a GitHub
//! repository, and the project's continuous agents. A run opens in its own view (kind
//! `cloud-run`) with its log, following it while it runs.
//!
//! Drawn after Athas's `cloud-agents/components/*` and `continuous-agents/resource.tsx`.

use ui::WithScrollbar as _;
use std::{path::PathBuf, time::Duration};

use ui::scale::px;
use gpui::{
    AnyElement, App, AppContext as _, ClickEvent, Context, Entity, FocusHandle, Focusable, Hsla, IntoElement, ParentElement, Render, Styled,
    Subscription, Task, Window, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, MenuEntry, MenuItem, OpenMenu, Switch, TextInput, metrics,
    pane_header, typography,
};

use super::{
    CLOUD_AGENTS, CloudClient, CloudError, CloudRun, RunStatus, StartRun,
    api::{CloudRepo, LogLine},
    continuous::{self, Cadence, ContinuousAgents},
};
use crate::composer::Composer;

/// How often the list is read again while a run is active.
const LIST_POLL: Duration = Duration::from_secs(10);
/// How often an active run's log is read.
const LOG_POLL: Duration = Duration::from_secs(2);
/// Log lines kept in the view.
const MAX_LOG_LINES: usize = 5_000;

fn status_color(status: RunStatus, cx: &App) -> Hsla {
    let colors = &cx.theme().colors;
    match status {
        RunStatus::Queued => colors.subtle_foreground,
        RunStatus::Running => colors.primary,
        RunStatus::Succeeded => colors.success,
        RunStatus::Failed => colors.destructive,
        RunStatus::Cancelled | RunStatus::Unknown => colors.muted_foreground,
    }
}

fn status_pill(status: RunStatus, cx: &App) -> impl IntoElement + use<> {
    let color = status_color(status, cx);
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(4.))
        .px(px(6.))
        .h(px(20.))
        .rounded(metrics::radius())
        .bg(color.opacity(0.12))
        .text_size(typography::text_caption())
        .text_color(color)
        .child(div().size(px(6.)).rounded_full().bg(color))
        .child(status.label())
}

/// What to do about an error, as a button.
fn error_action(error: &CloudError) -> Option<Button> {
    let label = error.action()?;
    Some(Button::new("cloud-error-action", label).variant(ButtonVariant::Default).size(ButtonSize::Small).on_click(move |_, window, cx| {
        match label {
            "Sign in" => window.dispatch_action(Box::new(account::SignIn), cx),
            "Manage billing" => window.dispatch_action(Box::new(account::ManageBilling), cx),
            _ => window.dispatch_action(Box::new(account::ManageAccount), cx),
        }
    }))
}

fn banner(icon: IconName, title: String, message: Option<String>, action: Option<Button>, cx: &App) -> AnyElement {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .items_center()
        .gap(px(12.))
        .p(px(12.))
        .rounded(metrics::radius_lg())
        .border_1()
        .border_color(colors.border)
        .bg(colors.raised)
        .child(Icon::new(icon).size(IconSize::Medium).color(colors.muted_foreground))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(div().font_weight(typography::MEDIUM).child(title))
                .children(message.map(|message| div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(message))),
        )
        .children(action)
        .into_any_element()
}

fn section_title(title: &'static str, cx: &App) -> impl IntoElement + use<> {
    div().text_size(typography::text_sm()).font_weight(typography::SEMIBOLD).text_color(cx.theme().colors.muted_foreground).child(title)
}

fn field_label(text: &'static str, cx: &App) -> impl IntoElement + use<> {
    div().text_size(typography::text_caption()).text_color(cx.theme().colors.muted_foreground).child(text)
}

fn text_box(composer: Entity<Composer>, cx: &App) -> impl IntoElement + use<> {
    let colors = &cx.theme().colors;
    div().min_h(px(72.)).p(px(8.)).rounded(metrics::radius_lg()).border_1().border_color(colors.border).bg(colors.field).child(composer)
}

struct RunForm {
    repo: Option<String>,
    /// The branch picked; the repository's default when `None`.
    branch: Option<String>,
    /// The repository's default branch and its branches, once listed.
    branches: Option<(Option<String>, Vec<String>)>,
    agent: &'static str,
    prompt: Entity<Composer>,
    error: Option<String>,
    problem: Option<CloudError>,
    starting: Option<Task<()>>,
}

struct TaskForm {
    name: Entity<TextInput>,
    prompt: Entity<Composer>,
    agent: String,
    cadence: Cadence,
    error: Option<String>,
}

enum Runs {
    Loading,
    Loaded(Vec<CloudRun>),
    Failed(CloudError),
}

pub struct CloudAgentsView {
    client: Option<CloudClient>,
    project: Option<PathBuf>,
    runs: Runs,
    repos: Option<Vec<CloudRepo>>,
    /// Why the repositories could not be listed; GitHub not connected gets a Connect GitHub row.
    repos_error: Option<CloudError>,
    run_form: Option<RunForm>,
    task_form: Option<TaskForm>,
    continuous: Entity<ContinuousAgents>,
    open_menu: Option<OpenMenu>,
    focus: FocusHandle,
    loading: Option<Task<()>>,
    poll: Option<Task<()>>,
    /// The continuous agent whose details and run history are open.
    open_task: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl Focusable for CloudAgentsView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl CloudAgentsView {
    /// The list with the signed-in account; continuous agents are those of `project`.
    pub fn new(project: Option<PathBuf>, cx: &mut Context<Self>) -> Self {
        Self::with_client(None, project, cx)
    }

    /// The list with `client` instead of the account's (for headless renders against a mock
    /// service).
    pub fn with_client(client: Option<CloudClient>, project: Option<PathBuf>, cx: &mut Context<Self>) -> Self {
        let continuous = ContinuousAgents::global(cx);
        let mut subscriptions = vec![cx.observe(&continuous, |_, _, cx| cx.notify())];
        if client.is_none()
            && let Some(store) = account::AccountStore::global(cx)
        {
            subscriptions.push(cx.observe(&store, |this, _, cx| this.reload(cx)));
        }
        let mut this = Self {
            client,
            project,
            runs: Runs::Loading,
            repos: None,
            repos_error: None,
            run_form: None,
            task_form: None,
            continuous,
            open_menu: None,
            focus: cx.focus_handle(),
            loading: None,
            poll: None,
            open_task: None,
            _subscriptions: subscriptions,
        };
        this.reload(cx);
        this
    }

    fn client(&self, cx: &App) -> CloudClient {
        self.client.clone().unwrap_or_else(|| CloudClient::from_account(cx))
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        let client = self.client(cx);
        self.loading = Some(cx.spawn(async move |this, cx| {
            let runs = cx.background_spawn(async move { client.list_runs() }).await;
            this.update(cx, |this, cx| {
                let active = runs.as_ref().is_ok_and(|runs| runs.iter().any(|run| run.status.is_active()));
                this.runs = match runs {
                    Ok(runs) => Runs::Loaded(runs),
                    Err(error) => Runs::Failed(error),
                };
                this.loading = None;
                this.poll = active.then(|| {
                    cx.spawn(async move |this, cx| {
                        cx.background_executor().timer(LIST_POLL).await;
                        this.update(cx, |this, cx| this.reload(cx)).ok();
                    })
                });
                cx.notify();
            })
            .ok();
        }));
    }

    fn open_run_form(&mut self, cx: &mut Context<Self>) {
        let prompt = cx.new(Composer::new);
        prompt.update(cx, |prompt, cx| prompt.set_placeholder("What should the agent do? It opens a pull request when it is done.", cx));
        self.run_form = Some(RunForm { repo: None, branch: None, branches: None, agent: CLOUD_AGENTS[0].0, prompt, error: None, problem: None, starting: None });
        if self.repos.is_none() {
            let client = self.client(cx);
            cx.spawn(async move |this, cx| {
                let repos = cx.background_spawn(async move { client.repos() }).await;
                this.update(cx, |this, cx| {
                    match repos {
                        Ok(repos) => {
                            this.repos = Some(repos);
                            this.repos_error = None;
                        }
                        Err(error) => {
                            let github = matches!(&error, CloudError::Http { code: Some(code), .. } if code == "github_not_connected");
                            if let Some(form) = &mut this.run_form
                                && !github
                            {
                                form.error = Some(error.to_string());
                            }
                            this.repos = Some(Vec::new());
                            this.repos_error = Some(error);
                        }
                    }
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
        cx.notify();
    }

    fn start_run(&mut self, cx: &mut Context<Self>) {
        let client = self.client(cx);
        let Some(form) = &mut self.run_form else { return };
        let prompt = form.prompt.read(cx).text().trim().to_string();
        let Some(repo) = form.repo.clone() else {
            form.error = Some("Pick a repository".into());
            cx.notify();
            return;
        };
        if prompt.is_empty() {
            form.error = Some("Say what the agent should do".into());
            cx.notify();
            return;
        }
        let default_branch = self.repos.as_ref().and_then(|repos| repos.iter().find(|candidate| candidate.full_name == repo)).and_then(|repo| repo.default_branch.clone());
        let base_branch = form.branch.clone().or(default_branch).unwrap_or_else(|| "main".into());
        let input = StartRun { repo, base_branch, prompt, agent: form.agent.to_string(), ..Default::default() };
        form.error = None;
        form.problem = None;
        form.starting = Some(cx.spawn(async move |this, cx| {
            let started = cx.background_spawn(async move { client.start_run(&input) }).await;
            this.update(cx, |this, cx| {
                match started {
                    Ok(run) => {
                        this.run_form = None;
                        workbench_api::open_resource(cx, super::RUN_KIND, &run.id, &run_title(&run));
                        this.reload(cx);
                    }
                    Err(error) => {
                        if let Some(form) = &mut this.run_form {
                            let problem = super::environment::describe_problem(&error);
                            form.error = Some(format!("{}. {}", problem.title.trim_end_matches('.'), problem.description));
                            form.problem = Some(error);
                            form.starting = None;
                        }
                    }
                }
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
    }

    fn open_task_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let name = cx.new(|cx| TextInput::new(window, cx).placeholder("Name, like Keep CI green"));
        let prompt = cx.new(Composer::new);
        prompt.update(cx, |prompt, cx| prompt.set_placeholder("The goal the agent keeps working on…", cx));
        name.update(cx, |input, cx| input.focus(window, cx));
        self.task_form = Some(TaskForm { name, prompt, agent: crate::builtin::AGENT_ID.into(), cadence: Cadence::Hourly, error: None });
        cx.notify();
    }

    fn create_task(&mut self, cx: &mut Context<Self>) {
        let Some(project) = self.project.clone() else { return };
        let Some(form) = &mut self.task_form else { return };
        let name = form.name.read(cx).text().to_string();
        let prompt = form.prompt.read(cx).text().to_string();
        let (agent, cadence) = (form.agent.clone(), form.cadence);
        match self.continuous.update(cx, |continuous, cx| continuous.create(&name, &prompt, &agent, &project, cadence, cx)) {
            Ok(_) => self.task_form = None,
            Err(error) => {
                if let Some(form) = &mut self.task_form {
                    form.error = Some(error);
                }
            }
        }
        cx.notify();
    }

    fn show_menu(&mut self, key: &str, entries: Vec<MenuEntry>, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.open_menu = Some(OpenMenu::new(key.to_string(), entries, event.position(), gpui::Anchor::TopLeft, window, cx, |this, _| this.open_menu = None));
        cx.notify();
    }

    /// Picks the run form's repository and lists its branches for the branch picker.
    fn pick_form_repo(&mut self, repo: String, cx: &mut Context<Self>) {
        let Some(form) = &mut self.run_form else { return };
        if form.repo.as_deref() == Some(&repo) {
            return;
        }
        form.repo = Some(repo.clone());
        form.branch = None;
        form.branches = None;
        let client = self.client(cx);
        cx.spawn(async move |this, cx| {
            let listed = cx.background_spawn({
                let repo = repo.clone();
                async move { client.branches(&repo) }
            });
            let branches = listed.await.unwrap_or_default();
            this.update(cx, |this, cx| {
                if let Some(form) = &mut this.run_form
                    && form.repo.as_deref() == Some(&repo)
                {
                    form.branches = Some(branches);
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    fn render_run_form(&self, form: &RunForm, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let repo_label = form.repo.clone().unwrap_or_else(|| if self.repos.is_some() { "Pick a repository".into() } else { "Loading repositories…".into() });
        let agent_label = CLOUD_AGENTS.iter().find(|(id, _)| *id == form.agent).map_or(form.agent, |(_, name)| *name);
        let starting = form.starting.is_some();
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .p(px(12.))
            .rounded(metrics::radius_lg())
            .border_1()
            .border_color(colors.border)
            .bg(colors.raised)
            .child(div().font_weight(typography::SEMIBOLD).child("New cloud run"))
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(
                        div().flex_1().flex().flex_col().gap(px(4.)).child(field_label("Repository", cx)).child(
                            Button::new("cloud-repo", repo_label).variant(ButtonVariant::Outline).size(ButtonSize::Medium).full_width().align_start().trailing_icon(IconName::ChevronDown).on_click(
                                cx.listener(|this, event: &ClickEvent, window, cx| {
                                    let view = cx.entity();
                                    let project_repo = this.project.clone().and_then(|project| super::sidebar::project_repo(&project, cx));
                                    let current = this.run_form.as_ref().and_then(|form| form.repo.clone());
                                    let entries: Vec<MenuEntry> = super::environment::order_repos(this.repos.clone().unwrap_or_default(), project_repo.as_deref())
                                        .into_iter()
                                        .map(|repo| {
                                            let view = view.clone();
                                            let name = repo.full_name.clone();
                                            let mut item = MenuItem::new(repo.full_name.clone()).icon(if repo.private { IconName::Lock } else { IconName::Github }).checked(current.as_deref() == Some(&repo.full_name));
                                            if project_repo.as_deref().is_some_and(|project| project.eq_ignore_ascii_case(&repo.full_name)) {
                                                item = item.trailing_text("This project");
                                            }
                                            MenuEntry::Item(item.on_select(move |_, cx| view.update(cx, |this, cx| this.pick_form_repo(name.clone(), cx))))
                                        })
                                        .collect();
                                    let github_missing = matches!(&this.repos_error, Some(CloudError::Http { code: Some(code), .. }) if code == "github_not_connected");
                                    let mut entries = entries;
                                    if github_missing {
                                        entries.splice(
                                            0..0,
                                            [
                                                MenuEntry::Item(MenuItem::new("Connect GitHub to list your repositories.").disabled(true)),
                                                MenuEntry::Item(MenuItem::new("Connect GitHub").icon(IconName::Github).trailing_text("↗").on_select(|_, cx| account::open_service_url(cx, account::ServiceUrls::integrations))),
                                            ],
                                        );
                                    } else if this.repos.is_none() {
                                        entries.push(MenuEntry::Item(MenuItem::new("Loading repositories…").disabled(true)));
                                    } else if entries.is_empty() {
                                        entries.push(MenuEntry::Item(MenuItem::new("No repositories found").disabled(true)));
                                    } else if this.repos_error.is_some() {
                                        entries.push(MenuEntry::Item(MenuItem::new("Your other repositories could not be loaded.").disabled(true)));
                                    }
                                    this.show_menu("cloud-repo", entries, event, window, cx);
                                    if let Some(menu) = this.open_menu.take() {
                                        this.open_menu = Some(menu.searchable("Search repositories", "No matching repositories", cx));
                                    }
                                }),
                            ),
                        ),
                    )
                    .child(div().w(px(200.)).flex().flex_col().gap(px(4.)).child(field_label("Base branch", cx)).child({
                        let default = form.branches.as_ref().and_then(|(default, _)| default.clone());
                        let label = match (&form.repo, &form.branch, &form.branches) {
                            (None, _, _) => "Choose branch".to_string(),
                            (_, Some(branch), _) => branch.clone(),
                            (_, None, None) => "Loading…".to_string(),
                            (_, None, Some(_)) => default.clone().unwrap_or_else(|| "Choose branch".into()),
                        };
                        Button::new("cloud-branch", label)
                            .variant(ButtonVariant::Outline)
                            .size(ButtonSize::Medium)
                            .full_width()
                            .align_start()
                            .leading_icon(IconName::GitBranch)
                            .trailing_icon(IconName::ChevronDown)
                            .disabled(form.repo.is_none())
                            .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                                let view = cx.entity();
                                let Some(form) = &this.run_form else { return };
                                let (default, branches) = form.branches.clone().unwrap_or_default();
                                let current = form.branch.clone().or(default.clone());
                                let mut entries: Vec<MenuEntry> = branches
                                    .into_iter()
                                    .map(|branch| {
                                        let view = view.clone();
                                        let mut item = MenuItem::new(branch.clone()).icon(IconName::GitBranch).checked(current.as_deref() == Some(&branch));
                                        if default.as_deref() == Some(&branch) {
                                            item = item.trailing_text("default");
                                        }
                                        MenuEntry::Item(item.on_select(move |_, cx| {
                                            let branch = branch.clone();
                                            view.update(cx, |this, cx| {
                                                if let Some(form) = &mut this.run_form {
                                                    form.branch = Some(branch);
                                                }
                                                cx.notify();
                                            });
                                        }))
                                    })
                                    .collect();
                                if entries.is_empty() {
                                    let empty = if form.branches.is_none() { "Loading branches…" } else { "No branches found" };
                                    entries.push(MenuEntry::Item(MenuItem::new(empty).disabled(true)));
                                }
                                this.show_menu("cloud-branch", entries, event, window, cx);
                                if let Some(menu) = this.open_menu.take() {
                                    this.open_menu = Some(menu.searchable("Search branches", "No matching branches", cx));
                                }
                            }))
                    }))
                    .child(
                        div().w(px(150.)).flex().flex_col().gap(px(4.)).child(field_label("Agent", cx)).child(
                            Button::new("cloud-agent", agent_label).variant(ButtonVariant::Outline).size(ButtonSize::Medium).full_width().align_start().trailing_icon(IconName::ChevronDown).on_click(
                                cx.listener(|this, event: &ClickEvent, window, cx| {
                                    let view = cx.entity();
                                    let entries = CLOUD_AGENTS
                                        .iter()
                                        .map(|(id, name)| {
                                            let view = view.clone();
                                            MenuEntry::Item(MenuItem::new(*name).on_select(move |_, cx| {
                                                view.update(cx, |this, cx| {
                                                    if let Some(form) = &mut this.run_form {
                                                        form.agent = id;
                                                    }
                                                    cx.notify();
                                                });
                                            }))
                                        })
                                        .collect();
                                    this.show_menu("cloud-agent", entries, event, window, cx);
                                }),
                            ),
                        ),
                    ),
            )
            .child(div().flex().flex_col().gap(px(4.)).child(field_label("Task", cx)).child(text_box(form.prompt.clone(), cx)))
            .when_some(form.error.clone(), |this, error| {
                this.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(div().flex_1().min_w_0().text_size(typography::text_sm()).text_color(colors.destructive).child(error))
                        .children(form.problem.as_ref().and_then(error_action)),
                )
            })
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(6.))
                    .child(Button::new("cloud-cancel-form", "Cancel").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                        this.run_form = None;
                        cx.notify();
                    })))
                    .child(
                        Button::new("cloud-start", if starting { "Starting…" } else { "Start run" })
                            .variant(ButtonVariant::Accent)
                            .size(ButtonSize::Small)
                            .disabled(starting)
                            .leading_icon(IconName::Rocket)
                            .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.start_run(cx))),
                    ),
            )
            .into_any_element()
    }

    fn render_runs(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        match &self.runs {
            Runs::Loading => ui::quiet_note("Loading runs…", cx).into_any_element(),
            Runs::Failed(error) => {
                let title = if *error == CloudError::SignedOut { "Sign in to run agents in the cloud".to_string() } else { "Cloud runs are unavailable".to_string() };
                let message = if *error == CloudError::SignedOut {
                    "Cloud agents work on your GitHub repositories on Athas's servers and open a pull request.".to_string()
                } else {
                    error.to_string()
                };
                banner(IconName::CloudSlash, title, Some(message), error_action(error), cx)
            }
            Runs::Loaded(runs) if runs.is_empty() => {
                banner(IconName::Cloud, "No cloud runs yet".into(), Some("Start one to have an agent work on a repository and open a pull request.".into()), None, cx)
            }
            Runs::Loaded(runs) => div()
                .flex()
                .flex_col()
                .rounded(metrics::radius_lg())
                .border_1()
                .border_color(colors.border)
                .overflow_hidden()
                .children(runs.iter().enumerate().map(|(index, run)| {
                    let (id, title) = (run.id.clone(), run_title(run));
                    div()
                        .id(("cloud-run-row", index))
                        .flex()
                        .items_center()
                        .gap(px(12.))
                        .px(px(12.))
                        .py(px(8.))
                        .when(index > 0, |this| this.border_t_1().border_color(colors.border))
                        .hover(|style| style.bg(colors.accent))
                        .on_click(move |_, _, cx| workbench_api::open_resource(cx, super::RUN_KIND, &id, &title))
                        .child(status_pill(run.status, cx))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .child(div().truncate().font_weight(typography::MEDIUM).child(run_title(run)))
                                .child(
                                    div()
                                        .truncate()
                                        .text_size(typography::text_caption())
                                        .text_color(colors.muted_foreground)
                                        .child(format!("{} · {} → {}", run.repo, run.base_branch, if run.branch.is_empty() { "…" } else { &run.branch })),
                                ),
                        )
                        .when(run.pr_url.is_some(), |this| this.child(Icon::new(IconName::GitPullRequest).size(IconSize::Small).color(colors.success)))
                        .child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(agent_name(&run.agent).to_string()))
                        .child(div().w(px(110.)).text_right().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(super::short_time(&run.created_at)))
                }))
                .into_any_element(),
        }
    }

    fn render_task_form(&self, form: &TaskForm, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let agent_label = agent_display(&form.agent);
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .p(px(12.))
            .rounded(metrics::radius_lg())
            .border_1()
            .border_color(colors.border)
            .bg(colors.raised)
            .child(div().font_weight(typography::SEMIBOLD).child("New continuous agent"))
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(div().flex_1().flex().flex_col().gap(px(4.)).child(field_label("Name", cx)).child(form.name.clone()))
                    .child(
                        div().w(px(170.)).flex().flex_col().gap(px(4.)).child(field_label("Agent", cx)).child(
                            Button::new("task-agent", agent_label).variant(ButtonVariant::Outline).size(ButtonSize::Medium).full_width().align_start().trailing_icon(IconName::ChevronDown).on_click(
                                cx.listener(|this, event: &ClickEvent, window, cx| {
                                    let view = cx.entity();
                                    let choices = std::iter::once((crate::builtin::AGENT_ID, crate::builtin::NAME))
                                        .chain(crate::acp::agents::KNOWN_AGENTS.iter().map(|agent| (agent.id, agent.name)));
                                    let entries = choices
                                        .map(|(id, name)| {
                                            let view = view.clone();
                                            MenuEntry::Item(MenuItem::new(name).on_select(move |_, cx| {
                                                view.update(cx, |this, cx| {
                                                    if let Some(form) = &mut this.task_form {
                                                        form.agent = id.to_string();
                                                    }
                                                    cx.notify();
                                                });
                                            }))
                                        })
                                        .collect();
                                    this.show_menu("task-agent", entries, event, window, cx);
                                }),
                            ),
                        ),
                    )
                    .child(
                        div().w(px(150.)).flex().flex_col().gap(px(4.)).child(field_label("Runs", cx)).child(
                            Button::new("task-cadence", form.cadence.label()).variant(ButtonVariant::Outline).size(ButtonSize::Medium).full_width().align_start().trailing_icon(IconName::ChevronDown).on_click(
                                cx.listener(|this, event: &ClickEvent, window, cx| {
                                    let view = cx.entity();
                                    let entries = Cadence::ALL
                                        .iter()
                                        .map(|cadence| {
                                            let (view, cadence) = (view.clone(), *cadence);
                                            MenuEntry::Item(MenuItem::new(cadence.label()).on_select(move |_, cx| {
                                                view.update(cx, |this, cx| {
                                                    if let Some(form) = &mut this.task_form {
                                                        form.cadence = cadence;
                                                    }
                                                    cx.notify();
                                                });
                                            }))
                                        })
                                        .collect();
                                    this.show_menu("task-cadence", entries, event, window, cx);
                                }),
                            ),
                        ),
                    ),
            )
            .child(div().flex().flex_col().gap(px(4.)).child(field_label("Goal", cx)).child(text_box(form.prompt.clone(), cx)))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(4.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .mr(px(4.))
                            .text_size(typography::text_sm())
                            .text_color(colors.subtle_foreground)
                            .child(Icon::new(IconName::Sparkle).size(IconSize::XSmall).color(colors.subtle_foreground))
                            .child("Start from a template"),
                    )
                    .children(continuous::GOAL_TEMPLATES.iter().enumerate().map(|(index, (name, prompt))| {
                        Button::new(("task-template", index), *name).variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                            if let Some(form) = &this.task_form {
                                form.name.update(cx, |input, cx| input.set_text(*name, cx));
                                form.prompt.update(cx, |input, cx| input.set_text(*prompt, cx));
                            }
                        }))
                    })),
            )
            .when_some(form.error.clone(), |this, error| this.child(div().text_size(typography::text_sm()).text_color(colors.destructive).child(error)))
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(6.))
                    .child(Button::new("task-cancel", "Cancel").variant(ButtonVariant::Ghost).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                        this.task_form = None;
                        cx.notify();
                    })))
                    .child(Button::new("task-create", "Create").variant(ButtonVariant::Accent).size(ButtonSize::Small).on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.create_task(cx)))),
            )
            .into_any_element()
    }

    fn render_tasks(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(project) = &self.project else {
            return banner(IconName::Clock, "Open a project to schedule agents".into(), Some("Continuous agents work on a goal in a project on a schedule.".into()), None, cx);
        };
        let tasks: Vec<continuous::ContinuousTask> = self.continuous.read(cx).tasks().iter().filter(|task| &task.workspace_path == project).cloned().collect();
        let project_name = project.file_name().map_or_else(|| project.to_string_lossy().into_owned(), |name| name.to_string_lossy().into_owned());
        let intro = div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .px(px(12.))
            .py(px(12.))
            .rounded(metrics::radius_lg())
            .border_1()
            .border_color(colors.border)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(8.))
                    .child(ui::Badge::new("Continuous").tone(ui::Tone::Accent))
                    .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Runs while Athas is open")),
            )
            .child(div().font_weight(typography::SEMIBOLD).child("Give Athas an outcome, not another reminder."))
            .child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(format!(
                "Every cadence starts a fresh Agent session in {project_name}, keeps the workspace in context, and leaves a verifiable handoff in history."
            )))
            .child(div().flex().flex_wrap().gap(px(12.)).children(continuous::GOAL_TEMPLATES.iter().take(2).map(|(name, _)| {
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .text_size(typography::text_sm())
                    .text_color(colors.subtle_foreground)
                    .child(Icon::new(IconName::Sparkle).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .child(*name)
            })));
        if tasks.is_empty() {
            return div().flex().flex_col().gap(px(12.)).child(intro).into_any_element();
        }
        let now = continuous::now_millis();
        let active = tasks.iter().filter(|task| task.enabled).count();
        let runs: u64 = tasks.iter().map(|task| task.run_count).sum();
        let stat = |label: &'static str, value: String| {
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(2.))
                .px(px(12.))
                .py(px(10.))
                .rounded(metrics::radius_lg())
                .border_1()
                .border_color(colors.border)
                .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(label))
                .child(div().text_size(typography::text_lg()).font_weight(typography::SEMIBOLD).child(value))
        };
        let overview = div()
            .flex()
            .gap(px(8.))
            .child(stat("Active", active.to_string()))
            .child(stat("Paused", (tasks.len() - active).to_string()))
            .child(stat("Runs started", runs.to_string()));
        let list = div()
            .flex()
            .flex_col()
            .rounded(metrics::radius_lg())
            .border_1()
            .border_color(colors.border)
            .overflow_hidden()
            .children(tasks.into_iter().enumerate().map(|(index, task)| {
                let (toggle_id, run_id, delete_id) = (task.id.clone(), task.id.clone(), task.id.clone());
                let detail = match &task.last_error {
                    Some(error) => error.clone(),
                    None if task.enabled => {
                        let next = continuous::format_next_run(task.next_run_at, now);
                        let next = if next == "Ready now" { "ready to run".to_string() } else { format!("next run {next}") };
                        format!("{} · {next} · {} runs", task.cadence.label(), task.run_count)
                    }
                    None => format!("{} · paused · {} runs", task.cadence.label(), task.run_count),
                };
                let continuous = self.continuous.clone();
                let (run_entity, delete_entity) = (continuous.clone(), continuous.clone());
                let open = self.open_task.as_deref() == Some(task.id.as_str());
                let open_id = task.id.clone();
                let details = open.then(|| self.render_task_details(&task, cx));
                let row = div()
                    .id(("task-row", index))
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .px(px(12.))
                    .py(px(8.))
                    .child(Switch::new(("task-enabled", index), task.enabled).on_change(move |enabled, _, cx| {
                        continuous.update(cx, |continuous, cx| continuous.set_enabled(&toggle_id, enabled, cx));
                    }))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .min_w_0()
                                    .child(div().truncate().font_weight(typography::MEDIUM).child(task.name.clone()))
                                    .child(task_badge(&task)),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(typography::text_caption())
                                    .text_color(if task.last_error.is_some() { colors.warning } else { colors.muted_foreground })
                                    .child(detail),
                            ),
                    )
                    .child(div().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(agent_display(&task.agent_id)))
                    .child(Button::new(("task-run", index), "Run now").variant(ButtonVariant::Ghost).size(ButtonSize::XSmall).leading_icon(IconName::Play).on_click(move |_, _, cx| {
                        run_entity.update(cx, |continuous, cx| continuous.run_now(&run_id, cx));
                    }))
                    .child(Button::icon(("task-delete", index), IconName::Trash).size(ButtonSize::XSmall).tooltip("Delete").on_click(move |_, _, cx| {
                        delete_entity.update(cx, |continuous, cx| continuous.delete(&delete_id, cx));
                    }))
                    .child(Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .on_click(cx.listener(move |this, _: &gpui::ClickEvent, _, cx| {
                        this.open_task = if this.open_task.as_deref() == Some(open_id.as_str()) { None } else { Some(open_id.clone()) };
                        cx.notify();
                    }));
                div().flex().flex_col().when(index > 0, |this| this.border_t_1().border_color(colors.border)).child(row).children(details)
            }));
        div().flex().flex_col().gap(px(12.)).child(intro).child(overview).child(list).into_any_element()
    }

    /// A continuous agent's goal, schedule and run history (`continuous-agents/resource.tsx`).
    fn render_task_details(&self, task: &continuous::ContinuousTask, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let now = continuous::now_millis();
        let fact = |label: &'static str, value: String| {
            div()
                .flex()
                .gap(px(8.))
                .text_size(typography::text_sm())
                .child(div().w(px(96.)).flex_none().text_color(colors.subtle_foreground).child(label))
                .child(div().flex_1().min_w_0().text_color(colors.foreground).child(value))
        };
        let last = task.last_run_at.map_or_else(|| "Never".to_string(), |at| workspace::relative_time(at, now));
        let next = if task.enabled { continuous::format_next_run(task.next_run_at, now) } else { "Paused".to_string() };
        let runs: Vec<AnyElement> = if task.runs.is_empty() {
            vec![div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("No runs yet.").into_any_element()]
        } else {
            task.runs
                .iter()
                .enumerate()
                .map(|(index, run)| {
                    let label = workspace::relative_time(run.started_at, now);
                    let mut item = ui::SidebarListItem::new(("task-run-history", index), label).leading_icon(IconName::Clock);
                    match run.session_id.clone() {
                        Some(session) => {
                            item = item.description("Open session").on_click(move |_, _, cx| workbench_api::request(cx, workbench_api::OpenRequest::Session { id: session.clone() }));
                        }
                        None => item = item.description("No session"),
                    }
                    item.into_any_element()
                })
                .collect()
        };
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .px(px(16.))
            .pt(px(2.))
            .pb(px(12.))
            .when_some(task.last_error.clone(), |this, error| {
                this.child(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(6.))
                        .mb(px(4.))
                        .px(px(10.))
                        .py(px(8.))
                        .rounded(metrics::radius_md())
                        .bg(colors.warning_soft)
                        .text_size(typography::text_sm())
                        .child(Icon::new(IconName::WarningCircle).size(IconSize::Small).color(colors.warning))
                        .child(div().flex_1().min_w_0().flex().flex_col().child(div().font_weight(typography::MEDIUM).child("Needs attention")).child(div().text_color(colors.muted_foreground).child(error))),
                )
            })
            .child(fact("Goal", task.prompt.clone()))
            .child(fact("Agent", agent_display(&task.agent_id)))
            .child(fact("Schedule", task.cadence.label().to_string()))
            .child(fact("Last run", last))
            .child(fact("Next run", next))
            .child(fact("Runs", task.run_count.to_string()))
            .child(div().pt(px(4.)).text_size(typography::text_sm()).font_weight(typography::MEDIUM).child("Run history"))
            .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("Every run stays available as a normal Agent session with its full handoff."))
            .children(runs)
            .child(
                div()
                    .flex()
                    .gap(px(6.))
                    .pt(px(6.))
                    .child(Button::new("task-toggle", if task.enabled { "Pause" } else { "Resume" }).size(ButtonSize::Small).leading_icon(if task.enabled { IconName::Pause } else { IconName::ArrowsClockwise }).on_click({
                        let (continuous, id, enabled) = (self.continuous.clone(), task.id.clone(), task.enabled);
                        move |_, _, cx| continuous.update(cx, |continuous, cx| continuous.set_enabled(&id, !enabled, cx))
                    }))
                    .when_some(task.last_session_id.clone(), |this, session| {
                        this.child(Button::new("task-open-latest", "Open latest session").size(ButtonSize::Small).on_click(move |_, _, cx| {
                            workbench_api::request(cx, workbench_api::OpenRequest::Session { id: session.clone() })
                        }))
                    }),
            )
            .into_any_element()
    }
}

/// Where a continuous agent stands: Needs attention, Active or Paused.
fn task_badge(task: &continuous::ContinuousTask) -> ui::Badge {
    let (label, tone) = match (&task.last_error, task.enabled) {
        (Some(_), _) => ("Needs attention", ui::Tone::Warning),
        (None, true) => ("Active", ui::Tone::Success),
        (None, false) => ("Paused", ui::Tone::Neutral),
    };
    ui::Badge::new(label).tone(tone)
}

fn agent_name(id: &str) -> &str {
    CLOUD_AGENTS.iter().find(|(candidate, _)| *candidate == id).map_or(id, |(_, name)| name)
}

fn agent_display(id: &str) -> String {
    if crate::builtin::is_builtin(id) { crate::builtin::NAME.to_string() } else { crate::acp::agents::display_name(id) }
}

fn run_title(run: &CloudRun) -> String {
    if !run.title.trim().is_empty() {
        return run.title.clone();
    }
    run.prompt.as_deref().and_then(crate::title::title_from_prompt).unwrap_or_else(|| format!("Run on {}", run.repo))
}

impl Render for CloudAgentsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let run_form = self.run_form.as_ref().map(|form| self.render_run_form(form, cx));
        let task_form = self.task_form.as_ref().map(|form| self.render_task_form(form, cx));
        let signed_out = matches!(self.runs, Runs::Failed(CloudError::SignedOut));
        div()
            .id("cloud-agents")
            .key_context("CloudAgents")
            .track_focus(&self.focus)
            .size_full()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::ui_font())
            .text_size(typography::text_base())
            .text_color(colors.foreground)
            .child(
                pane_header(cx)
                    .gap(px(8.))
                    .child(Icon::new(IconName::Cloud).size(IconSize::Small).color(colors.muted_foreground))
                    .child(div().font_weight(typography::MEDIUM).child("Cloud & continuous agents"))
                    .child(div().flex_1())
                    .child(Button::icon("cloud-refresh", IconName::ArrowClockwise).size(ButtonSize::Small).tooltip("Refresh").on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.reload(cx))))
                    .when(!signed_out, |this| {
                        this.child(Button::new("cloud-new-run", "New cloud run").variant(ButtonVariant::Default).size(ButtonSize::Small).leading_icon(IconName::Plus).on_click(
                            cx.listener(|this, _: &ClickEvent, _, cx| this.open_run_form(cx)),
                        ))
                    }),
            )
            .child(
                div().id("cloud-body").flex_1().min_h_0().overflow_y_scroll().scrollbar(window, cx).child(
                    div().w_full().flex().justify_center().px(px(16.)).py(px(16.)).child(
                        div()
                            .w_full()
                            .max_w(px(860.))
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .child(section_title("Cloud runs", cx))
                            .children(run_form)
                            .child(self.render_runs(cx))
                            .child(
                                div()
                                    .mt(px(12.))
                                    .flex()
                                    .items_center()
                                    .child(section_title("Continuous agents", cx))
                                    .child(div().flex_1())
                                    .when(self.project.is_some() && self.task_form.is_none(), |this| {
                                        this.child(Button::new("task-new", "New continuous agent").variant(ButtonVariant::Ghost).size(ButtonSize::Small).leading_icon(IconName::Plus).on_click(
                                            cx.listener(|this, _: &ClickEvent, window, cx| this.open_task_form(window, cx)),
                                        ))
                                    }),
                            )
                            .children(task_form)
                            .child(self.render_tasks(cx)),
                    ),
                ),
            )
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

/// One cloud run with its log (kind `cloud-run`, id = run id).
pub struct CloudRunView {
    id: String,
    client: Option<CloudClient>,
    run: Option<Result<CloudRun, CloudError>>,
    log: Vec<LogLine>,
    cursor: u64,
    log_error: Option<String>,
    cancelling: bool,
    /// The log as it came, instead of read into the agent's words and tool calls.
    show_raw: bool,
    focus: FocusHandle,
    poll: Option<Task<()>>,
}

impl Focusable for CloudRunView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl CloudRunView {
    pub fn new(id: String, cx: &mut Context<Self>) -> Self {
        Self::with_client(id, None, cx)
    }

    pub fn with_client(id: String, client: Option<CloudClient>, cx: &mut Context<Self>) -> Self {
        let mut this = Self { id, client, run: None, log: Vec::new(), cursor: 0, log_error: None, cancelling: false, show_raw: false, focus: cx.focus_handle(), poll: None };
        this.refresh(cx);
        this
    }

    fn client(&self, cx: &App) -> CloudClient {
        self.client.clone().unwrap_or_else(|| CloudClient::from_account(cx))
    }

    /// Reads the run and the log since the last read; again in a moment while it runs.
    fn refresh(&mut self, cx: &mut Context<Self>) {
        let client = self.client(cx);
        let (id, cursor) = (self.id.clone(), self.cursor);
        self.poll = Some(cx.spawn(async move |this, cx| {
            let (run, logs) = cx
                .background_spawn(async move {
                    let run = client.get_run(&id);
                    let logs = run.is_ok().then(|| client.logs(&id, cursor));
                    (run, logs)
                })
                .await;
            let active = run.as_ref().is_ok_and(|run| run.status.is_active());
            let alive = this.update(cx, |this, cx| {
                match logs {
                    Some(Ok((lines, cursor))) => {
                        this.log.extend(lines);
                        if this.log.len() > MAX_LOG_LINES {
                            let excess = this.log.len() - MAX_LOG_LINES;
                            this.log.drain(..excess);
                        }
                        this.cursor = cursor;
                        this.log_error = None;
                    }
                    Some(Err(error)) => this.log_error = Some(error.to_string()),
                    None => {}
                }
                this.run = Some(run);
                cx.notify();
            });
            if alive.is_ok() && active {
                cx.background_executor().timer(LOG_POLL).await;
                this.update(cx, |this, cx| this.refresh(cx)).ok();
            }
        }));
    }

    fn cancel(&mut self, cx: &mut Context<Self>) {
        let client = self.client(cx);
        let id = self.id.clone();
        self.cancelling = true;
        cx.spawn(async move |this, cx| {
            let result = cx.background_spawn(async move { client.cancel_run(&id) }).await;
            this.update(cx, |this, cx| {
                this.cancelling = false;
                match result {
                    Ok(run) => this.run = Some(Ok(run)),
                    Err(error) => this.log_error = Some(error.to_string()),
                }
                this.refresh(cx);
            })
            .ok();
        })
        .detach();
        cx.notify();
    }
}

impl Render for CloudRunView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let header = pane_header(cx).gap(px(8.)).child(Icon::new(IconName::Cloud).size(IconSize::Small).color(colors.muted_foreground));
        let (header, body) = match &self.run {
            None => (header.child("Cloud run"), ui::quiet_note("Loading…", cx).p(px(16.)).into_any_element()),
            Some(Err(error)) => (
                header.child("Cloud run"),
                div().p(px(16.)).child(banner(IconName::CloudSlash, "This run is unavailable".into(), Some(error.to_string()), error_action(error), cx)).into_any_element(),
            ),
            Some(Ok(run)) => {
                let header = header
                    .child(div().min_w_0().truncate().font_weight(typography::MEDIUM).child(run_title(run)))
                    .child(status_pill(run.status, cx))
                    .child(div().flex_1())
                    .when_some(run.pr_url.clone(), |this, url| {
                        this.child(Button::new("run-pr", "Open pull request").variant(ButtonVariant::Default).size(ButtonSize::Small).leading_icon(IconName::GitPullRequest).on_click(
                            move |_, _, cx| cx.open_url(&url),
                        ))
                    })
                    .child({
                        let run = run.clone();
                        Button::new("run-session", "Open as session")
                            .variant(ButtonVariant::Default)
                            .size(ButtonSize::Small)
                            .leading_icon(IconName::ChatBubbleText)
                            .on_click(move |_, _, cx| super::session::open_run_as_session(run.clone(), cx))
                    })
                    .when(run.status.is_active(), |this| {
                        this.child(
                            Button::new("run-cancel", if self.cancelling { "Cancelling…" } else { "Cancel run" })
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::Small)
                                .disabled(self.cancelling)
                                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.cancel(cx))),
                        )
                    });
                let sandbox = super::environment::format_sandbox_time(super::environment::run_sandbox_seconds(run, chrono::Utc::now().timestamp_millis()));
                let spent = super::environment::run_spent_micros(run);
                let spent = if spent > 0 || run.billing.as_deref() != Some("own-key") {
                    format!(" · {} spent", super::environment::format_credit_micros(spent))
                } else {
                    String::new()
                };
                let facts = format!(
                    "{} · {} → {} · {} · {sandbox} of {} min{spent}",
                    run.repo,
                    run.base_branch,
                    if run.branch.is_empty() { "…" } else { &run.branch },
                    agent_name(&run.agent),
                    run.max_minutes,
                );
                let transcript = super::transcript::build(&self.log);
                let readable = !transcript.content.is_empty() || !transcript.tool_calls.is_empty() || transcript.plan.is_some();
                let show_raw = self.show_raw || !readable;
                let log_rows: Vec<AnyElement> = if show_raw {
                    self.log
                        .iter()
                        .flat_map(|line| {
                            let color = match line.stream.as_str() {
                                "stderr" => colors.warning,
                                "system" => colors.subtle_foreground,
                                _ => colors.foreground,
                            };
                            super::transcript::format_log(std::slice::from_ref(line))
                                .into_iter()
                                .map(move |text| div().whitespace_nowrap().text_color(color).child(text).into_any_element())
                        })
                        .collect()
                } else {
                    render_transcript(&transcript, cx)
                };
                let toggle = readable.then(|| {
                    Button::new("run-raw-log", if self.show_raw { "Show transcript" } else { "Show raw log" })
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .on_click(cx.listener(|this, _: &ClickEvent, _, cx| {
                            this.show_raw = !this.show_raw;
                            cx.notify();
                        }))
                });
                let body = div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .p(px(16.))
                    .child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(facts))
                    .when_some(run.prompt.clone(), |this, prompt| {
                        this.child(div().p(px(10.)).rounded(metrics::radius_lg()).bg(colors.raised).text_size(typography::text_sm()).child(prompt))
                    })
                    .when_some(run.error.clone(), |this, error| {
                        this.child(
                            div()
                                .flex()
                                .gap(px(6.))
                                .items_center()
                                .p(px(10.))
                                .rounded(metrics::radius_lg())
                                .bg(colors.destructive_soft)
                                .text_size(typography::text_sm())
                                .child(Icon::new(IconName::WarningCircle).size(IconSize::XSmall).color(colors.destructive))
                                .child(error),
                        )
                    })
                    .when_some(self.log_error.clone(), |this, error| this.child(div().text_size(typography::text_sm()).text_color(colors.warning).child(error)))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .text_size(typography::text_sm())
                            .text_color(colors.muted_foreground)
                            .children(transcript.status.clone().filter(|_| run.status.is_active()).map(|status| div().min_w_0().truncate().child(status)))
                            .child(div().flex_1())
                            .children(toggle),
                    )
                    .child(
                        div()
                            .id("run-log")
                            .flex_1()
                            .min_h(px(200.))
                            .overflow_scroll()
                            .p(px(10.))
                            .rounded(metrics::radius_lg())
                            .border_1()
                            .border_color(colors.border)
                            .bg(colors.surface)
                            .when(show_raw, |this| this.font_family(typography::MONO_FONT).text_size(typography::text_caption()).line_height(px(17.)))
                            .when(!show_raw, |this| this.flex().flex_col().gap(px(8.)).text_size(typography::text_sm()))
                            .when(self.log.is_empty(), |this| this.child(div().text_color(colors.subtle_foreground).child(if run.status.is_active() { "Waiting for output…" } else { "No output" })))
                            .children(log_rows),
                    )
                    .into_any_element();
                (header, body)
            }
        };
        div()
            .id("cloud-run")
            .key_context("CloudRun")
            .track_focus(&self.focus)
            .size_full()
            .flex()
            .flex_col()
            .bg(colors.background)
            .font_family(typography::ui_font())
            .text_size(typography::text_base())
            .text_color(colors.foreground)
            .child(header)
            .child(body)
    }
}

/// The run's log read as the agent's words, its plan and its tool calls.
fn render_transcript(transcript: &super::transcript::CloudTranscript, cx: &App) -> Vec<AnyElement> {
    use super::transcript::CallStatus;
    let colors = &cx.theme().colors;
    let mut rows: Vec<AnyElement> = Vec::new();
    if let Some(plan) = &transcript.plan {
        let done = plan.iter().filter(|(_, status)| *status == crate::thread::PlanStatus::Completed).count();
        rows.push(
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .child(div().font_weight(typography::MEDIUM).child(format!("Plan · {done} of {}", plan.len())))
                .children(plan.iter().map(|(content, status)| {
                    let (icon, color) = match status {
                        crate::thread::PlanStatus::Completed => (IconName::CheckCircle, colors.success),
                        crate::thread::PlanStatus::InProgress => (IconName::CircleDot, colors.primary),
                        crate::thread::PlanStatus::Pending => (IconName::CircleDotted, colors.subtle_foreground),
                    };
                    div().flex().items_center().gap(px(6.)).child(Icon::new(icon).size(IconSize::XSmall).color(color)).child(div().min_w_0().child(content.clone()))
                }))
                .into_any_element(),
        );
    }
    for call in &transcript.tool_calls {
        let (icon, color) = match call.status {
            CallStatus::InProgress => (IconName::CircleDot, colors.primary),
            CallStatus::Completed => (IconName::CheckCircle, colors.success),
            CallStatus::Failed => (IconName::WarningCircle, colors.destructive),
        };
        let duration = call.duration_ms.map(|ms| if ms >= 1000 { format!("{:.1}s", ms as f64 / 1000.) } else { format!("{ms}ms") });
        rows.push(
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .child(Icon::new(icon).size(IconSize::XSmall).color(color))
                .child(div().flex_none().font_weight(typography::MEDIUM).child(call.name.clone()))
                .children(call.detail().map(|detail| div().min_w_0().truncate().font_family(typography::MONO_FONT).text_size(typography::text_caption()).text_color(colors.muted_foreground).child(detail.to_string())))
                .child(div().flex_1())
                .children(duration.map(|duration| div().flex_none().text_size(typography::text_caption()).text_color(colors.subtle_foreground).child(duration)))
                .into_any_element(),
        );
    }
    if !transcript.content.is_empty() {
        rows.push(
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .children(transcript.content.split("\n\n").map(|paragraph| div().text_color(colors.foreground).child(paragraph.to_string())))
                .into_any_element(),
        );
    }
    rows
}
