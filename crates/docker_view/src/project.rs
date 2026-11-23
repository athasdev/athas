//! The project's Docker setup (`DockerProjectConfig`): its env files, dev containers, the presets
//! saved in `.athas/docker.json` and the launch configs found in the workspace.

#[cfg(target_family = "wasm")]
use crate::athas_docker;
use athas_docker::{DockerComposePreset, DockerDebugPreset, DockerDevContainer, DockerEnvFile, DockerProjectConfig};
use ui::scale::px;
use gpui::{AnyElement, ClickEvent, Context, IntoElement, Pixels, Point, Window, div, prelude::*,};
use theme::ThemeColors;
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, MenuEntry, WithScrollbar, typography};

use crate::{
    DockerView, DockerViewEvent, Field, FormKind, PendingPreset, Tone,
    model::{self, ContainerState},
    runtime,
};

/// The kinds of saved preset, for deleting one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PresetKind {
    Build,
    Run,
    Compose,
    Debug,
}

impl PresetKind {
    fn label(self) -> &'static str {
        match self {
            Self::Build => "build",
            Self::Run => "run",
            Self::Compose => "compose",
            Self::Debug => "debug",
        }
    }
}

/// Removes the preset called `name` of `kind`.
pub(crate) fn remove_preset(config: &mut DockerProjectConfig, kind: PresetKind, name: &str) {
    match kind {
        PresetKind::Build => config.build_presets.retain(|preset| preset.name != name),
        PresetKind::Run => config.run_presets.retain(|preset| preset.name != name),
        PresetKind::Compose => config.compose_presets.retain(|preset| preset.name != name),
        PresetKind::Debug => config.debug_presets.retain(|preset| preset.name != name),
    }
}

/// Adds `preset` under `name`, replacing one of the same kind and name.
pub(crate) fn add_preset(config: &mut DockerProjectConfig, preset: PendingPreset, name: String) {
    match preset {
        PendingPreset::Build(mut preset) => {
            config.build_presets.retain(|existing| existing.name != name);
            preset.name = name;
            config.build_presets.push(preset);
        }
        PendingPreset::Run(mut preset) => {
            config.run_presets.retain(|existing| existing.name != name);
            preset.name = name;
            config.run_presets.push(preset);
        }
        PendingPreset::Compose(mut preset) => {
            config.compose_presets.retain(|existing| existing.name != name);
            preset.name = name;
            config.compose_presets.push(preset);
        }
    }
}

/// How many things the Project tab lists.
pub(crate) fn item_count(config: &DockerProjectConfig) -> usize {
    config.env_files.len()
        + config.dev_containers.len()
        + config.build_presets.len()
        + config.run_presets.len()
        + config.compose_presets.len()
        + config.debug_presets.len()
        + config.workspace_debug_presets.len()
}

/// One row of the Project tab: its title, what it is, and its first action.
struct ProjectRow {
    id: String,
    icon: IconName,
    title: String,
    detail: String,
    primary: (&'static str, IconName),
    on_primary: Box<dyn Fn(&mut DockerView, Point<Pixels>, &mut Window, &mut Context<DockerView>)>,
    on_delete: Option<Box<dyn Fn(&mut DockerView, Point<Pixels>, &mut Window, &mut Context<DockerView>)>>,
}

impl DockerView {
    fn workspace(&self) -> Option<String> {
        self.cwd.as_ref().map(|cwd| cwd.to_string_lossy().into_owned())
    }

    /// Changes the presets and saves `.athas/docker.json`, then shows what was saved.
    pub(crate) fn update_project(&mut self, done: &str, cx: &mut Context<Self>, change: impl FnOnce(&mut DockerProjectConfig) + Send + 'static) {
        let Some(workspace) = self.workspace() else { return };
        let Some(mut config) = self.project.clone() else { return };
        let done = done.to_string();
        let task = runtime::spawn(async move {
            change(&mut config);
            athas_docker::save_project_config(workspace, config)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| match result {
                Ok(config) => {
                    this.project = Some(config);
                    this.report(done, Tone::Success, cx);
                }
                Err(error) => this.report(error, Tone::Error, cx),
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn save_preset(&mut self, preset: PendingPreset, name: String, cx: &mut Context<Self>) {
        let kind = match &preset {
            PendingPreset::Build(_) => "build",
            PendingPreset::Run(_) => "run",
            PendingPreset::Compose(_) => "Compose",
        };
        self.update_project(&format!("Saved the {kind} preset {name}"), cx, move |config| add_preset(config, preset, name));
    }

    fn reload_project(&mut self, cx: &mut Context<Self>, then: impl FnOnce(&mut Self, &mut Context<Self>) + 'static) {
        let workspace = self.workspace();
        let task = runtime::spawn(async move { Ok(athas_docker::project_config(workspace)) });
        cx.spawn(async move |this, cx| {
            let Ok(project) = task.await else { return };
            this.update(cx, |this, cx| {
                this.apply_project(Some(project));
                then(this, cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn open_env_file_by_path(&mut self, path: String, cx: &mut Context<Self>) {
        let Some(workspace) = self.workspace() else { return };
        let task = runtime::spawn(async move { athas_docker::open_env_file(workspace, path) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| match result {
                Ok(content) => {
                    let path = std::path::PathBuf::from(content.file.path);
                    this.reload_project(cx, move |_, cx| cx.emit(DockerViewEvent::OpenFile(path)));
                }
                Err(error) => this.report(error, Tone::Error, cx),
            })
            .ok();
        })
        .detach();
    }

    fn delete_env_file(&mut self, env_file: DockerEnvFile, cx: &mut Context<Self>) {
        let Some(workspace) = self.workspace() else { return };
        let done = format!("Deleted {}", env_file.relative_path);
        let task = runtime::spawn(async move { athas_docker::delete_env_file(workspace, env_file.path).map(|_| String::new()) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(_) => this.report(done, Tone::Success, cx),
                    Err(error) => this.report(error, Tone::Error, cx),
                }
                this.reload_project(cx, |_, _| {});
            })
            .ok();
        })
        .detach();
    }

    /// Starts the dev container (building or creating it when needed), then attaches a terminal.
    fn open_dev_container(&mut self, dev_container: DockerDevContainer, cx: &mut Context<Self>) {
        let Some(workspace) = self.workspace() else { return };
        if dev_container.kind == "unsupported" {
            return;
        }
        let key = format!("devcontainer:{}", dev_container.config_path);
        if !self.busy.insert(key.clone()) {
            return;
        }
        let docker = self.docker();
        let name = dev_container.name.clone();
        let task = runtime::spawn(async move { docker.open_dev_container(workspace, dev_container.config_path).await });
        self.report(format!("Opening {name}…"), Tone::Success, cx);
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy.remove(&key);
                match result {
                    Ok(opened) => {
                        this.report(format!("Opened {name}"), Tone::Success, cx);
                        let cwd = this.cwd.clone();
                        this.run_in_terminal(opened.command, opened.name, cwd, cx);
                    }
                    Err(error) => this.report(format!("Couldn't open {name}: {error}"), Tone::Error, cx),
                }
                this.refresh(cx);
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn run_compose_preset(&mut self, preset: DockerComposePreset, cx: &mut Context<Self>) {
        let Some(project) = &self.compose else {
            self.report("This project has no Compose file", Tone::Error, cx);
            return;
        };
        let Some(workspace) = project.workspace_path.clone() else { return };
        let files = if preset.files.is_empty() { project.files.clone() } else { preset.files.clone() };
        let docker = self.docker();
        let done = format!("Ran the Compose preset {}", preset.name);
        let action = preset.action.clone();
        let retry = preset.clone();
        let failure = crate::Failure::retry(format!("Couldn't run the Compose preset {}", preset.name), move |view, cx| {
            view.run_compose_preset(retry.clone(), cx)
        });
        self.run_action(
            format!("compose:{}", preset.service.as_deref().unwrap_or("")),
            done,
            failure,
            async move { docker.compose_action(workspace, files, preset.service, action, Some(preset.env_files)).await },
            cx,
        );
    }

    pub(crate) fn save_compose_preset(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(project) = &self.compose else { return };
        let env_files = self.project.as_ref().map(|config| config.env_files.iter().map(|file| file.path.clone()).collect()).unwrap_or_default();
        let preset = DockerComposePreset { name: String::new(), files: project.files.clone(), service: None, action: "up".into(), env_files };
        self.open_form(FormKind::PresetName(PendingPreset::Compose(preset)), "Save Compose Preset", "Save Preset", vec![Field::new("Name", "start workspace")], window, cx);
    }

    pub(crate) fn open_env_file_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_form(FormKind::EnvFile, "Open or create an env file", "Open", vec![Field::new("Env file path", ".env").value(".env")], window, cx);
    }

    pub(crate) fn open_save_debug_preset_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let fields = vec![
            Field::new("Name", "debug server"),
            Field::new("Debug command", "python -m pdb app.py"),
            Field::new("Working directory", "Optional, in the container"),
        ];
        self.open_form(FormKind::SaveDebugPreset, "Save a debug preset", "Save Preset", fields, window, cx);
    }

    /// A debug preset runs in a running container picked from a menu.
    fn pick_container_for(&mut self, preset: DockerDebugPreset, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let running: Vec<_> = self
            .containers
            .iter()
            .filter(|container| ContainerState::parse(&container.state) == ContainerState::Running)
            .map(|container| (container.id.clone(), container.name.clone(), container.image.clone()))
            .collect();
        let mut entries = vec![MenuEntry::Label(format!("Run {} in a running container", preset.name).into())];
        if running.is_empty() {
            entries.push(MenuEntry::Label("No running containers".into()));
        }
        for (id, name, image) in running {
            let preset = preset.clone();
            entries.push(
                self.item(format!("{name} · {image}"), cx, move |this, _, cx| {
                    this.run_debug(&id, &name, &preset.command, preset.workdir.as_deref(), cx)
                })
                .icon(IconName::Cube)
                .into(),
            );
        }
        self.show_menu(&format!("debug-preset:{}", preset.name), entries, position, window, cx);
    }

    fn confirm_delete_preset(&mut self, kind: PresetKind, name: String, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let question = format!("Delete the {} preset {name}?", kind.label());
        self.confirm(question, "Delete Preset", position, window, cx, move |this, cx| {
            let name = name.clone();
            this.update_project(&format!("Deleted the {} preset {name}", kind.label()), cx, move |config| remove_preset(config, kind, &name));
        });
    }

    fn project_rows(&self, config: &DockerProjectConfig) -> Vec<(&'static str, Vec<ProjectRow>)> {
        let mut sections = Vec::new();
        let env_files = config
            .env_files
            .iter()
            .map(|env_file| {
                let (open, delete) = (env_file.clone(), env_file.clone());
                let variables = model::plural(env_file.variable_count, "variable");
                ProjectRow {
                    id: format!("env:{}", env_file.path),
                    icon: IconName::FileText,
                    title: env_file.relative_path.clone(),
                    detail: model::join_parts([Some(variables.as_str()), Some(env_file.keys.join(", ").as_str())]),
                    primary: ("Open", IconName::OpenExternal),
                    on_primary: Box::new(move |_, _, _, cx| cx.emit(DockerViewEvent::OpenFile(open.path.clone().into()))),
                    on_delete: Some(Box::new(move |this, position, window, cx| {
                        let env_file = delete.clone();
                        let question = format!("Delete {}? This deletes the file from disk.", env_file.relative_path);
                        this.confirm(question, "Delete Env File", position, window, cx, move |this, cx| this.delete_env_file(env_file.clone(), cx));
                    })),
                }
            })
            .collect::<Vec<_>>();
        sections.push(("Env Files", env_files));
        let dev_containers = config
            .dev_containers
            .iter()
            .map(|dev_container| {
                let open = dev_container.clone();
                let unsupported = dev_container.kind == "unsupported";
                ProjectRow {
                    id: format!("devcontainer:{}", dev_container.config_path),
                    icon: IconName::Package,
                    title: dev_container.name.clone(),
                    detail: model::join_parts([Some(dev_container.kind.as_str()), Some(dev_container.relative_path.as_str())]),
                    primary: (if unsupported { "Unsupported config" } else { "Open" }, IconName::Play),
                    on_primary: Box::new(move |this, _, _, cx| this.open_dev_container(open.clone(), cx)),
                    on_delete: None,
                }
            })
            .collect();
        sections.push(("Dev Containers", dev_containers));
        let mut presets = Vec::new();
        for preset in &config.build_presets {
            let (use_preset, name) = (preset.clone(), preset.name.clone());
            presets.push(ProjectRow {
                id: format!("build:{}", preset.name),
                icon: IconName::Stack,
                title: preset.name.clone(),
                detail: model::join_parts([Some("Build preset"), Some(preset.tag.as_deref().unwrap_or(&preset.context_path))]),
                primary: ("Use Preset…", IconName::Stack),
                on_primary: Box::new(move |this, _, window, cx| this.open_build_form(Some(use_preset.clone()), window, cx)),
                on_delete: Some(Box::new(move |this, position, window, cx| this.confirm_delete_preset(PresetKind::Build, name.clone(), position, window, cx))),
            });
        }
        for preset in &config.run_presets {
            let (use_preset, name) = (preset.clone(), preset.name.clone());
            presets.push(ProjectRow {
                id: format!("run:{}", preset.name),
                icon: IconName::Play,
                title: preset.name.clone(),
                detail: model::join_parts([Some("Run preset"), Some(preset.image.as_str())]),
                primary: ("Use Preset…", IconName::Play),
                on_primary: Box::new(move |this, _, window, cx| this.open_run_form(Some(use_preset.clone()), None, window, cx)),
                on_delete: Some(Box::new(move |this, position, window, cx| this.confirm_delete_preset(PresetKind::Run, name.clone(), position, window, cx))),
            });
        }
        for preset in &config.compose_presets {
            let (run, name) = (preset.clone(), preset.name.clone());
            presets.push(ProjectRow {
                id: format!("compose:{}", preset.name),
                icon: IconName::Nodes,
                title: preset.name.clone(),
                detail: model::join_parts([Some("Compose preset"), Some(preset.action.as_str()), preset.service.as_deref()]),
                primary: ("Run", IconName::Play),
                on_primary: Box::new(move |this, _, _, cx| this.run_compose_preset(run.clone(), cx)),
                on_delete: Some(Box::new(move |this, position, window, cx| this.confirm_delete_preset(PresetKind::Compose, name.clone(), position, window, cx))),
            });
        }
        for preset in &config.debug_presets {
            let (run, name) = (preset.clone(), preset.name.clone());
            presets.push(ProjectRow {
                id: format!("debug:{}", preset.name),
                icon: IconName::Bug,
                title: preset.name.clone(),
                detail: model::join_parts([Some("Debug preset"), Some(preset.command.as_str())]),
                primary: ("Run in Container…", IconName::Play),
                on_primary: Box::new(move |this, position, window, cx| this.pick_container_for(run.clone(), position, window, cx)),
                on_delete: Some(Box::new(move |this, position, window, cx| this.confirm_delete_preset(PresetKind::Debug, name.clone(), position, window, cx))),
            });
        }
        sections.push(("Presets", presets));
        let launch = config
            .workspace_debug_presets
            .iter()
            .map(|preset| {
                let run = preset.clone();
                ProjectRow {
                    id: format!("launch:{}", preset.name),
                    icon: IconName::Bug,
                    title: preset.name.clone(),
                    detail: model::join_parts([Some("Launch config"), Some(preset.command.as_str())]),
                    primary: ("Run in Container…", IconName::Play),
                    on_primary: Box::new(move |this, position, window, cx| this.pick_container_for(run.clone(), position, window, cx)),
                    on_delete: None,
                }
            })
            .collect();
        sections.push(("Launch Configs", launch));
        sections.into_iter().filter(|(_, rows)| !rows.is_empty()).collect()
    }

    pub(crate) fn render_project(&self, colors: &ThemeColors, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if self.cwd.is_none() {
            return self.render_empty("No project open", "Open a project folder to see its env files, dev containers and presets.", false);
        }
        if let Some(error) = &self.project_error {
            return div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(EmptyState::new("Couldn't read the project's Docker setup").icon(IconName::WarningCircle).message(error.clone()))
                .into_any_element();
        }
        let toolbar = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .px(px(8.))
            .pb(px(6.))
            .child(
                Button::new("docker-open-env", "Open Env File…")
                    .leading_icon(IconName::FileText)
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .on_click(cx.listener(|this, _, window, cx| this.open_env_file_form(window, cx))),
            )
            .child(
                Button::new("docker-save-debug", "Save Debug Preset…")
                    .leading_icon(IconName::Bug)
                    .size(ButtonSize::Small)
                    .variant(ButtonVariant::Ghost)
                    .on_click(cx.listener(|this, _, window, cx| this.open_save_debug_preset_form(window, cx))),
            );
        let query = self.filter_input.read(cx).text().to_string();
        let sections = self.project.as_ref().map(|config| self.project_rows(config)).unwrap_or_default();
        let filtered: Vec<_> = sections
            .into_iter()
            .map(|(title, rows)| (title, rows.into_iter().filter(|row| model::matches_query([row.title.as_str(), &row.detail], &query)).collect::<Vec<_>>()))
            .filter(|(_, rows)| !rows.is_empty())
            .collect();
        let body = if filtered.is_empty() {
            self.render_empty(
                "Nothing set up yet",
                "Env files, dev containers and saved build, run, Compose and debug presets show up here.",
                !query.is_empty(),
            )
        } else {
            let mut children = Vec::new();
            for (title, rows) in filtered {
                children.push(
                    div()
                        .flex_none()
                        .px(px(10.))
                        .pt(px(10.))
                        .pb(px(4.))
                        .text_size(typography::text_caption())
                        .font_weight(typography::MEDIUM)
                        .text_color(colors.subtle_foreground)
                        .child(title)
                        .into_any_element(),
                );
                for row in rows {
                    children.push(self.render_project_row(row, colors, cx));
                }
            }
            div().id("docker-project").flex().flex_col().flex_1().min_h_0().overflow_y_scroll().px(px(8.)).pb(px(12.)).children(children).scrollbar(window, cx).into_any_element()
        };
        div().flex().flex_col().flex_1().min_h_0().pt(px(4.)).child(toolbar).child(body).into_any_element()
    }

    fn render_project_row(&self, row: ProjectRow, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let busy = self.busy.contains(&row.id);
        let group = format!("docker-project-{}", row.id);
        let on_primary = std::rc::Rc::new(row.on_primary);
        let primary_click = on_primary.clone();
        div()
            .id(gpui::ElementId::Name(group.clone().into()))
            .group(group.clone())
            .flex()
            .flex_none()
            .items_center()
            .gap(px(12.))
            .h(px(32.))
            .px(px(10.))
            .rounded(ui::metrics::radius_md())
            .text_size(typography::text_sm())
            .hover(|style| style.bg(colors.accent))
            .when(busy, |this| this.opacity(0.55))
            .child(Icon::new(row.icon).size(IconSize::XSmall).color(colors.subtle_foreground))
            .child(div().flex_none().max_w(px(260.)).truncate().font_weight(typography::MEDIUM).text_color(colors.foreground).child(row.title))
            .child(div().flex_1().min_w_0().truncate().text_color(colors.subtle_foreground).child(row.detail))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .child(
                        Button::new(gpui::ElementId::Name(format!("{group}-primary").into()), row.primary.0)
                            .leading_icon(row.primary.1)
                            .size(ButtonSize::XSmall)
                            .variant(ButtonVariant::Ghost)
                            .disabled(busy || row.primary.0 == "Unsupported config")
                            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                                cx.stop_propagation();
                                primary_click(this, event.position(), window, cx)
                            })),
                    )
                    .children(row.on_delete.map(|on_delete| {
                        Button::icon(gpui::ElementId::Name(format!("{group}-delete").into()), IconName::Trash)
                            .size(ButtonSize::XSmall)
                            .tooltip("Delete")
                            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                                cx.stop_propagation();
                                on_delete(this, event.position(), window, cx)
                            }))
                    })),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use athas_docker::{DockerBuildPreset, DockerRunPreset};

    use super::*;

    fn empty() -> DockerProjectConfig {
        athas_docker::project_config(None).unwrap()
    }

    #[test]
    fn presets_replace_by_name_and_delete_by_kind() {
        let mut config = empty();
        let build = DockerBuildPreset { name: String::new(), context_path: "/srv".into(), dockerfile_path: None, tag: Some("a".into()), build_args: Vec::new() };
        add_preset(&mut config, PendingPreset::Build(build.clone()), "web".into());
        add_preset(&mut config, PendingPreset::Build(DockerBuildPreset { tag: Some("b".into()), ..build }), "web".into());
        assert_eq!(config.build_presets.len(), 1);
        assert_eq!(config.build_presets[0].tag.as_deref(), Some("b"));
        let run = DockerRunPreset { name: String::new(), image: "nginx".into(), container_name: None, ports: Vec::new(), volumes: Vec::new(), env: Vec::new(), env_files: Vec::new(), command: None };
        add_preset(&mut config, PendingPreset::Run(run), "web".into());
        assert_eq!(item_count(&config), 2);
        remove_preset(&mut config, PresetKind::Build, "web");
        assert!(config.build_presets.is_empty());
        assert_eq!(config.run_presets.len(), 1);
    }

    #[test]
    fn saved_presets_and_env_files_come_back_from_the_workspace() {
        let dir = std::env::temp_dir().join(format!("athas-docker-project-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".devcontainer")).unwrap();
        std::fs::write(dir.join(".env"), "A=1\nB=2\n").unwrap();
        std::fs::write(dir.join(".devcontainer/devcontainer.json"), r#"{ "name": "App", "image": "node:20" }"#).unwrap();
        let workspace = dir.to_string_lossy().into_owned();
        let mut config = athas_docker::project_config(Some(workspace.clone())).unwrap();
        assert_eq!(config.env_files.len(), 1);
        assert_eq!(config.env_files[0].variable_count, 2);
        assert_eq!(config.dev_containers.len(), 1);
        assert_eq!(config.dev_containers[0].name, "App");
        let debug = DockerDebugPreset { name: "server".into(), command: "node --inspect".into(), workdir: None, target: "container".into(), source: Some("project".into()) };
        config.debug_presets.push(debug);
        let saved = athas_docker::save_project_config(workspace.clone(), config).unwrap();
        assert_eq!(saved.debug_presets.len(), 1);
        assert!(dir.join(".athas/docker.json").is_file());
        let opened = athas_docker::open_env_file(workspace.clone(), ".env.local".into()).unwrap();
        assert!(opened.file.path.ends_with(".env.local"));
        athas_docker::delete_env_file(workspace.clone(), opened.file.path).unwrap();
        assert!(athas_docker::open_env_file(workspace, "notes.txt".into()).is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}
