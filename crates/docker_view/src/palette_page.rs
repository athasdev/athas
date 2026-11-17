//! The command palette's Docker page (`docker-command.tsx`): containers, Compose services, project
//! presets, images, volumes and networks, each opening a page of its actions, and the actions
//! that make new things. Quick actions run here; the page shows a success and a failure is a toast
//! with Retry or Details, as the original's (`showDockerErrorToast`); logs and inspect
//! run in a terminal, as the original's; forms and a container's files open on the Docker tab.

use std::path::PathBuf;

use gpui::{AnyElement, App, AppContext as _, Context, Entity, Global, SharedString, Subscription, Window, div, prelude::*, px};
use palette::{PaletteRow, Picker, PickerDelegate};
use theme::ActiveTheme;
use ui::{Badge, Button, ButtonSize, ButtonVariant, IconName, typography};

use crate::{DockerView, DockerViewEvent, PruneTarget, Status, Tone as NoticeTone, model};

/// A Docker tab page or form the palette asked for; the Docker tab opens it (`open_target`).
#[derive(Default)]
pub(crate) struct PendingTarget(pub Option<String>);

impl Global for PendingTarget {}

#[derive(Clone, Debug, PartialEq)]
enum Page {
    Root,
    Container(String),
    Compose,
    Service(String),
    Image(String),
    Volume(String),
    Network(String),
    Prune,
    Confirm { question: String, label: String, action: Box<Action>, back: Box<Page> },
}

#[derive(Clone, Debug, PartialEq)]
enum Action {
    Open(Page),
    Container(String, &'static str),
    Compose(Option<String>, &'static str),
    /// Compose Up with the workspace's env files.
    ComposeWithEnv(Vec<String>),
    ComposePreset(String),
    RemoveImage(String),
    RemoveVolume(String),
    PushImage(String),
    Prune(PruneTarget),
    Terminal { command: String, name: String },
    Copy(String, &'static str),
    Url(String),
    /// A Docker tab page or form, by `open_target` id.
    Tab(String),
    Refresh,
}

#[derive(Clone)]
struct Row {
    section: Option<&'static str>,
    icon: IconName,
    title: String,
    description: String,
    badge: Option<(String, ui::Tone)>,
    action: Action,
}

fn row(icon: IconName, title: impl Into<String>, action: Action) -> Row {
    Row { section: None, icon, title: title.into(), description: String::new(), badge: None, action }
}

impl Row {
    fn section(mut self, section: &'static str) -> Self {
        self.section = Some(section);
        self
    }

    fn description(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    fn badge(mut self, label: impl Into<String>, tone: ui::Tone) -> Self {
        self.badge = Some((label.into(), tone));
        self
    }
}

/// `getDockerComposeLogsCommand`: every service's logs, or one's, followed in a terminal.
fn compose_logs_command(program: &str, files: &[String], service: Option<&str>) -> String {
    let mut command = format!("{} compose", model::shell_quote(program));
    for file in files {
        command.push_str(&format!(" -f {}", model::shell_quote(file)));
    }
    command.push_str(" logs -f --tail 300");
    if let Some(service) = service {
        command.push_str(&format!(" {}", model::shell_quote(service)));
    }
    command
}

fn join(parts: &[&str]) -> String {
    parts.iter().filter(|part| !part.trim().is_empty()).copied().collect::<Vec<_>>().join(" · ")
}

fn tone(state: &str, health: Option<&str>) -> ui::Tone {
    match model::state_tone(state, health) {
        model::Tone::Success => ui::Tone::Success,
        model::Tone::Warning => ui::Tone::Warning,
        model::Tone::Danger => ui::Tone::Danger,
        model::Tone::Accent => ui::Tone::Accent,
        _ => ui::Tone::Neutral,
    }
}

pub struct DockerPaletteDelegate {
    model: Entity<DockerView>,
    stack: Vec<Page>,
    rows: Vec<Row>,
    selected: usize,
    query: String,
    _subscriptions: Vec<Subscription>,
}

/// Opens the Docker page over the project at `cwd`; the host shows it as a modal.
pub fn docker_picker(cwd: Option<PathBuf>, window: &mut Window, cx: &mut App) -> Entity<Picker<DockerPaletteDelegate>> {
    let model = cx.new(|cx| {
        let mut view = DockerView::new(cwd, window, cx);
        view.toast_failures = true;
        view
    });
    cx.new(|cx| {
        let delegate = DockerPaletteDelegate { model: model.clone(), stack: vec![Page::Root], rows: Vec::new(), selected: 0, query: String::new(), _subscriptions: Vec::new() };
        let mut picker = Picker::new(delegate, window, cx);
        let subscriptions = vec![
            cx.observe_in(&model, window, |picker: &mut Picker<DockerPaletteDelegate>, _, window, cx| {
                let selected = picker.delegate.selected;
                picker.refresh_matches(window, cx);
                picker.delegate.selected = selected.min(picker.delegate.rows.len().saturating_sub(1));
            }),
            cx.subscribe(&model, |_, _, event: &DockerViewEvent, cx| match event {
                DockerViewEvent::RunInTerminal { command, cwd, .. } => workbench_api::run_in_terminal(cx, command.clone(), cwd.clone()),
                DockerViewEvent::OpenFile(path) => workbench_api::open_file(cx, path.clone(), None),
                DockerViewEvent::DebugSession { .. } => {}
            }),
        ];
        picker.delegate._subscriptions = subscriptions;
        picker
    })
}

impl DockerPaletteDelegate {
    fn page(&self) -> &Page {
        self.stack.last().unwrap_or(&Page::Root)
    }

    fn build_rows(&self, cx: &App) -> Vec<Row> {
        let view = self.model.read(cx);
        let program = view.program_name();
        match self.page() {
            Page::Root => root_rows(view),
            Page::Container(id) => {
                let Some(container) = view.containers.iter().find(|container| &container.id == id) else { return Vec::new() };
                let state = model::ContainerState::parse(&container.state);
                let running = state == model::ContainerState::Running;
                let paused = state == model::ContainerState::Paused;
                let act = |title: &str, icon: IconName, action: &'static str| row(icon, title, Action::Container(id.clone(), action));
                let mut rows = Vec::new();
                if !running && !paused {
                    rows.push(act("Start", IconName::Play, "start"));
                }
                if running {
                    rows.push(act("Stop", IconName::Stop, "stop"));
                }
                if running || paused {
                    rows.push(act("Restart", IconName::ArrowsClockwise, "restart"));
                }
                if running {
                    rows.push(act("Pause", IconName::Pause, "pause"));
                }
                if paused {
                    rows.push(act("Unpause", IconName::Play, "unpause"));
                }
                rows.push(
                    row(
                        IconName::List,
                        "Show Logs",
                        Action::Terminal { command: format!("{program} logs -f --tail 500 {id}"), name: format!("Logs: {}", container.name) },
                    )
                    .description("Follow the logs in a terminal"),
                );
                if running {
                    rows.push(
                        row(IconName::TerminalWindow, "Open Shell", Action::Terminal { command: model::exec_command(&program, id), name: format!("Docker: {}", container.name) })
                            .description("Open bash or sh in a terminal"),
                    );
                    rows.push(row(IconName::Bug, "Debug…", Action::Tab(format!("form:debug:{id}"))).description("Run a debug command in the container"));
                    rows.push(row(IconName::Folder, "Browse Files…", Action::Tab(format!("files:{id}"))).description("List files and copy them to or from the host"));
                }
                if let Some(url) = model::service_url(&container.ports) {
                    rows.push(row(IconName::OpenExternal, "Open Service URL", Action::Url(url.clone())).description(url));
                }
                rows.push(row(IconName::Download, "Copy From Container…", Action::Tab(format!("form:copy-from:{id}"))).description("Copy a file or folder to the host"));
                rows.push(row(IconName::Upload, "Copy To Container…", Action::Tab(format!("form:copy-to:{id}"))).description("Copy a host file or folder into the container"));
                rows.push(
                    row(IconName::Info, "Inspect", Action::Terminal { command: format!("{program} inspect {id}"), name: format!("Inspect: {}", container.name) })
                        .description("Show docker inspect in a terminal"),
                );
                rows.push(row(IconName::Copy, "Copy Container ID", Action::Copy(id.clone(), "the container ID")).description(id.clone()));
                rows.push(row(IconName::Copy, "Copy Container Name", Action::Copy(container.name.clone(), "the container name")));
                rows.push(row(
                    IconName::Trash,
                    "Remove",
                    Action::Open(Page::Confirm {
                        question: if running { format!("Stop and remove {}?", container.name) } else { format!("Remove {}?", container.name) },
                        label: "Remove Container".into(),
                        action: Box::new(Action::Container(id.clone(), "remove")),
                        back: Box::new(Page::Container(id.clone())),
                    }),
                ));
                rows
            }
            Page::Compose => {
                let Some(project) = view.compose.as_ref() else { return Vec::new() };
                let env_files = view.project.as_ref().map(|config| config.env_files.clone()).unwrap_or_default();
                let mut rows = vec![row(IconName::Play, "Up", Action::Compose(None, "up")).description("Start every service")];
                if !env_files.is_empty() {
                    let names: Vec<&str> = env_files.iter().map(|file| file.relative_path.as_str()).collect();
                    rows.push(
                        row(IconName::File, "Up With Env Files", Action::ComposeWithEnv(env_files.iter().map(|file| file.path.clone()).collect()))
                            .description(names.join(", ")),
                    );
                }
                rows.push(row(IconName::ArrowsClockwise, "Restart", Action::Compose(None, "restart")));
                rows.push(row(IconName::Stop, "Down", Action::Compose(None, "down")).description("Stop and remove the project's containers"));
                rows.push(
                    row(IconName::List, "Show Logs", Action::Terminal { command: compose_logs_command(&program, &project.files, None), name: "Logs: Compose".into() })
                        .description("Follow every service's logs in a terminal"),
                );
                if view.cwd.is_some() {
                    rows.push(row(IconName::Save, "Save as Preset…", Action::Tab("form:compose-preset".into())).description("Save Up with this workspace's env files"));
                }
                rows
            }
            Page::Service(name) => {
                let Some(service) = view.compose.as_ref().and_then(|project| project.services.iter().find(|service| &service.name == name)) else { return Vec::new() };
                let files = view.compose.as_ref().map(|project| project.files.clone()).unwrap_or_default();
                let act = |title: &str, icon: IconName, action: &'static str| row(icon, title, Action::Compose(Some(name.clone()), action));
                let mut rows = vec![act("Up", IconName::Play, "up")];
                if service.state == "running" {
                    rows.push(act("Stop", IconName::Stop, "stop"));
                }
                rows.push(act("Restart", IconName::ArrowsClockwise, "restart"));
                rows.push(act("Rebuild", IconName::Stack, "rebuild").description("Rebuild the image and recreate the service"));
                rows.push(
                    row(IconName::List, "Show Logs", Action::Terminal { command: compose_logs_command(&program, &files, Some(name)), name: format!("Logs: {name}") })
                        .description("Follow the logs in a terminal"),
                );
                if let Some(url) = model::service_url(&service.ports) {
                    rows.push(row(IconName::OpenExternal, "Open Service URL", Action::Url(url.clone())).description(url));
                }
                let container = view.containers.iter().find(|container| {
                    service.container_id.as_deref() == Some(container.id.as_str()) || service.container_name.as_deref() == Some(container.name.as_str())
                });
                if let Some(container) = container {
                    rows.push(row(IconName::Cube, "Container Actions…", Action::Open(Page::Container(container.id.clone()))).description(container.name.clone()));
                }
                rows
            }
            Page::Image(reference) => {
                let Some(image) = view.images.iter().find(|image| &model::image_reference(image) == reference) else { return Vec::new() };
                vec![
                    row(IconName::Play, "Run…", Action::Tab(format!("form:run:{reference}"))).description("Start a container from this image"),
                    row(IconName::Upload, "Push", Action::PushImage(reference.clone())).description("Push to its registry"),
                    row(IconName::Tag, "Tag…", Action::Tab(format!("form:tag:{reference}"))).description("Add another name for this image"),
                    row(IconName::Info, "Inspect", Action::Terminal { command: format!("{program} image inspect {}", image.id), name: format!("Inspect: {reference}") })
                        .description("Show docker inspect in a terminal"),
                    row(IconName::Copy, "Copy Name", Action::Copy(reference.clone(), "the image name")).description(reference.clone()),
                    row(IconName::Copy, "Copy Image ID", Action::Copy(image.id.clone(), "the image ID")).description(image.id.clone()),
                    row(
                        IconName::Trash,
                        "Remove",
                        Action::Open(Page::Confirm {
                            question: format!("Remove the image {reference}?"),
                            label: "Remove Image".into(),
                            action: Box::new(Action::RemoveImage(reference.clone())),
                            back: Box::new(Page::Image(reference.clone())),
                        }),
                    ),
                ]
            }
            Page::Volume(name) => {
                let mountpoint = view.volumes.iter().find(|volume| &volume.name == name).map(|volume| volume.mountpoint.clone()).unwrap_or_default();
                let mut rows = vec![row(IconName::Copy, "Copy Name", Action::Copy(name.clone(), "the volume name"))];
                if !mountpoint.is_empty() {
                    rows.push(row(IconName::Copy, "Copy Mountpoint", Action::Copy(mountpoint.clone(), "the mountpoint")).description(mountpoint));
                }
                rows.push(
                    row(IconName::Info, "Inspect", Action::Terminal { command: format!("{program} volume inspect {name}"), name: format!("Inspect: {name}") })
                        .description("Show docker inspect in a terminal"),
                );
                // Beyond the original, which cannot remove a volume from its page.
                rows.push(row(
                    IconName::Trash,
                    "Remove",
                    Action::Open(Page::Confirm {
                        question: format!("Remove the volume {name}?"),
                        label: "Remove Volume".into(),
                        action: Box::new(Action::RemoveVolume(name.clone())),
                        back: Box::new(Page::Volume(name.clone())),
                    }),
                ));
                rows
            }
            Page::Network(id) => {
                let name = view.networks.iter().find(|network| &network.id == id).map_or_else(|| id.clone(), |network| network.name.clone());
                vec![
                    row(IconName::Copy, "Copy Name", Action::Copy(name.clone(), "the network name")),
                    row(IconName::Copy, "Copy Network ID", Action::Copy(id.clone(), "the network ID")).description(id.clone()),
                    row(IconName::Info, "Inspect", Action::Terminal { command: format!("{program} network inspect {id}"), name: format!("Inspect: {name}") })
                        .description("Show docker inspect in a terminal"),
                ]
            }
            Page::Prune => PruneTarget::ALL
                .into_iter()
                .map(|target| {
                    row(
                        IconName::Broom,
                        target.label(),
                        Action::Open(Page::Confirm {
                            question: target.question(),
                            label: format!("Prune {}", target.label()),
                            action: Box::new(Action::Prune(target)),
                            back: Box::new(Page::Prune),
                        }),
                    )
                })
                .collect(),
            Page::Confirm { question, label, action, back } => vec![
                row(IconName::Check, label.clone(), action.as_ref().clone()).description(question.clone()),
                row(IconName::X, "Cancel", Action::Open(back.as_ref().clone())),
            ],
        }
    }

    fn title(&self, cx: &App) -> Option<String> {
        let view = self.model.read(cx);
        Some(match self.page() {
            Page::Root => return None,
            Page::Container(id) => view
                .containers
                .iter()
                .find(|container| &container.id == id)
                .map_or_else(|| id.clone(), |container| format!("{} · {}", container.name, container.health.clone().unwrap_or_else(|| container.state.clone()))),
            Page::Compose => {
                let files: Vec<&str> = view.compose.iter().flat_map(|project| project.files.iter()).map(|file| file.rsplit(['/', '\\']).next().unwrap_or(file)).collect();
                format!("Compose · {}", files.join(", "))
            }
            Page::Service(name) => view
                .compose
                .as_ref()
                .and_then(|project| project.services.iter().find(|service| &service.name == name))
                .map_or_else(|| name.clone(), |service| format!("{name} · {}", service.health.clone().unwrap_or_else(|| service.state.clone()))),
            Page::Image(reference) => reference.clone(),
            Page::Volume(name) => name.clone(),
            Page::Network(id) => view.networks.iter().find(|network| &network.id == id).map_or_else(|| id.clone(), |network| network.name.clone()),
            Page::Prune => "Prune unused Docker resources".into(),
            Page::Confirm { question, .. } => question.clone(),
        })
    }

    fn go_back(&mut self) {
        if self.stack.len() > 1 {
            self.stack.pop();
        }
    }

    /// Runs a row; `true` closes the palette.
    fn run(&mut self, action: Action, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        match action {
            Action::Open(Page::Root) => {
                self.stack.truncate(1);
                self.reset_query(window, cx);
                false
            }
            Action::Open(page) => {
                // A confirm's Cancel goes back to the page it came from.
                if matches!(self.page(), Page::Confirm { .. }) {
                    self.stack.pop();
                    if self.page() == &page {
                        self.reset_query(window, cx);
                        return false;
                    }
                }
                self.stack.push(page);
                self.reset_query(window, cx);
                false
            }
            Action::Tab(target) => {
                cx.set_global(PendingTarget(Some(target)));
                workbench_api::open_resource(cx, "docker", "", "Docker");
                true
            }
            Action::Terminal { command, .. } => {
                let cwd = self.model.read(cx).cwd.clone();
                workbench_api::run_in_terminal(cx, command, cwd);
                true
            }
            Action::Url(url) => {
                cx.open_url(&url);
                true
            }
            Action::Refresh => {
                self.model.update(cx, |view, cx| view.refresh(cx));
                false
            }
            action => {
                self.model.update(cx, |view, cx| match action {
                    Action::Container(id, action) => view.container_action(id, action, cx),
                    Action::Compose(service, action) => view.compose_action(service, action, cx),
                    Action::ComposeWithEnv(env_files) => view.compose_action_with(None, "up", env_files, cx),
                    Action::ComposePreset(name) => {
                        let preset = view.project.as_ref().and_then(|project| project.compose_presets.iter().find(|preset| preset.name == name).cloned());
                        if let Some(preset) = preset {
                            view.run_compose_preset(preset, cx);
                        }
                    }
                    Action::RemoveImage(reference) => {
                        if let Some(image) = view.images.iter().find(|image| model::image_reference(image) == reference).cloned() {
                            view.remove_image(&image, cx);
                        }
                    }
                    Action::RemoveVolume(name) => view.remove_volume(name, cx),
                    Action::PushImage(reference) => view.push_image(reference, cx),
                    Action::Prune(target) => view.prune(target, cx),
                    Action::Copy(text, what) => view.copy(text, what, cx),
                    _ => {}
                });
                // After a removal or prune, back to the list it came from.
                if matches!(self.page(), Page::Confirm { .. }) {
                    self.stack.truncate(1);
                    self.reset_query(window, cx);
                }
                false
            }
        }
    }

    fn reset_query(&mut self, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        self.selected = 0;
        cx.defer_in(window, |picker, window, cx| {
            picker.set_query("", cx);
            picker.refresh_matches(window, cx);
        });
    }
}

fn root_rows(view: &DockerView) -> Vec<Row> {
    let mut rows = Vec::new();
    if let Status::Unavailable(error) = &view.status {
        rows.push(row(IconName::ArrowsClockwise, "Retry", Action::Refresh).section("Docker isn't running").description(error.to_string()));
        rows.push(row(IconName::Info, "Show Connection Details", Action::Tab("containers".into())).section("Docker isn't running").description("Open Docker's error in a tab"));
    }
    rows.extend(view.containers.iter().map(|container| {
        row(IconName::Cube, container.name.clone(), Action::Open(Page::Container(container.id.clone())))
            .section("Containers")
            .description(join(&[&container.image, &container.status]))
            .badge(container.health.clone().unwrap_or_else(|| container.state.clone()), tone(&container.state, container.health.as_deref()))
    }));
    if let Some(error) = view.compose_error.as_ref() {
        rows.push(row(IconName::WarningCircle, "Couldn't load Compose services", Action::Refresh).section("Compose").description(error.to_string()));
    }
    if let Some(project) = view.compose.as_ref() {
        let files: Vec<String> = project.files.iter().map(|file| file.rsplit(['/', '\\']).next().unwrap_or(file).to_string()).collect();
        rows.push(
            row(IconName::Stack, "Compose Project", Action::Open(Page::Compose))
                .section("Compose")
                .description(files.join(", "))
                .badge(format!("{} services", project.services.len()), ui::Tone::Neutral),
        );
        rows.extend(project.services.iter().map(|service| {
            row(IconName::Cube, service.name.clone(), Action::Open(Page::Service(service.name.clone())))
                .section("Compose")
                .description(join(&[service.container_name.as_deref().unwrap_or(&service.status), &service.ports]))
                .badge(service.health.clone().unwrap_or_else(|| service.state.clone()), tone(&service.state, service.health.as_deref()))
        }));
    }
    if let Some(project) = view.project.as_ref() {
        for preset in &project.run_presets {
            rows.push(row(IconName::Play, preset.name.clone(), Action::Tab(format!("form:run-preset:{}", preset.name))).section("Project").description(format!("Run {}", preset.image)));
        }
        for preset in &project.build_presets {
            rows.push(row(IconName::Wrench, preset.name.clone(), Action::Tab(format!("form:build-preset:{}", preset.name))).section("Project").description(format!("Build {}", preset.context_path)));
        }
        for preset in &project.compose_presets {
            rows.push(row(IconName::Stack, preset.name.clone(), Action::ComposePreset(preset.name.clone())).section("Project").description(format!("Compose {}", preset.action)));
        }
    }
    if view.cwd.is_some() {
        rows.push(row(IconName::File, "Open Env File…", Action::Tab("form:env-file".into())).section("Project").description("Open or create an env file in this workspace"));
        rows.push(row(IconName::Bug, "Save Debug Preset…", Action::Tab("form:debug-preset".into())).section("Project").description("Save a debug command to run in a container"));
    }
    rows.extend(view.images.iter().map(|image| {
        let reference = model::image_reference(image);
        row(IconName::Stack, reference.clone(), Action::Open(Page::Image(reference))).section("Images").description(join(&[&image.size, &image.created_since]))
    }));
    rows.extend(view.volumes.iter().map(|volume| {
        row(IconName::HardDrives, volume.name.clone(), Action::Open(Page::Volume(volume.name.clone()))).section("Volumes").description(join(&[&volume.driver, &volume.mountpoint]))
    }));
    rows.extend(view.networks.iter().map(|network| {
        row(IconName::Nodes, network.name.clone(), Action::Open(Page::Network(network.id.clone()))).section("Networks").description(join(&[&network.driver, &network.scope]))
    }));
    rows.push(row(IconName::Download, "Pull Image…", Action::Tab("form:pull".into())).section("Actions").description("Search Docker Hub and pull an image"));
    rows.push(row(IconName::Play, "Run Image…", Action::Tab("form:run".into())).section("Actions").description("Start a container from an image"));
    rows.push(row(IconName::Wrench, "Build Image…", Action::Tab("form:build".into())).section("Actions").description("Build an image from a Dockerfile"));
    rows.push(row(IconName::SignIn, "Log In to Registry…", Action::Tab("form:login".into())).section("Actions").description("Sign in to Docker Hub or another registry"));
    rows.push(row(IconName::Broom, "Prune…", Action::Open(Page::Prune)).section("Actions").description("Remove unused containers, images, volumes or networks"));
    rows.push(row(IconName::ArrowsClockwise, "Refresh", Action::Refresh).section("Actions").description("Reload containers, images, Compose services and presets"));
    rows
}

impl PickerDelegate for DockerPaletteDelegate {
    fn placeholder(&self) -> SharedString {
        "Search containers, images, Compose and presets".into()
    }

    fn match_count(&self) -> usize {
        self.rows.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, cx: &mut Context<Picker<Self>>) {
        self.query = query.trim().to_lowercase();
        let query = self.query.clone();
        self.rows = self
            .build_rows(cx)
            .into_iter()
            .filter(|row| {
                query.is_empty() || [row.title.as_str(), row.description.as_str(), row.section.unwrap_or_default()].iter().any(|value| value.to_lowercase().contains(&query))
            })
            .collect();
    }

    fn section_label(&self, index: usize) -> Option<SharedString> {
        let section = self.rows.get(index)?.section?;
        let previous = index.checked_sub(1).and_then(|previous| self.rows.get(previous)).and_then(|row| row.section);
        (previous != Some(section)).then(|| section.into())
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, _: &mut Context<Picker<Self>>) -> AnyElement {
        let row = &self.rows[index];
        // `CommandItem`: the title, then its description on the same line.
        let mut element = PaletteRow::new(row.title.clone()).icon(row.icon).inline().selected(selected);
        if !row.description.is_empty() {
            element = element.description(row.description.clone());
        }
        if let Some((label, tone)) = row.badge.clone() {
            element = element.accessory(Badge::new(label).tone(tone));
        }
        element.into_any_element()
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(action) = self.rows.get(index).map(|row| row.action.clone()) else { return false };
        self.run(action, window, cx)
    }

    fn empty_message(&self) -> SharedString {
        match self.page() {
            Page::Root => "No Docker resources found".into(),
            _ => "No matching actions".into(),
        }
    }

    fn leading_icon(&self) -> IconName {
        IconName::Cube
    }

    fn leading_element(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        let colors = cx.theme().colors.clone();
        let Some(title) = self.title(cx) else {
            // The first page's back arrow goes back to the command palette, as the original's.
            return Some(
                Button::icon("docker-back-to-commands", IconName::ArrowLeft)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .tooltip("Back")
                    .on_click(cx.listener(|picker, _, window, cx| {
                        picker.dismiss(window, cx);
                        if let Ok(action) = cx.build_action("workbench::CommandPalette", None) {
                            window.dispatch_action(action, cx);
                        }
                    }))
                    .into_any_element(),
            );
        };
        Some(
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(6.))
                .max_w(px(240.))
                .child(
                    Button::icon("docker-back", IconName::ArrowLeft)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .tooltip("Back")
                        .on_click(cx.listener(|picker, _, window, cx| {
                            picker.delegate.go_back();
                            picker.delegate.reset_query(window, cx);
                        })),
                )
                .child(div().min_w_0().truncate().text_size(typography::TEXT_SM).text_color(colors.subtle_foreground).child(title))
                .into_any_element(),
        )
    }

    fn footer(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        let view = self.model.read(cx);
        let colors = cx.theme().colors.clone();
        let (message, color) = match (&view.notice, view.loading) {
            (Some(notice), _) => (notice.message.clone(), if notice.tone == NoticeTone::Error { colors.destructive } else { colors.success }),
            (None, true) => ("Loading Docker resources…".into(), colors.subtle_foreground),
            (None, false) => return None,
        };
        Some(div().px(px(12.)).py(px(6.)).text_size(typography::TEXT_SM).text_color(color).child(message).into_any_element())
    }
}
