//! The database client (`features/database`): saved connections, the schema tree, table and query
//! tabs with a virtualized grid, filters, paging, row editing and SQL history, and browsers for
//! MongoDB collections and Redis keys.

#[cfg(target_family = "wasm")]
#[allow(dead_code)]
#[path = "../../../core/database/src/sql_common.rs"]
mod sql_common;
#[cfg(target_family = "wasm")]
mod athas_database {
    pub(crate) use super::sql_common;
}
#[cfg_attr(target_family = "wasm", allow(dead_code))]
mod backend;
mod connection_form;
mod connections;
mod connections_picker;
mod format;
mod forms;
mod grid;
mod history;
mod model;
mod mongo_browser;
#[cfg_attr(target_family = "wasm", allow(dead_code))]
mod nosql;
mod preview;
mod redis_browser;
mod render;
pub mod relay;
mod row_editor;
mod sql_editor;
#[cfg(not(target_family = "wasm"))]
mod sqlite;
mod statements;
mod subscriptions;

#[cfg(test)]
mod tests;

use std::{
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use gpui::{
    App, ClipboardItem, Context, Entity, FocusHandle, Focusable, SharedString, Subscription, Task, Window,
    prelude::*,
};
use serde_json::Value;
use ui::{OpenMenu, TextInput, TextInputEvent};
use web_time::Instant;

use crate::{
    backend::Backend,
    connection_form::{ConnectionForm, ConnectionFormEvent, resolve_password},
    forms::{ColumnDraft, CreateTableForm, FormEvent, SubscriptionDraft, SubscriptionForm},
    grid::{DataGrid, GridCapabilities, GridEvent},
    mongo_browser::MongoBrowser,
    redis_browser::RedisBrowser,
    model::{
        Column, DbInfo, DbObject, Filter, FilterOp, ForeignKey, ObjectKind, Page, PageRequest, QueryOutcome, ResultSet,
        RowIdentity, SortDirection,
    },
    row_editor::{RowEditor, RowEditorEvent, RowMode},
    sql_editor::{SqlEditor, SqlEditorEvent},
    subscriptions::SubscriptionTab,
};

pub use connections::SavedConnection;
pub use connections_picker::{DatabaseConnectionsDelegate, NEW_CONNECTION_ID, connections_picker, workspace_database_files};

/// Whether a file opens in the database view (SQLite or DuckDB, by extension), as the original's
/// `getDatabaseTypeFromPath` routes it.
pub fn is_database_file(path: &std::path::Path) -> bool {
    path.to_str().and_then(model::Provider::for_file).is_some()
}

pub const PAGE_SIZES: [usize; 5] = [25, 50, 100, 250, 500];
/// As the original SQL store's `pageSize`.
const DEFAULT_PAGE_SIZE: usize = 50;

/// Binds the grid's and the query editor's keys. `DatabaseView::new` calls it.
pub fn init(cx: &mut App) {
    ui::bind_keys_once(cx, "database_grid", grid::bind_keys);
    ui::bind_keys_once(cx, "database_sql_editor", sql_editor::bind_keys);
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Failed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TableMode {
    Data,
    /// "Schema" in the toolbar.
    Structure,
    Info,
}

pub(crate) struct FilterRow {
    pub column: String,
    pub op: FilterOp,
    pub value: Entity<TextInput>,
    pub value2: Entity<TextInput>,
}

pub(crate) struct TableTab {
    pub name: String,
    pub kind: ObjectKind,
    pub columns: Vec<Column>,
    pub foreign_keys: Vec<ForeignKey>,
    pub schema_loaded: bool,
    pub page: usize,
    pub page_size: usize,
    pub total: Option<u64>,
    pub elapsed: Option<Duration>,
    pub sort: Option<(String, SortDirection)>,
    pub filters: Vec<FilterRow>,
    pub search: Entity<TextInput>,
    pub mode: TableMode,
    pub debounce: Option<Task<()>>,
}

impl TableTab {
    pub fn editable(&self) -> bool {
        self.kind == ObjectKind::Table
    }

    pub fn page_count(&self) -> usize {
        self.total.map_or(1, |total| (total as usize).div_ceil(self.page_size).max(1))
    }
}

pub(crate) struct QueryTab {
    pub title: String,
    pub editor: Entity<SqlEditor>,
    pub outcome: Option<QueryOutcome>,
    /// The statement the outcome came from.
    pub ran: Option<String>,
}

pub(crate) enum TabBody {
    Table(TableTab),
    Query(QueryTab),
    Subscription(SubscriptionTab),
}

pub(crate) struct DbTab {
    pub id: usize,
    pub body: TabBody,
    pub grid: Entity<DataGrid>,
    pub loading: bool,
    pub error: Option<String>,
    pub request: u64,
    pub row_editor: Option<Entity<RowEditor>>,
    row_editor_subscription: Option<Subscription>,
    _subscriptions: Vec<Subscription>,
}

impl DbTab {
    pub fn title(&self) -> String {
        match &self.body {
            TabBody::Table(table) => table.name.clone(),
            TabBody::Query(query) => query.title.clone(),
            TabBody::Subscription(sub) => sub.name.clone(),
        }
    }

    /// The table, view or subscription it shows.
    pub fn object_name(&self) -> Option<&str> {
        match &self.body {
            TabBody::Table(table) => Some(&table.name),
            TabBody::Subscription(sub) => Some(&sub.name),
            TabBody::Query(_) => None,
        }
    }

    pub fn table(&self) -> Option<&TableTab> {
        match &self.body {
            TabBody::Table(table) => Some(table),
            _ => None,
        }
    }

    fn table_mut(&mut self) -> Option<&mut TableTab> {
        match &mut self.body {
            TabBody::Table(table) => Some(table),
            _ => None,
        }
    }
}

/// A change the user asked for and has to confirm.
#[derive(Clone)]
pub(crate) enum PendingAction {
    Insert { tab: usize, columns: Vec<String>, values: Vec<Value> },
    Update { tab: usize, columns: Vec<String>, values: Vec<Value>, identity: RowIdentity },
    Delete { tab: usize, identity: RowIdentity },
    DropObject { name: String, kind: ObjectKind },
    ForgetConnection(String),
    DeleteDocument { database: String, collection: String, filter: String },
    DeleteKey(String),
}

pub(crate) struct Confirm {
    pub title: SharedString,
    pub message: SharedString,
    pub sql: Option<SharedString>,
    pub confirm_label: SharedString,
    pub destructive: bool,
    pub action: PendingAction,
    pub running: bool,
    pub error: Option<SharedString>,
}

pub(crate) enum Dialog {
    Connection { form: Entity<ConnectionForm>, _subscription: Subscription },
    Confirm(Confirm),
    CreateTable { form: Entity<CreateTableForm>, _subscription: Subscription },
    CreateSubscription { form: Entity<SubscriptionForm>, _subscription: Subscription },
    Json { title: SharedString, text: String },
}

pub struct DatabaseView {
    focus_handle: FocusHandle,
    connections_path: Option<PathBuf>,
    history_path: Option<PathBuf>,
    pub(crate) saved: Vec<SavedConnection>,
    pub(crate) connection: Option<SavedConnection>,
    pub(crate) state: ConnectionState,
    pub(crate) backend: Option<Arc<Backend>>,
    pub(crate) objects: Vec<DbObject>,
    pub(crate) info: Option<DbInfo>,
    pub(crate) history: Vec<String>,
    pub(crate) tabs: Vec<DbTab>,
    pub(crate) active_tab: Option<usize>,
    next_tab_id: usize,
    query_count: usize,
    pub(crate) show_types: bool,
    pub(crate) dialog: Option<Dialog>,
    pub(crate) open_menu: Option<OpenMenu>,
    pub(crate) mongo: Option<MongoBrowser>,
    pub(crate) redis: Option<RedisBrowser>,
    generation: u64,
}

/// Closing the tab lets go of the network pool too; without this it stays open until the app quits.
impl Drop for DatabaseView {
    fn drop(&mut self) {
        if let Some(backend) = self.backend.take() {
            #[cfg(not(target_family = "wasm"))]
            std::thread::spawn(move || backend.close());
            #[cfg(target_family = "wasm")]
            backend.close();
        }
    }
}

impl Focusable for DatabaseView {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        match self.active().map(|tab| &tab.body) {
            Some(TabBody::Query(query)) => query.editor.focus_handle(cx),
            Some(TabBody::Table(_) | TabBody::Subscription(_)) => self.active().map_or(self.focus_handle.clone(), |tab| tab.grid.focus_handle(cx)),
            None => self.focus_handle.clone(),
        }
    }
}

impl DatabaseView {
    /// `connection` opens a saved connection by id, or a SQLite (or DuckDB) file by its path;
    /// [`NEW_CONNECTION_ID`] opens the New Connection form; `None` lists the saved connections.
    pub fn new(connection: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        init(cx);
        let connections_path = connections::default_store_path();
        let saved = connections_path.as_deref().map(connections::load).unwrap_or_default();
        let mut view = Self {
            focus_handle: cx.focus_handle(),
            connections_path,
            history_path: history::default_store_path(),
            saved,
            connection: None,
            state: ConnectionState::Disconnected,
            backend: None,
            objects: Vec::new(),
            info: None,
            history: Vec::new(),
            tabs: Vec::new(),
            active_tab: None,
            next_tab_id: 1,
            query_count: 0,
            show_types: true,
            dialog: None,
            open_menu: None,
            mongo: None,
            redis: None,
            generation: 0,
        };
        let new_connection = connection.as_deref() == Some(NEW_CONNECTION_ID);
        let target = connection.filter(|key| key != NEW_CONNECTION_ID).and_then(|key| {
            view.saved.iter().find(|saved| saved.id == key).cloned().or_else(|| SavedConnection::for_file(&key))
        });
        if let Some(target) = target {
            view.connect(target, None, window, cx);
        } else if new_connection {
            view.show_connection_form(None, window, cx);
        }
        view
    }

    pub(crate) fn active(&self) -> Option<&DbTab> {
        self.tabs.iter().find(|tab| Some(tab.id) == self.active_tab)
    }

    fn tab_mut(&mut self, id: usize) -> Option<&mut DbTab> {
        self.tabs.iter_mut().find(|tab| tab.id == id)
    }

    fn history_key(&self) -> Option<String> {
        let connection = self.connection.as_ref()?;
        let mode = if connection.provider.is_file_based() { "file" } else { "connection" };
        let key = if connection.provider.is_file_based() { &connection.file_path } else { &connection.id };
        Some(format!("{}:{mode}:{key}", connection.provider.id()))
    }

    // Connections.

    /// Opens `connection` in place of the current one, off the UI thread.
    pub(crate) fn connect(
        &mut self,
        connection: SavedConnection,
        password: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.disconnect(cx);
        self.generation += 1;
        let generation = self.generation;
        self.state = ConnectionState::Connecting;
        self.connection = Some(connection.clone());
        self.history = match (&self.history_path, self.history_key()) {
            (Some(path), Some(key)) => history::load(path, &key),
            _ => Vec::new(),
        };
        cx.notify();
        let task = cx.background_spawn(async move {
            let password = resolve_password(&connection, password);
            let backend = Backend::open(&connection, password)?;
            let objects = if connection.provider.is_sql() { backend.objects()? } else { Vec::new() };
            let info = backend.info(objects.len()).ok();
            anyhow::Ok((backend, objects, info))
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            this.update_in(cx, |this, window, cx| {
                if this.generation != generation {
                    // Pools are counted per connection (`backend::open_pools`): this closes only
                    // this attempt's share, not a newer connect's.
                    if let Ok((backend, ..)) = &result {
                        backend.close();
                    }
                    return;
                }
                match result {
                    Ok((backend, objects, info)) => {
                        this.backend = Some(Arc::new(backend));
                        this.objects = objects;
                        this.info = info;
                        this.state = ConnectionState::Connected;
                        match this.backend.as_ref().map(|backend| backend.provider()) {
                            Some(model::Provider::Mongodb) => this.start_mongo(window, cx),
                            Some(model::Provider::Redis) => this.start_redis(window, cx),
                            _ => {}
                        }
                        let first = this.objects.iter().find(|object| object.kind == ObjectKind::Table).cloned();
                        if let Some(first) = first {
                            this.open_object(&first.name, window, cx);
                        }
                    }
                    Err(error) => this.state = ConnectionState::Failed(error.to_string()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn disconnect(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        if let Some(backend) = self.backend.take() {
            cx.background_spawn(async move { backend.close() }).detach();
        }
        self.connection = None;
        self.state = ConnectionState::Disconnected;
        self.objects.clear();
        self.info = None;
        self.tabs.clear();
        self.active_tab = None;
        self.history.clear();
        self.query_count = 0;
        self.mongo = None;
        self.redis = None;
        cx.notify();
    }

    pub(crate) fn reconnect(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(connection) = self.connection.clone() {
            self.connect(connection, None, window, cx);
        }
    }

    pub(crate) fn show_connection_form(&mut self, editing: Option<SavedConnection>, window: &mut Window, cx: &mut Context<Self>) {
        self.open_menu = None;
        let form = cx.new(|cx| ConnectionForm::new(editing, window, cx));
        let subscription = cx.subscribe_in(&form, window, |this, _, event: &ConnectionFormEvent, window, cx| match event {
            ConnectionFormEvent::Cancel => {
                this.dialog = None;
                cx.notify();
            }
            ConnectionFormEvent::Save { connection, password } => {
                this.dialog = None;
                this.save_connection(connection.clone(), password.clone(), window, cx);
            }
        });
        self.dialog = Some(Dialog::Connection { form, _subscription: subscription });
        cx.notify();
    }

    pub(crate) fn show_create_table(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_menu = None;
        let form = cx.new(|cx| CreateTableForm::new(window, cx));
        let subscription =
            cx.subscribe_in(&form, window, |this, form, event: &FormEvent<(String, Vec<ColumnDraft>)>, window, cx| match event {
                FormEvent::Cancel => this.dismiss_form(cx),
                FormEvent::Submit((name, columns)) => this.create_table(form.clone(), name.clone(), columns.clone(), window, cx),
            });
        self.dialog = Some(Dialog::CreateTable { form, _subscription: subscription });
        cx.notify();
    }

    pub(crate) fn show_create_subscription(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_menu = None;
        let form = cx.new(|cx| SubscriptionForm::new(window, cx));
        let subscription = cx.subscribe_in(&form, window, |this, form, event: &FormEvent<SubscriptionDraft>, window, cx| match event {
            FormEvent::Cancel => this.dismiss_form(cx),
            FormEvent::Submit(draft) => this.create_subscription(form.clone(), draft.clone(), window, cx),
        });
        self.dialog = Some(Dialog::CreateSubscription { form, _subscription: subscription });
        cx.notify();
    }

    fn dismiss_form(&mut self, cx: &mut Context<Self>) {
        let running = match &self.dialog {
            Some(Dialog::CreateTable { form, .. }) => form.read(cx).running,
            Some(Dialog::CreateSubscription { form, .. }) => form.read(cx).running,
            _ => false,
        };
        if !running {
            self.dialog = None;
            cx.notify();
        }
    }

    /// Runs `CREATE TABLE`, then reloads the tree and opens the new table.
    fn create_table(
        &mut self,
        form: Entity<CreateTableForm>,
        name: String,
        columns: Vec<ColumnDraft>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(backend) = self.backend.clone() else { return };
        let sql = forms::create_table_sql(backend.provider(), &name, &columns);
        form.update(cx, |form, cx| {
            form.running = true;
            form.error = None;
            cx.notify();
        });
        let task = cx.background_spawn(async move {
            backend.run(&sql)?;
            backend.objects()
        });
        self.finish_create(form, name, task, window, cx);
    }

    fn create_subscription(
        &mut self,
        form: Entity<SubscriptionForm>,
        draft: SubscriptionDraft,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(backend) = self.backend.clone() else { return };
        form.update(cx, |form, cx| {
            form.running = true;
            form.error = None;
            cx.notify();
        });
        let name = draft.name.clone();
        let task = cx.background_spawn(async move {
            backend.create_subscription(&draft)?;
            backend.objects()
        });
        self.finish_create(form, name, task, window, cx);
    }

    fn finish_create<F: forms::CreateForm>(
        &mut self,
        form: Entity<F>,
        name: String,
        task: Task<anyhow::Result<Vec<DbObject>>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let generation = self.generation;
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            this.update_in(cx, |this, window, cx| {
                if this.generation != generation {
                    return;
                }
                match result {
                    Ok(objects) => {
                        this.dialog = None;
                        this.objects = objects;
                        this.open_object(&name, window, cx);
                    }
                    Err(error) => form.update(cx, |form, cx| form.failed(error.to_string(), cx)),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Saves a connection (its password to the keychain) and connects to it.
    fn save_connection(
        &mut self,
        connection: SavedConnection,
        password: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match self.saved.iter_mut().find(|saved| saved.id == connection.id) {
            Some(saved) => *saved = connection.clone(),
            None => self.saved.push(connection.clone()),
        }
        self.persist_connections(cx);
        if let Some(password) = password.clone().filter(|_| !connection.provider.is_file_based()) {
            let id = connection.id.clone();
            cx.background_spawn(async move { connections::store_password(&id, &password).ok() }).detach();
        }
        self.connect(connection, password, window, cx);
    }

    /// Keeps a database file that was opened directly.
    pub(crate) fn remember_connection(&mut self, cx: &mut Context<Self>) {
        let Some(mut connection) = self.connection.clone() else { return };
        if self.saved.iter().any(|saved| saved.id == connection.id) {
            return;
        }
        connection.id = connections::new_id();
        self.saved.push(connection.clone());
        self.connection = Some(connection);
        self.persist_connections(cx);
        cx.notify();
    }

    fn persist_connections(&self, cx: &mut Context<Self>) {
        let Some(path) = self.connections_path.clone() else { return };
        let saved = self.saved.clone();
        cx.background_spawn(async move { connections::save(&path, &saved).ok() }).detach();
    }

    fn forget_connection(&mut self, id: &str, cx: &mut Context<Self>) {
        self.saved.retain(|saved| saved.id != id);
        self.persist_connections(cx);
        let id = id.to_string();
        if self.connection.as_ref().is_some_and(|connection| connection.id == id) {
            self.disconnect(cx);
        }
        cx.background_spawn(async move { connections::delete_password(&id) }).detach();
        cx.notify();
    }

    pub(crate) fn open_database_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open_menu = None;
        if let Some(web) = workbench_api::web_files(cx) {
            let (this, handle) = (cx.weak_entity(), window.window_handle());
            (web.upload)(
                Some(DATABASE_FILE_TYPES),
                Box::new(move |chosen, cx| match chosen {
                    Ok(Some(path)) => {
                        handle
                            .update(cx, |_, window, cx| {
                                this.update(cx, |this, cx| this.open_database_path(path.to_string_lossy().into_owned(), window, cx)).ok();
                            })
                            .ok();
                    }
                    Ok(None) => {}
                    Err(error) => {
                        this.update(cx, |this, cx| {
                            this.state = ConnectionState::Failed(error);
                            cx.notify();
                        })
                        .ok();
                    }
                }),
                cx,
            );
            return;
        }
        let paths = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Open Database".into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            let path = path.to_string_lossy().into_owned();
            this.update_in(cx, |this, window, cx| this.open_database_path(path, window, cx)).ok();
        })
        .detach();
    }

    fn open_database_path(&mut self, path: String, window: &mut Window, cx: &mut Context<Self>) {
        let connection = self
            .saved
            .iter()
            .find(|saved| saved.provider.is_file_based() && saved.file_path == path)
            .cloned()
            .or_else(|| SavedConnection::for_file(&path))
            .unwrap_or_else(|| {
                let mut connection = SavedConnection::for_file(&format!("{path}.sqlite")).expect("sqlite extension");
                connection.id = path.clone();
                connection.file_path = path.clone();
                connection.name = std::path::Path::new(&path).file_name().map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned());
                connection
            });
        self.connect(connection, None, window, cx);
    }

    /// Reloads the object list and the database's info.
    pub(crate) fn refresh_objects(&mut self, cx: &mut Context<Self>) {
        let Some(backend) = self.backend.clone() else { return };
        let generation = self.generation;
        let task = cx.background_spawn(async move {
            let objects = backend.objects()?;
            let info = backend.info(objects.len()).ok();
            anyhow::Ok((objects, info))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                if let Ok((objects, info)) = result {
                    this.objects = objects;
                    this.info = info;
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    // Tabs.

    fn new_tab(&mut self, body: TabBody, window: &mut Window, cx: &mut Context<Self>) -> usize {
        let id = self.next_tab_id;
        self.next_tab_id += 1;
        let grid = cx.new(DataGrid::new);
        grid.update(cx, |grid, cx| grid.set_show_types(self.show_types, cx));
        let mut subscriptions =
            vec![cx.subscribe_in(&grid, window, move |this, _, event: &GridEvent, window, cx| this.grid_event(id, event, window, cx))];
        match &body {
            TabBody::Table(table) => {
                subscriptions.push(cx.subscribe(&table.search, move |this, _, event: &TextInputEvent, cx| match event {
                    TextInputEvent::Changed(_) => this.reload_debounced(id, cx),
                    TextInputEvent::Confirmed => this.reload_table(id, true, cx),
                    _ => {}
                }));
            }
            TabBody::Query(query) => {
                subscriptions.push(cx.subscribe(&query.editor, move |this, _, event: &SqlEditorEvent, cx| {
                    if let SqlEditorEvent::Run(sql) = event {
                        this.run_query(id, sql.clone(), cx);
                    }
                }));
                // The completions under the editor follow its caret.
                subscriptions.push(cx.observe(&query.editor, |_, _, cx| cx.notify()));
            }
            TabBody::Subscription(_) => {}
        }
        if let TabBody::Query(query) = &body {
            query.editor.update(cx, |editor, cx| editor.focus(window, cx));
        }
        self.tabs.push(DbTab {
            id,
            body,
            grid,
            loading: false,
            error: None,
            request: 0,
            row_editor: None,
            row_editor_subscription: None,
            _subscriptions: subscriptions,
        });
        self.active_tab = Some(id);
        cx.notify();
        id
    }

    /// Opens a table or view in a tab, or brings its tab forward. An index opens its table.
    pub(crate) fn open_object(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) -> Option<usize> {
        let object = self.objects.iter().find(|object| object.name == name)?.clone();
        if object.kind == ObjectKind::Subscription {
            return self.open_subscription(name, window, cx);
        }
        if !object.kind.has_rows() {
            let owner = object.owner?;
            return self.open_object(&owner, window, cx);
        }
        if let Some(tab) = self.tabs.iter().find(|tab| tab.table().is_some_and(|table| table.name == name)) {
            self.active_tab = Some(tab.id);
            cx.notify();
            return self.active_tab;
        }
        // One table at a time, as the original's `selectedTable`; the SQL editor stays.
        self.close_object_tabs();
        let search = cx.new(|cx| {
            TextInput::new(window, cx)
                .placeholder("Search...")
                .appearance(ui::InputAppearance::Bare)
                .leading_icon(ui::IconName::Search)
        });
        let tab = self.new_tab(
            TabBody::Table(TableTab {
                name: object.name.clone(),
                kind: object.kind,
                columns: Vec::new(),
                foreign_keys: Vec::new(),
                schema_loaded: false,
                page: 0,
                page_size: DEFAULT_PAGE_SIZE,
                total: None,
                elapsed: None,
                sort: None,
                filters: Vec::new(),
                search,
                mode: TableMode::Data,
                debounce: None,
            }),
            window,
            cx,
        );
        self.reload_table(tab, false, cx);
        Some(tab)
    }

    /// Closes the table, view or subscription shown, before another one opens.
    pub(crate) fn close_object_tabs(&mut self) {
        self.tabs.retain(|tab| matches!(tab.body, TabBody::Query(_)));
        if !self.tabs.iter().any(|tab| Some(tab.id) == self.active_tab) {
            self.active_tab = None;
        }
    }

    /// The table, view or subscription shown, behind the SQL editor when that is open.
    pub(crate) fn object_tab(&self) -> Option<&DbTab> {
        self.tabs.iter().find(|tab| !matches!(tab.body, TabBody::Query(_)))
    }

    pub(crate) fn query_tab(&self) -> Option<&DbTab> {
        self.tabs.iter().find(|tab| matches!(tab.body, TabBody::Query(_)))
    }

    /// The toolbar's Data / Schema / Info switch, for the object shown.
    pub(crate) fn set_view_mode(&mut self, mode: TableMode, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.object_tab().map(|tab| tab.id) else { return };
        if mode != TableMode::Data || self.active().is_some_and(|tab| tab.id != id) {
            self.activate_tab(id, window, cx);
        }
        match self.tab_mut(id).map(|tab| &mut tab.body) {
            Some(TabBody::Table(table)) => table.mode = mode,
            Some(TabBody::Subscription(sub)) => sub.mode = mode,
            _ => {}
        }
        cx.notify();
    }

    /// Leaves the SQL editor for the object behind it (`setIsCustomQuery(false)`).
    pub(crate) fn close_query(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.object_tab().map(|tab| tab.id) {
            Some(id) => self.activate_tab(id, window, cx),
            None => {
                self.active_tab = None;
                cx.notify();
            }
        }
    }

    /// Opens the SQL editor (`setIsCustomQuery(true)`), holding `sql` when given.
    pub(crate) fn new_query(&mut self, sql: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> usize {
        self.open_menu = None;
        if let Some(id) = self.query_tab().map(|tab| tab.id) {
            if let (Some(sql), Some(TabBody::Query(query))) = (sql, self.tab_mut(id).map(|tab| &tab.body)) {
                let editor = query.editor.clone();
                editor.update(cx, |editor, cx| editor.set_text(sql, cx));
            }
            if let Some(TabBody::Query(query)) = self.tab_mut(id).map(|tab| &tab.body) {
                let editor = query.editor.clone();
                editor.update(cx, |editor, cx| editor.focus(window, cx));
            }
            self.active_tab = Some(id);
            cx.notify();
            return id;
        }
        self.query_count += 1;
        let title = format!("Query {}", self.query_count);
        let placeholder = "Write SQL, then press ⌘↵ to run it";
        let editor = cx.new(|cx| {
            let mut editor = SqlEditor::new(cx).placeholder(placeholder);
            if let Some(sql) = sql {
                editor.set_text(sql, cx);
                editor.clear_undo();
            }
            editor
        });
        self.new_tab(TabBody::Query(QueryTab { title, editor, outcome: None, ran: None }), window, cx)
    }

    pub(crate) fn activate_tab(&mut self, id: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.active_tab = Some(id);
        let focus = self.focus_handle(cx);
        window.focus(&focus, cx);
        cx.notify();
    }

    // Table data.

    fn reload_debounced(&mut self, id: usize, cx: &mut Context<Self>) {
        let task = cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(300)).await;
            this.update(cx, |this, cx| this.reload_table(id, true, cx)).ok();
        });
        if let Some(table) = self.tab_mut(id).and_then(DbTab::table_mut) {
            table.debounce = Some(task);
        }
    }

    /// Loads the tab's page (and, the first time, its columns and keys). `reset_page` goes back
    /// to the first page, as a new filter or search does.
    pub(crate) fn reload_table(&mut self, id: usize, reset_page: bool, cx: &mut Context<Self>) {
        let Some(backend) = self.backend.clone() else { return };
        let generation = self.generation;
        let Some(tab) = self.tab_mut(id) else { return };
        tab.request += 1;
        tab.loading = true;
        let request_id = tab.request;
        let TabBody::Table(table) = &mut tab.body else { return };
        table.debounce = None;
        if reset_page {
            table.page = 0;
        }
        let load_schema = !table.schema_loaded;
        let filters: Vec<Filter> = table
            .filters
            .iter()
            .map(|filter| Filter {
                column: filter.column.clone(),
                op: filter.op,
                value: filter.value.read(cx).text().to_string(),
                value2: filter.value2.read(cx).text().to_string(),
            })
            .filter(|filter| !filter.op.takes_value() || !filter.value.is_empty())
            .collect();
        let request = PageRequest {
            table: table.name.clone(),
            filters,
            search: table.search.read(cx).text().to_string(),
            search_columns: table.columns.iter().map(|column| column.name.clone()).collect(),
            sort: table.sort.clone(),
            page_size: table.page_size,
            offset: table.page * table.page_size,
        };
        cx.notify();
        let task = cx.background_spawn(async move {
            let schema = if load_schema {
                Some((backend.columns(&request.table)?, backend.foreign_keys(&request.table).unwrap_or_default()))
            } else {
                None
            };
            let started = Instant::now();
            let page = backend.page(&request)?;
            anyhow::Ok((schema, page, started.elapsed()))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation == generation {
                    this.apply_page(id, request_id, result, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn apply_page(
        &mut self,
        id: usize,
        request_id: u64,
        result: anyhow::Result<(Option<(Vec<Column>, Vec<ForeignKey>)>, Page, Duration)>,
        cx: &mut Context<Self>,
    ) {
        let Some(tab) = self.tab_mut(id).filter(|tab| tab.request == request_id) else { return };
        tab.loading = false;
        let grid = tab.grid.clone();
        let TabBody::Table(table) = &mut tab.body else { return };
        match result {
            Ok((schema, page, elapsed)) => {
                tab.error = None;
                if let Some((columns, foreign_keys)) = schema {
                    table.columns = columns;
                    table.foreign_keys = foreign_keys;
                    table.schema_loaded = true;
                }
                table.total = Some(page.total);
                table.elapsed = Some(elapsed);
                let capabilities = GridCapabilities { sort: true, filter: true, edit: table.editable() };
                let (columns, keys, offset, sort) = (
                    table.columns.clone(),
                    table.foreign_keys.clone(),
                    table.page * table.page_size,
                    table.sort.clone(),
                );
                grid.update(cx, |grid, cx| {
                    grid.set_capabilities(capabilities, cx);
                    grid.set_sort(sort, cx);
                    grid.set_data(page.result, &columns, &keys, offset, cx);
                });
            }
            Err(error) => tab.error = Some(error.to_string()),
        }
        cx.notify();
    }

    pub(crate) fn set_page(&mut self, id: usize, page: usize, cx: &mut Context<Self>) {
        if let Some(table) = self.tab_mut(id).and_then(DbTab::table_mut) {
            let page = page.min(table.page_count() - 1);
            if page == table.page {
                return;
            }
            table.page = page;
        }
        self.tabs.iter().find(|tab| tab.id == id).map(|tab| tab.grid.clone()).map(|grid| grid.update(cx, |grid, _| grid.scroll_to_top()));
        self.reload_table(id, false, cx);
    }

    pub(crate) fn set_page_size(&mut self, id: usize, size: usize, cx: &mut Context<Self>) {
        self.open_menu = None;
        if let Some(table) = self.tab_mut(id).and_then(DbTab::table_mut) {
            table.page_size = size;
        }
        self.reload_table(id, true, cx);
    }

    fn toggle_sort(&mut self, id: usize, column: &str, cx: &mut Context<Self>) {
        let Some(table) = self.tab_mut(id).and_then(DbTab::table_mut) else { return };
        table.sort = match &table.sort {
            Some((current, SortDirection::Asc)) if current == column => Some((column.to_string(), SortDirection::Desc)),
            Some((current, SortDirection::Desc)) if current == column => None,
            _ => Some((column.to_string(), SortDirection::Asc)),
        };
        self.reload_table(id, true, cx);
    }

    // Filters.

    pub(crate) fn add_filter(
        &mut self,
        id: usize,
        column: Option<String>,
        op: FilterOp,
        value: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(table) = self.tab_mut(id).and_then(DbTab::table_mut) else { return };
        let Some(column) = column.or_else(|| table.columns.first().map(|column| column.name.clone())) else { return };
        let value_input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx).placeholder("Value").appearance(ui::InputAppearance::Bare);
            input.set_text(value, cx);
            input
        });
        let value2_input =
            cx.new(|cx| TextInput::new(window, cx).placeholder("and").appearance(ui::InputAppearance::Bare));
        for input in [&value_input, &value2_input] {
            cx.subscribe(input, move |this, _, event: &TextInputEvent, cx| match event {
                TextInputEvent::Changed(_) => this.reload_debounced(id, cx),
                TextInputEvent::Confirmed => this.reload_table(id, true, cx),
                _ => {}
            })
            .detach();
        }
        let Some(table) = self.tab_mut(id).and_then(DbTab::table_mut) else { return };
        table.mode = TableMode::Data;
        table.filters.push(FilterRow { column, op, value: value_input, value2: value2_input });
        self.reload_table(id, true, cx);
    }

    pub(crate) fn update_filter(
        &mut self,
        id: usize,
        ix: usize,
        column: Option<String>,
        op: Option<FilterOp>,
        cx: &mut Context<Self>,
    ) {
        self.open_menu = None;
        let Some(filter) = self.tab_mut(id).and_then(DbTab::table_mut).and_then(|table| table.filters.get_mut(ix)) else {
            return;
        };
        if let Some(column) = column {
            filter.column = column;
        }
        if let Some(op) = op {
            filter.op = op;
        }
        self.reload_table(id, true, cx);
    }

    pub(crate) fn remove_filter(&mut self, id: usize, ix: Option<usize>, cx: &mut Context<Self>) {
        let Some(table) = self.tab_mut(id).and_then(DbTab::table_mut) else { return };
        match ix {
            Some(ix) if ix < table.filters.len() => {
                table.filters.remove(ix);
            }
            Some(_) => return,
            None => table.filters.clear(),
        }
        self.reload_table(id, true, cx);
    }

    // Grid events.

    fn grid_event(&mut self, id: usize, event: &GridEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            GridEvent::Sort(column) => self.toggle_sort(id, column, cx),
            GridEvent::FilterBy { column, value } => {
                let (op, text) = match format::value_text(value) {
                    Some(text) => (FilterOp::Equals, text),
                    None => (FilterOp::IsNull, String::new()),
                };
                self.add_filter(id, Some(column.clone()), op, text, window, cx);
            }
            GridEvent::OpenRow { row, column } => self.open_row_editor(id, Some(*row), *column, window, cx),
            GridEvent::DeleteRow(row) => self.request_delete(id, *row, cx),
            GridEvent::FollowKey { table, column, value } => {
                let Some(tab) = self.open_object(table, window, cx) else { return };
                if let Some(target) = self.tab_mut(tab).and_then(DbTab::table_mut) {
                    target.filters.clear();
                }
                let (op, text) = match format::value_text(value) {
                    Some(text) => (FilterOp::Equals, text),
                    None => (FilterOp::IsNull, String::new()),
                };
                self.add_filter(tab, Some(column.clone()), op, text, window, cx);
            }
            GridEvent::ViewJson { column, text } => {
                self.dialog = Some(Dialog::Json { title: column.clone().into(), text: text.clone() });
                cx.notify();
            }
        }
    }

    // Rows.

    /// Shows a row (or an empty one to insert) in the panel beside the grid.
    pub(crate) fn open_row_editor(
        &mut self,
        id: usize,
        row: Option<usize>,
        column: Option<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(tab) = self.tabs.iter().find(|tab| tab.id == id) else { return };
        let grid = tab.grid.read(cx);
        let result_columns = grid.column_names();
        let (columns, keys, editable) = match tab.table() {
            Some(table) if table.schema_loaded => (table.columns.clone(), table.foreign_keys.clone(), table.editable()),
            _ => (grid.schema(), Vec::new(), false),
        };
        let row_values = row.and_then(|row| grid.row(row).cloned());
        if row_values.is_none() && !editable {
            return;
        }
        let values = row_values.as_ref().map(|values| {
            columns
                .iter()
                .map(|column| {
                    result_columns
                        .iter()
                        .position(|name| *name == column.name)
                        .and_then(|ix| values.get(ix).cloned())
                        .unwrap_or(Value::Null)
                })
                .collect::<Vec<_>>()
        });
        let mode = match (&row_values, editable) {
            (None, _) => RowMode::Insert,
            (Some(values), true) => RowMode::Edit { identity: RowIdentity::for_row(&columns, &result_columns, values) },
            (Some(_), false) => RowMode::Read,
        };
        let focus = column
            .and_then(|ix| result_columns.get(ix))
            .and_then(|name| columns.iter().position(|column| column.name == *name));
        let editor = cx.new(|cx| RowEditor::new(mode, columns, &keys, values, focus, window, cx));
        let subscription = cx.subscribe(&editor, move |this, _, event: &RowEditorEvent, cx| this.row_editor_event(id, event, cx));
        if let Some(tab) = self.tab_mut(id) {
            tab.row_editor = Some(editor);
            tab.row_editor_subscription = Some(subscription);
        }
        cx.notify();
    }

    fn request_delete(&mut self, id: usize, row: usize, cx: &mut Context<Self>) {
        let Some(tab) = self.tabs.iter().find(|tab| tab.id == id) else { return };
        let Some(table) = tab.table().filter(|table| table.editable()) else { return };
        let grid = tab.grid.read(cx);
        let Some(values) = grid.row(row).cloned() else { return };
        let result_columns = grid.column_names();
        let identity = RowIdentity::for_row(&table.columns, &result_columns, &values);
        let name = table.name.clone();
        self.confirm_delete(id, &name, identity, cx);
    }

    fn confirm_delete(&mut self, id: usize, table: &str, identity: RowIdentity, cx: &mut Context<Self>) {
        let sql = statements::delete_sql(table, &identity).ok().map(|(sql, values)| describe_sql(&sql, &values));
        self.dialog = Some(Dialog::Confirm(Confirm {
            title: "Delete row?".into(),
            message: format!("This deletes the row from {table}. It cannot be undone.").into(),
            sql: sql.map(Into::into),
            confirm_label: "Delete".into(),
            destructive: true,
            action: PendingAction::Delete { tab: id, identity },
            running: false,
            error: None,
        }));
        cx.notify();
    }

    fn row_editor_event(&mut self, id: usize, event: &RowEditorEvent, cx: &mut Context<Self>) {
        let Some(tab) = self.tabs.iter().find(|tab| tab.id == id) else { return };
        let Some(editor) = tab.row_editor.clone() else { return };
        let Some(table) = tab.table().map(|table| table.name.clone()) else { return };
        match event {
            RowEditorEvent::Close => {
                if let Some(tab) = self.tab_mut(id) {
                    tab.row_editor = None;
                }
                cx.notify();
            }
            RowEditorEvent::Delete => {
                if let RowMode::Edit { identity } = editor.read(cx).mode().clone() {
                    self.confirm_delete(id, &table, identity, cx);
                }
            }
            RowEditorEvent::Save { columns, values } => {
                let (title, label, action, sql) = match editor.read(cx).mode().clone() {
                    RowMode::Insert => (
                        "Insert row?",
                        "Insert",
                        PendingAction::Insert { tab: id, columns: columns.clone(), values: values.clone() },
                        describe_sql(&statements::insert_sql(&table, columns), values),
                    ),
                    RowMode::Edit { identity } => {
                        let sql = statements::update_sql(&table, columns, &identity)
                            .map(|(sql, where_values)| {
                                let all: Vec<Value> = values.iter().chain(&where_values).cloned().collect();
                                describe_sql(&sql, &all)
                            })
                            .unwrap_or_default();
                        (
                            "Save changes?",
                            "Save",
                            PendingAction::Update { tab: id, columns: columns.clone(), values: values.clone(), identity },
                            sql,
                        )
                    }
                    RowMode::Read => return,
                };
                let count = columns.len();
                let message = match &action {
                    PendingAction::Insert { .. } => format!("Adds a row to {table}."),
                    _ => format!("Changes {count} {} in {table}.", if count == 1 { "column" } else { "columns" }),
                };
                self.dialog = Some(Dialog::Confirm(Confirm {
                    title: title.into(),
                    message: message.into(),
                    sql: Some(sql.into()),
                    confirm_label: label.into(),
                    destructive: false,
                    action,
                    running: false,
                    error: None,
                }));
                cx.notify();
            }
        }
    }

    pub(crate) fn request_drop(&mut self, name: &str, kind: ObjectKind, cx: &mut Context<Self>) {
        self.open_menu = None;
        let provider = self.backend.as_ref().map_or(model::Provider::Sqlite, |backend| backend.provider());
        let sql = drop_sql(provider, name, kind, self.objects.iter().find(|object| object.name == name));
        self.dialog = Some(Dialog::Confirm(Confirm {
            title: format!("Drop {name}?").into(),
            message: "This removes it and everything in it. It cannot be undone.".into(),
            sql: Some(sql.into()),
            confirm_label: "Drop".into(),
            destructive: true,
            action: PendingAction::DropObject { name: name.to_string(), kind },
            running: false,
            error: None,
        }));
        cx.notify();
    }

    pub(crate) fn request_forget(&mut self, id: &str, cx: &mut Context<Self>) {
        self.open_menu = None;
        let name = self.saved.iter().find(|saved| saved.id == id).map_or_else(String::new, |saved| saved.name.clone());
        self.dialog = Some(Dialog::Confirm(Confirm {
            title: format!("Remove {name}?").into(),
            message: "The connection and its saved password are removed. The database itself is not touched.".into(),
            sql: None,
            confirm_label: "Remove".into(),
            destructive: true,
            action: PendingAction::ForgetConnection(id.to_string()),
            running: false,
            error: None,
        }));
        cx.notify();
    }

    /// Runs the confirmed change off the UI thread, then reloads what it touched.
    pub(crate) fn confirm(&mut self, cx: &mut Context<Self>) {
        let Some(Dialog::Confirm(confirm)) = self.dialog.as_mut() else { return };
        if confirm.running {
            return;
        }
        let action = confirm.action.clone();
        if let PendingAction::ForgetConnection(id) = &action {
            self.dialog = None;
            self.forget_connection(id, cx);
            return;
        }
        let Some(backend) = self.backend.clone() else { return };
        confirm.running = true;
        confirm.error = None;
        let table = match &action {
            PendingAction::Insert { tab, .. } | PendingAction::Update { tab, .. } | PendingAction::Delete { tab, .. } => self
                .tabs
                .iter()
                .find(|candidate| candidate.id == *tab)
                .and_then(|tab| tab.table())
                .map(|table| table.name.clone()),
            _ => None,
        };
        let provider = backend.provider();
        let drop = match &action {
            PendingAction::DropObject { name, kind } => {
                Some(drop_sql(provider, name, *kind, self.objects.iter().find(|object| object.name == *name)))
            }
            _ => None,
        };
        cx.notify();
        let work = action.clone();
        let task = cx.background_spawn(async move {
            match work {
                PendingAction::Insert { columns, values, .. } => backend.insert(&table.unwrap_or_default(), &columns, &values),
                PendingAction::Update { columns, values, identity, .. } => {
                    backend.update(&table.unwrap_or_default(), &columns, &values, &identity)
                }
                PendingAction::Delete { identity, .. } => backend.delete(&table.unwrap_or_default(), &identity),
                PendingAction::DropObject { name, kind: ObjectKind::Subscription } => backend.drop_subscription(&name),
                PendingAction::DropObject { .. } => backend.run(&drop.unwrap_or_default()).map(|outcome| outcome.affected.unwrap_or(0)),
                PendingAction::ForgetConnection(_) => Ok(0),
                PendingAction::DeleteDocument { database, collection, filter } => backend.mongo_delete(&database, &collection, &filter),
                PendingAction::DeleteKey(key) => backend.redis_delete(&key).map(u64::from),
            }
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| this.finish_action(action, result, cx)).ok();
        })
        .detach();
    }

    fn finish_action(&mut self, action: PendingAction, result: anyhow::Result<u64>, cx: &mut Context<Self>) {
        // An edit or delete that matched no row did nothing: the row changed since it was read,
        // or a value in it (binary data shown as a placeholder) cannot be matched.
        let result = match (&action, result) {
            (PendingAction::Update { .. } | PendingAction::Delete { .. }, Ok(0)) => {
                Err(anyhow::anyhow!("No row was changed: the row changed since it was read, or it can't be matched by its values. Refresh and try again."))
            }
            (_, result) => result,
        };
        if let Err(error) = result {
            if let Some(Dialog::Confirm(confirm)) = self.dialog.as_mut() {
                confirm.running = false;
                confirm.error = Some(error.to_string().into());
            }
            cx.notify();
            return;
        }
        self.dialog = None;
        match action {
            PendingAction::Insert { tab, .. } | PendingAction::Update { tab, .. } | PendingAction::Delete { tab, .. } => {
                if let Some(tab) = self.tab_mut(tab) {
                    tab.row_editor = None;
                }
                self.reload_table(tab, false, cx);
                if let Some(info) = self.info.as_mut()
                    && let Some(size) = self.backend.as_ref().and_then(|backend| backend.file_path()).and_then(|path| std::fs::metadata(path).ok())
                {
                    info.size_bytes = Some(size.len());
                }
            }
            PendingAction::DropObject { name, .. } => {
                self.tabs.retain(|tab| tab.object_name() != Some(name.as_str()));
                if self.active().is_none() {
                    self.active_tab = self.tabs.last().map(|tab| tab.id);
                }
                self.refresh_objects(cx);
            }
            PendingAction::ForgetConnection(_) => {}
            PendingAction::DeleteDocument { .. } => self.refresh_mongo(cx),
            PendingAction::DeleteKey(key) => self.forget_redis_key(&key),
        }
        cx.notify();
    }

    pub(crate) fn dismiss_dialog(&mut self, cx: &mut Context<Self>) {
        match &self.dialog {
            Some(Dialog::Confirm(confirm)) if confirm.running => {}
            Some(Dialog::CreateTable { .. } | Dialog::CreateSubscription { .. }) => self.dismiss_form(cx),
            _ => {
                self.dialog = None;
                cx.notify();
            }
        }
    }

    // Queries.

    pub(crate) fn run_active_query(&mut self, cx: &mut Context<Self>) {
        let Some(tab) = self.active() else { return };
        let TabBody::Query(query) = &tab.body else { return };
        let sql = query.editor.read(cx).runnable_text();
        let id = tab.id;
        self.run_query(id, sql, cx);
    }

    pub(crate) fn run_query(&mut self, id: usize, sql: String, cx: &mut Context<Self>) {
        let sql = sql.trim().to_string();
        if sql.is_empty() {
            return;
        }
        let Some(backend) = self.backend.clone() else { return };
        let generation = self.generation;
        let Some(tab) = self.tab_mut(id) else { return };
        tab.request += 1;
        tab.loading = true;
        let request_id = tab.request;
        self.record_history(&sql, cx);
        cx.notify();
        let statement = sql.clone();
        let task = cx.background_spawn(async move { backend.run(&statement) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation == generation {
                    this.apply_outcome(id, request_id, sql, result, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn apply_outcome(&mut self, id: usize, request_id: u64, sql: String, result: anyhow::Result<QueryOutcome>, cx: &mut Context<Self>) {
        let Some(tab) = self.tab_mut(id).filter(|tab| tab.request == request_id) else { return };
        tab.loading = false;
        let grid = tab.grid.clone();
        let TabBody::Query(query) = &mut tab.body else { return };
        let changes_schema = changes_schema(&sql);
        match result {
            Ok(mut outcome) => {
                tab.error = None;
                let rows = std::mem::take(&mut outcome.result);
                grid.update(cx, |grid, cx| {
                    grid.set_capabilities(GridCapabilities::default(), cx);
                    grid.set_sort(None, cx);
                    grid.set_data(rows, &[], &[], 0, cx);
                });
                query.outcome = Some(outcome);
                query.ran = Some(sql);
                if changes_schema {
                    self.refresh_objects(cx);
                }
                self.reload_open_tables(cx);
            }
            Err(error) => {
                tab.error = Some(error.to_string());
                query.outcome = None;
            }
        }
        cx.notify();
    }

    /// After a statement that may have changed data, the open table tabs show it.
    fn reload_open_tables(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<usize> = self.tabs.iter().filter(|tab| tab.table().is_some()).map(|tab| tab.id).collect();
        for id in ids {
            self.reload_table(id, false, cx);
        }
    }

    fn record_history(&mut self, sql: &str, cx: &mut Context<Self>) {
        self.history = history::add(&self.history, sql);
        self.persist_history(cx);
    }

    fn persist_history(&self, cx: &mut Context<Self>) {
        let (Some(path), Some(key)) = (self.history_path.clone(), self.history_key()) else { return };
        let entries = self.history.clone();
        cx.background_spawn(async move { history::save(&path, &key, &entries) }).detach();
    }

    pub(crate) fn remove_history(&mut self, query: Option<&str>, cx: &mut Context<Self>) {
        self.history = match query {
            Some(query) => history::remove(&self.history, query),
            None => Vec::new(),
        };
        self.persist_history(cx);
        cx.notify();
    }

    /// Puts a history entry in the active query tab (or a new one), and runs it when asked.
    pub(crate) fn use_history(&mut self, query: &str, run: bool, window: &mut Window, cx: &mut Context<Self>) {
        let id = match self.active().filter(|tab| matches!(tab.body, TabBody::Query(_))) {
            Some(tab) => {
                if let TabBody::Query(editor) = &tab.body {
                    editor.editor.update(cx, |editor, cx| editor.set_text(query, cx));
                }
                tab.id
            }
            None => self.new_query(Some(query.to_string()), window, cx),
        };
        if run {
            self.run_query(id, query.to_string(), cx);
        }
    }

    // Copying and exporting.

    pub(crate) fn active_result(&self, cx: &App) -> Option<(ResultSet, String)> {
        let tab = self.active()?;
        let grid = tab.grid.read(cx);
        let result = ResultSet { columns: grid.column_names(), rows: (0..grid.row_count()).filter_map(|ix| grid.row(ix).cloned()).collect() };
        Some((result, tab.title()))
    }

    pub(crate) fn copy_result(&mut self, json: bool, cx: &mut Context<Self>) {
        self.open_menu = None;
        if let Some((result, _)) = self.active_result(cx) {
            let text = if json { format::to_json(&result) } else { format::to_csv(&result) };
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
        cx.notify();
    }

    pub(crate) fn export_csv(&mut self, cx: &mut Context<Self>) {
        self.open_menu = None;
        let Some((result, title)) = self.active_result(cx) else { return };
        if let Some(web) = workbench_api::web_files(cx) {
            let name = format!("{}.csv", title.replace([' ', '/', '\\'], "_"));
            (web.download)(&name, format::to_csv(&result).into_bytes(), cx);
            return;
        }
        #[cfg(not(target_family = "wasm"))]
        let directory = dirs::download_dir().or_else(dirs::home_dir).unwrap_or_else(|| PathBuf::from("."));
        #[cfg(target_family = "wasm")]
        let directory = PathBuf::from(".");
        let name = format!("{}.csv", title.replace([' ', '/', '\\'], "_"));
        let path = cx.prompt_for_new_path(&directory, Some(&name));
        cx.spawn(async move |_, cx| {
            let Ok(Ok(Some(path))) = path.await else { return };
            cx.background_spawn(async move {
                if let Err(error) = std::fs::write(&path, format::to_csv(&result)) {
                    eprintln!("database: could not export {}: {error}", path.display());
                }
            })
            .await;
        })
        .detach();
    }

    pub(crate) fn toggle_types(&mut self, cx: &mut Context<Self>) {
        self.show_types = !self.show_types;
        let show = self.show_types;
        for tab in &self.tabs {
            tab.grid.update(cx, |grid, cx| grid.set_show_types(show, cx));
        }
        cx.notify();
    }
}

/// The files the web's file input offers when opening a database.
pub(crate) const DATABASE_FILE_TYPES: &str = ".db,.sqlite,.sqlite3,.db3,.duckdb,.ddb";

/// Whether a statement may add, drop or rename objects, so the tree reloads.
fn changes_schema(sql: &str) -> bool {
    let upper = backend::strip_leading_comments(sql).to_ascii_uppercase();
    ["CREATE", "DROP", "ALTER", "RENAME", "ATTACH", "DETACH"].iter().any(|word| upper.contains(word))
}

/// A statement with its parameters written in, for the confirmation dialog.
pub(crate) fn describe_sql(sql: &str, values: &[Value]) -> String {
    let mut values = values.iter();
    let mut out = String::with_capacity(sql.len());
    for c in sql.chars() {
        if c == '?' {
            match values.next() {
                Some(Value::Null) | None => out.push_str("NULL"),
                Some(Value::String(text)) => out.push_str(&format!("'{}'", text.replace('\'', "''"))),
                Some(value) => out.push_str(&value.to_string()),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn drop_sql(provider: model::Provider, name: &str, kind: ObjectKind, object: Option<&DbObject>) -> String {
    let keyword = match kind {
        ObjectKind::View => "VIEW",
        ObjectKind::MaterializedView => "MATERIALIZED VIEW",
        ObjectKind::Index => "INDEX",
        ObjectKind::Subscription => "SUBSCRIPTION",
        ObjectKind::Table => "TABLE",
    };
    match (provider, kind, object.and_then(|object| object.owner.as_ref())) {
        (model::Provider::Mysql, ObjectKind::Index, Some(owner)) => {
            format!("DROP INDEX {} ON {}", provider.quote(name), provider.quote(owner))
        }
        _ => format!("DROP {keyword} {}", provider.quote(name)),
    }
}
