//! The Remote Connections dialog (`features/remote` in Athas): saved connections and the hosts in
//! `~/.ssh/config`, the connection form, the host key trust prompt, the password prompt, and a
//! folder browser over SFTP that ends in a `remote://` project path.
//!
//! The workbench floats it with `open_modal` and opens the project on
//! [`ConnectionsEvent::OpenProject`]; it emits `DismissEvent` when it is done.

use ui::scale::px;
use gpui::{
    App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, KeyDownEvent, PathPromptOptions,
    SharedString, Subscription, Window, div, prelude::*,
};
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, ButtonVariant, Checkbox, Icon, IconName, IconSize, InputAppearance, InputGroup,
    Select, SelectEvent, SelectOption, SelectVariant, SelectWidth, SidebarListItem, Switch, TextInput, TextInputEvent, WithScrollbar, metrics,
    typography,
};

use crate::{
    connections::{self, Access, SavedConnection},
    fs,
    known_hosts::HostKeyChallenge,
    manager::manager,
    path::{RemotePath, normalize},
    secret_input::{SecretEvent, SecretInput},
    session::{PasswordRequired, friendly_error},
};

#[derive(Clone, Debug, PartialEq)]
pub enum ConnectionsEvent {
    /// Open this `remote://` folder as a project.
    OpenProject(String),
}

/// A row of the list: a saved connection, or a host from `~/.ssh/config` not saved yet.
#[derive(Clone, Debug, PartialEq)]
enum Row {
    Saved(usize),
    ConfigHost(String),
}

enum Stage {
    List,
    Form { editing: Option<SavedConnection> },
    Connecting(SavedConnection),
    Trust { connection: SavedConnection, challenge: HostKeyChallenge, trusting: bool },
    Password { connection: SavedConnection, rejected: bool },
    Browse { connection: SavedConnection, path: String, folders: Option<Vec<String>> },
}

struct Form {
    name: Entity<TextInput>,
    host: Entity<TextInput>,
    port: Entity<TextInput>,
    username: Entity<TextInput>,
    key_path: Entity<TextInput>,
    /// The optional fallback password, tried after the keys and the agent.
    password: Entity<TextInput>,
    show_password: bool,
    access: Access,
    /// Workspace access as the original's `Select` (SSH / SFTP).
    access_select: Entity<Select>,
}

pub struct ConnectionsView {
    focus_handle: FocusHandle,
    saved: Vec<SavedConnection>,
    config_hosts: Vec<String>,
    connected: Vec<String>,
    stage: Stage,
    filter: Entity<TextInput>,
    form: Form,
    password: Entity<SecretInput>,
    remember_password: bool,
    folder_input: Entity<TextInput>,
    selected: usize,
    error: Option<SharedString>,
    /// Test Connection: running, or its outcome (`Ok` for success).
    testing: bool,
    test_result: Option<Result<SharedString, SharedString>>,
    /// The form a trust prompt Test Connection opened goes back to, to test again once trusted.
    trust_for_test: Option<Option<SavedConnection>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DismissEvent> for ConnectionsView {}
impl EventEmitter<ConnectionsEvent> for ConnectionsView {}

impl Focusable for ConnectionsView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl ConnectionsView {
    /// The saved connections from disk and the hosts in `~/.ssh/config`.
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_connections(connections::load_default(), crate::ssh_config::configured_hosts(), window, cx)
    }

    pub fn with_connections(saved: Vec<SavedConnection>, config_hosts: Vec<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = |placeholder: &str, window: &mut Window, cx: &mut Context<Self>| {
            let placeholder = placeholder.to_string();
            cx.new(|cx| TextInput::new(window, cx).placeholder(placeholder))
        };
        let filter = cx.new(|cx| TextInput::new(window, cx).placeholder("Search connections").leading_icon(IconName::Search));
        let form = Form {
            name: input("Production server", window, cx),
            host: input("server.example.com", window, cx),
            port: input("22", window, cx),
            username: input("root", window, cx),
            key_path: cx.new(|cx| TextInput::new(window, cx).placeholder("~/.ssh/id_ed25519").appearance(InputAppearance::Bare)),
            password: cx.new(|cx| TextInput::new(window, cx).placeholder("Fallback password").appearance(InputAppearance::Bare).masked()),
            show_password: false,
            access: Access::Ssh,
            access_select: cx.new(|cx| {
                let options = Access::ALL.into_iter().map(|access| SelectOption::new(access.label(), access.label())).collect();
                Select::new(options, Access::Ssh.label(), cx).variant(SelectVariant::Surface).width(SelectWidth::Full)
            }),
        };
        let password = cx.new(|cx| SecretInput::new("Password", cx));
        let folder_input = input("/home/me/project", window, cx);

        let mut subscriptions = vec![cx.subscribe_in(&filter, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Changed(_) => {
                this.selected = 0;
                cx.notify();
            }
            TextInputEvent::Confirmed => this.confirm_selected(window, cx),
            TextInputEvent::Cancelled => cx.emit(DismissEvent),
            _ => {}
        })];
        subscriptions.push(cx.subscribe(&form.access_select, |this, _, event: &SelectEvent, cx| {
            if let SelectEvent::Changed(value) = event
                && let Some(access) = Access::ALL.into_iter().find(|access| access.label() == value.as_ref())
            {
                this.form.access = access;
                cx.notify();
            }
        }));
        for field in [&form.name, &form.host, &form.port, &form.username, &form.key_path, &form.password] {
            subscriptions.push(cx.subscribe_in(field, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => {
                    this.error = None;
                    this.test_result = None;
                    cx.notify();
                }
                TextInputEvent::Confirmed => this.submit_form(window, cx),
                TextInputEvent::Cancelled => this.show_list(window, cx),
                _ => {}
            }));
        }
        subscriptions.push(cx.subscribe_in(&password, window, |this, _, event: &SecretEvent, window, cx| match event {
            SecretEvent::Confirmed => this.submit_password(window, cx),
            SecretEvent::Cancelled => this.show_list(window, cx),
        }));
        subscriptions.push(cx.subscribe_in(&folder_input, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => {
                let path = this.folder_input.read(cx).text().to_string();
                this.browse_to(normalize(&path), window, cx);
            }
            TextInputEvent::Cancelled => this.show_list(window, cx),
            _ => {}
        }));

        filter.update(cx, |input, cx| input.focus(window, cx));
        Self {
            focus_handle: cx.focus_handle(),
            saved,
            config_hosts,
            connected: manager().connected_ids(),
            stage: Stage::List,
            filter,
            form,
            password,
            remember_password: false,
            folder_input,
            selected: 0,
            error: None,
            testing: false,
            test_result: None,
            trust_for_test: None,
            _subscriptions: subscriptions,
        }
    }

    fn rows(&self, cx: &App) -> Vec<Row> {
        let query = self.filter.read(cx).text().to_lowercase();
        let matches = |text: &str| query.is_empty() || text.to_lowercase().contains(&query);
        let mut rows: Vec<Row> = self
            .saved
            .iter()
            .enumerate()
            .filter(|(_, connection)| matches(&connection.name) || matches(&connection.location()))
            .map(|(index, _)| Row::Saved(index))
            .collect();
        rows.extend(
            self.config_hosts
                .iter()
                .filter(|host| !self.saved.iter().any(|connection| &connection.host == *host))
                .filter(|host| matches(host))
                .map(|host| Row::ConfigHost(host.clone())),
        );
        rows
    }

    fn persist(&mut self, cx: &mut Context<Self>) {
        if let Err(error) = connections::save_default(&self.saved) {
            self.error = Some(format!("Could not save connections: {error}").into());
        }
        cx.notify();
    }

    fn upsert(&mut self, connection: SavedConnection, cx: &mut Context<Self>) {
        match self.saved.iter_mut().find(|saved| saved.id == connection.id) {
            Some(saved) => *saved = connection,
            None => self.saved.push(connection),
        }
        self.persist(cx);
    }

    pub fn show_list(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.stage = Stage::List;
        self.trust_for_test = None;
        self.connected = manager().connected_ids();
        self.filter.update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }

    /// The form, empty for a new connection or filled for `editing`.
    pub fn show_form(&mut self, editing: Option<SavedConnection>, window: &mut Window, cx: &mut Context<Self>) {
        let fill = |input: &Entity<TextInput>, text: String, cx: &mut Context<Self>| input.update(cx, |input, cx| input.set_text(text, cx));
        let connection = editing.clone().unwrap_or_else(|| SavedConnection { name: String::new(), ..SavedConnection::for_config_host("") });
        fill(&self.form.name, connection.name.clone(), cx);
        fill(&self.form.host, connection.host.clone(), cx);
        fill(&self.form.port, if editing.is_some() { connection.port.to_string() } else { String::new() }, cx);
        fill(&self.form.username, connection.username.clone(), cx);
        fill(&self.form.key_path, connection.key_path.clone().unwrap_or_default(), cx);
        // As `getConnection`, an edited connection shows its stored password.
        let stored = editing.as_ref().filter(|connection| connection.remember_password).and_then(|connection| connections::load_password(&connection.id));
        fill(&self.form.password, stored.unwrap_or_default(), cx);
        self.form.show_password = false;
        self.form.password.update(cx, |input, cx| input.set_masked(true, cx));
        self.form.access = connection.access;
        self.form.access_select.update(cx, |select, cx| select.set_value(connection.access.label(), cx));
        self.remember_password = connection.remember_password;
        self.password.update(cx, |password, cx| password.clear(cx));
        self.error = None;
        self.test_result = None;
        self.stage = Stage::Form { editing };
        let focus = if self.form.host.read(cx).text().is_empty() { &self.form.host } else { &self.form.name };
        focus.update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }

    pub fn show_trust(&mut self, connection: SavedConnection, challenge: HostKeyChallenge, cx: &mut Context<Self>) {
        self.stage = Stage::Trust { connection, challenge, trusting: false };
        cx.notify();
    }

    pub fn show_password(&mut self, connection: SavedConnection, rejected: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.remember_password = connection.remember_password;
        self.password.update(cx, |password, cx| password.clear(cx));
        self.stage = Stage::Password { connection, rejected };
        window.focus(&self.password.focus_handle(cx), cx);
        cx.notify();
    }

    /// The folder browser at `path`, with `folders` already listed (or listed now when `None`).
    pub fn show_folders(&mut self, connection: SavedConnection, path: String, folders: Option<Vec<String>>, window: &mut Window, cx: &mut Context<Self>) {
        self.folder_input.update(cx, |input, cx| input.set_text(path.clone(), cx));
        let load = folders.is_none();
        self.stage = Stage::Browse { connection, path: path.clone(), folders };
        self.selected = 0;
        if load {
            self.browse_to(path, window, cx);
        }
        window.focus(&self.focus_handle, cx);
        cx.notify();
    }

    fn form_connection(&self, editing: Option<&SavedConnection>, cx: &App) -> Result<SavedConnection, String> {
        let text = |input: &Entity<TextInput>| input.read(cx).text().trim().to_string();
        let host = text(&self.form.host);
        let port = match text(&self.form.port) {
            port if port.is_empty() => 22,
            port => port.parse::<u16>().map_err(|_| "Enter a port between 1 and 65535".to_string())?,
        };
        let username = text(&self.form.username);
        let name = Some(text(&self.form.name)).filter(|name| !name.is_empty()).unwrap_or_else(|| {
            if username.is_empty() { host.clone() } else { format!("{username}@{host}") }
        });
        let key_path = Some(text(&self.form.key_path)).filter(|path| !path.is_empty());
        let has_password = !self.form.password.read(cx).text().is_empty();
        let connection = SavedConnection {
            id: editing.map_or_else(connections::new_id, |connection| connection.id.clone()),
            name,
            host,
            port,
            username,
            access: self.form.access,
            key_path,
            remember_password: has_password && self.remember_password,
            last_folder: editing.and_then(|connection| connection.last_folder.clone()),
            last_connected: editing.and_then(|connection| connection.last_connected),
        };
        connection.validate()?;
        Ok(connection)
    }

    fn submit_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Stage::Form { editing } = &self.stage else { return };
        match self.form_connection(editing.as_ref(), cx) {
            Ok(connection) => {
                if !connection.remember_password {
                    connections::delete_password(&connection.id);
                }
                let password = Some(self.form.password.read(cx).text().to_string()).filter(|password| !password.is_empty());
                self.upsert(connection.clone(), cx);
                self.connect(connection, password, window, cx);
            }
            Err(error) => {
                self.error = Some(error.into());
                cx.notify();
            }
        }
    }

    /// Test Connection (`testRemoteConnection`): signs in with the form's settings on a session of
    /// its own, closed right after, and reports the outcome under the form.
    fn test_connection(&mut self, cx: &mut Context<Self>) {
        let Stage::Form { editing } = &self.stage else { return };
        if self.form.host.read(cx).text().trim().is_empty() {
            self.test_result = Some(Err("Host is required to test.".into()));
            cx.notify();
            return;
        }
        let connection = match self.form_connection(editing.as_ref(), cx) {
            Ok(connection) => connection,
            Err(error) => {
                self.test_result = Some(Err(error.into()));
                cx.notify();
                return;
            }
        };
        let password = Some(self.form.password.read(cx).text().to_string()).filter(|password| !password.is_empty());
        self.testing = true;
        self.test_result = None;
        cx.notify();
        let tested = connection.clone();
        let task = cx.background_spawn(async move {
            let target = crate::session::Target::resolve(&connection);
            crate::session::connect(&target, password.as_deref()).map(drop)
        });
        let editing = editing.clone();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.testing = false;
                let result = match result {
                    Err(error) if error.downcast_ref::<HostKeyChallenge>().is_some() => match error.downcast::<HostKeyChallenge>() {
                        Ok(challenge) => {
                            this.trust_for_test = Some(editing);
                            this.show_trust(tested, challenge, cx);
                            return;
                        }
                        Err(error) => Err(error),
                    },
                    result => result,
                };
                this.test_result = Some(match result {
                    Ok(()) => Ok("Connection successful.".into()),
                            Err(error) if error.downcast_ref::<PasswordRequired>().is_some() => Err("The server asks for a password.".into()),
                    Err(error) => Err(friendly_error(&error).into()),
                });
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn submit_password(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Stage::Password { connection, .. } = &self.stage else { return };
        let password = self.password.read(cx).text().to_string();
        if password.is_empty() {
            return;
        }
        let mut connection = connection.clone();
        connection.remember_password = self.remember_password;
        if !connection.remember_password {
            connections::delete_password(&connection.id);
        }
        self.upsert(connection.clone(), cx);
        self.connect(connection, Some(password), window, cx);
    }

    fn confirm_selected(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match &self.stage {
            Stage::List => {
                let Some(row) = self.rows(cx).get(self.selected).cloned() else { return };
                self.open_row(row, window, cx);
            }
            Stage::Browse { path, folders: Some(folders), .. } => {
                let target = match self.selected {
                    0 => RemotePath::new("", path).parent().map_or_else(|| "/".to_string(), |parent| parent.path),
                    index => match folders.get(index - 1) {
                        Some(name) => RemotePath::new("", path).join(name).path,
                        None => return,
                    },
                };
                self.browse_to(target, window, cx);
            }
            _ => {}
        }
    }

    fn open_row(&mut self, row: Row, window: &mut Window, cx: &mut Context<Self>) {
        let connection = match row {
            Row::Saved(index) => self.saved[index].clone(),
            Row::ConfigHost(host) => {
                let connection = SavedConnection::for_config_host(&host);
                self.upsert(connection.clone(), cx);
                connection
            }
        };
        self.connect(connection, None, window, cx);
    }

    /// Connects, then asks to trust the server, asks for a password, or opens the folder browser.
    pub fn connect(&mut self, connection: SavedConnection, password: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.error = None;
        self.stage = Stage::Connecting(connection.clone());
        window.focus(&self.focus_handle, cx);
        cx.notify();
        let attempt = connection.clone();
        let task = cx.background_spawn(async move {
            let connected = manager().connect(attempt, password)?;
            let home = connected.home_dir().unwrap_or_else(|_| "/".into());
            anyhow::Ok(home)
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            this.update_in(cx, |this, window, cx| {
                if !matches!(&this.stage, Stage::Connecting(current) if current.id == connection.id) {
                    return;
                }
                match result {
                    Ok(home) => {
                        let mut connection = connection;
                        connection.last_connected = Some(connections::now());
                        let start = connection.last_folder.clone().unwrap_or(home);
                        this.upsert(connection.clone(), cx);
                        this.show_folders(connection, start, None, window, cx);
                    }
                    Err(error) => {
                        if let Some(challenge) = error.downcast_ref::<HostKeyChallenge>() {
                            this.show_trust(connection, challenge.clone(), cx);
                        } else if let Some(required) = error.downcast_ref::<PasswordRequired>() {
                            let rejected = required.rejected;
                            this.show_password(connection, rejected, window, cx);
                        } else {
                            this.error = Some(friendly_error(&error).into());
                            this.show_list(window, cx);
                        }
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    /// Leaves the trust prompt: back to the form when Test Connection opened it, else the list.
    fn leave_trust(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.trust_for_test.take() {
            Some(editing) => {
                self.stage = Stage::Form { editing };
                self.form.host.update(cx, |input, cx| input.focus(window, cx));
                cx.notify();
            }
            None => self.show_list(window, cx),
        }
    }

    fn trust(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Stage::Trust { connection, challenge, trusting } = &mut self.stage else { return };
        *trusting = true;
        let (connection, fingerprint) = (connection.clone(), challenge.fingerprint.clone());
        cx.notify();
        let saved = connection.clone();
        let task = cx.background_spawn(async move { manager().trust(&saved, &fingerprint) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            this.update_in(cx, |this, window, cx| match result {
                Ok(()) if this.trust_for_test.is_some() => {
                    this.leave_trust(window, cx);
                    this.test_connection(cx);
                }
                Ok(()) => this.connect(connection, None, window, cx),
                Err(error) => {
                    this.error = Some(friendly_error(&error).into());
                    this.show_list(window, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn browse_to(&mut self, path: String, window: &mut Window, cx: &mut Context<Self>) {
        let Stage::Browse { connection, .. } = &self.stage else { return };
        let connection = connection.clone();
        self.stage = Stage::Browse { connection: connection.clone(), path: path.clone(), folders: None };
        self.selected = 0;
        self.error = None;
        self.folder_input.update(cx, |input, cx| input.set_text(path.clone(), cx));
        cx.notify();
        let (id, listed) = (connection.id.clone(), path.clone());
        let task = cx.background_spawn(async move { fs::folders(&*manager().get_or_connect(&id)?, &listed) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            this.update_in(cx, |this, _, cx| {
                let Stage::Browse { path: current, folders, .. } = &mut this.stage else { return };
                if *current != path {
                    return;
                }
                match result {
                    Ok(listed) => *folders = Some(listed),
                    Err(error) => {
                        *folders = Some(Vec::new());
                        this.error = Some(friendly_error(&error).into());
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open_folder(&mut self, cx: &mut Context<Self>) {
        let Stage::Browse { connection, path, .. } = &self.stage else { return };
        let mut connection = connection.clone();
        let project = RemotePath::new(connection.id.clone(), path).to_string();
        connection.last_folder = Some(path.clone());
        self.upsert(connection, cx);
        cx.emit(ConnectionsEvent::OpenProject(project));
        cx.emit(DismissEvent);
    }

    fn delete(&mut self, index: usize, cx: &mut Context<Self>) {
        if index >= self.saved.len() {
            return;
        }
        let connection = self.saved.remove(index);
        connections::delete_password(&connection.id);
        manager().disconnect(&connection.id);
        self.connected.retain(|id| *id != connection.id);
        self.selected = 0;
        self.persist(cx);
    }

    fn browse_key(&mut self, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: false, prompt: Some("Choose Key".into()) });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            this.update(cx, |this, cx| this.form.key_path.update(cx, |input, cx| input.set_text(path.to_string_lossy().into_owned(), cx))).ok();
        })
        .detach();
    }

    fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let count = match &self.stage {
            Stage::List => self.rows(cx).len(),
            Stage::Browse { folders: Some(folders), .. } => folders.len() + 1,
            _ => 0,
        };
        match event.keystroke.key.as_str() {
            "down" if count > 0 => self.selected = (self.selected + 1) % count,
            "up" if count > 0 => self.selected = (self.selected + count - 1) % count,
            "enter" if matches!(self.stage, Stage::Browse { .. }) && event.keystroke.modifiers.platform => self.open_folder(cx),
            "enter" if matches!(self.stage, Stage::Browse { .. } | Stage::List) => self.confirm_selected(window, cx),
            "enter" if matches!(self.stage, Stage::Trust { .. }) => self.trust(window, cx),
            "escape" if matches!(self.stage, Stage::List) => cx.emit(DismissEvent),
            "escape" if matches!(self.stage, Stage::Trust { .. }) => self.leave_trust(window, cx),
            "escape" => self.show_list(window, cx),
            _ => return,
        }
        cx.stop_propagation();
        cx.notify();
    }
}

fn remember_toggle(cx: &mut Context<ConnectionsView>) -> impl Fn(bool, &mut Window, &mut App) + 'static {
    let this = cx.entity().downgrade();
    move |checked, _, cx| {
        this.update(cx, |this, cx| {
            this.remember_password = checked;
            cx.notify();
        })
        .ok();
    }
}

fn label(text: &str, cx: &App) -> impl IntoElement {
    div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(cx.theme().colors.foreground).child(text.to_string())
}

/// A `FieldSet` with its legend and description, as the original's two form sections.
fn field_set(legend: &str, description: &str, cx: &App) -> gpui::Div {
    let colors = &cx.theme().colors;
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        // `FieldLegend` with its `FieldDescription` right under it.
        .child(
            div()
                .flex()
                .flex_col()
                .child(div().text_size(typography::text_base()).font_weight(typography::MEDIUM).text_color(colors.foreground).child(legend.to_string()))
                .child(div().text_size(typography::text_sm()).text_color(colors.muted_foreground).child(description.to_string())),
        )
}

fn field(name: &str, input: impl IntoElement, cx: &App) -> impl IntoElement {
    div().flex().flex_col().gap(px(6.)).flex_1().min_w_0().child(label(name, cx)).child(input)
}

/// A field whose label says it may be left blank, as the original's `(optional)`.
fn optional_field(name: &str, input: impl IntoElement, cx: &App) -> impl IntoElement {
    let label = div()
        .flex()
        .gap(px(4.))
        .child(label(name, cx))
        .child(div().text_size(typography::text_sm()).text_color(cx.theme().colors.subtle_foreground).child("(optional)"));
    div().flex().flex_col().gap(px(6.)).flex_1().min_w_0().child(label).child(input)
}

impl ConnectionsView {
    fn render_list(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let rows = self.rows(cx);
        let selected = self.selected.min(rows.len().saturating_sub(1));
        let first_config = rows.iter().position(|row| matches!(row, Row::ConfigHost(_)));
        let has_saved = rows.iter().any(|row| matches!(row, Row::Saved(_)));
        let section = |title: &str| {
            div()
                .px(px(6.))
                .pt(px(8.))
                .pb(px(2.))
                .text_size(typography::text_caption())
                .font_weight(typography::MEDIUM)
                .text_color(colors.subtle_foreground)
                .child(title.to_string())
        };
        let mut list = div().id("connection-rows").flex().flex_col().max_h(px(320.)).overflow_y_scroll().px(px(10.)).pb(px(8.));
        if has_saved {
            list = list.child(section("Saved"));
        }
        for (position, row) in rows.iter().enumerate() {
            if Some(position) == first_config {
                list = list.child(section("From ~/.ssh/config"));
            }
            let item = match row {
                Row::Saved(index) => {
                    let connection = &self.saved[*index];
                    let index = *index;
                    let connected = self.connected.contains(&connection.id);
                    SidebarListItem::new(SharedString::from(format!("saved-{}", connection.id)), connection.name.clone())
                        .description(connection.location())
                        .leading_icon(IconName::Remote)
                        .when(connected, |item| item.trailing(div().size(px(6.)).rounded_full().bg(colors.success)))
                        .hover_trailing(
                            div()
                                .flex()
                                .gap(px(2.))
                                .child(Button::icon(SharedString::from(format!("edit-{index}")), IconName::Pencil).size(ButtonSize::Small).tooltip("Edit").on_click(
                                    cx.listener(move |this, _, window, cx| {
                                        cx.stop_propagation();
                                        let connection = this.saved.get(index).cloned();
                                        this.show_form(connection, window, cx);
                                    }),
                                ))
                                .child(Button::icon(SharedString::from(format!("delete-{index}")), IconName::Trash).size(ButtonSize::Small).tooltip("Remove").on_click(
                                    cx.listener(move |this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.delete(index, cx);
                                    }),
                                )),
                        )
                }
                Row::ConfigHost(host) => SidebarListItem::new(SharedString::from(format!("host-{host}")), host.clone())
                    .description("~/.ssh/config")
                    .leading_icon(IconName::Terminal),
            };
            let row = row.clone();
            list = list.child(item.in_content().active(position == selected).on_click(cx.listener(move |this, _, window, cx| this.open_row(row.clone(), window, cx))));
        }
        if rows.is_empty() {
            let message = if self.saved.is_empty() && self.config_hosts.is_empty() {
                "No connections yet. Add one, or list hosts in ~/.ssh/config."
            } else {
                "No connections match."
            };
            list = list.child(div().py(px(16.)).flex().justify_center().text_color(colors.subtle_foreground).child(message));
        }
        div().flex().flex_col().child(div().px(px(16.)).pb(px(6.)).child(self.filter.clone())).child(list.scrollbar(window, cx))
    }

    fn render_form(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let accesses = self.form.access_select.clone();
        let remember = self.remember_password;
        let show_password = self.form.show_password;
        let has_password = !self.form.password.read(cx).text().is_empty();
        let key_focus = self.form.key_path.focus_handle(cx);
        let password_focus = self.form.password.focus_handle(cx);
        let key = InputGroup::new(div().font_family(typography::MONO_FONT).child(self.form.key_path.clone()))
            .focus_handle(&key_focus)
            .start(Icon::new(IconName::Key).size(IconSize::Small).color(colors.subtle_foreground))
            .end(
                Button::new("browse-key", "Browse")
                    .leading_icon(IconName::FolderOpen)
                    .size(ButtonSize::XSmall)
                    .variant(ButtonVariant::Ghost)
                    .on_click(cx.listener(|this, _, _, cx| this.browse_key(cx))),
            );
        let password = InputGroup::new(self.form.password.clone()).focus_handle(&password_focus).end(
            Button::icon("toggle-password", if show_password { IconName::EyeSlash } else { IconName::Eye })
                .size(ButtonSize::XSmall)
                .variant(ButtonVariant::Ghost)
                .tooltip(if show_password { "Hide password" } else { "Show password" })
                .on_click(cx.listener(|this, _, _, cx| {
                    this.form.show_password = !this.form.show_password;
                    let masked = !this.form.show_password;
                    this.form.password.update(cx, |input, cx| input.set_masked(masked, cx));
                    cx.notify();
                })),
        );
        div()
            .flex()
            .flex_col()
            .gap(px(16.))
            .px(px(16.))
            .pb(px(12.))
            .child(
                field_set("Connection", "Name the workspace and enter a host, IP address, or SSH config alias.", cx).child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(
                            div()
                                .flex()
                                .gap(px(12.))
                                .child(div().flex_1().min_w_0().child(field("Connection name", self.form.name.clone(), cx)))
                                .child(div().flex_none().w(px(192.)).child(field("Workspace access", accesses, cx))),
                        )
                        .child(
                            div()
                                .flex()
                                .gap(px(12.))
                                .child(div().flex_1().min_w_0().child(field("Host", self.form.host.clone(), cx)))
                                .child(div().w(px(96.)).child(field("Port", self.form.port.clone(), cx))),
                        ),
                ),
            )
            .child(
                field_set("Authentication", "Leave username blank to use SSH config. Your keys and SSH agent are used automatically.", cx).child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(optional_field("Username", self.form.username.clone(), cx))
                        .child(optional_field("Private key", key, cx))
                        .child(optional_field("Password", password, cx))
                        .when(has_password, |this| {
                            let this_view = cx.entity().downgrade();
                            this.child(
                                Checkbox::new("remember-password", remember).label("Store password securely for future connections").on_change(move |checked, _, cx| {
                                    this_view
                                        .update(cx, |this, cx| {
                                            this.remember_password = checked;
                                            cx.notify();
                                        })
                                        .ok();
                                }),
                            )
                        }),
                ),
            )
            .children(self.test_result.clone().map(|result| {
                let (icon, color, message) = match result {
                    Ok(message) => (IconName::CheckCircle, colors.success, message),
                    Err(message) => (IconName::WarningCircle, colors.destructive, message),
                };
                div().flex().items_center().gap(px(6.)).text_color(color).child(Icon::new(icon).size(IconSize::XSmall).color(color)).child(div().min_w_0().child(message))
            }))
    }

    fn render_message(icon: IconName, title: SharedString, body: impl IntoElement, cx: &App) -> impl IntoElement {
        let colors = &cx.theme().colors;
        div()
            .flex()
            .gap(px(12.))
            .px(px(16.))
            .pb(px(12.))
            .child(div().pt(px(2.)).child(Icon::new(icon).size(IconSize::Medium).color(colors.subtle_foreground)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .flex_1()
                    .min_w_0()
                    .child(div().font_weight(typography::MEDIUM).child(title))
                    .child(div().text_color(colors.muted_foreground).child(body)),
            )
    }

    fn render_browser(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let Stage::Browse { path, folders, .. } = &self.stage else { return div().into_any_element() };
        let mut list = div().id("folder-rows").flex().flex_col().h(px(280.)).overflow_y_scroll().px(px(10.)).pb(px(8.));
        match folders {
            None => {
                list = list.child(div().py(px(16.)).flex().justify_center().text_color(colors.subtle_foreground).child("Loading…"));
            }
            Some(folders) => {
                let selected = self.selected;
                if path != "/" {
                    list = list.child(
                        SidebarListItem::new("folder-up", "..")
                            .leading_icon(IconName::ArrowUp)
                            .in_content()
                            .active(selected == 0)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.selected = 0;
                                this.confirm_selected(window, cx);
                            })),
                    );
                }
                for (index, name) in folders.iter().enumerate() {
                    let row = index + 1;
                    list = list.child(
                        SidebarListItem::new(SharedString::from(format!("folder-{index}")), name.clone())
                            .leading_icon(IconName::Folder)
                            .in_content()
                            .active(selected == row)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.selected = row;
                                this.confirm_selected(window, cx);
                            })),
                    );
                }
                if folders.is_empty() {
                    list = list.child(div().py(px(16.)).flex().justify_center().text_color(colors.subtle_foreground).child("No folders here"));
                }
            }
        }
        div().flex().flex_col().child(div().px(px(16.)).pb(px(6.)).child(self.folder_input.clone())).child(list.scrollbar(window, cx)).into_any_element()
    }
}

impl Render for ConnectionsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let (title, back) = match &self.stage {
            Stage::List => ("Remote Connections".to_string(), false),
            Stage::Form { editing: Some(_) } => ("Edit Connection".into(), true),
            Stage::Form { editing: None } => ("Add Remote Connection".into(), true),
            Stage::Connecting(connection) => (format!("Connecting to {}…", connection.name), true),
            Stage::Trust { .. } => ("Trust SSH server?".into(), true),
            Stage::Password { .. } => ("Enter Password".into(), true),
            Stage::Browse { connection, .. } => (format!("Open Folder on {}", connection.name), true),
        };

        let body = match &self.stage {
            Stage::List => self.render_list(window, cx).into_any_element(),
            Stage::Form { .. } => self.render_form(cx).into_any_element(),
            Stage::Connecting(connection) => Self::render_message(
                IconName::ArrowsClockwise,
                format!("Connecting to {}", connection.location()).into(),
                "Checking the server's identity and signing in.",
                cx,
            )
            .into_any_element(),
            Stage::Trust { challenge, .. } => Self::render_message(
                IconName::ShieldCheck,
                format!("First connection to {}:{}", challenge.host, challenge.port).into(),
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child("Verify this fingerprint with the server's administrator before trusting it. Athas saves it to ~/.ssh/athas_known_hosts.")
                    .child(
                        div()
                            .px(px(10.))
                            .py(px(8.))
                            .rounded(metrics::radius_lg())
                            .bg(colors.raised)
                            .font_family(typography::MONO_FONT)
                            .text_color(colors.foreground)
                            .child(challenge.fingerprint.clone()),
                    ),
                cx,
            )
            .into_any_element(),
            Stage::Password { connection, rejected } => {
                let target = crate::session::Target::with_config(connection, &Default::default(), std::path::Path::new("/"));
                let user = if target.user.is_empty() { String::new() } else { format!("{}@", target.user) };
                let address = format!("{user}{}:{}", connection.host, connection.port);
                let remember = self.remember_password;
                div()
                    .flex()
                    .flex_col()
                    .gap(px(10.))
                    .px(px(16.))
                    .pb(px(12.))
                    .child(
                        div()
                            .text_size(typography::text_sm())
                            .text_color(colors.subtle_foreground)
                            .child("Enter the password for ")
                            .child(div().font_weight(typography::MEDIUM).text_color(colors.foreground).child(connection.name.clone()))
                            .child(format!(" ({address})"))
                            .flex()
                            .flex_wrap(),
                    )
                    .when(*rejected, |this| this.child(div().text_size(typography::text_sm()).text_color(colors.destructive).child("That password was refused. Try again.")))
                    .child(self.password.clone())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(Switch::new("remember-prompt", remember).on_change(remember_toggle(cx)))
                            .child(div().text_color(colors.muted_foreground).child("Store password securely for future connections")),
                    )
                    .into_any_element()
            }
            Stage::Browse { .. } => self.render_browser(window, cx).into_any_element(),
        };

        let footer = div().flex().items_center().gap(px(8.)).px(px(16.)).py(px(12.)).border_t_1().border_color(colors.divider);
        let footer = footer
            .children(self.error.clone().map(|error| {
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap(px(6.))
                    .text_color(colors.destructive)
                    .child(Icon::new(IconName::WarningCircle).size(IconSize::XSmall).color(colors.destructive))
                    .child(div().min_w_0().truncate().child(error))
            }))
            .child(div().flex_1());
        let footer = match &self.stage {
            Stage::List => footer.child(
                Button::new("new-connection", "New Connection")
                    .leading_icon(IconName::Plus)
                    .variant(ButtonVariant::Accent)
                    .on_click(cx.listener(|this, _, window, cx| this.show_form(None, window, cx))),
            ),
            // The original's footer: ghost Test Connection and Save & Connect, both off until a
            // host is given (the back arrow leaves the form).
            Stage::Form { .. } => {
                let no_host = self.form.host.read(cx).text().trim().is_empty();
                footer
                    .child(
                        Button::new("test-connection", if self.testing { "Testing…" } else { "Test Connection" })
                            .variant(ButtonVariant::Ghost)
                            .disabled(self.testing || no_host)
                            .on_click(cx.listener(|this, _, _, cx| this.test_connection(cx))),
                    )
                    .child(
                        Button::new("save-connect", "Save & Connect")
                            .variant(ButtonVariant::Accent)
                            .disabled(self.testing || no_host)
                            .on_click(cx.listener(|this, _, window, cx| this.submit_form(window, cx))),
                    )
            }
            Stage::Connecting(_) => footer.child(Button::new("cancel-connect", "Cancel").on_click(cx.listener(|this, _, window, cx| this.show_list(window, cx)))),
            Stage::Trust { trusting, .. } => {
                let trusting = *trusting;
                footer
                    .child(Button::new("cancel-trust", "Cancel").on_click(cx.listener(|this, _, window, cx| this.leave_trust(window, cx))))
                    .child(
                        Button::new("trust", match (trusting, self.trust_for_test.is_some()) {
                            (true, _) => "Trusting…",
                            (false, true) => "Trust and Test",
                            (false, false) => "Trust and Connect",
                        })
                            .variant(ButtonVariant::Accent)
                            .disabled(trusting)
                            .on_click(cx.listener(|this, _, window, cx| this.trust(window, cx))),
                    )
            }
            Stage::Password { .. } => footer
                .child(Button::new("cancel-password", "Cancel").on_click(cx.listener(|this, _, window, cx| this.show_list(window, cx))))
                .child(Button::new("submit-password", "Connect").variant(ButtonVariant::Accent).on_click(cx.listener(|this, _, window, cx| this.submit_password(window, cx)))),
            Stage::Browse { folders, .. } => footer
                .child(Button::new("back-browse", "Back").on_click(cx.listener(|this, _, window, cx| this.show_list(window, cx))))
                .child(
                    Button::new("open-folder", "Open Folder")
                        .variant(ButtonVariant::Accent)
                        .shortcut("⌘↩")
                        .disabled(folders.is_none())
                        .on_click(cx.listener(|this, _, _, cx| this.open_folder(cx))),
                ),
        };

        div()
            .id("remote-connections")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::key_down))
            .occlude()
            .self_start()
            .flex()
            .flex_col()
            // The add-remote step is `w-[min(44rem,…)]` in the original.
            .w(px(if matches!(self.stage, Stage::Form { .. }) { 704. } else { 520. }))
            .max_w_full()
            .rounded(metrics::island_radius())
            .bg(colors.overlay)
            .shadow(theme.shadows.dialog.clone())
            .text_size(typography::text_sm())
            .text_color(colors.foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(16.))
                    .pt(px(12.))
                    .pb(px(10.))
                    .when(back, |this| {
                        this.child(
                            Button::icon("back", IconName::ArrowLeft)
                                .size(ButtonSize::Small)
                                .tooltip("Back")
                                .on_click(cx.listener(|this, _, window, cx| this.show_list(window, cx))),
                        )
                    })
                    .when(!back, |this| this.child(Icon::new(IconName::Remote).size(IconSize::Small).color(colors.subtle_foreground)))
                    .when(matches!(self.stage, Stage::Form { .. }), |this| this.child(Icon::new(IconName::HardDrives).size(IconSize::Small).color(colors.subtle_foreground)))
                    .child(div().flex_1().min_w_0().truncate().text_size(typography::text_base()).font_weight(typography::MEDIUM).child(title))
                    .child(
                        Button::icon("close-connections", IconName::X)
                            .size(ButtonSize::Small)
                            .tooltip("Close")
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(DismissEvent))),
                    ),
            )
            .child(body)
            .child(footer)
    }
}
