//! The row panel beside the grid (`components/crud-modals.tsx`): every column of one row, with a
//! NULL switch per field, to read, change, insert or delete it.

use gpui::{App, Context, Entity, EventEmitter, FocusHandle, Focusable, Subscription, Window, div, prelude::*, px};
use serde_json::Value;
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, Switch, WithScrollbar, metrics, typography};

use crate::{
    format,
    model::{Column, ForeignKey, RowIdentity},
    sql_editor::{SqlEditor, SqlEditorEvent},
};

#[derive(Clone, Debug, PartialEq)]
pub enum RowMode {
    Insert,
    Edit { identity: RowIdentity },
    /// A view's row or a query result: shown, not changed.
    Read,
}

pub enum RowEditorEvent {
    /// The columns the user changed (all filled ones, for an insert) and their new values.
    Save { columns: Vec<String>, values: Vec<Value> },
    Delete,
    Close,
}

struct Field {
    column: Column,
    foreign_key: Option<ForeignKey>,
    input: Entity<SqlEditor>,
    null: bool,
    original: Option<Value>,
}

pub struct RowEditor {
    focus_handle: FocusHandle,
    mode: RowMode,
    fields: Vec<Field>,
    error: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<RowEditorEvent> for RowEditor {}

impl Focusable for RowEditor {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl RowEditor {
    /// `values` holds the row for `Edit` and `Read`, in `columns` order.
    pub fn new(
        mode: RowMode,
        columns: Vec<Column>,
        foreign_keys: &[ForeignKey],
        values: Option<Vec<Value>>,
        focus_column: Option<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut subscriptions = Vec::new();
        let fields: Vec<Field> = columns
            .into_iter()
            .enumerate()
            .map(|(ix, column)| {
                let original = values.as_ref().and_then(|values| values.get(ix).cloned());
                let text = original.as_ref().and_then(format::value_text).unwrap_or_default();
                let placeholder = match (&mode, column.default_value.as_ref()) {
                    (RowMode::Insert, Some(default)) => format!("Default: {default}"),
                    (RowMode::Insert, None) if column.primary_key => "Automatic".to_string(),
                    _ => String::new(),
                };
                let input = cx.new(|cx| {
                    let mut editor = SqlEditor::new(cx).placeholder(placeholder).plain(6);
                    editor.set_text(text, cx);
                    editor.clear_undo();
                    editor
                });
                subscriptions.push(cx.subscribe_in(&input, window, |this, _, event: &SqlEditorEvent, window, cx| {
                    match event {
                        SqlEditorEvent::Run(_) => this.save(window, cx),
                        SqlEditorEvent::Edited => {
                            this.error = None;
                            cx.notify();
                        }
                    }
                }));
                Field {
                    foreign_key: foreign_keys.iter().find(|key| key.from_column == column.name).cloned(),
                    null: matches!(original, Some(Value::Null)),
                    column,
                    input,
                    original,
                }
            })
            .collect();
        if mode != RowMode::Read
            && let Some(field) = fields.get(focus_column.unwrap_or(0))
        {
            field.input.update(cx, |input, cx| input.focus(window, cx));
        }
        Self { focus_handle: cx.focus_handle(), mode, fields, error: None, _subscriptions: subscriptions }
    }

    pub fn mode(&self) -> &RowMode {
        &self.mode
    }

    fn value(field: &Field, cx: &App) -> Value {
        if field.null {
            return Value::Null;
        }
        let text = field.input.read(cx).text().to_string();
        match &field.original {
            Some(original) if format::value_text(original).as_deref() == Some(text.as_str()) => original.clone(),
            _ => format::parse_input(&text, &field.column.ty),
        }
    }

    fn changed(field: &Field, cx: &App) -> bool {
        let value = Self::value(field, cx);
        match &field.original {
            Some(original) => *original != value,
            None => field.null || !field.input.read(cx).text().is_empty(),
        }
    }

    pub fn is_dirty(&self, cx: &App) -> bool {
        self.fields.iter().any(|field| Self::changed(field, cx))
    }

    fn save(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if self.mode == RowMode::Read {
            return;
        }
        let (columns, values): (Vec<String>, Vec<Value>) = self
            .fields
            .iter()
            .filter(|field| Self::changed(field, cx))
            .map(|field| (field.column.name.clone(), Self::value(field, cx)))
            .unzip();
        if columns.is_empty() && self.mode != RowMode::Insert {
            self.error = Some("Nothing changed".into());
            cx.notify();
            return;
        }
        if let Some(field) = self.fields.iter().find(|field| field.null && field.column.notnull && Self::changed(field, cx)) {
            self.error = Some(format!("{} cannot be NULL", field.column.name));
            cx.notify();
            return;
        }
        cx.emit(RowEditorEvent::Save { columns, values });
    }

    fn render_field(&self, ix: usize, field: &Field, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let read_only = self.mode == RowMode::Read;
        let changed = !read_only && Self::changed(field, cx);
        div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .min_w_0()
                    .when(field.column.primary_key, |this| {
                        this.child(Icon::new(IconName::Key).size(IconSize::XSmall).color(colors.warning))
                    })
                    .when(field.foreign_key.is_some(), |this| {
                        this.child(Icon::new(IconName::Link).size(IconSize::XSmall).color(colors.primary))
                    })
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .font_weight(typography::MEDIUM)
                            .text_color(colors.foreground)
                            .child(field.column.name.clone()),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(typography::TEXT_CAPTION)
                            .text_color(colors.subtle_foreground)
                            .child(field.column.ty.to_lowercase()),
                    )
                    .when(changed, |this| this.child(div().size(px(6.)).rounded_full().bg(colors.primary)))
                    .when(!read_only, |this| {
                        this.child(div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child("NULL"))
                            .child(Switch::new(("row-null", ix), field.null).on_change({
                                let editor = cx.entity().downgrade();
                                move |on, _, cx| {
                                    editor
                                        .update(cx, |this, cx| {
                                            this.fields[ix].null = on;
                                            this.error = None;
                                            cx.notify();
                                        })
                                        .ok();
                                }
                            }))
                    }),
            )
            .child(
                div()
                    .rounded(metrics::RADIUS_MD)
                    .bg(colors.field)
                    .border_1()
                    .border_color(if changed { colors.primary.opacity(0.6) } else { colors.divider })
                    .when(field.null, |this| this.opacity(0.45))
                    .when(field.null && read_only, |this| {
                        this.child(div().px(px(10.)).py(px(5.)).text_color(colors.subtle_foreground).child("NULL"))
                    })
                    .when(!(field.null && read_only), |this| this.child(field.input.clone())),
            )
    }
}

impl Render for RowEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let title = match self.mode {
            RowMode::Insert => "New row",
            RowMode::Edit { .. } => "Edit row",
            RowMode::Read => "Row",
        };
        let dirty = self.mode != RowMode::Read && self.is_dirty(cx);
        let fields: Vec<_> = self.fields.iter().enumerate().map(|(ix, field)| self.render_field(ix, field, cx).into_any_element()).collect();
        div()
            .id("row-editor")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .flex_none()
            .w(px(340.))
            .h_full()
            .border_l_1()
            .border_color(colors.divider)
            .bg(colors.background)
            .text_size(typography::TEXT_SM)
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(6.))
                    .h(px(36.))
                    .px(px(10.))
                    .border_b_1()
                    .border_color(colors.divider)
                    .child(Icon::new(IconName::Rows).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .child(div().flex_1().font_weight(typography::MEDIUM).child(title))
                    .child(
                        Button::icon("close-row", IconName::X)
                            .size(ButtonSize::Small)
                            .tooltip("Close")
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(RowEditorEvent::Close))),
                    ),
            )
            .child(
                div()
                    .id("row-fields")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .gap(px(12.))
                    .p(px(12.))
                    .overflow_y_scroll()
                    .children(fields)
                    .scrollbar(window, cx),
            )
            .when(self.mode != RowMode::Read, |this| {
                this.child(
                    div()
                        .flex()
                        .flex_none()
                        .flex_col()
                        .gap(px(8.))
                        .p(px(10.))
                        .border_t_1()
                        .border_color(colors.divider)
                        .children(self.error.clone().map(|error| {
                            div().text_color(colors.destructive).child(error)
                        }))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(6.))
                                .when(matches!(self.mode, RowMode::Edit { .. }), |this| {
                                    this.child(
                                        Button::new("delete-row", "Delete")
                                            .variant(ButtonVariant::Destructive)
                                            .leading_icon(IconName::Trash)
                                            .on_click(cx.listener(|_, _, _, cx| cx.emit(RowEditorEvent::Delete))),
                                    )
                                })
                                .child(div().flex_1())
                                .child(Button::new("cancel-row", "Cancel").on_click(cx.listener(|_, _, _, cx| cx.emit(RowEditorEvent::Close))))
                                .child(
                                    Button::new("save-row", if self.mode == RowMode::Insert { "Insert" } else { "Save" })
                                        .variant(ButtonVariant::Accent)
                                        .shortcut("⌘↵")
                                        .disabled(!dirty && self.mode != RowMode::Insert)
                                        .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                                ),
                        ),
                )
            })
    }
}
