//! The one shell for every "many files in one scroll" surface: diff reviews, search results,
//! diagnostics, pull request files (`features/editor/components/multibuffer` of Athas). It stacks
//! each file under a header that sticks to the top while its body scrolls, lets files collapse,
//! and docks a file navigator (flat list or tree, fuzzy filter, resizable) that follows whichever
//! file is at the top.
//!
//! A pane keeps a [`Multibuffer`] as a field, hands it its [`Section`]s, and draws the body rows
//! itself: its list processor asks [`Multibuffer::entry`] what each list index is and draws
//! headers with [`Multibuffer::render_header`]. [`Multibuffer::render`] lays out the pane header,
//! the list, the sticky header and the navigator.

mod model;

use std::{collections::HashSet, ops::Range, rc::Rc};

use gpui::{
    AnyElement, App, ClickEvent, Context, Entity, FocusHandle, Focusable, Hsla, KeyDownEvent, ListAlignment, ListOffset, ListState, MouseButton,
    MouseMoveEvent, Pixels, SharedString, Subscription, UniformListScrollHandle, Window, div, img, prelude::*, px,
    uniform_list,
};
use theme::{ActiveTheme, ThemeColors};
use ui::TooltipExt as _;
use ui::{Button, ButtonSize, Icon, IconName, IconSize, InputAppearance, SidebarListItem, TextInput, TextInputEvent, metrics, typography};

pub use model::{
    DEFAULT_NAVIGATOR_WIDTH, Entry, NavAction, NavigatorMode, Section, Tone, TreeRow, filter_sections, flatten, fuzzy_score,
    navigate, navigator_width, section_at, tree_rows,
};

pub const HEADER_HEIGHT: Pixels = px(36.);
const NAVIGATOR_ROW: Pixels = px(28.);
const TREE_INDENT: f32 = 12.;
const ICON: Pixels = px(14.);

/// What opening a section does (its header's name button).
pub type OpenHandler<V> = Rc<dyn Fn(&mut V, &mut Window, &mut Context<V>)>;

/// The compact pane header over a multibuffer, with the Files toggle before `actions`.
pub struct Header {
    pub icon: Option<IconName>,
    pub title: AnyElement,
    pub detail: Option<AnyElement>,
    pub actions: Vec<AnyElement>,
}

impl Tone {
    pub fn color(self, colors: &ThemeColors) -> Hsla {
        match self {
            Tone::Neutral => colors.foreground,
            Tone::Subtle => colors.subtle_foreground,
            Tone::Added => colors.git_added,
            Tone::Deleted => colors.git_deleted,
            Tone::Modified => colors.git_modified,
            Tone::Renamed => colors.git_renamed,
            Tone::Error => colors.destructive,
            Tone::Info => colors.info,
            Tone::Warning => colors.warning,
        }
    }
}

/// The icon theme's icon for a file, or the built-in one.
pub fn file_icon(name: &str, tone: Tone, cx: &App) -> AnyElement {
    extensions::file_icon(name, ICON, cx)
        .unwrap_or_else(|| Icon::new(IconName::File).size(IconSize::XSmall).color(tone.color(&cx.theme().colors)).into_any_element())
}

fn folder_icon(name: &str, expanded: bool, cx: &App) -> AnyElement {
    match extensions::icon_for(name, true, expanded, cx) {
        Some(source) => img(source).flex_none().size(ICON).into_any_element(),
        None => Icon::new(if expanded { IconName::FolderOpen } else { IconName::Folder })
            .size(IconSize::XSmall)
            .color(cx.theme().colors.subtle_foreground)
            .into_any_element(),
    }
}

fn readings(readings: &[(SharedString, Tone)], colors: &ThemeColors) -> Option<AnyElement> {
    (!readings.is_empty()).then(|| {
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .children(readings.iter().map(|(label, tone)| div().flex_none().text_color(tone.color(colors)).child(label.clone())))
            .into_any_element()
    })
}

pub struct Multibuffer<V: 'static> {
    accessor: fn(&mut V) -> &mut Multibuffer<V>,
    id: SharedString,
    sections: Vec<Section>,
    entries: Vec<Entry>,
    starts: Vec<usize>,
    collapsed: HashSet<SharedString>,
    footer: bool,
    list: ListState,
    navigator_open: bool,
    mode: NavigatorMode,
    filter: Entity<TextInput>,
    collapsed_dirs: HashSet<String>,
    width: f32,
    resize: Option<(Pixels, f32)>,
    selected: Option<SharedString>,
    navigator_scroll: UniformListScrollHandle,
    /// Keyboard focus in the navigator, and the row it is on.
    navigator_focus: FocusHandle,
    navigator_cursor: Option<usize>,
    /// Called with a section's key when the navigator picks it, beside scrolling to it.
    on_select: Option<SelectHandler<V>>,
    _subscription: Subscription,
}

pub type SelectHandler<V> = Rc<dyn Fn(&mut V, SharedString, &mut Window, &mut Context<V>)>;

impl<V: 'static> Multibuffer<V> {
    /// `accessor` finds the multibuffer in its pane.
    pub fn new(
        id: impl Into<SharedString>,
        navigator_open: bool,
        accessor: fn(&mut V) -> &mut Multibuffer<V>,
        window: &mut Window,
        cx: &mut Context<V>,
    ) -> Self {
        let filter = cx.new(|cx| TextInput::new(window, cx).placeholder("Filter files").appearance(InputAppearance::Bare).leading_icon(IconName::Search));
        let subscription = cx.subscribe(&filter, |_, _, event: &TextInputEvent, cx| {
            if matches!(event, TextInputEvent::Changed(_)) {
                cx.notify();
            }
        });
        let list = ListState::new(0, ListAlignment::Top, px(800.));
        let owner = cx.entity_id();
        list.set_scroll_handler(move |_, _, cx| cx.notify(owner));
        Self {
            accessor,
            id: id.into(),
            sections: Vec::new(),
            entries: Vec::new(),
            starts: Vec::new(),
            collapsed: HashSet::new(),
            footer: false,
            list,
            navigator_open,
            mode: NavigatorMode::Flat,
            filter,
            collapsed_dirs: HashSet::new(),
            width: DEFAULT_NAVIGATOR_WIDTH,
            resize: None,
            selected: None,
            navigator_scroll: UniformListScrollHandle::new(),
            navigator_focus: cx.focus_handle(),
            navigator_cursor: None,
            on_select: None,
            _subscription: subscription,
        }
    }

    /// Replaces the sections, keeping the scroll position and the collapsed ones that remain.
    /// `footer` adds an [`Entry::Footer`] after them.
    pub fn set_sections(&mut self, sections: Vec<Section>, footer: bool) {
        let keys: HashSet<&SharedString> = sections.iter().map(|section| &section.key).collect();
        self.collapsed.retain(|key| keys.contains(key));
        let changed = sections != self.sections || footer != self.footer;
        self.sections = sections;
        self.footer = footer;
        if changed {
            self.rebuild();
        }
    }

    fn rebuild(&mut self) {
        let top = self.list.logical_scroll_top();
        let (entries, starts) = flatten(&self.sections, &self.collapsed, self.footer);
        self.entries = entries;
        self.starts = starts;
        self.list.reset(self.entries.len());
        let last = self.entries.len().saturating_sub(1);
        self.list.scroll_to(ListOffset { item_ix: top.item_ix.min(last), offset_in_item: if top.item_ix > last { px(0.) } else { top.offset_in_item } });
    }

    pub fn sections(&self) -> &[Section] {
        &self.sections
    }

    pub fn list(&self) -> &ListState {
        &self.list
    }

    pub fn entry(&self, index: usize) -> Option<Entry> {
        self.entries.get(index).copied()
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    /// The list index of a section's row, if the section is open.
    pub fn index_of(&self, section: usize, row: usize) -> Option<usize> {
        let start = *self.starts.get(section)?;
        (!self.is_collapsed(section) && row < self.sections[section].rows).then_some(start + 1 + row)
    }

    pub fn is_collapsed(&self, section: usize) -> bool {
        self.sections.get(section).is_some_and(|section| self.collapsed.contains(&section.key))
    }

    pub fn set_collapsed(&mut self, section: usize, collapsed: bool) {
        let Some(key) = self.sections.get(section).map(|section| section.key.clone()) else { return };
        let changed = if collapsed { self.collapsed.insert(key) } else { self.collapsed.remove(&key) };
        if changed {
            self.rebuild();
        }
    }

    pub fn toggle_collapsed(&mut self, section: usize) {
        self.set_collapsed(section, !self.is_collapsed(section));
    }

    pub fn set_all_collapsed(&mut self, collapsed: bool) {
        self.collapsed = if collapsed { self.sections.iter().map(|section| section.key.clone()).collect() } else { HashSet::new() };
        self.rebuild();
    }

    /// Scrolls a section's header to the top and highlights it in the navigator.
    pub fn scroll_to_section(&mut self, section: usize) {
        let Some(&start) = self.starts.get(section) else { return };
        self.selected = Some(self.sections[section].key.clone());
        self.list.scroll_to(ListOffset { item_ix: start, offset_in_item: px(0.) });
    }

    /// Runs `handler` when the navigator picks a section, as a pane whose body is not this
    /// multibuffer's list (the Problems pane grouped by severity) needs.
    pub fn set_on_select(&mut self, handler: impl Fn(&mut V, SharedString, &mut Window, &mut Context<V>) + 'static) {
        self.on_select = Some(Rc::new(handler));
    }

    fn picked(owner: &mut V, accessor: fn(&mut V) -> &mut Multibuffer<V>, section: usize, window: &mut Window, cx: &mut Context<V>) {
        let this = accessor(owner);
        let Some((handler, key)) = this.on_select.clone().zip(this.sections.get(section).map(|section| section.key.clone())) else { return };
        handler(owner, key, window, cx);
    }

    pub fn select_key(&mut self, key: &str) {
        if let Some(section) = self.sections.iter().position(|section| section.key.as_ref() == key) {
            self.scroll_to_section(section);
        }
    }

    /// Opens the section if collapsed and scrolls one of its rows into view.
    pub fn reveal_row(&mut self, section: usize, row: usize) {
        self.set_collapsed(section, false);
        if let Some(index) = self.index_of(section, row) {
            self.list.scroll_to_reveal_item(index);
        }
    }

    /// The section at the top of the view.
    pub fn top_section(&self) -> Option<usize> {
        let top = self.list.logical_scroll_top().item_ix;
        section_at(&self.starts, top, self.entries.len()).or_else(|| (!self.sections.is_empty() && top >= self.entries.len()).then(|| self.sections.len() - 1))
    }

    /// The section whose header is pinned over the list: the top one, once its own header has
    /// begun to scroll away.
    pub fn sticky_section(&self) -> Option<usize> {
        let top = self.list.logical_scroll_top();
        let section = section_at(&self.starts, top.item_ix, self.entries.len())?;
        (top.item_ix != self.starts[section] || top.offset_in_item > px(0.)).then_some(section)
    }

    /// The key the navigator highlights: the section at the top of the view.
    pub fn active_key(&self) -> Option<SharedString> {
        self.top_section().map(|section| self.sections[section].key.clone()).or_else(|| self.selected.clone())
    }

    pub fn navigator_open(&self) -> bool {
        self.navigator_open
    }

    pub fn set_navigator_open(&mut self, open: bool) {
        self.navigator_open = open;
    }

    pub fn navigator_mode(&self) -> NavigatorMode {
        self.mode
    }

    pub fn set_navigator_mode(&mut self, mode: NavigatorMode) {
        self.mode = mode;
    }

    /// The navigator's rows as the tree shows them; the flat list is a tree without folders.
    fn navigator_rows(&self, cx: &App) -> Vec<TreeRow> {
        let query = self.filter_text(cx);
        let kept = filter_sections(&self.sections, &query);
        match self.mode {
            NavigatorMode::Flat => kept.into_iter().map(|section| TreeRow::File { section, label: String::new(), depth: 0 }).collect(),
            NavigatorMode::Tree => tree_rows(&self.sections, &kept, &self.collapsed_dirs, !query.trim().is_empty()),
        }
    }

    /// Moves the navigator's cursor; returns the section Enter picked.
    fn navigator_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<V>) -> Option<usize> {
        if self.filter.focus_handle(cx).is_focused(window) && event.keystroke.key == "down" {
            self.navigator_cursor = Some(0);
            window.focus(&self.navigator_focus, cx);
            cx.stop_propagation();
            cx.notify();
            return None;
        }
        if !self.navigator_focus.is_focused(window) {
            return None;
        }
        let rows = self.navigator_rows(cx);
        let current = self.navigator_cursor.unwrap_or(0);
        let forced = !self.filter_text(cx).trim().is_empty();
        let action = navigate(&rows, current, event.keystroke.key.as_str())?;
        let mut picked = None;
        match action {
            NavAction::Select(index) => {
                self.navigator_cursor = Some(index);
                self.navigator_scroll.scroll_to_item(index, gpui::ScrollStrategy::Nearest);
            }
            NavAction::Expand(dir) if !forced => {
                self.collapsed_dirs.remove(&dir);
            }
            NavAction::Collapse(dir) if !forced => {
                self.collapsed_dirs.insert(dir);
            }
            NavAction::Open(section) => {
                self.scroll_to_section(section);
                picked = Some(section);
            }
            NavAction::Expand(_) | NavAction::Collapse(_) => {}
        }
        cx.stop_propagation();
        cx.notify();
        picked
    }

    /// The navigator's filter text.
    pub fn filter_text(&self, cx: &App) -> String {
        self.filter.read(cx).text().to_string()
    }

    // Drawing.

    /// The one control that shows or hides the navigator, as every multibuffer mounts it; the
    /// file count follows the label when `with_count`.
    pub fn render_toggle(&self, with_count: bool, cx: &mut Context<V>) -> AnyElement {
        let accessor = self.accessor;
        let open = self.navigator_open;
        let count = self.sections.len();
        let label = if with_count { format!("Files {count}") } else { "Files".to_string() };
        Button::new(SharedString::from(format!("{}-files-toggle", self.id)), label)
            .leading_icon(IconName::Files)
            .size(ButtonSize::Small)
            .active(open)
            .disabled(count == 0)
            .tooltip(if open { "Hide the file list" } else { "Show the file list" })
            .on_click(cx.listener(move |owner, _, _, cx| {
                let this = accessor(owner);
                this.navigator_open = !this.navigator_open;
                cx.notify();
            }))
            .into_any_element()
    }

    /// A section's header: the collapse chevron, the file (opening it, or else scrolling to it),
    /// the trailing readings and `actions`.
    pub fn render_header(&self, section: usize, actions: Vec<AnyElement>, on_open: Option<OpenHandler<V>>, cx: &mut Context<V>) -> AnyElement {
        let Some(item) = self.sections.get(section) else { return div().into_any_element() };
        let colors = cx.theme().colors.clone();
        let accessor = self.accessor;
        let collapsed = self.is_collapsed(section);
        let id = format!("{}-section-{section}", self.id);
        let hover = colors.accent;
        let name = item.name().to_string();
        let dir = item.dir().to_string();
        div()
            .id(SharedString::from(id.clone()))
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .w_full()
            .min_w_0()
            .h(HEADER_HEIGHT)
            .px(px(6.))
            .border_b_1()
            .border_color(colors.divider)
            .bg(colors.background)
            .font_family(typography::UI_FONT)
            .text_size(typography::TEXT_SM)
            .child(
                Button::icon(SharedString::from(format!("{id}-toggle")), if collapsed { IconName::ChevronRight } else { IconName::ChevronDown })
                    .size(ButtonSize::XSmall)
                    .tooltip(if collapsed { format!("Expand {name}") } else { format!("Collapse {name}") })
                    .on_click(cx.listener(move |owner, _, _, cx| {
                        cx.stop_propagation();
                        accessor(owner).toggle_collapsed(section);
                        cx.notify();
                    })),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{id}-open")))
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap(px(6.))
                    .h(px(28.))
                    .px(px(6.))
                    .rounded(metrics::RADIUS_MD)
                    .hover(move |style| style.bg(hover))
                    .child(file_icon(item.icon_name(), item.tone, cx))
                    .child(div().flex_none().max_w(relative_half()).truncate().font_weight(typography::MEDIUM).text_color(colors.foreground).child(name))
                    .when(!dir.is_empty(), |this| this.child(div().flex_1().min_w_0().truncate().text_color(colors.subtle_foreground).child(dir)))
                    .anchored_tooltip({ let text: gpui::SharedString = (item.path.clone()).into(); move || ui::Tooltip::new(text.clone()) })
                    .on_click(cx.listener(move |owner, _: &ClickEvent, window, cx| match &on_open {
                        Some(open) => open(owner, window, cx),
                        None => {
                            accessor(owner).scroll_to_section(section);
                            cx.notify();
                        }
                    })),
            )
            .children(readings(&item.trailing, &colors).map(|trailing| div().flex_none().px(px(4.)).text_color(colors.subtle_foreground).child(trailing)))
            .when(!actions.is_empty(), |this| this.child(div().flex().flex_none().items_center().gap(px(2.)).text_color(colors.subtle_foreground).children(actions)))
            .into_any_element()
    }

    /// The whole surface: `header` (when the pane has no toolbar of its own), `body` (the list),
    /// the pinned `sticky` header, an `overlay` such as a find popover, and the navigator.
    pub fn render(&self, header: Option<Header>, body: AnyElement, sticky: Option<AnyElement>, overlay: Option<AnyElement>, cx: &mut Context<V>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let accessor = self.accessor;
        let header = header.map(|header| {
            let mut actions = vec![self.render_toggle(true, cx)];
            if !header.actions.is_empty() {
                actions.push(div().w(px(1.)).h(px(16.)).mx(px(2.)).bg(colors.divider).into_any_element());
                actions.extend(header.actions);
            }
            ui::pane_header(cx)
                .px(px(12.))
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .min_w_0()
                        .items_center()
                        .gap(px(8.))
                        .children(header.icon.map(|icon| Icon::new(icon).size(IconSize::Small).color(colors.subtle_foreground)))
                        .child(div().flex().min_w_0().items_center().text_color(colors.foreground).font_weight(typography::MEDIUM).child(header.title))
                        .children(header.detail.map(|detail| div().flex().flex_none().items_center().text_color(colors.subtle_foreground).child(detail))),
                )
                .child(ui::pane_actions().children(actions))
        });
        let show_navigator = self.navigator_open && !self.sections.is_empty();
        div()
            .id(SharedString::from(format!("{}-multibuffer", self.id)))
            .relative()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .min_w_0()
            .overflow_hidden()
            .bg(colors.background)
            .children(header)
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .overflow_hidden()
                    .child(
                        div()
                            .relative()
                            .flex()
                            .flex_col()
                            .flex_1()
                            // Grows from nothing: its content's width never pushes the navigator off.
                            .flex_basis(gpui::relative(0.))
                            .min_h_0()
                            .min_w_0()
                            .overflow_hidden()
                            .child(body)
                            .children(sticky.map(|sticky| div().absolute().top_0().left_0().right_0().child(sticky)))
                            .children(overlay),
                    )
                    .when(show_navigator, |this| this.child(self.render_navigator(cx))),
            )
            .when(self.resize.is_some(), |this| {
                this.on_mouse_move(cx.listener(move |owner, event: &MouseMoveEvent, _, cx| {
                    let this = accessor(owner);
                    if let Some((start, width)) = this.resize {
                        let parent = f32::from(this.list.viewport_bounds().size.width) + this.width;
                        this.width = navigator_width(width + f32::from(start - event.position.x), (parent > 0.).then_some(parent));
                        cx.notify();
                    }
                }))
                .on_mouse_up(MouseButton::Left, cx.listener(move |owner, _, _, cx| {
                    accessor(owner).resize = None;
                    cx.notify();
                }))
            })
            .into_any_element()
    }

    fn render_navigator(&self, cx: &mut Context<V>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let accessor = self.accessor;
        let query = self.filter_text(cx);
        let kept = filter_sections(&self.sections, &query);
        let count = match self.mode {
            NavigatorMode::Flat => kept.len(),
            NavigatorMode::Tree => tree_rows(&self.sections, &kept, &self.collapsed_dirs, !query.trim().is_empty()).len(),
        };
        let mode_button = |mode: NavigatorMode, icon: IconName, tooltip: &'static str, cx: &mut Context<V>| {
            Button::icon(SharedString::from(format!("{}-navigator-{tooltip}", self.id)), icon)
                .size(ButtonSize::XSmall)
                .active(self.mode == mode)
                .tooltip(tooltip)
                .on_click(cx.listener(move |owner, _, _, cx| {
                    accessor(owner).mode = mode;
                    cx.notify();
                }))
        };
        let width = self.width;
        let resize_hover = colors.primary_soft;
        let list = if kept.is_empty() {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .p(px(12.))
                .text_size(typography::TEXT_SM)
                .text_color(colors.subtle_foreground)
                .child("No files match")
                .into_any_element()
        } else {
            uniform_list(
                SharedString::from(format!("{}-navigator-list", self.id)),
                count,
                cx.processor(move |owner: &mut V, range: Range<usize>, window, cx| accessor(owner).render_navigator_rows(range, window, cx)),
            )
            .track_scroll(&self.navigator_scroll)
            .flex_1()
            .min_h_0()
            .p(px(4.))
            .into_any_element()
        };
        div()
            .id(SharedString::from(format!("{}-navigator", self.id)))
            .track_focus(&self.navigator_focus)
            .on_key_down(cx.listener(move |owner, event: &KeyDownEvent, window, cx| {
                if let Some(section) = accessor(owner).navigator_key(event, window, cx) {
                    Self::picked(owner, accessor, section, window, cx);
                }
            }))
            .relative()
            .flex()
            .flex_col()
            .flex_none()
            .w(px(width))
            .h_full()
            .min_h_0()
            .overflow_hidden()
            .border_l_1()
            .border_color(colors.divider)
            .bg(colors.background)
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .h(px(36.))
                    .pl(px(8.))
                    .pr(px(4.))
                    .border_b_1()
                    .border_color(colors.divider)
                    .child(div().flex_1().min_w_0().child(self.filter.clone()))
                    .child(mode_button(NavigatorMode::Flat, IconName::List, "Flat list", cx))
                    .child(mode_button(NavigatorMode::Tree, IconName::Sitemap, "File tree", cx)),
            )
            .child(list)
            .child(
                div()
                    .id(SharedString::from(format!("{}-navigator-resize", self.id)))
                    .absolute()
                    .top_0()
                    .left(px(-4.))
                    .w(px(8.))
                    .h_full()
                    .cursor_col_resize()
                    .hover(move |style| style.bg(resize_hover))
                    .on_mouse_down(MouseButton::Left, cx.listener(move |owner, event: &gpui::MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        let this = accessor(owner);
                        this.resize = Some((event.position.x, this.width));
                        cx.notify();
                    })),
            )
            .into_any_element()
    }

    fn render_navigator_rows(&self, range: Range<usize>, window: &mut Window, cx: &mut Context<V>) -> Vec<AnyElement> {
        let colors = cx.theme().colors.clone();
        let cursor = self.navigator_cursor.filter(|_| self.navigator_focus.is_focused(window));
        let ring = colors.focus_ring;
        let accessor = self.accessor;
        let query = self.filter_text(cx);
        let kept = filter_sections(&self.sections, &query);
        let active = self.active_key();
        let (accent, foreground) = (colors.accent, colors.foreground);
        match self.mode {
            NavigatorMode::Flat => kept[range.start.min(kept.len())..range.end.min(kept.len())]
                .iter()
                .enumerate()
                .map(|(offset, &section)| {
                    let index = range.start + offset;
                    let item = &self.sections[section];
                    let mut row = SidebarListItem::new(SharedString::from(format!("{}-nav-{section}", self.id)), item.name().to_string())
                        .leading(file_icon(item.icon_name(), item.tone, cx))
                        .active(active.as_ref() == Some(&item.key))
                        .on_click(select_section(accessor, section, index, cx));
                    if let Some(metadata) = readings(&item.metadata, &colors) {
                        row = row.trailing(metadata);
                    }
                    div().h(NAVIGATOR_ROW).rounded(metrics::RADIUS_MD).when(cursor == Some(index), |this| this.border_1().border_color(ring)).child(row).into_any_element()
                })
                .collect(),
            NavigatorMode::Tree => {
                let rows = tree_rows(&self.sections, &kept, &self.collapsed_dirs, !query.trim().is_empty());
                let forced = !query.trim().is_empty();
                rows[range.start.min(rows.len())..range.end.min(rows.len())]
                    .iter()
                    .enumerate()
                    .map(|(offset, row)| match row {
                        TreeRow::Dir { id, label, depth, expanded } => {
                            let index = range.start + offset;
                            let dir = id.clone();
                            let name = label.rsplit('/').next().unwrap_or(label).to_string();
                            div()
                                .id(SharedString::from(format!("{}-nav-dir-{}", self.id, range.start + offset)))
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .h(NAVIGATOR_ROW)
                                .pl(px(6. + *depth as f32 * TREE_INDENT))
                                .pr(px(6.))
                                .rounded(metrics::RADIUS_MD)
                                .text_size(typography::TEXT_SM)
                                .text_color(colors.muted_foreground)
                                .hover(move |style| style.bg(accent).text_color(foreground))
                                .when(cursor == Some(index), |this| this.border_1().border_color(ring))
                                .child(Icon::new(if *expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size(IconSize::XSmall).color(colors.subtle_foreground))
                                .child(folder_icon(&name, *expanded, cx))
                                .child(div().min_w_0().truncate().child(label.clone()))
                                .anchored_tooltip({ let text: gpui::SharedString = (id.clone()).into(); move || ui::Tooltip::new(text.clone()) })
                                .when(!forced, |this| {
                                    this.on_click(cx.listener(move |owner, _, window, cx| {
                                        let this = accessor(owner);
                                        this.navigator_cursor = Some(index);
                                        window.focus(&this.navigator_focus, cx);
                                        if !this.collapsed_dirs.remove(&dir) {
                                            this.collapsed_dirs.insert(dir.clone());
                                        }
                                        cx.notify();
                                    }))
                                })
                                .into_any_element()
                        }
                        TreeRow::File { section, label, depth } => {
                            let index = range.start + offset;
                            let item = &self.sections[*section];
                            let is_active = active.as_ref() == Some(&item.key);
                            div()
                                .id(SharedString::from(format!("{}-nav-file-{section}", self.id)))
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .h(NAVIGATOR_ROW)
                                .pl(px(6. + *depth as f32 * TREE_INDENT + 16.))
                                .pr(px(6.))
                                .rounded(metrics::RADIUS_MD)
                                .text_size(typography::TEXT_SM)
                                .text_color(if is_active { colors.foreground } else { colors.muted_foreground })
                                .when(is_active, |this| this.bg(colors.selected))
                                .when(!is_active, |this| this.hover(move |style| style.bg(accent).text_color(foreground)))
                                .when(cursor == Some(index), |this| this.border_1().border_color(ring))
                                .child(file_icon(item.icon_name(), item.tone, cx))
                                .child(div().flex_1().min_w_0().truncate().child(label.clone()))
                                .children(readings(&item.metadata, &colors))
                                .anchored_tooltip({ let text: gpui::SharedString = (item.path.clone()).into(); move || ui::Tooltip::new(text.clone()) })
                                .on_click(select_section(accessor, *section, index, cx))
                                .into_any_element()
                        }
                    })
                    .collect()
            }
        }
    }
}

fn select_section<V: 'static>(accessor: fn(&mut V) -> &mut Multibuffer<V>, section: usize, index: usize, cx: &mut Context<V>) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    cx.listener(move |owner: &mut V, _: &ClickEvent, window, cx| {
        let this = accessor(owner);
        this.navigator_cursor = Some(index);
        window.focus(&this.navigator_focus, cx);
        this.scroll_to_section(section);
        cx.notify();
        Multibuffer::picked(owner, accessor, section, window, cx);
    })
}

fn relative_half() -> gpui::DefiniteLength {
    gpui::relative(0.6)
}
