//! The launch configuration picker: the project's `launch.json` entries, then the ones Athas made
//! for the open file, filtered as you type.

use std::rc::Rc;

use dap::{ConfigSource, LaunchConfig};
use gpui::{AnyElement, App, Context, SharedString, Window, prelude::*};
use palette::{FuzzyMatch, PaletteRow, Picker, PickerDelegate, fuzzy_match};
use ui::IconName;

pub struct LaunchConfigDelegate {
    configs: Vec<LaunchConfig>,
    matches: Vec<(usize, FuzzyMatch)>,
    selected: usize,
    /// The configuration in use, selected while the query is empty.
    current: usize,
    on_pick: Rc<dyn Fn(usize, &mut Window, &mut App)>,
}

impl LaunchConfigDelegate {
    /// `on_pick` gets the index into `configs`; `current` starts selected.
    pub fn new(configs: Vec<LaunchConfig>, current: usize, on_pick: impl Fn(usize, &mut Window, &mut App) + 'static) -> Self {
        Self { configs, matches: Vec::new(), selected: 0, current, on_pick: Rc::new(on_pick) }
    }
}

fn group(config: &LaunchConfig) -> &'static str {
    match config.source {
        ConfigSource::Workspace => "launch.json",
        ConfigSource::Generated => "Detected",
    }
}

impl PickerDelegate for LaunchConfigDelegate {
    fn placeholder(&self) -> SharedString {
        "Select a launch configuration...".into()
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
        self.matches = self
            .configs
            .iter()
            .enumerate()
            .filter_map(|(index, config)| fuzzy_match(query, &format!("{} {}", config.name, config.kind)).map(|matched| (index, matched)))
            .collect();
        if query.trim().is_empty() {
            self.selected = self.matches.iter().position(|(index, _)| *index == self.current).unwrap_or(0);
        } else {
            self.matches.sort_by(|a, b| b.1.score.cmp(&a.1.score));
            self.selected = 0;
        }
    }

    fn section_label(&self, index: usize) -> Option<SharedString> {
        let label = group(&self.configs[self.matches.get(index)?.0]);
        let previous = index.checked_sub(1).and_then(|previous| self.matches.get(previous));
        match previous {
            Some((previous, _)) if group(&self.configs[*previous]) == label => None,
            _ => Some(label.into()),
        }
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, _: &mut Context<Picker<Self>>) -> AnyElement {
        let config = &self.configs[self.matches[index].0];
        PaletteRow::new(config.name.clone())
            .icon(IconName::Bug)
            .description(config.description())
            .inline()
            .selected(selected)
            .into_any_element()
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some((config, _)) = self.matches.get(index) else { return false };
        (self.on_pick)(*config, window, cx);
        true
    }

    fn empty_message(&self) -> SharedString {
        "No launch configurations. Add .vscode/launch.json or open a source file.".into()
    }

    fn leading_icon(&self) -> IconName {
        IconName::Bug
    }
}
