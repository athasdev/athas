//! The data grid (`components/data-grid.tsx`): rows and columns drawn only where they are in
//! view, a header with types and sort, resizable columns, NULL badges, and a selected cell that
//! arrows move and Cmd-C copies.

use ui::TooltipExt as _;
use std::{ops::Range, rc::Rc};

use gpui::{
    Anchor, App, ClipboardItem, Context, EventEmitter, FocusHandle, Focusable, KeyBinding, MouseButton,
    MouseDownEvent, MouseMoveEvent, Pixels, Point, ScrollStrategy, SharedString, UniformListScrollHandle, Window,
    actions, div, prelude::*, px, uniform_list,
};
use serde_json::Value;
use theme::ActiveTheme;
use ui::{Icon, IconName, IconSize, MenuEntry, MenuItem, OpenMenu, metrics, typography};

use crate::{
    format,
    model::{Column, ForeignKey, ResultSet, SortDirection},
};

actions!(
    database_grid,
    [MoveUp, MoveDown, MoveLeft, MoveRight, PageUp, PageDown, FirstRow, LastRow, CopyCell, OpenRow, DeleteRow, ClearSelection]
);

const CONTEXT: &str = "DatabaseGrid";
/// `DATA_GRID_ROW_HEIGHT`.
const ROW_HEIGHT: Pixels = px(34.);
const GUTTER: Pixels = px(52.);
const MIN_WIDTH: f32 = 60.;
const MAX_AUTO_WIDTH: f32 = 320.;

pub fn bind_keys(cx: &mut App) {
    let context = Some(CONTEXT);
    cx.bind_keys([
        KeyBinding::new("up", MoveUp, context),
        KeyBinding::new("down", MoveDown, context),
        KeyBinding::new("left", MoveLeft, context),
        KeyBinding::new("right", MoveRight, context),
        KeyBinding::new("pageup", PageUp, context),
        KeyBinding::new("pagedown", PageDown, context),
        KeyBinding::new("cmd-up", FirstRow, context),
        KeyBinding::new("cmd-down", LastRow, context),
        KeyBinding::new("home", FirstRow, context),
        KeyBinding::new("end", LastRow, context),
        KeyBinding::new("cmd-c", CopyCell, context),
        KeyBinding::new("ctrl-c", CopyCell, context),
        KeyBinding::new("enter", OpenRow, context),
        KeyBinding::new("space", OpenRow, context),
        KeyBinding::new("cmd-backspace", DeleteRow, context),
        KeyBinding::new("delete", DeleteRow, context),
        KeyBinding::new("escape", ClearSelection, context),
    ]);
}

#[derive(Clone, Debug, PartialEq)]
pub enum GridEvent {
    Sort(String),
    FilterBy { column: String, value: Value },
    /// Show a row in the row editor, focusing a column.
    OpenRow { row: usize, column: Option<usize> },
    DeleteRow(usize),
    /// Follow a foreign key to the row it points at.
    FollowKey { table: String, column: String, value: Value },
    /// Show a JSON value formatted (`ExpandedCellValue`).
    ViewJson { column: String, text: String },
}

#[derive(Clone, Debug)]
pub struct GridColumn {
    pub name: SharedString,
    pub ty: SharedString,
    pub primary_key: bool,
    pub foreign_key: Option<ForeignKey>,
    pub width: Pixels,
}

/// What the grid allows on the rows it shows.
#[derive(Clone, Copy, Debug, Default)]
pub struct GridCapabilities {
    pub sort: bool,
    pub filter: bool,
    pub edit: bool,
}

pub struct DataGrid {
    focus_handle: FocusHandle,
    columns: Vec<GridColumn>,
    rows: Rc<Vec<Vec<Value>>>,
    /// Row numbers start after this, for later pages.
    row_offset: usize,
    selected: Option<(usize, usize)>,
    sort: Option<(String, SortDirection)>,
    capabilities: GridCapabilities,
    show_types: bool,
    scroll: UniformListScrollHandle,
    resizing: Option<(usize, Pixels, Pixels)>,
    open_menu: Option<OpenMenu>,
    /// The rows' width, so columns stretch to fill it as the original's `w-full` table does.
    viewport: Pixels,
    /// Each column's drawn width: its own, stretched when the columns are narrower than the grid.
    widths: Vec<Pixels>,
}

impl EventEmitter<GridEvent> for DataGrid {}

impl Focusable for DataGrid {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl DataGrid {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            columns: Vec::new(),
            rows: Rc::new(Vec::new()),
            row_offset: 0,
            selected: None,
            sort: None,
            capabilities: GridCapabilities::default(),
            show_types: true,
            scroll: UniformListScrollHandle::new(),
            resizing: None,
            open_menu: None,
            viewport: px(0.),
            widths: Vec::new(),
        }
    }

    /// Shows `result`. `schema` names the table's columns, with types and keys, when it has one.
    /// Widths the user set are kept for columns that stay.
    pub fn set_data(
        &mut self,
        result: ResultSet,
        schema: &[Column],
        foreign_keys: &[ForeignKey],
        row_offset: usize,
        cx: &mut Context<Self>,
    ) {
        let previous: Vec<(SharedString, Pixels)> =
            self.columns.iter().map(|column| (column.name.clone(), column.width)).collect();
        let reset_scroll = self.columns.len() != result.columns.len()
            || self.columns.iter().zip(&result.columns).any(|(column, name)| column.name.as_ref() != name);
        self.columns = result
            .columns
            .iter()
            .enumerate()
            .map(|(ix, name)| {
                let column = schema.iter().find(|column| column.name == *name);
                let ty = column.map_or_else(|| infer_type(&result.rows, ix), |column| column.ty.clone());
                let width = previous
                    .iter()
                    .find(|(previous, _)| previous.as_ref() == name)
                    .map_or_else(|| auto_width(name, &ty, &result.rows, ix), |(_, width)| *width);
                GridColumn {
                    name: name.clone().into(),
                    ty: ty.into(),
                    primary_key: column.is_some_and(|column| column.primary_key),
                    foreign_key: foreign_keys.iter().find(|key| key.from_column == *name).cloned(),
                    width,
                }
            })
            .collect();
        self.relayout();
        self.rows = Rc::new(result.rows);
        self.row_offset = row_offset;
        if let Some((row, column)) = self.selected
            && (row >= self.rows.len() || column >= self.columns.len())
        {
            self.selected = None;
        }
        if reset_scroll {
            self.scroll.0.borrow().base_handle.set_offset(Point::default());
            self.selected = None;
        }
        cx.notify();
    }

    pub fn set_sort(&mut self, sort: Option<(String, SortDirection)>, cx: &mut Context<Self>) {
        self.sort = sort;
        cx.notify();
    }

    pub fn set_capabilities(&mut self, capabilities: GridCapabilities, cx: &mut Context<Self>) {
        self.capabilities = capabilities;
        cx.notify();
    }

    pub fn set_show_types(&mut self, show: bool, cx: &mut Context<Self>) {
        self.show_types = show;
        cx.notify();
    }

    pub fn scroll_to_top(&mut self) {
        self.scroll.0.borrow().base_handle.set_offset(Point::default());
    }

    pub fn row(&self, ix: usize) -> Option<&Vec<Value>> {
        self.rows.get(ix)
    }

    pub fn select(&mut self, row: usize, column: usize, cx: &mut Context<Self>) {
        if row < self.rows.len() && column < self.columns.len() {
            self.selected = Some((row, column));
            self.scroll.scroll_to_item(row, ScrollStrategy::Nearest);
            self.reveal_column(column);
            cx.notify();
        }
    }

    pub fn column_names(&self) -> Vec<String> {
        self.columns.iter().map(|column| column.name.to_string()).collect()
    }

    /// The columns as the row editor lists them, for results without a table behind them.
    pub fn schema(&self) -> Vec<Column> {
        self.columns
            .iter()
            .map(|column| Column {
                name: column.name.to_string(),
                ty: column.ty.to_string(),
                notnull: false,
                default_value: None,
                primary_key: column.primary_key,
            })
            .collect()
    }

    pub fn row_count(&self) -> usize {
        self.rows.len()
    }

    /// Recomputes the drawn widths: a `w-full` table gives the spare width to its columns in
    /// proportion to their own widths.
    fn relayout(&mut self) {
        self.widths = stretch_widths(self.columns.iter().map(|column| column.width), self.viewport - GUTTER);
    }

    fn width(&self, column: usize) -> Pixels {
        self.widths.get(column).copied().unwrap_or_else(|| self.columns[column].width)
    }

    fn total_width(&self) -> Pixels {
        GUTTER + (0..self.columns.len()).map(|ix| self.width(ix)).fold(px(0.), |sum, width| sum + width)
    }

    fn column_left(&self, column: usize) -> Pixels {
        GUTTER + (0..column).map(|ix| self.width(ix)).fold(px(0.), |sum, width| sum + width)
    }

    /// Scrolls sideways so `column` is in view.
    fn reveal_column(&self, column: usize) {
        let handle = self.scroll.0.borrow().base_handle.clone();
        let viewport = handle.bounds().size.width;
        if viewport <= px(0.) {
            return;
        }
        let mut offset = handle.offset();
        let left = self.column_left(column);
        let right = left + self.width(column);
        if left + offset.x < GUTTER {
            offset.x = -(left - GUTTER).max(px(0.));
        } else if right + offset.x > viewport {
            offset.x = -(right - viewport);
        }
        handle.set_offset(offset);
    }

    /// The columns that intersect the viewport, given the current sideways scroll.
    fn visible_columns(&self) -> Range<usize> {
        let handle = self.scroll.0.borrow().base_handle.clone();
        let viewport = handle.bounds().size.width;
        if viewport <= px(0.) {
            return 0..self.columns.len().min(24);
        }
        let scroll_x = -handle.offset().x;
        let mut left = GUTTER;
        let mut start = None;
        let mut end = self.columns.len();
        for ix in 0..self.columns.len() {
            let right = left + self.width(ix);
            if start.is_none() && right >= scroll_x {
                start = Some(ix);
            }
            if left > scroll_x + viewport {
                end = ix;
                break;
            }
            left = right;
        }
        start.unwrap_or(0)..end
    }

    fn move_selection(&mut self, rows: isize, columns: isize, cx: &mut Context<Self>) {
        if self.rows.is_empty() || self.columns.is_empty() {
            return;
        }
        let (row, column) = self.selected.unwrap_or((0, 0));
        let row = (row as isize + rows).clamp(0, self.rows.len() as isize - 1) as usize;
        let column = (column as isize + columns).clamp(0, self.columns.len() as isize - 1) as usize;
        self.select(row, column, cx);
    }

    fn page_rows(&self) -> isize {
        let height = self.scroll.0.borrow().base_handle.bounds().size.height;
        ((height / ROW_HEIGHT).floor() as isize - 1).max(1)
    }

    fn move_up(&mut self, _: &MoveUp, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(-1, 0, cx);
    }

    fn move_down(&mut self, _: &MoveDown, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(1, 0, cx);
    }

    fn move_left(&mut self, _: &MoveLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(0, -1, cx);
    }

    fn move_right(&mut self, _: &MoveRight, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(0, 1, cx);
    }

    fn page_up(&mut self, _: &PageUp, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(-self.page_rows(), 0, cx);
    }

    fn page_down(&mut self, _: &PageDown, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(self.page_rows(), 0, cx);
    }

    fn first_row(&mut self, _: &FirstRow, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(-(self.rows.len() as isize), 0, cx);
    }

    fn last_row(&mut self, _: &LastRow, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(self.rows.len() as isize, 0, cx);
    }

    fn copy_cell(&mut self, _: &CopyCell, _: &mut Window, cx: &mut Context<Self>) {
        if let Some((row, column)) = self.selected
            && let Some(value) = self.rows.get(row).and_then(|row| row.get(column))
        {
            cx.write_to_clipboard(ClipboardItem::new_string(format::value_text(value).unwrap_or_else(|| "NULL".into())));
        }
    }

    fn open_row(&mut self, _: &OpenRow, _: &mut Window, cx: &mut Context<Self>) {
        if let Some((row, column)) = self.selected {
            cx.emit(GridEvent::OpenRow { row, column: Some(column) });
        }
    }

    fn delete_row(&mut self, _: &DeleteRow, _: &mut Window, cx: &mut Context<Self>) {
        if let Some((row, _)) = self.selected
            && self.capabilities.edit
        {
            cx.emit(GridEvent::DeleteRow(row));
        }
    }

    fn clear_selection(&mut self, _: &ClearSelection, _: &mut Window, cx: &mut Context<Self>) {
        self.selected = None;
        cx.notify();
    }

    fn cell_menu(&mut self, row: usize, column: usize, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(values) = self.rows.get(row).cloned() else { return };
        let Some(value) = values.get(column).cloned() else { return };
        let columns: Vec<String> = self.columns.iter().map(|column| column.name.to_string()).collect();
        let name = columns[column].clone();
        let grid = cx.entity().downgrade();
        let emit = move |event: GridEvent| {
            let grid = grid.clone();
            move |_: &mut Window, cx: &mut App| {
                grid.update(cx, |_, cx| cx.emit(event.clone())).ok();
            }
        };
        let copy = |text: String| move |_: &mut Window, cx: &mut App| cx.write_to_clipboard(ClipboardItem::new_string(text.clone()));

        let mut entries: Vec<MenuEntry> = vec![
            MenuItem::new("Copy value")
                .icon(IconName::Copy)
                .shortcut("⌘C")
                .on_select(copy(format::value_text(&value).unwrap_or_else(|| "NULL".into())))
                .into(),
            MenuItem::new("Copy row").on_select(copy(format::to_tsv_row(&values))).into(),
            MenuItem::new("Copy row as JSON")
                .on_select(copy(serde_json::to_string_pretty(&format::row_json(&columns, &values)).unwrap_or_default()))
                .into(),
            MenuItem::new("Copy column name").on_select(copy(name.clone())).into(),
            MenuEntry::Separator,
            MenuItem::new("Open row").icon(IconName::Rows).on_select(emit(GridEvent::OpenRow { row, column: Some(column) })).into(),
        ];
        if let Some(text) = format::json_text(&value) {
            entries.push(
                MenuItem::new("View JSON")
                    .icon(IconName::BracketsCurly)
                    .on_select(emit(GridEvent::ViewJson { column: name.clone(), text }))
                    .into(),
            );
        }
        if self.capabilities.filter {
            entries.push(
                MenuItem::new("Filter by this value")
                    .icon(IconName::Filter)
                    .on_select(emit(GridEvent::FilterBy { column: name.clone(), value: value.clone() }))
                    .into(),
            );
        }
        if let Some(key) = self.columns[column].foreign_key.clone()
            && !value.is_null()
        {
            entries.push(
                MenuItem::new(format!("Open {}.{}", key.to_table, key.to_column))
                    .icon(IconName::Link)
                    .on_select(emit(GridEvent::FollowKey { table: key.to_table, column: key.to_column, value }))
                    .into(),
            );
        }
        if self.capabilities.edit {
            entries.push(MenuEntry::Separator);
            entries.push(MenuItem::new("Delete row").icon(IconName::Trash).destructive().on_select(emit(GridEvent::DeleteRow(row))).into());
        }
        self.open_menu = Some(OpenMenu::new("cell", entries, position, Anchor::TopLeft, window, cx, |this: &mut Self, _| {
            this.open_menu = None
        }));
        cx.notify();
    }

    fn render_rows(&mut self, range: Range<usize>, _: &mut Window, cx: &mut Context<Self>) -> Vec<gpui::AnyElement> {
        let colors = cx.theme().colors.clone();
        let visible = self.visible_columns();
        let total = self.total_width();
        let before = if visible.start < self.columns.len() { self.column_left(visible.start) - GUTTER } else { px(0.) };
        let after = total - GUTTER - before - visible.clone().map(|ix| self.width(ix)).fold(px(0.), |sum, width| sum + width);
        let selected = self.selected;
        range
            .map(|row| {
                let values = &self.rows[row];
                let row_selected = selected.is_some_and(|(selected_row, _)| selected_row == row);
                div()
                    .id(("grid-row", row))
                    .flex()
                    .flex_none()
                    .w(total)
                    .h(ROW_HEIGHT)
                    .border_b_1()
                    .border_color(colors.divider)
                    .when(row_selected, |this| this.bg(colors.accent))
                    .when(!row_selected, |this| this.hover(|style| style.bg(colors.accent)))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .w(GUTTER)
                            .h_full()
                            .pl(px(10.))
                            .border_r_1()
                            .border_color(colors.divider)
                            .text_size(typography::TEXT_CAPTION)
                            .text_color(colors.subtle_foreground)
                            .child((self.row_offset + row + 1).to_string()),
                    )
                    .child(div().flex_none().w(before))
                    .children(visible.clone().map(|column| self.render_cell(row, column, values.get(column), cx)))
                    .child(div().flex_none().w(after))
                    .into_any_element()
            })
            .collect()
    }

    fn render_cell(&self, row: usize, column: usize, value: Option<&Value>, cx: &mut Context<Self>) -> gpui::AnyElement {
        let colors = &cx.theme().colors;
        let spec = &self.columns[column];
        let selected = self.selected == Some((row, column));
        let null = value.is_none_or(Value::is_null);
        let link = spec.foreign_key.is_some() && !null;
        let content = if null {
            div()
                .px(px(4.))
                .rounded(metrics::RADIUS)
                .bg(colors.accent)
                .text_size(typography::TEXT_CAPTION)
                .text_color(colors.subtle_foreground)
                .child("NULL")
                .into_any_element()
        } else if let Some((text, raw)) = value.and_then(format::date_cell) {
            div()
                .id(("grid-date", row * 4096 + column))
                .min_w_0()
                .truncate()
                .child(text)
                .anchored_tooltip(move || ui::Tooltip::new(raw.clone()))
                .into_any_element()
        } else {
            div()
                .min_w_0()
                .truncate()
                .when(link, |this| this.text_color(colors.primary))
                .child(format::cell_text(value.unwrap_or(&Value::Null)))
                .into_any_element()
        };
        div()
            .id(("grid-cell", row * 4096 + column))
            .flex()
            .flex_none()
            .items_center()
            .w(self.width(column))
            .h_full()
            .px(px(8.))
            .overflow_hidden()
            .border_r_1()
            .border_color(colors.divider)
            .when(selected, |this| this.border_2().border_color(colors.primary).bg(colors.primary_soft).px(px(7.)))
            .child(content)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    window.focus(&this.focus_handle, cx);
                    this.selected = Some((row, column));
                    if event.click_count >= 2 {
                        cx.emit(GridEvent::OpenRow { row, column: Some(column) });
                    }
                    cx.notify();
                }),
            )
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    this.selected = Some((row, column));
                    this.cell_menu(row, column, event.position, window, cx);
                }),
            )
            .into_any_element()
    }

    fn render_header(&self, scroll_x: Pixels, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let show_types = self.show_types;
        // `DataGrid`'s two-line header: the name, then the type in capitals with `PK`.
        let height = if show_types { px(54.) } else { px(32.) };
        div()
            .flex_none()
            .w_full()
            .h(height)
            .overflow_hidden()
            .bg(colors.surface)
            .border_b_1()
            .border_color(colors.divider)
            .child(
                div()
                    .relative()
                    .left(scroll_x)
                    .flex()
                    .w(self.total_width())
                    .h_full()
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .w(GUTTER)
                            .h_full()
                            .pl(px(10.))
                            .border_r_1()
                            .border_color(colors.divider)
                            .text_size(typography::TEXT_SM)
                            .text_color(colors.subtle_foreground)
                            .child("#"),
                    )
                    .children(self.columns.iter().enumerate().map(|(ix, column)| {
                        let sorted = self
                            .sort
                            .as_ref()
                            .filter(|(name, _)| name.as_str() == column.name.as_ref())
                            .map(|(_, direction)| *direction);
                        let name = column.name.to_string();
                        let sortable = self.capabilities.sort;
                        let leading = if column.primary_key {
                            Some(Icon::new(IconName::Key).size(IconSize::XSmall).color(colors.warning))
                        } else if column.foreign_key.is_some() {
                            Some(Icon::new(IconName::Link).size(IconSize::XSmall).color(colors.primary))
                        } else {
                            None
                        };
                        div()
                            .id(("grid-header", ix))
                            .relative()
                            .flex()
                            .flex_col()
                            .flex_none()
                            .justify_center()
                            .w(self.width(ix))
                            .h_full()
                            .px(px(8.))
                            .border_r_1()
                            .border_color(colors.divider)
                            .when(sortable, |this| this.hover(|style| style.bg(colors.accent)))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(4.))
                                    .min_w_0()
                                    .text_size(typography::TEXT_SM)
                                    .font_weight(typography::MEDIUM)
                                    .text_color(colors.foreground)
                                    .children(leading)
                                    .child(div().min_w_0().truncate().child(column.name.clone()))
                                    .children(sorted.map(|direction| {
                                        Icon::new(if direction == SortDirection::Asc { IconName::ArrowUp } else { IconName::ArrowDown })
                                            .size(IconSize::XSmall)
                                            .color(colors.primary)
                                    })),
                            )
                            .when(show_types, |this| {
                                this.child(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .text_size(typography::TEXT_CAPTION)
                                        .text_color(colors.subtle_foreground)
                                        .child(match (column.ty.is_empty(), column.primary_key) {
                                            (true, _) => SharedString::from("—"),
                                            (false, true) => format!("{} PK", column.ty.to_uppercase()).into(),
                                            (false, false) => column.ty.to_uppercase().into(),
                                        }),
                                )
                            })
                            .when(sortable, |this| {
                                this.on_click(cx.listener(move |_, _, _, cx| cx.emit(GridEvent::Sort(name.clone()))))
                            })
                            .child(
                                div()
                                    .id(("grid-resize", ix))
                                    .absolute()
                                    .top_0()
                                    .right(px(-3.))
                                    .w(px(6.))
                                    .h_full()
                                    .cursor_col_resize()
                                    .hover(|style| style.bg(colors.primary_soft))
                                    .on_click(|_, _, cx| cx.stop_propagation())
                                    .on_mouse_down(
                                        MouseButton::Left,
                                        cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                                            cx.stop_propagation();
                                            // Columns keep the widths they are drawn at, so the drag
                                            // only moves this one's edge.
                                            for (column, width) in this.columns.iter_mut().zip(&this.widths) {
                                                column.width = *width;
                                            }
                                            this.resizing = Some((ix, event.position.x, this.width(ix)));
                                        }),
                                    ),
                            )
                    })),
            )
    }

    /// A thin bar that shows where the viewport is in the rows or columns.
    fn render_scroll_thumbs(&self, cx: &App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        let handle = self.scroll.0.borrow().base_handle.clone();
        let bounds = handle.bounds();
        let offset = handle.offset();
        let max = handle.max_offset();
        let mut thumbs = div().absolute().top_0().left_0().size_full();
        let thumb = colors.subtle_foreground.opacity(0.35);
        if max.y > px(0.) && bounds.size.height > px(0.) {
            let viewport = bounds.size.height;
            let content = viewport + max.y;
            let length = (viewport * (viewport / content)).max(px(24.));
            let top = (viewport - length) * (-offset.y / max.y).clamp(0., 1.);
            thumbs = thumbs.child(div().absolute().right(px(2.)).top(top).w(px(6.)).h(length).rounded_full().bg(thumb));
        }
        if max.x > px(0.) && bounds.size.width > px(0.) {
            let viewport = bounds.size.width;
            let content = viewport + max.x;
            let length = (viewport * (viewport / content)).max(px(24.));
            let left = (viewport - length) * (-offset.x / max.x).clamp(0., 1.);
            thumbs = thumbs.child(div().absolute().bottom(px(2.)).left(left).h(px(6.)).w(length).rounded_full().bg(thumb));
        }
        thumbs
    }
}

/// `widths`, scaled up together to fill `available` when they are narrower than it.
fn stretch_widths(widths: impl Iterator<Item = Pixels> + Clone, available: Pixels) -> Vec<Pixels> {
    let natural = widths.clone().fold(px(0.), |sum, width| sum + width);
    if natural <= px(0.) || available <= natural {
        return widths.collect();
    }
    let scale = available / natural;
    widths.map(|width| (width * scale).floor()).collect()
}

/// A width that fits the header and a sample of the values, as the old grid sized columns.
fn auto_width(name: &str, ty: &str, rows: &[Vec<Value>], column: usize) -> Pixels {
    let header = name.chars().count().max(ty.chars().count()) as f32 * 7.5 + 40.;
    let longest = rows
        .iter()
        .take(100)
        .filter_map(|row| row.get(column))
        .map(|value| format::cell_text(value).chars().count().min(60))
        .max()
        .unwrap_or(4) as f32;
    px((longest * 7.2 + 24.).max(header).clamp(MIN_WIDTH, MAX_AUTO_WIDTH))
}

/// A column type from its values, for query results.
fn infer_type(rows: &[Vec<Value>], column: usize) -> String {
    let mut ty = "";
    for value in rows.iter().take(100).filter_map(|row| row.get(column)) {
        let this = match value {
            Value::Null => continue,
            Value::Bool(_) => "boolean",
            Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
            Value::Number(_) => "real",
            Value::String(_) => "text",
            _ => "json",
        };
        if ty.is_empty() {
            ty = this;
        } else if ty != this {
            return if matches!((ty, this), ("integer", "real") | ("real", "integer")) { "real".into() } else { String::new() };
        }
    }
    ty.to_string()
}

impl Render for DataGrid {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        self.relayout();
        let grid = cx.entity().downgrade();
        let scroll_x = self.scroll.0.borrow().base_handle.offset().x;
        let empty = self.rows.is_empty();
        div()
            .id("database-grid")
            .key_context(CONTEXT)
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::move_up))
            .on_action(cx.listener(Self::move_down))
            .on_action(cx.listener(Self::move_left))
            .on_action(cx.listener(Self::move_right))
            .on_action(cx.listener(Self::page_up))
            .on_action(cx.listener(Self::page_down))
            .on_action(cx.listener(Self::first_row))
            .on_action(cx.listener(Self::last_row))
            .on_action(cx.listener(Self::copy_cell))
            .on_action(cx.listener(Self::open_row))
            .on_action(cx.listener(Self::delete_row))
            .on_action(cx.listener(Self::clear_selection))
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
                if let Some((column, start, width)) = this.resizing {
                    if !event.dragging() {
                        this.resizing = None;
                        return;
                    }
                    this.columns[column].width = (width + event.position.x - start).max(px(MIN_WIDTH));
                    this.relayout();
                    cx.notify();
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _, _, _| this.resizing = None))
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .overflow_hidden()
            .text_size(typography::TEXT_SM)
            .text_color(colors.foreground)
            .child(self.render_header(scroll_x, cx))
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .child(
                        uniform_list("database-grid-rows", self.rows.len(), cx.processor(Self::render_rows))
                            .with_horizontal_sizing_behavior(gpui::ListHorizontalSizingBehavior::Unconstrained)
                            .track_scroll(&self.scroll)
                            .flex_1()
                            .size_full(),
                    )
                    .child(
                        gpui::canvas(
                            move |bounds, _, cx| {
                                grid.update(cx, |grid, cx| {
                                    if grid.viewport != bounds.size.width {
                                        grid.viewport = bounds.size.width;
                                        cx.notify();
                                    }
                                })
                                .ok();
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full(),
                    )
                    .when(empty, |this| {
                        this.child(
                            div()
                                .absolute()
                                .top(px(24.))
                                .left_0()
                                .w_full()
                                .flex()
                                .justify_center()
                                .text_color(colors.subtle_foreground)
                                .child(if self.columns.is_empty() { "No columns" } else { "No rows" }),
                        )
                    })
                    .child(self.render_scroll_thumbs(cx)),
            )
            .children(self.open_menu.as_ref().map(OpenMenu::render))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infers_types_from_values() {
        let rows = vec![vec![Value::from(1), Value::from("a")], vec![Value::from(1.5), Value::Null]];
        assert_eq!(infer_type(&rows, 0), "real");
        assert_eq!(infer_type(&rows, 1), "text");
    }

    #[test]
    fn columns_stretch_to_fill_the_grid() {
        let widths = [px(100.), px(300.)];
        assert_eq!(stretch_widths(widths.iter().copied(), px(800.)), vec![px(200.), px(600.)]);
        assert_eq!(stretch_widths(widths.iter().copied(), px(300.)), widths.to_vec());
        assert!(stretch_widths(std::iter::empty(), px(300.)).is_empty());
    }

    #[test]
    fn widths_stay_in_bounds() {
        let rows = vec![vec![Value::from("x".repeat(500))]];
        assert_eq!(auto_width("name", "text", &rows, 0), px(MAX_AUTO_WIDTH));
        assert!(auto_width("id", "integer", &[], 0) >= px(MIN_WIDTH));
    }
}
