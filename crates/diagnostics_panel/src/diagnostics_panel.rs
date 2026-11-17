//! The Problems panel (`features/diagnostics`): every diagnostic the language servers published,
//! searched, filtered by severity and source, sorted and grouped by file, severity or not at all,
//! with quick fixes and copy actions on each row; and the references list
//! (`features/references`) that find references fills. Clicking a row asks the workbench to open
//! the place.

mod model;
mod references;

use ui::TooltipExt as _;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    rc::Rc,
};

use gpui::{
    Anchor, AnyElement, App, ClickEvent, ClipboardItem, Context, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, ListAlignment, ListState, MouseButton,
    MouseDownEvent, Pixels, Point, Render, SharedString, Task, Window, div, list, point, prelude::*, px,
};
use lsp_client::{Diagnostic, DiagnosticsStore, LspStore, Severity, lsp};
use multibuffer::{Entry, Multibuffer, OpenHandler, Section, Tone};
use notifications::{NotificationCategory, NotificationKind};
use theme::ActiveTheme;
use ui::{
    AccordionTrigger, Badge, Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, InputAppearance, MenuEntry, MenuItem, OpenMenu, TextInput,
    TextInputEvent, metrics, pane_actions, pane_header, typography,
};

pub use model::{Group, GroupBy, Narrowing, Preferences, Problem, SeverityCounts, SortBy};
pub use references::{ReferencesEvent, ReferencesView};

/// A place to open, with a 1-based line and column (as `Editor::go_to_line` takes them).
#[derive(Clone, Debug, PartialEq)]
pub enum PanelEvent {
    OpenLocation { path: PathBuf, line: usize, column: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Filters {
    pub errors: bool,
    pub warnings: bool,
    /// Info and hints.
    pub infos: bool,
}

impl Default for Filters {
    fn default() -> Self {
        Self { errors: true, warnings: true, infos: true }
    }
}

impl Filters {
    pub fn allows(&self, severity: Severity) -> bool {
        match severity {
            Severity::Error => self.errors,
            Severity::Warning => self.warnings,
            Severity::Info | Severity::Hint => self.infos,
        }
    }
}

/// The diagnostics to show, by file (sorted by path), filtered by severity.
pub fn visible_groups<'a>(store: &'a DiagnosticsStore, filters: Filters) -> Vec<(&'a Path, Vec<&'a Diagnostic>)> {
    store
        .files()
        .map(|(path, diagnostics)| (path, diagnostics.into_iter().filter(|diagnostic| filters.allows(diagnostic.severity)).collect::<Vec<_>>()))
        .filter(|(_, diagnostics)| !diagnostics.is_empty())
        .collect()
}

/// A path relative to the project, for row labels.
pub fn display_path(path: &Path, root: Option<&Path>) -> String {
    root.and_then(|root| path.strip_prefix(root).ok()).unwrap_or(path).to_string_lossy().into_owned()
}

pub(crate) fn severity_icon(severity: Severity, cx: &App) -> Icon {
    let colors = &cx.theme().colors;
    let (icon, color) = match severity {
        Severity::Error => (IconName::WarningCircle, colors.destructive),
        Severity::Warning => (IconName::Warning, colors.warning),
        Severity::Info => (IconName::Info, colors.info),
        Severity::Hint => (IconName::Lightbulb, colors.subtle_foreground),
    };
    // The original's 13px (`size={13}`).
    Icon::new(icon).size(IconSize::Custom(px(13.))).color(color)
}

/// A diagnostic's first line, and the rest joined into one (`splitDiagnosticMessage`).
pub fn split_message(message: &str) -> (String, Option<String>) {
    let mut lines = message.lines().map(str::trim).filter(|line| !line.is_empty());
    let Some(summary) = lines.next() else { return ("Diagnostic".into(), None) };
    let description = lines.collect::<Vec<_>>().join(" ");
    (summary.to_string(), (!description.is_empty()).then_some(description))
}

fn severity_tone(severity: Severity) -> Tone {
    match severity {
        Severity::Error => Tone::Error,
        Severity::Warning => Tone::Warning,
        Severity::Info | Severity::Hint => Tone::Info,
    }
}

/// A list entry in the severity and flat layouts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FlatEntry {
    Header(usize),
    Row(usize),
}

/// The navigator's mode for a saved view choice.
fn navigator_mode(view: model::NavigatorView) -> multibuffer::NavigatorMode {
    match view {
        model::NavigatorView::Flat => multibuffer::NavigatorMode::Flat,
        model::NavigatorView::Tree => multibuffer::NavigatorMode::Tree,
    }
}

/// Where the pane's group, sort, wrap and current-file choices are kept between runs.
#[cfg(not(any(test, target_family = "wasm")))]
fn preferences_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("diagnostics-preferences.json"))
}

#[cfg(any(test, target_family = "wasm"))]
fn preferences_path() -> Option<PathBuf> {
    None
}

pub struct DiagnosticsPanel {
    focus_handle: FocusHandle,
    project_root: Option<PathBuf>,
    narrowing: Narrowing,
    preferences: Preferences,
    search: Entity<TextInput>,
    total: SeverityCounts,
    visible: SeverityCounts,
    problems: Vec<Problem>,
    groups: Vec<Group>,
    /// The problems by file, for the file navigator beside every layout.
    file_groups: Vec<Group>,
    collapsed: HashSet<String>,
    flat: Vec<FlatEntry>,
    flat_list: ListState,
    multibuffer: Multibuffer<Self>,
    open_menu: Option<OpenMenu>,
    /// The problem whose menu is open, and where the menu hangs.
    menu_problem: Option<(Problem, Point<Pixels>)>,
    /// The problem row the keyboard is on (rows are buttons in the original: arrows move between
    /// them, Enter or Space opens one), by key so it survives regrouping.
    cursor: Option<String>,
    quick_fixes: HashMap<String, Vec<lsp::CodeActionOrCommand>>,
    loading_fixes: HashSet<String>,
    tasks: Vec<Task<()>>,
    _subscriptions: Vec<gpui::Subscription>,
}

impl EventEmitter<PanelEvent> for DiagnosticsPanel {}

impl Focusable for DiagnosticsPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl DiagnosticsPanel {
    pub fn new(project_root: Option<PathBuf>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        lsp_client::init(cx);
        let search = cx.new(|cx| TextInput::new(window, cx).placeholder("Search problems...").appearance(InputAppearance::Bare));
        let subscriptions = vec![
            cx.observe_global::<DiagnosticsStore>(|this, cx| {
                this.regroup(cx);
                cx.notify();
            }),
            cx.subscribe(&search, |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Changed(text) => {
                    this.narrowing.query = text.to_string();
                    this.regroup(cx);
                    cx.notify();
                }
                TextInputEvent::Cancelled if !this.narrowing.query.is_empty() => this.set_query("", cx),
                _ => {}
            }),
        ];
        let mut panel = Self {
            focus_handle: cx.focus_handle(),
            project_root,
            narrowing: Narrowing::default(),
            preferences: preferences_path().map(|path| model::read_preferences(&path)).unwrap_or_default(),
            search,
            total: SeverityCounts::default(),
            visible: SeverityCounts::default(),
            problems: Vec::new(),
            groups: Vec::new(),
            file_groups: Vec::new(),
            collapsed: HashSet::new(),
            flat: Vec::new(),
            flat_list: ListState::new(0, ListAlignment::Top, px(800.)),
            multibuffer: Multibuffer::new("problems", true, |this: &mut Self| &mut this.multibuffer, window, cx),
            open_menu: None,
            menu_problem: None,
            cursor: None,
            quick_fixes: HashMap::new(),
            loading_fixes: HashSet::new(),
            tasks: Vec::new(),
            _subscriptions: subscriptions,
        };
        panel.multibuffer.set_navigator_mode(navigator_mode(panel.preferences.file_navigator_view_mode));
        // `selectDiagnosticFile`: picking a file opens its first problem in every layout.
        panel.multibuffer.set_on_select(|this: &mut Self, key, _, cx| {
            let first = this.file_groups.iter().find(|group| group.label == key.as_ref()).and_then(|group| group.items.first().copied());
            if let Some(problem) = first.and_then(|index| this.problems.get(index)).cloned() {
                this.open_problem(&problem, cx);
            }
        });
        panel.regroup(cx);
        panel
    }

    pub fn set_project_root(&mut self, root: Option<PathBuf>, cx: &mut Context<Self>) {
        self.project_root = root;
        self.regroup(cx);
        cx.notify();
    }

    /// The file of the editor in front, for "Only Current File".
    pub fn set_active_file(&mut self, path: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.narrowing.active_file == path {
            return;
        }
        self.narrowing.active_file = path;
        self.regroup(cx);
        cx.notify();
    }

    pub fn filters(&self) -> Filters {
        self.narrowing.filters
    }

    pub fn set_filters(&mut self, filters: Filters, cx: &mut Context<Self>) {
        self.narrowing.filters = filters;
        self.regroup(cx);
        cx.notify();
    }

    pub fn preferences(&self) -> Preferences {
        self.preferences
    }

    pub fn set_preferences(&mut self, preferences: Preferences, cx: &mut Context<Self>) {
        self.preferences = preferences;
        self.save_preferences();
        self.regroup(cx);
        cx.notify();
    }

    pub fn source_filter(&self) -> Option<&str> {
        self.narrowing.source.as_deref()
    }

    pub fn set_source_filter(&mut self, source: Option<String>, cx: &mut Context<Self>) {
        self.narrowing.source = source;
        self.regroup(cx);
        cx.notify();
    }

    pub fn set_query(&mut self, query: &str, cx: &mut Context<Self>) {
        self.search.update(cx, |search, cx| search.set_text(query.to_string(), cx));
        self.narrowing.query = query.to_string();
        self.regroup(cx);
        cx.notify();
    }

    /// The problems listed now, in order.
    pub fn problems(&self) -> &[Problem] {
        &self.problems
    }

    /// `resetFilters`: clears the search, the source and severity filters and every preference
    /// (message wrapping back on too).
    pub fn reset_filters(&mut self, cx: &mut Context<Self>) {
        self.narrowing = Narrowing { active_file: self.narrowing.active_file.take(), ..Narrowing::default() };
        self.preferences = Preferences::default();
        self.multibuffer.set_navigator_mode(navigator_mode(self.preferences.file_navigator_view_mode));
        self.save_preferences();
        self.search.update(cx, |search, cx| search.set_text("", cx));
        self.regroup(cx);
        cx.notify();
    }

    fn save_preferences(&self) {
        if let Some(path) = preferences_path() {
            model::write_preferences(&path, &self.preferences);
        }
    }

    fn update_preferences(&mut self, change: impl FnOnce(&mut Preferences), cx: &mut Context<Self>) {
        change(&mut self.preferences);
        self.save_preferences();
        self.regroup(cx);
        cx.notify();
    }

    fn update_filters(&mut self, change: impl FnOnce(&mut Filters), cx: &mut Context<Self>) {
        change(&mut self.narrowing.filters);
        self.regroup(cx);
        cx.notify();
    }

    fn regroup(&mut self, cx: &App) {
        let (all, total) = model::all_problems(cx.global::<DiagnosticsStore>());
        self.total = total;
        self.problems = model::narrow(&all, &self.narrowing, &self.preferences, usize::MAX);
        self.visible = model::count(&self.problems);
        self.groups = if self.problems.is_empty() { Vec::new() } else { model::group(&self.problems, self.preferences.group_by) };

        self.file_groups = match self.preferences.group_by {
            GroupBy::File => Vec::new(),
            _ if self.problems.is_empty() => Vec::new(),
            _ => model::group(&self.problems, GroupBy::File),
        };
        let file_groups = if self.preferences.group_by == GroupBy::File { &self.groups } else { &self.file_groups };
        let sections = {
            file_groups
                .iter()
                .map(|group| {
                    let counts = model::count(&group.items.iter().map(|index| self.problems[*index].clone()).collect::<Vec<_>>());
                    let tone = severity_tone(counts.highest());
                    let count = group.items.len();
                    let path = group.path.clone().unwrap_or_default();
                    Section {
                        key: group.label.clone().into(),
                        path: model::navigator_path(&path, self.project_root.as_deref()).into(),
                        icon_path: None,
                        tone,
                        metadata: vec![(count.to_string().into(), tone)],
                        trailing: vec![(format!("{count} {}", if count == 1 { "problem" } else { "problems" }).into(), Tone::Subtle)],
                        rows: count,
                    }
                })
                .collect()
        };
        self.multibuffer.set_sections(sections, false);

        self.flat = match self.preferences.group_by {
            GroupBy::File => Vec::new(),
            GroupBy::None => (0..self.problems.len()).map(FlatEntry::Row).collect(),
            GroupBy::Severity => self
                .groups
                .iter()
                .enumerate()
                .flat_map(|(index, group)| {
                    let open = !self.collapsed.contains(&group.id);
                    std::iter::once(FlatEntry::Header(index)).chain(group.items.iter().copied().filter(move |_| open).map(FlatEntry::Row))
                })
                .collect(),
        };
        self.flat_list.reset(self.flat.len());
    }

    /// The problems in the order their rows show, as (problem, section, row in section) for the
    /// file layout or (problem, list entry) for the others.
    fn row_order(&self) -> Vec<(usize, Option<(usize, usize)>, Option<usize>)> {
        if self.preferences.group_by == GroupBy::File {
            self.groups
                .iter()
                .enumerate()
                .flat_map(|(section, group)| group.items.iter().enumerate().map(move |(row, problem)| (*problem, Some((section, row)), None)))
                .collect()
        } else {
            self.flat
                .iter()
                .enumerate()
                .filter_map(|(entry, item)| match item {
                    FlatEntry::Row(problem) => Some((*problem, None, Some(entry))),
                    FlatEntry::Header(_) => None,
                })
                .collect()
        }
    }

    fn move_cursor(&mut self, step: isize, cx: &mut Context<Self>) {
        let order = self.row_order();
        if order.is_empty() {
            return;
        }
        let current = self.cursor.as_ref().and_then(|key| order.iter().position(|(problem, _, _)| self.problems.get(*problem).is_some_and(|p| &p.key() == key)));
        let next = match current {
            Some(at) => (at as isize + step).clamp(0, order.len() as isize - 1) as usize,
            None if step < 0 => order.len() - 1,
            None => 0,
        };
        let (problem, section_row, entry) = order[next];
        self.cursor = self.problems.get(problem).map(Problem::key);
        if let Some((section, row)) = section_row {
            self.multibuffer.reveal_row(section, row);
        }
        if let Some(entry) = entry {
            self.flat_list.scroll_to_reveal_item(entry);
        }
        cx.notify();
    }

    fn key_down(&mut self, event: &gpui::KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        if keystroke.modifiers.modified() {
            return;
        }
        match keystroke.key.as_str() {
            "down" => self.move_cursor(1, cx),
            "up" => self.move_cursor(-1, cx),
            "home" => self.move_cursor(isize::MIN / 2, cx),
            "end" => self.move_cursor(isize::MAX / 2, cx),
            "enter" | "space" => {
                let Some(key) = self.cursor.clone() else { return };
                if let Some(problem) = self.problems.iter().find(|problem| problem.key() == key).cloned() {
                    self.open_problem(&problem, cx);
                }
            }
            _ => return,
        }
        cx.stop_propagation();
    }

    fn open_problem(&self, problem: &Problem, cx: &mut Context<Self>) {
        cx.emit(PanelEvent::OpenLocation { path: problem.path.clone(), line: problem.line(), column: problem.column() });
    }

    fn copy(&self, text: String, message: &'static str, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        notifications::notify(cx, NotificationKind::Success, NotificationCategory::Athas, message, None, None);
    }

    /// Right-click on a problem: quick fixes (asked for on first open), go to, copy, the source
    /// filter and message wrapping.
    fn show_problem_menu(&mut self, problem: Problem, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let key = problem.key();
        if !self.quick_fixes.contains_key(&key) && !self.loading_fixes.contains(&key) {
            self.request_quick_fixes(&problem, window, cx);
        }
        self.menu_problem = Some((problem, position));
        self.rebuild_problem_menu(window, cx);
    }

    fn rebuild_problem_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((problem, position)) = self.menu_problem.clone() else { return };
        let entries = self.problem_menu_entries(&problem, cx);
        self.open_menu = Some(OpenMenu::new("problem-menu", entries, position, Anchor::TopLeft, window, cx, |this: &mut Self, _| {
            this.open_menu = None;
            this.menu_problem = None;
        }));
        cx.notify();
    }

    fn problem_menu_entries(&self, problem: &Problem, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let this = cx.entity().downgrade();
        let key = problem.key();
        let mut entries: Vec<MenuEntry> = Vec::new();
        let fixes = self.quick_fixes.get(&key).cloned().unwrap_or_default();
        if self.loading_fixes.contains(&key) {
            entries.push(MenuItem::new("Loading quick fixes...").icon(IconName::MagicWand).disabled(true).into());
        } else if fixes.is_empty() {
            entries.push(MenuItem::new("No quick fixes available").icon(IconName::MagicWand).disabled(true).into());
        } else {
            for fix in fixes.into_iter().take(8) {
                let (title, disabled) = match &fix {
                    lsp::CodeActionOrCommand::Command(command) => (command.title.clone(), false),
                    lsp::CodeActionOrCommand::CodeAction(action) => (action.title.clone(), action.disabled.is_some()),
                };
                let (this, path) = (this.clone(), problem.path.clone());
                entries.push(
                    MenuItem::new(title)
                        .icon(IconName::MagicWand)
                        .disabled(disabled)
                        .on_select(move |_, cx| {
                            this.update(cx, |this, cx| this.apply_quick_fix(path.clone(), fix.clone(), cx)).ok();
                        })
                        .into(),
                );
            }
        }
        entries.push(MenuEntry::Separator);
        let item = |label: &'static str, icon: Option<IconName>, run: fn(&mut Self, &Problem, &mut Context<Self>)| {
            let (this, problem) = (this.clone(), problem.clone());
            let item = MenuItem::new(label).on_select(move |_, cx| {
                this.update(cx, |this, cx| run(this, &problem, cx)).ok();
            });
            MenuEntry::from(match icon {
                Some(icon) => item.icon(icon),
                None => item,
            })
        };
        entries.push(item("Go to Problem", None, |this, problem, cx| this.open_problem(problem, cx)));
        entries.push(item("Copy Message", Some(IconName::Copy), |this, problem, cx| this.copy(problem.diagnostic.message.clone(), "Diagnostic message copied", cx)));
        entries.push(item("Copy Location", Some(IconName::Copy), |this, problem, cx| this.copy(problem.location(), "Diagnostic location copied", cx)));
        entries.push(item("Copy Full Details", Some(IconName::Copy), |this, problem, cx| this.copy(problem.details(), "Diagnostic details copied", cx)));
        if let Some(source) = problem.diagnostic.source.clone() {
            let this = this.clone();
            let filtered = self.narrowing.source.as_ref().is_some_and(|current| current.eq_ignore_ascii_case(&source));
            let label = if filtered { "Clear Source Filter".to_string() } else { format!("Filter by Source: {source}") };
            entries.push(
                MenuItem::new(label)
                    .icon(IconName::Filter)
                    .on_select(move |_, cx| {
                        let source = (!filtered).then(|| source.clone());
                        this.update(cx, |this, cx| this.set_source_filter(source, cx)).ok();
                    })
                    .into(),
            );
        }
        entries.push(MenuEntry::Separator);
        let wrap = self.preferences.wrap_messages;
        entries.push(
            MenuItem::new(if wrap { "Disable Message Wrap" } else { "Enable Message Wrap" })
                .on_select(move |_, cx| {
                    this.update(cx, |this, cx| this.update_preferences(|preferences| preferences.wrap_messages = !wrap, cx)).ok();
                })
                .into(),
        );
        entries
    }

    fn request_quick_fixes(&mut self, problem: &Problem, window: &mut Window, cx: &mut Context<Self>) {
        let key = problem.key();
        let document = LspStore::try_global(cx).and_then(|store| store.read(cx).document(&problem.path));
        // A file the language server has not opened has no fixes yet; ask again next time.
        let Some(document) = document else { return };
        let request = document.server().request::<lsp::request::CodeActionRequest>(lsp::CodeActionParams {
            text_document: document.identifier(),
            range: problem.diagnostic.range,
            context: lsp::CodeActionContext { diagnostics: vec![problem.diagnostic.raw.clone()], only: None, trigger_kind: Some(lsp::CodeActionTriggerKind::INVOKED) },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        });
        self.loading_fixes.insert(key.clone());
        self.tasks.retain(|task| !task.is_ready());
        self.tasks.push(cx.spawn_in(window, async move |this, cx| {
            let fixes = request.await;
            this.update_in(cx, |this, window, cx| {
                this.loading_fixes.remove(&key);
                if let Ok(fixes) = fixes {
                    this.quick_fixes.insert(key.clone(), fixes.unwrap_or_default());
                }
                if this.menu_problem.as_ref().is_some_and(|(problem, _)| problem.key() == key) {
                    this.rebuild_problem_menu(window, cx);
                }
                cx.notify();
            })
            .ok();
        }));
    }

    fn apply_quick_fix(&mut self, path: PathBuf, fix: lsp::CodeActionOrCommand, cx: &mut Context<Self>) {
        let Some(store) = LspStore::try_global(cx) else { return };
        let Some(server) = store.read(cx).document(&path).map(|document| document.server().clone()) else {
            notifications::notify(cx, NotificationKind::Warning, NotificationCategory::Athas, "Unable to apply action: the file is no longer open", None, None);
            return;
        };
        let resolves = server
            .capabilities()
            .and_then(|capabilities| capabilities.code_action_provider.as_ref())
            .is_some_and(|provider| matches!(provider, lsp::CodeActionProviderCapability::Options(options) if options.resolve_provider == Some(true)));
        self.tasks.push(cx.spawn(async move |_, cx| {
            let (title, edit, command) = match fix {
                lsp::CodeActionOrCommand::Command(command) => (command.title.clone(), None, Some(command)),
                lsp::CodeActionOrCommand::CodeAction(action) => {
                    let action = if action.edit.is_none() && action.command.is_none() && resolves {
                        server.request::<lsp::request::CodeActionResolveRequest>(action.clone()).await.unwrap_or(action)
                    } else {
                        action
                    };
                    (action.title, action.edit, action.command)
                }
            };
            let mut failure = None;
            if let Some(edit) = edit {
                let applied = cx.update(|cx| store.update(cx, |store, cx| store.apply_workspace_edit(&edit, cx)));
                if let Err(error) = applied {
                    failure = Some(format!("{error:#}"));
                }
            }
            if let Some(command) = command {
                let result = server
                    .request::<lsp::request::ExecuteCommand>(lsp::ExecuteCommandParams {
                        command: command.command,
                        arguments: command.arguments.unwrap_or_default(),
                        work_done_progress_params: Default::default(),
                    })
                    .await;
                if let Err(error) = result {
                    failure = Some(format!("{error:#}"));
                }
            }
            cx.update(|cx| match failure {
                None => notifications::notify(cx, NotificationKind::Success, NotificationCategory::Athas, format!("Applied: {title}"), None, None),
                Some(reason) => notifications::notify(cx, NotificationKind::Warning, NotificationCategory::Athas, format!("Unable to apply action: {title}"), Some(reason.into()), None),
            });
        }));
    }

    /// The filter button's menu: group and sort, the severities with their counts, only the
    /// current file, and clearing filters.
    fn show_filter_menu(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.entity().downgrade();
        let mut entries: Vec<MenuEntry> = Vec::new();
        for group_by in GroupBy::ALL {
            let this = this.clone();
            entries.push(
                MenuItem::new(format!("Group by: {}", group_by.label()))
                    .checked(self.preferences.group_by == group_by)
                    .on_select(move |_, cx| {
                        this.update(cx, |this, cx| this.update_preferences(|preferences| preferences.group_by = group_by, cx)).ok();
                    })
                    .into(),
            );
        }
        entries.push(MenuEntry::Separator);
        for sort_by in SortBy::ALL {
            let this = this.clone();
            entries.push(
                MenuItem::new(format!("Sort by: {}", sort_by.label()))
                    .checked(self.preferences.sort_by == sort_by)
                    .on_select(move |_, cx| {
                        this.update(cx, |this, cx| this.update_preferences(|preferences| preferences.sort_by = sort_by, cx)).ok();
                    })
                    .into(),
            );
        }
        entries.push(MenuEntry::Separator);
        let severities: [(&str, usize, usize, bool, fn(&mut Filters)); 3] = [
            ("Errors", self.visible.errors, self.total.errors, self.narrowing.filters.errors, |filters| filters.errors = !filters.errors),
            ("Warnings", self.visible.warnings, self.total.warnings, self.narrowing.filters.warnings, |filters| filters.warnings = !filters.warnings),
            ("Info", self.visible.infos, self.total.infos, self.narrowing.filters.infos, |filters| filters.infos = !filters.infos),
        ];
        for (label, visible, total, checked, toggle) in severities {
            let this = this.clone();
            entries.push(
                MenuItem::new(format!("{label} ({visible}/{total})"))
                    .checked(checked)
                    .on_select(move |_, cx| {
                        this.update(cx, |this, cx| this.update_filters(toggle, cx)).ok();
                    })
                    .into(),
            );
        }
        if self.narrowing.active_file.is_some() {
            let this = this.clone();
            let only = self.preferences.only_current_file;
            entries.push(
                MenuItem::new("Only Current File")
                    .checked(only)
                    .on_select(move |_, cx| {
                        this.update(cx, |this, cx| this.update_preferences(|preferences| preferences.only_current_file = !only, cx)).ok();
                    })
                    .into(),
            );
        }
        if let Some(source) = self.narrowing.source.clone() {
            let this = this.clone();
            entries.push(
                MenuItem::new(format!("Clear Source Filter ({source})"))
                    .on_select(move |_, cx| {
                        this.update(cx, |this, cx| this.set_source_filter(None, cx)).ok();
                    })
                    .into(),
            );
        }
        if self.narrowing.has_filters(&self.preferences) {
            entries.push(
                MenuItem::new("Reset All Filters")
                    .on_select(move |_, cx| {
                        this.update(cx, |this, cx| this.reset_filters(cx)).ok();
                    })
                    .into(),
            );
        }
        self.menu_problem = None;
        self.open_menu = Some(OpenMenu::new("problems-filter-menu", entries, position, Anchor::TopRight, window, cx, |this: &mut Self, _| this.open_menu = None));
        cx.notify();
    }

    fn render_entry(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        match self.multibuffer.entry(index) {
            Some(Entry::Header(section)) => self.render_section_header(section, cx),
            Some(Entry::Row(section, row)) => match self.groups.get(section).and_then(|group| group.items.get(row)) {
                Some(problem) => self.render_problem(*problem, cx),
                None => div().into_any_element(),
            },
            _ => div().into_any_element(),
        }
    }

    fn render_flat_entry(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        match self.flat.get(index).copied() {
            Some(FlatEntry::Header(group)) => self.render_group_header(group, cx),
            Some(FlatEntry::Row(problem)) => self.render_problem(problem, cx),
            None => div().into_any_element(),
        }
    }

    /// A file's header; its name opens the file at its first problem.
    fn render_section_header(&self, section: usize, cx: &mut Context<Self>) -> AnyElement {
        let open = self.groups.get(section).and_then(|group| {
            let problem = self.problems.get(*group.items.first()?)?.clone();
            Some(Rc::new(move |this: &mut Self, _: &mut Window, cx: &mut Context<Self>| this.open_problem(&problem, cx)) as OpenHandler<Self>)
        });
        self.multibuffer.render_header(section, Vec::new(), open, cx)
    }

    /// A severity group's accordion header.
    fn render_group_header(&self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let Some(group) = self.groups.get(index) else { return div().into_any_element() };
        let id = group.id.clone();
        let open = !self.collapsed.contains(&id);
        let this = cx.entity().downgrade();
        let label = div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(6.))
            .children(group.severity.map(|severity| severity_icon(severity, cx)))
            .child(div().min_w_0().truncate().child(group.label.clone()))
            .child(Badge::new(group.items.len().to_string()));
        div()
            .px(px(8.))
            .pt(px(if index == 0 { 8. } else { 6. }))
            .pb(px(2.))
            .child(AccordionTrigger::new(SharedString::from(format!("problems-group-{id}")), label).open(open).on_toggle(move |open, _, cx| {
                let id = id.clone();
                this.update(cx, |this, cx| {
                    if open {
                        this.collapsed.remove(&id);
                    } else {
                        this.collapsed.insert(id);
                    }
                    this.regroup(cx);
                    cx.notify();
                })
                .ok();
            }))
            .into_any_element()
    }

    fn render_problem(&self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let Some(problem) = self.problems.get(index).cloned() else { return div().into_any_element() };
        let colors = cx.theme().colors.clone();
        let diagnostic = &problem.diagnostic;
        let (summary, description) = split_message(&diagnostic.message);
        let wrap = self.preferences.wrap_messages;
        let hover = colors.accent;
        let selected = self.menu_problem.as_ref().is_some_and(|(open, _)| open.key() == problem.key());
        let cursor = self.cursor.as_ref().is_some_and(|key| *key == problem.key());
        let ring = colors.focus_ring;
        let (open, menu) = (problem.clone(), problem.clone());
        let text = |content: String, color| {
            let line = div().w_full().min_w_0().text_color(color);
            if wrap { line.whitespace_normal().child(content) } else { line.truncate().child(content) }
        };
        div()
            .px(px(8.))
            .py(px(1.))
            .child(
                div()
                    .id(SharedString::from(format!("problem-{index}")))
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    // 1px less than the 8/6 padding for the keyboard ring's border.
                    .px(px(7.))
                    .py(px(5.))
                    .rounded(metrics::RADIUS_MD)
                    .text_size(typography::TEXT_SM)
                    .border_1()
                    .border_color(if cursor { ring } else { gpui::transparent_black() })
                    .when(selected, |this| this.bg(colors.accent))
                    .hover(move |style| style.bg(hover))
                    .child(div().pt(px(2.)).flex_none().child(severity_icon(diagnostic.severity, cx)))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(2.))
                            .child(text(summary, colors.foreground))
                            .children(description.map(|description| text(description, colors.muted_foreground)))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(6.))
                                    .text_color(colors.subtle_foreground)
                                    .child(div().min_w_0().truncate().child(model::navigator_path(&problem.path, self.project_root.as_deref())))
                                    .children(diagnostic.source.clone().map(|source| div().flex_none().child(source)))
                                    .children(diagnostic.code.clone().map(|code| div().flex_none().font_family(typography::MONO_FONT).child(code))),
                            ),
                    )
                    .child(div().flex_none().text_color(colors.subtle_foreground).child(format!("{}:{}", problem.line(), problem.column())))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.cursor = Some(open.key());
                        window.focus(&this.focus_handle, cx);
                        this.open_problem(&open, cx)
                    }))
                    .on_mouse_down(
                        MouseButton::Right,
                        cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                            cx.stop_propagation();
                            this.show_problem_menu(menu.clone(), event.position, window, cx);
                        }),
                    ),
            )
            .into_any_element()
    }

    fn render_toolbar(&self, cx: &mut Context<Self>) -> gpui::Div {
        let colors = cx.theme().colors.clone();
        let filter_count = self.narrowing.active_filter_count(&self.preferences);
        let has_filters = self.narrowing.has_filters(&self.preferences);
        let visible = self.problems.len();
        let label = if has_filters {
            format!("{visible} of {} problems", self.total.total())
        } else {
            format!("{visible} {}", if visible == 1 { "problem" } else { "problems" })
        };
        let summary = self.visible.summary();
        let search = div()
            .flex()
            .flex_1()
            .min_w_0()
            .h(px(24.))
            .items_center()
            .gap(px(8.))
            .child(Icon::new(IconName::Search).size(IconSize::Medium).color(colors.subtle_foreground))
            .child(div().flex_1().min_w_0().child(self.search.clone()))
            .when(!self.narrowing.query.is_empty(), |this| {
                this.child(
                    Button::icon("problems-clear-search", IconName::X)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .tooltip("Clear problem search")
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.set_query("", cx);
                            let handle = this.search.focus_handle(cx);
                            window.focus(&handle, cx);
                        })),
                )
            });
        let mut actions = pane_actions()
            .child(
                Button::icon("problems-filter", IconName::Filter)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .active(filter_count > 0)
                    .tooltip(if filter_count > 0 { format!("Filters ({filter_count})") } else { "Filter problems".into() })
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let position = event.position();
                        this.show_filter_menu(point(position.x, position.y + px(8.)), window, cx)
                    })),
            )
            .child(div().id("problems-result").when(!summary.is_empty(), |this| this.anchored_tooltip({ let tip: SharedString = (summary.clone()).into(); move || ui::Tooltip::new(tip.clone()) })).child(Badge::new(label).truncate()));
        if !self.multibuffer.sections().is_empty() {
            actions = actions.child(self.multibuffer.render_toggle(false, cx));
        }
        pane_header(cx).h(metrics::CONTENT_HEADER).px(metrics::CHROME_PADDING_INLINE).border_b_1().border_color(cx.theme().colors.divider).child(search).child(actions)
    }
}

impl Render for DiagnosticsPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // The navigator's Flat list / File tree buttons set its mode; keep the choice.
        let view = match self.multibuffer.navigator_mode() {
            multibuffer::NavigatorMode::Flat => model::NavigatorView::Flat,
            multibuffer::NavigatorMode::Tree => model::NavigatorView::Tree,
        };
        if view != self.preferences.file_navigator_view_mode {
            self.preferences.file_navigator_view_mode = view;
            self.save_preferences();
        }
        let header = self.render_toolbar(cx);
        let body = if self.total.total() == 0 {
            div()
                .flex()
                .flex_1()
                .justify_center()
                .py(px(24.))
                .child(EmptyState::new("No problems detected").icon(IconName::Check).message("Diagnostics will appear here when a language service finds an issue."))
                .into_any_element()
        } else if self.problems.is_empty() {
            let reset = self.narrowing.has_filters(&self.preferences).then(|| {
                Button::new("problems-reset", "Reset filters").size(ButtonSize::Small).on_click(cx.listener(|this, _, _, cx| this.reset_filters(cx)))
            });
            let mut empty = EmptyState::new("No problems match the current filters");
            if let Some(reset) = reset {
                empty = empty.action(reset);
            }
            div().flex().flex_1().items_center().justify_center().child(empty).into_any_element()
        } else if self.preferences.group_by == GroupBy::File {
            let state = self.multibuffer.list().clone();
            let list = ui::with_scrollbar(
                list(state.clone(), cx.processor(|this, index: usize, _window, cx| this.render_entry(index, cx))).size_full(),
                ui::Scrollbar::list("problems-scrollbar", &state),
            )
            .size_full()
            .into_any_element();
            let sticky = self.multibuffer.sticky_section().map(|section| self.render_section_header(section, cx));
            self.multibuffer.render(None, list, sticky, None, cx)
        } else {
            let list = ui::with_scrollbar(
                list(self.flat_list.clone(), cx.processor(|this, index: usize, _window, cx| this.render_flat_entry(index, cx))).size_full(),
                ui::Scrollbar::list("problems-scrollbar", &self.flat_list),
            )
            .size_full()
            .into_any_element();
            self.multibuffer.render(None, list, None, None, cx)
        };

        div()
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::key_down))
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(cx.theme().colors.background)
            .child(header)
            .child(div().flex().flex_col().flex_1().min_h_0().child(body))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

#[cfg(test)]
mod tests {
    use lsp_client::lsp::{self, DiagnosticSeverity, Position, PublishDiagnosticsParams, Range, Url};

    use super::*;

    fn publish(store: &mut DiagnosticsStore, path: &str, severities: &[DiagnosticSeverity]) {
        let diagnostics = severities
            .iter()
            .enumerate()
            .map(|(line, severity)| lsp::Diagnostic {
                range: Range::new(Position::new(line as u32, 0), Position::new(line as u32, 1)),
                severity: Some(*severity),
                message: format!("problem {line}"),
                ..Default::default()
            })
            .collect();
        store.publish(1, PublishDiagnosticsParams { uri: Url::from_file_path(path).unwrap(), diagnostics, version: None });
    }

    #[test]
    fn splits_messages_like_athas() {
        assert_eq!(split_message("  expected `u32`\n\n  found `i64`\r\n  here "), ("expected `u32`".into(), Some("found `i64` here".into())));
        assert_eq!(split_message("one line"), ("one line".into(), None));
        assert_eq!(split_message(" \n "), ("Diagnostic".into(), None));
    }

    #[test]
    fn groups_by_file_and_filters_by_severity() {
        let mut store = DiagnosticsStore::default();
        publish(&mut store, "/p/b.rs", &[DiagnosticSeverity::ERROR, DiagnosticSeverity::HINT]);
        publish(&mut store, "/p/a.rs", &[DiagnosticSeverity::WARNING]);
        let groups = visible_groups(&store, Filters::default());
        assert_eq!(groups.iter().map(|(path, items)| (path.to_str().unwrap(), items.len())).collect::<Vec<_>>(), [("/p/a.rs", 1), ("/p/b.rs", 2)]);
        let errors_only = visible_groups(&store, Filters { errors: true, warnings: false, infos: false });
        assert_eq!(errors_only.len(), 1);
        assert_eq!(errors_only[0].1[0].message, "problem 0");
        assert_eq!(display_path(Path::new("/p/src/a.rs"), Some(Path::new("/p"))), "src/a.rs");
        assert_eq!(display_path(Path::new("/q/a.rs"), Some(Path::new("/p"))), "/q/a.rs");
    }

    #[gpui::test]
    fn the_panel_searches_filters_and_groups(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            use gpui::BorrowAppContext as _;
            theme::init(cx, None, theme::Appearance::Dark, false);
            ui::init(cx);
            lsp_client::init(cx);
            cx.update_global::<DiagnosticsStore, _>(|store, _| {
                publish(store, "/p/b.rs", &[DiagnosticSeverity::ERROR, DiagnosticSeverity::WARNING]);
                publish(store, "/p/a.rs", &[DiagnosticSeverity::HINT]);
            });
        });
        let (panel, cx) = cx.add_window_view(|window, cx| DiagnosticsPanel::new(Some("/p".into()), window, cx));
        panel.update(cx, |panel, cx| {
            assert_eq!(panel.problems().len(), 3);
            panel.set_query("problem 1", cx);
            assert_eq!(panel.problems().len(), 1);
            panel.set_query("", cx);
            panel.set_preferences(Preferences { group_by: GroupBy::Severity, ..Preferences::default() }, cx);
            assert_eq!(panel.groups.iter().map(|group| group.label.as_str()).collect::<Vec<_>>(), ["Errors", "Warnings", "Info"]);
            assert_eq!(panel.flat.len(), 6);
            let files: Vec<String> = panel.multibuffer.sections().iter().map(|section| section.path.to_string()).collect();
            assert_eq!(files.len(), 2);
            assert!(files.contains(&"b.rs".to_string()));
            assert_eq!(panel.file_groups.len(), 2);
            panel.collapsed.insert("severity-error".into());
            panel.regroup(cx);
            assert_eq!(panel.flat.len(), 5);
            panel.set_active_file(Some("/p/a.rs".into()), cx);
            panel.set_preferences(Preferences { only_current_file: true, ..panel.preferences() }, cx);
            assert_eq!(panel.problems().len(), 1);
            panel.reset_filters(cx);
            assert_eq!(panel.problems().len(), 3);
            assert_eq!(panel.preferences(), Preferences::default());
        });
        cx.run_until_parked();
    }
}
