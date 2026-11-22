use crate::TooltipExt;
use std::rc::Rc;

use crate::scale::px;
use gpui::{
    Anchor, AnyElement, App, Bounds, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable,
    InteractiveElement, IntoElement, KeyDownEvent, MouseDownEvent, ParentElement, Pixels, Point, Render,
    SharedString, StatefulInteractiveElement, Styled, Subscription, WeakEntity, Window, anchored, canvas,
    deferred, div, prelude::FluentBuilder,
};
use gpui::prelude::*;
use theme::ActiveTheme;

use crate::{Icon, IconName, IconSize, metrics, typography};

pub(crate) type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

/// Supplies a searchable menu's rows for a query (`MenuItem::submenu_query`, `Menu::set_query_source`).
pub type MenuQuerySource = Rc<dyn Fn(&str, &mut Window, &mut App) -> Vec<MenuEntry>>;

/// The colour of a row's label and icon (`menuItemVariants` tone).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MenuItemTone {
    #[default]
    Default,
    Accent,
    Destructive,
}

/// The width presets every overlay picks from (`ui/overlay-size.ts`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MenuSize {
    /// Content-sized, at least 128px.
    #[default]
    Auto,
    /// Short action submenus: 176px.
    Compact,
    /// Standard action menus: 224px.
    Default,
    /// Lists of labelled rows: 288px.
    Wide,
    /// Content-bearing surfaces: 384px.
    Panel,
    /// A fixed width, such as the trigger's.
    Exact(Pixels),
}

impl MenuSize {
    pub fn width(self) -> Option<Pixels> {
        match self {
            MenuSize::Auto => None,
            MenuSize::Compact => Some(px(176.)),
            MenuSize::Default => Some(px(224.)),
            MenuSize::Wide => Some(px(288.)),
            MenuSize::Panel => Some(px(384.)),
            MenuSize::Exact(width) => Some(width),
        }
    }
}

pub fn overlay_max_width() -> Pixels { px(480.) }
pub fn overlay_max_height() -> Pixels { px(320.) }
/// Where an open menu paints among the deferred overlays: above the anchored popovers, cards and
/// prompts, which draw at 3 and below. A submenu paints one step above its parent.
pub const MENU_PRIORITY: usize = 4;

/// What a row ends with besides its shortcut.
pub(crate) enum Trailing {
    Disclosure,
    Text(SharedString),
}

pub struct MenuItem {
    pub(crate) label: SharedString,
    pub(crate) icon: Option<IconName>,
    /// A picture in place of `icon`, such as the icon theme's icon for a file.
    pub(crate) icon_image: Option<gpui::ImageSource>,
    pub(crate) checked: Option<bool>,
    pub(crate) selected: bool,
    pub(crate) shortcut: Option<SharedString>,
    pub(crate) trailing: Option<Trailing>,
    pub(crate) tone: MenuItemTone,
    pub(crate) disabled: bool,
    pub(crate) handler: Option<Handler>,
    pub(crate) submenu: Option<Vec<MenuEntry>>,
    pub(crate) value: Option<SharedString>,
    /// Words a search matches besides the label, such as a model's id.
    pub(crate) keywords: Option<SharedString>,
    /// A second, quieter line under the label, such as a commit's author and date.
    pub(crate) description: Option<SharedString>,
    /// Left out while the menu is searched, as a "Recommended" pick repeated below is.
    pub(crate) hidden_while_searching: bool,
    /// The submenu's search field placeholder and no-match text, when it has one.
    pub(crate) submenu_search: Option<(SharedString, SharedString)>,
    /// Rows the submenu shows for a typed query, instead of filtering its own rows.
    pub(crate) submenu_query: Option<MenuQuerySource>,
    /// Picking the row runs its handler without closing the menu, as a Retry row does.
    pub(crate) keep_open: bool,
    /// Shown while the pointer rests on the row, such as a model's "… via Provider".
    pub(crate) tooltip: Option<SharedString>,
    /// Opens something outside the app (a web page): an arrow at the end of the row says so.
    pub(crate) external: bool,
}

impl MenuItem {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            icon: None,
            icon_image: None,
            checked: None,
            selected: false,
            shortcut: None,
            trailing: None,
            tone: MenuItemTone::Default,
            disabled: false,
            handler: None,
            submenu: None,
            value: None,
            keywords: None,
            description: None,
            hidden_while_searching: false,
            submenu_search: None,
            submenu_query: None,
            keep_open: false,
            tooltip: None,
            external: false,
        }
    }

    /// Marks a row that opens something outside the app, such as a web page.
    pub fn external(mut self) -> Self {
        self.external = true;
        self
    }

    /// A tooltip on the row, shown while the pointer rests on it.
    pub fn tooltip(mut self, text: impl Into<SharedString>) -> Self {
        self.tooltip = Some(text.into());
        self
    }

    /// Leaves the menu open when the row is picked; the handler runs once the menu's update ends,
    /// so it may refresh the open menu (`Menu::set_entries`).
    pub fn keep_open(mut self) -> Self {
        self.keep_open = true;
        self
    }

    pub fn keywords(mut self, keywords: impl Into<SharedString>) -> Self {
        self.keywords = Some(keywords.into());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn hidden_while_searching(mut self) -> Self {
        self.hidden_while_searching = true;
        self
    }

    /// A picture for the row, such as the icon theme's icon for a file. It takes the icon's
    /// place, and a row with one counts as having an icon when the group is aligned.
    pub fn icon_image(mut self, source: impl Into<gpui::ImageSource>) -> Self {
        self.icon_image = Some(source.into());
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// A checkbox row: a check at the end while checked, the space kept while not.
    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = Some(checked);
        self
    }

    /// The current choice among its siblings, filled while the pointer is elsewhere.
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn shortcut(mut self, shortcut: impl Into<SharedString>) -> Self {
        self.shortcut = Some(shortcut.into());
        self
    }

    /// A chevron at the end, for a row that leads somewhere else.
    pub fn disclosure(mut self) -> Self {
        self.trailing = Some(Trailing::Disclosure);
        self
    }

    /// Muted text at the end, such as a count.
    pub fn trailing_text(mut self, text: impl Into<SharedString>) -> Self {
        self.trailing = Some(Trailing::Text(text.into()));
        self
    }

    pub fn tone(mut self, tone: MenuItemTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn destructive(self) -> Self {
        self.tone(MenuItemTone::Destructive)
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_select(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.handler = Some(Rc::new(handler));
        self
    }

    /// Opens `entries` beside the row on hover or Right.
    pub fn submenu(mut self, entries: Vec<MenuEntry>) -> Self {
        self.submenu = Some(entries);
        self
    }

    /// Puts a search field over the submenu's rows (`DropdownMenuSearch` in a submenu).
    pub fn searchable_submenu(mut self, placeholder: impl Into<SharedString>, empty: impl Into<SharedString>) -> Self {
        self.submenu_search = Some((placeholder.into(), empty.into()));
        self
    }

    /// Asks `source` for the searchable submenu's rows whenever its query changes (a fly-out over
    /// the whole project index, say); an empty query shows the rows given to `submenu` again.
    /// Implies `searchable_submenu` with default texts when that was not set.
    pub fn submenu_query(mut self, source: impl Fn(&str, &mut Window, &mut App) -> Vec<MenuEntry> + 'static) -> Self {
        self.submenu_query = Some(Rc::new(source));
        if self.submenu_search.is_none() {
            self.submenu_search = Some(("Search…".into(), "No results".into()));
        }
        self
    }

    /// The submenu's current choice, shown muted before the chevron.
    pub fn value(mut self, value: impl Into<SharedString>) -> Self {
        self.value = Some(value.into());
        self
    }

    fn is_submenu(&self) -> bool {
        self.submenu.is_some()
    }

    fn actionable(&self) -> bool {
        !self.disabled
    }
}

pub enum MenuEntry {
    Item(MenuItem),
    Separator,
    Label(SharedString),
    /// A short dimmed paragraph, such as a description under a label (`<p className="px-2 pb-1
    /// text-subtle-foreground ui-text-sm">` in a dropdown). It wraps and takes no clicks.
    Text(SharedString),
}

impl From<MenuItem> for MenuEntry {
    fn from(item: MenuItem) -> Self {
        MenuEntry::Item(item)
    }
}

/// Emitted by a submenu that wants its parent to close it and take focus back.
pub struct CloseSubmenu;

struct OpenSubmenu {
    index: usize,
    menu: Entity<Menu>,
    _subscriptions: [Subscription; 2],
}

/// A dropdown or context menu (`ui/dropdown.tsx`). It closes when an item is picked, on Escape,
/// or on a click outside; arrows, Home, End, Return and Space drive it from the keyboard.
pub struct Menu {
    entries: Vec<MenuEntry>,
    focus_handle: FocusHandle,
    size: MenuSize,
    highlighted: Option<usize>,
    submenu: Option<OpenSubmenu>,
    parent: Option<WeakEntity<Menu>>,
    bounds: Option<Bounds<Pixels>>,
    trigger_bounds: Option<Bounds<Pixels>>,
    search: Option<MenuSearch>,
    /// Rows for a query, from the caller (`set_query_source`).
    query_source: Option<MenuQuerySource>,
    /// The menu's own rows while `query_source`'s results show in their place.
    base_entries: Option<Vec<MenuEntry>>,
    scroll: gpui::ScrollHandle,
    /// Where and when a press outside closed the menu, so a press on its own trigger closes it
    /// instead of closing and reopening it (`OpenMenu`).
    dismissed_by_press: Option<(Point<Pixels>, web_time::Instant)>,
}

/// A query typed into a long menu, keeping the rows whose label matches it (`ui/menu-search.ts`).
struct MenuSearch {
    placeholder: SharedString,
    empty: SharedString,
    query: String,
}

impl MenuSearch {
    fn matches(&self, item: &MenuItem) -> bool {
        if item.hidden_while_searching {
            return false;
        }
        let haystack = format!("{} {} {}", item.label, item.value.as_deref().unwrap_or_default(), item.keywords.as_deref().unwrap_or_default()).to_lowercase();
        self.query.to_lowercase().split_whitespace().all(|word| haystack.contains(word))
    }

    fn is_searching(&self) -> bool {
        !self.query.trim().is_empty()
    }
}

impl EventEmitter<DismissEvent> for Menu {}
impl EventEmitter<CloseSubmenu> for Menu {}

impl Focusable for Menu {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Menu {
    pub fn build(entries: Vec<MenuEntry>, window: &mut Window, cx: &mut App) -> Entity<Self> {
        Self::build_sized(entries, MenuSize::Auto, window, cx)
    }

    pub fn build_sized(entries: Vec<MenuEntry>, size: MenuSize, window: &mut Window, cx: &mut App) -> Entity<Self> {
        cx.new(|cx| {
            let focus_handle = cx.focus_handle();
            window.focus(&focus_handle, cx);
            Self::new(entries, size, focus_handle)
        })
    }

    fn new(entries: Vec<MenuEntry>, size: MenuSize, focus_handle: FocusHandle) -> Self {
        Self { entries, focus_handle, size, highlighted: None, submenu: None, parent: None, bounds: None, trigger_bounds: None, search: None, query_source: None, base_entries: None, scroll: gpui::ScrollHandle::new(), dismissed_by_press: None }
    }

    /// Lets the caller supply the rows for a typed query (`MenuQuerySource`) instead of the menu
    /// filtering its own; the menu must be searchable (`set_searchable`).
    pub fn set_query_source(&mut self, source: MenuQuerySource) {
        self.query_source = Some(source);
    }

    /// The query typed into a searchable menu.
    pub fn query(&self) -> &str {
        self.search.as_ref().map_or("", |search| search.query.as_str())
    }

    /// Puts a search field over the rows: typing filters them by label, and `empty` shows when
    /// nothing matches.
    pub fn set_searchable(&mut self, placeholder: impl Into<SharedString>, empty: impl Into<SharedString>) {
        self.search = Some(MenuSearch { placeholder: placeholder.into(), empty: empty.into(), query: String::new() });
    }

    /// Whether the row at `index` shows under the current query.
    fn visible(&self, index: usize) -> bool {
        match &self.search {
            // The caller's results already answer the query.
            Some(search) if search.is_searching() && self.query_source.is_some() => true,
            Some(search) if search.is_searching() => self.item(index).is_some_and(|item| search.matches(item)),
            _ => true,
        }
    }

    fn type_query(&mut self, change: impl FnOnce(&mut String), window: &mut Window, cx: &mut Context<Self>) {
        let Some(search) = self.search.as_mut() else { return };
        change(&mut search.query);
        let query = search.query.trim().to_string();
        self.drop_submenu(cx);
        if let Some(source) = self.query_source.clone() {
            if query.is_empty() {
                if let Some(base) = self.base_entries.take() {
                    self.entries = base;
                }
            } else {
                let results = source(&query, window, cx);
                let previous = std::mem::replace(&mut self.entries, results);
                if self.base_entries.is_none() {
                    self.base_entries = Some(previous);
                }
            }
        }
        let first = self.actionable().first().copied();
        self.highlighted = None;
        self.highlight(first, false, window, cx);
        cx.notify();
    }

    /// The control that opened the menu: a press on it is left to toggle the menu instead of
    /// counting as a click outside.
    pub fn set_trigger_bounds(&mut self, bounds: Option<Bounds<Pixels>>) {
        self.trigger_bounds = bounds;
    }

    /// Whether `position` falls on this menu or a submenu open from it.
    pub fn contains(&self, position: Point<Pixels>, cx: &App) -> bool {
        self.bounds.is_some_and(|bounds| bounds.contains(&position))
            || self.submenu.as_ref().is_some_and(|open| open.menu.read(cx).contains(position, cx))
    }

    fn item(&self, index: usize) -> Option<&MenuItem> {
        match self.entries.get(index) {
            Some(MenuEntry::Item(item)) => Some(item),
            _ => None,
        }
    }

    fn actionable(&self) -> Vec<usize> {
        (0..self.entries.len()).filter(|index| self.item(*index).is_some_and(MenuItem::actionable) && self.visible(*index)).collect()
    }

    fn step(&mut self, delta: isize, window: &mut Window, cx: &mut Context<Self>) {
        let rows = self.actionable();
        if rows.is_empty() {
            return;
        }
        let next = match self.highlighted.and_then(|current| rows.iter().position(|row| *row == current)) {
            Some(position) => rows[(position as isize + delta).rem_euclid(rows.len() as isize) as usize],
            None if delta > 0 => rows[0],
            None => rows[rows.len() - 1],
        };
        self.highlight(Some(next), false, window, cx);
    }

    /// Highlights a row as the pointer would, opening its submenu when `open_submenu` is set.
    pub fn highlight(&mut self, index: Option<usize>, open_submenu: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.highlighted == index && (self.submenu.is_some() || !open_submenu) {
            return;
        }
        self.highlighted = index;
        if self.submenu.as_ref().is_some_and(|open| Some(open.index) != index) {
            self.drop_submenu(cx);
        }
        if open_submenu && let Some(index) = index {
            self.open_submenu(index, false, window, cx);
        }
        cx.notify();
    }

    fn open_submenu(&mut self, index: usize, focus: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.submenu.as_ref().is_none_or(|open| open.index != index) {
            let Some(MenuEntry::Item(item)) = self.entries.get_mut(index) else { return };
            let Some(entries) = item.submenu.take() else { return };
            let search = item.submenu_search.clone();
            let query_source = item.submenu_query.clone();
            let parent = cx.entity().downgrade();
            let menu = cx.new(|cx| {
                let mut menu = Menu::new(entries, if search.is_some() { MenuSize::Wide } else { MenuSize::Auto }, cx.focus_handle());
                menu.parent = Some(parent);
                if let Some((placeholder, empty)) = search {
                    menu.set_searchable(placeholder, empty);
                }
                menu.query_source = query_source;
                menu
            });
            let dismiss = cx.subscribe(&menu, |_, _, _: &DismissEvent, cx| cx.emit(DismissEvent));
            let close = cx.subscribe_in(&menu, window, |this, _, _: &CloseSubmenu, window, cx| {
                this.close_submenu(window, cx);
            });
            self.submenu = Some(OpenSubmenu { index, menu, _subscriptions: [dismiss, close] });
        }
        if focus && let Some(open) = &self.submenu {
            open.menu.update(cx, |menu, cx| {
                menu.highlighted = menu.actionable().first().copied();
                window.focus(&menu.focus_handle, cx);
                cx.notify();
            });
        }
        cx.notify();
    }

    fn close_submenu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.submenu.is_some() {
            self.drop_submenu(cx);
            window.focus(&self.focus_handle, cx);
            cx.notify();
        }
    }

    /// Closes the open submenu, handing its entries back to the row that opened it.
    fn drop_submenu(&mut self, cx: &mut App) {
        let Some(open) = self.submenu.take() else { return };
        let entries = open.menu.update(cx, |menu, cx| {
            menu.drop_submenu(cx);
            menu.base_entries.take().unwrap_or_else(|| std::mem::take(&mut menu.entries))
        });
        if let Some(MenuEntry::Item(item)) = self.entries.get_mut(open.index) {
            item.submenu = Some(entries);
        }
    }

    fn activate(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.item(index) else { return };
        if !item.actionable() {
            return;
        }
        if item.is_submenu() || self.submenu.as_ref().is_some_and(|open| open.index == index) {
            self.highlighted = Some(index);
            self.open_submenu(index, true, window, cx);
            return;
        }
        let handler = item.handler.clone();
        if item.keep_open {
            // A check box row flips its own mark at once; the handler may still rebuild the rows.
            if let Some(MenuEntry::Item(item)) = self.entries.get_mut(index)
                && let Some(checked) = item.checked.as_mut()
            {
                *checked = !*checked;
                cx.notify();
            }
            if let Some(handler) = handler {
                window.defer(cx, move |window, cx| handler(window, cx));
            }
            return;
        }
        cx.emit(DismissEvent);
        // Deferred, as a row that keeps the menu open already is: a handler that runs here runs
        // inside the menu's own update, and nearly every one of them goes on to update the view
        // that opened the menu — which may itself be the update this click arrived in. That is
        // the "already being updated" panic, and a panic in an event handler aborts the app.
        if let Some(handler) = handler {
            window.defer(cx, move |window, cx| handler(window, cx));
        }
    }

    /// Swaps the rows of an open menu, as when a list it shows has loaded; the highlight stays on
    /// its row while that row is still actionable.
    pub fn set_entries(&mut self, entries: Vec<MenuEntry>, cx: &mut Context<Self>) {
        self.update_entries(|current| *current = entries, cx);
    }

    /// Changes the rows of an open menu in place (`set_entries`).
    pub fn update_entries(&mut self, change: impl FnOnce(&mut Vec<MenuEntry>), cx: &mut Context<Self>) {
        self.drop_submenu(cx);
        change(&mut self.entries);
        if self.highlighted.is_some_and(|index| !self.item(index).is_some_and(MenuItem::actionable) || !self.visible(index)) {
            self.highlighted = None;
        }
        cx.notify();
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let rows = self.actionable();
        if self.search.is_some() {
            let modifiers = &event.keystroke.modifiers;
            let key = &event.keystroke.key;
            let typed = event
                .keystroke
                .key_char
                .clone()
                .or_else(|| match key.as_str() {
                    "space" => Some(" ".to_string()),
                    key if key.chars().count() == 1 => Some(key.to_string()),
                    _ => None,
                })
                .filter(|_| !modifiers.control && !modifiers.platform && !modifiers.function);
            if event.keystroke.key == "backspace" {
                self.type_query(|query| { query.pop(); }, window, cx);
                cx.stop_propagation();
                return;
            }
            if let Some(typed) = typed.filter(|text| !text.chars().any(char::is_control)) {
                self.type_query(|query| query.push_str(&typed), window, cx);
                cx.stop_propagation();
                return;
            }
        }
        match event.keystroke.key.as_str() {
            "escape" => {
                if self.parent.is_some() {
                    cx.emit(CloseSubmenu);
                } else {
                    cx.emit(DismissEvent);
                }
            }
            "left" if self.parent.is_some() => cx.emit(CloseSubmenu),
            "down" => self.step(1, window, cx),
            "up" => self.step(-1, window, cx),
            "home" | "pageup" => self.highlight(rows.first().copied(), false, window, cx),
            "end" | "pagedown" => self.highlight(rows.last().copied(), false, window, cx),
            "right" => {
                if let Some(index) = self.highlighted.filter(|index| self.item(*index).is_some_and(MenuItem::is_submenu)) {
                    self.open_submenu(index, true, window, cx);
                }
            }
            "enter" | "space" => {
                if let Some(index) = self.highlighted {
                    self.activate(index, window, cx);
                }
            }
            _ => return,
        }
        cx.stop_propagation();
    }

    fn on_mouse_down_out(&mut self, event: &MouseDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.parent.is_some()
            || self.contains(event.position, cx)
            || self.trigger_bounds.is_some_and(|bounds| bounds.contains(&event.position))
        {
            return;
        }
        self.dismissed_by_press = Some((event.position, web_time::Instant::now()));
        cx.emit(DismissEvent);
    }

    /// Icons show only when every row in a separator-delimited group has one, so a group with
    /// some icons stays aligned.
    fn icon_visibility(&self) -> Vec<bool> {
        let mut visible = vec![false; self.entries.len()];
        let mut start = 0;
        for index in 0..=self.entries.len() {
            if matches!(self.entries.get(index), Some(MenuEntry::Item(_)) | Some(MenuEntry::Label(_)) | Some(MenuEntry::Text(_))) {
                continue;
            }
            let items: Vec<&MenuItem> = (start..index).filter_map(|row| self.item(row)).collect();
            if !items.is_empty() && items.iter().all(|item| item.icon.is_some() || item.icon_image.is_some()) {
                visible[start..index].iter_mut().for_each(|flag| *flag = true);
            }
            start = index + 1;
        }
        visible
    }
}

impl Render for Menu {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let icons = self.icon_visibility();
        let entity = cx.entity().downgrade();
        let viewport = window.viewport_size();
        let own_bounds = self.bounds;

        let rows: Vec<AnyElement> = self
            .entries
            .iter()
            .enumerate()
            .filter(|(index, entry)| match &self.search {
                Some(search) if search.is_searching() => matches!(entry, MenuEntry::Item(_)) && self.visible(*index),
                _ => true,
            })
            .map(|(index, entry)| match entry {
                MenuEntry::Separator => div().my(px(4.)).mx(px(-4.)).h(px(1.)).bg(colors.border).into_any_element(),
                MenuEntry::Label(label) => div()
                    .px(px(8.))
                    .pt(px(6.))
                    .pb(px(4.))
                    .text_size(typography::text_caption())
                    .line_height(px(16.))
                    .font_weight(typography::MEDIUM)
                    .text_color(colors.subtle_foreground)
                    .child(label.clone())
                    .into_any_element(),
                MenuEntry::Text(text) => div()
                    .px(px(8.))
                    .pb(px(4.))
                    .text_size(typography::text_sm())
                    .line_height(px(16.))
                    .text_color(colors.subtle_foreground)
                    .child(text.clone())
                    .into_any_element(),
                MenuEntry::Item(item) => {
                    let open_submenu = self.submenu.as_ref().filter(|open| open.index == index);
                    let highlighted = !item.disabled && (self.highlighted == Some(index) || open_submenu.is_some());
                    let destructive = item.tone == MenuItemTone::Destructive;
                    let (text, icon_color) = if item.disabled {
                        (colors.subtle_foreground, colors.subtle_foreground)
                    } else if highlighted {
                        (colors.primary_foreground, colors.primary_foreground)
                    } else {
                        match item.tone {
                            MenuItemTone::Default => (colors.foreground, colors.muted_foreground),
                            MenuItemTone::Accent => (colors.primary, colors.primary),
                            MenuItemTone::Destructive => (colors.destructive, colors.destructive),
                        }
                    };
                    let quiet = if highlighted { colors.primary_foreground } else { colors.subtle_foreground };
                    let fill = if highlighted {
                        Some(if destructive { colors.destructive } else { colors.primary })
                    } else if item.selected {
                        Some(colors.selected)
                    } else {
                        None
                    };
                    let is_submenu = item.is_submenu() || open_submenu.is_some();
                    let has_trailing = item.shortcut.is_some() || item.trailing.is_some() || is_submenu || item.checked.is_some() || item.external;
                    let submenu = open_submenu.map(|open| open.menu.clone());
                    // A submenu opens to the right, or to the left when the right has no room for
                    // it; snapping it into the window instead slid it over this menu's rows.
                    let opens_left = submenu.as_ref().is_some_and(|menu| {
                        let width = menu.read(cx).bounds.map_or(px(240.), |bounds| bounds.size.width);
                        own_bounds.is_some_and(|own| own.right() + px(8.) + width > viewport.width - px(8.))
                    });
                    let disabled = item.disabled;
                    div()
                        .id(index)
                        .relative()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .min_h(px(28.))
                        .w_full()
                        .px(px(8.))
                        .py(px(4.))
                        .rounded(metrics::radius())
                        .whitespace_nowrap()
                        .text_color(text)
                        .when_some(item.tooltip.clone(), |this, tooltip| this.anchored_tooltip(move || crate::Tooltip::new(tooltip.clone())))
                        .when_some(fill, |this, fill| this.bg(fill))
                        .when(icons[index], |this| match item.icon_image.clone() {
                            Some(source) => this.child(gpui::img(source).flex_none().size(px(14.))),
                            None => this.children(item.icon.map(|icon| Icon::new(icon).size(IconSize::Small).color(icon_color))),
                        })
                        .map(|this| match item.description.clone() {
                            Some(description) => this.items_start().child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .flex()
                                    .flex_col()
                                    .child(div().truncate().child(item.label.clone()))
                                    .child(div().truncate().text_color(quiet).child(description)),
                            ),
                            None => this.child(div().flex_1().min_w_0().truncate().child(item.label.clone())),
                        })
                        .children(item.value.clone().map(|value| {
                            div().ml_auto().min_w_0().max_w(px(128.)).truncate().text_color(quiet).child(value)
                        }))
                        .when(has_trailing, |this| this.child(
                            div()
                                .ml_auto()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(8.))
                                .children(item.shortcut.as_ref().map(|shortcut| div().pl(px(16.)).text_color(quiet).child(crate::shortcut_text(shortcut))))
                                .children(match &item.trailing {
                                    Some(Trailing::Disclosure) => {
                                        Some(Icon::new(IconName::ChevronRight).size(IconSize::XSmall).color(quiet).into_any_element())
                                    }
                                    Some(Trailing::Text(label)) => Some(div().text_color(quiet).child(label.clone()).into_any_element()),
                                    None => None,
                                })
                                .when(is_submenu, |this| {
                                    this.child(Icon::new(IconName::ChevronRight).size(IconSize::XSmall).color(quiet))
                                })
                                .when(item.external, |this| this.child(Icon::new(IconName::OpenExternal).size(IconSize::XSmall).color(quiet)))
                                .children(item.checked.map(|checked| {
                                    div().flex().items_center().justify_center().size(px(14.)).when(checked, |this| {
                                        this.child(Icon::new(IconName::Check).size(IconSize::Small).color(text))
                                    })
                                })),
                        ))
                        .when(!disabled, |this| {
                            this.on_hover(cx.listener(move |this, hovered: &bool, window, cx| {
                                if *hovered {
                                    this.highlight(Some(index), is_submenu, window, cx);
                                } else if this.highlighted == Some(index) && this.submenu.is_none() {
                                    this.highlighted = None;
                                    cx.notify();
                                }
                            }))
                            .on_click(cx.listener(move |this, _, window, cx| this.activate(index, window, cx)))
                        })
                        .children(submenu.map(|menu| {
                            let side = if opens_left { div().absolute().top_0().right_full() } else { div().absolute().top_0().left_full() };
                            side.child(
                                deferred(
                                    anchored()
                                        .anchor(if opens_left { Anchor::TopRight } else { Anchor::TopLeft })
                                        .snap_to_window_with_margin(px(8.))
                                        .child(div().when(opens_left, |this| this.mr(px(8.))).when(!opens_left, |this| this.ml(px(8.))).mt(px(-4.)).child(menu)),
                                )
                                .with_priority(MENU_PRIORITY + 1),
                            )
                        }))
                        .into_any_element()
                }
            })
            .collect();

        div()
            .id("menu")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::on_key_down))
            .on_mouse_down_out(cx.listener(Self::on_mouse_down_out))
            .occlude()
            .flex()
            .flex_col()
            .min_w(px(128.))
            .max_w(overlay_max_width())
            .when_some(self.size.width(), |this, width| this.w(width))
            .relative()
            .max_h(window.viewport_size().height - px(20.))
            .rounded(metrics::radius_lg())
            .bg(colors.overlay)
            .shadow(theme.shadows.popover.clone())
            .font_family(typography::UI_FONT)
            .text_size(typography::text_chrome())
            .line_height(px(16.))
            .text_color(colors.foreground)
            .child(div()
            .id("menu-scroll")
            .flex()
            .flex_col()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .p(px(4.))
            .children(self.search.as_ref().map(|search| {
                let searching = !search.query.is_empty();
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .min_h(px(28.))
                    .px(px(8.))
                    .mb(px(4.))
                    .border_b_1()
                    .border_color(colors.border)
                    .child(Icon::new(IconName::Search).size(IconSize::Small).color(colors.subtle_foreground))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .min_w_0()
                            .when(searching, |this| this.child(div().truncate().child(search.query.clone())))
                            .child(div().w(px(1.)).h(px(14.)).bg(colors.primary))
                            .when(!searching, |this| this.child(div().truncate().text_color(colors.subtle_foreground).child(search.placeholder.clone()))),
                    )
            }))
            .children(rows)
            .when(self.search.as_ref().is_some_and(MenuSearch::is_searching) && self.actionable().is_empty(), |this| {
                let empty = self.search.as_ref().map(|search| search.empty.clone()).unwrap_or_default();
                this.child(div().px(px(8.)).py(px(6.)).text_color(colors.subtle_foreground).child(empty))
            }))
            .child(crate::Scrollbar::new("menu-scrollbar", &self.scroll))
            .child(
                canvas(
                    move |bounds, window, cx| {
                        crate::occlusion::report(bounds, window, cx);
                        entity.update(cx, |menu, _| menu.bounds = Some(bounds)).ok();
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
    }
}

/// A menu open over the workbench, and where it hangs from.
pub struct OpenMenu {
    /// Drawn by the OS instead (a right click on macOS); falls back to the in-app menu when the
    /// OS menu can't show.
    native: Rc<std::cell::Cell<bool>>,
    pub key: SharedString,
    pub menu: Entity<Menu>,
    pub position: Point<Pixels>,
    pub anchor: Anchor,
    /// Where the keyboard was before the menu took it, for [`OpenMenu::close`].
    previous_focus: Option<FocusHandle>,
    _subscription: Subscription,
}

/// The last menu a press outside it closed.
struct PressDismissed {
    key: SharedString,
    position: Point<Pixels>,
    at: web_time::Instant,
}

impl gpui::Global for PressDismissed {}

impl OpenMenu {
    /// Opens `entries` at `position` (a click, or a trigger's corner) and calls `on_dismiss` once
    /// it closes, so the owner can forget it.
    pub fn new<V: 'static>(
        key: impl Into<SharedString>,
        entries: Vec<MenuEntry>,
        position: Point<Pixels>,
        anchor: Anchor,
        window: &mut Window,
        cx: &mut Context<V>,
        on_dismiss: impl Fn(&mut V, &mut Context<V>) + 'static,
    ) -> Self {
        Self::sized(key, entries, MenuSize::Auto, position, anchor, window, cx, on_dismiss)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn sized<V: 'static>(
        key: impl Into<SharedString>,
        entries: Vec<MenuEntry>,
        size: MenuSize,
        position: Point<Pixels>,
        anchor: Anchor,
        window: &mut Window,
        cx: &mut Context<V>,
        on_dismiss: impl Fn(&mut V, &mut Context<V>) + 'static,
    ) -> Self {
        let key: SharedString = key.into();
        let previous_focus = window.focused(cx);
        let native = Rc::new(std::cell::Cell::new(crate::native_menu::is_context_click(window)));
        let menu = Menu::build_sized(entries, size, window, cx);
        // The press that just closed this menu landed on its trigger, whose click now opens it
        // again: it stays closed (hidden now, dismissed right after) so the trigger toggles.
        let reopened = cx.try_global::<PressDismissed>().is_some_and(|last| {
            last.key == key && last.at.elapsed() < std::time::Duration::from_millis(1500) && {
                let moved = window.mouse_position() - last.position;
                moved.x.abs() < px(12.) && moved.y.abs() < px(12.)
            }
        });
        if reopened {
            cx.remove_global::<PressDismissed>();
            native.set(true);
            let closing = menu.clone();
            cx.defer(move |cx| closing.update(cx, |_, cx| cx.emit(DismissEvent)));
        }
        // The menu took focus; once it closes, focus goes back where it was unless a picked row
        // moved it on purpose. Without this, keys go to the dead menu until the user clicks.
        let restore = previous_focus.clone();
        let restore_on_close = previous_focus.clone();
        let dismissed_key = key.clone();
        let subscription = cx.subscribe_in(&menu, window, move |this, menu, _: &DismissEvent, window, cx| {
            if let Some((position, at)) = menu.update(cx, |menu, _| menu.dismissed_by_press.take()) {
                cx.set_global(PressDismissed { key: dismissed_key.clone(), position, at });
            }
            on_dismiss(this, cx);
            if let Some(previous) = &restore {
                let menu_focus = menu.read(cx).focus_handle(cx);
                if window.focused(cx).is_none_or(|focused| focused == menu_focus || menu_focus.contains_focused(window, cx)) {
                    window.focus(previous, cx);
                }
            }
            cx.notify();
        });
        #[cfg(target_os = "macos")]
        if native.get() && !reopened {
            Self::show_native(menu.clone(), position, native.clone(), previous_focus, window, cx);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = previous_focus;
        Self { native, key, menu, position, anchor, previous_focus: restore_on_close, _subscription: subscription }
    }

    /// Closes a menu the owner is putting away itself (the trigger clicked again, Escape, a row
    /// that opens something else), handing the keyboard back the way a press outside it would.
    /// Dropping the menu instead runs no dismiss handler, and a window with nothing focused
    /// answers no shortcut until the next click.
    pub fn close(self, window: &mut Window, cx: &mut App) {
        let Some(previous) = self.previous_focus.as_ref() else { return };
        let menu_focus = self.menu.read(cx).focus_handle(cx);
        if window.focused(cx).is_none_or(|focused| focused == menu_focus || menu_focus.contains_focused(window, cx)) {
            window.focus(previous, cx);
        }
    }

    /// Shows the menu as an OS menu once the current event is handled: AppKit tracks it in a
    /// nested run loop, which must not run inside a GPUI update.
    #[cfg(target_os = "macos")]
    fn show_native<V: 'static>(
        menu: Entity<Menu>,
        position: Point<Pixels>,
        native: Rc<std::cell::Cell<bool>>,
        previous_focus: Option<FocusHandle>,
        window: &mut Window,
        cx: &mut Context<V>,
    ) {
        cx.spawn_in(window, async move |this, cx| {
            let popup = cx
                .update(|window, cx| {
                    let menu = menu.read(cx);
                    let searchable = menu.search.is_some() || menu.entries.iter().any(|entry| matches!(entry, MenuEntry::Item(item) if item.submenu_search.is_some()));
                    if searchable { None } else { crate::native_menu::popup(&menu.entries, position, window) }
                })
                .ok()
                .flatten();
            let Some(popup) = popup else {
                native.set(false);
                this.update(cx, |_, cx| cx.notify()).ok();
                return;
            };
            let handler = popup.show();
            cx.update(|window, cx| {
                if let Some(focus) = previous_focus {
                    window.focus(&focus, cx);
                }
                menu.update(cx, |_, cx| cx.emit(DismissEvent));
                if let Some(handler) = handler {
                    handler(window, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    /// Puts a search field over the menu's rows (`Menu::set_searchable`).
    pub fn searchable(self, placeholder: impl Into<SharedString>, empty: impl Into<SharedString>, cx: &mut App) -> Self {
        let (placeholder, empty) = (placeholder.into(), empty.into());
        self.menu.update(cx, |menu, _| menu.set_searchable(placeholder, empty));
        self
    }

    pub fn render(&self) -> impl IntoElement {
        if self.native.get() {
            return div().into_any_element();
        }
        deferred(
            anchored()
                .position(self.position)
                .anchor(self.anchor)
                .snap_to_window_with_margin(px(8.))
                .child(div().mt(px(4.)).child(self.menu.clone())),
        )
        // Above every anchored overlay (the inline edit prompt and the popovers draw at 3 and
        // below), or a menu opened from inside one falls behind it (#796).
        .with_priority(MENU_PRIORITY)
        .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(menu: &Menu) -> Vec<String> {
        menu.entries.iter().filter_map(|entry| if let MenuEntry::Item(item) = entry { Some(item.label.to_string()) } else { None }).collect()
    }

    #[gpui::test]
    fn keep_open_check_rows_flip_and_query_sources_answer(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| theme::init(cx, None, theme::Appearance::Dark, false));
        let window = cx.add_window(|_, cx| {
            let mut menu = Menu::new(vec![MenuItem::new("Wrap").checked(false).keep_open().on_select(|_, _| {}).into(), MenuItem::new("a.rs").into()], MenuSize::Auto, cx.focus_handle());
            menu.set_searchable("Search", "None");
            menu.set_query_source(Rc::new(|query, _, _| vec![MenuItem::new(format!("{query}.rs")).into(), MenuItem::new(format!("src/{query}")).into()]));
            menu
        });
        window
            .update(cx, |menu, window, cx| {
                menu.activate(0, window, cx);
                assert_eq!(menu.item(0).and_then(|item| item.checked), Some(true));
                menu.type_query(|query| query.push_str("lib"), window, cx);
                assert_eq!(labels(menu), ["lib.rs", "src/lib"]);
                assert_eq!(menu.actionable(), [0, 1], "the source's rows are not filtered again");
                menu.type_query(|query| query.clear(), window, cx);
                assert_eq!(labels(menu), ["Wrap", "a.rs"]);
            })
            .unwrap();
    }
}
