//! The settings commands (`keymaps/commands/settings-commands.tsx`): open `settings.json`, open a
//! Settings page, flip a setting from the palette. Also watches `settings.json` and `keymap.json`
//! so saving either in the editor applies it at once, and reports what in them Athas refused.

use std::{path::PathBuf, time::Duration};

use gpui::{Action, App, Global, SharedString, actions};
use notifications::NotificationKind;
use serde_json::Value;
use settings::{SETTING_DEFS, SETTINGS_PAGES};

use crate::{notify, page_title};

actions!(
    settings_ui,
    [
        /// Opens `settings.json` in the editor.
        OpenSettingsJson,
        /// Opens `keymap.json` in the editor.
        OpenKeymapJson,
        /// Opens Settings on the Keybindings page.
        OpenKeyboardShortcuts,
        /// Opens Settings > Team > Workspaces on the active project.
        ManageWorkspaces,
        /// Asks for a folder and adds it as a team workspace.
        AddWorkspace,
    ]
);

/// Flips a boolean setting (`settingToggleCommand`, `coreFeatureToggleCommand`).
#[derive(Clone, Debug, PartialEq, Action)]
#[action(namespace = settings_ui, no_json)]
pub struct ToggleSetting {
    pub key: &'static str,
}

/// Opens Settings on a page, searching for a setting when `query` is not empty.
#[derive(Clone, Debug, PartialEq, Action)]
#[action(namespace = settings_ui, no_json)]
pub struct OpenSettingsAt {
    pub page: &'static str,
    pub query: SharedString,
}

/// A setting the palette flips, and how it words the command while the setting is on or off.
struct Toggle {
    id: &'static str,
    key: &'static str,
    title: &'static str,
    category: &'static str,
    icon: &'static str,
    /// Label and description while on, then while off.
    on: (&'static str, &'static str),
    off: (&'static str, &'static str),
}

const TOGGLES: &[Toggle] = &[
    Toggle { id: "settings.toggleAutoSave", key: "autoSave", title: "General: Toggle Auto Save", category: "Settings", icon: "Save", on: ("General: Disable Auto Save", "Disable automatic file saving"), off: ("General: Enable Auto Save", "Automatically save files when editing") },
    Toggle { id: "settings.toggleAutoDetectLanguage", key: "autoDetectLanguage", title: "Language: Toggle Auto-detect Language", category: "Language", icon: "Code", on: ("Language: Disable Auto-detect Language", "Manually set language for files"), off: ("Language: Enable Auto-detect Language", "Automatically detect file language from integration") },
    Toggle { id: "settings.toggleFormatOnSave", key: "formatOnSave", title: "Language: Toggle Format on Save", category: "Language", icon: "Code", on: ("Language: Disable Format on Save", "Disable automatic formatting on save"), off: ("Language: Enable Format on Save", "Automatically format code when saving") },
    Toggle { id: "settings.toggleAutoCompletion", key: "autoCompletion", title: "Language: Toggle Auto Completion", category: "Language", icon: "Code", on: ("Language: Disable Auto Completion", "Disable completion suggestions"), off: ("Language: Enable Auto Completion", "Show completion suggestions while typing") },
    Toggle { id: "settings.toggleParameterHints", key: "parameterHints", title: "Language: Toggle Parameter Hints", category: "Language", icon: "Code", on: ("Language: Disable Parameter Hints", "Disable function parameter hints"), off: ("Language: Enable Parameter Hints", "Show function parameter hints") },
    Toggle { id: "settings.toggleInlayHints", key: "inlayHints", title: "Language: Toggle Inlay Hints", category: "Language", icon: "Code", on: ("Language: Disable Inlay Hints", "Hide inline type and parameter hints from language servers"), off: ("Language: Enable Inlay Hints", "Show inline type and parameter hints from language servers") },
    Toggle { id: "settings.toggleCodeLens", key: "codeLens", title: "Language: Toggle Code Lens", category: "Language", icon: "Code", on: ("Language: Disable Code Lens", "Hide inline code actions above symbols"), off: ("Language: Enable Code Lens", "Show inline code actions above symbols") },
    Toggle { id: "settings.toggleSemanticTokens", key: "semanticTokens", title: "Language: Toggle Semantic Tokens", category: "Language", icon: "Code", on: ("Language: Disable Semantic Tokens", "Disable language server semantic highlighting"), off: ("Language: Enable Semantic Tokens", "Use language server semantic highlighting") },
    Toggle { id: "settings.toggleAiCompletion", key: "aiCompletion", title: "AI: Toggle AI Completion", category: "AI", icon: "Sparkle", on: ("AI: Disable AI Completion", "Disable AI-powered code completion"), off: ("AI: Enable AI Completion", "Enable AI-powered code completion") },
    Toggle { id: "workbench.toggleMinimap", key: "showMinimap", title: "Toggle Minimap", category: "Editor", icon: "Code", on: ("Editor: Hide Minimap", "Hide the editor minimap overview"), off: ("Editor: Show Minimap", "Show the editor minimap overview") },
    Toggle { id: "view.toggleCompactMenuBar", key: "compactMenuBar", title: "View: Toggle Compact Menu Bar", category: "View", icon: "List", on: ("View: Disable Compact Menu Bar", "Show full menu bar"), off: ("View: Enable Compact Menu Bar", "Use compact menu bar with hamburger icon") },
    Toggle { id: "settings.toggleTelemetry", key: "telemetry", title: "Advanced: Toggle Telemetry", category: "Advanced", icon: "Settings", on: ("Advanced: Disable Telemetry", "Stop sending anonymous usage diagnostics"), off: ("Advanced: Enable Telemetry", "Enable anonymous usage diagnostics") },
    Toggle { id: "features.toggleBreadcrumbs", key: "coreFeatures.breadcrumbs", title: "Features: Toggle Breadcrumbs", category: "Features", icon: "Sitemap", on: ("Features: Disable Breadcrumbs", "Hide breadcrumbs navigation"), off: ("Features: Enable Breadcrumbs", "Show breadcrumbs navigation") },
    Toggle { id: "features.toggleDiagnostics", key: "coreFeatures.diagnostics", title: "Features: Toggle Diagnostics", category: "Features", icon: "WarningCircle", on: ("Features: Disable Diagnostics", "Hide diagnostics panel"), off: ("Features: Enable Diagnostics", "Show diagnostics panel") },
    Toggle { id: "features.toggleDebugger", key: "coreFeatures.debugger", title: "Features: Toggle Debugger", category: "Features", icon: "WarningCircle", on: ("Features: Disable Debugger", "Disable run and debug panel"), off: ("Features: Enable Debugger", "Enable run and debug panel") },
    Toggle { id: "features.toggleSearch", key: "coreFeatures.search", title: "Features: Toggle Search", category: "Features", icon: "Search", on: ("Features: Disable Search", "Disable search functionality"), off: ("Features: Enable Search", "Enable search functionality") },
    Toggle { id: "features.toggleGit", key: "coreFeatures.git", title: "Features: Toggle Git", category: "Features", icon: "GitBranch", on: ("Features: Disable Git", "Disable Git integration"), off: ("Features: Enable Git", "Enable Git integration") },
    Toggle { id: "features.toggleTerminal", key: "coreFeatures.terminal", title: "Features: Toggle Terminal", category: "Features", icon: "TerminalWindow", on: ("Features: Disable Terminal", "Disable integrated terminal"), off: ("Features: Enable Terminal", "Enable integrated terminal") },
    Toggle { id: "features.toggleAgentSessions", key: "coreFeatures.aiChat", title: "Features: Toggle Agent Sessions", category: "Features", icon: "ChatBubbleText", on: ("Features: Disable Agent Sessions", "Disable agent sessions"), off: ("Features: Enable Agent Sessions", "Enable agent sessions") },
    Toggle { id: "features.toggleRemote", key: "coreFeatures.remote", title: "Features: Toggle Remote", category: "Features", icon: "Cloud", on: ("Features: Disable Remote", "Disable remote development"), off: ("Features: Enable Remote", "Enable remote development") },
    Toggle { id: "features.togglePersistentCommands", key: "coreFeatures.persistentCommands", title: "Features: Toggle Persistent Commands", category: "Features", icon: "Cloud", on: ("Features: Disable Persistent Commands", "Disable persistent commands"), off: ("Features: Enable Persistent Commands", "Enable persistent commands") },
];

fn is_on(key: &str, cx: &App) -> bool {
    settings::get(cx).get(key).and_then(|value| value.as_bool()).unwrap_or(false)
}

fn toggle(key: &'static str, cx: &mut App) {
    let next = !is_on(key, cx);
    settings::update(cx, |settings| {
        // Relative numbers need line numbers.
        if key == "vimRelativeLineNumbers" && next {
            settings.line_numbers = true;
        }
        settings.set(key, Value::Bool(next)).ok();
    });
}

fn info(id: &str, title: &str, category: &str, description: Option<String>, icon: &str) -> keymap::CommandInfo {
    keymap::CommandInfo { id: id.into(), title: title.into(), category: category.into(), description, icon: Some(icon.into()) }
}

/// Registers the settings commands and starts watching the settings files. Call before
/// `workbench::init`, which binds the keys of every registered command.
pub fn init(cx: &mut App) {
    keymap::register(cx, "preferences.openSettingsJson", OpenSettingsJson);
    keymap::register(cx, "workbench.openKeyboardShortcuts", OpenKeyboardShortcuts);
    keymap::register(cx, "settings.toggleVimMode", ToggleSetting { key: "vimMode" });
    keymap::describe(
        cx,
        info("settings.toggleVimMode", "Vim Mode: Toggle", "Vim", None, "TerminalWindow"),
        Some(Box::new(|cx: &App| {
            ("Vim Mode: Toggle".into(), if is_on("vimMode", cx) { "Currently enabled".into() } else { "Currently disabled".into() })
        })),
    );
    keymap::register(cx, "settings.toggleRelativeLineNumbers", ToggleSetting { key: "vimRelativeLineNumbers" });
    keymap::describe(
        cx,
        info("settings.toggleRelativeLineNumbers", "Editor: Toggle Relative Line Numbers", "Editor", None, "Hash"),
        Some(Box::new(|cx: &App| {
            if is_on("vimRelativeLineNumbers", cx) {
                ("Editor: Disable Relative Line Numbers".into(), "Use absolute line numbers".into())
            } else {
                ("Editor: Enable Relative Line Numbers".into(), "Show relative line numbers (Vim mode)".into())
            }
        })),
    );
    for toggle in TOGGLES {
        keymap::register(cx, toggle.id, ToggleSetting { key: toggle.key });
        let (key, on, off) = (toggle.key, toggle.on, toggle.off);
        keymap::describe(
            cx,
            info(toggle.id, toggle.title, toggle.category, None, toggle.icon),
            Some(Box::new(move |cx: &App| {
                let (label, description) = if is_on(key, cx) { on } else { off };
                (label.into(), description.into())
            })),
        );
    }
    for (page, title) in SETTINGS_PAGES {
        let id = format!("preferences.openSettingsTab.{page}");
        keymap::register(cx, &id, OpenSettingsAt { page, query: SharedString::default() });
        keymap::describe(
            cx,
            info(&id, &format!("Preferences: Open {title} Settings"), "Settings", Some(format!("Open the {} settings tab", title.to_lowercase())), "Settings"),
            None,
        );
    }
    keymap::register(cx, "workspace.manage", ManageWorkspaces);
    keymap::describe(cx, info("workspace.manage", "Workspace: Manage Workspaces", "File", Some("Share project commands and AI instructions with your team".into()), "Grid"), None);
    keymap::register(cx, "workspace.add", AddWorkspace);
    keymap::describe(cx, info("workspace.add", "Workspace: Add Workspace…", "File", Some("Register a project folder as a workspace and edit what your team shares".into()), "Grid"), None);
    cx.on_action(|_: &ManageWorkspaces, cx| crate::team_workspaces::open_management(cx));
    cx.on_action(|_: &AddWorkspace, cx| crate::team_workspaces::add_workspace(cx));
    cx.on_action(|action: &ToggleSetting, cx| toggle(action.key, cx));
    cx.on_action(|action: &OpenSettingsAt, cx| {
        workbench_api::open_settings(cx, Some(action.page), Some(action.query.as_ref()));
    });
    cx.on_action(|_: &OpenKeyboardShortcuts, cx| workbench_api::open_settings(cx, Some("keyboard"), None));
    cx.on_action(|_: &OpenSettingsJson, cx| open_settings_json(cx));
    cx.on_action(|_: &OpenKeymapJson, cx| open_keymap_json(cx));
    watch_files(cx);
}

/// Opens `settings.json` in the editor, writing it first when it does not exist yet.
pub fn open_settings_json(cx: &mut App) {
    let Some(path) = settings::path(cx) else {
        notify(cx, NotificationKind::Error, "Settings are not saved to a file in this build", None);
        return;
    };
    if !path.exists() {
        settings::update(cx, |_| {});
    }
    workbench_api::open_file(cx, path, None);
}

#[cfg(not(target_family = "wasm"))]
fn keymap_path() -> Option<PathBuf> {
    keymap::user_bindings_path()
}

#[cfg(target_family = "wasm")]
fn keymap_path() -> Option<PathBuf> {
    None
}

/// Opens `keymap.json` in the editor, starting it as an empty list when there is none.
pub fn open_keymap_json(cx: &mut App) {
    let Some(path) = keymap_path() else { return };
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        if let Err(error) = std::fs::write(&path, "[]\n") {
            notify(cx, NotificationKind::Error, "Could not create keymap.json", Some(error.to_string()));
            return;
        }
        keymap_file_written(cx, "[]\n".into());
    }
    workbench_api::open_file(cx, path, None);
}

/// What `keymap.json` held when last read or written by Athas.
#[derive(Default)]
struct KeymapFile {
    last: Option<String>,
}

impl Global for KeymapFile {}

/// Notes text Athas wrote to `keymap.json`, so the watcher does not read it back as an edit.
pub fn keymap_file_written(cx: &mut App, text: String) {
    cx.default_global::<KeymapFile>().last = Some(text);
}

fn issue_list<T: std::fmt::Display>(issues: &[T]) -> String {
    let mut lines: Vec<String> = issues.iter().take(4).map(ToString::to_string).collect();
    if issues.len() > 4 {
        lines.push(format!("and {} more", issues.len() - 4));
    }
    lines.join("\n")
}

/// Applies `settings.json` when it changed on disk, reporting what it could not use.
pub fn reload_settings_file(cx: &mut App) {
    match settings::reload_from_disk(cx) {
        None => {}
        Some(Ok(issues)) if issues.is_empty() => {}
        Some(Ok(issues)) => notify(
            cx,
            NotificationKind::Warning,
            format!("settings.json: {} {} kept {}", issues.len(), if issues.len() == 1 { "setting" } else { "settings" }, if issues.len() == 1 { "its value" } else { "their values" }),
            Some(issue_list(&issues)),
        ),
        Some(Err(error)) => notify(cx, NotificationKind::Error, "settings.json is not valid JSON", Some(error.to_string())),
    }
}

/// Binds `keymap.json` again when it changed on disk, reporting entries that do not bind.
pub fn reload_keymap_file(cx: &mut App) {
    let Some(path) = keymap_path() else { return };
    let Ok(text) = std::fs::read_to_string(&path) else {
        // No file yet: noted as empty, so the first one created is bound as soon as it appears.
        let state = cx.default_global::<KeymapFile>();
        if state.last.is_none() {
            state.last = Some(String::new());
        }
        return;
    };
    let state = cx.default_global::<KeymapFile>();
    if state.last.as_deref() == Some(text.as_str()) {
        return;
    }
    let first_read = state.last.is_none();
    state.last = Some(text.clone());
    if first_read {
        return;
    }
    match keymap::parse_user_bindings(&text) {
        Ok((_, issues)) => {
            keymap::user_bindings_changed(cx);
            if !issues.is_empty() {
                notify(cx, NotificationKind::Warning, format!("keymap.json: {} {} skipped", issues.len(), if issues.len() == 1 { "entry" } else { "entries" }), Some(issue_list(&issues)));
            }
        }
        Err(error) => notify(cx, NotificationKind::Error, "keymap.json is not valid JSON", Some(error.to_string())),
    }
}

/// Polls both files once a second: a stat each, read only when they changed.
fn watch_files(cx: &mut App) {
    reload_keymap_file(cx);
    cx.spawn(async move |cx| {
        let mut seen: [Option<std::time::SystemTime>; 2] = [None, None];
        let mut first = true;
        loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            let modified = |path: Option<PathBuf>| path.and_then(|path| std::fs::metadata(path).ok()?.modified().ok());
            let (settings_path, keymap) = cx.update(|cx| (settings::path(cx), keymap_path()));
            let now = [modified(settings_path), modified(keymap)];
            // A file that appears counts as a change too; each reload compares the text, so the
            // first tick reads nothing new.
            if !first && now[0] != seen[0] {
                cx.update(reload_settings_file);
            }
            if !first && now[1] != seen[1] {
                cx.update(reload_keymap_file);
            }
            first = false;
            seen = now;
        }
    })
    .detach();
}

/// The settings the command palette offers while searching (`createSettingsSearchItems`).
pub fn palette_setting_entries() -> Vec<palette::SettingEntry> {
    SETTING_DEFS
        .iter()
        .filter(|def| def.key != Some("vimMode") && (def.key.is_some() || !matches!(def.tab, "ai" | "account")))
        .map(|def| palette::SettingEntry {
            entry: palette::CommandEntry {
                id: format!("open-setting-{}-{}", def.tab, def.label).into(),
                label: format!("Settings: {}", def.label).into(),
                category: "Settings".into(),
                description: format!("Open {} > {}", page_title(def.tab), def.label).into(),
                icon: ui::IconName::Settings,
                action: Box::new(OpenSettingsAt { page: def.tab, query: def.label.into() }),
                shortcut: None,
            },
            keywords: [def.description, def.section, def.key].into_iter().flatten().map(SharedString::from).collect(),
        })
        .collect()
}
