//! Keybindings as Athas defines them (`features/keymaps`): every command with its title and
//! category, the default bindings, the presets (VS Code, JetBrains, …) and the user's own
//! bindings, resolved the same way, then bound to the GPUI actions that implement the commands.

mod legacy_ids;
#[cfg(test)]
mod resolution;
mod vscode_import;
pub mod when;

use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    rc::Rc,
    sync::OnceLock,
};

use gpui::{Action, App, Global, KeyBinding, KeyBindingContextPredicate, Keystroke};
use serde::{Deserialize, Serialize};

pub use legacy_ids::{legacy_command_ids, migrate_legacy_command_id};
pub use vscode_import::{
    ImportFormat, ImportIssue, ImportIssueReason, ImportPlatform, KeybindingsImport, export_payload,
    import_vscode_keybindings, issue_summary, merge_imported, normalize_user_binding,
    parse_keybindings_import, vscode_command,
};

/// The keybinding presets, as `keybindingPreset` names them.
pub const PRESET_IDS: &[&str] = &["none", "vscode", "jetbrains", "sublime", "xcode", "atom", "emacs", "zed"];

/// One binding, in the web workbench's syntax: `cmd+shift+p`, chords split by a space.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keybinding {
    pub key: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<serde_json::Value>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replace_defaults: Option<bool>,
}

fn default_source() -> String {
    "user".into()
}

/// A command as the palette and the Keybindings page list it.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct CommandInfo {
    pub id: String,
    pub title: String,
    pub category: String,
    pub description: Option<String>,
    /// The Nucleo icon's name without `Icon`, such as `Sidebar`.
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub label: String,
    pub description: String,
    pub overrides: Vec<Keybinding>,
    pub disabled_commands: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetFile {
    keybinding_preset_definitions: HashMap<String, Preset>,
}

pub fn commands() -> &'static [CommandInfo] {
    static COMMANDS: OnceLock<Vec<CommandInfo>> = OnceLock::new();
    COMMANDS.get_or_init(|| serde_json::from_str(include_str!("../../../assets/keymaps/commands.json")).unwrap_or_default())
}

pub fn command(id: &str) -> Option<&'static CommandInfo> {
    commands().iter().find(|command| command.id == id)
}

type PaletteText = Box<dyn Fn(&App) -> (String, String)>;

/// Commands a crate defines beyond the catalog (setting toggles, settings pages), with how the
/// palette words them for the current state: "Enable Auto Save" while it is off.
#[derive(Default)]
pub struct DescribedCommands {
    infos: Vec<CommandInfo>,
    palette: HashMap<String, PaletteText>,
}

impl Global for DescribedCommands {}

/// Describes a command the catalog does not list, and how the palette words it right now.
pub fn describe(cx: &mut App, info: CommandInfo, palette: Option<PaletteText>) {
    let described = cx.default_global::<DescribedCommands>();
    described.infos.retain(|existing| existing.id != info.id);
    if let Some(palette) = palette {
        described.palette.insert(info.id.clone(), palette);
    }
    described.infos.push(info);
}

/// A command's title and category, from the catalog or a crate's description.
pub fn command_info(cx: &App, id: &str) -> Option<CommandInfo> {
    command(id).cloned().or_else(|| cx.try_global::<DescribedCommands>()?.infos.iter().find(|info| info.id == id).cloned())
}

/// Every command: the catalog's, then the ones crates described.
pub fn all_commands(cx: &App) -> Vec<CommandInfo> {
    let mut all = commands().to_vec();
    if let Some(described) = cx.try_global::<DescribedCommands>() {
        all.extend(described.infos.iter().filter(|info| command(&info.id).is_none()).cloned());
    }
    all
}

/// How the palette words a command now: its label and description.
pub fn palette_text(cx: &App, id: &str) -> Option<(String, String)> {
    cx.try_global::<DescribedCommands>()?.palette.get(id).map(|text| text(cx))
}

/// The default bindings for this platform (`defaultKeymaps`): the macOS list, or the one for Linux
/// and Windows, where `platformKeymaps` swaps in F3, F11, Alt+M, Cmd+E for the sidebar and more.
pub fn default_bindings() -> &'static [Keybinding] {
    static DEFAULTS: OnceLock<Vec<Keybinding>> = OnceLock::new();
    DEFAULTS.get_or_init(|| serde_json::from_str(default_bindings_json(cfg!(target_os = "macos"))).unwrap_or_default())
}

fn default_bindings_json(mac: bool) -> &'static str {
    if mac { include_str!("../../../assets/keymaps/default-keymaps.json") } else { include_str!("../../../assets/keymaps/default-keymaps-other.json") }
}

pub fn presets() -> &'static HashMap<String, Preset> {
    static PRESETS: OnceLock<HashMap<String, Preset>> = OnceLock::new();
    PRESETS.get_or_init(|| {
        serde_json::from_str::<PresetFile>(include_str!("../../../assets/keymaps/presets.json"))
            .map(|file| file.keybinding_preset_definitions)
            .unwrap_or_default()
    })
}

/// A key in one spelling, so `Cmd+S`, `cmd+s` and `s+cmd` compare equal; `cmd` reads as `ctrl`
/// off macOS, as the web workbench's parser does.
pub fn normalize_key(key: &str) -> String {
    let mac = cfg!(target_os = "macos");
    key.split_whitespace()
        .map(|chord| {
            let lower = chord.to_lowercase();
            let (modifiers, key) = match lower.strip_suffix("++") {
                Some(rest) => (rest, "+".to_string()),
                None => match lower.rsplit_once('+') {
                    Some((modifiers, key)) => (modifiers, key.to_string()),
                    None => ("", lower.clone()),
                },
            };
            let key = match key.as_str() {
                "return" => "enter".to_string(),
                "esc" => "escape".to_string(),
                "del" => "delete".to_string(),
                "arrowup" => "up".to_string(),
                "arrowdown" => "down".to_string(),
                "arrowleft" => "left".to_string(),
                "arrowright" => "right".to_string(),
                " " => "space".to_string(),
                _ => key,
            };
            let mut parts: Vec<&str> = modifiers
                .split('+')
                .filter(|modifier| !modifier.is_empty())
                .map(|modifier| match modifier {
                    "cmd" | "meta" | "mod" if !mac => "ctrl",
                    "meta" | "mod" => "cmd",
                    "control" => "ctrl",
                    "option" => "alt",
                    other => other,
                })
                .collect();
            parts.sort_unstable();
            parts.dedup();
            let mut chord = parts.join("+");
            if !chord.is_empty() {
                chord.push('+');
            }
            chord.push_str(&key);
            chord
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn preset_base(preset: &str) -> Vec<Keybinding> {
    let Some(definition) = presets().get(preset) else {
        return default_bindings().to_vec();
    };
    let overrides: HashMap<&str, &Keybinding> =
        definition.overrides.iter().map(|binding| (binding.command.as_str(), binding)).collect();
    let mut base: Vec<Keybinding> = default_bindings()
        .iter()
        .filter(|binding| !definition.disabled_commands.contains(&binding.command))
        .map(|binding| overrides.get(binding.command.as_str()).map_or(binding, |o| *o).clone())
        .collect();
    for binding in &definition.overrides {
        if !base.iter().any(|existing| existing.command == binding.command) {
            base.push(binding.clone());
        }
    }
    base
}

/// The bindings in effect: the user's first, then the preset's defaults the user did not replace
/// or remove (`services/effective-keymaps.ts`).
pub fn effective_bindings(preset: &str, user: &[Keybinding]) -> Vec<Keybinding> {
    let replaced: Vec<&str> = user
        .iter()
        .filter(|binding| binding.replace_defaults != Some(false))
        .map(|binding| binding.command.as_str())
        .collect();
    let removals: Vec<(&Keybinding, String)> = user
        .iter()
        .filter(|binding| binding.enabled == Some(false) && binding.replace_defaults == Some(false))
        .map(|binding| (binding, normalize_key(&binding.key)))
        .collect();
    let mut bindings = user.to_vec();
    bindings.extend(preset_base(preset).into_iter().filter(|binding| {
        if replaced.contains(&binding.command.as_str()) {
            return false;
        }
        let key = normalize_key(&binding.key);
        !removals.iter().any(|(removal, removal_key)| {
            removal.command == binding.command
                && *removal_key == key
                && (removal.when.is_none() || removal.when == binding.when)
        })
    }));
    bindings
}

/// Each command's binding in effect: its first enabled one.
pub fn shortcuts_by_command(bindings: &[Keybinding]) -> HashMap<String, String> {
    let mut shortcuts = HashMap::new();
    for binding in bindings {
        if binding.enabled != Some(false) && !binding.key.is_empty() {
            shortcuts.entry(binding.command.clone()).or_insert_with(|| binding.key.clone());
        }
    }
    shortcuts
}

/// Each command's binding in effect: its first enabled one, else its first
/// (`getEffectiveKeybindingsByCommand`).
pub fn bindings_by_command(bindings: &[Keybinding]) -> HashMap<String, Keybinding> {
    let mut by_command: HashMap<String, Keybinding> = HashMap::new();
    for binding in bindings {
        match by_command.get(&binding.command) {
            Some(current) if !(current.enabled == Some(false) && binding.enabled != Some(false)) => {}
            _ => {
                by_command.insert(binding.command.clone(), binding.clone());
            }
        }
    }
    by_command
}

/// The commands each command shares a key with: both enabled, on the same key after normalizing,
/// in the same `when` clause (or both in none) (`getKeybindingConflicts`).
pub fn conflicts<'a>(bindings: impl IntoIterator<Item = &'a Keybinding>) -> HashMap<String, Vec<String>> {
    let mut commands_by_slot: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for binding in bindings {
        if binding.enabled == Some(false) || binding.key.is_empty() {
            continue;
        }
        let slot = (normalize_key(&binding.key), binding.when.clone().unwrap_or_default());
        let commands = commands_by_slot.entry(slot).or_default();
        if !commands.contains(&binding.command) {
            commands.push(binding.command.clone());
        }
    }
    let mut conflicts: HashMap<String, Vec<String>> = HashMap::new();
    for commands in commands_by_slot.values().filter(|commands| commands.len() > 1) {
        for command in commands {
            conflicts
                .entry(command.clone())
                .or_default()
                .extend(commands.iter().filter(|other| *other != command).cloned());
        }
    }
    conflicts
}

/// A pressed key in the workbench's syntax, as the keybinding recorder stores it: modifiers in
/// alphabetical order, then the key, `alt+cmd+b`. `None` for a lone modifier.
pub fn format_keystroke(keystroke: &Keystroke) -> Option<String> {
    let key = keystroke.key.to_lowercase();
    if key.is_empty() || matches!(key.as_str(), "shift" | "control" | "alt" | "platform" | "function" | "capslock") {
        return None;
    }
    let modifiers = &keystroke.modifiers;
    let mut parts: Vec<&str> = Vec::new();
    if modifiers.alt {
        parts.push("alt");
    }
    if modifiers.platform && cfg!(target_os = "macos") {
        parts.push("cmd");
    }
    if modifiers.control {
        parts.push("ctrl");
    }
    if modifiers.shift {
        parts.push("shift");
    }
    parts.push(&key);
    Some(parts.join("+"))
}

/// `cmd+shift+p` → `cmd-shift-p`, as GPUI parses keystrokes.
pub fn to_gpui_keystrokes(key: &str) -> Option<String> {
    let chords: Option<Vec<String>> = key
        .split_whitespace()
        .map(|chord| {
            let mut parts: Vec<&str> = chord.split('+').collect();
            // `cmd++` names the plus key.
            let key = if chord.ends_with("++") {
                parts.truncate(parts.len().saturating_sub(2));
                "+".to_string()
            } else {
                parts.pop()?.to_lowercase()
            };
            let key = match key.as_str() {
                "return" => "enter".to_string(),
                "esc" => "escape".to_string(),
                "del" => "delete".to_string(),
                "arrowup" => "up".to_string(),
                "arrowdown" => "down".to_string(),
                "arrowleft" => "left".to_string(),
                "arrowright" => "right".to_string(),
                other => other.to_string(),
            };
            let modifiers: Option<Vec<&str>> = parts
                .iter()
                .map(|modifier| match modifier.to_lowercase().as_str() {
                    "cmd" | "meta" | "mod" => Some(if cfg!(target_os = "macos") { "cmd" } else if cfg!(target_family = "wasm") { "secondary" } else { "ctrl" }),
                    "ctrl" | "control" => Some("ctrl"),
                    "alt" | "option" => Some("alt"),
                    "shift" => Some("shift"),
                    _ => None,
                })
                .collect();
            let mut chord = modifiers?.join("-");
            if !chord.is_empty() {
                chord.push('-');
            }
            chord.push_str(&key);
            Some(chord)
        })
        .collect();
    chords.map(|chords| chords.join(" ")).filter(|chords| !chords.is_empty())
}

/// The GPUI key context predicate a `when` clause is bound in.
pub fn when_to_context(when: Option<&str>) -> String {
    when::to_context_predicate(when)
}

/// How a binding reads beside a command: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere.
pub fn display_key(key: &str) -> String {
    display_chords(key).join(" ")
}

/// Each chord of a binding as it reads, for showing chords apart (`⌘K` then `⌘T`).
pub fn display_chords(key: &str) -> Vec<String> {
    let mac = cfg!(target_os = "macos");
    key.split_whitespace()
        .map(|chord| {
            let parts: Vec<&str> = chord.split('+').collect();
            let (modifiers, key) = parts.split_at(parts.len().saturating_sub(1));
            let key = key.first().copied().unwrap_or_default();
            let key = match key.to_lowercase().as_str() {
                "escape" => if mac { "⎋".into() } else { "Esc".into() },
                "enter" | "return" => if mac { "↩".into() } else { "Enter".into() },
                "backspace" => if mac { "⌫".into() } else { "Backspace".into() },
                "up" => "↑".into(),
                "down" => "↓".into(),
                "left" => "←".into(),
                "right" => "→".into(),
                "space" => "Space".into(),
                "tab" => if mac { "⇥".into() } else { "Tab".into() },
                other if other.len() == 1 => other.to_uppercase(),
                other => {
                    let mut chars = other.chars();
                    chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
                }
            };
            let mut ordered: Vec<&str> = Vec::new();
            for wanted in ["ctrl", "alt", "shift", "cmd"] {
                if modifiers.iter().any(|m| m.eq_ignore_ascii_case(wanted) || (wanted == "cmd" && m.eq_ignore_ascii_case("mod"))) {
                    ordered.push(wanted);
                }
            }
            if mac {
                let symbols: String = ordered
                    .iter()
                    .map(|m| match *m {
                        "ctrl" => "⌃",
                        "alt" => "⌥",
                        "shift" => "⇧",
                        _ => "⌘",
                    })
                    .collect();
                format!("{symbols}{key}")
            } else {
                let mut words: Vec<String> = ordered
                    .iter()
                    .map(|m| match *m {
                        "cmd" | "ctrl" => "Ctrl".to_string(),
                        "alt" => "Alt".to_string(),
                        _ => "Shift".to_string(),
                    })
                    .collect();
                words.dedup();
                words.push(key);
                words.join("+")
            }
        })
        .collect()
}

type ActionBuilder = Box<dyn Fn() -> Box<dyn Action>>;

/// Which GPUI action implements each Athas command id.
#[derive(Default)]
pub struct CommandRegistry {
    actions: HashMap<String, ActionBuilder>,
    order: Vec<String>,
}

impl Global for CommandRegistry {}

impl CommandRegistry {
    /// The action for `id`, or for the command an old palette id became.
    pub fn action(&self, id: &str) -> Option<Box<dyn Action>> {
        match self.actions.get(id) {
            Some(build) => Some(build()),
            None => self.actions.get(&migrate_legacy_command_id(id)).map(|build| build()),
        }
    }

    /// The command's action with a binding's `args`: built from them when the action takes
    /// arguments, else the plain action.
    pub fn action_with_args(&self, id: &str, args: Option<&serde_json::Value>, cx: &App) -> Option<Box<dyn Action>> {
        let action = self.action(id)?;
        match args {
            Some(args) => Some(cx.build_action(action.name(), Some(args.clone())).unwrap_or(action)),
            None => Some(action),
        }
    }

    /// The command ids that run something in this build, in registration order.
    pub fn ids(&self) -> &[String] {
        &self.order
    }

    pub fn contains(&self, id: &str) -> bool {
        self.actions.contains_key(id) || self.actions.contains_key(&migrate_legacy_command_id(id))
    }
}

/// Registers the action that runs the Athas command `id`.
pub fn register<A: Action + Clone>(cx: &mut App, id: &str, action: A) {
    let registry = cx.default_global::<CommandRegistry>();
    if !registry.actions.contains_key(id) {
        registry.order.push(id.to_string());
    }
    registry.actions.insert(id.to_string(), Box::new(move || action.boxed_clone()));
}

/// The user's own bindings (`keymap.json` in the app's data folder).
#[cfg(not(target_family = "wasm"))]
pub fn user_bindings_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("keymap.json"))
}

pub fn load_user_bindings(path: Option<&PathBuf>) -> Vec<Keybinding> {
    path.and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|json| parse_user_bindings(&json).ok())
        .map(|(bindings, _)| bindings)
        .unwrap_or_default()
}

/// A problem with `keymap.json`: an entry Athas cannot bind (by its position in the array), or
/// the file not being JSON (with where the parser stopped).
#[derive(Clone, Debug, PartialEq)]
pub struct KeymapIssue {
    pub entry: Option<usize>,
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

impl std::fmt::Display for KeymapIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match (self.entry, self.line, self.column) {
            (Some(entry), _, _) => write!(f, "Entry {}: {}", entry + 1, self.message),
            (None, Some(line), Some(column)) => write!(f, "Line {line}, column {column}: {}", self.message),
            _ => write!(f, "{}", self.message),
        }
    }
}

/// Reads `keymap.json` as a person edited it (comments and trailing commas are fine): the entries
/// that bind, and what is wrong with the others. Text that is not a JSON array is an error.
pub fn parse_user_bindings(text: &str) -> Result<(Vec<Keybinding>, Vec<KeymapIssue>), KeymapIssue> {
    if text.trim().is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }
    let value = settings::parse_jsonc(text).map_err(|error| {
        let (line, column) = error.downcast_ref::<serde_json::Error>().map_or((None, None), |error| (Some(error.line()), Some(error.column())));
        KeymapIssue { entry: None, message: error.to_string(), line, column }
    })?;
    let Some(entries) = value.as_array() else {
        return Err(KeymapIssue { entry: None, message: "keymap.json must hold an array of keybindings".into(), line: Some(1), column: Some(1) });
    };
    let mut bindings = Vec::new();
    let mut issues = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let issue = |message: String| KeymapIssue { entry: Some(index), message, line: None, column: None };
        let Some(object) = entry.as_object() else {
            issues.push(issue("not an object".into()));
            continue;
        };
        let command_id = migrate_legacy_command_id(object.get("command").and_then(serde_json::Value::as_str).unwrap_or_default().trim());
        let command_id = command_id.as_str();
        let key = object.get("key").and_then(serde_json::Value::as_str).unwrap_or_default().trim();
        if command_id.is_empty() {
            issues.push(issue("needs a \"command\"".into()));
            continue;
        }
        if key.is_empty() {
            issues.push(issue(format!("{command_id} needs a \"key\"")));
            continue;
        }
        if to_gpui_keystrokes(key).is_none() {
            issues.push(issue(format!("{command_id}: \"{key}\" is not a key Athas can bind")));
            continue;
        }
        if object.get("when").is_some_and(|when| !when.is_string()) {
            issues.push(issue(format!("{command_id}: \"when\" must be a string")));
            continue;
        }
        let Ok(mut binding) = serde_json::from_value::<Keybinding>(entry.clone()) else {
            issues.push(issue(format!("{command_id}: a field has the wrong type")));
            continue;
        };
        binding.key = key.to_string();
        binding.command = command_id.to_string();
        binding.when = binding.when.map(|when| when.trim().to_string()).filter(|when| !when.is_empty());
        if command(command_id).is_none() {
            issues.push(issue(format!("unknown command {command_id}")));
        }
        bindings.push(binding);
    }
    Ok((bindings, issues))
}

/// Writes the user's bindings to `path`, through a temporary file so a crash never leaves half a
/// file. Returns the text written.
pub fn save_user_bindings(path: &Path, bindings: &[Keybinding]) -> anyhow::Result<String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(bindings)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, &json)?;
    std::fs::rename(&temporary, path)?;
    Ok(json)
}

/// Bumped whenever `keymap.json` is rewritten; the workbench observes it and binds the keys again.
#[derive(Default)]
pub struct UserKeymapRevision(pub u64);

impl Global for UserKeymapRevision {}

/// Lets observers of [`UserKeymapRevision`] know the user's bindings changed.
pub fn user_bindings_changed(cx: &mut App) {
    cx.default_global::<UserKeymapRevision>().0 += 1;
}

/// The bindings currently applied, for the Keybindings page.
#[derive(Default)]
pub struct ActiveKeymap {
    pub preset: String,
    pub bindings: Vec<Keybinding>,
}

impl Global for ActiveKeymap {}

/// How a preset covers the default bindings (`getKeybindingPresetCoverageReport`): commands it
/// rebinds or turns off, and those it leaves out.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PresetCoverage {
    pub covered: Vec<String>,
    pub missing: Vec<String>,
}

fn default_command_ids() -> Vec<&'static str> {
    let mut ids: Vec<&str> = Vec::new();
    for binding in default_bindings() {
        if !ids.contains(&binding.command.as_str()) {
            ids.push(&binding.command);
        }
    }
    ids
}

pub fn preset_coverage(preset: &str) -> PresetCoverage {
    let Some(definition) = presets().get(preset).filter(|_| preset != "none") else { return PresetCoverage::default() };
    let (covered, missing): (Vec<&str>, Vec<&str>) = default_command_ids().into_iter().partition(|id| {
        definition.disabled_commands.iter().any(|disabled| disabled == id) || definition.overrides.iter().any(|binding| binding.command == *id)
    });
    PresetCoverage {
        covered: covered.into_iter().map(str::to_string).collect(),
        missing: missing.into_iter().map(str::to_string).collect(),
    }
}

/// The default commands a preset binds differently or turns off (`getKeybindingPresetDiffReport`).
pub fn preset_changes(preset: &str) -> Vec<String> {
    let Some(definition) = presets().get(preset).filter(|_| preset != "none") else { return Vec::new() };
    default_command_ids()
        .into_iter()
        .filter(|id| {
            if definition.disabled_commands.iter().any(|disabled| disabled == id) {
                return true;
            }
            let default = default_bindings().iter().find(|binding| binding.command == *id);
            let preset = definition.overrides.iter().find(|binding| binding.command == *id);
            match (default, preset) {
                (Some(default), Some(preset)) => default.key != preset.key || default.when != preset.when || default.args != preset.args,
                _ => false,
            }
        })
        .map(str::to_string)
        .collect()
}

/// Binds the commands this build implements to their keys in effect, each in the key context its
/// `when` clause names.
pub fn bind(cx: &mut App, preset: &str, user: &[Keybinding]) {
    let bindings = effective_bindings(preset, user);
    let mut resolved = Vec::new();
    cx.default_global::<CommandRegistry>();
    {
        let registry = cx.global::<CommandRegistry>();
        for binding in &bindings {
            if binding.enabled == Some(false) {
                continue;
            }
            if let (Some(action), Some(keystrokes)) =
                (registry.action_with_args(&binding.command, binding.args.as_ref(), cx), to_gpui_keystrokes(&binding.key))
            {
                resolved.push((keystrokes, action, when_to_context(binding.when.as_deref())));
            }
        }
    }
    let mut key_bindings = Vec::new();
    for (keystrokes, action, context) in resolved {
        let Ok(predicate) = KeyBindingContextPredicate::parse(&context) else { continue };
        if let Ok(key_binding) = KeyBinding::load(&keystrokes, action, Some(Rc::new(predicate)), false, None, cx) {
            key_bindings.push(key_binding);
        }
    }
    // Earlier bindings win in the web workbench; GPUI prefers later ones, so bind in reverse.
    key_bindings.reverse();
    cx.bind_keys(key_bindings);
    cx.set_global(ActiveKeymap { preset: preset.to_string(), bindings });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cheat sheet answers Shift-?, the key the Help menu prints beside it, on both
    /// platforms' defaults and with a command entry so the palette can find it.
    #[test]
    fn the_cheat_sheet_is_bound_to_shift_question() {
        for json in [default_bindings_json(true), default_bindings_json(false)] {
            let bindings: Vec<Keybinding> = serde_json::from_str(json).unwrap();
            let bound: Vec<&Keybinding> = bindings.iter().filter(|binding| binding.command == "help.shortcuts").collect();
            assert_eq!(bound.len(), 1, "one default binding");
            assert_eq!(normalize_key(&bound[0].key), normalize_key("shift+?"));
            assert!(bound[0].when.as_deref().is_some_and(|when| when.contains("textInputFocus")), "help must stay out of text inputs");
        }
        assert!(command("help.shortcuts").is_some());
    }

    #[test]
    fn the_catalogs_load() {
        assert!(commands().len() > 200);
        assert!(default_bindings().len() > 100);
        assert!(presets().contains_key("vscode"));
        assert!(command("workbench.toggleSidebar").is_some());
    }

    #[test]
    fn linux_and_windows_have_their_own_defaults() {
        let other: Vec<Keybinding> = serde_json::from_str(default_bindings_json(false)).unwrap();
        let has = |key: &str, command: &str| other.iter().any(|binding| binding.key == key && binding.command == command);
        assert!(has("F3", "editor.findNext") && has("F11", "window.toggleFullscreen") && has("alt+m", "window.toggleMenuBar"));
        assert!(has("cmd+e", "workbench.toggleSidebar") && has("cmd+`", "workbench.toggleTerminalAlt"));
        assert!(!has("cmd+ctrl+s", "workbench.toggleSidebar"));
        for binding in &other {
            assert!(to_gpui_keystrokes(&binding.key).is_some(), "{}", binding.key);
        }
    }

    #[test]
    fn keys_translate_for_gpui() {
        let cmd = if cfg!(target_os = "macos") { "cmd" } else { "ctrl" };
        assert_eq!(to_gpui_keystrokes("cmd+shift+p").unwrap(), format!("{cmd}-shift-p"));
        assert_eq!(to_gpui_keystrokes("cmd+k cmd+t").unwrap(), format!("{cmd}-k {cmd}-t"));
        assert_eq!(to_gpui_keystrokes("ctrl+`").unwrap(), "ctrl-`");
        assert_eq!(to_gpui_keystrokes("F5").unwrap(), "f5");
        for binding in default_bindings() {
            assert!(to_gpui_keystrokes(&binding.key).is_some(), "{}", binding.key);
        }
    }

    #[test]
    fn user_bindings_replace_defaults() {
        let user = vec![Keybinding {
            key: "cmd+alt+b".into(),
            command: "workbench.toggleSidebar".into(),
            when: None,
            args: None,
            source: "user".into(),
            enabled: None,
            replace_defaults: None,
        }];
        let shortcuts = shortcuts_by_command(&effective_bindings("none", &user));
        assert_eq!(shortcuts["workbench.toggleSidebar"], "cmd+alt+b");
        assert_eq!(effective_bindings("none", &user).iter().filter(|b| b.command == "workbench.toggleSidebar").count(), 1);
    }

    #[test]
    fn mac_display() {
        if cfg!(target_os = "macos") {
            assert_eq!(display_key("cmd+shift+p"), "⇧⌘P");
            assert_eq!(display_key("cmd+k cmd+t"), "⌘K ⌘T");
        }
    }

    fn binding(key: &str, command: &str, when: Option<&str>, enabled: Option<bool>) -> Keybinding {
        Keybinding {
            key: key.into(),
            command: command.into(),
            when: when.map(str::to_string),
            args: None,
            source: "user".into(),
            enabled,
            replace_defaults: None,
        }
    }

    #[test]
    fn conflicts_share_a_normalized_key_in_one_context() {
        let bindings = [
            Keybinding { source: "default".into(), ..binding("cmd+s", "file.save", None, None) },
            binding("Cmd+S", "editor.format", None, None),
            binding("cmd+s", "file.saveAll", None, Some(false)),
            binding("cmd+k", "terminal.clear", Some("terminalFocus"), None),
            binding("cmd+k", "editor.clear", Some("editorFocus"), None),
            binding("shift+alt+f", "a", None, None),
            binding("alt+shift+F", "b", None, None),
        ];
        let conflicts = conflicts(&bindings);
        assert_eq!(conflicts["file.save"], vec!["editor.format".to_string()]);
        assert_eq!(conflicts["editor.format"], vec!["file.save".to_string()]);
        assert_eq!(conflicts["a"], vec!["b".to_string()]);
        assert!(!conflicts.contains_key("file.saveAll"));
        assert!(!conflicts.contains_key("terminal.clear"));
    }

    #[test]
    fn by_command_prefers_an_enabled_binding() {
        let user = vec![
            binding("cmd+alt+s", "file.save", None, Some(false)),
            Keybinding { replace_defaults: Some(false), ..binding("cmd+k cmd+s", "file.save", None, None) },
        ];
        let by_command = bindings_by_command(&effective_bindings("none", &user));
        assert_eq!(by_command["file.save"].key, "cmd+k cmd+s");
        assert_eq!(by_command["workbench.toggleSidebar"].key, "cmd+b");
        assert!(!by_command.contains_key("missing.command"));
    }

    #[test]
    fn removal_rules_hide_a_default() {
        let user = vec![Keybinding { replace_defaults: Some(false), ..binding("cmd+b", "workbench.toggleSidebar", None, Some(false)) }];
        let shortcuts = shortcuts_by_command(&effective_bindings("none", &user));
        assert_eq!(shortcuts["workbench.toggleSidebar"], "cmd+ctrl+s");
    }

    #[test]
    fn recorded_keystrokes_read_like_bindings() {
        fn format(text: &'static str) -> Option<String> {
            format_keystroke(&Keystroke::parse(text).unwrap())
        }
        assert_eq!(format("ctrl-shift-p").as_deref(), Some("ctrl+shift+p"));
        assert_eq!(format("alt-f5").as_deref(), Some("alt+f5"));
        assert_eq!(format("shift").as_deref(), None);
        assert_eq!(format("space").as_deref(), Some("space"));
        if cfg!(target_os = "macos") {
            assert_eq!(format("cmd-alt-b").as_deref(), Some("alt+cmd+b"));
            assert_eq!(format("cmd-shift-up").as_deref(), Some("cmd+shift+up"));
        }
        // What the recorder writes binds again.
        assert!(to_gpui_keystrokes(&format("ctrl-alt-shift-k").unwrap()).is_some());
    }

    #[test]
    fn an_edited_keymap_binds_what_it_can() {
        let text = r#"[
            // mine
            {"key": "cmd+alt+b", "command": "workbench.toggleSidebar", "when": "editorFocus"},
            {"key": "", "command": "file.save"},
            {"key": "cmd+j"},
            {"key": "cmd+shift+9", "command": "no.such.command"},
            "nope",
            {"key": "cmd+1", "command": "file.save", "args": {"index": 1}},
        ]"#;
        let (bindings, issues) = parse_user_bindings(text).unwrap();
        assert_eq!(bindings.iter().map(|binding| binding.command.as_str()).collect::<Vec<_>>(), vec!["workbench.toggleSidebar", "no.such.command", "file.save"]);
        assert_eq!(bindings[2].args, Some(serde_json::json!({"index": 1})));
        assert_eq!(issues.iter().map(|issue| issue.entry.unwrap()).collect::<Vec<_>>(), vec![1, 2, 3, 4]);
        assert!(issues[2].to_string().contains("unknown command"));
        let error = parse_user_bindings("[\n  {\"key\": \"cmd+b\" \"command\": \"x\"}\n]").unwrap_err();
        assert_eq!(error.line, Some(2));
        assert!(parse_user_bindings("{}").is_err());
        assert_eq!(parse_user_bindings("  ").unwrap().0, Vec::new());
    }

    #[test]
    fn saved_bindings_with_old_palette_ids_bind_their_commands() {
        let (bindings, issues) = parse_user_bindings(r#"[{"key": "cmd+alt+p", "command": "git-push"}]"#).unwrap();
        assert_eq!(bindings[0].command, "git.push");
        assert!(issues.is_empty());
    }

    #[test]
    fn preset_reports() {
        assert_eq!(preset_coverage("none"), PresetCoverage::default());
        assert!(preset_changes("none").is_empty());
        let vscode = preset_coverage("vscode");
        assert!(!vscode.covered.is_empty());
        assert!(preset_changes("jetbrains").len() >= presets()["jetbrains"].disabled_commands.len());
    }

    #[test]
    fn chords_read_apart() {
        if cfg!(target_os = "macos") {
            assert_eq!(display_chords("cmd+k cmd+t"), vec!["⌘K".to_string(), "⌘T".to_string()]);
        }
        assert_eq!(display_chords("f5").len(), 1);
    }

    #[test]
    fn every_default_binding_has_a_context() {
        for binding in default_bindings().iter().chain(presets().values().flat_map(|preset| preset.overrides.iter())) {
            let predicate = when_to_context(binding.when.as_deref());
            KeyBindingContextPredicate::parse(&predicate).unwrap_or_else(|error| panic!("{:?}: {error}", binding.when));
        }
    }

    #[test]
    fn keymap_json_round_trips() {
        let dir = std::env::temp_dir().join(format!("athas-keymap-test-{}", std::process::id()));
        let path = dir.join("keymap.json");
        let bindings = vec![
            binding("cmd+alt+b", "workbench.toggleSidebar", Some("editorFocus"), Some(true)),
            Keybinding { replace_defaults: Some(false), ..binding("cmd+b", "workbench.toggleSidebar", None, Some(false)) },
        ];
        save_user_bindings(&path, &bindings).unwrap();
        assert_eq!(load_user_bindings(Some(&path)), bindings);
        let json = std::fs::read_to_string(&path).unwrap();
        assert!(json.contains("\"replaceDefaults\": false"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
