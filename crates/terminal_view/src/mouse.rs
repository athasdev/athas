//! Mouse reports for programs that ask for the mouse (vim, htop, tmux): the X10/normal encoding
//! and the SGR (1006) encoding xterm defines.

use alacritty_terminal::term::TermMode;
use gpui::Modifiers;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MouseButton {
    Left,
    Middle,
    Right,
    WheelUp,
    WheelDown,
    /// Movement with no button held (any-event tracking).
    None,
}

impl MouseButton {
    fn code(self) -> u8 {
        match self {
            MouseButton::Left => 0,
            MouseButton::Middle => 1,
            MouseButton::Right => 2,
            MouseButton::None => 3,
            MouseButton::WheelUp => 64,
            MouseButton::WheelDown => 65,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MouseAction {
    Press,
    Release,
    Motion,
}

/// Whether the program wants mouse events instead of the terminal selecting text. Holding shift
/// always selects, as in other terminals.
pub(crate) fn reports_mouse(mode: TermMode, modifiers: &Modifiers) -> bool {
    mode.intersects(TermMode::MOUSE_MODE) && !modifiers.shift
}

/// Whether a motion event is reported in this mode: drags with button-event tracking, any
/// movement with any-event tracking.
pub(crate) fn reports_motion(mode: TermMode, button_held: bool) -> bool {
    mode.contains(TermMode::MOUSE_MOTION) || (button_held && mode.contains(TermMode::MOUSE_DRAG))
}

/// The report for a mouse event at a 0-based viewport cell, or `None` when it cannot be encoded.
pub(crate) fn mouse_report(
    line: usize,
    column: usize,
    button: MouseButton,
    action: MouseAction,
    modifiers: &Modifiers,
    mode: TermMode,
) -> Option<Vec<u8>> {
    let mut code = button.code();
    if modifiers.shift {
        code += 4;
    }
    if modifiers.alt {
        code += 8;
    }
    if modifiers.control {
        code += 16;
    }
    if action == MouseAction::Motion {
        code += 32;
    }

    if mode.contains(TermMode::SGR_MOUSE) {
        let suffix = if action == MouseAction::Release { 'm' } else { 'M' };
        return Some(format!("\x1b[<{code};{};{}{suffix}", column + 1, line + 1).into_bytes());
    }

    // The normal encoding has no release per button: a release is button 3.
    if action == MouseAction::Release {
        code = (code & !0b11) | 3;
    }
    let mut bytes = b"\x1b[M".to_vec();
    bytes.push(32 + code);
    for position in [column, line] {
        let value = 32 + 1 + position as u32;
        if mode.contains(TermMode::UTF8_MOUSE) {
            let mut buffer = [0; 4];
            bytes.extend_from_slice(char::from_u32(value)?.encode_utf8(&mut buffer).as_bytes());
        } else if value <= 255 {
            bytes.push(value as u8);
        } else {
            return None;
        }
    }
    Some(bytes)
}

/// What the wheel sends in the alternate screen of a program that did not ask for the mouse:
/// arrow keys, so pagers and editors scroll.
pub(crate) fn alternate_scroll_bytes(lines: i32, mode: TermMode) -> Vec<u8> {
    let app_cursor = mode.contains(TermMode::APP_CURSOR);
    let sequence: &[u8] = match (lines > 0, app_cursor) {
        (true, true) => b"\x1bOA",
        (true, false) => b"\x1b[A",
        (false, true) => b"\x1bOB",
        (false, false) => b"\x1b[B",
    };
    sequence.repeat(lines.unsigned_abs() as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none() -> Modifiers {
        Modifiers::default()
    }

    #[test]
    fn sgr_reports() {
        let mode = TermMode::SGR_MOUSE | TermMode::MOUSE_REPORT_CLICK;
        let report = |button, action, modifiers: &Modifiers| mouse_report(4, 9, button, action, modifiers, mode);
        assert_eq!(report(MouseButton::Left, MouseAction::Press, &none()).unwrap(), b"\x1b[<0;10;5M");
        assert_eq!(report(MouseButton::Left, MouseAction::Release, &none()).unwrap(), b"\x1b[<0;10;5m");
        assert_eq!(report(MouseButton::Right, MouseAction::Motion, &none()).unwrap(), b"\x1b[<34;10;5M");
        assert_eq!(report(MouseButton::WheelDown, MouseAction::Press, &none()).unwrap(), b"\x1b[<65;10;5M");
        let ctrl = Modifiers { control: true, ..Default::default() };
        assert_eq!(report(MouseButton::Left, MouseAction::Press, &ctrl).unwrap(), b"\x1b[<16;10;5M");
    }

    #[test]
    fn normal_reports() {
        let mode = TermMode::MOUSE_REPORT_CLICK;
        assert_eq!(
            mouse_report(0, 0, MouseButton::Left, MouseAction::Press, &none(), mode).unwrap(),
            vec![0x1b, b'[', b'M', 32, 33, 33]
        );
        assert_eq!(
            mouse_report(2, 3, MouseButton::Middle, MouseAction::Release, &none(), mode).unwrap(),
            vec![0x1b, b'[', b'M', 35, 36, 35]
        );
        assert_eq!(mouse_report(0, 300, MouseButton::Left, MouseAction::Press, &none(), mode), None);
        let utf8 = mouse_report(0, 300, MouseButton::Left, MouseAction::Press, &none(), mode | TermMode::UTF8_MOUSE);
        assert_eq!(utf8.unwrap(), [b"\x1b[M ".as_slice(), "ō".as_bytes(), b"!"].concat());
    }

    #[test]
    fn shift_always_selects() {
        let mode = TermMode::MOUSE_REPORT_CLICK;
        assert!(reports_mouse(mode, &none()));
        assert!(!reports_mouse(mode, &Modifiers { shift: true, ..Default::default() }));
        assert!(!reports_mouse(TermMode::empty(), &none()));
    }

    #[test]
    fn motion_follows_the_tracking_mode() {
        assert!(!reports_motion(TermMode::MOUSE_REPORT_CLICK, true));
        assert!(reports_motion(TermMode::MOUSE_DRAG, true));
        assert!(!reports_motion(TermMode::MOUSE_DRAG, false));
        assert!(reports_motion(TermMode::MOUSE_MOTION, false));
    }

    #[test]
    fn alternate_scroll_sends_arrows() {
        assert_eq!(alternate_scroll_bytes(2, TermMode::empty()), b"\x1b[A\x1b[A");
        assert_eq!(alternate_scroll_bytes(-1, TermMode::APP_CURSOR), b"\x1bOB");
    }
}
