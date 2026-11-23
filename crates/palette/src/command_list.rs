//! A command surface built from a list a panel hands to it: the rows, the sections they fall
//! under, and what picking one does. It is the port of the original's `GitCommandSurface` — the
//! Command component over a list too long for a dropdown, such as the Source Control sidebar's
//! stashes or the GitHub sidebar's releases.
//!
//! A panel cannot show a modal itself (the sidebar is too narrow for one, and the workbench owns
//! the layer), so it leaves the list in a global and the workbench opens it on its next turn.
//! An action may leave another list behind, which is how a row opens the actions for its item.

use std::rc::Rc;

use gpui::{AnyElement, App, Context, Global, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*};
use ui::{IconName, scale::px};

use crate::{Picker, PickerDelegate, fuzzy::fuzzy_match, row::PaletteRow};

/// What picking a row does.
pub type CommandRun = Rc<dyn Fn(&mut Window, &mut App)>;

/// A button at the end of a row, shown while the row is the one the keyboard is on.
#[derive(Clone)]
pub struct CommandAction {
    pub icon: IconName,
    pub tooltip: SharedString,
    pub run: CommandRun,
    pub destructive: bool,
}

/// One row of a command surface.
#[derive(Clone)]
pub struct CommandRow {
    pub label: SharedString,
    /// The quieter line under the label.
    pub description: Option<SharedString>,
    /// Meta at the row's end, such as a date or a short hash.
    pub trailing: Option<SharedString>,
    pub icon: Option<IconName>,
    /// The heading this row falls under; rows sharing one are drawn as a group.
    pub section: Option<SharedString>,
    /// Words the search matches besides the label, such as a commit's hash.
    pub keywords: SharedString,
    pub run: Option<CommandRun>,
    /// Buttons at the row's end, for what it can do without opening it.
    pub actions: Vec<CommandAction>,
    /// The haystack, folded once when the row is made: the search runs over every row on every
    /// keystroke.
    haystack: String,
}

impl CommandRow {
    pub fn new(label: impl Into<SharedString>) -> Self {
        let label = label.into();
        let haystack = label.to_lowercase();
        Self {
            label,
            description: None,
            trailing: None,
            icon: None,
            section: None,
            keywords: SharedString::default(),
            run: None,
            actions: Vec::new(),
            haystack,
        }
    }

    /// A button at the row's end: the action runs without the surface opening the row.
    pub fn action(mut self, icon: IconName, tooltip: impl Into<SharedString>, run: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.actions.push(CommandAction { icon, tooltip: tooltip.into(), run: Rc::new(run), destructive: false });
        self
    }

    /// An action that deletes or discards something.
    pub fn destructive_action(mut self, icon: IconName, tooltip: impl Into<SharedString>, run: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.actions.push(CommandAction { icon, tooltip: tooltip.into(), run: Rc::new(run), destructive: true });
        self
    }

    fn refold(mut self) -> Self {
        let mut haystack = self.label.to_lowercase();
        for extra in [self.description.as_ref(), self.trailing.as_ref(), Some(&self.keywords)].into_iter().flatten() {
            if !extra.is_empty() {
                haystack.push(' ');
                haystack.push_str(&extra.to_lowercase());
            }
        }
        self.haystack = haystack;
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self.refold()
    }

    pub fn trailing(mut self, trailing: impl Into<SharedString>) -> Self {
        self.trailing = Some(trailing.into());
        self.refold()
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn section(mut self, section: impl Into<SharedString>) -> Self {
        self.section = Some(section.into());
        self
    }

    pub fn keywords(mut self, keywords: impl Into<SharedString>) -> Self {
        self.keywords = keywords.into();
        self.refold()
    }

    pub fn on_select(mut self, run: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.run = Some(Rc::new(run));
        self
    }

    /// Opens another command surface, for a row that leads to its item's actions.
    pub fn opens(self, list: impl Fn() -> CommandList + 'static) -> Self {
        self.on_select(move |_, cx| show(cx, list()))
    }

}

/// A list to show as a command surface.
#[derive(Clone)]
pub struct CommandList {
    /// The title over the search field, such as "Stashes".
    pub title: SharedString,
    pub placeholder: SharedString,
    pub empty: SharedString,
    pub icon: IconName,
    pub rows: Vec<CommandRow>,
}

impl CommandList {
    pub fn new(title: impl Into<SharedString>, rows: Vec<CommandRow>) -> Self {
        let title = title.into();
        Self {
            placeholder: format!("Search {}…", title.to_lowercase()).into(),
            empty: format!("No matching {}", title.to_lowercase()).into(),
            icon: IconName::Search,
            title,
            rows,
        }
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = placeholder.into();
        self
    }

    pub fn empty(mut self, empty: impl Into<SharedString>) -> Self {
        self.empty = empty.into();
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = icon;
        self
    }
}

/// The lists panels asked to open, oldest first.
#[derive(Default)]
pub struct PendingCommandLists(Vec<CommandList>);

impl Global for PendingCommandLists {}

/// Asks the workbench to open `list` as a command surface; it does on its next turn.
pub fn show(cx: &mut App, list: CommandList) {
    cx.default_global::<PendingCommandLists>().0.push(list);
}

/// What is waiting to be shown, taken by the workbench.
pub fn take(cx: &mut App) -> Vec<CommandList> {
    if cx.try_global::<PendingCommandLists>().is_none_or(|pending| pending.0.is_empty()) {
        return Vec::new();
    }
    std::mem::take(&mut cx.default_global::<PendingCommandLists>().0)
}

/// Lists a [`CommandList`] in a picker.
pub struct CommandListDelegate {
    list: CommandList,
    /// The rows that match the query, in the order they are shown, and where the query hit.
    matches: Vec<(usize, Vec<usize>)>,
    selected: usize,
}

impl CommandListDelegate {
    pub fn new(list: CommandList) -> Self {
        let matches = (0..list.rows.len()).map(|index| (index, Vec::new())).collect();
        Self { list, matches, selected: 0 }
    }

    fn row(&self, index: usize) -> Option<(&CommandRow, &Vec<usize>)> {
        let (row, positions) = self.matches.get(index)?;
        Some((self.list.rows.get(*row)?, positions))
    }
}

impl PickerDelegate for CommandListDelegate {
    fn placeholder(&self) -> SharedString {
        self.list.placeholder.clone()
    }

    fn match_count(&self) -> usize {
        self.matches.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _cx: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn update_matches(&mut self, query: &str, _window: &mut Window, _cx: &mut Context<Picker<Self>>) {
        let query = query.trim();
        if query.is_empty() {
            self.matches = (0..self.list.rows.len()).map(|index| (index, Vec::new())).collect();
            self.selected = 0;
            return;
        }
        let mut matches: Vec<(i64, usize, Vec<usize>)> = self
            .list
            .rows
            .iter()
            .enumerate()
            .filter_map(|(index, row)| {
                let hit = fuzzy_match(query, &row.haystack)?;
                // Only the label's own hits are drawn, so a match in the keywords underlines nothing.
                let positions = hit.positions.iter().copied().filter(|offset| *offset < row.label.len()).collect();
                Some((hit.score, index, positions))
            })
            .collect();
        matches.sort_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
        self.matches = matches.into_iter().map(|(_, index, positions)| (index, positions)).collect();
        self.selected = 0;
    }

    fn section_label(&self, index: usize) -> Option<SharedString> {
        let (row, _) = self.row(index)?;
        let section = row.section.clone()?;
        let previous = index.checked_sub(1).and_then(|previous| self.row(previous)).and_then(|(row, _)| row.section.clone());
        (previous.as_ref() != Some(&section)).then_some(section)
    }

    fn empty_message(&self) -> SharedString {
        self.list.empty.clone()
    }

    fn title(&self) -> Option<(SharedString, Option<SharedString>)> {
        Some((self.list.title.clone(), None))
    }

    fn title_icon(&self) -> IconName {
        self.list.icon
    }

    fn render_match(&self, index: usize, selected: bool, _window: &mut Window, _cx: &mut Context<Picker<Self>>) -> AnyElement {
        let Some((row, positions)) = self.row(index) else { return gpui::Empty.into_any_element() };
        // One line: the label, its detail beside it and the meta at the end. Stacked rows made
        // a list of twenty look like a page.
        let mut element = PaletteRow::new(row.label.clone()).inline().selected(selected).highlights(positions.clone());
        if let Some(icon) = row.icon {
            element = element.icon(icon);
        }
        if let Some(description) = row.description.clone() {
            element = element.description(description);
        }
        if let Some(trailing) = row.trailing.clone() {
            element = element.meta(trailing);
        }
        // The buttons belong to the row the keyboard is on; the pointer moves it, so hovering
        // a row reveals them too.
        if selected && !row.actions.is_empty() {
            let buttons = row.actions.iter().enumerate().map(|(action_index, action)| {
                let run = action.run.clone();
                ui::Button::icon(("command-action", index * 16 + action_index), action.icon)
                    .size(ui::ButtonSize::XSmall)
                    .variant(ui::ButtonVariant::Ghost)
                    .when(action.destructive, |button| button.tone(ui::ButtonTone::Danger))
                    .tooltip(action.tooltip.clone())
                    // The row behind opens the item; a button must not do both.
                    .on_click(move |_, window, cx| {
                        cx.stop_propagation();
                        run(window, cx);
                    })
            });
            element = element.accessory(div().flex().items_center().gap(px(2.)).children(buttons));
        }
        element.into_any_element()
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some((row, _)) = self.row(index) else { return true };
        if let Some(run) = row.run.clone() {
            run(window, cx);
        }
        true
    }
}
