//! Settings > Team > Workspaces (`features/workspace/team`): pick a workspace and edit the
//! `athas.workspace.json` its team shares (overview, repositories, environments, tasks, AI
//! context, integrations). What stays on this device (the workspaces added, the section shown,
//! the checkout linked to each repository) is kept in `workspace-management.json`.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use ui::scale::px;
use gpui::{AnyElement, App, AppContext, Context, Entity, Global, PathPromptOptions, SharedString, Subscription, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{
    Alert, Button, ButtonVariant, Card, IconName, Select, SelectEvent, SelectOption, SelectSearch, SelectWidth, TextArea, TextAreaEvent, TextInput, TextInputEvent, ToggleGroup, ToggleOption, Tone, metrics,
    typography,
};
use workspace::team::{self, EnvironmentInfo, EnvironmentKind, ManagementState, TeamCommand, TeamRepository, TeamWorkspace, WorkspaceSection};

struct Draft {
    config: TeamWorkspace,
    /// The file as last read or written; `None` while the folder has none.
    original: Option<String>,
    saved: String,
    loading: bool,
    saving: bool,
    error: Option<String>,
    /// Bumped whenever the config is replaced from disk, so the fields refill.
    revision: u64,
}

impl Draft {
    fn dirty(&self) -> bool {
        serde_json::to_string(&self.config).unwrap_or_default() != self.saved
    }
}

/// The workspaces this device manages and the profiles being edited (`workspace-management.store`).
pub struct WorkspaceManagement {
    state: ManagementState,
    path: Option<PathBuf>,
    drafts: HashMap<String, Draft>,
}

struct GlobalManagement(Entity<WorkspaceManagement>);

impl Global for GlobalManagement {}

fn default_state_path() -> Option<PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    return dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("workspace-management.json"));
    #[cfg(target_family = "wasm")]
    None
}

/// Where the management state is kept; `None` keeps it in memory (previews and tests).
pub fn use_state_at(path: Option<PathBuf>, cx: &mut App) {
    let state = path.as_deref().map(ManagementState::load).unwrap_or_default();
    let entity = cx.new(|_| WorkspaceManagement { state, path, drafts: HashMap::new() });
    cx.set_global(GlobalManagement(entity));
}

pub fn management(cx: &mut App) -> Entity<WorkspaceManagement> {
    if cx.try_global::<GlobalManagement>().is_none() {
        use_state_at(default_state_path(), cx);
    }
    cx.global::<GlobalManagement>().0.clone()
}

/// `openWorkspaceManagement`: Settings > Team on the active project, added as a workspace.
pub fn open_management(cx: &mut App) {
    if let Some(root) = workbench_api::projects(cx).active {
        management(cx).update(cx, |management, cx| management.register(&root, cx));
    }
    workbench_api::open_settings(cx, Some("team"), None);
}

/// `workspace.add`: asks for a folder, adds it as a workspace and shows it.
pub fn add_workspace(cx: &mut App) {
    let paths = cx.prompt_for_paths(PathPromptOptions { files: false, directories: true, multiple: false, prompt: Some("Add Workspace".into()) });
    cx.spawn(async move |cx| {
        let Ok(Ok(Some(paths))) = paths.await else { return };
        let Some(path) = paths.into_iter().next() else { return };
        cx.update(|cx| {
            management(cx).update(cx, |management, cx| management.register(&path.to_string_lossy(), cx));
            workbench_api::open_settings(cx, Some("team"), None);
        });
    })
    .detach();
}

#[cfg(not(target_family = "wasm"))]
fn remote_access(root: &str) -> Option<(std::sync::Arc<dyn remote::FileAccess>, std::sync::Arc<dyn file_tree::Fs>)> {
    let files = remote::files_for(root).or_else(|| wsl::files_for(root))?;
    let fs = remote::fs_for(root).or_else(|| wsl::fs_for(root))?;
    Some((files, fs))
}

/// `readTeamWorkspaceContent`, over SSH and WSL too.
fn read_profile(root: &str) -> Result<Option<String>, String> {
    #[cfg(not(target_family = "wasm"))]
    if let Some((files, fs)) = remote_access(root) {
        let path = Path::new(root).join(team::TEAM_WORKSPACE_FILE);
        if !fs.exists(&path) {
            return Ok(None);
        }
        return match files.load(&path).map_err(|error| error.to_string())? {
            remote::Contents::Text { text, .. } => Ok(Some(text)),
            _ => Err(format!("{} must contain valid JSON.", team::TEAM_WORKSPACE_FILE)),
        };
    }
    team::read_local(Path::new(root))
}

/// `saveTeamWorkspace`: refuses when the file changed since it was read.
fn write_profile(root: &str, config: &TeamWorkspace, original: Option<&str>) -> Result<String, String> {
    #[cfg(not(target_family = "wasm"))]
    if let Some((files, _)) = remote_access(root) {
        let validated = config.validated()?;
        if read_profile(root)?.as_deref() != original {
            return Err("The team workspace changed on disk. Reload the workspace before saving.".into());
        }
        let content = validated.to_file_content();
        files.save(&Path::new(root).join(team::TEAM_WORKSPACE_FILE), &content).map_err(|error| error.to_string())?;
        return Ok(content);
    }
    team::save_local(Path::new(root), config, original)
}

/// `inspectWorkspaceEnvironment`.
fn inspect_environment(root: &str) -> Result<EnvironmentInfo, String> {
    let kind = EnvironmentKind::of(root);
    let read = |name: &str| -> Result<String, String> {
        #[cfg(not(target_family = "wasm"))]
        if let Some((files, _)) = remote_access(root) {
            return match files.load(&Path::new(root).join(name)).map_err(|error| error.to_string())? {
                remote::Contents::Text { text, .. } => Ok(text),
                _ => Err(format!("{name} is not text")),
            };
        }
        std::fs::read_to_string(Path::new(root).join(name)).map_err(|error| error.to_string())
    };
    #[cfg(not(target_family = "wasm"))]
    let files: Vec<String> = match remote_access(root) {
        Some((_, fs)) => fs.read_dir(Path::new(root)).map_err(|error| error.to_string())?.into_iter().map(|entry| entry.name).collect(),
        None => local_names(root)?,
    };
    #[cfg(target_family = "wasm")]
    let files = local_names(root)?;
    let package = files.iter().any(|file| file == "package.json").then(|| read("package.json")).transpose()?;
    EnvironmentInfo::inspect(kind, files, package.as_deref())
}

fn local_names(root: &str) -> Result<Vec<String>, String> {
    Ok(std::fs::read_dir(root).map_err(|error| error.to_string())?.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
}

impl WorkspaceManagement {
    fn persist(&self) {
        if let Some(path) = &self.path
            && let Err(error) = self.state.save(path)
        {
            eprintln!("Failed to save workspace management: {error}");
        }
    }

    pub fn state(&self) -> &ManagementState {
        &self.state
    }

    pub fn register(&mut self, path: &str, cx: &mut Context<Self>) {
        self.state.register(path);
        self.persist();
        cx.notify();
    }

    fn select(&mut self, root: &str, cx: &mut Context<Self>) {
        self.state.selected_root = Some(root.to_string());
        self.persist();
        cx.notify();
    }

    pub fn set_section(&mut self, section: WorkspaceSection, cx: &mut Context<Self>) {
        self.state.section = section;
        self.persist();
        cx.notify();
    }

    fn bind_repository(&mut self, root: &str, id: &str, path: &str, cx: &mut Context<Self>) {
        self.state.bind_repository(root, id, path);
        self.persist();
        cx.notify();
    }

    /// Reads the workspace's profile, or starts a new one named after its folder.
    pub fn load(&mut self, root: &str, reload: bool, cx: &mut Context<Self>) {
        if let Some(existing) = self.drafts.get(root)
            && (existing.loading || existing.saving || !reload)
        {
            return;
        }
        let draft = self.drafts.entry(root.to_string()).or_insert_with(|| {
            let config = TeamWorkspace::new(team::base_name(root));
            let saved = serde_json::to_string(&config).unwrap_or_default();
            Draft { config, original: None, saved, loading: true, saving: false, error: None, revision: 0 }
        });
        draft.loading = true;
        draft.error = None;
        cx.notify();
        let path = root.to_string();
        let read = cx.background_spawn(async move {
            let original = read_profile(&path)?;
            let config = match &original {
                Some(content) => team::parse(content)?,
                None => TeamWorkspace::new(team::base_name(&path)),
            };
            Ok::<_, String>((original, config))
        });
        let root = root.to_string();
        cx.spawn(async move |this, cx| {
            let result = read.await;
            this.update(cx, |this, cx| {
                let Some(draft) = this.drafts.get_mut(&root) else { return };
                draft.loading = false;
                match result {
                    Ok((original, config)) => {
                        draft.saved = serde_json::to_string(&config).unwrap_or_default();
                        draft.config = config;
                        draft.original = original;
                        draft.revision += 1;
                    }
                    Err(error) => draft.error = Some(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn update_config(&mut self, root: &str, config: TeamWorkspace, cx: &mut Context<Self>) {
        if let Some(draft) = self.drafts.get_mut(root).filter(|draft| !draft.loading && !draft.saving)
            && draft.config != config
        {
            draft.config = config;
            cx.notify();
        }
    }

    fn save(&mut self, root: &str, cx: &mut Context<Self>) {
        let Some(draft) = self.drafts.get_mut(root).filter(|draft| !draft.loading && !draft.saving) else { return };
        draft.saving = true;
        draft.error = None;
        cx.notify();
        let (config, original, path) = (draft.config.clone(), draft.original.clone(), root.to_string());
        let write = cx.background_spawn(async move {
            let validated = config.validated()?;
            let content = write_profile(&path, &validated, original.as_deref())?;
            Ok::<_, String>((validated, content))
        });
        let root = root.to_string();
        cx.spawn(async move |this, cx| {
            let result = write.await;
            this.update(cx, |this, cx| {
                let Some(draft) = this.drafts.get_mut(&root) else { return };
                draft.saving = false;
                match result {
                    Ok((config, content)) => {
                        draft.saved = serde_json::to_string(&config).unwrap_or_default();
                        draft.config = config;
                        draft.original = Some(content);
                        draft.revision += 1;
                    }
                    Err(error) => draft.error = Some(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

struct RepositoryEditor {
    id: String,
    name: Entity<TextInput>,
    url: Entity<TextInput>,
}

struct TaskEditor {
    name: Entity<TextInput>,
    directory: Entity<TextInput>,
    command: Entity<TextArea>,
}

struct Environment {
    root: String,
    info: Option<EnvironmentInfo>,
    #[cfg(not(target_family = "wasm"))]
    connections: Vec<remote::SavedConnection>,
    loading: bool,
}

pub struct WorkspaceSettings {
    management: Entity<WorkspaceManagement>,
    workspace_select: Entity<Select>,
    workspace_options: Vec<(String, String)>,
    name: Entity<TextInput>,
    description: Entity<TextArea>,
    instructions: Entity<TextArea>,
    repositories: Vec<RepositoryEditor>,
    tasks: Vec<TaskEditor>,
    extension_select: Entity<Select>,
    extension_options: Vec<String>,
    /// The workspace and revision the fields were filled from.
    filled: Option<(String, u64)>,
    filling: bool,
    action_error: Option<String>,
    confirm_reload: bool,
    last_started: Option<String>,
    environment: Option<Environment>,
    _subscriptions: Vec<Subscription>,
    _editor_subscriptions: Vec<Subscription>,
}

impl WorkspaceSettings {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let management = management(cx);
        let workspace_select = cx.new(|cx| Select::new(Vec::new(), "", cx).placeholder("Choose a workspace").searchable(SelectSearch::Menu, window, cx));
        let extension_select = cx.new(|cx| Select::new(Vec::new(), "", cx).placeholder("Choose an integration").width(SelectWidth::Flex).searchable(SelectSearch::Menu, window, cx));
        let name = cx.new(|cx| TextInput::new(window, cx));
        let description = cx.new(|cx| TextArea::new(cx).rows(3).placeholder("What this team builds and how these projects fit together."));
        let instructions = cx.new(|cx| TextArea::new(cx).rows(14).placeholder("Describe your architecture, coding conventions and validation requirements."));
        let mut subscriptions = vec![
            cx.observe(&management, |_, _, cx| cx.notify()),
            cx.observe_global::<workbench_api::Projects>(|_, cx| cx.notify()),
            cx.subscribe(&workspace_select, |this, _, event: &SelectEvent, cx| {
                if let SelectEvent::Changed(root) = event {
                    let root = root.to_string();
                    this.management.update(cx, |management, cx| management.select(&root, cx));
                }
            }),
            cx.subscribe(&extension_select, |_, _, _: &SelectEvent, cx| cx.notify()),
            cx.subscribe(&name, |this, _, event: &TextInputEvent, cx| {
                if matches!(event, TextInputEvent::Changed(_)) {
                    this.edited(cx);
                }
            }),
            cx.subscribe(&description, |this, _, event: &TextAreaEvent, cx| {
                if matches!(event, TextAreaEvent::Changed) {
                    this.edited(cx);
                }
            }),
            cx.subscribe(&instructions, |this, _, event: &TextAreaEvent, cx| {
                if matches!(event, TextAreaEvent::Changed) {
                    this.edited(cx);
                }
            }),
        ];
        if cx.try_global::<extensions::Extensions>().is_some() {
            subscriptions.push(cx.observe_global::<extensions::Extensions>(|_, cx| cx.notify()));
        }
        Self {
            management,
            workspace_select,
            workspace_options: Vec::new(),
            name,
            description,
            instructions,
            repositories: Vec::new(),
            tasks: Vec::new(),
            extension_select,
            extension_options: Vec::new(),
            filled: None,
            filling: false,
            action_error: None,
            confirm_reload: false,
            last_started: None,
            environment: None,
            _subscriptions: subscriptions,
            _editor_subscriptions: Vec::new(),
        }
    }

    fn root(&self, cx: &App) -> (Option<String>, Vec<String>, Option<String>) {
        let projects = workbench_api::projects(cx);
        let (root, paths) = self.management.read(cx).state.selection(projects.active.as_deref(), &projects.open);
        (root, paths, projects.active)
    }

    fn config(&self, root: &str, cx: &App) -> Option<TeamWorkspace> {
        self.management.read(cx).drafts.get(root).map(|draft| draft.config.clone())
    }

    fn change(&mut self, root: &str, config: TeamWorkspace, cx: &mut Context<Self>) {
        self.management.update(cx, |management, cx| management.update_config(root, config, cx));
    }

    /// Rebuilds the profile from the fields after one of them changed.
    fn edited(&mut self, cx: &mut Context<Self>) {
        if self.filling {
            return;
        }
        let Some((root, _)) = self.filled.clone() else { return };
        let Some(mut config) = self.config(&root, cx) else { return };
        config.name = self.name.read(cx).text().to_string();
        let description = self.description.read(cx).text().to_string();
        config.description = (!description.is_empty() || config.description.is_some()).then_some(description);
        config.instructions = self.instructions.read(cx).text().to_string();
        let previous = config.repositories.clone().unwrap_or_default();
        let repositories: Vec<TeamRepository> = self
            .repositories
            .iter()
            .map(|editor| {
                let url = editor.url.read(cx).text().to_string();
                let had_url = previous.iter().find(|repo| repo.id == editor.id).is_some_and(|repo| repo.url.is_some());
                TeamRepository { id: editor.id.clone(), name: editor.name.read(cx).text().to_string(), url: (!url.is_empty() || had_url).then_some(url) }
            })
            .collect();
        if config.repositories.is_some() || !repositories.is_empty() {
            config.repositories = Some(repositories);
        }
        config.commands = self
            .tasks
            .iter()
            .map(|editor| TeamCommand {
                name: editor.name.read(cx).text().to_string(),
                command: editor.command.read(cx).text().to_string(),
                working_directory: Some(editor.directory.read(cx).text().to_string()),
            })
            .collect();
        self.change(&root, config, cx);
    }

    /// Fills the fields from the profile, making one field per repository and task.
    fn fill(&mut self, root: &str, config: &TeamWorkspace, revision: u64, window: &mut Window, cx: &mut Context<Self>) {
        self.filling = true;
        self.name.update(cx, |input, cx| input.set_text(config.name.clone(), cx));
        self.description.update(cx, |area, cx| area.set_text(config.description.clone().unwrap_or_default(), cx));
        self.instructions.update(cx, |area, cx| area.set_text(config.instructions.clone(), cx));
        let mut subscriptions = Vec::new();
        self.repositories = config
            .repositories
            .iter()
            .flatten()
            .map(|repo| {
                let name = cx.new(|cx| TextInput::new(window, cx));
                name.update(cx, |input, cx| input.set_text(repo.name.clone(), cx));
                let url = cx.new(|cx| TextInput::new(window, cx).placeholder("https://github.com/team/project"));
                url.update(cx, |input, cx| input.set_text(repo.url.clone().unwrap_or_default(), cx));
                for input in [&name, &url] {
                    subscriptions.push(cx.subscribe(input, |this, _, event: &TextInputEvent, cx| {
                        if matches!(event, TextInputEvent::Changed(_)) {
                            this.edited(cx);
                        }
                    }));
                }
                RepositoryEditor { id: repo.id.clone(), name, url }
            })
            .collect();
        self.tasks = config
            .commands
            .iter()
            .map(|command| {
                let name = cx.new(|cx| TextInput::new(window, cx).placeholder("Start development"));
                name.update(cx, |input, cx| input.set_text(command.name.clone(), cx));
                let directory = cx.new(|cx| TextInput::new(window, cx).placeholder("apps/web"));
                directory.update(cx, |input, cx| input.set_text(command.working_directory.clone().unwrap_or_else(|| ".".into()), cx));
                let area = cx.new(|cx| TextArea::new(cx).rows(2).mono().placeholder("bun run dev"));
                area.update(cx, |area, cx| area.set_text(command.command.clone(), cx));
                for input in [&name, &directory] {
                    subscriptions.push(cx.subscribe(input, |this, _, event: &TextInputEvent, cx| {
                        if matches!(event, TextInputEvent::Changed(_)) {
                            this.edited(cx);
                        }
                    }));
                }
                subscriptions.push(cx.subscribe(&area, |this, _, event: &TextAreaEvent, cx| {
                    if matches!(event, TextAreaEvent::Changed) {
                        this.edited(cx);
                    }
                }));
                TaskEditor { name, directory, command: area }
            })
            .collect();
        self._editor_subscriptions = subscriptions;
        self.filled = Some((root.to_string(), revision));
        self.filling = false;
    }

    /// Changes the profile's lists, then refills the fields to match.
    fn restructure(&mut self, change: impl FnOnce(&mut TeamWorkspace), window: &mut Window, cx: &mut Context<Self>) {
        let Some((root, revision)) = self.filled.clone() else { return };
        let Some(mut config) = self.config(&root, cx) else { return };
        change(&mut config);
        self.change(&root, config.clone(), cx);
        self.fill(&root, &config, revision, window, cx);
        cx.notify();
    }

    fn report(&mut self, error: impl Into<String>, cx: &mut Context<Self>) {
        self.action_error = Some(error.into());
        cx.notify();
    }

    fn pick_folder(&mut self, prompt: &str, cx: &mut Context<Self>, then: impl FnOnce(&mut Self, String, &mut Context<Self>) + 'static) {
        let paths = cx.prompt_for_paths(PathPromptOptions { files: false, directories: true, multiple: false, prompt: Some(prompt.to_string().into()) });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            this.update(cx, |this, cx| then(this, path.to_string_lossy().into_owned(), cx)).ok();
        })
        .detach();
    }

    fn run_task(&mut self, root: &str, index: usize, active: bool, cx: &mut Context<Self>) {
        if !active {
            return self.report("Open this workspace before running its tasks.", cx);
        }
        let Some(config) = self.config(root, cx) else { return };
        match config.validated() {
            Ok(config) => {
                let Some(task) = config.commands.get(index) else { return };
                let cwd = team::resolve_working_directory(Path::new(root), task.working_directory.as_deref());
                workbench_api::run_in_terminal(cx, task.command.clone(), Some(cwd));
                self.last_started = Some(task.name.clone());
                cx.notify();
            }
            Err(error) => self.report(error, cx),
        }
    }

    fn refresh_environment(&mut self, root: &str, cx: &mut Context<Self>) {
        self.environment = Some(Environment {
            root: root.to_string(),
            info: None,
            #[cfg(not(target_family = "wasm"))]
            connections: Vec::new(),
            loading: true,
        });
        cx.notify();
        let path = root.to_string();
        let inspect = cx.background_spawn(async move {
            #[cfg(not(target_family = "wasm"))]
            let connections = remote::connections::load_default();
            #[cfg(target_family = "wasm")]
            let connections = ();
            (inspect_environment(&path), connections)
        });
        let root = root.to_string();
        cx.spawn(async move |this, cx| {
            let (info, _connections) = inspect.await;
            this.update(cx, |this, cx| {
                let Some(environment) = this.environment.as_mut().filter(|environment| environment.root == root) else { return };
                environment.loading = false;
                #[cfg(not(target_family = "wasm"))]
                {
                    environment.connections = _connections;
                }
                match info {
                    Ok(info) => environment.info = Some(info),
                    Err(error) => this.action_error = Some(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn text(text: impl Into<SharedString>, cx: &App) -> gpui::Div {
        div().text_size(typography::text_sm()).text_color(cx.theme().colors.subtle_foreground).child(text.into())
    }

    fn field(label: &'static str, control: impl IntoElement, cx: &App) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .gap(px(6.))
            .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(cx.theme().colors.foreground).child(label))
            .child(control)
            .into_any_element()
    }

    fn muted_item(title: impl Into<SharedString>, description: impl Into<SharedString>, action: Option<AnyElement>, cx: &App) -> AnyElement {
        let colors = cx.theme().colors.clone();
        div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(16.))
            .px(px(12.))
            .py(px(10.))
            .rounded(metrics::radius_md())
            .bg(colors.surface)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(title.into()))
                    .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(description.into())),
            )
            .children(action)
            .into_any_element()
    }

    fn overview(&self, root: &str, config: &TeamWorkspace, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let state = self.management.read(cx).state();
        let missing = config.repositories.iter().flatten().filter(|repo| state.binding(root, &repo.id).is_none()).count();
        let card = |id: &'static str, title: &'static str, description: String, label: String, section: WorkspaceSection, cx: &mut Context<Self>| {
            // `CardHeader` (title, description) over `CardContent` with the ghost action at its
            // start, the card's own 12px padding around them (`workspace-overview.tsx`).
            Card::new()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .px(px(12.))
                        .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(title))
                        .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(description)),
                )
                .child(div().flex().px(px(12.)).child(Button::new(id, label).variant(ButtonVariant::Ghost).on_click(cx.listener(move |this, _, _, cx| {
                    this.management.update(cx, |management, cx| management.set_section(section, cx));
                }))))
                .into_any_element()
        };
        let cards = vec![
            card(
                "workspace-overview-repos",
                "Repositories",
                format!("{} projects in this workspace", 1 + config.repositories.as_ref().map_or(0, Vec::len)),
                if missing > 0 { format!("{missing} need a local folder") } else { "Manage repositories".into() },
                WorkspaceSection::Repositories,
                cx,
            ),
            card("workspace-overview-tasks", "Shared tasks", format!("{} commands for the team", config.commands.len()), "Manage tasks".into(), WorkspaceSection::Tasks, cx),
            card(
                "workspace-overview-integrations",
                "Integrations",
                format!("{} team recommendations", config.recommended_extensions.as_ref().map_or(0, Vec::len)),
                "Review integrations".into(),
                WorkspaceSection::Extensions,
                cx,
            ),
        ];
        vec![
            div().flex().gap(px(12.)).children(cards.into_iter().map(|card| div().flex_1().min_w_0().child(card))).into_any_element(),
            Self::field("Workspace name", self.name.clone(), cx),
            Self::field("Description", self.description.clone(), cx),
            Self::muted_item(
                "Shared with your repository",
                "Save and commit athas.workspace.json to share tasks, AI instructions, repositories and integration recommendations. Local folder mappings stay on this device.",
                None,
                cx,
            ),
            Self::text(format!("Workspace root: {root}"), cx).into_any_element(),
        ]
    }

    fn repositories(&self, root: &str, config: &TeamWorkspace, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let mut rows = Vec::new();
        let primary = root.to_string();
        rows.push(Self::muted_item(
            team::base_name(root),
            format!("Primary project · {root}"),
            Some(Button::new("workspace-repo-primary-open", "Open").variant(ButtonVariant::Ghost).on_click(move |_, _, cx| workbench_api::open_project(cx, primary.clone())).into_any_element()),
            cx,
        ));
        rows.push(Self::text("Add the projects your team works on together. Each teammate links their own checkout; absolute paths are never written to the shared profile.", cx).into_any_element());
        let repositories = config.repositories.clone().unwrap_or_default();
        for (index, editor) in self.repositories.iter().enumerate() {
            let id = editor.id.clone();
            let binding = self.management.read(cx).state().binding(root, &id).map(str::to_string);
            let url = repositories.iter().find(|repo| repo.id == id).and_then(|repo| repo.url.clone()).filter(|url| !url.is_empty());
            let link_id = id.clone();
            let remove_id = id.clone();
            let open_path = binding.clone();
            let root_for_link = root.to_string();
            let buttons = div()
                .flex()
                .flex_wrap()
                .gap(px(8.))
                .child(Button::new(("workspace-repo-link", index), if binding.is_some() { "Change folder" } else { "Link local folder" }).on_click(cx.listener(move |this, _, _, cx| {
                    let (root, id) = (root_for_link.clone(), link_id.clone());
                    this.pick_folder("Link", cx, move |this, path, cx| {
                        this.management.update(cx, |management, cx| management.bind_repository(&root, &id, &path, cx));
                    });
                })))
                .child(Button::new(("workspace-repo-open", index), "Open project").variant(ButtonVariant::Ghost).disabled(binding.is_none()).on_click(move |_, _, cx| {
                    if let Some(path) = &open_path {
                        workbench_api::open_project(cx, path.clone());
                    }
                }))
                .when_some(url, |this, _| {
                    this.child(Button::new(("workspace-repo-view", index), "View repository").variant(ButtonVariant::Ghost).on_click(cx.listener(move |this, _, _, cx| {
                        let Some((root, _)) = this.filled.clone() else { return };
                        let Some(config) = this.config(&root, cx) else { return };
                        match config.validated() {
                            Ok(config) => {
                                if let Some(url) = config.repositories.iter().flatten().nth(index).and_then(|repo| repo.url.clone()) {
                                    cx.open_url(&url);
                                }
                            }
                            Err(error) => this.report(error, cx),
                        }
                    })))
                })
                .child(Button::new(("workspace-repo-remove", index), "Remove from workspace").variant(ButtonVariant::Ghost).on_click(cx.listener(move |this, _, window, cx| {
                    let id = remove_id.clone();
                    this.restructure(move |config| config.repositories.get_or_insert_default().retain(|repo| repo.id != id), window, cx);
                })));
            rows.push(
                Card::new()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .p(px(12.))
                            .child(div().flex().gap(px(12.)).child(Self::field("Name", editor.name.clone(), cx)).child(Self::field("Repository URL", editor.url.clone(), cx)))
                            .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(binding.unwrap_or_else(|| "No checkout linked on this device.".into())))
                            .child(buttons),
                    )
                    .into_any_element(),
            );
        }
        rows.push(
            div()
                .child(Button::new("workspace-repo-add", "Add repository").disabled(self.repositories.len() >= team::MAX_REPOSITORIES).on_click(cx.listener(|this, _, window, cx| {
                    this.restructure(|config| config.repositories.get_or_insert_default().push(TeamRepository { id: uuid::Uuid::new_v4().to_string(), name: "New repository".into(), url: None }), window, cx);
                })))
                .into_any_element(),
        );
        rows
    }

    fn environments(&mut self, root: &str, cx: &mut Context<Self>) -> Vec<AnyElement> {
        if self.environment.as_ref().is_none_or(|environment| environment.root != root) {
            self.refresh_environment(root, cx);
        }
        let Some(environment) = &self.environment else { return Vec::new() };
        let loading = environment.loading;
        let refresh_root = root.to_string();
        let mut rows = vec![Self::muted_item(
            environment.info.as_ref().map_or("Workspace environment", |info| info.kind.title()),
            root.to_string(),
            Some(
                Button::new("workspace-env-refresh", if loading { "Inspecting…" } else { "Refresh" })
                    .disabled(loading)
                    .on_click(cx.listener(move |this, _, _, cx| this.refresh_environment(&refresh_root, cx)))
                    .into_any_element(),
            ),
            cx,
        )];
        let mut requirements: Vec<AnyElement> = vec![Self::text("Read from project manifests. These are the project's requirements; installed versions have not been verified.", cx).into_any_element()];
        if let Some(info) = &environment.info {
            for requirement in &info.requirements {
                requirements.push(Self::muted_item(requirement.name.clone(), requirement.version.clone(), None, cx));
            }
            if info.requirements.is_empty() {
                requirements.push(Self::text("No runtime requirements found in the supported project manifests.", cx).into_any_element());
            }
        }
        rows.push(Self::group("Declared tool requirements", requirements, cx));
        #[cfg(not(target_family = "wasm"))]
        {
            let mut connections: Vec<AnyElement> = vec![Self::text("Open a saved remote environment using Athas's existing SSH connection and authentication flow.", cx).into_any_element()];
            for (index, connection) in environment.connections.iter().enumerate() {
                let id = connection.id.clone();
                let address = format!("{}{}:{}", if connection.username.is_empty() { String::new() } else { format!("{}@", connection.username) }, connection.host, connection.port);
                connections.push(Self::muted_item(
                    connection.name.clone(),
                    address,
                    Some(Button::new(("workspace-env-connect", index), "Connect").on_click(move |_, _, cx| workbench_api::request(cx, workbench_api::OpenRequest::RemoteConnection { id: id.clone() })).into_any_element()),
                    cx,
                ));
            }
            if !loading && environment.connections.is_empty() {
                connections.push(Self::text("No saved SSH connections.", cx).into_any_element());
            }
            connections.push(
                div()
                    .child(Button::new("workspace-env-add-ssh", "Add SSH connection").on_click(|_, _, cx| workbench_api::request(cx, workbench_api::OpenRequest::AddRemoteConnection)))
                    .into_any_element(),
            );
            rows.push(Self::group("Saved SSH connections on this device", connections, cx));
        }
        if environment.info.as_ref().is_some_and(EnvironmentInfo::has_dev_container) {
            rows.push(Self::text("This project contains Dev Container configuration. Starting a Dev Container from Athas is not supported yet.", cx).into_any_element());
        }
        rows
    }

    fn group(title: &'static str, children: Vec<AnyElement>, cx: &App) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(cx.theme().colors.muted_foreground).child(title))
            .children(children)
            .into_any_element()
    }

    fn tasks(&self, root: &str, active: bool, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut rows = vec![Self::text("Team tasks appear in Run Actions after saving. Run opens the command shown below in a terminal; output and process controls stay in that terminal.", cx).into_any_element()];
        if !active {
            rows.push(Self::text("Open this workspace to run its tasks.", cx).into_any_element());
        }
        if let Some(name) = &self.last_started {
            rows.push(Self::text(format!("Opened {name} in a terminal."), cx).into_any_element());
        }
        if self.tasks.is_empty() {
            rows.push(Self::text("No shared tasks yet. Add a development, test or build command for your team.", cx).into_any_element());
        }
        for (index, editor) in self.tasks.iter().enumerate() {
            let runnable = active && !editor.command.read(cx).text().trim().is_empty() && !editor.name.read(cx).text().trim().is_empty();
            let run_root = root.to_string();
            rows.push(
                Card::new()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .p(px(12.))
                            .child(div().flex().gap(px(12.)).child(Self::field("Task name", editor.name.clone(), cx)).child(Self::field("Working directory", editor.directory.clone(), cx)))
                            .child(Self::field("Command", editor.command.clone(), cx))
                            .child(
                                div()
                                    .flex()
                                    .gap(px(8.))
                                    .child(Button::new(("workspace-task-run", index), "Run task").disabled(!runnable).on_click(cx.listener(move |this, _, _, cx| this.run_task(&run_root, index, active, cx))))
                                    .child(Button::new(("workspace-task-remove", index), "Remove task").variant(ButtonVariant::Ghost).on_click(cx.listener(move |this, _, window, cx| {
                                        this.restructure(
                                            move |config| {
                                                if index < config.commands.len() {
                                                    config.commands.remove(index);
                                                }
                                            },
                                            window,
                                            cx,
                                        );
                                    }))),
                            ),
                    )
                    .into_any_element(),
            );
        }
        rows.push(
            div()
                .child(Button::new("workspace-task-add", "Add task").disabled(self.tasks.len() >= team::MAX_COMMANDS).on_click(cx.listener(|this, _, window, cx| {
                    this.restructure(|config| config.commands.push(TeamCommand { name: String::new(), command: String::new(), working_directory: Some(".".into()) }), window, cx);
                })))
                .into_any_element(),
        );
        rows
    }

    fn ai(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        vec![
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(Self::field("Team instructions", self.instructions.clone(), cx))
                .child(Self::text(
                    "After saving, these instructions accompany new messages to integrated agents and chat providers for this project. They provide context, not enforced security policies.",
                    cx,
                ))
                .into_any_element(),
            Self::muted_item(
                "Project instruction files",
                "Keep detailed repository guidance in AGENTS.md or your agent's supported instruction files. Terminal agents continue to use their own project files.",
                None,
                cx,
            ),
            Self::muted_item(
                "Agents and providers",
                "Manage available agents, models and credentials in your personal Agent settings. Credentials stay out of the shared workspace file.",
                Some(Button::new("workspace-ai-configure", "Configure agents").on_click(|_, _, cx| workbench_api::open_settings(cx, Some("ai"), None)).into_any_element()),
                cx,
            ),
        ]
    }

    fn integrations(&mut self, config: &TeamWorkspace, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let ids = config.recommended_extensions.clone().unwrap_or_default();
        let registry = cx.try_global::<extensions::Extensions>();
        let entries = registry.map(|registry| registry.entries()).unwrap_or_default();
        let settings = settings::get(cx).clone();
        let mut rows = vec![Self::text("Recommend integrations for teammates. Installation is explicit and follows existing organization policies. Recommendations do not change personal settings automatically.", cx).into_any_element()];
        for (index, id) in ids.iter().enumerate() {
            let entry = entries.iter().find(|entry| &entry.manifest.id == id);
            let status = registry.map(|registry| registry.status(id, &settings));
            let label = match (&entry, &status) {
                (_, Some(status)) if status.operation.is_some() => "Installing…",
                (_, Some(status)) if status.installed && status.enabled => "Installed and enabled",
                (_, Some(status)) if status.installed => "Installed, disabled",
                (Some(_), _) => "Not installed",
                _ => "Not found in the current catalog",
            };
            let installed = status.as_ref().is_some_and(|status| status.installed);
            let disabled = entry.is_none() || status.as_ref().is_some_and(|status| status.operation.is_some() || (status.installed && status.enabled));
            let (install_id, remove_id) = (id.clone(), id.clone());
            let error = status.as_ref().and_then(|status| status.error.clone());
            let actions = div()
                .flex()
                .gap(px(8.))
                .child(Button::new(("workspace-ext-install", index), if installed { "Enable" } else { "Install" }).disabled(disabled).on_click(cx.listener(move |this, _, _, cx| {
                    if installed {
                        if let Err(error) = extensions::set_enabled(&install_id, true, cx) {
                            this.report(error.to_string(), cx);
                        }
                    } else {
                        let task = extensions::install(&install_id, cx);
                        cx.spawn(async move |this, cx| {
                            if let Err(error) = task.await {
                                this.update(cx, |this, cx| this.report(error.to_string(), cx)).ok();
                            }
                        })
                        .detach();
                    }
                })))
                .child(Button::new(("workspace-ext-remove", index), "Remove recommendation").variant(ButtonVariant::Ghost).on_click(cx.listener(move |this, _, _, cx| {
                    let Some((root, _)) = this.filled.clone() else { return };
                    let Some(mut config) = this.config(&root, cx) else { return };
                    config.recommended_extensions.get_or_insert_default().retain(|entry| entry != &remove_id);
                    this.change(&root, config, cx);
                })));
            let title = entry.map_or(id.clone(), |entry| entry.manifest.display_name.clone());
            rows.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(Self::muted_item(title, format!("{id} · {label}"), Some(actions.into_any_element()), cx))
                    .children(error.map(|error| div().px(px(12.)).text_size(typography::text_sm()).text_color(cx.theme().colors.destructive).child(error)))
                    .into_any_element(),
            );
        }
        if ids.is_empty() {
            rows.push(Self::text("No integrations recommended yet.", cx).into_any_element());
        }
        let options: Vec<String> = entries.iter().map(|entry| entry.manifest.id.clone()).filter(|id| !ids.contains(id)).collect();
        if options != self.extension_options {
            let select_options = entries
                .iter()
                .filter(|entry| options.contains(&entry.manifest.id))
                .map(|entry| SelectOption::new(entry.manifest.id.clone(), entry.manifest.display_name.clone()).keywords([entry.manifest.id.clone()]))
                .collect();
            self.extension_select.update(cx, |select, cx| select.set_options(select_options, cx));
            self.extension_options = options;
        }
        let selected = self.extension_select.read(cx).value().to_string();
        let can_add = !selected.is_empty() && !ids.contains(&selected) && ids.len() < team::MAX_RECOMMENDED_EXTENSIONS;
        rows.push(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(8.))
                .child(self.extension_select.clone())
                .child(Button::new("workspace-ext-add", "Recommend integration").disabled(!can_add).on_click(cx.listener(|this, _, _, cx| {
                    let selected = this.extension_select.read(cx).value().to_string();
                    let Some((root, _)) = this.filled.clone() else { return };
                    let Some(mut config) = this.config(&root, cx) else { return };
                    let ids = config.recommended_extensions.get_or_insert_default();
                    if selected.is_empty() || ids.contains(&selected) {
                        return;
                    }
                    ids.push(selected);
                    this.change(&root, config, cx);
                    this.extension_select.update(cx, |select, cx| select.set_value("", cx));
                })))
                .child(Button::new("workspace-ext-browse", "Browse marketplace").variant(ButtonVariant::Ghost).on_click(|_, _, cx| workbench_api::open_resource(cx, "extensions", "", "Extensions")))
                .into_any_element(),
        );
        rows
    }
}

impl Render for WorkspaceSettings {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let (root, paths, active) = self.root(cx);
        if let Some(root) = &root {
            self.management.update(cx, |management, cx| management.load(root, false, cx));
        }
        let options: Vec<(String, String)> = {
            let management = self.management.read(cx);
            paths.iter().map(|path| (path.clone(), management.drafts.get(path).map(|draft| draft.config.name.clone()).filter(|name| !name.is_empty()).unwrap_or_else(|| team::base_name(path)))).collect()
        };
        if options != self.workspace_options {
            let select_options = options.iter().map(|(path, label)| SelectOption::new(path.clone(), label.clone()).keywords([path.clone()])).collect();
            self.workspace_select.update(cx, |select, cx| select.set_options(select_options, cx));
            self.workspace_options = options;
        }
        let selected = root.clone().unwrap_or_default();
        if self.workspace_select.read(cx).value().as_ref() != selected {
            self.workspace_select.update(cx, |select, cx| select.set_value(selected.clone(), cx));
        }
        let section = self.management.read(cx).state().section;
        let draft = root.as_ref().and_then(|root| {
            let draft = self.management.read(cx).drafts.get(root)?;
            Some((draft.config.clone(), draft.original.is_some(), draft.loading, draft.saving, draft.error.clone(), draft.revision, draft.dirty()))
        });
        if let (Some(root), Some((config, _, false, _, _, revision, _))) = (&root, &draft)
            && self.filled.as_ref() != Some(&(root.clone(), *revision))
        {
            if self.filled.as_ref().is_none_or(|(filled, _)| filled != root) {
                self.action_error = None;
                self.confirm_reload = false;
                self.last_started = None;
            }
            self.fill(root, config, *revision, window, cx);
        }
        let is_active = root.as_ref().zip(active.as_ref()).is_some_and(|(root, active)| team::paths_equal(root, active));
        let busy = draft.as_ref().is_some_and(|draft| draft.2 || draft.3);
        let dirty = draft.as_ref().is_some_and(|draft| draft.6);

        let mut toolbar = div().flex().flex_wrap().items_center().gap(px(8.)).child(self.workspace_select.clone()).child(
            Button::new("workspace-add", "Add").variant(ButtonVariant::Ghost).leading_icon(IconName::Plus).on_click(cx.listener(|this, _, _, cx| {
                this.pick_folder("Add Workspace", cx, |this, path, cx| this.management.update(cx, |management, cx| management.register(&path, cx)));
            })),
        );
        if let Some(root) = root.clone() {
            let open_root = root.clone();
            let save_root = root.clone();
            toolbar = toolbar
                .child(Button::new("workspace-reload", "Reload").variant(ButtonVariant::Ghost).disabled(busy).on_click(cx.listener(move |this, _, _, cx| {
                    if dirty {
                        this.confirm_reload = true;
                        cx.notify();
                    } else {
                        this.management.update(cx, |management, cx| management.load(&root, true, cx));
                    }
                })))
                .child(
                    Button::new("workspace-open", if is_active { "Active Workspace" } else { "Open Workspace" })
                        .variant(ButtonVariant::Ghost)
                        .disabled(is_active || draft.as_ref().is_some_and(|draft| draft.2))
                        .on_click(move |_, _, cx| workbench_api::open_project(cx, open_root.clone())),
                )
                .child(
                    Button::new("workspace-save", "Save Changes")
                        .disabled(draft.as_ref().is_none_or(|draft| draft.2 || draft.3 || (!draft.6 && draft.1)))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.action_error = None;
                            this.management.update(cx, |management, cx| management.save(&save_root, cx));
                        })),
                );
        }

        let mut content = div().flex().flex_col().gap(px(24.)).child(toolbar);
        let Some(root) = root else {
            return content.child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(12.))
                    .py(px(32.))
                    .rounded(metrics::island_radius())
                    .bg(colors.raised)
                    .child(Self::text("Add a project folder to create a workspace. Your existing files stay where they are.", cx))
                    .child(Button::new("workspace-add-empty", "Add Workspace").on_click(cx.listener(|this, _, _, cx| {
                        this.pick_folder("Add Workspace", cx, |this, path, cx| this.management.update(cx, |management, cx| management.register(&path, cx)));
                    }))),
            );
        };

        let status = draft.as_ref().map(|draft| match draft {
            (_, _, _, true, ..) => "Saving…",
            (.., true) => "Unsaved changes",
            (_, false, ..) => "Not shared yet",
            _ => "Saved to repository file",
        });
        let toggle_options = WorkspaceSection::ALL.iter().map(|section| ToggleOption::new(section.id(), section.label())).collect();
        content = content
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(ToggleGroup::new("workspace-sections", toggle_options, section.id()).on_change({
                        let management = self.management.clone();
                        move |id, _, cx| {
                            if let Some(section) = WorkspaceSection::from_id(&id) {
                                management.update(cx, |management, cx| management.set_section(section, cx));
                            }
                        }
                    }))
                    .children(status.map(|status| Self::text(status, cx))),
            )
            .child(Self::text(section.description(), cx));
        if self.confirm_reload {
            let reload_root = root.clone();
            content = content.child(
                Alert::new()
                    .tone(Tone::Warning)
                    .icon(IconName::Warning)
                    .title("Reload workspace")
                    .description("Discard unsaved workspace configuration and reload the file?")
                    .action(Button::new("workspace-reload-cancel", "Cancel").variant(ButtonVariant::Ghost).on_click(cx.listener(|this, _, _, cx| {
                        this.confirm_reload = false;
                        cx.notify();
                    })))
                    .action(Button::new("workspace-reload-confirm", "Discard and reload").variant(ButtonVariant::Destructive).on_click(cx.listener(move |this, _, _, cx| {
                        this.confirm_reload = false;
                        this.management.update(cx, |management, cx| management.load(&reload_root, true, cx));
                    }))),
            );
        }
        if let Some(error) = self.action_error.clone().or_else(|| draft.as_ref().and_then(|draft| draft.4.clone())) {
            content = content.child(div().text_size(typography::text_sm()).text_color(colors.destructive).child(error));
        }
        let Some((config, ..)) = draft.filter(|draft| !draft.2) else {
            return content.child(Self::text("Loading workspace…", cx));
        };
        let rows = match section {
            WorkspaceSection::Overview => self.overview(&root, &config, cx),
            WorkspaceSection::Repositories => self.repositories(&root, &config, cx),
            WorkspaceSection::Environments => self.environments(&root, cx),
            WorkspaceSection::Tasks => self.tasks(&root, is_active, cx),
            WorkspaceSection::Ai => self.ai(cx),
            WorkspaceSection::Extensions => self.integrations(&config, cx),
        };
        content.child(div().flex().flex_col().gap(px(16.)).when(busy, |this| this.opacity(0.6)).children(rows))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[gpui::test]
    fn loads_edits_and_saves_a_profile(cx: &mut gpui::TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().into_owned();
        let management = cx.update(|cx| {
            use_state_at(None, cx);
            management(cx)
        });
        management.update(cx, |management, cx| {
            management.register(&root, cx);
            management.load(&root, false, cx);
        });
        cx.run_until_parked();
        management.update(cx, |management, cx| {
            let draft = &management.drafts[&root];
            assert_eq!(draft.original, None);
            let mut config = draft.config.clone();
            config.commands.push(TeamCommand { name: "Dev".into(), command: "bun dev".into(), working_directory: Some(".".into()) });
            management.update_config(&root, config, cx);
            assert!(management.drafts[&root].dirty());
            management.save(&root, cx);
        });
        cx.run_until_parked();
        let saved = std::fs::read_to_string(dir.path().join(team::TEAM_WORKSPACE_FILE)).unwrap();
        assert!(saved.contains("\"command\": \"bun dev\""));
        management.update(cx, |management, cx| {
            assert!(!management.drafts[&root].dirty());
            std::fs::write(dir.path().join(team::TEAM_WORKSPACE_FILE), "{}").unwrap();
            let mut config = management.drafts[&root].config.clone();
            config.name = "Changed".into();
            management.update_config(&root, config, cx);
            management.save(&root, cx);
        });
        cx.run_until_parked();
        management.update(cx, |management, _| {
            assert_eq!(management.drafts[&root].error.as_deref(), Some("The team workspace changed on disk. Reload the workspace before saving."));
        });
    }
}
