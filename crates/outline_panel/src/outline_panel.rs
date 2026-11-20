//! The outline (`features/outline`): the active editor's document symbols as a tree, with a
//! text filter and a symbol-kind filter, the symbol at the caret marked, keyboard navigation,
//! and a click to jump there.

pub mod breadcrumbs;
mod outline_picker;

pub use outline_picker::OutlinePickerDelegate;

use ui::WithScrollbar as _;
use std::{collections::HashSet, path::PathBuf, time::Duration};

use editor::{Editor, LspEvent};
use gpui::{Anchor, App, AppContext as _, Context, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, KeyDownEvent, Render, ScrollHandle, SharedString, Subscription, Task, Window, div, point, prelude::*, px};
use lsp_client::lsp::{self, DocumentSymbolResponse, SymbolKind};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, InputAppearance, MenuEntry, MenuItem, OpenMenu, PaneTitle, TextInput, TextInputEvent, pane_header, typography};

/// A place to open, with a 1-based line and column.
#[derive(Clone, Debug, PartialEq)]
pub enum OutlineEvent {
    OpenLocation { path: PathBuf, line: usize, column: usize },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Symbol {
    pub name: String,
    pub detail: Option<String>,
    pub kind: SymbolKind,
    /// The whole symbol, 0-based lines.
    pub lines: (u32, u32),
    /// Where its name is (0-based line and UTF-16 column).
    pub selection: lsp::Position,
    pub children: Vec<Symbol>,
}

/// Turns a server's answer into a tree. Flat answers nest by range containment.
pub fn symbols_from_response(response: DocumentSymbolResponse) -> Vec<Symbol> {
    match response {
        DocumentSymbolResponse::Nested(symbols) => symbols.into_iter().map(nested).collect(),
        DocumentSymbolResponse::Flat(mut symbols) => {
            symbols.sort_by_key(|symbol| (symbol.location.range.start.line, std::cmp::Reverse(symbol.location.range.end.line)));
            let mut roots: Vec<Symbol> = Vec::new();
            for symbol in symbols {
                let range = symbol.location.range;
                let node = Symbol {
                    name: symbol.name,
                    detail: symbol.container_name,
                    kind: symbol.kind,
                    lines: (range.start.line, range.end.line),
                    selection: range.start,
                    children: Vec::new(),
                };
                insert_contained(&mut roots, node);
            }
            roots
        }
    }
}

fn nested(symbol: lsp::DocumentSymbol) -> Symbol {
    let mut children: Vec<Symbol> = symbol.children.unwrap_or_default().into_iter().map(nested).collect();
    children.sort_by_key(|child| child.lines.0);
    Symbol {
        name: symbol.name,
        detail: symbol.detail,
        kind: symbol.kind,
        lines: (symbol.range.start.line, symbol.range.end.line),
        selection: symbol.selection_range.start,
        children,
    }
}

fn insert_contained(siblings: &mut Vec<Symbol>, node: Symbol) {
    if let Some(parent) = siblings.iter_mut().rev().find(|parent| parent.lines.0 <= node.lines.0 && node.lines.1 <= parent.lines.1 && parent.lines != node.lines) {
        insert_contained(&mut parent.children, node);
    } else {
        siblings.push(node);
    }
}

/// The symbol-kind groups of "Filter symbol kinds" (`OUTLINE_FILTER_OPTIONS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum KindFilter {
    Types,
    Functions,
    Properties,
    Variables,
    Other,
}

impl KindFilter {
    pub const ALL: [KindFilter; 5] = [KindFilter::Types, KindFilter::Functions, KindFilter::Properties, KindFilter::Variables, KindFilter::Other];

    fn label(self) -> &'static str {
        match self {
            KindFilter::Types => "Types",
            KindFilter::Functions => "Functions",
            KindFilter::Properties => "Properties",
            KindFilter::Variables => "Variables",
            KindFilter::Other => "Other",
        }
    }

    fn icon(self) -> IconName {
        match self {
            KindFilter::Types => IconName::Grid,
            KindFilter::Functions => IconName::Function,
            KindFilter::Properties => IconName::BracketsCurly,
            KindFilter::Variables | KindFilter::Other => IconName::Code,
        }
    }

    pub fn of(kind: SymbolKind) -> Self {
        match kind {
            SymbolKind::CLASS | SymbolKind::INTERFACE | SymbolKind::STRUCT | SymbolKind::ENUM | SymbolKind::TYPE_PARAMETER => KindFilter::Types,
            SymbolKind::FUNCTION | SymbolKind::METHOD | SymbolKind::CONSTRUCTOR => KindFilter::Functions,
            SymbolKind::PROPERTY | SymbolKind::FIELD | SymbolKind::ENUM_MEMBER => KindFilter::Properties,
            SymbolKind::VARIABLE | SymbolKind::CONSTANT => KindFilter::Variables,
            _ => KindFilter::Other,
        }
    }
}

/// The symbols of the chosen kinds, with the ancestors that hold them.
pub fn filter_kinds(symbols: &[Symbol], kinds: &HashSet<KindFilter>) -> Vec<Symbol> {
    if kinds.len() == KindFilter::ALL.len() {
        return symbols.to_vec();
    }
    symbols
        .iter()
        .filter_map(|symbol| {
            let children = filter_kinds(&symbol.children, kinds);
            (kinds.contains(&KindFilter::of(symbol.kind)) || !children.is_empty()).then(|| Symbol { children, ..symbol.clone() })
        })
        .collect()
}

/// A row of the visible tree.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub depth: usize,
    /// Indices from the root to this symbol, to collapse it.
    pub path: Vec<usize>,
    pub has_children: bool,
    pub symbol: Symbol,
}

/// The rows to draw: collapsed symbols hide their children; a filter keeps the symbols whose
/// name contains it and their ancestors.
pub fn visible_rows(symbols: &[Symbol], collapsed: &HashSet<Vec<usize>>, filter: &str) -> Vec<Row> {
    fn matches(symbol: &Symbol, filter: &str) -> bool {
        symbol.name.to_lowercase().contains(filter) || symbol.children.iter().any(|child| matches(child, filter))
    }
    fn walk(symbols: &[Symbol], depth: usize, prefix: &[usize], collapsed: &HashSet<Vec<usize>>, filter: &str, out: &mut Vec<Row>) {
        for (index, symbol) in symbols.iter().enumerate() {
            if !filter.is_empty() && !matches(symbol, filter) {
                continue;
            }
            let mut path = prefix.to_vec();
            path.push(index);
            let mut row_symbol = symbol.clone();
            row_symbol.children.clear();
            out.push(Row { depth, path: path.clone(), has_children: !symbol.children.is_empty(), symbol: row_symbol });
            if filter.is_empty() && collapsed.contains(&path) {
                continue;
            }
            walk(&symbol.children, depth + 1, &path, collapsed, filter, out);
        }
    }
    let mut rows = Vec::new();
    walk(symbols, 0, &[], collapsed, &filter.to_lowercase(), &mut rows);
    rows
}

/// The innermost symbol whose lines hold `line` (0-based), as a row path.
pub fn symbol_at_line(symbols: &[Symbol], line: u32) -> Option<Vec<usize>> {
    let (index, symbol) = symbols.iter().enumerate().rfind(|(_, symbol)| symbol.lines.0 <= line && line <= symbol.lines.1)?;
    let mut path = vec![index];
    if let Some(inner) = symbol_at_line(&symbol.children, line) {
        path.extend(inner);
    }
    Some(path)
}

/// The scroll top that brings a row fully into view with `padding` to spare, or `None` when it
/// already is (`outline-scroll.ts`).
pub fn reveal_scroll_top(scroll_top: f32, viewport_top: f32, viewport_bottom: f32, row_top: f32, row_bottom: f32, padding: f32) -> Option<f32> {
    let visible_top = viewport_top + padding;
    let visible_bottom = viewport_bottom - padding;
    if row_top < visible_top {
        return Some((scroll_top - (visible_top - row_top)).max(0.));
    }
    if row_bottom > visible_bottom {
        return Some((scroll_top + row_bottom - visible_bottom).max(0.));
    }
    None
}

fn kind_icon(kind: SymbolKind) -> IconName {
    match kind {
        SymbolKind::FUNCTION | SymbolKind::METHOD | SymbolKind::CONSTRUCTOR => IconName::Function,
        SymbolKind::CLASS | SymbolKind::STRUCT | SymbolKind::INTERFACE | SymbolKind::OBJECT => IconName::BracketsCurly,
        SymbolKind::MODULE | SymbolKind::NAMESPACE | SymbolKind::PACKAGE => IconName::Package,
        SymbolKind::ENUM | SymbolKind::ENUM_MEMBER => IconName::List,
        SymbolKind::CONSTANT | SymbolKind::NUMBER | SymbolKind::BOOLEAN | SymbolKind::STRING => IconName::Hash,
        SymbolKind::TYPE_PARAMETER => IconName::Tag,
        SymbolKind::FILE => IconName::File,
        SymbolKind::EVENT => IconName::Bolt,
        SymbolKind::KEY => IconName::Key,
        _ => IconName::Cube,
    }
}

const REFRESH_DELAY: Duration = Duration::from_millis(400);

pub struct OutlinePanel {
    focus_handle: FocusHandle,
    editor: Option<Entity<Editor>>,
    symbols: Vec<Symbol>,
    collapsed: HashSet<Vec<usize>>,
    filter: Entity<TextInput>,
    kinds: HashSet<KindFilter>,
    /// The row keyboard navigation is on.
    selected: Option<usize>,
    kind_menu: Option<OpenMenu>,
    scroll: ScrollHandle,
    /// A row to bring into view once the list has been laid out.
    reveal: Option<usize>,
    /// The caret's symbol when last drawn, so the list follows it as it moves.
    last_active: Option<Vec<usize>>,
    /// Whether the last request found a server that answers.
    supported: bool,
    loading: bool,
    refresh: Option<Task<()>>,
    editor_subscriptions: Vec<Subscription>,
    _filter_subscription: Subscription,
}

impl EventEmitter<OutlineEvent> for OutlinePanel {}

impl Focusable for OutlinePanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl OutlinePanel {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let filter = cx.new(|cx| TextInput::new(window, cx).placeholder("Filter outline").appearance(InputAppearance::Bare).leading_icon(IconName::Filter));
        let filter_subscription = cx.subscribe_in(&filter, window, |panel, filter, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Changed(_) => {
                panel.selected = None;
                cx.notify();
            }
            TextInputEvent::Cancelled => {
                filter.update(cx, |input, cx| input.set_text("", cx));
                window.focus(&panel.focus_handle, cx);
            }
            _ => {}
        });
        Self {
            focus_handle: cx.focus_handle(),
            editor: None,
            symbols: Vec::new(),
            collapsed: HashSet::new(),
            filter,
            kinds: KindFilter::ALL.into_iter().collect(),
            selected: None,
            kind_menu: None,
            scroll: ScrollHandle::new(),
            reveal: None,
            last_active: None,
            supported: false,
            loading: false,
            refresh: None,
            editor_subscriptions: Vec::new(),
            _filter_subscription: filter_subscription,
        }
    }

    /// Follows the active editor (or none, when the centre shows something else).
    pub fn editor(&self) -> Option<&Entity<Editor>> {
        self.editor.as_ref()
    }

    pub fn set_editor(&mut self, editor: Option<Entity<Editor>>, cx: &mut Context<Self>) {
        if self.editor.as_ref().map(Entity::entity_id) == editor.as_ref().map(Entity::entity_id) {
            return;
        }
        self.editor_subscriptions.clear();
        self.symbols.clear();
        self.collapsed.clear();
        self.supported = false;
        if let Some(editor) = &editor {
            self.editor_subscriptions.push(cx.subscribe(editor, |panel, _, event: &LspEvent, cx| {
                if *event == LspEvent::SymbolsChanged {
                    panel.schedule_refresh(true, cx);
                }
            }));
            // Redraws follow the caret, to mark the symbol it is in.
            self.editor_subscriptions.push(cx.observe(editor, |_, _, cx| cx.notify()));
        }
        self.editor = editor;
        self.schedule_refresh(false, cx);
        cx.notify();
    }

    pub fn symbols(&self) -> &[Symbol] {
        &self.symbols
    }

    fn schedule_refresh(&mut self, debounce: bool, cx: &mut Context<Self>) {
        let Some(editor) = self.editor.clone() else {
            self.refresh = None;
            return;
        };
        self.loading = true;
        self.refresh = Some(cx.spawn(async move |this, cx| {
            if debounce {
                cx.background_executor().timer(REFRESH_DELAY).await;
            }
            let request = editor.update(cx, |editor, _| editor.request_document_symbols());
            let response = match request {
                Some(request) => request.await.ok(),
                None => None,
            };
            this.update(cx, |panel, cx| {
                panel.loading = false;
                panel.supported = response.is_some();
                if let Some(response) = response {
                    panel.symbols = response.map(symbols_from_response).unwrap_or_default();
                }
                cx.notify();
            })
            .ok();
        }));
    }

    fn rows(&self, cx: &App) -> Vec<Row> {
        let filter = self.filter.read(cx).text().to_string();
        visible_rows(&filter_kinds(&self.symbols, &self.kinds), &self.collapsed, filter.trim())
    }

    fn open_kind_menu(&mut self, position: gpui::Point<gpui::Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let weak = cx.weak_entity();
        let all = self.kinds.len() == KindFilter::ALL.len();
        let mut entries = vec![
            MenuEntry::from(MenuItem::new("Show All").icon(IconName::Filter).disabled(all).on_select({
                let weak = weak.clone();
                move |_, cx| {
                    weak.update(cx, |panel, cx| {
                        panel.kinds = KindFilter::ALL.into_iter().collect();
                        cx.notify();
                    })
                    .ok();
                }
            })),
            MenuEntry::Separator,
        ];
        entries.extend(KindFilter::ALL.into_iter().map(|kind| {
            let weak = weak.clone();
            MenuEntry::from(MenuItem::new(kind.label()).icon(kind.icon()).checked(self.kinds.contains(&kind)).on_select(move |_, cx| {
                weak.update(cx, |panel, cx| {
                    if !panel.kinds.remove(&kind) {
                        panel.kinds.insert(kind);
                    }
                    cx.notify();
                })
                .ok();
            }))
        }));
        self.kind_menu = Some(OpenMenu::new("outline-kinds", entries, position, Anchor::TopRight, window, cx, |panel: &mut Self, _| panel.kind_menu = None));
        cx.notify();
    }

    /// Arrow keys, Home, End and Enter over the tree; Left and Right fold, or Left goes to the
    /// parent; `/` and Cmd/Ctrl-F go to the filter, Down from it to the first row.
    fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        let modifiers = event.keystroke.modifiers;
        if self.filter.focus_handle(cx).is_focused(window) {
            if key == "down" {
                self.selected = Some(0);
                window.focus(&self.focus_handle, cx);
                cx.stop_propagation();
                cx.notify();
            }
            return;
        }
        if (modifiers.platform || modifiers.control) && key == "f" || key == "/" {
            self.filter.update(cx, |input, cx| input.focus(window, cx));
            cx.stop_propagation();
            return;
        }
        let rows = self.rows(cx);
        if rows.is_empty() {
            return;
        }
        let last = rows.len() - 1;
        let current = self.selected.unwrap_or(0).min(last);
        let row = &rows[current];
        let selected = match key {
            "down" => Some((current + 1).min(last)),
            "up" => Some(current.saturating_sub(1)),
            "home" => Some(0),
            "end" => Some(last),
            "enter" | "space" => {
                let selection = row.symbol.selection;
                self.jump(selection, window, cx);
                None
            }
            "right" if row.has_children && self.collapsed.contains(&row.path) => {
                self.collapsed.remove(&row.path);
                Some(current)
            }
            "left" if row.has_children && !self.collapsed.contains(&row.path) => {
                self.collapsed.insert(row.path.clone());
                Some(current)
            }
            "left" if row.path.len() > 1 => {
                let parent = &row.path[..row.path.len() - 1];
                rows.iter().position(|candidate| candidate.path == parent).or(Some(current))
            }
            _ => return,
        };
        if selected.is_some() {
            self.selected = selected;
            self.reveal = selected;
        }
        cx.stop_propagation();
        cx.notify();
    }

    fn reveal_row(&mut self) {
        let Some(index) = self.reveal else { return };
        let Some(row) = self.scroll.bounds_for_item(index) else { return };
        self.reveal = None;
        let viewport = self.scroll.bounds();
        let offset = self.scroll.offset();
        let scroll_top = -f32::from(offset.y);
        let row_top = f32::from(row.top()) - scroll_top;
        let row_bottom = f32::from(row.bottom()) - scroll_top;
        if let Some(top) = reveal_scroll_top(scroll_top, f32::from(viewport.top()), f32::from(viewport.bottom()), row_top, row_bottom, 4.) {
            let max = f32::from(self.scroll.max_offset().y);
            self.scroll.set_offset(point(offset.x, -px(top.min(max))));
        }
    }

    /// Open a File: the system file dialog, then the file in the editor.
    fn open_file(window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
        cx.spawn_in(window, async move |_, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            cx.update(|_, cx| workbench_api::open_file(cx, path, None)).ok();
        })
        .detach();
    }

    fn jump(&mut self, selection: lsp::Position, window: &mut Window, cx: &mut Context<Self>) {
        let Some(editor) = self.editor.clone() else { return };
        let (line, column) = (selection.line as usize + 1, selection.character as usize + 1);
        let path = editor.update(cx, |editor, cx| {
            editor.go_to_line(line, Some(column), cx);
            editor.path().to_path_buf()
        });
        let handle = editor.read(cx).focus_handle(cx);
        window.focus(&handle, cx);
        cx.emit(OutlineEvent::OpenLocation { path, line, column });
    }
}

impl Render for OutlinePanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let filter = self.filter.read(cx).text().to_string();
        let rows = self.rows(cx);
        let keyboard_row = self.selected.filter(|_| self.focus_handle.is_focused(window));
        let caret_line = self.editor.as_ref().map(|editor| editor.read(cx).cursor_position().0.saturating_sub(1) as u32);
        let active = caret_line.and_then(|line| symbol_at_line(&self.symbols, line));
        if active != self.last_active {
            if let Some(path) = &active {
                self.reveal = rows.iter().position(|row| &row.path == path).or(self.reveal);
            }
            self.last_active = active.clone();
        }
        self.reveal_row();
        let header = pane_header(cx).child(PaneTitle::new("Outline").icon(IconName::Sitemap).detail(if rows.is_empty() { String::new() } else { rows.len().to_string() }));
        let body = if rows.is_empty() {
            // `outline-sidebar.tsx`: a message (with Open a File when there is nothing to
            // outline), a spinner while symbols load.
            let state = match (&self.editor, self.loading, self.supported) {
                (Some(_), true, _) => None,
                (None, _, _) => Some(("No active file.", true)),
                (Some(_), false, false) => Some(("No outline for the active file.", true)),
                _ => Some(("No symbols found.", false)),
            };
            let content = match state {
                None => ui::Spinner::new("outline-loading").label("Loading outline").show_label().compact().into_any_element(),
                Some((message, open)) => {
                    let mut empty = EmptyState::new("").message(message);
                    if open {
                        empty = empty.action(
                            Button::new("outline-open-file", "Open a File").on_click(cx.listener(|_, _, window, cx| Self::open_file(window, cx))),
                        );
                    }
                    empty.into_any_element()
                }
            };
            div().flex().flex_1().items_center().justify_center().min_h(px(96.)).px(px(12.)).py(px(24.)).child(content).into_any_element()
        } else {
            let list = rows.into_iter().enumerate().map(|(index, row)| {
                let is_active = active.as_ref() == Some(&row.path);
                let is_selected = keyboard_row == Some(index);
                let collapsed = self.collapsed.contains(&row.path);
                let toggle_path = row.path.clone();
                let selection = row.symbol.selection;
                div()
                    .id(("outline-row", index))
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .h(px(24.))
                    .pl(px(6. + row.depth as f32 * 14.))
                    .pr(px(8.))
                    .rounded(px(5.))
                    .text_size(typography::TEXT_SM)
                    .text_color(if is_active { colors.foreground } else { colors.muted_foreground })
                    .when(is_active, |this| this.bg(colors.selected))
                    .when(is_selected, |this| this.border_1().border_color(colors.focus_ring))
                    .when(!is_active, |this| this.hover(|style| style.bg(colors.accent).text_color(colors.foreground)))
                    .on_click(cx.listener(move |panel, _, window, cx| {
                        panel.selected = Some(index);
                        panel.jump(selection, window, cx);
                    }))
                    .child(
                        div()
                            .id(("outline-toggle", index))
                            .flex_none()
                            .w(px(12.))
                            .when(row.has_children, |this| {
                                this.child(Icon::new(if collapsed { IconName::ChevronRight } else { IconName::ChevronDown }).size(IconSize::XSmall).color(colors.subtle_foreground))
                                    .on_click(cx.listener(move |panel, _, _, cx| {
                                        cx.stop_propagation();
                                        if !panel.collapsed.remove(&toggle_path) {
                                            panel.collapsed.insert(toggle_path.clone());
                                        }
                                        cx.notify();
                                    }))
                            }),
                    )
                    .child(Icon::new(kind_icon(row.symbol.kind)).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .child(div().flex_none().max_w(px(220.)).truncate().child(row.symbol.name.clone()))
                    .children(row.symbol.detail.clone().map(|detail| {
                        div().flex_1().min_w_0().truncate().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child(SharedString::from(detail))
                    }))
            });
            div().id("outline-list").flex().flex_col().flex_1().min_h_0().overflow_y_scroll().px(px(6.)).pb(px(6.)).children(list).scrollbar_with(&self.scroll).into_any_element()
        };
        let all_kinds = self.kinds.len() == KindFilter::ALL.len();
        let filter_bar = div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(4.))
            .mx(px(8.))
            .mb(px(4.))
            .child(div().flex_1().min_w_0().h(px(30.)).px(px(8.)).flex().items_center().rounded(px(6.)).bg(colors.field).child(self.filter.clone()))
            .when(!filter.is_empty(), |this| {
                this.child(
                    Button::icon("outline-clear-filter", IconName::X)
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .tooltip("Clear filter")
                        .on_click(cx.listener(|panel, _, window, cx| {
                            panel.filter.update(cx, |input, cx| {
                                input.set_text("", cx);
                                input.focus(window, cx);
                            });
                        })),
                )
            })
            .child(
                Button::icon("outline-kinds", IconName::Filter)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Small)
                    .active(!all_kinds)
                    .tooltip("Filter symbol kinds")
                    .on_click(cx.listener(|panel, event: &gpui::ClickEvent, window, cx| {
                        let position = event.position();
                        panel.open_kind_menu(point(position.x, position.y + px(10.)), window, cx);
                    })),
            );
        div()
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::key_down))
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .child(header)
            .child(filter_bar)
            .child(body)
            .children(self.kind_menu.as_ref().map(|menu| menu.render()))
    }
}

#[cfg(test)]
mod tests {
    use lsp_client::lsp::{Location, Position, Range, SymbolInformation, Url};

    use super::*;

    #[allow(deprecated)]
    fn flat(name: &str, kind: SymbolKind, start: u32, end: u32) -> SymbolInformation {
        SymbolInformation {
            name: name.into(),
            kind,
            tags: None,
            deprecated: None,
            location: Location { uri: Url::parse("file:///a.ts").unwrap(), range: Range::new(Position::new(start, 0), Position::new(end, 1)) },
            container_name: None,
        }
    }

    #[test]
    fn flat_symbols_nest_by_range_and_filter() {
        let symbols = symbols_from_response(DocumentSymbolResponse::Flat(vec![
            flat("helper", SymbolKind::FUNCTION, 12, 14),
            flat("Point", SymbolKind::CLASS, 0, 10),
            flat("norm", SymbolKind::METHOD, 3, 5),
        ]));
        assert_eq!(symbols.iter().map(|symbol| symbol.name.as_str()).collect::<Vec<_>>(), ["Point", "helper"]);
        assert_eq!(symbols[0].children[0].name, "norm");

        let rows = visible_rows(&symbols, &HashSet::new(), "");
        assert_eq!(rows.iter().map(|row| (row.depth, row.symbol.name.as_str())).collect::<Vec<_>>(), [(0, "Point"), (1, "norm"), (0, "helper")]);
        let collapsed = HashSet::from([vec![0]]);
        assert_eq!(visible_rows(&symbols, &collapsed, "").len(), 2);
        let filtered = visible_rows(&symbols, &collapsed, "NOR");
        assert_eq!(filtered.iter().map(|row| row.symbol.name.as_str()).collect::<Vec<_>>(), ["Point", "norm"]);

        assert_eq!(symbol_at_line(&symbols, 4), Some(vec![0, 0]));
        assert_eq!(symbol_at_line(&symbols, 8), Some(vec![0]));
        assert_eq!(symbol_at_line(&symbols, 11), None);

        let functions = filter_kinds(&symbols, &HashSet::from([KindFilter::Functions]));
        assert_eq!(visible_rows(&functions, &HashSet::new(), "").iter().map(|row| row.symbol.name.as_str()).collect::<Vec<_>>(), ["Point", "norm", "helper"]);
        let types = filter_kinds(&symbols, &HashSet::from([KindFilter::Types]));
        assert_eq!(visible_rows(&types, &HashSet::new(), "").iter().map(|row| row.symbol.name.as_str()).collect::<Vec<_>>(), ["Point"]);
    }

    #[test]
    fn reveal_scrolls_the_least_with_padding() {
        assert_eq!(reveal_scroll_top(100., 0., 200., 50., 74., 4.), None);
        assert_eq!(reveal_scroll_top(100., 0., 200., 2., 26., 4.), Some(98.));
        assert_eq!(reveal_scroll_top(100., 0., 200., 190., 214., 4.), Some(118.));
        assert_eq!(reveal_scroll_top(1., 0., 200., -30., -6., 4.), Some(0.));
    }
}
