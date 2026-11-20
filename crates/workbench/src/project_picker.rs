//! Open Project (`project-picker.tsx`, `new-project-content.tsx`): recent folders, saved remote
//! connections and WSL distributions in one list, and New Project from a starter, a clone or an
//! empty folder.

use ui::WithScrollbar;
use std::{collections::HashSet, path::PathBuf};

use gpui::{
    AnyElement, App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, KeyDownEvent, ScrollHandle,
    SharedString, Subscription, WeakEntity, Window, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{
    Button, ButtonVariant, Card, CardHeader, Field, Icon, IconName, IconSize, InputAppearance, InputGroup, PromptDialog,
    Select, SelectEvent, SelectOption, TextInput, TextInputEvent, typography,
};
use workspace::{
    RecentProject,
    new_project::{self, NewProjectSource, PackageManager},
};

use crate::{
    Workbench,
    command_surface::{self, CommandRow},
    project_icon::project_glyph,
};

/// Where the picker opens.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectPickerStep {
    Picker,
    NewProject,
}

struct SourceOption {
    id: NewProjectSource,
    label: &'static str,
    description: &'static str,
    badge: &'static str,
    icon: IconName,
    keywords: &'static [&'static str],
}

const SOURCE_OPTIONS: [SourceOption; 4] = [
    SourceOption {
        id: NewProjectSource::Empty,
        label: "Empty Project",
        description: "Create a clean folder and start from scratch.",
        badge: "Built-in",
        icon: IconName::FolderPlus,
        keywords: &["blank", "folder", "local"],
    },
    SourceOption {
        id: NewProjectSource::NextJs,
        label: "Next.js",
        description: "App Router, TypeScript, Tailwind CSS, ESLint, and a src directory.",
        badge: "Web app",
        icon: IconName::Rocket,
        keywords: &["react", "typescript", "tailwind", "frontend"],
    },
    SourceOption {
        id: NewProjectSource::ViteReact,
        label: "Vite + React",
        description: "A lightweight React and TypeScript starter.",
        badge: "Web app",
        icon: IconName::Code,
        keywords: &["react", "typescript", "frontend"],
    },
    SourceOption {
        id: NewProjectSource::Clone,
        label: "Clone Repository",
        description: "Clone an existing Git repository into a new local project.",
        badge: "Git",
        icon: IconName::GitBranch,
        keywords: &["github", "gitlab", "remote", "repository"],
    },
];

fn source_option(id: NewProjectSource) -> &'static SourceOption {
    SOURCE_OPTIONS.iter().find(|option| option.id == id).unwrap_or(&SOURCE_OPTIONS[0])
}

fn creation_label(source: NewProjectSource) -> &'static str {
    match source {
        NewProjectSource::Clone => "Clone Repository",
        NewProjectSource::Empty => "Create Project",
        _ => "Create & Install",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Picker,
    Source,
    Details,
    Creating,
}

/// A saved SSH connection, as the list shows it.
#[derive(Clone)]
struct ConnectionRow {
    #[cfg(not(target_family = "wasm"))]
    connection: remote::SavedConnection,
    id: String,
    name: String,
    host: String,
    username: String,
}

#[derive(Clone)]
struct WslRow {
    name: String,
    state: Option<String>,
    version: Option<u8>,
    is_default: bool,
}

#[derive(Clone)]
enum Entry {
    Recent(RecentProject),
    Remote(ConnectionRow),
    Wsl(WslRow),
}

pub(crate) struct ProjectPicker {
    workbench: WeakEntity<Workbench>,
    step: Step,
    query: Entity<TextInput>,
    selected: usize,
    scroll: ScrollHandle,
    recents: Vec<RecentProject>,
    /// The icons of open projects, for recent folders that have none of their own.
    open_icons: Vec<(String, String)>,
    connections: Vec<ConnectionRow>,
    connected: HashSet<String>,
    wsl: Vec<WslRow>,
    source: NewProjectSource,
    name: Entity<TextInput>,
    repository: Entity<TextInput>,
    location: Entity<TextInput>,
    package_manager: Entity<Select>,
    name_edited: bool,
    setting_name: bool,
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for ProjectPicker {}

impl Focusable for ProjectPicker {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        match self.step {
            Step::Details if self.source == NewProjectSource::Clone => self.repository.focus_handle(cx),
            Step::Details | Step::Creating => self.name.focus_handle(cx),
            Step::Picker | Step::Source => self.query.focus_handle(cx),
        }
    }
}

impl ProjectPicker {
    pub fn new(
        workbench: WeakEntity<Workbench>,
        recents: Vec<RecentProject>,
        open_icons: Vec<(String, String)>,
        step: ProjectPickerStep,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let query = cx.new(|cx| TextInput::new(window, cx).placeholder("Open project or remote connection").appearance(InputAppearance::Bare));
        let name = cx.new(|cx| TextInput::new(window, cx).placeholder("my-project"));
        let repository = cx.new(|cx| TextInput::new(window, cx).placeholder("https://github.com/owner/repository.git"));
        let location = cx.new(|cx| TextInput::new(window, cx).placeholder("Choose a parent folder").appearance(InputAppearance::Bare));
        let options = PackageManager::ALL.iter().map(|manager| SelectOption::new(manager.id(), manager.label())).collect();
        let package_manager = cx.new(|cx| Select::new(options, PackageManager::Npm.id(), cx));
        let subscriptions = vec![
            cx.subscribe_in(&query, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => {
                    this.selected = 0;
                    this.scroll.scroll_to_item(0);
                    cx.notify();
                }
                TextInputEvent::Confirmed => this.confirm_selected(window, cx),
                TextInputEvent::Cancelled => cx.emit(DismissEvent),
                _ => {}
            }),
            cx.subscribe_in(&name, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) if !this.setting_name => {
                    this.name_edited = true;
                    this.error = None;
                    cx.notify();
                }
                TextInputEvent::Confirmed => this.create(window, cx),
                TextInputEvent::Cancelled => cx.emit(DismissEvent),
                _ => {}
            }),
            cx.subscribe_in(&repository, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(url) => {
                    this.error = None;
                    if !this.name_edited {
                        let inferred = new_project::infer_project_name_from_repository_url(url);
                        this.setting_name = true;
                        this.name.update(cx, |input, cx| input.set_text(inferred, cx));
                        this.setting_name = false;
                    }
                    cx.notify();
                }
                TextInputEvent::Confirmed => this.create(window, cx),
                TextInputEvent::Cancelled => cx.emit(DismissEvent),
                _ => {}
            }),
            cx.subscribe_in(&location, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => {
                    this.error = None;
                    cx.notify();
                }
                TextInputEvent::Confirmed => this.create(window, cx),
                TextInputEvent::Cancelled => cx.emit(DismissEvent),
                _ => {}
            }),
            cx.subscribe(&package_manager, |_, _, _: &SelectEvent, cx| cx.notify()),
        ];
        let home = home_directory();
        location.update(cx, |input, cx| input.set_text(home, cx));
        let mut picker = Self {
            workbench,
            step: Step::Picker,
            query,
            selected: 0,
            scroll: ScrollHandle::new(),
            recents,
            open_icons,
            connections: Vec::new(),
            connected: HashSet::new(),
            wsl: Vec::new(),
            source: NewProjectSource::Empty,
            name,
            repository,
            location,
            package_manager,
            name_edited: false,
            setting_name: false,
            error: None,
            _subscriptions: subscriptions,
        };
        picker.load_connections(cx);
        if step == ProjectPickerStep::NewProject {
            picker.show_step(Step::Source, window, cx);
        } else {
            picker.query.update(cx, |input, cx| input.focus(window, cx));
        }
        picker
    }

    /// Saved connections and WSL distributions, read off the UI thread.
    fn load_connections(&mut self, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            let task = cx.background_spawn(async {
                let connections: Vec<ConnectionRow> = remote::connections::load_default()
                    .into_iter()
                    .map(|connection| ConnectionRow {
                        id: connection.id.clone(),
                        name: connection.name.clone(),
                        host: connection.host.clone(),
                        username: connection.username.clone(),
                        connection,
                    })
                    .collect();
                let connected: HashSet<String> = remote::manager().connected_ids().into_iter().collect();
                let wsl: Vec<WslRow> = wsl::list_distributions()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|distribution| WslRow {
                        name: distribution.name,
                        state: distribution.state,
                        version: distribution.version,
                        is_default: distribution.is_default,
                    })
                    .collect();
                (connections, connected, wsl)
            });
            cx.spawn(async move |this, cx| {
                let (connections, connected, wsl) = task.await;
                this.update(cx, |this, cx| {
                    this.connections = connections;
                    this.connected = connected;
                    this.wsl = wsl;
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
        #[cfg(target_family = "wasm")]
        let _ = cx;
    }

    fn query_text(&self, cx: &App) -> String {
        self.query.read(cx).text().trim().to_lowercase()
    }

    fn entries(&self, cx: &App) -> Vec<Entry> {
        let query = self.query_text(cx);
        let matches = |values: &[&str]| query.is_empty() || values.iter().any(|value| value.to_lowercase().contains(&query));
        let mut entries: Vec<Entry> = self
            .recents
            .iter()
            .filter(|recent| matches(&[&recent.name, &recent.path]))
            .cloned()
            .map(Entry::Recent)
            .collect();
        entries.extend(
            self.connections
                .iter()
                .filter(|connection| matches(&[&connection.name, &connection.host, &connection.username, "ssh"]))
                .cloned()
                .map(Entry::Remote),
        );
        entries.extend(
            self.wsl
                .iter()
                .filter(|distribution| {
                    let version = distribution.version.map(|version| version.to_string()).unwrap_or_default();
                    matches(&["wsl", &distribution.name, distribution.state.as_deref().unwrap_or(""), &version])
                })
                .cloned()
                .map(Entry::Wsl),
        );
        entries
    }

    fn source_options(&self, cx: &App) -> Vec<&'static SourceOption> {
        let query = self.query_text(cx);
        SOURCE_OPTIONS
            .iter()
            .filter(|option| {
                query.is_empty()
                    || [option.label, option.description].iter().chain(option.keywords).any(|value| value.to_lowercase().contains(&query))
            })
            .collect()
    }

    fn item_count(&self, cx: &App) -> usize {
        match self.step {
            Step::Picker => self.entries(cx).len(),
            Step::Source => self.source_options(cx).len(),
            Step::Details | Step::Creating => 0,
        }
    }

    fn show_step(&mut self, step: Step, window: &mut Window, cx: &mut Context<Self>) {
        self.step = step;
        self.selected = 0;
        self.error = None;
        match step {
            Step::Picker | Step::Source => {
                let placeholder = if step == Step::Picker { "Open project or remote connection" } else { "Choose how to start..." };
                self.query.update(cx, |input, cx| {
                    input.set_text("", cx);
                    input.set_placeholder(placeholder, cx);
                    input.focus(window, cx);
                });
            }
            Step::Details => {
                let focus = if self.source == NewProjectSource::Clone { &self.repository } else { &self.name };
                focus.update(cx, |input, cx| input.focus(window, cx));
            }
            Step::Creating => {}
        }
        cx.notify();
    }

    fn confirm_selected(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.step {
            Step::Picker => {
                if let Some(entry) = self.entries(cx).into_iter().nth(self.selected) {
                    self.open_entry(entry, window, cx);
                }
            }
            Step::Source => {
                if let Some(option) = self.source_options(cx).into_iter().nth(self.selected) {
                    self.choose_source(option.id, window, cx);
                }
            }
            Step::Details => self.create(window, cx),
            Step::Creating => {}
        }
    }

    fn open_entry(&mut self, entry: Entry, window: &mut Window, cx: &mut Context<Self>) {
        cx.emit(DismissEvent);
        let workbench = self.workbench.clone();
        match entry {
            Entry::Recent(recent) => {
                workbench.update(cx, |workbench, cx| workbench.open_recent_folder(recent.path, cx)).ok();
            }
            #[cfg(not(target_family = "wasm"))]
            Entry::Remote(row) => {
                workbench.update(cx, |workbench, cx| workbench.connect_remote(row.connection, window, cx)).ok();
            }
            #[cfg(target_family = "wasm")]
            Entry::Remote(_) => {}
            Entry::Wsl(distribution) => {
                workbench.update(cx, |workbench, cx| workbench.open_wsl_distribution(distribution.name, window, cx)).ok();
            }
        }
    }

    fn choose_source(&mut self, source: NewProjectSource, window: &mut Window, cx: &mut Context<Self>) {
        self.source = source;
        self.name_edited = false;
        self.setting_name = true;
        self.name.update(cx, |input, cx| {
            input.set_text("", cx);
            input.set_placeholder(if source == NewProjectSource::Clone { "repository" } else { "my-project" }, cx);
        });
        self.setting_name = false;
        self.repository.update(cx, |input, cx| input.set_text("", cx));
        self.show_step(Step::Details, window, cx);
    }

    fn package_manager(&self, cx: &App) -> PackageManager {
        PackageManager::from_id(self.package_manager.read(cx).value()).unwrap_or_default()
    }

    fn destination(&self, cx: &App) -> String {
        let location = self.location.read(cx).text().trim().to_string();
        let name = self.name.read(cx).text().to_string();
        if !location.is_empty() && new_project::project_name_error(&name).is_none() {
            new_project::new_project_path(&location, &name)
        } else {
            location
        }
    }

    fn can_create(&self, cx: &App) -> bool {
        new_project::project_name_error(self.name.read(cx).text()).is_none()
            && !self.location.read(cx).text().trim().is_empty()
            && (self.source != NewProjectSource::Clone || !self.repository.read(cx).text().trim().is_empty())
            && self.step == Step::Details
    }

    fn choose_location(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(gpui::PathPromptOptions { files: false, directories: true, multiple: false, prompt: None });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            this.update(cx, |this, cx| {
                this.location.update(cx, |input, cx| input.set_text(path.to_string_lossy().into_owned(), cx));
                this.error = None;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn create(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_create(cx) {
            return;
        }
        let source = self.source;
        let destination = self.destination(cx);
        let location = self.location.read(cx).text().trim().to_string();
        let name = self.name.read(cx).text().trim().to_string();
        let repository = self.repository.read(cx).text().trim().to_string();
        let starter = new_project::starter_command(source, self.package_manager(cx));
        self.show_step(Step::Creating, window, cx);
        let target = destination.clone();
        let work = cx.background_spawn(async move { create_project(source, &repository, &location, &name, &target) });
        cx.spawn_in(window, async move |this, cx| {
            let result = work.await;
            this.update_in(cx, |this, window, cx| match result {
                Ok(()) => {
                    let workbench = this.workbench.clone();
                    let path = destination.clone();
                    let opened = workbench
                        .update(cx, |workbench, cx| workbench.open_created_project(PathBuf::from(&path), starter.clone(), window, cx))
                        .unwrap_or(false);
                    if opened {
                        cx.emit(DismissEvent);
                    } else {
                        this.error = Some("The project was created but Athas could not open it.".into());
                        this.step = Step::Details;
                        cx.notify();
                    }
                }
                Err(error) => {
                    this.error = Some(error.into());
                    this.step = Step::Details;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let count = self.item_count(cx);
        if count == 0 {
            return;
        }
        let next = match event.keystroke.key.as_str() {
            "down" => (self.selected + 1) % count,
            "up" => (self.selected + count - 1) % count,
            _ => return,
        };
        cx.stop_propagation();
        self.selected = next;
        self.scroll.scroll_to_item(next);
        cx.notify();
    }

    fn row_wrapper(&self, index: usize, row: impl IntoElement, cx: &mut Context<Self>) -> AnyElement {
        div()
            .id(("project-picker-row", index))
            .on_mouse_move(cx.listener(move |this, _, _, cx| {
                if this.selected != index {
                    this.selected = index;
                    cx.notify();
                }
            }))
            .on_click(cx.listener(move |this, _, window, cx| {
                this.selected = index;
                this.confirm_selected(window, cx);
            }))
            .child(row)
            .into_any_element()
    }

    fn render_picker(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let entries = self.entries(cx);
        if entries.is_empty() {
            let query = self.query.read(cx).text().to_string();
            let message = if query.trim().is_empty() { "No recent projects".to_string() } else { format!("No projects match \"{query}\".") };
            return vec![command_surface::empty(message, cx).into_any_element()];
        }
        entries
            .into_iter()
            .enumerate()
            .map(|(index, entry)| {
                let selected = index == self.selected;
                let muted = if selected { colors.primary_foreground } else { colors.subtle_foreground };
                let row = match entry {
                    Entry::Recent(recent) => {
                        let icon = recent
                            .custom_icon
                            .clone()
                            .or_else(|| self.open_icons.iter().find(|(path, _)| *path == recent.path).map(|(_, icon)| icon.clone()));
                        let leading = match icon {
                            Some(icon) => project_glyph(Some(&recent.path), Some(&icon), px(16.), muted),
                            None if recent.missing => Icon::new(IconName::WarningCircle).color(if selected { muted } else { colors.warning }).into_any_element(),
                            None => Icon::new(IconName::Folder).color(muted).into_any_element(),
                        };
                        let path = recent.path.clone();
                        let mut row = CommandRow::new(("recent", index), recent.name.clone()).leading(leading).description(recent.path.clone()).selected(selected);
                        if recent.pinned {
                            row = row.accessory(Icon::new(IconName::Pin).size(IconSize::Small).color(if selected { muted } else { colors.primary }));
                        }
                        if recent.missing {
                            row = row.accessory(command_surface::badge("Missing", true, selected, cx));
                        }
                        if crate::Platform::current() == crate::Platform::Mac {
                            let path = recent.path.clone();
                            row = row.action(
                                Button::icon(("recent-new-tab", index), IconName::WindowExpand)
                                    .variant(ButtonVariant::Ghost)
                                    .tooltip("Open in New Tab")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        cx.stop_propagation();
                                        cx.emit(DismissEvent);
                                        let path = path.clone();
                                        this.workbench.update(cx, |workbench, cx| workbench.open_recent_folder_in_new_window(path, true, cx)).ok();
                                    })),
                            );
                        }
                        row.action(
                            Button::icon(("remove-recent", index), IconName::X)
                                .variant(ButtonVariant::Ghost)
                                .tooltip("Remove from recent projects")
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    cx.stop_propagation();
                                    let path = path.clone();
                                    this.recents.retain(|recent| recent.path != path);
                                    this.workbench.update(cx, |workbench, cx| workbench.update_state(cx, |state| state.remove_recent(&path))).ok();
                                    cx.notify();
                                })),
                        )
                    }
                    Entry::Remote(connection) => {
                        let connected = self.connected.contains(&connection.id);
                        let address = if connection.username.is_empty() {
                            connection.host.clone()
                        } else {
                            format!("{}@{}", connection.username, connection.host)
                        };
                        CommandRow::new(("remote", index), connection.name.clone())
                            .leading(Icon::new(IconName::HardDrives).color(muted))
                            .description(format!("SSH  {address}"))
                            .accessory(div().flex_none().size(px(8.)).rounded_full().bg(if connected { colors.success } else { colors.subtle_foreground }))
                            .selected(selected)
                    }
                    Entry::Wsl(distribution) => {
                        let mut state = distribution.state.clone().unwrap_or_else(|| "Installed".into());
                        if let Some(version) = distribution.version {
                            state.push_str(&format!(", WSL {version}"));
                        }
                        let mut row = CommandRow::new(("wsl", index), distribution.name.clone())
                            .leading(Icon::new(IconName::HardDrives).color(muted))
                            .description(format!("WSL  {state}"))
                            .selected(selected);
                        if distribution.is_default {
                            row = row.accessory(command_surface::badge("Default", false, selected, cx));
                        }
                        row
                    }
                };
                self.row_wrapper(index, row, cx)
            })
            .collect()
    }

    fn render_sources(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let options = self.source_options(cx);
        if options.is_empty() {
            let query = self.query.read(cx).text().to_string();
            return vec![command_surface::empty(format!("No project starters match \"{query}\"."), cx).into_any_element()];
        }
        options
            .into_iter()
            .enumerate()
            .map(|(index, option)| {
                let selected = index == self.selected;
                let row = CommandRow::new(("source", index), option.label)
                    .leading(Icon::new(option.icon).color(if selected { colors.primary_foreground } else { colors.subtle_foreground }))
                    .description(option.description)
                    .accessory(command_surface::badge(option.badge, false, selected, cx))
                    .selected(selected);
                self.row_wrapper(index, row, cx)
            })
            .collect()
    }

    fn render_details(&self, cx: &mut Context<Self>) -> AnyElement {
        let name = self.name.read(cx).text().to_string();
        let name_error = (!name.is_empty()).then(|| new_project::project_name_error(&name)).flatten();
        let destination = self.destination(cx);
        let web = matches!(self.source, NewProjectSource::NextJs | NewProjectSource::ViteReact);
        div()
            .flex()
            .flex_col()
            .gap(px(16.))
            .p(px(12.))
            .when(self.source == NewProjectSource::Clone, |this| {
                this.child(
                    Field::new()
                        .label("Repository URL")
                        .control(self.repository.clone())
                        .description("HTTPS and SSH repository URLs are supported."),
                )
            })
            .child(Field::new().label("Project Name").control(self.name.clone()).error(name_error))
            .child(
                Field::new().label("Location").control(
                    InputGroup::new(div().font_family(typography::MONO_FONT).child(self.location.clone()))
                        .focus_handle(&self.location.focus_handle(cx))
                        .end(
                            Button::new("choose-location", "Browse")
                                .leading_icon(IconName::FolderOpen)
                                .variant(ButtonVariant::Ghost)
                                .tooltip("Choose project location")
                                .on_click(cx.listener(|this, _, window, cx| this.choose_location(window, cx))),
                        ),
                ),
            )
            .when(web, |this| {
                this.child(
                    Field::new()
                        .label("Package Manager")
                        .control(self.package_manager.clone())
                        .description("Setup runs in the integrated terminal so you can follow its output."),
                )
            })
            .when(!destination.is_empty(), |this| {
                this.child(Card::new().child(CardHeader::new("Project location").description(destination.clone())))
            })
            .children(self.error.clone().map(|error| div().text_size(typography::TEXT_SM).text_color(cx.theme().colors.destructive).child(error)))
            .into_any_element()
    }
}

impl Render for ProjectPicker {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let close = command_surface::close_button("project-picker-close", cx, cx.listener(|_, _, _, cx| cx.emit(DismissEvent)));
        let back = |id: &'static str, tooltip: &'static str, step: Step, cx: &mut Context<Self>| {
            Button::icon(id, IconName::ArrowLeft)
                .variant(ButtonVariant::Ghost)
                .tooltip(tooltip)
                .on_click(cx.listener(move |this, _, window, cx| this.show_step(step, window, cx)))
        };
        let option = source_option(self.source);
        let header = match self.step {
            Step::Picker => command_surface::header(cx)
                .child(Icon::new(IconName::Search).size(IconSize::Medium).color(colors.subtle_foreground))
                .child(div().flex_1().min_w_0().h(px(32.)).flex().items_center().child(self.query.clone()))
                .child(close),
            Step::Source => command_surface::header(cx)
                .child(back("back-to-projects", "Back to projects", Step::Picker, cx))
                .child(div().flex_1().min_w_0().h(px(32.)).flex().items_center().child(self.query.clone()))
                .child(close),
            Step::Details => command_surface::header(cx)
                .child(back("back-to-starters", "Back to project starters", Step::Source, cx))
                .child(command_surface::header_title(option.icon, option.label, true, cx))
                .child(close),
            Step::Creating => command_surface::header(cx)
                .child(command_surface::header_title(
                    option.icon,
                    if self.source == NewProjectSource::Clone { "Cloning Repository" } else { "Creating Project" },
                    true,
                    cx,
                ))
                .child(close),
        };
        let body: AnyElement = match self.step {
            Step::Picker => command_surface::list("project-picker-list").children(self.render_picker(cx)).scrollbar_with(&self.scroll).into_any_element(),
            Step::Source => command_surface::list("project-starters").children(self.render_sources(cx)).scrollbar_with(&self.scroll).into_any_element(),
            Step::Details => command_surface::list("new-project-form").child(self.render_details(cx)).scrollbar(window, cx).into_any_element(),
            Step::Creating => div()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(8.))
                .min_h(px(224.))
                .px(px(24.))
                .text_size(typography::TEXT_SM)
                .text_color(colors.muted_foreground)
                .child(if self.source == NewProjectSource::Clone { "Cloning repository…" } else { "Preparing project…" })
                .child(div().max_w_full().truncate().font_family(typography::MONO_FONT).child(self.destination(cx)))
                .into_any_element(),
        };
        let footer = match self.step {
            Step::Picker => {
                let missing = self.recents.iter().any(|recent| recent.missing);
                Some(
                    command_surface::footer(cx)
                        .child(Button::new("picker-open-folder", "Open Folder").leading_icon(IconName::FolderOpen).on_click(cx.listener(|this, _, _, cx| {
                            cx.emit(DismissEvent);
                            this.workbench.update(cx, |workbench, cx| workbench.prompt_open_project(cx)).ok();
                        })))
                        .child(
                            Button::new("picker-new-project", "New Project")
                                .leading_icon(IconName::Plus)
                                .on_click(cx.listener(|this, _, window, cx| this.show_step(Step::Source, window, cx))),
                        )
                        .when(crate::web_chrome::web_chrome(cx).is_none(), |this| {
                            this.child(Button::new("picker-add-remote", "Add Remote").leading_icon(IconName::Plus).on_click(cx.listener(|this, _, window, cx| {
                                cx.emit(DismissEvent);
                                this.workbench.update(cx, |workbench, cx| workbench.show_remote_form(window, cx)).ok();
                            })))
                        })
                        .when(crate::web_chrome::web_chrome(cx).is_some(), |this| {
                            this.child(Button::new("picker-github-repository", "GitHub Repository").leading_icon(IconName::Github).on_click(cx.listener(|_, _, window, cx| {
                                cx.emit(DismissEvent);
                                window.dispatch_action(Box::new(crate::web_chrome::OpenGithubRepository), cx);
                            })))
                        })
                        .when(missing, |this| {
                            this.child(Button::new("picker-remove-missing", "Remove Missing").leading_icon(IconName::X).on_click(cx.listener(|this, _, _, cx| {
                                this.recents.retain(|recent| !recent.missing);
                                this.workbench.update(cx, |workbench, cx| workbench.update_state(cx, |state| state.remove_missing_recents())).ok();
                                cx.notify();
                            })))
                        }),
                )
            }
            Step::Details => {
                let icon = match self.source {
                    NewProjectSource::Clone => IconName::GitBranch,
                    NewProjectSource::Empty => IconName::FolderPlus,
                    _ => IconName::Package,
                };
                Some(
                    command_surface::footer(cx)
                        .child(
                            Button::new("back-to-sources", "Starters")
                                .variant(ButtonVariant::Ghost)
                                .leading_icon(IconName::ArrowLeft)
                                .on_click(cx.listener(|this, _, window, cx| this.show_step(Step::Source, window, cx))),
                        )
                        .child(div().flex_1())
                        .child(
                            Button::new("create-project", creation_label(self.source))
                                .variant(ButtonVariant::Accent)
                                .leading_icon(icon)
                                .disabled(!self.can_create(cx))
                                .on_click(cx.listener(|this, _, window, cx| this.create(window, cx))),
                        ),
                )
            }
            Step::Source | Step::Creating => None,
        };
        command_surface::panel("project-picker", window, cx)
            .key_context("ProjectPicker")
            .on_key_down(cx.listener(Self::on_key_down))
            .child(header)
            .child(body)
            .children(footer)
    }
}

fn home_directory() -> String {
    #[cfg(not(target_family = "wasm"))]
    {
        dirs::home_dir().map(|home| home.to_string_lossy().into_owned()).unwrap_or_default()
    }
    #[cfg(target_family = "wasm")]
    String::new()
}

/// Makes the project's folder: a clone of the repository, or an empty folder.
fn create_project(source: NewProjectSource, repository: &str, location: &str, name: &str, destination: &str) -> Result<(), String> {
    if std::path::Path::new(destination).exists() {
        return Err(format!("A file or folder already exists at {destination}."));
    }
    if source == NewProjectSource::Clone {
        #[cfg(not(target_family = "wasm"))]
        return athas_version_control::git_clone(repository.to_string(), destination.to_string());
        #[cfg(target_family = "wasm")]
        return Err(format!("Cloning {repository} needs the desktop app"));
    }
    std::fs::create_dir(std::path::Path::new(location).join(name)).map_err(|error| error.to_string())
}

impl Workbench {
    pub fn show_project_picker(&mut self, step: ProjectPickerStep, window: &mut Window, cx: &mut Context<Self>) {
        let workbench = cx.weak_entity();
        let recents = self.state.recent_projects.clone();
        let open_icons = self
            .state
            .projects
            .iter()
            .filter_map(|project| Some((project.path.clone(), project.custom_icon.clone()?)))
            .collect();
        let picker = cx.new(|cx| ProjectPicker::new(workbench, recents, open_icons, step, window, cx));
        self.open_modal(picker, window, cx);
    }

    /// Opens a recent folder in a new window, or a new tab of this one.
    pub(crate) fn open_recent_folder_in_new_window(&mut self, path: String, as_tab: bool, cx: &mut Context<Self>) {
        let setup: crate::windows::WindowSetup = Box::new(move |workbench, _, cx| workbench.open_recent_folder(path, cx));
        self.open_new_window(as_tab, Some(setup), cx);
    }

    /// Opens a recent folder, or marks it missing when it is gone; in a new window when the
    /// settings ask for one and a project is already open here.
    pub(crate) fn open_recent_folder(&mut self, path: String, cx: &mut Context<Self>) {
        if self.opens_folders_elsewhere(cx) && !self.state.projects.iter().any(|project| project.path == path) {
            self.open_recent_folder_in_new_window(path, false, cx);
            return;
        }
        if crate::remote_projects::is_remote_or_wsl(&path) {
            self.open_project_path(PathBuf::from(path), cx);
            return;
        }
        let check = path.clone();
        let info = cx.background_spawn(async move { std::fs::metadata(&check).map(|metadata| metadata.is_dir()) });
        cx.spawn(async move |this, cx| {
            let info = info.await;
            this.update(cx, |this, cx| match info {
                Ok(true) => {
                    this.open_project_path(PathBuf::from(&path), cx);
                    this.update_state(cx, |state| state.mark_recent_missing(&path, false));
                }
                Ok(false) => {
                    this.update_state(cx, |state| state.mark_recent_missing(&path, true));
                    notifications::error(cx, format!("Recent project is not a folder: {path}"), None);
                }
                Err(_) => {
                    this.update_state(cx, |state| state.mark_recent_missing(&path, true));
                    notifications::error(cx, format!("Recent project is unavailable: {path}"), None);
                }
            })
            .ok();
        })
        .detach();
    }

    /// Opens a project New Project made, and runs its starter's setup in a terminal.
    fn open_created_project(&mut self, path: PathBuf, starter: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if !path.is_dir() {
            return false;
        }
        self.open_project_path(path.clone(), cx);
        if let Some(command) = starter {
            self.update_state(cx, |state| state.show_bottom_tab(workspace::BottomTab::Terminal));
            let terminal = self.ensure_terminal(window, cx);
            terminal.update(cx, |terminal, cx| terminal.run_command(&command, Some(path), window, cx));
        }
        true
    }

    /// The remote connections dialog on its new-connection form.
    pub(crate) fn show_remote_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            self.show_remote_connections(window, cx);
            if let Some((view, _)) = &self.modal
                && let Ok(view) = view.clone().downcast::<remote::ConnectionsView>()
            {
                view.update(cx, |view, cx| view.show_form(None, window, cx));
            }
        }
        #[cfg(target_family = "wasm")]
        self.show_remote_connections(window, cx);
    }

    /// Connects to a saved connection in the remote connections dialog, which asks to trust the
    /// server or for a password when it must, then shows its folders.
    #[cfg(not(target_family = "wasm"))]
    pub(crate) fn connect_remote(&mut self, connection: remote::SavedConnection, window: &mut Window, cx: &mut Context<Self>) {
        self.show_remote_connections(window, cx);
        if let Some((view, _)) = &self.modal
            && let Ok(view) = view.clone().downcast::<remote::ConnectionsView>()
        {
            view.update(cx, |view, cx| view.connect(connection, None, window, cx));
        }
    }

    /// Opens a saved remote connection by id, as `athas remote` and `athas://open?type=remote` ask.
    pub fn open_remote_connection(&mut self, id: &str, name: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            match remote::connections::load_default().into_iter().find(|connection| connection.id == id) {
                Some(connection) => self.connect_remote(connection, window, cx),
                None => {
                    notifications::error(cx, format!("No saved remote connection named {}", name.unwrap_or(id)), None);
                }
            }
        }
        #[cfg(target_family = "wasm")]
        {
            let _ = (id, name, window);
            notifications::info(cx, "Remote projects need the desktop app");
        }
    }

    /// Asks for the Linux folder to open in a WSL distribution, starting at its home.
    fn open_wsl_distribution(&mut self, distribution: String, window: &mut Window, cx: &mut Context<Self>) {
        #[cfg(not(target_family = "wasm"))]
        {
            let name = distribution.clone();
            let home = cx.background_spawn(async move { wsl::home_dir(&name).unwrap_or_else(|_| "/".into()) });
            cx.spawn_in(window, async move |this, cx| {
                let home = home.await;
                this.update_in(cx, |this, window, cx| {
                    let weak = cx.weak_entity();
                    let distro = distribution.clone();
                    let dialog = cx.new(|cx| {
                        PromptDialog::new(
                            format!("Open {distribution}"),
                            "Linux project path",
                            home,
                            move |path, _, cx| {
                                let path = path.trim().to_string();
                                if path.is_empty() {
                                    return;
                                }
                                let project = wsl::path::format(&wsl::path::WslPath { distro: distro.clone(), linux_path: path });
                                weak.update(cx, |this, cx| this.open_project_path(PathBuf::from(project), cx)).ok();
                            },
                            window,
                            cx,
                        )
                        .placeholder("/home/me/project", cx)
                        .labels("Open", "Cancel")
                    });
                    this.open_modal(dialog, window, cx);
                })
                .ok();
            })
            .detach();
        }
        #[cfg(target_family = "wasm")]
        let _ = (distribution, window, cx);
    }
}
