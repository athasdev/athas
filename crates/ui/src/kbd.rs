use gpui::{App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, px};
use theme::ActiveTheme;

use crate::typography;

/// A keyboard shortcut, such as `⌘B`, drawn as one keycap per key (`Keybinding` with `Kbd`).
/// Chords separated by spaces read "then" between them.
#[derive(IntoElement)]
pub struct Kbd {
    keys: SharedString,
    on_primary: bool,
}

impl Kbd {
    pub fn new(keys: impl Into<SharedString>) -> Self {
        Self { keys: keys.into(), on_primary: false }
    }

    /// Keycaps on a selected row's accent fill.
    pub fn on_primary(mut self, on_primary: bool) -> Self {
        self.on_primary = on_primary;
        self
    }
}

const MAC_MODIFIERS: [char; 5] = ['⌃', '⌥', '⇧', '⌘', '⇪'];

/// Where a modifier goes: Athas sorts a binding's modifiers by name (`alt`, `cmd`, `ctrl`,
/// `shift`), so `⌘⇧P` rather than GPUI's `⇧⌘P`.
fn modifier_rank(key: &str) -> Option<usize> {
    match key.to_lowercase().as_str() {
        "⌥" | "alt" | "option" => Some(0),
        "⌘" | "cmd" | "meta" | "super" | "win" => Some(1),
        "⌃" | "ctrl" | "control" => Some(2),
        "⇧" | "shift" => Some(3),
        "⇪" | "fn" => Some(4),
        _ => None,
    }
}

/// The keys of one chord: `Ctrl+Shift+P` splits at the pluses, `⇧⌘P` into its modifier symbols
/// and the key after them; modifiers come first, in Athas's order.
fn chord_keys(chord: &str) -> Vec<String> {
    let mut keys = Vec::new();
    if chord.chars().count() > 1 && chord.contains('+') {
        keys = chord.split('+').filter(|key| !key.is_empty()).map(str::to_string).collect();
        if chord.ends_with("++") || chord == "+" {
            keys.push("+".into());
        }
    } else {
        let mut rest = chord;
        while let Some(first) = rest.chars().next() {
            if !MAC_MODIFIERS.contains(&first) {
                break;
            }
            keys.push(first.to_string());
            rest = &rest[first.len_utf8()..];
        }
        if !rest.is_empty() {
            keys.push(rest.to_string());
        }
    }
    keys.sort_by_key(|key| modifier_rank(key).unwrap_or(5));
    keys
}

/// A shortcut as one line of text, with modifiers in Athas's order: `⇧⌘P` reads `⌘⇧P`, and
/// `Shift+Ctrl+P` reads `Ctrl+Shift+P`.
pub fn shortcut_text(keys: &str) -> String {
    keys.split(' ')
        .filter(|chord| !chord.is_empty())
        .map(|chord| {
            let parts = chord_keys(chord);
            if chord.chars().count() > 1 && chord.contains('+') { parts.join("+") } else { parts.concat() }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

impl RenderOnce for Kbd {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let (accent, muted, subtle) = if self.on_primary {
            (colors.primary_foreground.opacity(0.2), colors.primary_foreground, colors.primary_foreground)
        } else {
            (colors.accent, colors.muted_foreground, colors.subtle_foreground)
        };
        let keycap = move |key: String| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .h(px(16.))
                .min_w(px(16.))
                .px(px(4.))
                .rounded(px(2.))
                .bg(accent)
                .text_size(typography::TEXT_CAPTION)
                .font_weight(typography::MEDIUM)
                .line_height(px(16.))
                .text_color(muted)
                .child(key)
        };
        let mut group = div().flex().flex_none().items_center().gap(px(4.)).whitespace_nowrap();
        for (index, chord) in self.keys.split(' ').filter(|chord| !chord.is_empty()).enumerate() {
            if index > 0 {
                group = group.child(div().text_size(typography::TEXT_CAPTION).text_color(subtle).child("then"));
            }
            group = group.children(chord_keys(chord).into_iter().map(keycap));
        }
        group
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modifiers_follow_athas_order() {
        assert_eq!(chord_keys("⇧⌘J"), ["⌘", "⇧", "J"]);
        assert_eq!(chord_keys("⌃⌥⇧⌘P"), ["⌥", "⌘", "⌃", "⇧", "P"]);
        assert_eq!(chord_keys("Shift+Ctrl+P"), ["Ctrl", "Shift", "P"]);
        assert_eq!(shortcut_text("⇧⌘K ⇧⌘S"), "⌘⇧K ⌘⇧S");
        assert_eq!(shortcut_text("Shift+Alt+F"), "Alt+Shift+F");
    }
}
