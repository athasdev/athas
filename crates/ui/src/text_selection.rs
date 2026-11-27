//! What the text fields and the agent transcript share about selecting with the mouse: a
//! double click takes a word and a triple click a line, and dragging on from either keeps
//! taking whole words or lines, as a text view does on every platform. Also the right-click
//! menu every editable field offers.

use std::ops::Range;

use gpui::{App, Window};

use crate::{IconName, MenuEntry, MenuItem};

/// What a press and the drag after it select by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Granularity {
    Character,
    Word,
    Line,
}

impl Granularity {
    pub fn for_clicks(click_count: usize) -> Self {
        match click_count {
            0 | 1 => Granularity::Character,
            2 => Granularity::Word,
            _ => Granularity::Line,
        }
    }
}

/// The word around `offset`: the run of word characters, or the run of other non-space
/// characters when the press sits on punctuation. Between words it is empty at `offset`.
pub fn word_range(text: &str, offset: usize) -> Range<usize> {
    let offset = floor_char(text, offset);
    let word = |ch: char| ch.is_alphanumeric() || ch == '_';
    let at = text[offset..].chars().next().filter(|ch| !ch.is_whitespace()).or_else(|| text[..offset].chars().next_back());
    let Some(at) = at else { return offset..offset };
    let same = |ch: char| if word(at) { word(ch) } else { !word(ch) && !ch.is_whitespace() };
    if !same(at) {
        return offset..offset;
    }
    let start = text[..offset].char_indices().rev().take_while(|(_, ch)| same(*ch)).last().map_or(offset, |(index, _)| index);
    let end = text[offset..].char_indices().find(|(_, ch)| !same(*ch)).map_or(text.len(), |(index, _)| offset + index);
    start..end
}

/// The hard line around `offset`, with its line break.
pub fn line_range(text: &str, offset: usize) -> Range<usize> {
    let offset = floor_char(text, offset);
    let start = text[..offset].rfind('\n').map_or(0, |index| index + 1);
    let end = text[offset..].find('\n').map_or(text.len(), |index| offset + index + 1);
    start..end
}

/// The unit of `granularity` around `offset`.
pub fn unit_range(text: &str, offset: usize, granularity: Granularity) -> Range<usize> {
    match granularity {
        Granularity::Character => {
            let offset = floor_char(text, offset);
            offset..offset
        }
        Granularity::Word => word_range(text, offset),
        Granularity::Line => line_range(text, offset),
    }
}

/// A press that selects whole words or lines, and the unit it first took: dragging on keeps
/// that unit and grows by whole units towards the mouse.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnitDrag {
    pub granularity: Granularity,
    pub origin: Range<usize>,
}

impl UnitDrag {
    /// The drag a press of `click_count` at `offset` starts, or `None` for a single click.
    pub fn start(text: &str, offset: usize, click_count: usize) -> Option<Self> {
        let granularity = Granularity::for_clicks(click_count);
        (granularity != Granularity::Character).then(|| UnitDrag { granularity, origin: unit_range(text, offset, granularity) })
    }

    /// The selection with the mouse at `offset`, and whether its head is at its start.
    pub fn extend(&self, text: &str, offset: usize) -> (Range<usize>, bool) {
        let unit = unit_range(text, offset, self.granularity);
        if unit.start < self.origin.start {
            (unit.start..self.origin.end, true)
        } else {
            (self.origin.start..unit.end.max(self.origin.end), false)
        }
    }
}

fn floor_char(text: &str, mut offset: usize) -> usize {
    offset = offset.min(text.len());
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

/// What a field's right-click menu can do, and what happens for each.
pub struct EditMenu {
    pub has_selection: bool,
    pub editable: bool,
    pub cut: Box<dyn Fn(&mut Window, &mut App)>,
    pub copy: Box<dyn Fn(&mut Window, &mut App)>,
    pub paste: Box<dyn Fn(&mut Window, &mut App)>,
    pub select_all: Box<dyn Fn(&mut Window, &mut App)>,
}

impl EditMenu {
    pub fn entries(self) -> Vec<MenuEntry> {
        let mac = cfg!(target_os = "macos");
        let keys = |mac_keys: &'static str, other: &'static str| if mac { mac_keys } else { other };
        let EditMenu { has_selection, editable, cut, copy, paste, select_all } = self;
        vec![
            MenuItem::new("Cut").icon(IconName::Scissors).shortcut(keys("⌘X", "Ctrl+X")).disabled(!has_selection || !editable).on_select(cut).into(),
            MenuItem::new("Copy").icon(IconName::Copy).shortcut(keys("⌘C", "Ctrl+C")).disabled(!has_selection).on_select(copy).into(),
            MenuItem::new("Paste").icon(IconName::ClipboardText).shortcut(keys("⌘V", "Ctrl+V")).disabled(!editable).on_select(paste).into(),
            MenuEntry::Separator,
            MenuItem::new("Select All").icon(IconName::Text).shortcut(keys("⌘A", "Ctrl+A")).on_select(select_all).into(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clicks_take_the_word_under_them() {
        assert_eq!(word_range("hello world", 7), 6..11);
        assert_eq!(word_range("hello world", 5), 0..5);
        assert_eq!(word_range("a  b", 2), 2..2);
        assert_eq!(word_range("let a = 1;", 6), 6..7);
        assert_eq!(word_range("naïve_name here", 2), 0..11);
        assert_eq!(word_range("", 0), 0..0);
    }

    #[test]
    fn lines_take_their_break() {
        assert_eq!(line_range("one\ntwo\nthree", 5), 4..8);
        assert_eq!(line_range("one\ntwo\nthree", 10), 8..13);
    }

    #[test]
    fn dragging_after_a_double_click_takes_whole_words() {
        let text = "create a nix flake for this app";
        let drag = UnitDrag::start(text, 10, 2).unwrap();
        assert_eq!(drag.origin, 9..12);
        // Left onto "a": from its start to the end of "nix", head first.
        assert_eq!(drag.extend(text, 7), (7..12, true));
        // Right into "flake".
        assert_eq!(drag.extend(text, 15), (9..18, false));
        // Back inside the first word: just that word.
        assert_eq!(drag.extend(text, 11), (9..12, false));
        assert!(UnitDrag::start(text, 10, 1).is_none());
    }
}
