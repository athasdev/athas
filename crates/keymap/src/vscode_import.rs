//! Reading keybindings files: Athas's own export and VS Code's `keybindings.json`, which Cursor
//! and Windsurf share (`utils/vscode-keybinding-import.ts`, `services/keybinding-import-export.ts`).

use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::{Keybinding, PRESET_IDS};

pub const EXPORT_FORMAT: &str = "athas.keybindings";
pub const EXPORT_VERSION: u64 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportPlatform {
    Mac,
    Windows,
    Linux,
}

impl ImportPlatform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            ImportPlatform::Mac
        } else if cfg!(target_os = "windows") {
            ImportPlatform::Windows
        } else {
            ImportPlatform::Linux
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ImportIssueReason {
    InvalidEntry,
    EmptyCommand,
    UnknownCommand,
    UnsupportedKey,
    UnsupportedWhen,
    UnsupportedArguments,
}

impl ImportIssueReason {
    fn label(self) -> &'static str {
        match self {
            ImportIssueReason::InvalidEntry => "invalid entries",
            ImportIssueReason::EmptyCommand => "empty commands",
            ImportIssueReason::UnknownCommand => "unknown command entries",
            ImportIssueReason::UnsupportedKey => "unsupported key entries",
            ImportIssueReason::UnsupportedWhen => "unsupported condition entries",
            ImportIssueReason::UnsupportedArguments => "unsupported argument entries",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ImportIssue {
    pub index: usize,
    pub reason: ImportIssueReason,
    pub command: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportFormat {
    Athas,
    VsCode,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KeybindingsImport {
    pub format: ImportFormat,
    pub preset: Option<String>,
    pub keybindings: Vec<Keybinding>,
    pub issues: Vec<ImportIssue>,
}

/// "Skipped 2 unknown command entries, 1 unsupported key entries."
pub fn issue_summary(issues: &[ImportIssue]) -> Option<String> {
    if issues.is_empty() {
        return None;
    }
    let mut counts: Vec<(ImportIssueReason, usize)> = Vec::new();
    for issue in issues {
        match counts.iter_mut().find(|(reason, _)| *reason == issue.reason) {
            Some((_, count)) => *count += 1,
            None => counts.push((issue.reason, 1)),
        }
    }
    let parts: Vec<String> = counts.iter().map(|(reason, count)| format!("{count} {}", reason.label())).collect();
    Some(format!("Skipped {}.", parts.join(", ")))
}

/// VS Code command ids and the Athas commands they map to.
const VSCODE_COMMANDS: &[(&str, &str)] = &[
    ("workbench.action.files.newUntitledFile", "file.new"),
    ("workbench.action.newWindow", "workbench.newWindow"),
    ("workbench.action.files.save", "file.save"),
    ("workbench.action.files.saveAs", "file.saveAs"),
    ("workbench.action.files.saveAll", "file.saveAll"),
    ("saveAll", "file.saveAll"),
    ("workbench.action.files.revert", "file.revert"),
    ("workbench.action.closeActiveEditor", "file.close"),
    ("workbench.action.closeWindow", "workbench.closeWindow"),
    ("workbench.action.closeAllEditors", "file.closeAll"),
    ("workbench.action.closeOtherEditors", "file.closeOthers"),
    ("workbench.action.closeUnmodifiedEditors", "file.closeSaved"),
    ("workbench.action.closeEditorsToTheLeft", "file.closeTabsToLeft"),
    ("workbench.action.closeEditorsToTheRight", "file.closeTabsToRight"),
    ("workbench.action.reopenClosedEditor", "file.reopenClosed"),
    ("workbench.action.files.openFolder", "file.openFolder"),
    ("workbench.action.openRecent", "file.open"),
    ("workbench.action.quickOpen", "file.quickOpen"),
    ("editor.action.selectAll", "editor.selectAll"),
    ("selectAll", "editor.selectAll"),
    ("undo", "editor.undo"),
    ("redo", "editor.redo"),
    ("editor.action.clipboardCopyAction", "editor.copy"),
    ("editor.action.clipboardCutAction", "editor.cut"),
    ("editor.action.clipboardPasteAction", "editor.paste"),
    ("editor.action.addSelectionToNextFindMatch", "editor.selectNextOccurrence"),
    ("editor.action.addSelectionToPreviousFindMatch", "editor.selectPreviousOccurrence"),
    ("editor.action.selectHighlights", "editor.selectAllOccurrences"),
    ("editor.action.duplicateSelection", "editor.duplicateLine"),
    ("editor.action.deleteLines", "editor.deleteLine"),
    ("editor.action.commentLine", "editor.toggleComment"),
    ("editor.foldAll", "editor.foldAll"),
    ("editor.unfoldAll", "editor.unfoldAll"),
    ("editor.action.moveLinesUpAction", "editor.moveLineUp"),
    ("editor.action.moveLinesDownAction", "editor.moveLineDown"),
    ("editor.action.copyLinesUpAction", "editor.copyLineUp"),
    ("editor.action.copyLinesDownAction", "editor.copyLineDown"),
    ("editor.action.insertCursorAbove", "editor.insertCursorAbove"),
    ("editor.action.insertCursorBelow", "editor.insertCursorBelow"),
    ("editor.action.insertCursorAtEndOfEachLineSelected", "editor.insertCursorsAtLineEnds"),
    ("removeSecondaryCursors", "editor.removeSecondaryCursors"),
    ("editor.action.formatDocument", "editor.formatDocument"),
    ("editor.action.formatSelection", "editor.formatSelection"),
    ("editor.action.triggerSuggest", "editor.triggerSuggest"),
    ("editor.action.triggerParameterHints", "editor.triggerParameterHints"),
    ("editor.action.showHover", "editor.showHover"),
    ("editor.action.quickFix", "editor.quickFix"),
    ("editor.action.inlineEdit.trigger", "editor.inlineEdit"),
    ("workbench.action.toggleSidebarVisibility", "workbench.toggleSidebar"),
    ("workbench.action.terminal.toggleTerminal", "workbench.toggleTerminal"),
    ("workbench.actions.view.problems", "workbench.toggleDiagnostics"),
    ("workbench.action.showCommands", "workbench.commandPalette"),
    ("notifications.showList", "workbench.showNotifications"),
    ("actions.find", "workbench.showFind"),
    ("editor.action.startFindReplaceAction", "workbench.showFindReplace"),
    ("workbench.action.findInFiles", "workbench.showGlobalSearch"),
    ("workbench.action.replaceInFiles", "workbench.showProjectSearch"),
    ("workbench.view.explorer", "workbench.showFileExplorer"),
    ("workbench.view.scm", "workbench.showSourceControl"),
    ("workbench.view.debug", "workbench.showDebugger"),
    ("workbench.action.selectTheme", "workbench.showThemeSelector"),
    ("editor.action.toggleMinimap", "workbench.toggleMinimap"),
    ("editor.action.toggleWordWrap", "editor.toggleWordWrap"),
    ("editor.action.toggleRenderWhitespace", "editor.toggleRenderWhitespace"),
    ("workbench.action.zoomIn", "workbench.zoomIn"),
    ("workbench.action.zoomOut", "workbench.zoomOut"),
    ("workbench.action.zoomReset", "workbench.zoomReset"),
    ("workbench.action.openGlobalKeybindings", "workbench.openKeyboardShortcuts"),
    ("workbench.action.gotoSymbol", "editor.showOutline"),
    ("workbench.action.nextEditor", "workbench.nextTab"),
    ("workbench.action.nextEditorInGroup", "workbench.nextTab"),
    ("workbench.action.previousEditor", "workbench.previousTab"),
    ("workbench.action.previousEditorInGroup", "workbench.previousTab"),
    ("editor.action.revealDefinition", "editor.goToDefinition"),
    ("editor.action.goToImplementation", "editor.goToImplementation"),
    ("editor.action.goToTypeDefinition", "editor.goToTypeDefinition"),
    ("editor.action.referenceSearch.trigger", "editor.goToReferences"),
    ("editor.action.findReferences", "editor.goToReferences"),
    ("editor.action.jumpToBracket", "editor.goToBracket"),
    ("editor.action.selectToBracket", "editor.selectToBracket"),
    ("editor.action.smartSelect.expand", "editor.expandSelection"),
    ("editor.action.smartSelect.shrink", "editor.shrinkSelection"),
    ("editor.action.rename", "editor.renameSymbol"),
    ("workbench.action.navigateBack", "navigation.goBack"),
    ("workbench.action.navigateForward", "navigation.goForward"),
    ("workbench.action.toggleZenMode", "workbench.toggleActivePaneFullscreen"),
    ("workbench.action.splitEditorRight", "workbench.splitEditorRight"),
    ("workbench.action.splitEditorDown", "workbench.splitEditorDown"),
    ("workbench.action.closeEditorsAndGroup", "workbench.closeEditorGroup"),
    ("workbench.action.closeEditorsInOtherGroups", "workbench.closeOtherEditorGroups"),
    ("workbench.action.moveEditorToNextGroup", "workbench.moveEditorToNextGroup"),
    ("workbench.action.moveEditorToPreviousGroup", "workbench.moveEditorToPreviousGroup"),
    ("workbench.action.evenEditorWidths", "workbench.resetEditorGroupSizes"),
    ("workbench.action.terminal.new", "terminal.new"),
    ("workbench.action.terminal.kill", "terminal.close"),
    ("workbench.action.terminal.focusFindWidget", "terminal.find"),
    ("workbench.action.terminal.split", "terminal.split"),
    ("workbench.action.debug.start", "debug.start"),
    ("workbench.action.debug.stop", "debug.stop"),
    ("editor.debug.action.toggleBreakpoint", "debug.toggleBreakpoint"),
    ("workbench.action.openSettings", "workbench.openSettings"),
    ("workbench.action.toggleFullScreen", "window.toggleFullscreen"),
    ("workbench.action.quit", "window.quit"),
    ("workbench.action.toggleMenuBar", "window.toggleMenuBar"),
];

/// The Athas command a VS Code command id runs, including the numbered families.
pub fn vscode_command(id: &str) -> Option<String> {
    if let Some((_, athas)) = VSCODE_COMMANDS.iter().find(|(vscode, _)| *vscode == id) {
        return Some(athas.to_string());
    }
    if let Some(level) = id.strip_prefix("editor.foldLevel")
        && matches!(level, "1" | "2" | "3" | "4" | "5" | "6" | "7")
    {
        return Some(id.to_string());
    }
    if let Some(index) = id.strip_prefix("workbench.action.openEditorAtIndex")
        && index.len() == 1
        && matches!(index.as_bytes()[0], b'1'..=b'9')
    {
        return Some(format!("workbench.switchToTab{index}"));
    }
    None
}

const CONTEXT_ALIASES: &[(&str, &str)] = &[
    ("editorTextFocus", "editorFocus"),
    ("editorFocus", "editorFocus"),
    ("terminalFocus", "terminalFocus"),
    ("editorHasSelection", "hasSelection"),
    ("sideBarFocus", "sidebarFocus"),
    ("findWidgetVisible", "findWidgetVisible"),
];

const SCAN_CODE_KEYS: &[(&str, &str)] = &[
    ("backquote", "`"),
    ("minus", "-"),
    ("equal", "="),
    ("bracketleft", "["),
    ("bracketright", "]"),
    ("backslash", "\\"),
    ("semicolon", ";"),
    ("quote", "'"),
    ("comma", ","),
    ("period", "."),
    ("slash", "/"),
    ("arrowleft", "left"),
    ("arrowup", "up"),
    ("arrowright", "right"),
    ("arrowdown", "down"),
    ("pageup", "pageup"),
    ("pagedown", "pagedown"),
    ("pause", "pause"),
];

const NAMED_KEYS: &[&str] = &[
    "left", "up", "right", "down", "pageup", "pagedown", "end", "home", "tab", "enter", "escape",
    "space", "backspace", "delete", "pause", "pausebreak", "capslock", "insert",
];

fn is_function_key(key: &str) -> bool {
    key.strip_prefix('f')
        .and_then(|number| number.parse::<u8>().ok().filter(|_| !number.starts_with('0')))
        .is_some_and(|number| (1..=19).contains(&number))
}

fn normalize_scan_code(value: &str) -> Option<String> {
    let code = value.get(1..value.len().saturating_sub(1))?.to_lowercase();
    if let Some(letter) = code.strip_prefix("key")
        && letter.len() == 1
        && letter.as_bytes()[0].is_ascii_lowercase()
    {
        return Some(letter.to_string());
    }
    if let Some(digit) = code.strip_prefix("digit")
        && digit.len() == 1
        && digit.as_bytes()[0].is_ascii_digit()
    {
        return Some(digit.to_string());
    }
    if is_function_key(&code) {
        return Some(code);
    }
    SCAN_CODE_KEYS
        .iter()
        .find(|(name, _)| *name == code)
        .map(|(_, key)| key.to_string())
        .or_else(|| NAMED_KEYS.contains(&code.as_str()).then_some(code))
}

fn normalize_combination(value: &str, platform: ImportPlatform) -> Option<String> {
    let mut modifiers: Vec<&str> = Vec::new();
    let mut key: Option<String> = None;
    let parts: Vec<String> = value.split('+').map(|part| part.trim().to_lowercase()).filter(|part| !part.is_empty()).collect();
    for part in &parts {
        match part.as_str() {
            "ctrl" | "shift" | "alt" | "cmd" => {
                let modifier = match part.as_str() {
                    "ctrl" => "ctrl",
                    "shift" => "shift",
                    "alt" => "alt",
                    _ => "cmd",
                };
                if !modifiers.contains(&modifier) {
                    modifiers.push(modifier);
                }
                continue;
            }
            "win" | "meta" => {
                if platform != ImportPlatform::Mac {
                    return None;
                }
                if !modifiers.contains(&"cmd") {
                    modifiers.push("cmd");
                }
                continue;
            }
            _ => {}
        }
        if key.is_some() {
            return None;
        }
        if part.starts_with('[') && part.ends_with(']') {
            key = Some(normalize_scan_code(part)?);
            continue;
        }
        let single = part.len() == 1 && {
            let byte = part.as_bytes()[0];
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"`-=[]\\;',./".contains(&byte)
        };
        if single || is_function_key(part) || NAMED_KEYS.contains(&part.as_str()) {
            key = Some(if part == "pausebreak" { "pause".into() } else { part.clone() });
            continue;
        }
        return None;
    }
    let key = key?;
    let mut chord: Vec<String> = modifiers.into_iter().map(str::to_string).collect();
    chord.push(key);
    Some(chord.join("+"))
}

fn normalize_vscode_key(value: &str, platform: ImportPlatform) -> Option<String> {
    let chords: Vec<&str> = value.split_whitespace().collect();
    if chords.is_empty() {
        return None;
    }
    chords
        .iter()
        .map(|chord| normalize_combination(chord, platform))
        .collect::<Option<Vec<_>>>()
        .map(|chords| chords.join(" "))
}

fn is_identifier_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_'
}

fn is_identifier_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '.'
}

/// Splits `text` into identifiers and the runs between them.
fn split_identifiers(text: &str) -> Vec<(bool, String)> {
    let mut pieces: Vec<(bool, String)> = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        if is_identifier_start(chars[index]) {
            let start = index;
            while index < chars.len() && is_identifier_char(chars[index]) {
                index += 1;
            }
            pieces.push((true, chars[start..index].iter().collect()));
        } else {
            let start = index;
            while index < chars.len() && !is_identifier_start(chars[index]) {
                index += 1;
            }
            pieces.push((false, chars[start..index].iter().collect()));
        }
    }
    pieces
}

/// Drops `word op` and `op word` (with the spaces around them) where `word` is a whole identifier.
fn drop_identity(text: &str, word: &str, op: &str) -> String {
    let mut result = text.to_string();
    loop {
        let pieces = split_identifiers(&result);
        let mut changed = false;
        for (index, (is_identifier, piece)) in pieces.iter().enumerate() {
            if !*is_identifier || piece != word {
                continue;
            }
            // `word op …`: remove the word, the operator and the spaces after it.
            if let Some((false, after)) = pieces.get(index + 1)
                && let Some(rest) = after.trim_start().strip_prefix(op)
            {
                let mut rebuilt: String = pieces[..index].iter().map(|(_, p)| p.as_str()).collect();
                rebuilt.push_str(rest.trim_start());
                rebuilt.extend(pieces[index + 2..].iter().map(|(_, p)| p.as_str()));
                result = rebuilt;
                changed = true;
                break;
            }
            // `… op word`: remove the spaces and operator before the word, and the word.
            if index > 0
                && let Some((false, before)) = pieces.get(index - 1)
                && let Some(rest) = before.trim_end().strip_suffix(op)
            {
                let mut rebuilt: String = pieces[..index - 1].iter().map(|(_, p)| p.as_str()).collect();
                rebuilt.push_str(rest.trim_end());
                rebuilt.extend(pieces[index + 1..].iter().map(|(_, p)| p.as_str()));
                result = rebuilt;
                changed = true;
                break;
            }
        }
        if !changed {
            return result;
        }
    }
}

/// A VS Code `when` clause in Athas's terms. `Ok(None)` for no clause, `Err(())` when the clause
/// uses something Athas cannot evaluate.
fn translate_when(value: Option<&Value>, platform: ImportPlatform) -> Result<Option<String>, ()> {
    let Some(value) = value else { return Ok(None) };
    let Some(text) = value.as_str() else { return Err(()) };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if ["==", "!=", "=~", "<", ">"].iter().any(|op| trimmed.contains(op)) {
        return Err(());
    }
    let pieces = split_identifiers(trimmed);
    if pieces.iter().any(|(is_identifier, piece)| *is_identifier && (piece == "in" || piece == "not")) {
        return Err(());
    }
    let platform_value = |name: &str| match name {
        "isMac" => Some(platform == ImportPlatform::Mac),
        "isWindows" => Some(platform == ImportPlatform::Windows),
        "isLinux" => Some(platform == ImportPlatform::Linux),
        _ => None,
    };
    let mut translated = String::new();
    for (index, (is_identifier, piece)) in pieces.iter().enumerate() {
        if !*is_identifier {
            // `!editorReadonly` always holds while editing, so it reads as `true`.
            if pieces.get(index + 1).is_some_and(|(_, next)| next == "editorReadonly") && piece.trim_end().ends_with('!') {
                translated.push_str(piece.trim_end().trim_end_matches('!'));
                continue;
            }
            translated.push_str(piece);
            continue;
        }
        if piece == "editorReadonly" && index > 0 && pieces[index - 1].1.trim_end().ends_with('!') {
            translated.push_str("true");
            continue;
        }
        if let Some((_, alias)) = CONTEXT_ALIASES.iter().find(|(name, _)| name == piece) {
            translated.push_str(alias);
        } else if let Some(value) = platform_value(piece) {
            translated.push_str(if value { "true" } else { "false" });
        } else {
            translated.push_str(piece);
        }
    }
    let translated = drop_identity(&translated, "true", "&&");
    let translated = drop_identity(&translated, "false", "||").trim().to_string();
    let supported = |identifier: &str| {
        identifier == "true" || identifier == "false" || CONTEXT_ALIASES.iter().any(|(_, alias)| *alias == identifier)
    };
    let pieces = split_identifiers(&translated);
    if pieces.iter().any(|(is_identifier, piece)| *is_identifier && !supported(piece)) {
        return Err(());
    }
    if translated.chars().any(|c| !(c.is_ascii_alphanumeric() || "_.!&|() \t\n".contains(c))) {
        return Err(());
    }
    // A clause that always holds is no clause.
    Ok(Some(translated).filter(|clause| !clause.is_empty() && clause != "true"))
}

fn translate_command(command: &str, command_ids: &HashSet<&str>) -> Option<String> {
    if command_ids.contains(command) {
        return Some(command.to_string());
    }
    vscode_command(command).filter(|athas| command_ids.contains(athas.as_str()))
}

/// Imports VS Code `keybindings.json` entries. Later entries win in VS Code, so they are read last
/// to first. A file that uses VS Code's own syntax (its command ids, removals, per-platform keys)
/// adds to the defaults instead of replacing them.
pub fn import_vscode_keybindings(
    values: &[Value],
    command_ids: &HashSet<&str>,
    platform: ImportPlatform,
) -> (ImportFormat, Vec<Keybinding>, Vec<ImportIssue>) {
    let mut keybindings = Vec::new();
    let mut issues = Vec::new();
    let mut uses_vscode_syntax = false;
    for (index, value) in values.iter().enumerate().rev() {
        let issue = |reason, command: Option<&str>| ImportIssue { index, reason, command: command.map(str::to_string) };
        let Some(entry) = value.as_object() else {
            issues.push(issue(ImportIssueReason::InvalidEntry, None));
            continue;
        };
        let Some(raw_command) = entry.get("command").and_then(Value::as_str) else {
            issues.push(issue(ImportIssueReason::InvalidEntry, None));
            continue;
        };
        let raw_command = raw_command.trim();
        if raw_command.is_empty() {
            issues.push(issue(ImportIssueReason::EmptyCommand, None));
            continue;
        }
        let removal = raw_command.starts_with('-');
        let source_command = if removal { raw_command[1..].trim() } else { raw_command };
        let command = translate_command(source_command, command_ids);
        if removal
            || command.as_deref() != Some(source_command)
            || ["mac", "win", "linux", "systemWide"].iter().any(|key| entry.contains_key(*key))
        {
            uses_vscode_syntax = true;
        }
        let Some(command) = command else {
            issues.push(issue(ImportIssueReason::UnknownCommand, Some(source_command)));
            continue;
        };
        let platform_key = match platform {
            ImportPlatform::Mac => "mac",
            ImportPlatform::Windows => "win",
            ImportPlatform::Linux => "linux",
        };
        let raw_key = entry.get(platform_key).or_else(|| entry.get("key")).and_then(Value::as_str);
        let Some(key) = raw_key.and_then(|key| normalize_vscode_key(key, platform)) else {
            issues.push(issue(ImportIssueReason::UnsupportedKey, Some(source_command)));
            continue;
        };
        let Ok(when) = translate_when(entry.get("when"), platform) else {
            issues.push(issue(ImportIssueReason::UnsupportedWhen, Some(source_command)));
            continue;
        };
        let native = command == source_command;
        if !removal && entry.contains_key("args") && !native {
            issues.push(issue(ImportIssueReason::UnsupportedArguments, Some(source_command)));
            continue;
        }
        keybindings.push(Keybinding {
            key,
            command,
            when,
            args: (!removal && native).then(|| entry.get("args").cloned()).flatten(),
            source: "user".into(),
            enabled: Some(!removal),
            replace_defaults: None,
        });
    }
    if uses_vscode_syntax {
        for keybinding in &mut keybindings {
            keybinding.replace_defaults = Some(false);
        }
        (ImportFormat::VsCode, keybindings, issues)
    } else {
        keybindings.reverse();
        (ImportFormat::Athas, keybindings, issues)
    }
}

/// A user binding as Athas stores it, from any JSON value; `None` when it names no key or command.
pub fn normalize_user_binding(value: &Value) -> Option<Keybinding> {
    let entry = value.as_object()?;
    let key = entry.get("key")?.as_str()?.trim();
    let command = entry.get("command")?.as_str()?.trim();
    if key.is_empty() || command.is_empty() {
        return None;
    }
    Some(Keybinding {
        key: key.to_string(),
        command: command.to_string(),
        when: entry.get("when").and_then(Value::as_str).map(str::trim).filter(|when| !when.is_empty()).map(str::to_string),
        args: entry.get("args").cloned(),
        source: "user".into(),
        enabled: Some(entry.get("enabled").and_then(Value::as_bool).unwrap_or(true)),
        replace_defaults: (entry.get("replaceDefaults") == Some(&Value::Bool(false))).then_some(false),
    })
}

/// Reads a keybindings file: Athas's export (`{"format": "athas.keybindings", …}`) or a VS Code
/// style array. `None` when it is neither.
pub fn parse_keybindings_import(value: &Value, command_ids: &HashSet<&str>, platform: ImportPlatform) -> Option<KeybindingsImport> {
    if let Some(values) = value.as_array() {
        let (format, keybindings, issues) = import_vscode_keybindings(values, command_ids, platform);
        return Some(KeybindingsImport { format, preset: None, keybindings, issues });
    }
    let object = value.as_object()?;
    if object.get("format").and_then(Value::as_str) != Some(EXPORT_FORMAT)
        || object.get("version").and_then(Value::as_u64) != Some(EXPORT_VERSION)
    {
        return None;
    }
    let entries = object.get("keybindings")?.as_array()?;
    let mut keybindings = Vec::new();
    let mut issues = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        match normalize_user_binding(entry) {
            Some(binding) => keybindings.push(binding),
            None => issues.push(ImportIssue { index, reason: ImportIssueReason::InvalidEntry, command: None }),
        }
    }
    let preset = object
        .get("keybindingPreset")
        .and_then(Value::as_str)
        .filter(|preset| PRESET_IDS.contains(preset))
        .map(str::to_string);
    Some(KeybindingsImport { format: ImportFormat::Athas, preset, keybindings, issues })
}

/// The imported bindings first, then the current ones for commands the import does not touch.
pub fn merge_imported(current: &[Keybinding], imported: &[Keybinding]) -> Vec<Keybinding> {
    let commands: HashSet<&str> = imported.iter().map(|binding| binding.command.as_str()).collect();
    let mut merged = imported.to_vec();
    merged.extend(current.iter().filter(|binding| !commands.contains(binding.command.as_str())).cloned());
    merged
}

/// The file Export writes: the preset and the user's own bindings.
pub fn export_payload(preset: &str, bindings: &[Keybinding], exported_at: &str) -> Value {
    let mut payload = Map::new();
    payload.insert("format".into(), EXPORT_FORMAT.into());
    payload.insert("version".into(), EXPORT_VERSION.into());
    payload.insert("exportedAt".into(), exported_at.into());
    payload.insert("keybindingPreset".into(), preset.into());
    payload.insert(
        "keybindings".into(),
        Value::Array(
            bindings
                .iter()
                .filter_map(|binding| serde_json::to_value(binding).ok())
                .filter_map(|value| normalize_user_binding(&value))
                .filter_map(|binding| serde_json::to_value(binding).ok())
                .collect(),
        ),
    );
    Value::Object(payload)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn ids() -> HashSet<&'static str> {
        crate::commands().iter().map(|command| command.id.as_str()).collect()
    }

    #[test]
    fn vscode_fixture_imports_with_removals_and_platform_keys() {
        let fixture = json!([
            { "key": "cmd+shift+s", "command": "workbench.action.files.saveAll" },
            { "key": "ctrl+k", "mac": "cmd+k cmd+w", "command": "workbench.action.closeAllEditors" },
            { "key": "cmd+b", "command": "-workbench.action.toggleSidebarVisibility" },
            { "key": "cmd+[KeyJ]", "command": "workbench.action.terminal.toggleTerminal", "when": "editorTextFocus && !editorReadonly" },
            { "key": "cmd+e", "command": "some.extension.command" },
            { "key": "hyper+x", "command": "workbench.action.files.save" },
            { "key": "cmd+u", "command": "workbench.action.quickOpen", "when": "resourceExtname == .ts" },
            { "key": "cmd+i", "command": "workbench.action.quickOpen", "args": { "query": "x" } },
            "not an entry"
        ]);
        let import = parse_keybindings_import(&fixture, &ids(), ImportPlatform::Mac).unwrap();
        assert_eq!(import.format, ImportFormat::VsCode);
        let keys: Vec<(&str, &str, Option<bool>)> = import
            .keybindings
            .iter()
            .map(|binding| (binding.key.as_str(), binding.command.as_str(), binding.enabled))
            .collect();
        assert_eq!(
            keys,
            vec![
                ("cmd+j", "workbench.toggleTerminal", Some(true)),
                ("cmd+b", "workbench.toggleSidebar", Some(false)),
                ("cmd+k cmd+w", "file.closeAll", Some(true)),
                ("cmd+shift+s", "file.saveAll", Some(true)),
            ]
        );
        assert!(import.keybindings.iter().all(|binding| binding.replace_defaults == Some(false)));
        assert_eq!(import.keybindings[0].when.as_deref(), Some("editorFocus"));
        let reasons: Vec<ImportIssueReason> = import.issues.iter().map(|issue| issue.reason).collect();
        assert_eq!(
            reasons,
            vec![
                ImportIssueReason::InvalidEntry,
                ImportIssueReason::UnsupportedArguments,
                ImportIssueReason::UnsupportedWhen,
                ImportIssueReason::UnsupportedKey,
                ImportIssueReason::UnknownCommand,
            ]
        );
        assert_eq!(
            issue_summary(&import.issues).unwrap(),
            "Skipped 1 invalid entries, 1 unsupported argument entries, 1 unsupported condition entries, 1 unsupported key entries, 1 unknown command entries."
        );
    }

    #[test]
    fn windows_keys_and_numbered_commands() {
        let fixture = json!([
            { "key": "ctrl+1", "command": "workbench.action.files.saveAs" },
            { "key": "win+e", "command": "workbench.view.explorer" },
            { "key": "ctrl+[Backquote]", "command": "workbench.action.terminal.toggleTerminal", "when": "isWindows" }
        ]);
        let import = parse_keybindings_import(&fixture, &ids(), ImportPlatform::Windows).unwrap();
        let keys: Vec<&str> = import.keybindings.iter().map(|binding| binding.key.as_str()).collect();
        assert_eq!(keys, vec!["ctrl+`", "ctrl+1"]);
        assert_eq!(import.keybindings[0].when, None);
        assert_eq!(import.keybindings[1].command, "file.saveAs");
        assert_eq!(vscode_command("workbench.action.openEditorAtIndex3").as_deref(), Some("workbench.switchToTab3"));
        assert_eq!(vscode_command("editor.foldLevel2").as_deref(), Some("editor.foldLevel2"));
        assert_eq!(vscode_command("editor.foldLevel9"), None);
        assert_eq!(import.issues[0].reason, ImportIssueReason::UnsupportedKey);
    }

    #[test]
    fn athas_ids_in_a_plain_array_replace_defaults() {
        let fixture = json!([
            { "key": "cmd+alt+b", "command": "workbench.toggleSidebar" },
            { "key": "cmd+alt+p", "command": "workbench.commandPalette" }
        ]);
        let import = parse_keybindings_import(&fixture, &ids(), ImportPlatform::Mac).unwrap();
        assert_eq!(import.format, ImportFormat::Athas);
        assert_eq!(import.keybindings[0].command, "workbench.toggleSidebar");
        assert_eq!(import.keybindings[0].replace_defaults, None);
    }

    #[test]
    fn export_round_trips() {
        let bindings = vec![Keybinding {
            key: "cmd+alt+b".into(),
            command: "workbench.toggleSidebar".into(),
            when: Some("editorFocus".into()),
            args: None,
            source: "user".into(),
            enabled: Some(true),
            replace_defaults: Some(false),
        }];
        let payload = export_payload("vscode", &bindings, "2026-11-11T00:00:00.000Z");
        let import = parse_keybindings_import(&payload, &ids(), ImportPlatform::Mac).unwrap();
        assert_eq!(import.preset.as_deref(), Some("vscode"));
        assert_eq!(import.keybindings, bindings);
        assert!(parse_keybindings_import(&json!({ "format": "other" }), &ids(), ImportPlatform::Mac).is_none());
    }

    #[test]
    fn merging_keeps_untouched_commands() {
        let binding = |key: &str, command: &str| Keybinding {
            key: key.into(),
            command: command.into(),
            when: None,
            args: None,
            source: "user".into(),
            enabled: Some(true),
            replace_defaults: None,
        };
        let merged = merge_imported(&[binding("cmd+1", "a"), binding("cmd+2", "b")], &[binding("cmd+3", "b")]);
        let keys: Vec<&str> = merged.iter().map(|binding| binding.key.as_str()).collect();
        assert_eq!(keys, vec!["cmd+3", "cmd+1"]);
    }
}
