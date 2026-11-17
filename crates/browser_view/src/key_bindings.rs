//! The workbench shortcuts a focused page hands back to Athas.
//!
//! Ported from Athas's `features/browser/utils/browser-key-bindings.ts` and
//! `workbench-navigation-commands.ts`.

use std::collections::HashMap;

use athas_browser::BrowserKeyBinding;
use keymap::{Keybinding, when::ContextValue};

/// Commands that move around the workbench or drive a browser tab. A focused page hands their
/// keys back to Athas instead of keeping them.
pub fn is_navigation_command(command: &str) -> bool {
    matches!(
        command,
        "workbench.commandPalette"
            | "file.quickOpen"
            | "workbench.newTab"
            | "workbench.newWindow"
            | "workbench.closeWindow"
            | "file.close"
            | "file.reopenClosed"
            | "workbench.nextTab"
            | "workbench.previousTab"
            | "workbench.nextTabCtrlTab"
            | "workbench.previousTabCtrlTab"
            | "workbench.toggleSidebar"
            | "workbench.toggleTerminal"
            | "workbench.showGlobalSearch"
            | "workbench.zoomIn"
            | "workbench.zoomOut"
            | "workbench.zoomReset"
            | "browser.focusAddressBar"
            | "browser.reload"
            | "browser.back"
            | "browser.forward"
            | "browser.openDevTools"
    ) || command.strip_prefix("workbench.switchToTab").is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
}

/// Forwarded commands that act on the page itself, so the page keeps keyboard focus.
pub fn is_page_command(command: &str) -> bool {
    command.starts_with("browser.") || matches!(command, "workbench.zoomIn" | "workbench.zoomOut" | "workbench.zoomReset")
}

/// Keys a page reports by physical position, because Shift or the layout changes their character.
fn key_code(key: &str) -> Option<String> {
    let code = match key {
        "`" => "Backquote",
        "-" => "Minus",
        "=" => "Equal",
        "[" => "BracketLeft",
        "]" => "BracketRight",
        "\\" => "Backslash",
        ";" => "Semicolon",
        "'" => "Quote",
        "," => "Comma",
        "." => "Period",
        "/" => "Slash",
        digit if digit.len() == 1 && digit.as_bytes()[0].is_ascii_digit() => return Some(format!("Digit{digit}")),
        _ => return None,
    };
    Some(code.to_string())
}

/// A binding as the page's bridge matches it, or `None` for chords and bindings without a key.
pub fn to_browser_key_binding(key: &str, command: &str) -> Option<BrowserKeyBinding> {
    let mut chords = key.split_whitespace();
    let chord = chords.next()?;
    if chords.next().is_some() {
        return None;
    }
    let (modifiers, key) = match chord.strip_suffix("++") {
        Some(modifiers) => (modifiers, "+"),
        None => match chord.rsplit_once('+') {
            Some((modifiers, key)) => (modifiers, key),
            None => ("", chord),
        },
    };
    if key.is_empty() {
        return None;
    }
    let modifiers: Vec<String> = modifiers.split('+').filter(|part| !part.is_empty()).map(str::to_ascii_lowercase).collect();
    let has = |name: &str| modifiers.iter().any(|modifier| modifier == name);
    let command_key = has("cmd") || has("meta") || has("mod");
    let key = key.to_lowercase();
    Some(BrowserKeyBinding {
        command: command.to_string(),
        code: key_code(&key),
        key,
        meta: if cfg!(target_os = "macos") { command_key } else { has("meta") },
        ctrl: has("ctrl") || (!cfg!(target_os = "macos") && (has("cmd") || has("mod"))),
        alt: has("alt") || has("option"),
        shift: has("shift"),
    })
}

/// The current bindings of the forwarded commands, as a page should match them.
pub fn browser_key_bindings(bindings: &[Keybinding]) -> Vec<BrowserKeyBinding> {
    let context: HashMap<String, ContextValue> = HashMap::from([("browserFocus".to_string(), ContextValue::Bool(true))]);
    bindings
        .iter()
        .filter(|binding| is_navigation_command(&binding.command))
        .filter(|binding| binding.enabled != Some(false))
        .filter(|binding| keymap::when::evaluate(binding.when.as_deref(), &context))
        .filter_map(|binding| to_browser_key_binding(&binding.key, &binding.command))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(key: &str, command: &str, when: Option<&str>) -> Keybinding {
        serde_json::from_value(serde_json::json!({ "key": key, "command": command, "when": when })).unwrap()
    }

    #[test]
    fn converts_a_shortcut_for_the_page() {
        let shortcut = to_browser_key_binding("cmd+shift+p", "workbench.commandPalette").unwrap();
        assert_eq!(shortcut.key, "p");
        assert_eq!(shortcut.code, None);
        assert!(shortcut.shift && !shortcut.alt);
        assert_eq!(shortcut.meta, cfg!(target_os = "macos"));
        assert_eq!(shortcut.ctrl, !cfg!(target_os = "macos"));
    }

    #[test]
    fn matches_punctuation_and_digits_by_position() {
        assert_eq!(to_browser_key_binding("cmd+[", "browser.back").unwrap().code.as_deref(), Some("BracketLeft"));
        assert_eq!(to_browser_key_binding("cmd+=", "workbench.zoomIn").unwrap().code.as_deref(), Some("Equal"));
        assert_eq!(to_browser_key_binding("cmd+1", "workbench.switchToTab1").unwrap().code.as_deref(), Some("Digit1"));
        assert_eq!(to_browser_key_binding("cmd++", "workbench.zoomIn").unwrap().key, "+");
    }

    #[test]
    fn skips_chords() {
        assert_eq!(to_browser_key_binding("cmd+k cmd+t", "workbench.showThemeSelector"), None);
    }

    #[test]
    fn forwards_only_navigation_commands_that_apply_in_a_page() {
        let bindings = [
            binding("cmd+l", "browser.focusAddressBar", Some("browserFocus")),
            binding("cmd+p", "file.quickOpen", None),
            binding("cmd+s", "file.save", None),
            binding("cmd+k", "terminal.clear", Some("terminalFocus")),
            binding("cmd+b", "workbench.toggleSidebar", Some("!browserFocus")),
            serde_json::from_value(serde_json::json!({ "key": "cmd+j", "command": "workbench.toggleTerminal", "enabled": false })).unwrap(),
        ];
        let commands: Vec<String> = browser_key_bindings(&bindings).into_iter().map(|binding| binding.command).collect();
        assert_eq!(commands, ["browser.focusAddressBar", "file.quickOpen"]);
    }

    #[test]
    fn page_commands_keep_focus_in_the_page() {
        assert!(is_page_command("browser.reload"));
        assert!(is_page_command("workbench.zoomIn"));
        assert!(!is_page_command("workbench.commandPalette"));
        assert!(is_navigation_command("workbench.switchToTab9"));
        assert!(!is_navigation_command("workbench.switchToTab10"));
    }
}
