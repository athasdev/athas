//! Keystrokes to the bytes a terminal program expects.
//!
//! The table is adapted from Zed's `terminal/src/mappings/keys.rs` (GPL-3.0-or-later, Zed
//! Industries), which was in turn written from Alacritty's bindings. The macOS editing shortcuts
//! (cmd-left, cmd-backspace, option-left and so on) and the modified Enter encoding follow Athas's
//! `services/terminal-keyboard.ts`.

use std::borrow::Cow;

use alacritty_terminal::term::TermMode;
use gpui::Keystroke;

#[derive(Debug, PartialEq, Eq)]
enum Modifiers {
    None,
    Alt,
    Ctrl,
    Shift,
    CtrlShift,
    Platform,
    Other,
}

impl Modifiers {
    fn new(keystroke: &Keystroke) -> Self {
        let modifiers = &keystroke.modifiers;
        match (modifiers.alt, modifiers.control, modifiers.shift, modifiers.platform) {
            (false, false, false, false) => Modifiers::None,
            (true, false, false, false) => Modifiers::Alt,
            (false, true, false, false) => Modifiers::Ctrl,
            (false, false, true, false) => Modifiers::Shift,
            (false, true, true, false) => Modifiers::CtrlShift,
            (false, false, false, true) => Modifiers::Platform,
            _ => Modifiers::Other,
        }
    }

    fn any(&self) -> bool {
        *self != Modifiers::None
    }
}

/// The bytes for a keystroke, or `None` when the key is ordinary text (left to the input handler,
/// so IME and dead keys work) or a shortcut the terminal does not take.
///
/// `option_as_meta` sends Alt-letter as ESC-letter; on macOS Option types characters instead.
pub(crate) fn to_esc_str(keystroke: &Keystroke, mode: TermMode, option_as_meta: bool) -> Option<Cow<'static, str>> {
    let modifiers = Modifiers::new(keystroke);
    let key = keystroke.key.as_str();
    let app_cursor = mode.contains(TermMode::APP_CURSOR);

    // Athas's macOS line-editing shortcuts.
    if cfg!(target_os = "macos") {
        let athas = match (key, &modifiers) {
            ("backspace", Modifiers::Platform) => Some("\x15"),
            ("a", Modifiers::Platform) | ("left", Modifiers::Platform) => Some("\x01"),
            ("e", Modifiers::Platform) | ("right", Modifiers::Platform) => Some("\x05"),
            ("backspace", Modifiers::Alt) => Some("\x17"),
            ("left", Modifiers::Alt) => Some("\x1bb"),
            ("right", Modifiers::Alt) => Some("\x1bf"),
            _ => None,
        };
        if let Some(sequence) = athas {
            return Some(Cow::Borrowed(sequence));
        }
    }

    // Enter with modifiers, as the CSI u sequence agents and editors understand.
    if key == "enter" && !keystroke.modifiers.platform {
        let code = modifier_code(keystroke);
        if code > 1 {
            return Some(Cow::Owned(format!("\x1b[13;{code}u")));
        }
    }

    let manual: Option<&'static str> = match (key, &modifiers) {
        ("tab", Modifiers::None) => Some("\x09"),
        ("escape", Modifiers::None) => Some("\x1b"),
        ("enter", Modifiers::None) => Some("\x0d"),
        ("backspace", Modifiers::None) => Some("\x7f"),
        ("tab", Modifiers::Shift) => Some("\x1b[Z"),
        ("backspace", Modifiers::Ctrl) => Some("\x08"),
        ("backspace", Modifiers::Alt) => Some("\x1b\x7f"),
        ("backspace", Modifiers::Shift) => Some("\x7f"),
        ("space", Modifiers::Ctrl) => Some("\x00"),
        ("home", Modifiers::None) => Some(if app_cursor { "\x1bOH" } else { "\x1b[H" }),
        ("end", Modifiers::None) => Some(if app_cursor { "\x1bOF" } else { "\x1b[F" }),
        ("up", Modifiers::None) => Some(if app_cursor { "\x1bOA" } else { "\x1b[A" }),
        ("down", Modifiers::None) => Some(if app_cursor { "\x1bOB" } else { "\x1b[B" }),
        ("right", Modifiers::None) => Some(if app_cursor { "\x1bOC" } else { "\x1b[C" }),
        ("left", Modifiers::None) => Some(if app_cursor { "\x1bOD" } else { "\x1b[D" }),
        ("insert", Modifiers::None) => Some("\x1b[2~"),
        ("delete", Modifiers::None) => Some("\x1b[3~"),
        ("pageup", Modifiers::None) => Some("\x1b[5~"),
        ("pagedown", Modifiers::None) => Some("\x1b[6~"),
        ("f1", Modifiers::None) => Some("\x1bOP"),
        ("f2", Modifiers::None) => Some("\x1bOQ"),
        ("f3", Modifiers::None) => Some("\x1bOR"),
        ("f4", Modifiers::None) => Some("\x1bOS"),
        ("f5", Modifiers::None) => Some("\x1b[15~"),
        ("f6", Modifiers::None) => Some("\x1b[17~"),
        ("f7", Modifiers::None) => Some("\x1b[18~"),
        ("f8", Modifiers::None) => Some("\x1b[19~"),
        ("f9", Modifiers::None) => Some("\x1b[20~"),
        ("f10", Modifiers::None) => Some("\x1b[21~"),
        ("f11", Modifiers::None) => Some("\x1b[23~"),
        ("f12", Modifiers::None) => Some("\x1b[24~"),
        ("f13", Modifiers::None) => Some("\x1b[25~"),
        ("f14", Modifiers::None) => Some("\x1b[26~"),
        ("f15", Modifiers::None) => Some("\x1b[28~"),
        ("f16", Modifiers::None) => Some("\x1b[29~"),
        ("f17", Modifiers::None) => Some("\x1b[31~"),
        ("f18", Modifiers::None) => Some("\x1b[32~"),
        ("f19", Modifiers::None) => Some("\x1b[33~"),
        ("f20", Modifiers::None) => Some("\x1b[34~"),
        _ => None,
    };
    if let Some(sequence) = manual {
        return Some(Cow::Borrowed(sequence));
    }

    // Caret notation: ctrl-a is 0x01 through ctrl-_ at 0x1f.
    if matches!(modifiers, Modifiers::Ctrl | Modifiers::CtrlShift)
        && let Some(byte) = control_byte(key)
    {
        return Some(Cow::Owned((byte as char).to_string()));
    }

    if modifiers.any() && !keystroke.modifiers.platform {
        let code = modifier_code(keystroke);
        let modified = match key {
            "up" => Some(format!("\x1b[1;{code}A")),
            "down" => Some(format!("\x1b[1;{code}B")),
            "right" => Some(format!("\x1b[1;{code}C")),
            "left" => Some(format!("\x1b[1;{code}D")),
            "f1" => Some(format!("\x1b[1;{code}P")),
            "f2" => Some(format!("\x1b[1;{code}Q")),
            "f3" => Some(format!("\x1b[1;{code}R")),
            "f4" => Some(format!("\x1b[1;{code}S")),
            "f5" => Some(format!("\x1b[15;{code}~")),
            "f6" => Some(format!("\x1b[17;{code}~")),
            "f7" => Some(format!("\x1b[18;{code}~")),
            "f8" => Some(format!("\x1b[19;{code}~")),
            "f9" => Some(format!("\x1b[20;{code}~")),
            "f10" => Some(format!("\x1b[21;{code}~")),
            "f11" => Some(format!("\x1b[23;{code}~")),
            "f12" => Some(format!("\x1b[24;{code}~")),
            "insert" => Some(format!("\x1b[2;{code}~")),
            "delete" => Some(format!("\x1b[3;{code}~")),
            "pageup" => Some(format!("\x1b[5;{code}~")),
            "pagedown" => Some(format!("\x1b[6;{code}~")),
            "end" => Some(format!("\x1b[1;{code}F")),
            "home" => Some(format!("\x1b[1;{code}H")),
            _ => None,
        };
        if let Some(sequence) = modified {
            return Some(Cow::Owned(sequence));
        }
    }

    // Alt as Meta: ESC followed by the key.
    if option_as_meta && keystroke.modifiers.alt && !keystroke.modifiers.platform && key.is_ascii() && key.len() == 1 {
        let character = key.chars().next()?;
        if modifiers == Modifiers::Alt {
            return Some(Cow::Owned(format!("\x1b{character}")));
        } else if keystroke.modifiers.shift && !keystroke.modifiers.control {
            return Some(Cow::Owned(format!("\x1b{}", character.to_ascii_uppercase())));
        } else if keystroke.modifiers.control
            && let Some(byte) = control_byte(key)
        {
            return Some(Cow::Owned(format!("\x1b{}", byte as char)));
        }
    }

    None
}

/// The C0 control byte for ctrl plus `key`.
fn control_byte(key: &str) -> Option<u8> {
    let [byte] = key.as_bytes() else { return None };
    match byte.to_ascii_lowercase() {
        letter @ b'a'..=b'z' => Some(letter - b'a' + 1),
        b'@' | b'2' => Some(0x00),
        b'[' | b'3' => Some(0x1b),
        b'\\' | b'4' => Some(0x1c),
        b']' | b'5' => Some(0x1d),
        b'^' | b'6' => Some(0x1e),
        b'_' | b'-' | b'7' => Some(0x1f),
        b'?' | b'8' => Some(0x7f),
        _ => None,
    }
}

/// xterm's modifier parameter: 1 plus shift 1, alt 2, ctrl 4.
fn modifier_code(keystroke: &Keystroke) -> u32 {
    let modifiers = &keystroke.modifiers;
    1 + modifiers.shift as u32 + ((modifiers.alt as u32) << 1) + ((modifiers.control as u32) << 2)
}

/// What a paste sends: bracketed when the program asked for it (with any escape characters
/// removed so the paste cannot end the bracket), otherwise with newlines as carriage returns.
pub(crate) fn paste_bytes(text: &str, mode: TermMode) -> Vec<u8> {
    if mode.contains(TermMode::BRACKETED_PASTE) {
        let mut bytes = b"\x1b[200~".to_vec();
        bytes.extend(text.bytes().filter(|byte| *byte != 0x1b));
        bytes.extend_from_slice(b"\x1b[201~");
        bytes
    } else {
        text.replace("\r\n", "\r").replace('\n', "\r").into_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn esc(keystroke: &'static str, mode: TermMode) -> Option<String> {
        to_esc_str(&Keystroke::parse(keystroke).unwrap(), mode, false).map(Cow::into_owned)
    }

    fn plain(keystroke: &'static str) -> Option<String> {
        esc(keystroke, TermMode::empty())
    }

    #[test]
    fn text_is_left_to_the_input_handler() {
        assert_eq!(plain("a"), None);
        assert_eq!(plain("shift-a"), None);
        assert_eq!(plain("space"), None);
        let emoji = Keystroke { key: "🖖🏻".into(), ..Default::default() };
        assert_eq!(to_esc_str(&emoji, TermMode::empty(), false), None);
    }

    #[test]
    fn special_keys() {
        assert_eq!(plain("enter").as_deref(), Some("\r"));
        assert_eq!(plain("backspace").as_deref(), Some("\x7f"));
        assert_eq!(plain("tab").as_deref(), Some("\t"));
        assert_eq!(plain("shift-tab").as_deref(), Some("\x1b[Z"));
        assert_eq!(plain("escape").as_deref(), Some("\x1b"));
        assert_eq!(plain("delete").as_deref(), Some("\x1b[3~"));
        assert_eq!(plain("pageup").as_deref(), Some("\x1b[5~"));
        assert_eq!(plain("f1").as_deref(), Some("\x1bOP"));
        assert_eq!(plain("f12").as_deref(), Some("\x1b[24~"));
        assert_eq!(plain("shift-f5").as_deref(), Some("\x1b[15;2~"));
    }

    #[test]
    fn cursor_keys_follow_application_mode() {
        assert_eq!(plain("up").as_deref(), Some("\x1b[A"));
        assert_eq!(plain("left").as_deref(), Some("\x1b[D"));
        assert_eq!(plain("home").as_deref(), Some("\x1b[H"));
        assert_eq!(esc("up", TermMode::APP_CURSOR).as_deref(), Some("\x1bOA"));
        assert_eq!(esc("end", TermMode::APP_CURSOR).as_deref(), Some("\x1bOF"));
        assert_eq!(plain("shift-up").as_deref(), Some("\x1b[1;2A"));
        assert_eq!(plain("ctrl-right").as_deref(), Some("\x1b[1;5C"));
        assert_eq!(plain("ctrl-shift-down").as_deref(), Some("\x1b[1;6B"));
    }

    #[test]
    fn control_combinations() {
        assert_eq!(plain("ctrl-c").as_deref(), Some("\x03"));
        assert_eq!(plain("ctrl-a").as_deref(), Some("\x01"));
        assert_eq!(plain("ctrl-z").as_deref(), Some("\x1a"));
        assert_eq!(plain("ctrl-shift-c").as_deref(), Some("\x03"));
        assert_eq!(plain("ctrl-[").as_deref(), Some("\x1b"));
        assert_eq!(plain("ctrl-\\").as_deref(), Some("\x1c"));
        assert_eq!(plain("ctrl-space").as_deref(), Some("\x00"));
        assert_eq!(plain("ctrl-backspace").as_deref(), Some("\x08"));
        assert_eq!(plain("ctrl-1"), None);
    }

    #[test]
    fn modified_enter_uses_csi_u() {
        assert_eq!(plain("shift-enter").as_deref(), Some("\x1b[13;2u"));
        assert_eq!(plain("alt-enter").as_deref(), Some("\x1b[13;3u"));
        assert_eq!(plain("ctrl-enter").as_deref(), Some("\x1b[13;5u"));
        assert_eq!(plain("cmd-enter"), None);
    }

    #[test]
    fn alt_as_meta() {
        let alt_b = Keystroke::parse("alt-b").unwrap();
        assert_eq!(to_esc_str(&alt_b, TermMode::empty(), true).as_deref(), Some("\x1bb"));
        let alt_ctrl_b = Keystroke::parse("ctrl-alt-b").unwrap();
        assert_eq!(to_esc_str(&alt_ctrl_b, TermMode::empty(), true).as_deref(), Some("\x1b\x02"));
        assert_eq!(to_esc_str(&alt_b, TermMode::empty(), false), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_line_editing_shortcuts() {
        assert_eq!(plain("cmd-backspace").as_deref(), Some("\x15"));
        assert_eq!(plain("cmd-left").as_deref(), Some("\x01"));
        assert_eq!(plain("cmd-right").as_deref(), Some("\x05"));
        assert_eq!(plain("alt-backspace").as_deref(), Some("\x17"));
        assert_eq!(plain("alt-left").as_deref(), Some("\x1bb"));
        assert_eq!(plain("alt-right").as_deref(), Some("\x1bf"));
        assert_eq!(plain("cmd-c"), None);
        assert_eq!(plain("cmd-up"), None);
    }

    #[test]
    fn paste_brackets_when_asked() {
        assert_eq!(paste_bytes("ls\nwc\r\n", TermMode::empty()), b"ls\rwc\r".to_vec());
        assert_eq!(
            paste_bytes("echo \x1b[201~hi\n", TermMode::BRACKETED_PASTE),
            b"\x1b[200~echo [201~hi\n\x1b[201~".to_vec()
        );
    }
}
