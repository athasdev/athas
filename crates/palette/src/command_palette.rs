use std::path::PathBuf;

use gpui::{Action, AnyElement, App, Context, Global, SharedString, Window, prelude::*};
use ui::{Button, ButtonSize, ButtonVariant, IconName};

use crate::{FuzzyMatch, PaletteRow, Picker, PickerDelegate, fuzzy_match};

/// A command the palette offers: what it runs and how it reads.
pub struct CommandEntry {
    /// The command id, which the recent list remembers.
    pub id: SharedString,
    pub label: SharedString,
    pub category: SharedString,
    pub description: SharedString,
    pub icon: IconName,
    pub action: Box<dyn Action>,
    pub shortcut: Option<SharedString>,
}

/// A setting the palette offers while searching, opened on its Settings page.
pub struct SettingEntry {
    pub entry: CommandEntry,
    /// Words that find the setting besides its label (its section, its key).
    pub keywords: Vec<SharedString>,
}

/// The palette's filter tabs (`commandPaletteFilters`).
const FILTERS: &[(&str, &str)] = &[
    ("all", "All"),
    ("files", "Files"),
    ("navigation", "Navigation"),
    ("git", "Git"),
    ("github", "GitHub"),
    ("settings", "Settings"),
    ("extensions", "Integrations"),
];

/// The filter tab a command's category is under (`getCommandPaletteFilter`).
pub fn category_filter(category: &str) -> &'static str {
    match category {
        "File" | "Markdown" | "Editor" | "Language" => "files",
        "Navigation" | "View" | "Window" | "Terminal" => "navigation",
        "Git" => "git",
        "GitHub" => "github",
        "Settings" | "Theme" | "Features" => "settings",
        _ => "extensions",
    }
}

/// How many commands the recent list remembers (`MAX_NUM_REMEMBERED_ACTIONS`).
const MAX_RECENT: usize = 10;

/// The commands last run from the palette, most recent first, kept between launches.
#[derive(Default)]
pub struct RecentCommands {
    ids: Vec<String>,
    path: Option<PathBuf>,
}

impl Global for RecentCommands {}

impl RecentCommands {
    pub fn load(path: Option<PathBuf>) -> Self {
        let ids = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default();
        Self { ids: migrate_ids(ids), path }
    }

    pub fn ids(&self) -> &[String] {
        &self.ids
    }

    /// Forgets every remembered command (`clearStack`).
    pub fn clear(&mut self) {
        self.ids.clear();
        if let Some(path) = &self.path {
            std::fs::remove_file(path).ok();
        }
    }

    /// Moves `id` to the front, keeping the ten most recent (`pushAction`).
    pub fn push(&mut self, id: &str) {
        self.ids.retain(|existing| existing != id);
        self.ids.insert(0, id.to_string());
        self.ids.truncate(MAX_RECENT);
        if let Some(path) = &self.path {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            if let Ok(json) = serde_json::to_string(&self.ids) {
                std::fs::write(path, json).ok();
            }
        }
    }
}

/// Old palette ids become the commands they name, once each, in order.
fn migrate_ids(ids: Vec<String>) -> Vec<String> {
    let mut migrated: Vec<String> = Vec::with_capacity(ids.len());
    for id in ids.iter().map(|id| keymap::migrate_legacy_command_id(id)) {
        if !migrated.contains(&id) {
            migrated.push(id);
        }
    }
    migrated
}

/// Where the recent commands are kept.
#[cfg(not(target_family = "wasm"))]
pub fn recent_commands_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("command-history.json"))
}

#[cfg(target_family = "wasm")]
pub fn recent_commands_path() -> Option<PathBuf> {
    None
}

fn recent_ids(cx: &mut App) -> Vec<String> {
    if !cx.has_global::<RecentCommands>() {
        cx.set_global(RecentCommands::load(recent_commands_path()));
    }
    cx.global::<RecentCommands>().ids().to_vec()
}

#[derive(Clone, Copy, PartialEq)]
enum Row {
    Command(usize),
    Setting(usize),
}

#[derive(Clone, PartialEq)]
enum Section {
    Recent,
    All,
    Results,
    Filter(&'static str),
}

/// The command palette (`features/command-palette`): every command with its shortcut, the ones
/// run lately first, under filter tabs, and settings that match a search.
pub struct CommandPaletteDelegate {
    entries: Vec<CommandEntry>,
    settings: Vec<SettingEntry>,
    recent: Vec<String>,
    filter: usize,
    matches: Vec<(Row, FuzzyMatch, Section)>,
    selected: usize,
}

impl CommandPaletteDelegate {
    pub fn new(mut entries: Vec<CommandEntry>, cx: &mut App) -> Self {
        let rank = |id: &str| {
            crate::COMMAND_ORDER
                .iter()
                .position(|slot| *slot == id || (slot.ends_with(".*") && id.starts_with(&slot[..slot.len() - 1])))
                .unwrap_or(usize::MAX)
        };
        entries.sort_by_key(|entry| rank(&entry.id));
        let recent = recent_ids(cx);
        Self { entries, settings: Vec::new(), recent, filter: 0, matches: Vec::new(), selected: 0 }
    }

    /// Settings the palette lists while the query has two letters or more.
    pub fn with_settings(mut self, settings: Vec<SettingEntry>) -> Self {
        self.settings = settings;
        self
    }

    fn entry(&self, row: Row) -> &CommandEntry {
        match row {
            Row::Command(index) => &self.entries[index],
            Row::Setting(index) => &self.settings[index].entry,
        }
    }
}

impl PickerDelegate for CommandPaletteDelegate {
    fn placeholder(&self) -> SharedString {
        "Search commands and actions...".into()
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
        let filter = FILTERS[self.filter].0;
        let query = query.trim();
        let querying = !query.is_empty();
        let mut matches: Vec<(Row, FuzzyMatch)> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| filter == "all" || category_filter(&entry.category) == filter)
            .filter_map(|(index, entry)| {
                let title = fuzzy_match(query, &entry.label);
                let rest = fuzzy_match(query, &format!("{} {}", entry.category, entry.description));
                match (title, rest) {
                    (Some(title), _) => Some((Row::Command(index), title)),
                    (None, Some(rest)) => Some((Row::Command(index), FuzzyMatch { score: rest.score - 40, positions: Vec::new() })),
                    _ => None,
                }
            })
            .collect();
        if querying {
            matches.sort_by(|a, b| b.1.score.cmp(&a.1.score));
        }
        // The recent commands come first, most recent first.
        let recent_rank = |row: &Row| match row {
            Row::Command(index) => self.recent.iter().position(|id| *id == self.entries[*index].id.as_ref()),
            Row::Setting(_) => None,
        };
        let (mut recent, rest): (Vec<_>, Vec<_>) = matches.into_iter().partition(|(row, _)| recent_rank(row).is_some());
        recent.sort_by_key(|(row, _)| recent_rank(row));
        let recent_count = recent.len();
        let mut ordered: Vec<(Row, FuzzyMatch)> = recent.into_iter().chain(rest).collect();
        if querying && query.chars().count() >= 2 && (filter == "all" || filter == "settings") {
            let mut settings: Vec<(Row, FuzzyMatch)> = self
                .settings
                .iter()
                .enumerate()
                .filter_map(|(index, setting)| {
                    let label = fuzzy_match(query, &setting.entry.label);
                    let keywords = setting.keywords.iter().filter_map(|keyword| fuzzy_match(query, keyword)).map(|found| found.score).max();
                    match (label, keywords) {
                        (Some(label), _) => Some((Row::Setting(index), label)),
                        (None, Some(score)) => Some((Row::Setting(index), FuzzyMatch { score: score - 40, positions: Vec::new() })),
                        _ => None,
                    }
                })
                .collect();
            settings.sort_by(|a, b| b.1.score.cmp(&a.1.score));
            settings.truncate(12);
            ordered.extend(settings);
        }
        let label = FILTERS[self.filter].0;
        self.matches = ordered
            .into_iter()
            .enumerate()
            .map(|(position, (row, matched))| {
                let section = if querying {
                    Section::Results
                } else if label != "all" {
                    Section::Filter(label)
                } else if position < recent_count {
                    Section::Recent
                } else {
                    Section::All
                };
                (row, matched, section)
            })
            .collect();
        self.selected = 0;
    }

    fn section_label(&self, index: usize) -> Option<SharedString> {
        let (_, _, section) = self.matches.get(index)?;
        let previous = index.checked_sub(1).and_then(|previous| self.matches.get(previous));
        if previous.is_some_and(|(_, _, previous)| previous == section) {
            return None;
        }
        Some(match section {
            Section::Recent => "Recent".into(),
            Section::All => "All commands".into(),
            Section::Results => "Results".into(),
            Section::Filter(id) => FILTERS.iter().find(|(filter, _)| filter == id).map_or(*id, |(_, label)| label).into(),
        })
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, _: &mut Context<Picker<Self>>) -> AnyElement {
        let (row, matched, _) = &self.matches[index];
        let entry = self.entry(*row);
        PaletteRow::new(entry.label.clone())
            .icon(entry.icon)
            .description(format!("{} · {}", entry.category, entry.description))
            .shortcut(entry.shortcut.clone().or_else(|| selected.then(|| "Return".into())))
            .highlights(matched.positions.clone())
            .selected(selected)
            .into_any_element()
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some((row, _, _)) = self.matches.get(index) else { return false };
        let entry = self.entry(*row);
        if let Row::Command(_) = row {
            let id = entry.id.to_string();
            if !cx.has_global::<RecentCommands>() {
                cx.set_global(RecentCommands::load(recent_commands_path()));
            }
            cx.global_mut::<RecentCommands>().push(&id);
        }
        window.dispatch_action(entry.action.boxed_clone(), cx);
        true
    }

    fn empty_message(&self) -> SharedString {
        "No commands found".into()
    }

    fn tabs(&self) -> Vec<(SharedString, bool)> {
        FILTERS.iter().enumerate().map(|(index, (_, label))| (SharedString::from(*label), self.filter == index)).collect()
    }

    fn select_tab(&mut self, index: usize, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.filter = index.min(FILTERS.len() - 1);
    }

    fn leading_icon(&self) -> IconName {
        IconName::Search
    }

    fn header_actions(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Vec<AnyElement> {
        if cx.has_global::<settings::SettingsStore>() && !settings::get(cx).core_features.persistent_commands {
            return Vec::new();
        }
        vec![
            Button::icon("palette-clear-recent", IconName::ArrowClockwise)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip("Clear persisted actions")
                .on_click(cx.listener(|picker, _, window, cx| {
                    if !cx.has_global::<RecentCommands>() {
                        cx.set_global(RecentCommands::load(recent_commands_path()));
                    }
                    cx.global_mut::<RecentCommands>().clear();
                    picker.delegate.recent.clear();
                    picker.refresh_matches(window, cx);
                }))
                .into_any_element(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_commands_drop_old_palette_ids() {
        let ids = migrate_ids(vec!["git-push".into(), "git.push".into(), "open-settings-tab-keyboard".into(), "file.save".into()]);
        assert_eq!(ids, ["git.push", "preferences.openSettingsTab.keyboard", "file.save"]);
    }

    #[test]
    fn categories_fall_under_the_web_filters() {
        assert_eq!(category_filter("Editor"), "files");
        assert_eq!(category_filter("Terminal"), "navigation");
        assert_eq!(category_filter("Theme"), "settings");
        assert_eq!(category_filter("AI"), "extensions");
        assert_eq!(category_filter("Something New"), "extensions");
    }

    #[test]
    fn recent_commands_keep_ten_most_recent_first() {
        let dir = std::env::temp_dir().join(format!("athas-palette-recent-{}", std::process::id()));
        let path = dir.join("command-history.json");
        let mut recent = RecentCommands::load(Some(path.clone()));
        for index in 0..12 {
            recent.push(&format!("command.{index}"));
        }
        recent.push("command.5");
        assert_eq!(recent.ids().len(), 10);
        assert_eq!(recent.ids()[0], "command.5");
        assert_eq!(recent.ids()[1], "command.11");
        assert_eq!(RecentCommands::load(Some(path)).ids(), recent.ids());
        std::fs::remove_dir_all(&dir).ok();
    }
}
