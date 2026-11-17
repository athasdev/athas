//! Moving settings in and out: Athas's own export file (`lib/settings-import-export.ts`) and the
//! settings of other editors (VS Code, Cursor, Windsurf, Zed, JetBrains) mapped onto Athas keys.

#[cfg(not(target_family = "wasm"))]
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, bail};
use serde_json::{Map, Value, json};

use crate::{Settings, jsonc::parse_jsonc};

pub const EXPORT_FORMAT: &str = "athas.settings";
/// `SETTINGS_SCHEMA_VERSION` of the web workbench.
pub const SCHEMA_VERSION: u64 = 6;

/// The current time as ISO 8601 in UTC, `2026-11-11T09:30:00.000Z`, as JavaScript writes it.
pub fn timestamp_now() -> String {
    let since_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format_timestamp(since_epoch.as_millis() as i64)
}

fn format_timestamp(millis: i64) -> String {
    let seconds = millis.div_euclid(1000);
    let days = seconds.div_euclid(86_400);
    let time = seconds.rem_euclid(86_400);
    // Days to a civil date (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3600,
        time % 3600 / 60,
        time % 60,
        millis.rem_euclid(1000)
    )
}

/// The file Export Settings writes.
pub fn export_json(settings: &Settings, exported_at: &str) -> Result<String> {
    let payload = json!({
        "format": EXPORT_FORMAT,
        "version": SCHEMA_VERSION,
        "exportedAt": exported_at,
        "settings": serde_json::to_value(settings)?,
    });
    Ok(serde_json::to_string_pretty(&payload)?)
}

/// Settings read from a file, and the keys whose values did not fit.
#[derive(Debug)]
pub struct SettingsImport {
    pub settings: Settings,
    pub skipped: Vec<String>,
}

/// Reads an exported settings file, or a bare `settings.json`: the known keys over the defaults.
pub fn parse_settings_import(text: &str) -> Result<SettingsImport> {
    let value = parse_jsonc(text).context("not valid JSON")?;
    let Some(object) = value.as_object() else { bail!("not a settings file") };
    let candidate = if object.get("format").and_then(Value::as_str) == Some(EXPORT_FORMAT) {
        let version = object.get("version").and_then(Value::as_u64).unwrap_or(0);
        if version == 0 || version > SCHEMA_VERSION {
            bail!("settings from an unsupported version ({version})");
        }
        object.get("settings").and_then(Value::as_object).context("the file holds no settings")?
    } else {
        object
    };
    let known = Settings::default().as_map();
    let mut settings = Settings::default();
    let mut skipped = Vec::new();
    let mut applied = 0;
    for (key, value) in candidate {
        if !known.contains_key(key) {
            continue;
        }
        match settings.set(key, value.clone()) {
            Ok(()) => applied += 1,
            Err(_) => skipped.push(key.clone()),
        }
    }
    if applied == 0 {
        bail!("no Athas settings in this file");
    }
    Ok(SettingsImport { settings, skipped })
}

/// An editor Athas can import from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Editor {
    VsCode,
    Cursor,
    Windsurf,
    Zed,
    JetBrains,
}

impl Editor {
    pub const ALL: [Editor; 5] = [Editor::VsCode, Editor::Cursor, Editor::Windsurf, Editor::Zed, Editor::JetBrains];

    pub fn name(self) -> &'static str {
        match self {
            Editor::VsCode => "VS Code",
            Editor::Cursor => "Cursor",
            Editor::Windsurf => "Windsurf",
            Editor::Zed => "Zed",
            Editor::JetBrains => "JetBrains",
        }
    }

    /// Where the editor keeps its user settings on this machine, most likely first.
    #[cfg(not(target_family = "wasm"))]
    pub fn settings_dirs(self) -> Vec<PathBuf> {
        let config = dirs::config_dir();
        let home = dirs::home_dir();
        let in_config = |names: &[&str]| -> Vec<PathBuf> {
            config.iter().flat_map(|dir| names.iter().map(move |name| dir.join(name).join("User"))).collect()
        };
        match self {
            Editor::VsCode => in_config(&["Code", "Code - Insiders", "VSCodium"]),
            Editor::Cursor => in_config(&["Cursor"]),
            Editor::Windsurf => in_config(&["Windsurf"]),
            Editor::Zed => {
                let mut dirs: Vec<PathBuf> = home.iter().map(|home| home.join(".config").join("zed")).collect();
                if cfg!(target_os = "windows") {
                    dirs.extend(config.iter().map(|dir| dir.join("Zed")));
                }
                dirs
            }
            Editor::JetBrains => config
                .iter()
                .filter_map(|dir| latest_jetbrains_options(&dir.join("JetBrains")))
                .collect(),
        }
    }
}

/// The `options` folder of the JetBrains IDE used last.
#[cfg(not(target_family = "wasm"))]
fn latest_jetbrains_options(root: &Path) -> Option<PathBuf> {
    std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("options"))
        .filter(|options| options.is_dir())
        .max_by_key(|options| options.metadata().and_then(|meta| meta.modified()).ok())
}

/// One setting another editor sets, in Athas's terms.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportedSetting {
    pub key: &'static str,
    pub value: Value,
    /// The other editor's name for it, such as `editor.fontSize`.
    pub from: String,
}

/// What an import would change: the setting, its value now and after.
#[derive(Clone, Debug, PartialEq)]
pub struct SettingChange {
    pub key: &'static str,
    pub from: String,
    pub old: Value,
    pub new: Value,
}

/// The imported settings that would change something, with values Athas accepts.
pub fn changes(current: &Settings, imported: Vec<ImportedSetting>) -> Vec<SettingChange> {
    let mut changes: Vec<SettingChange> = Vec::new();
    for setting in imported {
        let mut probe = current.clone();
        if probe.set(setting.key, setting.value.clone()).is_err() {
            continue;
        }
        let old = current.get(setting.key).unwrap_or(Value::Null);
        let new = probe.get(setting.key).unwrap_or(Value::Null);
        if old == new {
            continue;
        }
        changes.retain(|change| change.key != setting.key);
        changes.push(SettingChange { key: setting.key, from: setting.from, old, new });
    }
    changes
}

/// Applies the chosen changes.
pub fn apply(settings: &mut Settings, changes: &[SettingChange]) {
    for change in changes {
        settings.set(change.key, change.new.clone()).ok();
    }
}

/// Finds an Athas theme for another editor's theme name.
pub type ThemeLookup<'a> = &'a dyn Fn(&str) -> Option<String>;

/// Built-in themes of other editors that Athas's own themes stand in for.
const THEME_ALIASES: &[(&str, &str)] = &[
    ("default dark modern", "athas-dark"),
    ("default dark+", "athas-dark"),
    ("dark modern", "athas-dark"),
    ("dark+", "athas-dark"),
    ("dark+ (default dark)", "athas-dark"),
    ("visual studio dark", "athas-dark"),
    ("default high contrast", "athas-dark"),
    ("cursor dark", "athas-dark"),
    ("cursor dark midnight", "athas-dark"),
    ("windsurf dark", "athas-dark"),
    ("darcula", "athas-dark"),
    ("default light modern", "athas-light"),
    ("default light+", "athas-light"),
    ("light modern", "athas-light"),
    ("light+", "athas-light"),
    ("light+ (default light)", "athas-light"),
    ("visual studio light", "athas-light"),
    ("cursor light", "athas-light"),
    ("intellij light", "athas-light"),
];

fn theme_id(name: &str, lookup: ThemeLookup) -> Option<String> {
    lookup(name).or_else(|| {
        let lower = name.trim().to_lowercase();
        THEME_ALIASES.iter().find(|(alias, _)| *alias == lower).map(|(_, id)| id.to_string())
    })
}

/// `'Fira Code', Menlo, monospace` → `Fira Code`.
fn first_font_family(value: &str) -> Option<String> {
    let first = value.split(',').next()?.trim().trim_matches(|c| c == '\'' || c == '"').trim();
    (!first.is_empty()).then(|| first.to_string())
}

fn round_tenths(value: f64) -> f64 {
    (value * 10.).round() / 10.
}

struct Collector {
    settings: Vec<ImportedSetting>,
}

impl Collector {
    fn push(&mut self, key: &'static str, value: impl Into<Value>, from: &str) {
        self.settings.push(ImportedSetting { key, value: value.into(), from: from.to_string() });
    }
}

/// Maps VS Code's `settings.json` (Cursor and Windsurf use the same keys).
pub fn vscode_settings(json: &Value, themes: ThemeLookup) -> Vec<ImportedSetting> {
    let mut out = Collector { settings: Vec::new() };
    let Some(object) = json.as_object() else { return out.settings };
    let get = |key: &str| object.get(key);
    let boolean = |key: &str| get(key).and_then(Value::as_bool);
    let number = |key: &str| get(key).and_then(Value::as_f64);
    let string = |key: &str| get(key).and_then(Value::as_str);

    if let Some(family) = string("editor.fontFamily").and_then(first_font_family) {
        out.push("fontFamily", family, "editor.fontFamily");
    }
    let font_size = number("editor.fontSize");
    if let Some(size) = font_size.filter(|size| *size > 0.) {
        out.push("fontSize", size, "editor.fontSize");
    }
    // VS Code reads 0 as automatic, under 8 as a multiple of the font size, else as pixels.
    if let Some(height) = number("editor.lineHeight").filter(|height| *height > 0.) {
        let ratio = if height < 8. { height } else { height / font_size.unwrap_or(14.) };
        out.push("editorLineHeight", round_tenths(ratio), "editor.lineHeight");
    }
    if let Some(size) = number("editor.tabSize") {
        out.push("tabSize", size, "editor.tabSize");
    }
    if let Some(wrap) = string("editor.wordWrap") {
        out.push("wordWrap", wrap != "off", "editor.wordWrap");
    }
    if let Some(numbers) = string("editor.lineNumbers") {
        out.push("lineNumbers", numbers != "off", "editor.lineNumbers");
    }
    if let Some(whitespace) = string("editor.renderWhitespace") {
        let value = if whitespace == "selection" { "boundary" } else { whitespace };
        out.push("renderWhitespace", value, "editor.renderWhitespace");
    }
    if let Some(guides) = boolean("editor.guides.indentation") {
        out.push("renderIndentGuides", guides, "editor.guides.indentation");
    }
    match get("editor.occurrencesHighlight") {
        Some(Value::Bool(on)) => out.push("highlightOccurrences", *on, "editor.occurrencesHighlight"),
        Some(Value::String(mode)) => out.push("highlightOccurrences", mode != "off", "editor.occurrencesHighlight"),
        _ => {}
    }
    if let Some(minimap) = boolean("editor.minimap.enabled") {
        out.push("showMinimap", minimap, "editor.minimap.enabled");
    }
    match get("editor.fontLigatures") {
        Some(Value::Bool(on)) => out.push("editorFontLigatures", *on, "editor.fontLigatures"),
        Some(Value::String(features)) => out.push("editorFontLigatures", !features.trim().is_empty(), "editor.fontLigatures"),
        _ => {}
    }
    for (from, key) in [
        ("editor.stickyScroll.enabled", "editorStickyScroll"),
        ("editor.bracketPairColorization.enabled", "editorBracketPairColorization"),
        ("editor.smoothScrolling", "editorSmoothScrolling"),
        ("editor.scrollBeyondLastLine", "editorScrollBeyondLastLine"),
        ("editor.codeLens", "codeLens"),
        ("editor.semanticHighlighting.enabled", "semanticTokens"),
        ("editor.formatOnSave", "formatOnSave"),
        ("editor.parameterHints.enabled", "parameterHints"),
        ("files.trimTrailingWhitespace", "trimTrailingWhitespaceOnSave"),
        ("files.insertFinalNewline", "insertFinalNewlineOnSave"),
        ("explorer.confirmDelete", "confirmBeforeFileDelete"),
        ("explorer.compactFolders", "compactFoldersInFileTree"),
        ("git.alwaysSignOff", "gitSignOffCommits"),
        ("git.openDiffOnClick", "openDiffOnClick"),
        ("git.decorations.enabled", "showGitStatusInFileTree"),
        ("git.blame.editorDecoration.enabled", "enableInlineGitBlame"),
        ("git.rebaseWhenSync", "gitPullRebase"),
        ("workbench.editor.showIcons", "showTabIcons"),
        ("window.autoDetectColorScheme", "syncSystemTheme"),
        ("terminal.integrated.copyOnSelection", "terminalCopyOnSelect"),
        ("terminal.integrated.macOptionIsMeta", "terminalMacOptionIsMeta"),
        ("terminal.integrated.altClickMovesCursor", "terminalAltClickMovesCursor"),
        ("terminal.integrated.cursorBlinking", "terminalCursorBlink"),
        ("terminal.integrated.shellIntegration.enabled", "terminalShellIntegration"),
    ] {
        if let Some(value) = boolean(from) {
            out.push(key, value, from);
        }
    }
    if let Some(style) = string("editor.cursorStyle") {
        out.push("editorCursorStyle", style, "editor.cursorStyle");
    }
    if let Some(blinking) = string("editor.cursorBlinking") {
        out.push("editorCursorBlinking", blinking, "editor.cursorBlinking");
    }
    if let Some(hints) = string("editor.inlayHints.enabled") {
        out.push("inlayHints", hints != "off", "editor.inlayHints.enabled");
    }
    if let Some(brackets) = string("editor.autoClosingBrackets") {
        out.push("editorAutoCloseBrackets", brackets != "never", "editor.autoClosingBrackets");
    }
    if let Some(rulers) = get("editor.rulers").and_then(Value::as_array) {
        let columns: Vec<Value> = rulers
            .iter()
            .filter_map(|ruler| ruler.as_f64().or_else(|| ruler.get("column").and_then(Value::as_f64)))
            .map(Value::from)
            .collect();
        out.push("editorRulers", columns, "editor.rulers");
    }
    if let Some(modifier) = string("editor.multiCursorModifier") {
        out.push("editorMultiCursorModifier", if modifier == "ctrlCmd" { "mod" } else { "alt" }, "editor.multiCursorModifier");
    }
    if let Some(save) = string("files.autoSave") {
        out.push("autoSave", save != "off", "files.autoSave");
    }
    if let Some(exclude) = get("search.exclude").and_then(Value::as_object) {
        let patterns: Vec<Value> = exclude
            .iter()
            .filter(|(_, on)| on.as_bool() == Some(true))
            .map(|(pattern, _)| Value::from(pattern.as_str()))
            .collect();
        out.push("searchExcludePatterns", patterns, "search.exclude");
    }
    if let Some(reveal) = get("explorer.autoReveal") {
        out.push("autoRevealActiveFileInFileTree", reveal.as_bool().unwrap_or(true), "explorer.autoReveal");
    }
    if let Some(indent) = number("workbench.tree.indent") {
        out.push("fileTreeIndentSize", indent, "workbench.tree.indent");
    }
    if let Some(guides) = string("workbench.tree.renderIndentGuides") {
        out.push("showIndentGuidesInFileTree", guides != "none", "workbench.tree.renderIndentGuides");
    }
    if boolean("git.autofetch") == Some(true) || string("git.autofetch") == Some("all") {
        let minutes = number("git.autofetchPeriod").map_or(3., |seconds| (seconds / 60.).max(1.).round());
        out.push("gitAutoFetchInterval", minutes, "git.autofetch");
    } else if boolean("git.autofetch") == Some(false) {
        out.push("gitAutoFetchInterval", 0., "git.autofetch");
    }
    if let Some(branch) = string("git.defaultBranchName") {
        out.push("gitDefaultBranchName", branch, "git.defaultBranchName");
    }
    if let Some(untracked) = string("git.untrackedChanges") {
        out.push("showUntrackedFiles", untracked != "hidden", "git.untrackedChanges");
    }
    if let Some(side_by_side) = boolean("diffEditor.renderSideBySide") {
        out.push("gitDefaultDiffView", if side_by_side { "split" } else { "unified" }, "diffEditor.renderSideBySide");
    }
    if let Some(mode) = string("window.openFoldersInNewWindow") {
        match mode {
            "on" => out.push("openFoldersInNewWindow", true, "window.openFoldersInNewWindow"),
            "off" => out.push("openFoldersInNewWindow", false, "window.openFoldersInNewWindow"),
            _ => {}
        }
    }
    if boolean("workbench.editor.limit.enabled") == Some(true)
        && let Some(limit) = number("workbench.editor.limit.value")
    {
        out.push("maxOpenTabs", limit, "workbench.editor.limit.value");
    }
    if let Some(level) = string("telemetry.telemetryLevel") {
        out.push("telemetry", level != "off", "telemetry.telemetryLevel");
    }

    if let Some(id) = string("workbench.colorTheme").and_then(|name| theme_id(name, themes)) {
        out.push("theme", id, "workbench.colorTheme");
    }
    if let Some(id) = string("workbench.preferredDarkColorTheme").and_then(|name| theme_id(name, themes)) {
        out.push("autoThemeDark", id, "workbench.preferredDarkColorTheme");
    }
    if let Some(id) = string("workbench.preferredLightColorTheme").and_then(|name| theme_id(name, themes)) {
        out.push("autoThemeLight", id, "workbench.preferredLightColorTheme");
    }

    if let Some(family) = string("terminal.integrated.fontFamily").and_then(first_font_family) {
        out.push("terminalFontFamily", family, "terminal.integrated.fontFamily");
    }
    for (from, key) in [
        ("terminal.integrated.fontSize", "terminalFontSize"),
        ("terminal.integrated.lineHeight", "terminalLineHeight"),
        ("terminal.integrated.letterSpacing", "terminalLetterSpacing"),
        ("terminal.integrated.scrollback", "terminalScrollback"),
        ("terminal.integrated.cursorWidth", "terminalCursorWidth"),
        ("terminal.integrated.minimumContrastRatio", "terminalMinimumContrastRatio"),
    ] {
        if let Some(value) = number(from) {
            out.push(key, value, from);
        }
    }
    if let Some(style) = string("terminal.integrated.cursorStyle") {
        out.push("terminalCursorStyle", if style == "line" { "bar" } else { style }, "terminal.integrated.cursorStyle");
    }
    if let Some(style) = string("terminal.integrated.cursorStyleInactive") {
        let value = match style {
            "line" => "bar",
            "outline" | "block" | "underline" | "none" => style,
            _ => "outline",
        };
        out.push("terminalCursorInactiveStyle", value, "terminal.integrated.cursorStyleInactive");
    }
    if let Some(behavior) = string("terminal.integrated.rightClickBehavior") {
        out.push("terminalRightClickSelectsWord", behavior == "selectWord", "terminal.integrated.rightClickBehavior");
    }
    if let Some(gpu) = string("terminal.integrated.gpuAcceleration") {
        out.push("terminalGpuAcceleration", gpu != "off", "terminal.integrated.gpuAcceleration");
    }
    if let Some(kill) = string("terminal.integrated.confirmOnKill") {
        out.push("terminalConfirmCloseRunning", kill != "never", "terminal.integrated.confirmOnKill");
    }
    if let Some(bell) = boolean("terminal.integrated.enableBell") {
        out.push("terminalBell", if bell { "sound" } else { "off" }, "terminal.integrated.enableBell");
    }
    if let Some(enabled) = boolean("vim.enable").or_else(|| object.keys().any(|key| key.starts_with("vim.")).then_some(true)) {
        out.push("vimMode", enabled, "vim.*");
    }
    out.settings
}

/// Zed's `"comfortable"`, `"standard"` and `{"custom": n}` line heights.
fn zed_line_height(value: &Value) -> Option<f64> {
    match value {
        Value::String(name) if name == "comfortable" => Some(1.6),
        Value::String(name) if name == "standard" => Some(1.3),
        Value::Object(custom) => custom.get("custom").and_then(Value::as_f64).map(round_tenths),
        _ => None,
    }
}

fn path<'a>(object: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    let (first, rest) = keys.split_first()?;
    rest.iter().try_fold(object.get(*first)?, |value, key| value.get(*key))
}

/// Maps Zed's `settings.json`.
pub fn zed_settings(json: &Value, themes: ThemeLookup) -> Vec<ImportedSetting> {
    let mut out = Collector { settings: Vec::new() };
    let Some(object) = json.as_object() else { return out.settings };
    let get = |keys: &[&str]| path(object, keys);
    let boolean = |keys: &[&str]| get(keys).and_then(Value::as_bool);
    let number = |keys: &[&str]| get(keys).and_then(Value::as_f64);
    let string = |keys: &[&str]| get(keys).and_then(Value::as_str);

    if let Some(family) = string(&["buffer_font_family"]) {
        out.push("fontFamily", family, "buffer_font_family");
    }
    if let Some(size) = number(&["buffer_font_size"]) {
        out.push("fontSize", size, "buffer_font_size");
    }
    if let Some(height) = get(&["buffer_line_height"]).and_then(zed_line_height) {
        out.push("editorLineHeight", height, "buffer_line_height");
    }
    if let Some(calt) = boolean(&["buffer_font_features", "calt"]) {
        out.push("editorFontLigatures", calt, "buffer_font_features.calt");
    }
    if let Some(family) = string(&["ui_font_family"]) {
        let value = if family == ".SystemUIFont" || family == "system-ui" { "system-ui" } else { family };
        out.push("uiFontFamily", value, "ui_font_family");
    }
    if let Some(size) = number(&["ui_font_size"]) {
        out.push("uiFontSize", size, "ui_font_size");
    }
    if let Some(size) = number(&["tab_size"]) {
        out.push("tabSize", size, "tab_size");
    }
    if let Some(wrap) = string(&["soft_wrap"]) {
        out.push("wordWrap", wrap != "none", "soft_wrap");
    }
    if let Some(whitespace) = string(&["show_whitespaces"]) {
        let value = match whitespace {
            "selection" => "boundary",
            "none" | "all" | "boundary" | "trailing" => whitespace,
            _ => "none",
        };
        out.push("renderWhitespace", value, "show_whitespaces");
    }
    if let Some(guides) = boolean(&["indent_guides", "enabled"]) {
        out.push("renderIndentGuides", guides, "indent_guides.enabled");
    }
    if let Some(show) = string(&["minimap", "show"]) {
        out.push("showMinimap", show != "never", "minimap.show");
    }
    if let Some(blink) = boolean(&["cursor_blink"]) {
        out.push("editorCursorBlinking", if blink { "blink" } else { "solid" }, "cursor_blink");
    }
    if let Some(shape) = string(&["cursor_shape"]) {
        let value = match shape {
            "bar" => "line",
            "block" => "block",
            "hollow" => "block-outline",
            "underline" => "underline",
            _ => "line",
        };
        out.push("editorCursorStyle", value, "cursor_shape");
    }
    if let Some(hints) = boolean(&["inlay_hints", "enabled"]) {
        out.push("inlayHints", hints, "inlay_hints.enabled");
    }
    match get(&["format_on_save"]) {
        Some(Value::Bool(on)) => out.push("formatOnSave", *on, "format_on_save"),
        Some(Value::String(mode)) => out.push("formatOnSave", mode != "off", "format_on_save"),
        _ => {}
    }
    for (keys, key) in [
        (&["remove_trailing_whitespace_on_save"][..], "trimTrailingWhitespaceOnSave"),
        (&["ensure_final_newline_on_save"][..], "insertFinalNewlineOnSave"),
        (&["use_autoclose"][..], "editorAutoCloseBrackets"),
        (&["show_completions_on_input"][..], "autoCompletion"),
        (&["vim_mode"][..], "vimMode"),
        (&["relative_line_numbers"][..], "vimRelativeLineNumbers"),
        (&["gutter", "line_numbers"][..], "lineNumbers"),
        (&["git", "inline_blame", "enabled"][..], "enableInlineGitBlame"),
        (&["project_panel", "auto_reveal_entries"][..], "autoRevealActiveFileInFileTree"),
        (&["project_panel", "auto_fold_dirs"][..], "compactFoldersInFileTree"),
        (&["project_panel", "git_status"][..], "showGitStatusInFileTree"),
        (&["project_panel", "file_icons"][..], "showFileIconsInFileTree"),
        (&["tabs", "file_icons"][..], "showTabIcons"),
        (&["terminal", "copy_on_select"][..], "terminalCopyOnSelect"),
        (&["terminal", "option_as_meta"][..], "terminalMacOptionIsMeta"),
    ] {
        if let Some(value) = boolean(keys) {
            out.push(key, value, &keys.join("."));
        }
    }
    match get(&["autosave"]) {
        Some(Value::String(mode)) => out.push("autoSave", mode != "off", "autosave"),
        Some(Value::Object(_)) => out.push("autoSave", true, "autosave"),
        _ => {}
    }
    if boolean(&["show_wrap_guides"]) != Some(false)
        && let Some(guides) = get(&["wrap_guides"]).and_then(Value::as_array)
    {
        let columns: Vec<Value> = guides.iter().filter_map(Value::as_f64).map(Value::from).collect();
        out.push("editorRulers", columns, "wrap_guides");
    }
    if let Some(mode) = string(&["scroll_beyond_last_line"]) {
        out.push("editorScrollBeyondLastLine", mode != "off", "scroll_beyond_last_line");
    }
    if let Some(modifier) = string(&["multi_cursor_modifier"]) {
        out.push("editorMultiCursorModifier", if modifier == "alt" { "alt" } else { "mod" }, "multi_cursor_modifier");
    }
    // Zed's own keymap is the default; `base_keymap` swaps in another editor's.
    let preset = match string(&["base_keymap"]) {
        None | Some("VSCode") => "zed",
        Some("JetBrains") => "jetbrains",
        Some("SublimeText") => "sublime",
        Some("Atom") => "atom",
        Some("Emacs") => "emacs",
        Some("Cursor") => "vscode",
        Some("TextMate") => "xcode",
        Some(_) => "none",
    };
    out.push("keybindingPreset", preset, "base_keymap");

    match get(&["theme"]) {
        Some(Value::String(name)) => {
            if let Some(id) = theme_id(name, themes) {
                out.push("theme", id, "theme");
                out.push("syncSystemTheme", false, "theme");
            }
        }
        Some(Value::Object(choice)) => {
            let pick = |key: &str| choice.get(key).and_then(Value::as_str).and_then(|name| theme_id(name, themes));
            if let Some(id) = pick("light") {
                out.push("autoThemeLight", id, "theme.light");
            }
            if let Some(id) = pick("dark") {
                out.push("autoThemeDark", id, "theme.dark");
            }
            match choice.get("mode").and_then(Value::as_str) {
                Some("light") => {
                    if let Some(id) = pick("light") {
                        out.push("theme", id, "theme.mode");
                    }
                    out.push("syncSystemTheme", false, "theme.mode");
                }
                Some("dark") => {
                    if let Some(id) = pick("dark") {
                        out.push("theme", id, "theme.mode");
                    }
                    out.push("syncSystemTheme", false, "theme.mode");
                }
                _ => out.push("syncSystemTheme", true, "theme.mode"),
            }
        }
        _ => {}
    }

    if let Some(family) = string(&["terminal", "font_family"]) {
        out.push("terminalFontFamily", family, "terminal.font_family");
    }
    if let Some(size) = number(&["terminal", "font_size"]) {
        out.push("terminalFontSize", size, "terminal.font_size");
    }
    if let Some(height) = get(&["terminal", "line_height"]).and_then(zed_line_height) {
        out.push("terminalLineHeight", height, "terminal.line_height");
    }
    if let Some(blinking) = string(&["terminal", "blinking"]) {
        out.push("terminalCursorBlink", blinking != "off", "terminal.blinking");
    }
    if let Some(shape) = string(&["terminal", "cursor_shape"]) {
        let value = match shape {
            "underline" => "underline",
            "bar" => "bar",
            _ => "block",
        };
        out.push("terminalCursorStyle", value, "terminal.cursor_shape");
    }
    if let Some(contrast) = number(&["terminal", "minimum_contrast"]) {
        // Zed measures contrast in APCA Lc (0–106); WCAG ratios run from 1 to 21.
        out.push("terminalMinimumContrastRatio", round_tenths(1. + contrast / 106. * 6.), "terminal.minimum_contrast");
    }
    if let Some(lines) = number(&["terminal", "max_scroll_history_lines"]) {
        out.push("terminalScrollback", lines, "terminal.max_scroll_history_lines");
    }
    if let Some(indent) = number(&["project_panel", "indent_size"]) {
        out.push("fileTreeIndentSize", indent, "project_panel.indent_size");
    }
    if let Some(show) = string(&["project_panel", "indent_guides", "show"]) {
        out.push("showIndentGuidesInFileTree", show != "never", "project_panel.indent_guides.show");
    }
    if let Some(telemetry) = boolean(&["telemetry", "metrics"]) {
        out.push("telemetry", telemetry, "telemetry.metrics");
    }
    out.settings
}

/// The `value` of `<option name="NAME" value="…"/>` in a JetBrains options file.
fn jetbrains_option(xml: &str, name: &str) -> Option<String> {
    let marker = format!("name=\"{name}\"");
    let start = xml.find(&marker)?;
    let tag_end = xml[start..].find('>').map_or(xml.len(), |end| start + end);
    let tag_start = xml[..start].rfind('<').unwrap_or(0);
    let tag = &xml[tag_start..tag_end];
    let value_start = tag.find("value=\"")? + "value=\"".len();
    let value_end = tag[value_start..].find('"')? + value_start;
    Some(tag[value_start..value_end].replace("&amp;", "&").replace("&quot;", "\""))
}

/// Maps a JetBrains IDE's `options/editor-font.xml` and `options/keymap.xml`.
pub fn jetbrains_settings(editor_font: Option<&str>, keymap: Option<&str>) -> Vec<ImportedSetting> {
    let mut out = Collector { settings: Vec::new() };
    if let Some(xml) = editor_font {
        if let Some(family) = jetbrains_option(xml, "FONT_FAMILY") {
            out.push("fontFamily", family, "FONT_FAMILY");
        }
        if let Some(size) = jetbrains_option(xml, "FONT_SIZE_2D")
            .or_else(|| jetbrains_option(xml, "FONT_SIZE"))
            .and_then(|size| size.parse::<f64>().ok())
        {
            out.push("fontSize", size, "FONT_SIZE");
        }
        if let Some(spacing) = jetbrains_option(xml, "LINE_SPACING").and_then(|spacing| spacing.parse::<f64>().ok()) {
            out.push("editorLineHeight", round_tenths(spacing * 1.2), "LINE_SPACING");
        }
        if let Some(ligatures) = jetbrains_option(xml, "USE_LIGATURES") {
            out.push("editorFontLigatures", ligatures == "true", "USE_LIGATURES");
        }
    }
    let active = keymap.and_then(|xml| {
        let start = xml.find("<active_keymap")?;
        let tag = &xml[start..start + xml[start..].find('>')?];
        let name_start = tag.find("name=\"")? + "name=\"".len();
        Some(tag[name_start..name_start + tag[name_start..].find('"')?].to_lowercase())
    });
    let preset = match active.as_deref() {
        Some(name) if name.contains("vscode") || name.contains("vs code") => "vscode",
        Some(name) if name.contains("sublime") => "sublime",
        Some(name) if name.contains("emacs") => "emacs",
        Some(name) if name.contains("xcode") => "xcode",
        _ => "jetbrains",
    };
    out.push("keybindingPreset", preset, "keymap");
    out.settings
}

/// The settings an editor installed here would bring over, read from its files.
#[cfg(not(target_family = "wasm"))]
pub fn read_editor_settings(editor: Editor, themes: ThemeLookup) -> Option<(PathBuf, Vec<ImportedSetting>)> {
    for dir in editor.settings_dirs() {
        if editor == Editor::JetBrains {
            let read = |name: &str| std::fs::read_to_string(dir.join(name)).ok();
            let font = read("editor-font.xml").or_else(|| read("editor.xml"));
            let keymap = read("keymap.xml");
            if font.is_some() || keymap.is_some() {
                return Some((dir, jetbrains_settings(font.as_deref(), keymap.as_deref())));
            }
            continue;
        }
        let file = dir.join("settings.json");
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        let json = parse_jsonc(&text).ok()?;
        let settings = match editor {
            Editor::Zed => zed_settings(&json, themes),
            _ => {
                let mut settings = vscode_settings(&json, themes);
                // Someone coming from VS Code keeps its keys.
                settings.push(ImportedSetting { key: "keybindingPreset", value: "vscode".into(), from: "keybindings".into() });
                settings
            }
        };
        return Some((file, settings));
    }
    None
}

/// The editor's `keybindings.json`, for the editors whose bindings Athas reads (VS Code's format).
#[cfg(not(target_family = "wasm"))]
pub fn editor_keybindings_file(editor: Editor) -> Option<PathBuf> {
    if !matches!(editor, Editor::VsCode | Editor::Cursor | Editor::Windsurf) {
        return None;
    }
    editor.settings_dirs().into_iter().map(|dir| dir.join("keybindings.json")).find(|file| file.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn themes(name: &str) -> Option<String> {
        match name {
            "Tokyo Night" => Some("tokyo-night".into()),
            "One Light" => Some("one-light".into()),
            "One Dark" => Some("one-dark".into()),
            _ => None,
        }
    }

    const VSCODE_FIXTURE: &str = r##"{
        // VS Code writes JSONC.
        "editor.fontFamily": "'Fira Code', Menlo, monospace",
        "editor.fontSize": 15,
        "editor.lineHeight": 24,
        "editor.tabSize": 4,
        "editor.wordWrap": "on",
        "editor.minimap.enabled": false,
        "editor.fontLigatures": true,
        "editor.cursorStyle": "block",
        "editor.rulers": [80, { "column": 120, "color": "#f00" }],
        "editor.multiCursorModifier": "ctrlCmd",
        "editor.renderWhitespace": "selection",
        "files.autoSave": "afterDelay",
        "files.trimTrailingWhitespace": true,
        "workbench.colorTheme": "Tokyo Night",
        "workbench.preferredLightColorTheme": "Default Light Modern",
        "terminal.integrated.fontSize": 13,
        "terminal.integrated.cursorStyle": "line",
        "search.exclude": { "**/dist": true, "**/keep": false },
        "git.autofetch": true,
        "git.autofetchPeriod": 300,
        "[rust]": { "editor.tabSize": 8 },
        "workbench.colorCustomizations": {},
    }"##;

    fn value_of(settings: &[ImportedSetting], key: &str) -> Value {
        settings.iter().rev().find(|setting| setting.key == key).map(|setting| setting.value.clone()).unwrap_or(Value::Null)
    }

    #[test]
    fn vscode_fixture_maps_onto_athas_keys() {
        let json = parse_jsonc(VSCODE_FIXTURE).unwrap();
        let imported = vscode_settings(&json, &themes);
        assert_eq!(value_of(&imported, "fontFamily"), json!("Fira Code"));
        assert_eq!(value_of(&imported, "fontSize"), json!(15.0));
        assert_eq!(value_of(&imported, "editorLineHeight"), json!(1.6));
        assert_eq!(value_of(&imported, "tabSize"), json!(4.0));
        assert_eq!(value_of(&imported, "wordWrap"), json!(true));
        assert_eq!(value_of(&imported, "showMinimap"), json!(false));
        assert_eq!(value_of(&imported, "editorCursorStyle"), json!("block"));
        assert_eq!(value_of(&imported, "editorRulers"), json!([80.0, 120.0]));
        assert_eq!(value_of(&imported, "editorMultiCursorModifier"), json!("mod"));
        assert_eq!(value_of(&imported, "renderWhitespace"), json!("boundary"));
        assert_eq!(value_of(&imported, "autoSave"), json!(true));
        assert_eq!(value_of(&imported, "theme"), json!("tokyo-night"));
        assert_eq!(value_of(&imported, "autoThemeLight"), json!("athas-light"));
        assert_eq!(value_of(&imported, "terminalCursorStyle"), json!("bar"));
        assert_eq!(value_of(&imported, "searchExcludePatterns"), json!(["**/dist"]));
        assert_eq!(value_of(&imported, "gitAutoFetchInterval"), json!(5.0));

        let changes = changes(&Settings::default(), imported);
        // Every change holds a value Athas accepts, and none repeats the current value.
        let mut settings = Settings::default();
        apply(&mut settings, &changes);
        assert_eq!(settings.font_family, "Fira Code");
        assert_eq!(settings.tab_size, 4.0);
        assert_eq!(settings.editor_rulers, vec![80.0, 120.0]);
        assert!(changes.iter().all(|change| change.old != change.new));
        assert!(changes.iter().any(|change| change.key == "theme" && change.from == "workbench.colorTheme"));
    }

    const ZED_FIXTURE: &str = r#"{
        "base_keymap": "JetBrains",
        "vim_mode": true,
        "buffer_font_family": "Zed Plex Mono",
        "buffer_font_size": 16,
        "buffer_line_height": "comfortable",
        "ui_font_family": ".SystemUIFont",
        "tab_size": 2,
        "soft_wrap": "editor_width",
        "format_on_save": "on",
        "autosave": { "after_delay": { "milliseconds": 1000 } },
        "wrap_guides": [100],
        "cursor_shape": "bar",
        "theme": { "mode": "system", "light": "One Light", "dark": "One Dark" },
        "terminal": { "font_size": 12, "line_height": { "custom": 1.25 }, "blinking": "off" },
        "git": { "inline_blame": { "enabled": false } },
        "project_panel": { "indent_size": 12 },
    }"#;

    #[test]
    fn zed_fixture_maps_onto_athas_keys() {
        let json = parse_jsonc(ZED_FIXTURE).unwrap();
        let imported = zed_settings(&json, &themes);
        assert_eq!(value_of(&imported, "keybindingPreset"), json!("jetbrains"));
        assert_eq!(value_of(&imported, "vimMode"), json!(true));
        assert_eq!(value_of(&imported, "fontFamily"), json!("Zed Plex Mono"));
        assert_eq!(value_of(&imported, "editorLineHeight"), json!(1.6));
        assert_eq!(value_of(&imported, "uiFontFamily"), json!("system-ui"));
        assert_eq!(value_of(&imported, "wordWrap"), json!(true));
        assert_eq!(value_of(&imported, "formatOnSave"), json!(true));
        assert_eq!(value_of(&imported, "autoSave"), json!(true));
        assert_eq!(value_of(&imported, "editorRulers"), json!([100.0]));
        assert_eq!(value_of(&imported, "editorCursorStyle"), json!("line"));
        assert_eq!(value_of(&imported, "autoThemeLight"), json!("one-light"));
        assert_eq!(value_of(&imported, "autoThemeDark"), json!("one-dark"));
        assert_eq!(value_of(&imported, "syncSystemTheme"), json!(true));
        assert_eq!(value_of(&imported, "terminalLineHeight"), json!(1.3));
        assert_eq!(value_of(&imported, "terminalCursorBlink"), json!(false));
        assert_eq!(value_of(&imported, "enableInlineGitBlame"), json!(false));
        assert_eq!(value_of(&imported, "fileTreeIndentSize"), json!(12.0));
        // Zed with no base keymap uses its own.
        assert_eq!(value_of(&zed_settings(&json!({}), &themes), "keybindingPreset"), json!("zed"));
    }

    #[test]
    fn jetbrains_options_map_font_and_keymap() {
        let font = r#"<application><component name="DefaultFont"><option name="FONT_SIZE_2D" value="13.5" /><option name="FONT_FAMILY" value="JetBrains Mono" /><option name="LINE_SPACING" value="1.2" /></component></application>"#;
        let keymap = r#"<application><component name="KeymapManager"><active_keymap name="VSCode (macOS)" /></component></application>"#;
        let imported = jetbrains_settings(Some(font), Some(keymap));
        assert_eq!(value_of(&imported, "fontFamily"), json!("JetBrains Mono"));
        assert_eq!(value_of(&imported, "fontSize"), json!(13.5));
        assert_eq!(value_of(&imported, "editorLineHeight"), json!(1.4));
        assert_eq!(value_of(&imported, "keybindingPreset"), json!("vscode"));
        assert_eq!(value_of(&jetbrains_settings(None, None), "keybindingPreset"), json!("jetbrains"));
    }

    #[test]
    fn settings_export_round_trips() {
        let mut settings = Settings::default();
        settings.tab_size = 8.0;
        settings.theme = "tokyo-night".into();
        settings.extra.insert("someFutureKey".into(), json!(1));
        let exported = export_json(&settings, "2026-11-11T00:00:00.000Z").unwrap();
        let imported = parse_settings_import(&exported).unwrap();
        assert_eq!(imported.settings.tab_size, 8.0);
        assert_eq!(imported.settings.theme, "tokyo-night");
        assert!(imported.skipped.is_empty());

        let bare = parse_settings_import(r#"{ "wordWrap": true, "tabSize": "wide", "unknown": 1 }"#).unwrap();
        assert!(bare.settings.word_wrap);
        assert_eq!(bare.settings.tab_size, 2.0);
        assert_eq!(bare.skipped, vec!["tabSize".to_string()]);
        assert!(parse_settings_import(r#"{ "unknown": 1 }"#).is_err());
        assert!(parse_settings_import(r#"{ "format": "athas.settings", "version": 99, "settings": {} }"#).is_err());
    }

    #[test]
    fn timestamps_read_like_javascript() {
        assert_eq!(format_timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_timestamp(1_794_390_245_123), "2026-11-11T09:44:05.123Z");
    }
}
