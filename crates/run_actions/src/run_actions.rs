//! Run actions (`features/run-actions`): the project's scripts and tasks found in its manifests
//! (package.json, Cargo.toml, justfile, Makefile, go.mod, pyproject.toml) plus the user's own
//! commands, run in a new terminal.

use ui::TooltipExt as _;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    rc::Rc,
};

mod dialog;

pub use dialog::RunActionDialog;

use ui::scale::px;
use gpui::{Anchor, AnyElement, App, Context, Focusable, SharedString, Task, Window, div, prelude::*,};
use palette::{FuzzyMatch, Picker, PickerDelegate, PaletteRow, fuzzy_match};
use regex::Regex;
use serde::{Deserialize, Serialize};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, MenuItem, MenuSize, OpenMenu, metrics, typography};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RunActionSource {
    Team,
    Custom,
    Lens,
    Package,
    Cargo,
    Just,
    Make,
    Go,
    Python,
}

impl RunActionSource {
    fn priority(self) -> i32 {
        match self {
            RunActionSource::Team => -1,
            RunActionSource::Custom => 1,
            RunActionSource::Lens => 2,
            RunActionSource::Package => 3,
            RunActionSource::Cargo => 4,
            RunActionSource::Just => 5,
            RunActionSource::Make => 6,
            RunActionSource::Go => 7,
            RunActionSource::Python => 8,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RunAction {
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub source: RunActionSource,
    /// The group the menu lists it under: "package.json", "Your actions", …
    pub source_label: String,
    pub working_directory: PathBuf,
    /// The saved action this came from, for Edit and Delete.
    pub custom_id: Option<String>,
    /// A run/test lens of the file in front, by its index among them (the "Current file" group).
    pub lens: Option<usize>,
}

/// A command the user saved for a project.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomRunAction {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
}

const MANIFEST_NAMES: &[&str] = &[
    workspace::team::TEAM_WORKSPACE_FILE,
    "package.json",
    "bun.lock",
    "bun.lockb",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    "Cargo.toml",
    "justfile",
    "Justfile",
    "Makefile",
    "makefile",
    "go.mod",
    "pyproject.toml",
];

fn script_priority(name: &str) -> i32 {
    let rank = |name: &str| match name {
        "dev" => Some(0),
        "start" => Some(1),
        "test" => Some(2),
        "check" => Some(3),
        "typecheck" => Some(4),
        "lint" => Some(5),
        "build" => Some(6),
        "format" => Some(7),
        "preview" => Some(8),
        _ => None,
    };
    let name = name.to_lowercase();
    rank(&name)
        .or_else(|| rank(name.split(':').next().unwrap_or_default()).map(|priority| priority + 20))
        .unwrap_or(100)
}

fn action(source: RunActionSource, label: &str, name: &str, command: &str, cwd: &Path, description: Option<String>) -> RunAction {
    RunAction {
        name: name.to_string(),
        command: command.to_string(),
        description,
        source,
        source_label: label.to_string(),
        working_directory: cwd.to_path_buf(),
        custom_id: None,
        lens: None,
    }
}

/// The "Current file" group (`codeLensesToRunActions`): the active file's runnable lenses, as
/// `(line, title)` with zero-based lines.
pub fn lens_actions(file: &Path, lenses: &[(usize, String)]) -> Vec<RunAction> {
    let file_name = file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let cwd = file.parent().unwrap_or(file);
    lenses
        .iter()
        .enumerate()
        .map(|(index, (line, title))| RunAction {
            lens: Some(index),
            ..action(RunActionSource::Lens, "Current file", title, "", cwd, Some(format!("{file_name}:{}", line + 1)))
        })
        .collect()
}

/// Puts the lens group after the user's own actions, as the original menu does.
pub fn with_lens_group(mut actions: Vec<RunAction>, lenses: &[RunAction]) -> Vec<RunAction> {
    let at = actions.iter().rposition(|action| matches!(action.source, RunActionSource::Team | RunActionSource::Custom)).map_or(0, |index| index + 1);
    actions.splice(at..at, lenses.iter().cloned());
    actions
}

fn package_runner(manager: Option<&str>, names: &HashSet<&str>) -> &'static str {
    match manager.and_then(|manager| manager.split('@').next()).map(str::trim) {
        Some("bun") => return "bun",
        Some("pnpm") => return "pnpm",
        Some("yarn") => return "yarn",
        Some("npm") => return "npm",
        _ => {}
    }
    if names.contains("bun.lock") || names.contains("bun.lockb") {
        "bun"
    } else if names.contains("pnpm-lock.yaml") {
        "pnpm"
    } else if names.contains("yarn.lock") {
        "yarn"
    } else {
        "npm"
    }
}

pub fn parse_package(content: &str, cwd: &Path, names: &HashSet<&str>) -> Vec<RunAction> {
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(content) else { return Vec::new() };
    let Some(scripts) = manifest.get("scripts").and_then(|scripts| scripts.as_object()) else {
        return Vec::new();
    };
    let runner = package_runner(manifest.get("packageManager").and_then(|m| m.as_str()), names);
    let mut scripts: Vec<(&String, &str)> =
        scripts.iter().filter_map(|(name, script)| Some((name, script.as_str()?))).collect();
    scripts.sort_by(|(a, _), (b, _)| script_priority(a).cmp(&script_priority(b)).then_with(|| a.cmp(b)));
    scripts
        .into_iter()
        .take(40)
        .map(|(name, script)| {
            action(RunActionSource::Package, "package.json", name, &format!("{runner} run {name}"), cwd, Some(script.to_string()))
        })
        .collect()
}

pub fn parse_cargo(content: &str, cwd: &Path) -> Vec<RunAction> {
    let mut actions = Vec::new();
    if content.contains("[package]") {
        actions.push(action(RunActionSource::Cargo, "Cargo.toml", "Run", "cargo run", cwd, None));
    }
    for (name, command) in [("Test", "cargo test"), ("Check", "cargo check"), ("Build", "cargo build")] {
        actions.push(action(RunActionSource::Cargo, "Cargo.toml", name, command, cwd, None));
    }
    actions
}

fn recipe_names(content: &str, pattern: &Regex) -> Vec<String> {
    let skip = Regex::new(r"^\s*(?:#|\.|_)").expect("valid pattern");
    let mut names: Vec<String> = Vec::new();
    for line in content.lines() {
        if skip.is_match(line) {
            continue;
        }
        let Some(name) = pattern.captures(line).and_then(|captures| captures.get(1)) else { continue };
        let name = name.as_str().trim();
        if name.is_empty() || name.contains('%') || name.contains('$') || names.iter().any(|n| n == name) {
            continue;
        }
        names.push(name.to_string());
        if names.len() >= 30 {
            break;
        }
    }
    names
}

pub fn parse_makefile(content: &str, cwd: &Path) -> Vec<RunAction> {
    // `name:` but not `name :=`.
    let pattern = Regex::new(r"^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:([^=]|$)").expect("valid pattern");
    recipe_names(content, &pattern)
        .into_iter()
        .map(|name| action(RunActionSource::Make, "Makefile", &name, &format!("make {name}"), cwd, None))
        .collect()
}

pub fn parse_justfile(content: &str, cwd: &Path) -> Vec<RunAction> {
    let pattern = Regex::new(r"^([A-Za-z][A-Za-z0-9_-]*)[^:=]*:").expect("valid pattern");
    recipe_names(content, &pattern)
        .into_iter()
        .map(|name| action(RunActionSource::Just, "justfile", &name, &format!("just {name}"), cwd, None))
        .collect()
}

fn go_actions(cwd: &Path) -> Vec<RunAction> {
    [("Run", "go run ."), ("Test", "go test ./..."), ("Build", "go build ./...")]
        .into_iter()
        .map(|(name, command)| action(RunActionSource::Go, "go.mod", name, command, cwd, None))
        .collect()
}

pub fn parse_pyproject(content: &str, cwd: &Path) -> Vec<RunAction> {
    let mut actions = Vec::new();
    if let Some(start) = content.find("[project.scripts]") {
        let section = &content[start + "[project.scripts]".len()..];
        let section = section.split("\n[").next().unwrap_or_default();
        let entry = Regex::new(r"^\s*([A-Za-z0-9_.-]+)\s*=").expect("valid pattern");
        for line in section.lines() {
            if let Some(name) = entry.captures(line).and_then(|captures| captures.get(1)) {
                let name = name.as_str();
                actions.push(action(RunActionSource::Python, "pyproject.toml", name, name, cwd, Some("Project script".into())));
            }
        }
    }
    if content.to_lowercase().contains("pytest") {
        actions.push(action(RunActionSource::Python, "pyproject.toml", "Test", "pytest", cwd, None));
    }
    actions
}

fn sort_and_dedupe(actions: Vec<RunAction>) -> Vec<RunAction> {
    let mut seen = HashSet::new();
    let mut actions: Vec<RunAction> = actions
        .into_iter()
        .filter(|action| seen.insert(format!("{}:{}", action.command, action.working_directory.display())))
        .collect();
    actions.sort_by(|a, b| {
        a.source
            .priority()
            .cmp(&b.source.priority())
            .then_with(|| script_priority(&a.name).cmp(&script_priority(&b.name)))
            .then_with(|| a.name.cmp(&b.name))
    });
    actions
}

/// Every run action of the project at `root`: the user's first, then what its manifests define.
pub fn discover(root: &Path, custom: &[CustomRunAction]) -> Vec<RunAction> {
    let manifests: HashMap<&str, String> = MANIFEST_NAMES
        .iter()
        .filter_map(|name| std::fs::read_to_string(root.join(name)).ok().map(|content| (*name, content)))
        .collect();
    let names: HashSet<&str> = manifests.keys().copied().collect();
    let root_text = root.to_string_lossy();
    let mut actions: Vec<RunAction> = custom
        .iter()
        .filter(|custom| custom.workspace_path.as_deref().is_none_or(|path| path == root_text))
        .map(|custom| {
            let cwd = match custom.working_directory.as_deref().map(str::trim) {
                None | Some("") | Some(".") => root.to_path_buf(),
                Some(dir) if Path::new(dir).is_absolute() => PathBuf::from(dir),
                Some(dir) => root.join(dir),
            };
            RunAction { custom_id: Some(custom.id.clone()), ..action(RunActionSource::Custom, "Your actions", &custom.name, &custom.command, &cwd, None) }
        })
        .collect();
    if let Some(team) = manifests.get(workspace::team::TEAM_WORKSPACE_FILE).and_then(|content| workspace::team::parse(content).ok()) {
        actions.extend(team.commands.iter().map(|command| {
            let cwd = workspace::team::resolve_working_directory(root, command.working_directory.as_deref());
            action(RunActionSource::Team, "Team workspace", &command.name, &command.command, &cwd, Some(team.name.clone()))
        }));
    }
    if let Some(content) = manifests.get("package.json") {
        actions.extend(parse_package(content, root, &names));
    }
    if let Some(content) = manifests.get("Cargo.toml") {
        actions.extend(parse_cargo(content, root));
    }
    if let Some(content) = manifests.get("justfile").or(manifests.get("Justfile")) {
        actions.extend(parse_justfile(content, root));
    }
    if let Some(content) = manifests.get("Makefile").or(manifests.get("makefile")) {
        actions.extend(parse_makefile(content, root));
    }
    if manifests.contains_key("go.mod") {
        actions.extend(go_actions(root));
    }
    if let Some(content) = manifests.get("pyproject.toml") {
        actions.extend(parse_pyproject(content, root));
    }
    sort_and_dedupe(actions)
}

#[cfg(not(target_family = "wasm"))]
fn custom_actions_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("run-actions.json"))
}

pub fn load_custom_actions() -> Vec<CustomRunAction> {
    #[cfg(not(target_family = "wasm"))]
    if let Some(json) = custom_actions_path().and_then(|path| std::fs::read_to_string(path).ok()) {
        return serde_json::from_str(&json).unwrap_or_default();
    }
    Vec::new()
}

pub fn save_custom_actions(actions: &[CustomRunAction]) -> anyhow::Result<()> {
    #[cfg(not(target_family = "wasm"))]
    if let Some(path) = custom_actions_path() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(actions)?)?;
    }
    #[cfg(target_family = "wasm")]
    let _ = actions;
    Ok(())
}

pub fn delete_custom_action(id: &str) -> anyhow::Result<()> {
    let mut actions = load_custom_actions();
    actions.retain(|action| action.id != id);
    save_custom_actions(&actions)
}

/// What the menu asks the workbench to show: the New / Edit dialog, or the delete confirmation.
pub enum ManageRequest {
    New,
    /// Manage workspace…: the active project's team workspace settings.
    Workspace,
    Edit(CustomRunAction),
    Delete(CustomRunAction),
}

/// The run menu: actions grouped by where they come from, filtered as you type.
pub struct RunActionsDelegate {
    actions: Vec<RunAction>,
    matches: Vec<(usize, FuzzyMatch)>,
    selected: usize,
    loading: Option<Task<()>>,
    on_run: Rc<dyn Fn(&RunAction, &mut Window, &mut App)>,
    on_manage: Option<Rc<dyn Fn(ManageRequest, &mut Window, &mut App)>>,
    root: PathBuf,
    query: String,
    lenses: Vec<RunAction>,
    /// The "…" submenu (Edit action… / Delete action…) and the row it belongs to.
    options: Option<(usize, OpenMenu)>,
}

impl RunActionsDelegate {
    pub fn new(root: PathBuf, cx: &mut App, on_run: impl Fn(&RunAction, &mut Window, &mut App) + 'static) -> Self {
        let _ = cx;
        let actions = discover(&root, &load_custom_actions());
        Self { actions, matches: Vec::new(), selected: 0, loading: None, on_run: Rc::new(on_run), on_manage: None, root, query: String::new(), lenses: Vec::new(), options: None }
    }

    /// The "Current file" group: run and test lenses of the file in front.
    pub fn with_lenses(mut self, lenses: Vec<RunAction>) -> Self {
        self.actions = with_lens_group(std::mem::take(&mut self.actions), &lenses);
        self.lenses = lenses;
        self
    }

    /// New action…, and Edit action… / Delete action… on the user's own actions.
    pub fn on_manage(mut self, manage: impl Fn(ManageRequest, &mut Window, &mut App) + 'static) -> Self {
        self.on_manage = Some(Rc::new(manage));
        self
    }

    fn manage(&self, request: ManageRequest, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        if let Some(manage) = self.on_manage.clone() {
            manage(request, window, cx);
        }
    }

    fn custom_action(&self, index: usize) -> Option<CustomRunAction> {
        let id = self.actions.get(self.matches.get(index)?.0)?.custom_id.clone()?;
        load_custom_actions().into_iter().find(|action| action.id == id)
    }

    /// Opens (or closes) the "…" submenu of a saved action: Edit action… and Delete action….
    fn toggle_options(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        if self.options.take().is_some_and(|(row, _)| row == index) {
            cx.notify();
            return;
        }
        let picker = cx.entity().downgrade();
        let choose = |edit: bool| {
            let picker = picker.clone();
            move |window: &mut Window, cx: &mut App| {
                picker
                    .update(cx, |picker, cx| {
                        picker.delegate.options = None;
                        let Some(action) = picker.delegate.custom_action(index) else { return };
                        let request = if edit { ManageRequest::Edit(action) } else { ManageRequest::Delete(action) };
                        picker.delegate.manage(request, window, cx);
                        picker.dismiss(window, cx);
                    })
                    .ok();
            }
        };
        let entries = vec![
            MenuItem::new("Edit action…").icon(IconName::Pen).on_select(choose(true)).into(),
            MenuItem::new("Delete action…").icon(IconName::Trash).destructive().on_select(choose(false)).into(),
        ];
        let handle = window.window_handle();
        let menu = OpenMenu::sized("run-action-options", entries, MenuSize::Compact, window.mouse_position(), Anchor::TopLeft, window, cx, move |picker: &mut Picker<Self>, cx| {
            picker.delegate.options = None;
            // Typing goes back to the search field once the submenu closes.
            let focus = picker.focus_handle(cx);
            cx.defer(move |cx| {
                handle.update(cx, |_, window, cx| window.focus(&focus, cx)).ok();
            });
        });
        self.options = Some((index, menu));
        cx.notify();
    }

    fn refresh(&mut self, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        self.actions = with_lens_group(discover(&self.root, &load_custom_actions()), &self.lenses);
        let query = self.query.clone();
        self.update_matches(&query, window, cx);
        cx.notify();
    }
}

impl PickerDelegate for RunActionsDelegate {
    fn placeholder(&self) -> SharedString {
        "Search actions".into()
    }

    fn match_count(&self) -> usize {
        self.matches.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.query = query.to_string();
        self.matches = self
            .actions
            .iter()
            .enumerate()
            .filter_map(|(index, action)| {
                fuzzy_match(query, &format!("{} {} {} {}", action.name, action.command, action.description.as_deref().unwrap_or_default(), action.source_label)).map(|matched| (index, matched))
            })
            .collect();
        if !query.trim().is_empty() {
            self.matches.sort_by(|a, b| b.1.score.cmp(&a.1.score));
        }
        self.selected = 0;
        self.loading = None;
        self.options = None;
    }

    fn section_label(&self, index: usize) -> Option<SharedString> {
        let label = &self.actions[self.matches.get(index)?.0].source_label;
        let previous = index.checked_sub(1).and_then(|previous| self.matches.get(previous));
        match previous {
            Some((previous, _)) if self.actions[*previous].source_label == *label => None,
            _ => Some(label.clone().into()),
        }
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement {
        // `RunActionRow`: the name only, its command (or description) as the tooltip.
        let action = &self.actions[self.matches[index].0];
        let tooltip: SharedString = [Some(action.command.as_str()), action.description.as_deref(), Some(action.name.as_str())]
            .into_iter()
            .flatten()
            .find(|text| !text.is_empty())
            .unwrap_or_default()
            .to_string()
            .into();
        let group = SharedString::from(format!("run-action-row-{index}"));
        let mut row = PaletteRow::new(action.name.clone()).icon(IconName::Play).selected(selected);
        let open = self.options.as_ref().filter(|(row, _)| *row == index).map(|(_, menu)| menu.render());
        if action.custom_id.is_some() && self.on_manage.is_some() {
            // The trailing "…" shows on hover, on the keyboard row and while its submenu is open.
            let shown = selected || open.is_some();
            row = row.accessory(
                div()
                    .when(!shown, |this| this.opacity(0.).group_hover(group.clone(), |style| style.opacity(1.)))
                    .child(
                        Button::icon(SharedString::from(format!("run-action-options-{index}")), IconName::Dots)
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .tooltip(format!("Options for {}", action.name))
                            .on_click(cx.listener(move |picker, _, window, cx| {
                                cx.stop_propagation();
                                picker.delegate.toggle_options(index, window, cx);
                            })),
                    )
                    .children(open),
            );
        }
        div()
            .id(group.clone())
            .group(group)
            .w_full()
            .anchored_tooltip(move || ui::Tooltip::new(tooltip.clone()))
            .child(row)
            .into_any_element()
    }

    /// `DropdownMenuFooter`: Manage workspace…, New action… and Refresh actions under the list.
    fn footer(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Option<AnyElement> {
        let colors = cx.theme().colors.clone();
        let no_root = self.root.as_os_str().is_empty();
        let item = |id: &'static str, icon: Option<IconName>, label: &'static str, disabled: bool| {
            let hover = colors.accent;
            div()
                .id(id)
                .flex()
                .items_center()
                .gap(px(8.))
                .h(metrics::list_row())
                .px(px(8.))
                .rounded(metrics::radius_md())
                .text_size(typography::text_sm())
                .text_color(if disabled { colors.subtle_foreground } else { colors.foreground })
                .when(!disabled, |this| this.hover(move |style| style.bg(hover)))
                // A row without an icon starts its label at the edge, as `DropdownMenuItem` does.
                .children(icon.map(|icon| div().flex_none().size(px(16.)).flex().items_center().justify_center().child(Icon::new(icon).size(IconSize::Small).color(colors.subtle_foreground))))
                .child(label)
        };
        let mut items: Vec<AnyElement> = Vec::new();
        if self.on_manage.is_some() {
            items.push(
                item("run-actions-workspace", None, "Manage workspace…", no_root)
                    .when(!no_root, |this| {
                        this.on_click(cx.listener(|picker, _, window, cx| {
                            picker.delegate.manage(ManageRequest::Workspace, window, cx);
                            picker.dismiss(window, cx);
                        }))
                    })
                    .into_any_element(),
            );
            items.push(
                item("run-actions-new", Some(IconName::Plus), "New action…", false)
                    .on_click(cx.listener(|picker, _, window, cx| {
                        picker.delegate.manage(ManageRequest::New, window, cx);
                        picker.dismiss(window, cx);
                    }))
                    .into_any_element(),
            );
        }
        items.push(
            item("run-actions-refresh", Some(IconName::ArrowClockwise), "Refresh actions", no_root)
                .when(!no_root, |this| this.on_click(cx.listener(|picker, _, window, cx| picker.delegate.refresh(window, cx))))
                .into_any_element(),
        );
        Some(div().flex().flex_col().w_full().children(items).into_any_element())
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some((action_index, _)) = self.matches.get(index) else { return false };
        (self.on_run)(&self.actions[*action_index], window, cx);
        true
    }

    fn empty_message(&self) -> SharedString {
        if self.query.trim().is_empty() { "No actions found".into() } else { "No actions match".into() }
    }

    fn leading_icon(&self) -> IconName {
        IconName::Play
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_scripts_use_the_projects_runner_and_order() {
        let names: HashSet<&str> = ["package.json", "bun.lock"].into_iter().collect();
        let actions = parse_package(r#"{"scripts":{"lint":"x","dev":"vite","build:web":"y","zzz":"z"}}"#, Path::new("/p"), &names);
        let commands: Vec<&str> = actions.iter().map(|a| a.command.as_str()).collect();
        assert_eq!(commands, vec!["bun run dev", "bun run lint", "bun run build:web", "bun run zzz"]);
    }

    #[test]
    fn lenses_form_the_current_file_group_after_your_actions() {
        let lenses = lens_actions(Path::new("/p/src/main.rs"), &[(4, "▶ Run".into()), (9, "▶ Run Test".into())]);
        assert_eq!(lenses[1].description.as_deref(), Some("main.rs:10"));
        assert_eq!((lenses[1].lens, lenses[0].source_label.as_str()), (Some(1), "Current file"));
        let custom = RunAction { custom_id: Some("c".into()), ..action(RunActionSource::Custom, "Your actions", "dev", "make dev", Path::new("/p"), None) };
        let package = action(RunActionSource::Package, "package.json", "build", "bun run build", Path::new("/p"), None);
        let merged = with_lens_group(vec![custom, package], &lenses);
        let labels: Vec<&str> = merged.iter().map(|action| action.source_label.as_str()).collect();
        assert_eq!(labels, ["Your actions", "Current file", "Current file", "package.json"]);
        assert_eq!(with_lens_group(Vec::new(), &lenses).len(), 2);
    }

    #[test]
    fn makefile_and_justfile_recipes() {
        let make = parse_makefile("build:\n\tcc\nVAR := 1\n.PHONY: build\n%.o: %.c\ntest: build\n", Path::new("/p"));
        assert_eq!(make.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), vec!["build", "test"]);
        let just = parse_justfile("# comment\ndev port:\n  run\n_hidden:\n", Path::new("/p"));
        assert_eq!(just.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), vec!["dev"]);
    }

    #[test]
    fn pyproject_scripts_and_pytest() {
        let actions = parse_pyproject("[project.scripts]\nserve = \"app:main\"\n[tool.pytest.ini_options]\n", Path::new("/p"));
        assert_eq!(actions.iter().map(|a| a.command.as_str()).collect::<Vec<_>>(), vec!["serve", "pytest"]);
    }

    #[test]
    fn discovers_this_repository() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let actions = discover(&root, &[]);
        assert!(actions.iter().any(|action| action.command == "cargo test"));
    }
}
