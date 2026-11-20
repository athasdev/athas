//! The connection dialog (`components/connection/connection-dialog.tsx`): the engine, then a file
//! or a server, a test, and Save & Connect.

use gpui::{
    App, ClipboardItem, Context, Entity, EventEmitter, FocusHandle, Focusable, KeyDownEvent, PathPromptOptions,
    SharedString, Subscription, Window, div, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, TextInput, TextInputEvent, metrics, typography};

use crate::{backend::Backend, connections::SavedConnection, model::Provider};

pub enum ConnectionFormEvent {
    Save { connection: SavedConnection, password: Option<String> },
    Cancel,
}

#[derive(Clone)]
enum TestState {
    Idle,
    Testing,
    Passed,
    Failed(SharedString),
}

pub struct ConnectionForm {
    focus_handle: FocusHandle,
    /// The connection being edited; `None` for a new one.
    editing: Option<SavedConnection>,
    provider: Provider,
    name: Entity<TextInput>,
    file_path: Entity<TextInput>,
    host: Entity<TextInput>,
    port: Entity<TextInput>,
    database: Entity<TextInput>,
    username: Entity<TextInput>,
    password: Entity<SecretInput>,
    connection_string: Entity<TextInput>,
    test: TestState,
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ConnectionFormEvent> for ConnectionForm {}

impl Focusable for ConnectionForm {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl ConnectionForm {
    pub fn new(editing: Option<SavedConnection>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = |placeholder: &str, window: &mut Window, cx: &mut Context<Self>| {
            let placeholder = placeholder.to_string();
            cx.new(|cx| TextInput::new(window, cx).placeholder(placeholder))
        };
        let name = input("My database", window, cx);
        let file_path = input("/path/to/database.sqlite", window, cx);
        let host = input("localhost", window, cx);
        let port = input("5432", window, cx);
        let database = input("postgres", window, cx);
        let username = input("postgres", window, cx);
        let connection_string = input("postgres://user:password@host:5432/database (optional)", window, cx);
        let password = cx.new(SecretInput::new);
        let provider = editing.as_ref().map_or(Provider::Sqlite, |connection| connection.provider);

        if let Some(connection) = editing.as_ref() {
            let fill = |input: &Entity<TextInput>, text: String, cx: &mut Context<Self>| {
                input.update(cx, |input, cx| input.set_text(text, cx));
            };
            fill(&name, connection.name.clone(), cx);
            fill(&file_path, connection.file_path.clone(), cx);
            fill(&host, connection.host.clone(), cx);
            if connection.port != 0 {
                fill(&port, connection.port.to_string(), cx);
            }
            fill(&database, connection.database.clone(), cx);
            fill(&username, connection.username.clone(), cx);
            fill(&connection_string, connection.connection_string.clone().unwrap_or_default(), cx);
            password.update(cx, |password, _| password.placeholder = "Saved in the keychain".into());
        }

        let mut subscriptions = Vec::new();
        for field in [&name, &file_path, &host, &port, &database, &username, &connection_string] {
            subscriptions.push(cx.subscribe_in(field, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Changed(_) => {
                    this.test = TestState::Idle;
                    this.error = None;
                    cx.notify();
                }
                TextInputEvent::Confirmed => this.save(window, cx),
                TextInputEvent::Cancelled => cx.emit(ConnectionFormEvent::Cancel),
                _ => {}
            }));
        }
        subscriptions.push(cx.subscribe_in(&password, window, |this, _, event: &SecretEvent, window, cx| match event {
            SecretEvent::Confirmed => this.save(window, cx),
            SecretEvent::Cancelled => cx.emit(ConnectionFormEvent::Cancel),
        }));

        let form = Self {
            focus_handle: cx.focus_handle(),
            editing,
            provider,
            name,
            file_path,
            host,
            port,
            database,
            username,
            password,
            connection_string,
            test: TestState::Idle,
            error: None,
            _subscriptions: subscriptions,
        };
        form.update_placeholders(cx);
        form.name.update(cx, |input, cx| input.focus(window, cx));
        form
    }

    fn update_placeholders(&self, cx: &mut Context<Self>) {
        let provider = self.provider;
        let port = provider.default_port();
        self.port.update(cx, |input, cx| input.set_placeholder(port.to_string(), cx));
        let (database, user, scheme) = match provider {
            Provider::Mysql => ("mysql", "root", "mysql"),
            Provider::Mongodb => ("admin", "", "mongodb"),
            Provider::Redis => ("0", "", "redis"),
            _ => ("postgres", "postgres", "postgres"),
        };
        self.database.update(cx, |input, cx| input.set_placeholder(database, cx));
        self.username.update(cx, |input, cx| input.set_placeholder(user, cx));
        self.connection_string.update(cx, |input, cx| {
            input.set_placeholder(format!("{scheme}://user:password@host:{port}/{database} (optional)"), cx)
        });
        let extension = provider.file_extensions().first().copied().unwrap_or("db");
        self.file_path.update(cx, |input, cx| input.set_placeholder(format!("/path/to/database.{extension}"), cx));
    }

    fn set_provider(&mut self, provider: Provider, cx: &mut Context<Self>) {
        self.provider = provider;
        self.test = TestState::Idle;
        self.error = None;
        self.update_placeholders(cx);
        cx.notify();
    }

    fn text(input: &Entity<TextInput>, cx: &App) -> String {
        input.read(cx).text().trim().to_string()
    }

    /// The connection the fields describe.
    fn connection(&self, cx: &App) -> Result<SavedConnection, String> {
        let provider = self.provider;
        let file_path = Self::text(&self.file_path, cx);
        let port_text = Self::text(&self.port, cx);
        let port = if port_text.is_empty() {
            provider.default_port()
        } else {
            port_text.parse::<u16>().map_err(|_| "Enter a port between 1 and 65535".to_string())?
        };
        let mut name = Self::text(&self.name, cx);
        if name.is_empty() {
            name = if provider.is_file_based() {
                std::path::Path::new(&file_path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default()
            } else {
                let host = Self::text(&self.host, cx);
                if host.is_empty() { String::new() } else { format!("{} on {host}", provider.label()) }
            };
        }
        let string = Self::text(&self.connection_string, cx);
        let connection = SavedConnection {
            id: self.editing.as_ref().map_or_else(crate::connections::new_id, |connection| connection.id.clone()),
            name,
            provider,
            file_path: if provider.is_file_based() { file_path } else { String::new() },
            host: if provider.is_file_based() { String::new() } else { Self::text(&self.host, cx) },
            port: if provider.is_file_based() { 0 } else { port },
            database: if provider.is_file_based() { String::new() } else { Self::text(&self.database, cx) },
            username: if provider.is_file_based() { String::new() } else { Self::text(&self.username, cx) },
            connection_string: (!provider.is_file_based() && !string.is_empty()).then_some(string),
        };
        connection.validate()?;
        Ok(connection)
    }

    fn password(&self, cx: &App) -> Option<String> {
        let password = self.password.read(cx).text.clone();
        (!password.is_empty()).then_some(password)
    }

    fn save(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if !self.provider.is_available() {
            return;
        }
        match self.connection(cx) {
            Ok(connection) => {
                let password = self.password(cx);
                cx.emit(ConnectionFormEvent::Save { connection, password });
            }
            Err(error) => {
                self.error = Some(error.into());
                cx.notify();
            }
        }
    }

    fn test(&mut self, cx: &mut Context<Self>) {
        let connection = match self.connection(cx) {
            Ok(connection) => connection,
            Err(error) => {
                self.error = Some(error.into());
                cx.notify();
                return;
            }
        };
        let typed = self.password(cx);
        self.test = TestState::Testing;
        self.error = None;
        cx.notify();
        let task = cx.background_spawn(async move {
            let password = resolve_password(&connection, typed);
            Backend::test(&connection, password)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.test = match result {
                    Ok(()) => TestState::Passed,
                    Err(error) => TestState::Failed(error.to_string().into()),
                };
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn browse(&mut self, cx: &mut Context<Self>) {
        if let Some(web) = workbench_api::web_files(cx) {
            let this = cx.weak_entity();
            (web.upload)(
                Some(crate::DATABASE_FILE_TYPES),
                Box::new(move |chosen, cx| {
                    let Ok(Some(path)) = chosen else { return };
                    this.update(cx, |this, cx| this.use_file(path.to_string_lossy().into_owned(), cx)).ok();
                }),
                cx,
            );
            return;
        }
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Open Database".into()),
        });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            let path = path.to_string_lossy().into_owned();
            this.update(cx, |this, cx| this.use_file(path, cx)).ok();
        })
        .detach();
    }

    fn use_file(&mut self, path: String, cx: &mut Context<Self>) {
        if let Some(provider) = Provider::for_file(&path) {
            self.set_provider(provider, cx);
        }
        self.file_path.update(cx, |input, cx| input.set_text(path, cx));
    }

    fn field(label: &str, input: impl IntoElement, cx: &App) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .flex_1()
            .min_w_0()
            .child(
                div()
                    .text_size(typography::TEXT_SM)
                    .font_weight(typography::MEDIUM)
                    .text_color(cx.theme().colors.muted_foreground)
                    .child(label.to_string()),
            )
            .child(input)
    }
}

impl Render for ConnectionForm {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let provider = self.provider;
        let available = provider.is_available();
        let title = if self.editing.is_some() { "Edit Connection" } else { "New Connection" };

        let providers = div().flex().flex_wrap().gap(px(6.)).children(Provider::ALL.into_iter().map(|option| {
            Button::new(SharedString::from(format!("provider-{}", option.id())), option.label())
                .size(ButtonSize::Small)
                .variant(if option == provider { ButtonVariant::Default } else { ButtonVariant::Ghost })
                .active(option == provider)
                .tooltip(if option.is_available() { option.label().to_string() } else { format!("{} is not available yet", option.label()) })
                .on_click(cx.listener(move |this, _, _, cx| this.set_provider(option, cx)))
        }));

        let body = if !available {
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .p(px(12.))
                .rounded(metrics::RADIUS_LG)
                .bg(colors.warning_soft)
                .text_size(typography::TEXT_SM)
                .text_color(colors.foreground)
                .child(Icon::new(IconName::Warning).size(IconSize::Small).color(colors.warning))
                .child(format!("{} connections are not available in this build.", provider.label()))
                .into_any_element()
        } else if provider.is_file_based() {
            div()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(Self::field("Name", self.name.clone(), cx))
                .child(Self::field(
                    "Database file",
                    div().flex().items_center().gap(px(6.)).child(div().flex_1().min_w_0().child(self.file_path.clone())).child(
                        Button::new("browse-file", "Browse…").on_click(cx.listener(|this, _, _, cx| this.browse(cx))),
                    ),
                    cx,
                ))
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(Self::field("Name", self.name.clone(), cx))
                .child(
                    div()
                        .flex()
                        .gap(px(10.))
                        .child(div().flex_1().child(Self::field("Host", self.host.clone(), cx)))
                        .child(div().w(px(96.)).child(Self::field("Port", self.port.clone(), cx))),
                )
                .child(Self::field("Database", self.database.clone(), cx))
                .child(
                    div()
                        .flex()
                        .gap(px(10.))
                        .child(Self::field("Username", self.username.clone(), cx))
                        .child(Self::field("Password", self.password.clone(), cx)),
                )
                .child(Self::field("Connection string", self.connection_string.clone(), cx))
                .into_any_element()
        };

        let status = match (&self.error, &self.test) {
            (Some(error), _) => Some((IconName::WarningCircle, colors.destructive, error.clone())),
            (None, TestState::Testing) => Some((IconName::ArrowsClockwise, colors.subtle_foreground, "Testing…".into())),
            (None, TestState::Passed) => Some((IconName::CheckCircle, colors.success, "Connection works".into())),
            (None, TestState::Failed(error)) => Some((IconName::WarningCircle, colors.destructive, error.clone())),
            (None, TestState::Idle) => None,
        };

        div()
            .id("connection-form")
            .track_focus(&self.focus_handle)
            .occlude()
            .flex()
            .flex_col()
            .w(px(480.))
            .max_w_full()
            .rounded(metrics::ISLAND_RADIUS)
            .bg(colors.overlay)
            .shadow(theme.shadows.dialog.clone())
            .text_size(typography::TEXT_SM)
            .text_color(colors.foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(16.))
                    .pt(px(14.))
                    .pb(px(10.))
                    .child(Icon::new(IconName::Database).size(IconSize::Small).color(colors.subtle_foreground))
                    .child(div().flex_1().text_size(typography::TEXT_BASE).font_weight(typography::SEMIBOLD).child(title))
                    .child(
                        Button::icon("close-form", IconName::X)
                            .size(ButtonSize::Small)
                            .tooltip("Close")
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(ConnectionFormEvent::Cancel))),
                    ),
            )
            .child(div().flex().flex_col().gap(px(14.)).px(px(16.)).pb(px(14.)).child(providers).child(body))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(16.))
                    .py(px(12.))
                    .border_t_1()
                    .border_color(colors.divider)
                    .children(status.map(|(icon, color, text)| {
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(6.))
                            .text_color(color)
                            .child(Icon::new(icon).size(IconSize::XSmall).color(color))
                            .child(div().min_w_0().truncate().child(text))
                    }))
                    .child(div().flex_1())
                    .child(
                        Button::new("test-connection", "Test")
                            .variant(ButtonVariant::Ghost)
                            .disabled(!available || matches!(self.test, TestState::Testing))
                            .on_click(cx.listener(|this, _, _, cx| this.test(cx))),
                    )
                    .child(
                        Button::new("cancel-connection", "Cancel")
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(ConnectionFormEvent::Cancel))),
                    )
                    .child(
                        Button::new("save-connection", if self.editing.is_some() { "Save & Connect" } else { "Connect" })
                            .variant(ButtonVariant::Accent)
                            .disabled(!available)
                            .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                    ),
            )
    }
}

pub enum SecretEvent {
    Confirmed,
    Cancelled,
}

/// A password field: typed text shows as dots and never reaches the clipboard.
pub struct SecretInput {
    focus_handle: FocusHandle,
    text: String,
    placeholder: SharedString,
}

impl EventEmitter<SecretEvent> for SecretInput {}

impl Focusable for SecretInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl SecretInput {
    fn new(cx: &mut Context<Self>) -> Self {
        Self { focus_handle: cx.focus_handle(), text: String::new(), placeholder: "Password".into() }
    }

    fn key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let command = keystroke.modifiers.platform || keystroke.modifiers.control;
        match keystroke.key.as_str() {
            "enter" => cx.emit(SecretEvent::Confirmed),
            "escape" => cx.emit(SecretEvent::Cancelled),
            "backspace" if command || keystroke.modifiers.alt => self.text.clear(),
            "backspace" => {
                self.text.pop();
            }
            "v" if command => {
                if let Some(text) = cx.read_from_clipboard().and_then(|item: ClipboardItem| item.text()) {
                    self.text.push_str(text.trim_end_matches(['\n', '\r']));
                }
            }
            "tab" => return,
            _ if !command => match keystroke.key_char.as_ref() {
                Some(chars) if !chars.chars().any(char::is_control) => self.text.push_str(chars),
                _ => return,
            },
            _ => return,
        }
        cx.stop_propagation();
        cx.notify();
    }
}

impl Render for SecretInput {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme().clone();
        let focused = self.focus_handle.is_focused(window);
        let dots: SharedString = "•".repeat(self.text.chars().count()).into();
        div()
            .id("secret-input")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::key_down))
            .on_click(cx.listener(|this, _, window, cx| window.focus(&this.focus_handle, cx)))
            .flex()
            .items_center()
            .h(px(28.))
            .px(px(12.))
            .rounded_full()
            .bg(theme.colors.raised)
            .shadow(theme.shadows.raised.clone())
            .when(focused, |this| this.border_1().border_color(theme.colors.focus_ring).px(px(11.)))
            .text_size(typography::TEXT_SM)
            .child(if self.text.is_empty() {
                div().text_color(theme.colors.subtle_foreground).child(self.placeholder.clone())
            } else {
                div().text_color(theme.colors.foreground).child(dots)
            })
            .when(focused, |this| this.child(div().ml(px(1.)).w(px(1.5)).h(px(14.)).bg(theme.colors.cursor)))
    }
}

/// Opens `connection` for a test or a session: the password typed, else the keychain's.
pub fn resolve_password(connection: &SavedConnection, typed: Option<String>) -> Option<String> {
    if connection.provider.is_file_based() {
        return None;
    }
    typed.or_else(|| crate::connections::load_password(&connection.id))
}
