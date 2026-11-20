//! GitHub (`features/github`): pull requests, issues, workflow runs, releases and deployments in the sidebar,
//! and their pages in the centre.
//!
//! The REST client is the old app's `athas-github` crate. Every call blocks, so each runs on the
//! background executor and comes back with `this.update`. Results are kept in [`store`], so a list
//! or page reopens at once and refreshes behind the scenes.

pub mod auth;
mod create_view;
mod delivery_view;
mod diff;
pub mod draft;
pub mod gh;
mod issue_view;
mod links;
mod logs;
mod markdown;
mod editor;
mod inbox;
mod menus;
#[cfg(target_family = "wasm")]
#[path = "../../../core/github/src/models.rs"]
mod models;
mod mutation;
mod model;
mod panel_view;
mod pr_view;
pub mod quick_open;
pub mod relay;
mod repo;
mod rich;
mod run_view;
#[cfg(target_family = "wasm")]
#[path = "../../../core/github/src/serde_helpers.rs"]
mod serde_helpers;
#[cfg(feature = "snapshot")]
#[doc(hidden)]
pub mod snapshot;
mod store;
mod watcher;
mod widgets;
#[cfg(any(test, target_family = "wasm"))]
#[cfg_attr(not(target_family = "wasm"), allow(dead_code))]
mod wire;

#[cfg(test)]
mod fixtures;

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use crate::gh::{Deployment, IssueListItem, PullRequest, Release, WorkflowRunListItem};
use web_time::Instant;
use gpui::{AnyElement, AnyView, App, AppContext, Context, Entity, EventEmitter, FocusHandle, Focusable, SharedString, Subscription, Task, Window};
use ui::{InputAppearance, OpenMenu, TextInput, TextInputEvent};

use auth::Auth;
use menus::MenuHost;
use model::{DeploymentFilter, IssueFilter, PrFilter, ReleaseFilter, RunFilter, Tone};
use repo::{RepoError, Repository};

pub use draft::{DraftGenerator, DraftRequest, set_draft_generator};
pub use inbox::watch_notifications;
pub use watcher::watch_actions;

gpui::actions!(github, [NewRelease, RefreshGitHub, CheckAuthentication, ConnectAccount]);

/// Registers the `github.*` commands. The workbench handles their actions and hands them to the
/// project's panel.
pub fn init(cx: &mut App) {
    keymap::register(cx, "github.newRelease", NewRelease);
    keymap::register(cx, "github.refresh", RefreshGitHub);
    keymap::register(cx, "github.checkAuthentication", CheckAuthentication);
    keymap::register(cx, "github.connectAccount", ConnectAccount);
    // The account menu shows GitHub as connected while its token works, under its login.
    account::linked_accounts::register_github(cx, |cx| {
        let check = store::check_auth(false, cx);
        cx.spawn(async move |cx: &mut gpui::AsyncApp| {
            let state = match check.await {
                Auth::Authenticated(token) => {
                    let value = token.value.clone();
                    let login = cx.background_spawn(async move { crate::gh::github_get_current_user(Some(value)).ok() }).await;
                    account::linked_accounts::LinkedGitHub { connected: true, login }
                }
                _ => account::linked_accounts::LinkedGitHub::default(),
            };
            cx.update(|cx| account::linked_accounts::set_github(cx, state));
        })
        .detach();
    });
}

/// What a detached window's title bar shows for a GitHub page: the author's avatar and the
/// page's state as a coloured label.
#[derive(Clone, Debug, PartialEq)]
pub struct ResourceChrome {
    /// The author's (a run's: the actor's) GitHub login and picture.
    pub login: Option<String>,
    pub avatar_url: Option<String>,
    /// "Open", "Draft", "Merged", "Closed", a run's "In progress", "Failed", …
    pub state: String,
    /// The state's colour in the active theme.
    pub color: gpui::Hsla,
}

/// The chrome of a pull request, issue or run view (as `resource_view` returns them), once it has
/// loaded; `None` for other views or before the page arrives.
pub fn resource_chrome(view: &AnyView, cx: &App) -> Option<ResourceChrome> {
    let (login, state, tone) = if let Ok(view) = view.clone().downcast::<pr_view::PullRequestView>() {
        view.read(cx).chrome()?
    } else if let Ok(view) = view.clone().downcast::<issue_view::IssueView>() {
        view.read(cx).chrome()?
    } else if let Ok(view) = view.clone().downcast::<run_view::RunView>() {
        view.read(cx).chrome()?
    } else {
        return None;
    };
    use theme::ActiveTheme as _;
    let login = (!login.is_empty()).then_some(login);
    Some(ResourceChrome {
        avatar_url: login.as_ref().map(|login| format!("https://avatars.githubusercontent.com/{login}?s=64")),
        login,
        state,
        color: widgets::tone_color(tone, &cx.theme().colors),
    })
}

/// What a `github.*` command asks of the panel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GitHubCommand {
    NewRelease,
    Refresh,
    CheckAuthentication,
}

#[derive(Clone, Debug, PartialEq)]
pub enum GitHubEvent {
    /// Open a pull request, issue or run in the centre. `kind` is one of the kinds
    /// `open_resource` accepts.
    OpenResource { kind: String, id: String, title: String },
    OpenFile(PathBuf),
    /// Open a pull request, issue or run in a window of its own (`openGitHubContentInNewWindow`).
    OpenInNewWindow { kind: String, id: String, title: String },
}

/// The kinds of centre views GitHub opens.
pub const RESOURCE_KINDS: &[&str] = &["github-pr", "github-issue", "github-run", "github-new", "github-release", "github-deployment"];

/// How often an open list with running workflows is re-read.
const ACTIVE_POLL: Duration = Duration::from_secs(15);
/// A list older than this is re-read when the window comes back to the front.
const STALE_AFTER: Duration = Duration::from_secs(60);
/// Releases come 20 to a page.
const RELEASE_PAGE: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Section {
    PullRequests,
    Issues,
    Actions,
    Releases,
    Deployments,
}

impl Section {
    pub(crate) const ALL: [Section; 5] = [Section::PullRequests, Section::Issues, Section::Actions, Section::Releases, Section::Deployments];

    /// The section's id in `githubSidebarSectionOrder`.
    pub(crate) fn id(self) -> &'static str {
        match self {
            Section::PullRequests => "pull-requests",
            Section::Issues => "issues",
            Section::Actions => "actions",
            Section::Releases => "releases",
            Section::Deployments => "deployments",
        }
    }

    pub(crate) fn noun(self) -> &'static str {
        match self {
            Section::PullRequests => "pull requests",
            Section::Issues => "issues",
            Section::Actions => "workflow runs",
            Section::Releases => "releases",
            Section::Deployments => "deployments",
        }
    }
}

/// The sections the sidebar offers: `githubSidebarSectionOrder`, without the ones the
/// `showGitHub…` settings turn off.
pub(crate) fn visible_sections(settings: &settings::Settings) -> Vec<Section> {
    let shown = |section: Section| match section {
        Section::PullRequests => settings.show_github_pull_requests,
        Section::Issues => settings.show_github_issues,
        Section::Actions => settings.show_github_actions,
        Section::Releases => settings.show_github_releases,
        Section::Deployments => settings.show_github_deployments,
    };
    let mut order: Vec<Section> =
        settings.github_sidebar_section_order.iter().filter_map(|id| Section::ALL.into_iter().find(|section| section.id() == id)).collect();
    for section in Section::ALL {
        if !order.contains(&section) {
            order.push(section);
        }
    }
    order.dedup();
    order.into_iter().filter(|section| shown(*section)).collect()
}

fn read_visible_sections(cx: &App) -> Vec<Section> {
    match cx.try_global::<settings::SettingsStore>() {
        Some(_) => visible_sections(settings::get(cx)),
        None => visible_sections(&settings::Settings::default()),
    }
}

pub(crate) enum RepoState {
    Detecting,
    Missing(RepoError),
    Ready(Repository),
}

/// One list in the sidebar and the request that fills it.
pub(crate) struct List<T> {
    pub items: Option<Arc<Vec<T>>>,
    pub loading: bool,
    pub error: Option<SharedString>,
    /// What the items are of (repository, section and filter); late answers for another key are dropped.
    key: String,
}

impl<T> Default for List<T> {
    fn default() -> Self {
        Self { items: None, loading: false, error: None, key: String::new() }
    }
}

impl<T> List<T> {
    pub fn len(&self) -> usize {
        self.items.as_ref().map_or(0, |items| items.len())
    }
}

pub(crate) struct Notice {
    pub message: SharedString,
    pub tone: Tone,
}

/// The sidebar view: the project's pull requests, issues, workflow runs, releases and deployments.
pub struct GitHubPanel {
    root: PathBuf,
    /// A repository picked with Browse Repository; detection runs from here instead of the root.
    manual_root: Option<PathBuf>,
    pub(crate) selecting_repo: bool,
    pub(crate) repo_selection_error: Option<SharedString>,
    focus_handle: FocusHandle,
    pub(crate) repo: RepoState,
    pub(crate) auth: Auth,
    /// An authenticated `gh` is installed, so the sign-in card offers "Use GitHub CLI" rather
    /// than "Use your own token" (`getGhCliAvailability().hasToken`).
    pub(crate) gh_has_token: bool,
    pub(crate) section: Section,
    pub(crate) sections: Vec<Section>,
    pub(crate) pr_filter: PrFilter,
    pub(crate) issue_filter: IssueFilter,
    pub(crate) run_filter: RunFilter,
    pub(crate) pulls: List<PullRequest>,
    pub(crate) issues: List<IssueListItem>,
    pub(crate) runs: List<WorkflowRunListItem>,
    pub(crate) releases: List<Release>,
    pub(crate) releases_exhausted: bool,
    pub(crate) release_filter: ReleaseFilter,
    pub(crate) deployments: List<Deployment>,
    pub(crate) deployments_exhausted: bool,
    pub(crate) deployment_filter: DeploymentFilter,
    pub(crate) collapsed: HashSet<String>,
    /// The sidebar list's scroll, and the groups it last drew (one child each), for the sticky
    /// group header.
    pub(crate) list_scroll: gpui::ScrollHandle,
    pub(crate) shown_groups: std::cell::RefCell<Vec<crate::panel_view::ShownGroup>>,
    /// The row last opened, drawn selected.
    pub(crate) selected: Option<(Section, i64)>,
    pub(crate) notice: Option<Notice>,
    notice_epoch: usize,
    pub(crate) busy_runs: HashSet<i64>,
    pub(crate) filter_input: Entity<TextInput>,
    pub(crate) open_menu: Option<OpenMenu>,
    loaded_at: Option<Instant>,
    prefetched: bool,
    _subscriptions: Vec<Subscription>,
    _poll: Task<()>,
}

impl EventEmitter<GitHubEvent> for GitHubPanel {}

impl Focusable for GitHubPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl MenuHost for GitHubPanel {
    fn menu_slot(&mut self) -> &mut Option<OpenMenu> {
        &mut self.open_menu
    }
}

impl GitHubPanel {
    pub fn new(root: PathBuf, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter_input = cx.new(|cx| {
            TextInput::new(window, cx).placeholder("Filter pull requests").appearance(InputAppearance::Bare).leading_icon(ui::IconName::Search).clearable()
        });
        let subscriptions = vec![
            cx.subscribe(&filter_input, |_, input, event: &TextInputEvent, cx| match event {
                TextInputEvent::Changed(_) => cx.notify(),
                TextInputEvent::Cancelled => input.update(cx, |input, cx| input.set_text("", cx)),
                _ => {}
            }),
            cx.observe_global::<store::Revision>(|this, cx| {
                this.loaded_at = None;
                this.load_section(this.section, cx);
            }),
            cx.observe_global::<settings::SettingsStore>(|this, cx| this.apply_sections(cx)),
            cx.observe_window_activation(window, |this, window, cx| {
                if window.is_window_active() && this.loaded_at.is_some_and(|at| at.elapsed() > STALE_AFTER) {
                    this.load_section(this.section, cx);
                }
            }),
        ];
        let poll = cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor().timer(ACTIVE_POLL).await;
                let polled = this.update_in(cx, |this, window, cx| {
                    let runs_active = this.runs.items.as_ref().is_some_and(|runs| {
                        runs.iter().any(|run| model::run_state(run.status.as_deref(), run.conclusion.as_deref()).is_active)
                    });
                    if window.is_window_active() && this.section == Section::Actions && runs_active {
                        this.load_section(Section::Actions, cx);
                    }
                    let deployments_pending = this.deployments.items.as_ref().is_some_and(|items| items.iter().any(|deployment| delivery_view::deployment_state(deployment).2));
                    // Only while one page shows: reloading starts over at page 1 and would drop
                    // the pages the user loaded (and a "Load more" still on its way).
                    let one_page = !this.deployments.loading && this.deployments.items.as_ref().is_some_and(|items| items.len() <= RELEASE_PAGE);
                    if window.is_window_active() && this.section == Section::Deployments && deployments_pending && one_page {
                        this.load_section(Section::Deployments, cx);
                    }
                });
                if polled.is_err() {
                    break;
                }
            }
        });
        let mut panel = Self {
            root,
            manual_root: None,
            selecting_repo: false,
            repo_selection_error: None,
            focus_handle: cx.focus_handle(),
            repo: RepoState::Detecting,
            auth: store::auth(cx).unwrap_or(Auth::Checking),
            gh_has_token: false,
            section: Section::PullRequests,
            sections: Vec::new(),
            pr_filter: PrFilter::default(),
            issue_filter: IssueFilter::default(),
            run_filter: RunFilter::default(),
            pulls: List::default(),
            issues: List::default(),
            runs: List::default(),
            releases: List::default(),
            releases_exhausted: false,
            release_filter: ReleaseFilter::default(),
            deployments: List::default(),
            deployments_exhausted: false,
            deployment_filter: DeploymentFilter::default(),
            collapsed: HashSet::new(),
            list_scroll: gpui::ScrollHandle::new(),
            shown_groups: Default::default(),
            selected: None,
            notice: None,
            notice_epoch: 0,
            busy_runs: HashSet::new(),
            filter_input,
            open_menu: None,
            loaded_at: None,
            prefetched: false,
            _subscriptions: subscriptions,
            _poll: poll,
        };
        panel.apply_sections(cx);
        panel.detect_repository(cx);
        panel.check_auth(false, cx);
        panel
    }

    /// Follows the `showGitHub…` settings: a hidden section gives way to the first shown one.
    fn apply_sections(&mut self, cx: &mut Context<Self>) {
        let sections = read_visible_sections(cx);
        if sections == self.sections {
            return;
        }
        self.sections = sections;
        if let Some(first) = self.sections.first().copied()
            && !self.sections.contains(&self.section)
        {
            self.show_section(first, cx);
        }
        cx.notify();
    }

    /// Runs a `github.*` command.
    pub fn run_command(&mut self, command: GitHubCommand, cx: &mut Context<Self>) {
        match command {
            GitHubCommand::Refresh => self.refresh(cx),
            GitHubCommand::NewRelease => match self.repo_path() {
                Some(_) => cx.emit(GitHubEvent::OpenResource { kind: "github-release".into(), id: "new".into(), title: "New release".into() }),
                None => self.notify_result("No repository open", Tone::Error, cx),
            },
            GitHubCommand::CheckAuthentication => {
                self.auth = Auth::Checking;
                crate::gh::invalidate_gh_cli_token_cache();
                cx.notify();
                let check = store::check_auth(true, cx);
                cx.spawn(async move |this, cx| {
                    let auth = check.await;
                    this.update(cx, |this, cx| {
                        let (message, tone) = match &auth {
                            Auth::Authenticated(_) => ("GitHub authentication checked".to_string(), Tone::Success),
                            other => (format!("GitHub authentication failed: {}", store::auth_message(other)), Tone::Error),
                        };
                        this.auth = auth;
                        this.load_when_ready(cx);
                        this.notify_result(message, tone, cx);
                    })
                    .ok();
                })
                .detach();
            }
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The tool's buttons in the sidebar's tool row.
    pub fn render_header_actions(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        self.render_header_buttons(cx)
    }

    pub(crate) fn repository(&self) -> Option<&Repository> {
        match &self.repo {
            RepoState::Ready(repo) => Some(repo),
            _ => None,
        }
    }

    pub(crate) fn repo_path(&self) -> Option<String> {
        self.repository().map(|repo| repo.root.to_string_lossy().into_owned())
    }

    pub(crate) fn is_loading(&self) -> bool {
        match self.section {
            Section::PullRequests => self.pulls.loading,
            Section::Issues => self.issues.loading,
            Section::Actions => self.runs.loading,
            Section::Releases => self.releases.loading,
            Section::Deployments => self.deployments.loading,
        }
    }

    fn detect_repository(&mut self, cx: &mut Context<Self>) {
        let root = self.manual_root.clone().unwrap_or_else(|| self.root.clone());
        let task = cx.background_spawn(async move { repo::detect(&root) });
        cx.spawn(async move |this, cx| {
            let repo = task.await;
            this.update(cx, |this, cx| {
                this.repo = match repo {
                    Ok(repo) => {
                        cx.set_global(links::CurrentRepo(repo.slug.full_name()));
                        RepoState::Ready(repo)
                    }
                    Err(error) => RepoState::Missing(error),
                };
                this.load_when_ready(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Browse Repository: a folder inside a Git repository becomes the panel's repository, as
    /// `handleSelectRepository` sets the manual repository.
    pub(crate) fn select_repository(&mut self, cx: &mut Context<Self>) {
        if self.selecting_repo {
            return;
        }
        self.selecting_repo = true;
        self.repo_selection_error = None;
        cx.notify();
        let paths = cx.prompt_for_paths(gpui::PathPromptOptions { files: false, directories: true, multiple: false, prompt: Some("Select repository".into()) });
        cx.spawn(async move |this, cx| {
            let selected = match paths.await {
                Ok(Ok(Some(paths))) => paths.into_iter().next(),
                _ => None,
            };
            let Some(selected) = selected else {
                this.update(cx, |this, cx| {
                    this.selecting_repo = false;
                    cx.notify();
                })
                .ok();
                return;
            };
            let probe = selected.clone();
            let detected = cx.background_spawn(async move { repo::detect(&probe) }).await;
            this.update(cx, |this, cx| {
                this.selecting_repo = false;
                if matches!(detected, Err(RepoError::NotARepository)) {
                    this.repo_selection_error = Some("Selected folder is not inside a Git repository.".into());
                } else {
                    this.manual_root = Some(selected);
                    this.prefetched = false;
                    this.pulls = List::default();
                    this.issues = List::default();
                    this.runs = List::default();
                    this.releases = List::default();
                    this.deployments = List::default();
                    this.repo = RepoState::Detecting;
                    this.detect_repository(cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn check_auth(&mut self, force: bool, cx: &mut Context<Self>) {
        if force {
            self.auth = Auth::Checking;
            crate::gh::invalidate_gh_cli_token_cache();
            cx.notify();
        }
        let check = store::check_auth(force, cx);
        cx.spawn(async move |this, cx| {
            let auth = check.await;
            let gh_has_token = match &auth {
                #[cfg(not(target_family = "wasm"))]
                Auth::Missing { .. } => cx.background_spawn(async { crate::gh::gh_cli_availability().has_token }).await,
                _ => false,
            };
            this.update(cx, |this, cx| {
                this.auth = auth;
                this.gh_has_token = gh_has_token;
                this.load_when_ready(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// "Use GitHub CLI": GitHub calls take `gh`'s token from now on.
    pub(crate) fn use_gh_cli(&mut self, cx: &mut Context<Self>) {
        if cx.has_global::<settings::SettingsStore>() {
            settings::update(cx, |settings| settings.github_token_source = "gh".into());
        }
        self.check_auth(true, cx);
    }

    /// Loads the open section once both the repository and the token are known, then the other
    /// lists a moment later, as Athas prefetches them.
    fn load_when_ready(&mut self, cx: &mut Context<Self>) {
        if self.repository().is_none() || self.auth.token().is_none() {
            return;
        }
        self.load_section(self.section, cx);
        if self.prefetched {
            return;
        }
        self.prefetched = true;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(600)).await;
            this.update(cx, |this, cx| {
                for section in [Section::Issues, Section::Actions] {
                    if section != this.section && this.sections.contains(&section) {
                        this.load_section(section, cx);
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn refresh(&mut self, cx: &mut Context<Self>) {
        match (&self.repo, &self.auth) {
            (RepoState::Missing(_), _) => self.detect_repository(cx),
            (_, Auth::Missing { .. } | Auth::Unavailable(_)) => self.check_auth(true, cx),
            _ => self.load_section(self.section, cx),
        }
    }

    fn list_key(&self, section: Section) -> Option<String> {
        let root = self.repo_path()?;
        Some(match section {
            Section::PullRequests => format!("{root}|prs|{}", self.pr_filter.api_value()),
            Section::Issues => format!("{root}|issues|{}", self.issue_filter.api_value()),
            Section::Actions => format!("{root}|runs"),
            Section::Releases => format!("{root}|releases"),
            Section::Deployments => format!("{root}|deployments"),
        })
    }

    pub(crate) fn load_section(&mut self, section: Section, cx: &mut Context<Self>) {
        let (Some(path), Some(token), Some(key)) = (self.repo_path(), self.auth.token(), self.list_key(section)) else { return };
        match section {
            Section::PullRequests => {
                let filter = self.pr_filter.api_value().to_string();
                load(self, |this| &mut this.pulls, key, cx, move || crate::gh::github_list_prs(path, filter, Some(token)));
            }
            Section::Issues => {
                let filter = self.issue_filter.api_value().to_string();
                load(self, |this| &mut this.issues, key, cx, move || crate::gh::github_list_issues(path, filter, Some(token)));
            }
            Section::Actions => load(self, |this| &mut this.runs, key, cx, move || crate::gh::github_list_workflow_runs(path, Some(token))),
            Section::Releases => {
                self.releases_exhausted = false;
                load(self, |this| &mut this.releases, key, cx, move || crate::gh::github_list_releases(path, 1, Some(token)));
            }
            Section::Deployments => {
                self.deployments_exhausted = false;
                load(self, |this| &mut this.deployments, key, cx, move || crate::gh::github_list_deployments(path, 1, Some(token)));
            }
        }
        if section == self.section {
            self.loaded_at = Some(Instant::now());
        }
    }

    /// The next page of releases or deployments, added to the list.
    pub(crate) fn load_more(&mut self, section: Section, cx: &mut Context<Self>) {
        match section {
            Section::Releases => self.load_more_of(|this| (&mut this.releases, &mut this.releases_exhausted), crate::gh::github_list_releases, cx),
            Section::Deployments => self.load_more_of(|this| (&mut this.deployments, &mut this.deployments_exhausted), crate::gh::github_list_deployments, cx),
            _ => {}
        }
    }

    fn load_more_of<T: Clone + Send + Sync + 'static>(
        &mut self,
        list: fn(&mut Self) -> (&mut List<T>, &mut bool),
        fetch: fn(String, u32, Option<String>) -> Result<Vec<T>, String>,
        cx: &mut Context<Self>,
    ) {
        let (Some(path), Some(token)) = (self.repo_path(), self.auth.token()) else { return };
        let (target, exhausted) = list(self);
        if target.loading || *exhausted {
            return;
        }
        let page = (target.len() / RELEASE_PAGE) as u32 + 1;
        let key = target.key.clone();
        target.loading = true;
        cx.notify();
        let task = cx.background_spawn(async move { fetch(path, page, Some(token)) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                let (target, exhausted) = list(this);
                if target.key != key {
                    return;
                }
                target.loading = false;
                match result {
                    Ok(more) => {
                        *exhausted = more.len() < RELEASE_PAGE;
                        let mut items = target.items.as_deref().cloned().unwrap_or_default();
                        items.extend(more);
                        let items = Arc::new(items);
                        target.items = Some(items.clone());
                        store::put(key, items, cx);
                    }
                    Err(error) => target.error = Some(error.into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn show_section(&mut self, section: Section, cx: &mut Context<Self>) {
        if self.section == section {
            return;
        }
        self.section = section;
        self.filter_input.update(cx, |input, cx| {
            input.set_text("", cx);
            input.set_placeholder(format!("Filter {}", section.noun()), cx);
        });
        let stale = match section {
            Section::PullRequests => self.pulls.items.is_none(),
            Section::Issues => self.issues.items.is_none(),
            Section::Actions => self.runs.items.is_none(),
            Section::Releases => self.releases.items.is_none(),
            Section::Deployments => self.deployments.items.is_none(),
        };
        if stale || self.loaded_at.is_none_or(|at| at.elapsed() > STALE_AFTER) {
            self.load_section(section, cx);
        }
        cx.notify();
    }

    pub(crate) fn set_pr_filter(&mut self, filter: PrFilter, cx: &mut Context<Self>) {
        self.pr_filter = filter;
        self.load_section(Section::PullRequests, cx);
        cx.notify();
    }

    pub(crate) fn set_issue_filter(&mut self, filter: IssueFilter, cx: &mut Context<Self>) {
        self.issue_filter = filter;
        self.load_section(Section::Issues, cx);
        cx.notify();
    }

    pub(crate) fn set_run_filter(&mut self, filter: RunFilter, cx: &mut Context<Self>) {
        self.run_filter = filter;
        cx.notify();
    }

    pub(crate) fn set_release_filter(&mut self, filter: ReleaseFilter, cx: &mut Context<Self>) {
        self.release_filter = filter;
        cx.notify();
    }

    pub(crate) fn set_deployment_filter(&mut self, filter: DeploymentFilter, cx: &mut Context<Self>) {
        self.deployment_filter = filter;
        cx.notify();
    }

    pub(crate) fn toggle_group(&mut self, key: String, cx: &mut Context<Self>) {
        if !self.collapsed.remove(&key) {
            self.collapsed.insert(key);
        }
        cx.notify();
    }

    pub(crate) fn open_in_new_window(&mut self, kind: &str, id: i64, title: String, cx: &mut Context<Self>) {
        cx.emit(GitHubEvent::OpenInNewWindow { kind: kind.to_string(), id: self.resource_id(id), title });
    }

    pub(crate) fn open(&mut self, section: Section, kind: &str, id: i64, title: String, cx: &mut Context<Self>) {
        self.selected = Some((section, id));
        cx.emit(GitHubEvent::OpenResource { kind: kind.to_string(), id: self.resource_id(id), title });
        cx.notify();
    }

    /// The tab id of item `id`: with a repository picked through Browse Repository, its root
    /// goes along (`<root>|<id>`), so the tab shows that repository's item, not the project's.
    fn resource_id(&self, id: i64) -> String {
        match &self.manual_root {
            Some(root) => format!("{}|{id}", root.to_string_lossy()),
            None => id.to_string(),
        }
    }

    pub(crate) fn notify_result(&mut self, message: impl Into<SharedString>, tone: Tone, cx: &mut Context<Self>) {
        self.notice = Some(Notice { message: message.into(), tone });
        self.notice_epoch += 1;
        let epoch = self.notice_epoch;
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_secs(5)).await;
            this.update(cx, |this, cx| {
                if this.notice_epoch == epoch {
                    this.notice = None;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    /// Fetches the pull request's head into a local `pr-<number>` branch and switches to it.
    pub(crate) fn checkout_pull_request(&mut self, number: i64, cx: &mut Context<Self>) {
        let (Some(path), Some(token)) = (self.repo_path(), self.auth.token()) else { return };
        let task = cx.background_spawn(async move { crate::gh::github_checkout_pr(path, number, Some(token)) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| match result {
                Ok(()) => this.notify_result(format!("Checked out PR #{number}"), Tone::Success, cx),
                Err(error) => this.notify_result(error, Tone::Error, cx),
            })
            .ok();
        })
        .detach();
    }

    /// Re-runs (all or only failed jobs) or cancels a workflow run.
    pub(crate) fn run_action(&mut self, run_id: i64, action: RunAction, cx: &mut Context<Self>) {
        let (Some(path), Some(token)) = (self.repo_path(), self.auth.token()) else { return };
        if !self.busy_runs.insert(run_id) {
            return;
        }
        cx.notify();
        let task = cx.background_spawn(async move { action.perform(path, run_id, token) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy_runs.remove(&run_id);
                match result {
                    Ok(()) => this.notify_result(action.done_message(), Tone::Success, cx),
                    Err(error) => this.notify_result(error, Tone::Error, cx),
                }
                this.load_section(Section::Actions, cx);
            })
            .ok();
        })
        .detach();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunAction {
    Rerun,
    RerunFailed,
    Cancel,
}

impl RunAction {
    /// Blocking: calls the API.
    pub(crate) fn perform(self, path: String, run_id: i64, token: String) -> Result<(), String> {
        match self {
            RunAction::Rerun => crate::gh::github_rerun_workflow_run(path, run_id, false, Some(token)),
            RunAction::RerunFailed => crate::gh::github_rerun_workflow_run(path, run_id, true, Some(token)),
            RunAction::Cancel => crate::gh::github_cancel_workflow_run(path, run_id, Some(token)),
        }
    }

    pub(crate) fn done_message(self) -> &'static str {
        match self {
            RunAction::Rerun => "Re-run queued",
            RunAction::RerunFailed => "Re-run of failed jobs queued",
            RunAction::Cancel => "Cancellation requested",
        }
    }
}

/// Fills `list` from the cache at once, then from `fetch` on the background executor.
fn load<T: Send + Sync + 'static>(
    panel: &mut GitHubPanel,
    list: fn(&mut GitHubPanel) -> &mut List<T>,
    key: String,
    cx: &mut Context<GitHubPanel>,
    fetch: impl FnOnce() -> Result<Vec<T>, String> + Send + 'static,
) {
    let cached = store::get::<Vec<T>>(&key, cx);
    let target = list(panel);
    if target.key != key {
        target.items = cached;
        target.error = None;
        target.key = key.clone();
    }
    target.loading = true;
    cx.notify();
    let task = cx.background_spawn(async move { fetch() });
    cx.spawn(async move |this, cx| {
        let result = task.await;
        this.update(cx, |this, cx| {
            let target = list(this);
            if target.key != key {
                return;
            }
            target.loading = false;
            match result {
                Ok(items) => {
                    let items = Arc::new(items);
                    target.items = Some(items.clone());
                    target.error = None;
                    store::put(key, items, cx);
                }
                Err(error) => target.error = Some(error.into()),
            }
            cx.notify();
        })
        .ok();
    })
    .detach();
}

/// The centre view for a resource GitHub opened; `root` is the project's repository.
pub fn open_resource(kind: &str, id: &str, root: PathBuf, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    // `<root>|<id>`: an item of a repository other than the project's.
    let (root, id) = match id.split_once('|') {
        Some((repo, rest)) if std::path::Path::new(repo).has_root() => (PathBuf::from(repo), rest),
        _ => (root, id),
    };
    if kind == "github-new" {
        let kind = create_view::CreateKind::parse(id)?;
        return Some(cx.new(|cx| create_view::CreateView::new(root, kind, window, cx)).into());
    }
    if kind == "github-release" && id == "new" {
        return Some(cx.new(|cx| delivery_view::DeliveryView::new(root, delivery_view::DeliveryKind::Release, None, window, cx)).into());
    }
    let number: i64 = id.split(['/', ':']).next()?.parse().ok()?;
    Some(match kind {
        // `123/files` and `123/checks` open a pull request on that tab, as Athas's "Changes" link does.
        "github-pr" => {
            let tab = id.split_once('/').map(|(_, tab)| tab.to_string());
            cx.new(|cx| pr_view::PullRequestView::new(root, number, tab.as_deref(), window, cx)).into()
        }
        "github-issue" => cx.new(|cx| issue_view::IssueView::new(root, number, window, cx)).into(),
        "github-run" => cx.new(|cx| run_view::RunView::new(root, number, window, cx)).into(),
        "github-release" => cx.new(|cx| delivery_view::DeliveryView::new(root, delivery_view::DeliveryKind::Release, Some(number), window, cx)).into(),
        "github-deployment" => cx.new(|cx| delivery_view::DeliveryView::new(root, delivery_view::DeliveryKind::Deployment, Some(number), window, cx)).into(),
        _ => return None,
    })
}

#[cfg(test)]
mod section_tests {
    use super::*;

    #[test]
    fn sections_follow_the_order_and_visibility_settings() {
        let mut settings = settings::Settings::default();
        assert_eq!(visible_sections(&settings), Section::ALL);
        settings.github_sidebar_section_order = vec!["releases".into(), "pull-requests".into(), "bogus".into()];
        settings.show_github_issues = false;
        settings.show_github_deployments = false;
        assert_eq!(visible_sections(&settings), [Section::Releases, Section::PullRequests, Section::Actions]);
    }
}
