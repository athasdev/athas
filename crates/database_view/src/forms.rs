//! The Create Table dialog (`components/crud-modals.tsx`) and PostgreSQL's Create Subscription
//! dialog (`providers/postgres/components/create-subscription-dialog.tsx`).

use gpui::{App, Context, Entity, EventEmitter, FocusHandle, Focusable, SharedString, Subscription, Window, div, prelude::*, px};
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, ButtonTone, ButtonVariant, Checkbox, Dialog, DialogLayout, DialogSize, Field, IconName, Select,
    SelectOption, TextArea, TextAreaEvent, TextInput, TextInputEvent, typography,
};

use crate::model::Provider;

pub const COLUMN_TYPES: [&str; 4] = ["TEXT", "INTEGER", "REAL", "BLOB"];

#[derive(Clone, Debug, PartialEq)]
pub struct ColumnDraft {
    pub name: String,
    pub ty: String,
    pub notnull: bool,
}

/// Trimmed names, a type for each, and no blank or repeated (case-insensitive) names.
pub fn normalize_columns(columns: Vec<ColumnDraft>) -> Vec<ColumnDraft> {
    let mut seen = std::collections::HashSet::new();
    columns
        .into_iter()
        .map(|column| ColumnDraft {
            name: column.name.trim().to_string(),
            ty: if column.ty.trim().is_empty() { "TEXT".into() } else { column.ty.trim().to_string() },
            notnull: column.notnull,
        })
        .filter(|column| !column.name.is_empty() && seen.insert(column.name.to_lowercase()))
        .collect()
}

pub fn create_table_sql(provider: Provider, name: &str, columns: &[ColumnDraft]) -> String {
    let definitions = columns
        .iter()
        .map(|column| format!("{} {}{}", provider.quote(&column.name), column.ty, if column.notnull { " NOT NULL" } else { "" }))
        .collect::<Vec<_>>()
        .join(", ");
    format!("CREATE TABLE {} ({definitions})", provider.quote(name.trim()))
}

pub enum FormEvent<T> {
    Submit(T),
    Cancel,
}

/// A dialog that runs its statement in the background and shows why it failed.
pub trait CreateForm: 'static {
    fn failed(&mut self, error: String, cx: &mut Context<Self>)
    where
        Self: Sized;
}

impl CreateForm for CreateTableForm {
    fn failed(&mut self, error: String, cx: &mut Context<Self>) {
        self.running = false;
        self.error = Some(error.into());
        cx.notify();
    }
}

impl CreateForm for SubscriptionForm {
    fn failed(&mut self, error: String, cx: &mut Context<Self>) {
        self.running = false;
        self.error = Some(error.into());
        cx.notify();
    }
}

struct ColumnRow {
    id: usize,
    name: Entity<TextInput>,
    ty: Entity<Select>,
    notnull: bool,
}

pub struct CreateTableForm {
    focus_handle: FocusHandle,
    name: Entity<TextInput>,
    columns: Vec<ColumnRow>,
    next_column: usize,
    pub error: Option<SharedString>,
    pub running: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<FormEvent<(String, Vec<ColumnDraft>)>> for CreateTableForm {}

impl Focusable for CreateTableForm {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl CreateTableForm {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = cx.new(|cx| TextInput::new(window, cx).placeholder("Enter table name"));
        let subscription = cx.subscribe_in(&name, window, Self::input_event);
        let mut form = Self {
            focus_handle: cx.focus_handle(),
            name,
            columns: Vec::new(),
            next_column: 0,
            error: None,
            running: false,
            _subscriptions: vec![subscription],
        };
        form.add_column(window, cx);
        form.name.update(cx, |input, cx| input.focus(window, cx));
        form
    }

    fn input_event(&mut self, _: &Entity<TextInput>, event: &TextInputEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            TextInputEvent::Changed(_) => {
                self.error = None;
                cx.notify();
            }
            TextInputEvent::Confirmed => self.submit(window, cx),
            TextInputEvent::Cancelled => cx.emit(FormEvent::Cancel),
            _ => {}
        }
    }

    fn add_column(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let name = cx.new(|cx| TextInput::new(window, cx).placeholder("Column name"));
        self._subscriptions.push(cx.subscribe_in(&name, window, Self::input_event));
        let ty = cx.new(|cx| {
            Select::new(COLUMN_TYPES.iter().map(|ty| SelectOption::new(*ty, *ty)).collect(), "TEXT", cx)
        });
        self.columns.push(ColumnRow { id: self.next_column, name, ty, notnull: false });
        self.next_column += 1;
        cx.notify();
    }

    fn remove_column(&mut self, id: usize, cx: &mut Context<Self>) {
        if self.columns.len() > 1 {
            self.columns.retain(|column| column.id != id);
            cx.notify();
        }
    }

    fn drafts(&self, cx: &App) -> (String, Vec<ColumnDraft>) {
        let columns = self
            .columns
            .iter()
            .map(|column| ColumnDraft {
                name: column.name.read(cx).text().to_string(),
                ty: column.ty.read(cx).value().to_string(),
                notnull: column.notnull,
            })
            .collect();
        (self.name.read(cx).text().trim().to_string(), normalize_columns(columns))
    }

    fn can_submit(&self, cx: &App) -> bool {
        let (name, columns) = self.drafts(cx);
        !name.is_empty() && !columns.is_empty() && !self.running
    }

    fn submit(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if self.can_submit(cx) {
            cx.emit(FormEvent::Submit(self.drafts(cx)));
        }
    }
}

impl Render for CreateTableForm {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let removable = self.columns.len() > 1;
        let entity = cx.entity().downgrade();
        let rows = self.columns.iter().map(|column| {
            let id = column.id;
            let toggle = entity.clone();
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(div().flex_1().min_w_0().child(column.name.clone()))
                .child(div().w(px(120.)).flex_none().child(column.ty.clone()))
                .child(
                    Checkbox::new(("column-notnull", id), column.notnull).label("NOT NULL").on_change(move |checked, _, cx| {
                        toggle
                            .update(cx, |form, cx| {
                                if let Some(row) = form.columns.iter_mut().find(|row| row.id == id) {
                                    row.notnull = checked;
                                }
                                cx.notify();
                            })
                            .ok();
                    }),
                )
                .when(removable, |this| {
                    this.child(
                        Button::icon(("remove-column", id), IconName::X)
                            .size(ButtonSize::Small)
                            .tone(ButtonTone::Danger)
                            .tooltip("Remove column")
                            .on_click(cx.listener(move |this, _, _, cx| this.remove_column(id, cx))),
                    )
                })
        });
        let can_submit = self.can_submit(cx);
        let cancel = cx.entity().downgrade();
        div().track_focus(&self.focus_handle).w(px(560.)).max_w_full().child(
            Dialog::new("create-table", "Create New Table")
                .icon(IconName::Plus)
                .size(DialogSize::Lg)
                .layout(DialogLayout::Form)
                .on_close(move |_, cx| {
                    cancel.update(cx, |_, cx| cx.emit(FormEvent::Cancel)).ok();
                })
                .child(Field::new().label("Table Name").control(self.name.clone()))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(typography::TEXT_SM)
                                .font_weight(typography::MEDIUM)
                                .text_color(colors.foreground)
                                .child("Columns"),
                        )
                        .children(rows)
                        .child(
                            div().flex().child(
                                Button::new("add-column", "Add Column")
                                    .variant(ButtonVariant::Ghost)
                                    .size(ButtonSize::Small)
                                    .leading_icon(IconName::Plus)
                                    .on_click(cx.listener(|this, _, window, cx| this.add_column(window, cx))),
                            ),
                        ),
                )
                .children(self.error.clone().map(|error| div().text_color(colors.destructive).child(error)))
                .footer([
                    Button::new("cancel-create-table", "Cancel")
                        .variant(ButtonVariant::Ghost)
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(FormEvent::Cancel)))
                        .into_any_element(),
                    Button::new("submit-create-table", if self.running { "Creating…" } else { "Create Table" })
                        .variant(ButtonVariant::Accent)
                        .disabled(!can_submit)
                        .on_click(cx.listener(|this, _, window, cx| this.submit(window, cx)))
                        .into_any_element(),
                ]),
        )
    }
}

/// What the Create Subscription dialog asks for (`CreatePostgresSubscriptionParams`).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SubscriptionDraft {
    pub name: String,
    pub connection_string: String,
    pub publications: Vec<String>,
    pub enabled: bool,
    pub create_slot: bool,
    pub copy_data: bool,
    pub connect: bool,
    pub failover: bool,
    pub slot_name: Option<String>,
}

impl Default for SubscriptionDraft {
    fn default() -> Self {
        Self {
            name: String::new(),
            connection_string: String::new(),
            publications: Vec::new(),
            enabled: true,
            create_slot: true,
            copy_data: true,
            connect: true,
            failover: false,
            slot_name: None,
        }
    }
}

impl SubscriptionDraft {
    pub fn normalized(mut self) -> Self {
        self.name = self.name.trim().to_string();
        self.connection_string = self.connection_string.trim().to_string();
        self.publications = parse_publications(&self.publications.join(","));
        self.slot_name = self.slot_name.map(|slot| slot.trim().to_string()).filter(|slot| !slot.is_empty());
        self
    }

    pub fn is_complete(&self) -> bool {
        let draft = self.clone().normalized();
        !draft.name.is_empty() && !draft.connection_string.is_empty() && !draft.publications.is_empty()
    }
}

pub fn parse_publications(text: &str) -> Vec<String> {
    text.split(',').map(str::trim).filter(|name| !name.is_empty()).map(str::to_string).collect()
}

#[derive(Clone, Copy)]
enum Flag {
    Enabled,
    CreateSlot,
    CopyData,
    Connect,
    Failover,
}

pub struct SubscriptionForm {
    focus_handle: FocusHandle,
    name: Entity<TextInput>,
    connection_string: Entity<TextArea>,
    publications: Entity<TextInput>,
    slot_name: Entity<TextInput>,
    flags: SubscriptionDraft,
    pub error: Option<SharedString>,
    pub running: bool,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<FormEvent<SubscriptionDraft>> for SubscriptionForm {}

impl Focusable for SubscriptionForm {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl SubscriptionForm {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = |placeholder: &str, window: &mut Window, cx: &mut Context<Self>| {
            let placeholder = placeholder.to_string();
            cx.new(|cx| TextInput::new(window, cx).placeholder(placeholder))
        };
        let name = input("analytics_sub", window, cx);
        let publications = input("pub_one, pub_two", window, cx);
        let slot_name = input("Leave blank for default", window, cx);
        let connection_string = cx.new(|cx| {
            TextArea::new(cx).rows(3).mono().placeholder("host=127.0.0.1 port=5432 dbname=postgres user=replicator password=secret")
        });
        let mut subscriptions: Vec<Subscription> = [&name, &publications, &slot_name]
            .into_iter()
            .map(|field| {
                cx.subscribe_in(field, window, |this: &mut Self, _, event: &TextInputEvent, window, cx| match event {
                    TextInputEvent::Changed(_) => {
                        this.error = None;
                        cx.notify();
                    }
                    TextInputEvent::Confirmed => this.submit(window, cx),
                    TextInputEvent::Cancelled => cx.emit(FormEvent::Cancel),
                    _ => {}
                })
            })
            .collect();
        subscriptions.push(cx.subscribe_in(&connection_string, window, |this, _, event: &TextAreaEvent, window, cx| match event {
            TextAreaEvent::Changed => cx.notify(),
            TextAreaEvent::Submit => this.submit(window, cx),
            TextAreaEvent::Cancelled => cx.emit(FormEvent::Cancel),
        }));
        name.update(cx, |input, cx| input.focus(window, cx));
        Self {
            focus_handle: cx.focus_handle(),
            name,
            connection_string,
            publications,
            slot_name,
            flags: SubscriptionDraft::default(),
            error: None,
            running: false,
            _subscriptions: subscriptions,
        }
    }

    fn draft(&self, cx: &App) -> SubscriptionDraft {
        SubscriptionDraft {
            name: self.name.read(cx).text().to_string(),
            connection_string: self.connection_string.read(cx).text().to_string(),
            publications: parse_publications(self.publications.read(cx).text()),
            slot_name: Some(self.slot_name.read(cx).text().to_string()),
            ..self.flags.clone()
        }
        .normalized()
    }

    fn submit(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        let draft = self.draft(cx);
        if draft.is_complete() && !self.running {
            cx.emit(FormEvent::Submit(draft));
        }
    }

    fn flag(&self, flag: Flag) -> bool {
        match flag {
            Flag::Enabled => self.flags.enabled,
            Flag::CreateSlot => self.flags.create_slot,
            Flag::CopyData => self.flags.copy_data,
            Flag::Connect => self.flags.connect,
            Flag::Failover => self.flags.failover,
        }
    }

    fn set_flag(&mut self, flag: Flag, value: bool) {
        let slot = match flag {
            Flag::Enabled => &mut self.flags.enabled,
            Flag::CreateSlot => &mut self.flags.create_slot,
            Flag::CopyData => &mut self.flags.copy_data,
            Flag::Connect => &mut self.flags.connect,
            Flag::Failover => &mut self.flags.failover,
        };
        *slot = value;
    }
}

impl Render for SubscriptionForm {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let entity = cx.entity().downgrade();
        let checkbox = |id: &'static str, label: &'static str, flag: Flag| {
            let entity = entity.clone();
            Checkbox::new(id, self.flag(flag)).label(label).disabled(self.running).on_change(move |checked, _, cx| {
                entity
                    .update(cx, |form, cx| {
                        form.set_flag(flag, checked);
                        cx.notify();
                    })
                    .ok();
            })
        };
        let can_submit = self.draft(cx).is_complete() && !self.running;
        let cancel = entity.clone();
        div().track_focus(&self.focus_handle).w(px(560.)).max_w_full().child(
            Dialog::new("create-subscription", "Create Subscription")
                .icon(IconName::Broadcast)
                .size(DialogSize::Lg)
                .layout(DialogLayout::Form)
                .on_close(move |_, cx| {
                    cancel.update(cx, |_, cx| cx.emit(FormEvent::Cancel)).ok();
                })
                .child(Field::new().label("Name").control(self.name.clone()))
                .child(Field::new().label("Connection String").control(self.connection_string.clone()))
                .child(Field::new().label("Publications").control(self.publications.clone()))
                .child(Field::new().label("Slot Name").control(self.slot_name.clone()))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(10.))
                        .child(
                            div()
                                .flex()
                                .gap(px(12.))
                                .child(div().flex_1().child(checkbox("subscription-enabled", "Enabled", Flag::Enabled)))
                                .child(div().flex_1().child(checkbox("subscription-create-slot", "Create Slot", Flag::CreateSlot))),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(12.))
                                .child(div().flex_1().child(checkbox("subscription-copy-data", "Copy Existing Data", Flag::CopyData)))
                                .child(div().flex_1().child(checkbox("subscription-connect", "Connect Immediately", Flag::Connect))),
                        )
                        .child(checkbox("subscription-failover", "Enable failover slot sync", Flag::Failover)),
                )
                .children(self.error.clone().map(|error| div().text_color(colors.destructive).child(error)))
                .footer([
                    Button::new("cancel-subscription", "Cancel")
                        .variant(ButtonVariant::Ghost)
                        .disabled(self.running)
                        .on_click(cx.listener(|_, _, _, cx| cx.emit(FormEvent::Cancel)))
                        .into_any_element(),
                    Button::new("submit-subscription", if self.running { "Creating…" } else { "Create" })
                        .variant(ButtonVariant::Accent)
                        .disabled(!can_submit)
                        .on_click(cx.listener(|this, _, window, cx| this.submit(window, cx)))
                        .into_any_element(),
                ]),
        )
    }
}
