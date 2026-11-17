//! Docker (`features/docker`): containers, images, volumes and the project's Compose services,
//! with their actions, followed logs and `docker inspect`; a container's files; the project's
//! env files, dev containers and presets; building, running, pulling and registry login.
//!
//! Shells, debug commands and dev containers run in the workbench's terminal: the view emits
//! [`DockerViewEvent::RunInTerminal`]; env files open with [`DockerViewEvent::OpenFile`].
//!
//! Every Docker call goes through the old app's `athas-docker` crate (the `docker` CLI driven
//! with tokio) on a small tokio runtime of its own ([`runtime`]); results come back with
//! `this.update`. The inventory is polled every few seconds while the view is on screen and the
//! window is active, and reloaded after every action.
//!
//! Environment:
//! - `ATHAS_DOCKER_PROGRAM` uses another `docker`-compatible binary. `fixtures/fake-docker`
//!   answers the read-only calls with fixture data, for snapshots without a daemon.
//! - `ATHAS_DOCKER_OPEN` (debug builds) opens `images`, `volumes`, `networks`, `compose`, `logs:<id>` or
//!   `inspect:<id>` once the first inventory arrives, so a snapshot can show that page;
//!   `form:run|build|pull|login|tag|debug` opens that form.

#[cfg(target_family = "wasm")]
#[path = "remote.rs"]
mod athas_docker;
mod files;
mod model;
mod palette_page;
mod project;
pub mod relay;
mod runtime;
mod view;

use std::{
    collections::{HashSet, VecDeque},
    ffi::OsString,
    future::Future,
    path::PathBuf,
    time::Duration,
};

use athas_docker::{
    Docker, DockerBuildImageRequest, DockerBuildPreset, DockerComposePreset, DockerComposeProject, DockerContainer,
    DockerImage, DockerInventory, DockerNetwork, DockerProjectConfig, DockerRegistryLoginRequest, DockerRegistrySearchResult,
    DockerRunImageRequest, DockerRunPreset, DockerVolume,
};
#[cfg(not(target_family = "wasm"))]
use futures::StreamExt;
use gpui::{
    Anchor, AppContext, ClipboardItem, Context, Entity, EventEmitter, FocusHandle, Focusable, Pixels, Point,
    SharedString, Subscription, Task, UniformListScrollHandle, Window,
};
use ui::{InputAppearance, MenuEntry, MenuItem, OpenMenu, TextInput, TextInputEvent};

pub use palette_page::{DockerPaletteDelegate, docker_picker};

use model::{ContainerState, image_reference, last_line};
use runtime::{LogMessage, LogStream};

/// How often the inventory is re-read while the view is on screen.
const POLL_INTERVAL: Duration = Duration::from_secs(4);
/// How long a success notice stays.
const NOTICE_TIMEOUT: Duration = Duration::from_secs(4);
/// Lines of history a log starts with.
const LOG_TAIL: u16 = 500;
/// How often the web build asks the workspace server for a followed log's new lines.
#[cfg(target_family = "wasm")]
const LOG_POLL_INTERVAL: Duration = Duration::from_millis(500);
/// Lines a log keeps; older ones scroll away.
const LOG_LIMIT: usize = 10_000;
/// How long the pull form waits after typing before it searches Docker Hub.
const SEARCH_DELAY: Duration = Duration::from_millis(300);
/// Docker Hub results the pull form asks for.
const SEARCH_LIMIT: u16 = 25;

/// What the view asks of the workbench.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DockerViewEvent {
    /// Runs a command in a new terminal: a shell, a debug command, an attached dev container.
    RunInTerminal { command: String, name: String, cwd: Option<PathBuf> },
    /// Opens a file in the editor: an env file of the project.
    OpenFile(PathBuf),
    /// A debug command started in a terminal (after `RunInTerminal`): the host lists it as a
    /// session in the debugger and shows it.
    DebugSession { name: String, command: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tab {
    Containers,
    Images,
    Volumes,
    Networks,
    Compose,
    Project,
}

enum Status {
    Loading,
    /// The CLI is missing or the daemon cannot be reached.
    Unavailable(SharedString),
    Ready,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tone {
    Success,
    Error,
}

struct Notice {
    message: SharedString,
    tone: Tone,
}

type Retry = std::rc::Rc<dyn Fn(&mut DockerView, &mut Context<DockerView>)>;

/// What a failed action is called (`Couldn't stop web`), and how to try it again.
struct Failure {
    title: String,
    retry: Option<Retry>,
}

impl Failure {
    fn retry(title: impl Into<String>, retry: impl Fn(&mut DockerView, &mut Context<DockerView>) + 'static) -> Self {
        Self { title: title.into(), retry: Some(std::rc::Rc::new(retry)) }
    }
}

impl From<String> for Failure {
    fn from(title: String) -> Self {
        Self { title, retry: None }
    }
}

struct LogLine {
    stamp: Option<SharedString>,
    text: SharedString,
    stderr: bool,
}

struct Logs {
    title: SharedString,
    lines: VecDeque<LogLine>,
    follow: bool,
    /// Why the stream ended, once it has.
    ended: Option<SharedString>,
    scroll: UniformListScrollHandle,
    _stream: LogStream,
    _pump: Task<()>,
}

struct Inspect {
    /// What is inspected (`kind:id`): a slow answer for an earlier item is dropped.
    target: String,
    title: SharedString,
    text: Option<Result<String, String>>,
    lines: Vec<SharedString>,
    scroll: UniformListScrollHandle,
}

/// A page that covers the lists: a container's log, something's `docker inspect`, or the files
/// in a container.
enum Detail {
    Logs(Logs),
    Inspect(Inspect),
    Files(files::Files),
}

/// A preset waiting for its name.
#[derive(Clone)]
enum PendingPreset {
    Build(DockerBuildPreset),
    Run(DockerRunPreset),
    Compose(DockerComposePreset),
}

#[derive(Clone)]
enum FormKind {
    Tag { source: String },
    Run,
    Build,
    Pull,
    Login,
    CopyFrom { container: String, name: String },
    /// `refresh` reloads the file list once the copy lands.
    CopyTo { container: String, name: String, refresh: bool },
    Debug { container: String, name: String },
    SaveDebugPreset,
    EnvFile,
    PresetName(PendingPreset),
}

/// One field of a form: its label, placeholder and starting value.
struct Field {
    label: &'static str,
    placeholder: String,
    value: String,
    masked: bool,
}

impl Field {
    fn new(label: &'static str, placeholder: impl Into<String>) -> Self {
        Self { label, placeholder: placeholder.into(), value: String::new(), masked: false }
    }

    fn value(mut self, value: impl Into<String>) -> Self {
        self.value = value.into();
        self
    }

    fn masked(mut self) -> Self {
        self.masked = true;
        self
    }
}

/// Docker Hub's answer for the pull form's text.
#[derive(Default)]
struct Search {
    query: String,
    results: Vec<DockerRegistrySearchResult>,
    busy: bool,
    error: Option<SharedString>,
    epoch: usize,
}

/// A few fields asked for at the foot of the view: the tag for an image, a container to run.
struct Form {
    kind: FormKind,
    title: SharedString,
    confirm: SharedString,
    fields: Vec<(SharedString, Entity<TextInput>)>,
    /// A second button, such as "Save as Preset…".
    secondary: Option<SharedString>,
    search: Option<Search>,
    _subscriptions: Vec<Subscription>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PruneTarget {
    Containers,
    Images,
    Volumes,
    Networks,
    System,
}

impl PruneTarget {
    const ALL: [PruneTarget; 5] = [Self::Containers, Self::Images, Self::Volumes, Self::Networks, Self::System];

    fn id(self) -> &'static str {
        match self {
            Self::Containers => "containers",
            Self::Images => "images",
            Self::Volumes => "volumes",
            Self::Networks => "networks",
            Self::System => "system",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Containers => "Containers",
            Self::Images => "Images",
            Self::Volumes => "Volumes",
            Self::Networks => "Networks",
            Self::System => "System",
        }
    }

    fn question(self) -> String {
        match self {
            Self::System => "Remove all unused containers, networks, images and volumes?".to_string(),
            Self::Containers => "Remove all stopped containers?".to_string(),
            target => format!("Remove all unused {}?", target.label().to_lowercase()),
        }
    }
}

pub struct DockerView {
    cwd: Option<PathBuf>,
    focus_handle: FocusHandle,
    program: OsString,
    status: Status,
    containers: Vec<DockerContainer>,
    images: Vec<DockerImage>,
    volumes: Vec<DockerVolume>,
    networks: Vec<DockerNetwork>,
    compose: Option<DockerComposeProject>,
    compose_error: Option<SharedString>,
    project: Option<DockerProjectConfig>,
    project_error: Option<SharedString>,
    loading: bool,
    queued_refresh: bool,
    /// Drawn since the last poll: a view off screen stops polling until it is drawn again.
    drawn: bool,
    tab: Tab,
    detail: Option<Detail>,
    busy: HashSet<String>,
    notice: Option<Notice>,
    notice_epoch: usize,
    /// Failed actions report as toasts with Retry or Details, as the original's palette page
    /// does (`showDockerErrorToast`); the Docker tab shows them in its notice bar instead.
    toast_failures: bool,
    open_menu: Option<OpenMenu>,
    form: Option<Form>,
    filter_input: Entity<TextInput>,
    pending_open: Option<String>,
    /// A form `ATHAS_DOCKER_OPEN=form:<kind>` opens on the next frame (forms need the window).
    pub(crate) pending_form: Option<String>,
    _subscriptions: Vec<Subscription>,
    _poll: Task<()>,
}

impl EventEmitter<DockerViewEvent> for DockerView {}

impl Focusable for DockerView {
    fn focus_handle(&self, _: &gpui::App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl DockerView {
    /// `cwd` is the project, for its compose files and dev container.
    pub fn new(cwd: Option<PathBuf>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter_input = cx.new(|cx| {
            TextInput::new(window, cx)
                .placeholder("Filter")
                .appearance(InputAppearance::Bare)
                .leading_icon(ui::IconName::Search)
        });
        let subscriptions = vec![
            cx.subscribe(&filter_input, |_, input, event: &TextInputEvent, cx| match event {
                TextInputEvent::Changed(_) => cx.notify(),
                TextInputEvent::Cancelled => input.update(cx, |input, cx| input.set_text("", cx)),
                _ => {}
            }),
            // A page or form the command palette's Docker page asked this tab for.
            cx.observe_global_in::<palette_page::PendingTarget>(window, |this, window, cx| {
                if let Some(target) = cx.try_global::<palette_page::PendingTarget>().and_then(|pending| pending.0.clone()) {
                    cx.set_global(palette_page::PendingTarget(None));
                    this.open_target(&target, window, cx);
                }
            }),
            cx.observe_window_activation(window, |this, window, cx| {
                if window.is_window_active() && this.drawn {
                    this.refresh(cx);
                }
            }),
        ];
        let poll = cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor().timer(POLL_INTERVAL).await;
                let polled = this.update_in(cx, |this, window, cx| {
                    if window.is_window_active() && this.drawn {
                        this.drawn = false;
                        this.refresh(cx);
                    }
                });
                if polled.is_err() {
                    break;
                }
            }
        });
        let program = model::default_program();
        let pending_open = cfg!(debug_assertions).then(|| std::env::var("ATHAS_DOCKER_OPEN").ok()).flatten();

        let mut view = Self {
            cwd,
            focus_handle: cx.focus_handle(),
            program,
            status: Status::Loading,
            containers: Vec::new(),
            images: Vec::new(),
            volumes: Vec::new(),
            networks: Vec::new(),
            compose: None,
            compose_error: None,
            project: None,
            project_error: None,
            loading: false,
            queued_refresh: false,
            drawn: true,
            tab: Tab::Containers,
            detail: None,
            busy: HashSet::new(),
            notice: None,
            notice_epoch: 0,
            toast_failures: false,
            open_menu: None,
            form: None,
            filter_input,
            pending_open,
            pending_form: None,
            _subscriptions: subscriptions,
            _poll: poll,
        };
        view.refresh(cx);
        if let Some(target) = cx.try_global::<palette_page::PendingTarget>().and_then(|pending| pending.0.clone()) {
            cx.set_global(palette_page::PendingTarget(None));
            view.open_target(&target, window, cx);
        }
        view
    }

    /// Opens a page (`images`, `logs:<id>`, `files:<id>`, …) or a form (`form:run[:<image>]`,
    /// `form:build`, `form:pull`, `form:login`, `form:tag:<image>`, `form:debug:<id>`,
    /// `form:copy-from:<id>`, `form:copy-to:<id>`, `form:run-preset:<name>`,
    /// `form:build-preset:<name>`, `form:env-file`, `form:debug-preset`, `form:compose-preset`).
    pub fn open_target(&mut self, target: &str, window: &mut Window, cx: &mut Context<Self>) {
        let name = |this: &Self, id: &str| this.container(id).map_or_else(|| id.to_string(), |container| container.name.clone());
        let Some(form) = target.strip_prefix("form:") else {
            self.open_page(target, cx);
            cx.notify();
            return;
        };
        let (kind, argument) = form.split_once(':').map_or((form, None), |(kind, argument)| (kind, Some(argument.to_string())));
        match (kind, argument) {
            ("run", image) => self.open_run_form(None, image, window, cx),
            ("build", _) => self.open_build_form(None, window, cx),
            ("pull", _) => self.open_pull_form(window, cx),
            ("login", _) => self.open_login_form(window, cx),
            ("tag", Some(source)) => self.open_tag_form(source, window, cx),
            ("debug", Some(id)) => self.open_debug_form(id.clone(), name(self, &id), window, cx),
            ("copy-from", Some(id)) => self.open_copy_from_form(id.clone(), name(self, &id), None, window, cx),
            ("copy-to", Some(id)) => self.open_copy_to_form(id.clone(), name(self, &id), "/".to_string(), false, window, cx),
            ("run-preset", Some(preset)) => {
                let preset = self.project.as_ref().and_then(|project| project.run_presets.iter().find(|candidate| candidate.name == preset).cloned());
                self.open_run_form(preset, None, window, cx);
            }
            ("build-preset", Some(preset)) => {
                let preset = self.project.as_ref().and_then(|project| project.build_presets.iter().find(|candidate| candidate.name == preset).cloned());
                self.open_build_form(preset, window, cx);
            }
            ("env-file", _) => self.open_env_file_form(window, cx),
            ("debug-preset", _) => self.open_save_debug_preset_form(window, cx),
            ("compose-preset", _) => self.save_compose_preset(window, cx),
            _ => {}
        }
        cx.notify();
    }

    pub fn cwd(&self) -> Option<&PathBuf> {
        self.cwd.as_ref()
    }

    fn docker(&self) -> Docker {
        Docker::with_program(self.program.clone())
    }

    // Loading.

    fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.loading {
            self.queued_refresh = true;
            return;
        }
        self.loading = true;
        let docker = self.docker();
        let cwd = self.cwd.as_ref().map(|cwd| cwd.to_string_lossy().into_owned());
        let task = runtime::spawn(async move {
            let inventory = docker.inventory().await;
            let compose = match (&inventory, cwd.clone()) {
                (Ok(_), Some(cwd)) => Some(docker.compose_project(Some(cwd)).await),
                _ => None,
            };
            let project = cwd.map(|cwd| athas_docker::project_config(Some(cwd)));
            Ok((inventory, compose, project))
        });
        cx.spawn(async move |this, cx| {
            // A failed task (a panic in the Docker client) must still end the refresh: with
            // `loading` left set every later refresh only queues and nothing updates again.
            let (inventory, compose, project) = match task.await {
                Ok(result) => result,
                Err(error) => (Err(format!("{error}")), None, None),
            };
            this.update(cx, |this, cx| {
                this.apply_project(project);
                this.apply_refresh(inventory, compose, cx)
            })
            .ok();
        })
        .detach();
    }

    fn apply_project(&mut self, project: Option<Result<DockerProjectConfig, String>>) {
        match project {
            Some(Ok(project)) => {
                self.project = Some(project);
                self.project_error = None;
            }
            Some(Err(error)) => self.project_error = Some(error.into()),
            None => {}
        }
    }

    fn apply_refresh(
        &mut self,
        inventory: Result<DockerInventory, String>,
        compose: Option<Result<DockerComposeProject, String>>,
        cx: &mut Context<Self>,
    ) {
        self.loading = false;
        match inventory {
            Ok(inventory) => {
                self.status = Status::Ready;
                self.containers = inventory.containers;
                self.images = inventory.images;
                self.volumes = inventory.volumes;
                self.networks = inventory.networks;
                model::sort_containers(&mut self.containers);
                model::sort_images(&mut self.images);
                model::sort_volumes(&mut self.volumes);
                model::sort_networks(&mut self.networks);
            }
            Err(error) if model::is_connection_error(&error) || matches!(self.status, Status::Loading) => {
                self.status = Status::Unavailable(error.into());
                self.containers.clear();
                self.images.clear();
                self.volumes.clear();
                self.networks.clear();
                self.compose = None;
            }
            // A failed poll keeps what is on screen.
            Err(error) => self.report(error, Tone::Error, cx),
        }
        match compose {
            Some(Ok(mut project)) => {
                model::sort_services(&mut project.services);
                self.compose = Some(project);
                self.compose_error = None;
            }
            Some(Err(error)) => self.compose_error = Some(error.into()),
            None => {}
        }
        if matches!(self.status, Status::Ready)
            && let Some(page) = self.pending_open.take()
        {
            self.open_page(&page, cx);
        }
        cx.notify();
        if std::mem::take(&mut self.queued_refresh) {
            self.refresh(cx);
        }
    }

    /// Opens a page named the way `ATHAS_DOCKER_OPEN` names it.
    fn open_page(&mut self, page: &str, cx: &mut Context<Self>) {
        let title = |id: &str| {
            let container = self.containers.iter().find(|container| container.id == id || container.name == id);
            container.map_or_else(|| id.to_string(), |container| container.name.clone())
        };
        match page.split_once(':') {
            Some(("logs", id)) => self.open_logs(id.to_string(), title(id), cx),
            Some(("inspect", id)) => self.open_inspect("container", id.to_string(), title(id), cx),
            Some(("files", id)) => self.open_files(id.to_string(), title(id), cx),
            Some(("form", kind)) => self.pending_form = Some(kind.to_string()),
            _ => match page {
                "images" => self.tab = Tab::Images,
                "volumes" => self.tab = Tab::Volumes,
                "networks" => self.tab = Tab::Networks,
                "compose" => self.tab = Tab::Compose,
                "project" => self.tab = Tab::Project,
                _ => {}
            },
        }
    }

    fn container(&self, id: &str) -> Option<&DockerContainer> {
        self.containers.iter().find(|container| container.id == id)
    }

    // Actions.

    /// Runs `work` on the Docker runtime with `key` marked busy, then reports and reloads.
    fn run_action(
        &mut self,
        key: String,
        done: impl Into<SharedString>,
        failure: impl Into<Failure>,
        work: impl Future<Output = Result<String, String>> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        if !self.busy.insert(key.clone()) {
            return;
        }
        let done = done.into();
        let failure = failure.into();
        let task = runtime::spawn(work);
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy.remove(&key);
                match result {
                    Ok(output) => {
                        let message = match last_line(&output) {
                            Some(line) if line.starts_with("Total reclaimed space") => format!("{done} · {line}"),
                            _ => done.to_string(),
                        };
                        this.report(message, Tone::Success, cx);
                    }
                    Err(error) if this.toast_failures => this.toast_failure(failure, error, cx),
                    Err(error) => this.report(error, Tone::Error, cx),
                }
                this.refresh(cx);
            })
            .ok();
        })
        .detach();
    }

    fn container_action(&mut self, id: String, action: &'static str, cx: &mut Context<Self>) {
        let name = self.container(&id).map_or_else(|| id.clone(), |container| container.name.clone());
        let docker = self.docker();
        let done = match action {
            "start" => format!("Started {name}"),
            "stop" => format!("Stopped {name}"),
            "restart" => format!("Restarted {name}"),
            "pause" => format!("Paused {name}"),
            "unpause" => format!("Resumed {name}"),
            _ => format!("Removed {name}"),
        };
        let force = action == "remove";
        let failure = if force {
            Failure::from(format!("Couldn't remove {name}"))
        } else {
            let retry_id = id.clone();
            Failure::retry(format!("Couldn't {action} {name}"), move |view, cx| view.container_action(retry_id.clone(), action, cx))
        };
        self.run_action(
            format!("container:{id}"),
            done,
            failure,
            async move { docker.container_action(id, action.to_string(), Some(force)).await.map(|_| String::new()) },
            cx,
        );
    }

    fn remove_image(&mut self, image: &DockerImage, cx: &mut Context<Self>) {
        let reference = image_reference(image);
        let target = if image.repository == "<none>" { image.id.clone() } else { reference.clone() };
        let docker = self.docker();
        self.run_action(
            format!("image:{}:{}", image.id, image.tag),
            format!("Removed {reference}"),
            format!("Couldn't remove {reference}"),
            async move { docker.image_action(target, "remove".to_string(), Some(false)).await },
            cx,
        );
    }

    fn remove_volume(&mut self, name: String, cx: &mut Context<Self>) {
        let program = self.program.clone();
        let args = vec!["volume".to_string(), "rm".to_string(), name.clone()];
        self.run_action(format!("volume:{name}"), format!("Removed {name}"), format!("Couldn't remove {name}"), runtime::run_cli(program, args), cx);
    }

    fn push_image(&mut self, reference: String, cx: &mut Context<Self>) {
        let docker = self.docker();
        let image = reference.clone();
        let retry = reference.clone();
        let failure = Failure::retry(format!("Couldn't push {reference}"), move |view, cx| view.push_image(retry.clone(), cx));
        self.run_action(format!("push:{reference}"), format!("Pushed {reference}"), failure, async move { docker.registry_push(image).await }, cx);
    }

    fn compose_action(&mut self, service: Option<String>, action: &'static str, cx: &mut Context<Self>) {
        self.compose_action_with(service, action, Vec::new(), cx);
    }

    pub(crate) fn compose_action_with(&mut self, service: Option<String>, action: &'static str, env_files: Vec<String>, cx: &mut Context<Self>) {
        let Some(project) = &self.compose else { return };
        let Some(workspace) = project.workspace_path.clone() else { return };
        let files = project.files.clone();
        let docker = self.docker();
        let subject = service.clone().unwrap_or_else(|| "Compose project".to_string());
        let done = match action {
            "up" => format!("{subject} is up"),
            "down" => format!("{subject} is down"),
            "stop" => format!("Stopped {subject}"),
            "rebuild" => format!("Rebuilt {subject}"),
            _ => format!("Restarted {subject}"),
        };
        let key = format!("compose:{}", service.as_deref().unwrap_or(""));
        let target = service.clone().unwrap_or_else(|| "the Compose project".to_string());
        let (retry_service, retry_env) = (service.clone(), env_files.clone());
        let failure = Failure::retry(format!("Couldn't run compose {action} for {target}"), move |view, cx| {
            view.compose_action_with(retry_service.clone(), action, retry_env.clone(), cx)
        });
        self.run_action(
            key,
            done,
            failure,
            async move { docker.compose_action(workspace, files, service, action.to_string(), Some(env_files)).await },
            cx,
        );
    }

    fn prune(&mut self, target: PruneTarget, cx: &mut Context<Self>) {
        let docker = self.docker();
        self.run_action(
            format!("prune:{}", target.id()),
            format!("Pruned {}", target.label().to_lowercase()),
            format!("Couldn't prune Docker {}", target.label().to_lowercase()),
            async move { docker.prune_resources(target.id().to_string(), Some(target == PruneTarget::System)).await },
            cx,
        );
    }

    fn copy(&mut self, text: String, what: &str, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        self.report(format!("Copied {what}"), Tone::Success, cx);
    }

    /// `showDockerErrorToast`: a daemon that can't be reached links to the connection details;
    /// any other failure shows Docker's message and, when there is one, a way to try again.
    fn toast_failure(&mut self, failure: Failure, error: String, cx: &mut Context<Self>) {
        use notifications::{NotificationAction, NotificationCategory, NotificationKind, ToastOptions};
        let (message, description, action) = if model::is_connection_error(&error) {
            let (title, description) = model::toast_unavailable_copy(&error);
            let action = NotificationAction::new("Details", |_, cx| {
                cx.set_global(palette_page::PendingTarget(Some("containers".into())));
                workbench_api::open_resource(cx, "docker", "", "Docker");
            });
            (title.to_string(), description.to_string(), Some(action))
        } else {
            let view = cx.entity().downgrade();
            let action = failure.retry.map(|retry| {
                NotificationAction::new("Retry", move |_, cx| {
                    view.update(cx, |view, cx| retry(view, cx)).ok();
                })
            });
            (failure.title, error, action)
        };
        notifications::notify_with(
            cx,
            NotificationKind::Error,
            NotificationCategory::Athas,
            message,
            Some(description.into()),
            None,
            ToastOptions { action, ..ToastOptions::default() },
        );
    }

    fn report(&mut self, message: impl Into<SharedString>, tone: Tone, cx: &mut Context<Self>) {
        self.notice = Some(Notice { message: message.into(), tone });
        self.notice_epoch += 1;
        cx.notify();
        if tone == Tone::Success {
            let epoch = self.notice_epoch;
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(NOTICE_TIMEOUT).await;
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
    }

    fn show_tab(&mut self, tab: Tab, cx: &mut Context<Self>) {
        self.tab = tab;
        self.detail = None;
        cx.notify();
    }

    // Logs and inspect.

    fn open_logs(&mut self, container_id: String, title: String, cx: &mut Context<Self>) {
        #[cfg_attr(target_family = "wasm", allow(unused_mut))]
        let (stream, mut receiver) = LogStream::start(self.program.clone(), container_id, LOG_TAIL);
        #[cfg(target_family = "wasm")]
        let pump = cx.spawn(async move |this, cx| {
            loop {
                let following = this.update(cx, |this, _| matches!(&this.detail, Some(Detail::Logs(logs)) if logs._stream.poll()));
                let mut batch = Vec::new();
                while let Ok(message) = receiver.try_recv() {
                    batch.push(message);
                }
                if !batch.is_empty() && this.update(cx, |this, cx| this.append_logs(batch, cx)).is_err() {
                    break;
                }
                if !matches!(following, Ok(true)) {
                    break;
                }
                cx.background_executor().timer(LOG_POLL_INTERVAL).await;
            }
        });
        #[cfg(not(target_family = "wasm"))]
        let pump = cx.spawn(async move |this, cx| {
            while let Some(first) = receiver.next().await {
                let mut batch = vec![first];
                while let Ok(message) = receiver.try_recv() {
                    batch.push(message);
                }
                if this.update(cx, |this, cx| this.append_logs(batch, cx)).is_err() {
                    break;
                }
            }
        });
        self.detail = Some(Detail::Logs(Logs {
            title: title.into(),
            lines: VecDeque::new(),
            follow: true,
            ended: None,
            scroll: UniformListScrollHandle::new(),
            _stream: stream,
            _pump: pump,
        }));
        cx.notify();
    }

    fn append_logs(&mut self, batch: Vec<LogMessage>, cx: &mut Context<Self>) {
        let Some(Detail::Logs(logs)) = &mut self.detail else { return };
        for message in batch {
            match message {
                LogMessage::Line { stderr, text } => {
                    let (stamp, message) = model::split_log_timestamp(&text);
                    logs.lines.push_back(LogLine {
                        stamp: stamp.map(|stamp| SharedString::from(model::short_timestamp(stamp).to_string())),
                        text: SharedString::from(message.replace('\t', "    ")),
                        stderr,
                    });
                    if logs.lines.len() > LOG_LIMIT {
                        logs.lines.pop_front();
                    }
                }
                LogMessage::Exit { code, error } => {
                    logs.ended = Some(match (error, code) {
                        (Some(error), _) => error.into(),
                        (None, Some(code)) if code != 0 => format!("Log stream ended (exit {code})").into(),
                        _ => "Log stream ended".into(),
                    });
                }
            }
        }
        if logs.follow {
            logs.scroll.scroll_to_bottom();
        }
        cx.notify();
    }

    fn set_follow(&mut self, follow: bool, cx: &mut Context<Self>) {
        if let Some(Detail::Logs(logs)) = &mut self.detail {
            logs.follow = follow;
            if follow {
                logs.scroll.scroll_to_bottom();
            }
            cx.notify();
        }
    }

    fn clear_logs(&mut self, cx: &mut Context<Self>) {
        if let Some(Detail::Logs(logs)) = &mut self.detail {
            logs.lines.clear();
            cx.notify();
        }
    }

    fn open_inspect(&mut self, kind: &'static str, id: String, title: String, cx: &mut Context<Self>) {
        let target = format!("{kind}:{id}");
        self.detail = Some(Detail::Inspect(Inspect {
            target: target.clone(),
            title: title.into(),
            text: None,
            lines: Vec::new(),
            scroll: UniformListScrollHandle::new(),
        }));
        let task = runtime::spawn(runtime::inspect(self.program.clone(), kind, id));
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if let Some(Detail::Inspect(inspect)) = &mut this.detail
                    && inspect.target == target
                {
                    if let Ok(text) = &result {
                        inspect.lines = text.lines().map(|line| SharedString::from(line.to_string())).collect();
                    }
                    inspect.text = Some(result);
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
        cx.notify();
    }

    fn close_detail(&mut self, cx: &mut Context<Self>) {
        self.detail = None;
        cx.notify();
    }

    // Forms.

    fn open_form(
        &mut self,
        kind: FormKind,
        title: impl Into<SharedString>,
        confirm: &str,
        fields: Vec<Field>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let fields: Vec<(SharedString, Entity<TextInput>)> = fields
            .into_iter()
            .map(|field| {
                let input = cx.new(|cx| {
                    let mut input = TextInput::new(window, cx).placeholder(field.placeholder);
                    if field.masked {
                        input = input.masked();
                    }
                    input.set_text(field.value, cx);
                    input
                });
                (SharedString::from(field.label), input)
            })
            .collect();
        let subscriptions = fields
            .iter()
            .map(|(_, input)| {
                cx.subscribe_in(input, window, |this, _, event: &TextInputEvent, window, cx| match event {
                    TextInputEvent::Confirmed => this.submit_form(window, cx),
                    TextInputEvent::Cancelled => this.close_form(cx),
                    TextInputEvent::Changed(_) => this.form_changed(cx),
                    _ => {}
                })
            })
            .collect();
        if let Some((_, first)) = fields.first() {
            first.update(cx, |input, cx| {
                input.select_all_text(cx);
                input.focus(window, cx);
            });
        }
        let secondary = match kind {
            FormKind::Run | FormKind::Build if self.cwd.is_some() => Some("Save as Preset…".into()),
            _ => None,
        };
        let search = matches!(kind, FormKind::Pull).then(Search::default);
        self.form = Some(Form {
            kind,
            title: title.into(),
            confirm: confirm.to_string().into(),
            fields,
            secondary,
            search,
            _subscriptions: subscriptions,
        });
        cx.notify();
    }

    fn close_form(&mut self, cx: &mut Context<Self>) {
        self.form = None;
        cx.notify();
    }

    fn form_values(&self, cx: &Context<Self>) -> Vec<String> {
        self.form.as_ref().map_or_else(Vec::new, |form| form.fields.iter().map(|(_, input)| input.read(cx).text().trim().to_string()).collect())
    }

    /// The pull form searches Docker Hub a moment after the text stops changing.
    fn form_changed(&mut self, cx: &mut Context<Self>) {
        let query = self.form_values(cx).into_iter().next().unwrap_or_default();
        let Some(search) = self.form.as_mut().and_then(|form| form.search.as_mut()) else { return };
        if search.query == query {
            return;
        }
        search.query = query.clone();
        search.epoch += 1;
        let epoch = search.epoch;
        if query.is_empty() {
            search.results.clear();
            search.busy = false;
            search.error = None;
            cx.notify();
            return;
        }
        search.busy = true;
        cx.notify();
        let docker = self.docker();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SEARCH_DELAY).await;
            let still_wanted = this
                .read_with(cx, |this, _| this.form.as_ref().and_then(|form| form.search.as_ref()).is_some_and(|search| search.epoch == epoch))
                .unwrap_or(false);
            if !still_wanted {
                return;
            }
            let result = runtime::spawn(async move { docker.registry_search(query, Some(SEARCH_LIMIT)).await }).await;
            this.update(cx, |this, cx| {
                let Some(search) = this.form.as_mut().and_then(|form| form.search.as_mut()).filter(|search| search.epoch == epoch) else { return };
                search.busy = false;
                match result {
                    Ok(results) => {
                        search.results = results;
                        search.error = None;
                    }
                    Err(error) => search.error = Some(error.into()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn submit_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(form) = &self.form else { return };
        let values = self.form_values(cx);
        let value = |index: usize| values.get(index).cloned().unwrap_or_default();
        let optional = |index: usize| values.get(index).filter(|value| !value.is_empty()).cloned();
        let kind = form.kind.clone();
        let docker = self.docker();
        match kind {
            FormKind::Tag { source } => {
                let Some(target) = optional(0) else { return };
                let done = format!("Tagged {source} as {target}");
                let failure = format!("Couldn't tag {source}");
                self.run_action(format!("tag:{source}"), done, failure, async move { docker.tag_image(source, target).await }, cx);
            }
            FormKind::Run => {
                let Some(request) = run_request(&values) else { return };
                let image = request.image.clone();
                self.run_action(format!("run:{image}"), format!("Started a container from {image}"), format!("Couldn't run {image}"), async move { docker.run_image(request).await }, cx);
                self.tab = Tab::Containers;
            }
            FormKind::Build => {
                let Some(request) = build_request(&values) else { return };
                let subject = request.tag.clone().unwrap_or_else(|| request.context_path.clone());
                self.run_action(format!("build:{}", request.context_path), format!("Built {subject}"), "Couldn't build the image".to_string(), async move { docker.build_image(request).await }, cx);
                self.tab = Tab::Images;
            }
            FormKind::Pull => {
                let Some(image) = optional(0) else { return };
                self.pull(image, cx);
            }
            FormKind::Login => {
                let (Some(username), password) = (optional(1), values.get(2).cloned().unwrap_or_default()) else { return };
                if password.is_empty() {
                    return;
                }
                let registry = optional(0);
                let done = format!("Logged in to {}", registry.as_deref().unwrap_or("Docker Hub"));
                let failure = format!("Couldn't log in to {}", registry.as_deref().unwrap_or("Docker Hub"));
                let request = DockerRegistryLoginRequest { registry, username, password };
                self.run_action("login".to_string(), done, failure, async move { docker.registry_login(request).await }, cx);
            }
            FormKind::CopyFrom { container, name } if workbench_api::web_files(cx).is_some() => {
                let Some(source) = optional(0) else { return };
                self.copy_to_browser(container, name, source, cx);
            }
            FormKind::CopyFrom { container, name } => {
                let (Some(source), Some(host)) = (optional(0), optional(1)) else { return };
                let done = format!("Copied {source} from {name} to {host}");
                let failure = format!("Couldn't copy {source} from {name}");
                self.run_action(format!("copy:{container}"), done, failure, async move { docker.copy_from_container(container, source, host).await }, cx);
            }
            FormKind::CopyTo { container, name, refresh } => {
                let (Some(host), Some(destination)) = (optional(0), optional(1)) else { return };
                self.copy_to_container(container, name, host, destination, refresh, cx);
            }
            FormKind::Debug { container, name } => {
                let Some(command) = optional(0) else { return };
                self.run_debug(&container, &name, &command, optional(1).as_deref(), cx);
            }
            FormKind::SaveDebugPreset => {
                let (Some(name), Some(command)) = (optional(0), optional(1)) else { return };
                let workdir = optional(2);
                self.update_project("Saved the debug preset", cx, move |config| {
                    config.debug_presets.retain(|preset| preset.name != name);
                    config.debug_presets.push(athas_docker::DockerDebugPreset { name, command, workdir, target: "container".into(), source: Some("project".into()) });
                });
            }
            FormKind::EnvFile => {
                let path = value(0);
                if path.is_empty() {
                    return;
                }
                self.open_env_file_by_path(path, cx);
            }
            FormKind::PresetName(preset) => {
                let Some(name) = optional(0) else { return };
                self.save_preset(preset, name, cx);
            }
        }
        self.close_form(cx);
        window.focus(&self.focus_handle, cx);
    }

    /// The form's second button: the build or run form saved as a preset, named next.
    fn submit_secondary(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(form) = &self.form else { return };
        let values = self.form_values(cx);
        let preset = match form.kind {
            FormKind::Run => run_request(&values).map(|request| {
                PendingPreset::Run(DockerRunPreset {
                    name: String::new(),
                    image: request.image,
                    container_name: request.name,
                    ports: request.ports.unwrap_or_default(),
                    volumes: request.volumes.unwrap_or_default(),
                    env: request.env.unwrap_or_default(),
                    env_files: request.env_files.unwrap_or_default(),
                    command: request.command,
                })
            }),
            FormKind::Build => build_request(&values).map(|request| {
                PendingPreset::Build(DockerBuildPreset {
                    name: String::new(),
                    context_path: request.context_path,
                    dockerfile_path: request.dockerfile_path,
                    tag: request.tag,
                    build_args: request.build_args.unwrap_or_default(),
                })
            }),
            _ => None,
        };
        let Some(preset) = preset else { return };
        let (title, placeholder) = match preset {
            PendingPreset::Build(_) => ("Save Build Preset", "production image"),
            _ => ("Save Run Preset", "web app"),
        };
        self.open_form(FormKind::PresetName(preset), title, "Save", vec![Field::new("Name", placeholder)], window, cx);
    }

    fn pull(&mut self, image: String, cx: &mut Context<Self>) {
        let docker = self.docker();
        let done = format!("Pulled {image}");
        let retry = image.clone();
        let failure = Failure::retry(format!("Couldn't pull {image}"), move |view, cx| view.pull(retry.clone(), cx));
        self.run_action(format!("pull:{image}"), done, failure, async move { docker.registry_pull(image).await }, cx);
    }

    /// Pulls a Docker Hub result picked in the pull form.
    fn pull_result(&mut self, image: String, window: &mut Window, cx: &mut Context<Self>) {
        self.pull(image, cx);
        self.close_form(cx);
        window.focus(&self.focus_handle, cx);
    }

    // Menus.

    fn show_menu(&mut self, key: &str, entries: Vec<MenuEntry>, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        if self.menu_is_open(key) {
            self.open_menu = None;
            cx.notify();
            return;
        }
        self.open_menu = Some(OpenMenu::new(key.to_string(), entries, position, Anchor::TopRight, window, cx, |this: &mut Self, _| {
            this.open_menu = None
        }));
        cx.notify();
    }

    fn menu_is_open(&self, key: &str) -> bool {
        self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == key)
    }

    /// A menu item that calls back into the view.
    fn item(
        &self,
        label: impl Into<SharedString>,
        cx: &Context<Self>,
        action: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> MenuItem {
        let this = cx.entity().downgrade();
        MenuItem::new(label).on_select(move |window, cx| {
            this.update(cx, |this, cx| action(this, window, cx)).ok();
        })
    }

    /// Asks before something that cannot be undone: a menu with the question and one action.
    fn confirm(
        &mut self,
        question: impl Into<SharedString>,
        label: &str,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
        action: impl Fn(&mut Self, &mut Context<Self>) + 'static,
    ) {
        self.open_menu = None;
        let question = question.into();
        let key = format!("confirm:{question}");
        let entries = vec![
            MenuEntry::Label(question),
            self.item(label.to_string(), cx, move |this, _, cx| action(this, cx)).icon(ui::IconName::Trash).destructive().into(),
        ];
        self.show_menu(&key, entries, position, window, cx);
    }

    fn confirm_remove_container(&mut self, id: String, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(container) = self.container(&id) else { return };
        let question = if ContainerState::parse(&container.state) == ContainerState::Running {
            format!("Stop and remove {}?", container.name)
        } else {
            format!("Remove {}?", container.name)
        };
        self.confirm(question, "Remove Container", position, window, cx, move |this, cx| {
            this.container_action(id.clone(), "remove", cx)
        });
    }

    fn confirm_remove_image(&mut self, index: usize, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(image) = self.images.get(index).cloned() else { return };
        let question = format!("Remove the image {}?", image_reference(&image));
        self.confirm(question, "Remove Image", position, window, cx, move |this, cx| {
            this.remove_image(&image, cx)
        });
    }

    fn confirm_remove_volume(&mut self, name: String, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let question = format!("Remove the volume {name}? Its data is lost.");
        self.confirm(question, "Remove Volume", position, window, cx, move |this, cx| {
            this.remove_volume(name.clone(), cx)
        });
    }

    fn prune_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let mut entries = vec![MenuEntry::Label("Prune unused".into())];
        for target in PruneTarget::ALL {
            entries.push(
                self.item(target.label(), cx, move |this, window, cx| {
                    let position = window.mouse_position();
                    this.confirm(target.question(), &format!("Prune {}", target.label()), position, window, cx, move |this, cx| {
                        this.prune(target, cx)
                    });
                })
                .disabled(self.busy.contains(&format!("prune:{}", target.id())))
                .into(),
            );
        }
        entries
    }

    fn container_menu(&self, container: &DockerContainer, cx: &Context<Self>) -> Vec<MenuEntry> {
        use ui::IconName;
        let state = ContainerState::parse(&container.state);
        let running = state == ContainerState::Running;
        let paused = state == ContainerState::Paused;
        let id = container.id.clone();
        let name = container.name.clone();
        let action = |label: &str, icon: IconName, action: &'static str| -> MenuEntry {
            let id = id.clone();
            self.item(label.to_string(), cx, move |this, _, cx| this.container_action(id.clone(), action, cx)).icon(icon).into()
        };
        let mut entries = Vec::new();
        if !running && !paused {
            entries.push(action("Start", IconName::Play, "start"));
        }
        if running {
            entries.push(action("Stop", IconName::Stop, "stop"));
        }
        if running || paused {
            entries.push(action("Restart", IconName::ArrowsClockwise, "restart"));
        }
        if running {
            entries.push(action("Pause", IconName::Pause, "pause"));
        }
        if paused {
            entries.push(action("Resume", IconName::Play, "unpause"));
        }
        entries.push(MenuEntry::Separator);
        let (logs_id, logs_name) = (id.clone(), name.clone());
        entries.push(
            self.item("Show Logs", cx, move |this, _, cx| this.open_logs(logs_id.clone(), logs_name.clone(), cx)).icon(IconName::List).into(),
        );
        let (inspect_id, inspect_name) = (id.clone(), name.clone());
        entries.push(
            self.item("Inspect", cx, move |this, _, cx| this.open_inspect("container", inspect_id.clone(), inspect_name.clone(), cx))
                .icon(IconName::Info)
                .into(),
        );
        if running {
            let (shell_id, shell_name) = (id.clone(), name.clone());
            entries.push(
                self.item("Open Shell", cx, move |this, _, cx| this.open_shell(shell_id.clone(), shell_name.clone(), cx)).icon(IconName::TerminalWindow).into(),
            );
            let (debug_id, debug_name) = (id.clone(), name.clone());
            entries.push(
                self.item("Debug…", cx, move |this, window, cx| this.open_debug_form(debug_id.clone(), debug_name.clone(), window, cx)).icon(IconName::Bug).into(),
            );
            let (files_id, files_name) = (id.clone(), name.clone());
            entries.push(
                self.item("Browse Files…", cx, move |this, _, cx| this.open_files(files_id.clone(), files_name.clone(), cx)).icon(IconName::Folder).into(),
            );
        }
        if let Some(url) = model::service_url(&container.ports) {
            entries.push(
                self.item(format!("Open {url}"), cx, move |_, _, cx| cx.open_url(&url)).icon(IconName::OpenExternal).into(),
            );
        }
        entries.push(MenuEntry::Separator);
        let (from_id, from_name) = (id.clone(), name.clone());
        entries.push(
            self.item("Copy From Container…", cx, move |this, window, cx| this.open_copy_from_form(from_id.clone(), from_name.clone(), None, window, cx))
                .icon(IconName::Download)
                .into(),
        );
        let (to_id, to_name) = (id.clone(), name.clone());
        entries.push(
            self.item("Copy To Container…", cx, move |this, window, cx| this.open_copy_to_form(to_id.clone(), to_name.clone(), "/".to_string(), false, window, cx))
                .icon(IconName::Upload)
                .into(),
        );
        entries.push(MenuEntry::Separator);
        let copy_id = id.clone();
        entries.push(self.item("Copy Container ID", cx, move |this, _, cx| this.copy(copy_id.clone(), "the container ID", cx)).icon(IconName::Copy).into());
        entries.push(self.item("Copy Container Name", cx, move |this, _, cx| this.copy(name.clone(), "the container name", cx)).icon(IconName::Copy).into());
        entries.push(MenuEntry::Separator);
        entries.push(
            self.item("Remove…", cx, move |this, window, cx| {
                let position = window.mouse_position();
                this.confirm_remove_container(id.clone(), position, window, cx)
            })
            .icon(IconName::Trash)
            .destructive()
            .into(),
        );
        entries
    }

    fn image_menu(&self, index: usize, cx: &Context<Self>) -> Vec<MenuEntry> {
        use ui::IconName;
        let Some(image) = self.images.get(index) else { return Vec::new() };
        let reference = image_reference(image);
        let dangling = image.repository == "<none>";
        let (run_ref, tag_ref, push_ref, inspect_ref) = (reference.clone(), reference.clone(), reference.clone(), reference.clone());
        let inspect_id = image.id.clone();
        let id = image.id.clone();
        vec![
            self.item("Run…", cx, move |this, window, cx| this.open_run_form(None, Some(run_ref.clone()), window, cx)).icon(IconName::Play).into(),
            self.item("Tag…", cx, move |this, window, cx| this.open_tag_form(tag_ref.clone(), window, cx))
            .icon(IconName::Tag)
            .into(),
            self.item("Push", cx, move |this, _, cx| this.push_image(push_ref.clone(), cx)).icon(IconName::Upload).disabled(dangling).into(),
            self.item("Inspect", cx, move |this, _, cx| this.open_inspect("image", inspect_id.clone(), inspect_ref.clone(), cx)).icon(IconName::Info).into(),
            self.item("Copy Image ID", cx, move |this, _, cx| this.copy(id.clone(), "the image ID", cx)).icon(IconName::Copy).into(),
            MenuEntry::Separator,
            self.item("Remove…", cx, move |this, window, cx| {
                let position = window.mouse_position();
                this.confirm_remove_image(index, position, window, cx)
            })
            .icon(IconName::Trash)
            .destructive()
            .into(),
        ]
    }

    fn open_run_form(&mut self, preset: Option<DockerRunPreset>, image: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let preset = preset.unwrap_or_else(|| DockerRunPreset {
            name: String::new(),
            image: image.unwrap_or_default(),
            container_name: None,
            ports: Vec::new(),
            volumes: Vec::new(),
            env: Vec::new(),
            env_files: Vec::new(),
            command: None,
        });
        let title = if preset.image.is_empty() { "Run an image".to_string() } else { format!("Run {}", preset.image) };
        let fields = vec![
            Field::new("Image", "nginx:latest").value(preset.image),
            Field::new("Name", "Optional").value(preset.container_name.unwrap_or_default()),
            Field::new("Ports", "8080:80, 5432:5432").value(preset.ports.join(", ")),
            Field::new("Volumes", "./data:/data").value(preset.volumes.join(", ")),
            Field::new("Environment", "KEY=value, OTHER=value").value(preset.env.join(", ")),
            Field::new("Env files", ".env").value(preset.env_files.join(", ")),
            Field::new("Command", "Optional").value(preset.command.unwrap_or_default()),
        ];
        self.open_form(FormKind::Run, title, "Run", fields, window, cx);
    }

    fn open_build_form(&mut self, preset: Option<DockerBuildPreset>, window: &mut Window, cx: &mut Context<Self>) {
        let context = preset.as_ref().map(|preset| preset.context_path.clone()).or_else(|| self.cwd.as_ref().map(|cwd| cwd.to_string_lossy().into_owned()));
        let fields = vec![
            Field::new("Context", "/path/to/project").value(context.unwrap_or_default()),
            Field::new("Dockerfile", "/path/to/Dockerfile").value(preset.as_ref().and_then(|preset| preset.dockerfile_path.clone()).unwrap_or_default()),
            Field::new("Tag", "my-app:latest").value(preset.as_ref().and_then(|preset| preset.tag.clone()).unwrap_or_default()),
            Field::new("Build args", "NODE_ENV=production").value(preset.map(|preset| preset.build_args.join(", ")).unwrap_or_default()),
        ];
        self.open_form(FormKind::Build, "Build an image", "Build", fields, window, cx);
    }

    /// `ATHAS_DOCKER_OPEN=form:<kind>`: a form filled with fixture data, for snapshots.
    pub(crate) fn open_named_form(&mut self, kind: &str, window: &mut Window, cx: &mut Context<Self>) {
        match kind {
            "run" => self.open_run_form(None, Some("nginx:1.27".into()), window, cx),
            "build" => self.open_build_form(None, window, cx),
            "pull" => self.open_pull_form(window, cx),
            "login" => self.open_login_form(window, cx),
            "tag" => self.open_tag_form("nginx:1.27".into(), window, cx),
            "debug" => self.open_debug_form("c1a2b3c4d5e6".into(), "project-web-1".into(), window, cx),
            _ => {}
        }
    }

    fn open_pull_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_form(FormKind::Pull, "Pull an image", "Pull", vec![Field::new("Image", "Search Docker Hub or type an image, e.g. nginx:latest")], window, cx);
    }

    fn open_login_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let fields = vec![
            Field::new("Registry", "Leave empty for Docker Hub"),
            Field::new("Username", "Username"),
            Field::new("Password or token", "Password or token").masked(),
        ];
        self.open_form(FormKind::Login, "Log in to a registry", "Log In", fields, window, cx);
    }

    fn open_tag_form(&mut self, source: String, window: &mut Window, cx: &mut Context<Self>) {
        self.open_form(FormKind::Tag { source: source.clone() }, format!("Tag {source}"), "Tag", vec![Field::new("New tag", "ghcr.io/me/app:dev")], window, cx);
    }

    // Terminal commands.

    fn program_name(&self) -> String {
        self.program.to_string_lossy().into_owned()
    }

    fn run_in_terminal(&mut self, command: String, name: String, cwd: Option<PathBuf>, cx: &mut Context<Self>) {
        cx.emit(DockerViewEvent::RunInTerminal { command, name, cwd });
    }

    fn open_shell(&mut self, container: String, name: String, cx: &mut Context<Self>) {
        let command = model::exec_command(&self.program_name(), &container);
        self.run_in_terminal(command, format!("Docker: {name}"), None, cx);
    }

    fn run_debug(&mut self, container: &str, name: &str, command: &str, workdir: Option<&str>, cx: &mut Context<Self>) {
        let command = model::debug_command(&self.program_name(), container, command, workdir);
        let name = format!("Debug: {name}");
        self.run_in_terminal(command.clone(), name.clone(), None, cx);
        cx.emit(DockerViewEvent::DebugSession { name, command });
    }

    fn open_debug_form(&mut self, container: String, name: String, window: &mut Window, cx: &mut Context<Self>) {
        let fields = vec![
            Field::new("Debug command", "python -m pdb app.py"),
            Field::new("Working directory", "Optional, in the container"),
        ];
        self.open_form(FormKind::Debug { container, name: name.clone() }, format!("Debug {name}"), "Start Debugging", fields, window, cx);
    }

    fn open_copy_from_form(&mut self, container: String, name: String, source: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        if workbench_api::web_files(cx).is_some() {
            let fields = vec![Field::new("File in the container", "/app/output.log").value(source.unwrap_or_default())];
            self.open_form(FormKind::CopyFrom { container, name: name.clone() }, format!("Download from {name}"), "Download", fields, window, cx);
            return;
        }
        let fields = vec![
            Field::new("Path in the container", "/").value(source.unwrap_or_else(|| "/".to_string())),
            Field::new("Host path", "~/Downloads"),
        ];
        let focus_host = fields[0].value != "/";
        self.open_form(FormKind::CopyFrom { container, name: name.clone() }, format!("Copy from {name}"), "Copy to Host", fields, window, cx);
        if focus_host && let Some((_, host)) = self.form.as_ref().and_then(|form| form.fields.get(1)) {
            host.update(cx, |input, cx| input.focus(window, cx));
        }
    }

    fn open_copy_to_form(&mut self, container: String, name: String, destination: String, refresh: bool, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(web) = workbench_api::web_files(cx) {
            let (this, handle) = (cx.weak_entity(), window.window_handle());
            (web.upload)(
                None,
                Box::new(move |chosen, cx| match chosen {
                    Ok(Some(path)) => {
                        handle
                            .update(cx, |_, window, cx| {
                                this.update(cx, |this, cx| {
                                    this.open_copy_to_form_with(container, name, path.to_string_lossy().into_owned(), destination, refresh, window, cx)
                                })
                                .ok();
                            })
                            .ok();
                    }
                    Ok(None) => {}
                    Err(error) => {
                        this.update(cx, |this, cx| this.report(error, Tone::Error, cx)).ok();
                    }
                }),
                cx,
            );
            return;
        }
        self.open_copy_to_form_with(container, name, String::new(), destination, refresh, window, cx);
    }

    /// The copy form with the host file filled in: on the web, the file just uploaded.
    #[allow(clippy::too_many_arguments)]
    fn open_copy_to_form_with(&mut self, container: String, name: String, host: String, destination: String, refresh: bool, window: &mut Window, cx: &mut Context<Self>) {
        let fields = vec![
            Field::new("Host file or folder", "/path/on/this/machine").value(host),
            Field::new("Destination", "/").value(destination),
        ];
        self.open_form(FormKind::CopyTo { container, name: name.clone(), refresh }, format!("Copy into {name}"), "Copy to Container", fields, window, cx);
    }

    /// On the web: copies a container's file into a transfer folder on the server, then
    /// downloads it in the browser.
    fn copy_to_browser(&mut self, container: String, name: String, source: String, cx: &mut Context<Self>) {
        let Some(web) = workbench_api::web_files(cx) else { return };
        let folder = match (web.transfer_dir)(cx) {
            Ok(folder) => folder,
            Err(error) => {
                self.report(error, Tone::Error, cx);
                return;
            }
        };
        let key = format!("copy:{container}");
        if !self.busy.insert(key.clone()) {
            return;
        }
        let docker = self.docker();
        let host = folder.to_string_lossy().into_owned();
        let file_name = source.trim_end_matches('/').rsplit('/').next().unwrap_or_default().to_string();
        let task = runtime::spawn(async move { docker.copy_from_container(container, source, host).await });
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy.remove(&key);
                let downloaded = result.and_then(|_| (web.download_transfer)(&folder.join(&file_name), cx));
                match downloaded {
                    Ok(()) => this.report(format!("Downloaded {file_name} from {name}"), Tone::Success, cx),
                    Err(error) => this.report(error, Tone::Error, cx),
                }
            })
            .ok();
        })
        .detach();
    }

    fn copy_to_container(&mut self, container: String, name: String, host: String, destination: String, refresh: bool, cx: &mut Context<Self>) {
        let docker = self.docker();
        let key = format!("copy:{container}");
        if !self.busy.insert(key.clone()) {
            return;
        }
        let done = format!("Copied {host} into {name}");
        let task = runtime::spawn(async move { docker.copy_to_container(container, host, destination).await });
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy.remove(&key);
                match result {
                    Ok(_) => {
                        this.report(done, Tone::Success, cx);
                        if refresh {
                            this.reload_files(cx);
                        }
                    }
                    Err(error) => this.report(error, Tone::Error, cx),
                }
            })
            .ok();
        })
        .detach();
    }

}

fn list_field(value: Option<&String>) -> Option<Vec<String>> {
    value.map(|value| model::split_config_lines(value)).filter(|entries| !entries.is_empty())
}

/// The run form's values as a `docker run` request; `None` without an image.
fn run_request(values: &[String]) -> Option<DockerRunImageRequest> {
    let optional = |index: usize| values.get(index).filter(|value| !value.is_empty()).cloned();
    Some(DockerRunImageRequest {
        image: optional(0)?,
        name: optional(1),
        ports: list_field(values.get(2)),
        volumes: list_field(values.get(3)),
        env: list_field(values.get(4)),
        env_files: list_field(values.get(5)),
        command: optional(6),
        detach: Some(true),
    })
}

/// The build form's values as a `docker build` request; `None` without a context.
fn build_request(values: &[String]) -> Option<DockerBuildImageRequest> {
    let optional = |index: usize| values.get(index).filter(|value| !value.is_empty()).cloned();
    Some(DockerBuildImageRequest {
        context_path: optional(0)?,
        dockerfile_path: optional(1),
        tag: optional(2),
        build_args: list_field(values.get(3)),
    })
}

#[cfg(test)]
mod form_tests {
    use super::*;

    fn values(list: &[&str]) -> Vec<String> {
        list.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn run_form_values_become_a_detached_run() {
        let request = run_request(&values(&["nginx", "", "8080:80, 443:443", "", "A=1\nB=2", ".env", "nginx -g 'daemon off;'"])).unwrap();
        assert_eq!(request.image, "nginx");
        assert_eq!(request.name, None);
        assert_eq!(request.ports, Some(vec!["8080:80".to_string(), "443:443".to_string()]));
        assert_eq!(request.volumes, None);
        assert_eq!(request.env, Some(vec!["A=1".to_string(), "B=2".to_string()]));
        assert_eq!(request.env_files, Some(vec![".env".to_string()]));
        assert_eq!(request.detach, Some(true));
        assert!(run_request(&values(&["", "name"])).is_none());
    }

    fn fake_docker() -> Docker {
        Docker::with_program(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/fake-docker"))
    }

    #[test]
    fn registry_search_login_and_container_files_run_against_the_fake_cli() {
        let docker = fake_docker();
        let results = futures::executor::block_on(runtime::spawn(async move { docker.registry_search("nginx".into(), Some(SEARCH_LIMIT)).await })).unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].name, "nginx");
        assert_eq!(results[0].official, "[OK]");
        let docker = fake_docker();
        let request = DockerRegistryLoginRequest { registry: None, username: "me".into(), password: "secret".into() };
        let output = futures::executor::block_on(runtime::spawn(async move { docker.registry_login(request).await })).unwrap();
        assert!(output.contains("Login Succeeded"));
        let docker = fake_docker();
        let request = DockerRegistryLoginRequest { registry: Some("ghcr.io".into()), username: "me".into(), password: "wrong".into() };
        assert!(futures::executor::block_on(runtime::spawn(async move { docker.registry_login(request).await })).unwrap_err().contains("unauthorized"));
        let docker = fake_docker();
        let root = futures::executor::block_on(runtime::spawn(async move { docker.list_container_files("c1".into(), Some("/".into())).await })).unwrap();
        assert_eq!(root.iter().map(|entry| (entry.name.as_str(), entry.is_directory)).collect::<Vec<_>>(), vec![("etc", true), ("srv", true)]);
        let docker = fake_docker();
        let nginx = futures::executor::block_on(runtime::spawn(async move { docker.list_container_files("c1".into(), Some("/etc/nginx".into())).await })).unwrap();
        assert_eq!(nginx.len(), 1);
        assert_eq!(nginx[0].path, "/etc/nginx/nginx.conf");
        assert!(!nginx[0].is_directory);
    }

    #[test]
    fn build_form_needs_a_context() {
        let request = build_request(&values(&["/srv/app", "", "app:dev", "A=1, B=2"])).unwrap();
        assert_eq!(request.context_path, "/srv/app");
        assert_eq!(request.dockerfile_path, None);
        assert_eq!(request.tag.as_deref(), Some("app:dev"));
        assert_eq!(request.build_args, Some(vec!["A=1".to_string(), "B=2".to_string()]));
        assert!(build_request(&values(&[""])).is_none());
    }
}
