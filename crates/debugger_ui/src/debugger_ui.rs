//! Run and Debug (`features/debugger`): pick a launch configuration, start a session, step through
//! the program, and read its threads, call stack, variables, watches, breakpoints and console.
//!
//! # Mounting it
//!
//! ```ignore
//! let view = cx.new(|cx| DebuggerView::new(project_root, window, cx));
//! cx.subscribe_in(&view, window, |this, _, event, window, cx| match event {
//!     DebuggerViewEvent::OpenLocation { path, line } => { /* open the file, go to `line` (one-based) */ }
//!     DebuggerViewEvent::ShowPicker(picker) => this.open_modal(picker.clone(), window, cx),
//! });
//! ```
//!
//! Commands (`assets/keymaps/commands.json`): `workbench.showDebugger` shows the view,
//! `debug.start` → [`DebuggerView::start`], `debug.stop` → [`DebuggerView::stop`],
//! `debug.restart` → [`DebuggerView::restart`], and `debug.toggleBreakpoint` toggles the editor's
//! cursor line in [`dap::BreakpointStore`]. Inside the view F5, F6, F10, F11, shift-F11, shift-F5
//! and cmd-shift-F5 drive the session.

mod config_picker;
mod java;
mod render;
mod tree;

use std::path::{Path, PathBuf};

use dap::{
    BreakpointField, BreakpointId, BreakpointStore, DebugSession, EvaluateResult, LaunchConfig, RunInTerminalHandler, SessionEvent,
    SessionStatus, Substitutions,
};
use gpui::{
    App, AppContext as _, Context, Entity, EventEmitter, FocusHandle, Focusable, KeyBinding, ScrollHandle, Subscription, Task, Window, actions,
};
use palette::Picker;
use ui::{IconName, InputAppearance, OpenMenu, TextInput, TextInputEvent};

pub use config_picker::LaunchConfigDelegate;
use tree::Expansion;

actions!(debugger, [Start, Pause, StepOver, StepInto, StepOut, Restart, Stop, SelectConfiguration]);

/// Binds the view's keys. `DebuggerView::new` calls it.
pub fn init(cx: &mut App) {
    ui::bind_keys_once(cx, "debugger", bind_keys);
}

fn bind_keys(cx: &mut App) {
    let context = Some("DebuggerView");
    let restart = if cfg!(target_os = "macos") { "cmd-shift-f5" } else { "ctrl-shift-f5" };
    cx.bind_keys([
        KeyBinding::new("f5", Start, context),
        KeyBinding::new("shift-f5", Stop, context),
        KeyBinding::new(restart, Restart, context),
        KeyBinding::new("f6", Pause, context),
        KeyBinding::new("f10", StepOver, context),
        KeyBinding::new("f11", StepInto, context),
        KeyBinding::new("shift-f11", StepOut, context),
    ]);
}

#[derive(Clone, Debug)]
pub enum DebuggerViewEvent {
    /// Show this file at this one-based line: a clicked frame or breakpoint, or where the program
    /// paused.
    OpenLocation { path: PathBuf, line: u32 },
    /// Show this picker as a modal.
    ShowPicker(Entity<Picker<LaunchConfigDelegate>>),
}

/// The panel the segmented bar shows on the right (`DebuggerPanel`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Panel {
    Stack,
    Variables,
    Watch,
    Console,
    Breakpoints,
}

impl Panel {
    pub const ALL: [Panel; 5] = [Panel::Stack, Panel::Variables, Panel::Watch, Panel::Console, Panel::Breakpoints];

    pub fn label(self) -> &'static str {
        match self {
            Panel::Stack => "Call Stack",
            Panel::Variables => "Variables",
            Panel::Watch => "Watch",
            Panel::Console => "Console",
            Panel::Breakpoints => "Breakpoints",
        }
    }
}

/// The configuration that runs a command typed in the view in a terminal (`generated-custom`).
pub const CUSTOM_CONFIG_KIND: &str = "custom";
pub const CUSTOM_CONFIG_NAME: &str = "Custom debug command";

fn custom_config() -> LaunchConfig {
    let mut arguments = serde_json::Map::new();
    arguments.insert("name".into(), CUSTOM_CONFIG_NAME.into());
    arguments.insert("type".into(), CUSTOM_CONFIG_KIND.into());
    arguments.insert("request".into(), "launch".into());
    LaunchConfig {
        name: CUSTOM_CONFIG_NAME.into(),
        kind: CUSTOM_CONFIG_KIND.into(),
        request: dap::RequestKind::Launch,
        arguments,
        source: dap::ConfigSource::Generated,
    }
}

pub(crate) struct Watch {
    pub id: u64,
    pub expression: String,
    pub result: Option<Result<EvaluateResult, String>>,
}

/// A variable's value being changed in place (`setVariable`).
pub(crate) struct VariableEdit {
    pub key: String,
    pub input: Entity<TextInput>,
    _subscription: Subscription,
}

pub(crate) struct BreakpointEdit {
    pub id: BreakpointId,
    pub field: BreakpointField,
    pub input: Entity<TextInput>,
    _subscription: Subscription,
}

/// A debug command running in a terminal, without an adapter (a Docker container's debugger):
/// the view lists it as the session until it is stopped or a launch configuration starts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandSession {
    pub name: String,
    pub command: String,
}

pub struct DebuggerView {
    project_root: PathBuf,
    focus_handle: FocusHandle,
    pub(crate) store: Entity<BreakpointStore>,
    active_file: Option<PathBuf>,
    pub(crate) configs: Vec<LaunchConfig>,
    pub(crate) notice: Option<String>,
    pub(crate) selected_config: usize,
    pub(crate) session: Option<Entity<DebugSession>>,
    pub(crate) command_session: Option<CommandSession>,
    session_subscriptions: Vec<Subscription>,
    run_in_terminal: Option<RunInTerminalHandler>,
    pub(crate) panel: Panel,
    pub(crate) expansion: Expansion,
    pub(crate) watches: Vec<Watch>,
    next_watch: u64,
    pub(crate) watch_input: Entity<TextInput>,
    /// The command the custom configuration runs.
    pub(crate) command_input: Entity<TextInput>,
    pub(crate) open_menu: Option<OpenMenu>,
    pub(crate) console_input: Entity<TextInput>,
    pub(crate) console_scroll: ScrollHandle,
    pub(crate) editing: Option<BreakpointEdit>,
    pub(crate) variable_edit: Option<VariableEdit>,
    java_start: Option<Task<()>>,
    /// The adapters installed on this machine, found once in the background.
    pub(crate) installed_adapters: Vec<&'static str>,
    _tasks: Vec<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<DebuggerViewEvent> for DebuggerView {}

impl Focusable for DebuggerView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl DebuggerView {
    pub fn new(project_root: PathBuf, window: &mut Window, cx: &mut Context<Self>) -> Self {
        init(cx);
        let store = BreakpointStore::global(cx);
        store.update(cx, |store, cx| store.load_project(&project_root, cx));
        let watch_input = cx.new(|cx| TextInput::new(window, cx).placeholder("Add expression"));
        let command_input = cx.new(|cx| TextInput::new(window, cx).placeholder("Command to run"));
        let console_input = cx.new(|cx| {
            TextInput::new(window, cx).placeholder("Evaluate an expression").appearance(InputAppearance::Bare).leading_icon(IconName::ChevronRight)
        });
        let subscriptions = vec![
            cx.observe(&store, |_, _, cx| cx.notify()),
            cx.subscribe_in(&watch_input, window, |this, input, event: &TextInputEvent, _, cx| match event {
                TextInputEvent::Confirmed => {
                    let expression = input.read(cx).text().to_string();
                    input.update(cx, |input, cx| input.set_text("", cx));
                    this.add_watch(expression, cx);
                }
                TextInputEvent::Changed(_) => cx.notify(),
                _ => {}
            }),
            cx.subscribe_in(&command_input, window, |this, _, event: &TextInputEvent, window, cx| match event {
                TextInputEvent::Confirmed => this.start(window, cx),
                TextInputEvent::Changed(_) => cx.notify(),
                _ => {}
            }),
            cx.subscribe_in(&console_input, window, |this, input, event: &TextInputEvent, _, cx| {
                if *event == TextInputEvent::Confirmed {
                    let expression = input.read(cx).text().to_string();
                    input.update(cx, |input, cx| input.set_text("", cx));
                    this.evaluate_in_console(&expression, cx);
                }
            }),
        ];
        let adapters = cx.background_spawn(async { dap::installed_adapters().into_iter().map(|(name, _)| name).collect::<Vec<_>>() });
        let adapters_task = cx.spawn(async move |this, cx| {
            let adapters = adapters.await;
            this.update(cx, |this, cx| {
                this.installed_adapters = adapters;
                cx.notify();
            })
            .ok();
        });
        let mut view = Self {
            project_root,
            focus_handle: cx.focus_handle(),
            store,
            active_file: None,
            configs: Vec::new(),
            notice: None,
            selected_config: 0,
            session: None,
            command_session: None,
            session_subscriptions: Vec::new(),
            run_in_terminal: None,
            panel: Panel::Stack,
            expansion: Expansion::default(),
            watches: Vec::new(),
            next_watch: 1,
            watch_input,
            command_input,
            open_menu: None,
            console_input,
            console_scroll: ScrollHandle::new(),
            editing: None,
            variable_edit: None,
            java_start: None,
            installed_adapters: Vec::new(),
            _tasks: vec![adapters_task],
            _subscriptions: subscriptions,
        };
        view.reload_configs(cx);
        view
    }

    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn session(&self) -> Option<&Entity<DebugSession>> {
        self.session.as_ref()
    }

    /// The file open in the editor: `${file}` in launch.json, and the configuration Athas offers
    /// for it.
    pub fn set_active_file(&mut self, path: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.active_file != path {
            self.active_file = path;
            self.reload_configs(cx);
        }
    }

    /// Starts `runInTerminal` debuggees in the host's terminal instead of in the console.
    pub fn set_run_in_terminal(&mut self, handler: Option<RunInTerminalHandler>) {
        self.run_in_terminal = handler;
    }

    /// Reads `.vscode/launch.json` again and refreshes the detected configurations, keeping the
    /// selected one when it still exists.
    pub fn reload_configs(&mut self, cx: &mut Context<Self>) {
        let selected_name = self.configs.get(self.selected_config).map(|config| config.name.clone());
        let mut configs = match dap::load_workspace_configs(&self.project_root) {
            Ok(configs) => {
                self.notice = None;
                configs
            }
            Err(error) => {
                self.notice = Some(format!("{error:#}"));
                Vec::new()
            }
        };
        // As `getDebugConfigs`: the file's own configuration leads, or the custom command when the
        // file has none.
        let generated = dap::generated_configs(&self.project_root, self.active_file.as_deref());
        let file_configs = match self.active_file {
            Some(_) => generated.len().saturating_sub(dap::generated_configs(&self.project_root, None).len()),
            None => 0,
        };
        if file_configs == 0 {
            configs.insert(0, custom_config());
        }
        configs.extend(generated);
        self.selected_config = selected_name.and_then(|name| configs.iter().position(|config| config.name == name)).unwrap_or(0);
        self.configs = configs;
        cx.notify();
    }

    pub fn selected_config(&self) -> Option<&LaunchConfig> {
        self.configs.get(self.selected_config)
    }

    /// The picker over the launch configurations; picking one selects it, as the original's
    /// searchable Configuration select.
    pub fn config_picker(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<Picker<LaunchConfigDelegate>> {
        self.reload_configs(cx);
        let view = cx.weak_entity();
        let delegate = LaunchConfigDelegate::new(self.configs.clone(), self.selected_config, move |index, window, cx| {
            view.update(cx, |view, cx| {
                view.select_config(index, window, cx);
            })
            .ok();
        });
        cx.new(|cx| Picker::new(delegate, window, cx))
    }

    pub(crate) fn select_config(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.selected_config = index.min(self.configs.len().saturating_sub(1));
        if self.is_custom_selected() {
            self.command_input.update(cx, |input, cx| input.focus(window, cx));
        }
        cx.notify();
    }

    pub(crate) fn is_custom_selected(&self) -> bool {
        self.selected_config().is_some_and(|config| config.kind == CUSTOM_CONFIG_KIND)
    }

    /// What the selected configuration starts: the adapter command or a description of the launch.
    pub(crate) fn command_preview(&self) -> Option<String> {
        let config = self.selected_config()?;
        match config.adapter_command() {
            Some((command, args)) => Some(std::iter::once(command).chain(args).collect::<Vec<_>>().join(" ")),
            None => Some(config.description()),
        }
    }

    pub(crate) fn show_picker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let picker = self.config_picker(window, cx);
        cx.emit(DebuggerViewEvent::ShowPicker(picker));
    }

    fn select_configuration(&mut self, _: &SelectConfiguration, window: &mut Window, cx: &mut Context<Self>) {
        self.show_picker(window, cx);
    }

    // Controls.

    pub(crate) fn status(&self, cx: &App) -> Option<SessionStatus> {
        self.session.as_ref().map(|session| session.read(cx).status())
    }

    /// F5: continues a paused session, else starts the selected configuration.
    pub fn start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.status(cx) {
            Some(SessionStatus::Stopped) => self.update_session(cx, |session, cx| session.resume(cx)),
            Some(SessionStatus::Running | SessionStatus::Starting) => {}
            Some(SessionStatus::Ended) | None => self.start_new(window, cx),
        }
    }

    fn start_new(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        let Some(config) = self.configs.get(self.selected_config).cloned() else {
            self.show_message("Add .vscode/launch.json or open a source file to debug.", cx);
            return;
        };
        if config.kind == CUSTOM_CONFIG_KIND {
            self.start_custom_command(cx);
            return;
        }
        if let Some(session) = self.session.take() {
            session.update(cx, |session, cx| session.stop(cx));
        }
        let mut substitutions = Substitutions::new(self.project_root.clone());
        substitutions.file = self.active_file.clone();
        let config = substitutions.apply_config(&config);
        let cwd = config.cwd().map(PathBuf::from).filter(|cwd| cwd.is_dir()).unwrap_or_else(|| self.project_root.clone());
        if config.kind == "java" {
            self.start_java(config, cwd, cx);
            return;
        }
        self.start_with_adapter(config, cwd, None, cx);
    }

    /// The custom configuration: the typed command runs in the host's terminal and is the session
    /// until it is stopped.
    fn start_custom_command(&mut self, cx: &mut Context<Self>) {
        let command = self.command_input.read(cx).text().trim().to_string();
        if command.is_empty() {
            self.show_message("Enter a command to run.", cx);
            return;
        }
        let Some(handler) = self.run_in_terminal.clone() else {
            self.show_message("No terminal is available to run the command.", cx);
            return;
        };
        let args = if cfg!(windows) { vec!["cmd".into(), "/C".into(), command.clone()] } else { vec!["/bin/sh".into(), "-c".into(), command.clone()] };
        let request = dap::RunInTerminal { title: Some(CUSTOM_CONFIG_NAME.into()), cwd: Some(self.project_root.clone()), args, env: Vec::new() };
        match handler(request, cx) {
            Ok(_) => {
                self.notice = None;
                self.start_command_session(CUSTOM_CONFIG_NAME, command, cx);
            }
            Err(error) => self.show_message(&format!("{error:#}"), cx),
        }
    }

    fn start_with_adapter(&mut self, config: LaunchConfig, cwd: PathBuf, adapter: Option<dap::Adapter>, cx: &mut Context<Self>) {
        let store = self.store.clone();
        let handler = self.run_in_terminal.clone();
        let session = cx.new(|cx| {
            let mut session = DebugSession::new(config, cwd, adapter, store, cx);
            session.set_run_in_terminal(handler);
            session
        });
        self.attach_session(session, cx);
    }

    /// Java goes through jdtls, which resolves the launch and starts java-debug.
    fn start_java(&mut self, config: LaunchConfig, cwd: PathBuf, cx: &mut Context<Self>) {
        let Some(file) = java::java_file(self.active_file.as_ref()) else {
            self.show_message("Open a Java file to debug it.", cx);
            return;
        };
        let Some(lsp) = lsp_client::LspStore::try_global(cx) else {
            self.show_message("The Java language server is not running.", cx);
            return;
        };
        self.notice = None;
        self.java_start = Some(cx.spawn(async move |this, cx| {
            let started = async {
                let config = java::resolve_launch(&lsp, &file, config, cx).await?;
                let adapter = java::start_adapter(&lsp, &file, cx).await?;
                anyhow::Ok((config, adapter))
            }
            .await;
            this.update(cx, |this, cx| {
                this.java_start = None;
                match started {
                    Ok((config, adapter)) => this.start_with_adapter(config, cwd, Some(adapter), cx),
                    Err(error) => this.show_message(&format!("{error:#}"), cx),
                }
            })
            .ok();
        }));
        cx.notify();
    }

    pub(crate) fn is_starting_java(&self) -> bool {
        self.java_start.is_some()
    }

    /// `redefineClasses`: java-debug reloads the classes changed since the last build.
    pub(crate) fn apply_java_changes(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else { return };
        let request = session.update(cx, |session, cx| session.custom_request("redefineClasses", serde_json::json!({}), cx));
        cx.spawn(async move |this, cx| {
            let result = request.await;
            this.update(cx, |this, cx| {
                let message = match result {
                    Ok(body) => {
                        let count = body.get("changedClasses").and_then(serde_json::Value::as_array).map_or(0, Vec::len);
                        match count {
                            0 => "No changed Java classes were available to reload.".to_string(),
                            1 => "Reloaded 1 Java class.".to_string(),
                            count => format!("Reloaded {count} Java classes."),
                        }
                    }
                    Err(error) => format!("{error:#}"),
                };
                this.show_message(&message, cx);
            })
            .ok();
        })
        .detach();
    }

    /// Records a debug command started in a terminal as the session (`startSession` of a
    /// command-only session), replacing an ended adapter session.
    pub fn start_command_session(&mut self, name: impl Into<String>, command: impl Into<String>, cx: &mut Context<Self>) {
        if self.session.as_ref().is_some_and(|session| session.read(cx).status() == SessionStatus::Ended) {
            self.session = None;
            self.session_subscriptions.clear();
        }
        self.command_session = Some(CommandSession { name: name.into(), command: command.into() });
        cx.notify();
    }

    pub fn command_session(&self) -> Option<&CommandSession> {
        self.command_session.as_ref()
    }

    /// Shows a session started elsewhere, such as one on a scripted adapter in a test.
    pub fn attach_session(&mut self, session: Entity<DebugSession>, cx: &mut Context<Self>) {
        self.command_session = None;
        self.session_subscriptions = vec![
            cx.observe(&session, |this, _, cx| {
                this.load_open_rows(cx);
                cx.notify();
            }),
            cx.subscribe(&session, |this, _, event: &SessionEvent, cx| match event {
                SessionEvent::Stopped { position } => {
                    this.evaluate_watches(cx);
                    if let Some(position) = position {
                        cx.emit(DebuggerViewEvent::OpenLocation { path: position.path.clone(), line: position.row + 1 });
                    }
                }
                SessionEvent::Output => this.console_scroll.scroll_to_bottom(),
                SessionEvent::StatusChanged | SessionEvent::Ended => {
                    if this.status(cx) != Some(SessionStatus::Stopped) {
                        for watch in &mut this.watches {
                            watch.result = None;
                        }
                    }
                }
            }),
        ];
        self.session = Some(session);
        cx.notify();
    }

    fn update_session(&mut self, cx: &mut Context<Self>, update: impl FnOnce(&mut DebugSession, &mut Context<DebugSession>)) {
        if let Some(session) = self.session.clone() {
            session.update(cx, update);
        }
    }

    pub fn stop(&mut self, cx: &mut Context<Self>) {
        if self.command_session.take().is_some() {
            cx.notify();
            return;
        }
        self.update_session(cx, |session, cx| session.stop(cx));
    }

    /// Restarts in place when the adapter can, else stops and starts the same configuration.
    pub fn restart(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let restarted = self.session.as_ref().is_some_and(|session| session.update(cx, |session, cx| session.restart_in_place(cx)));
        if !restarted {
            self.start_new(window, cx);
        }
    }

    pub fn pause(&mut self, cx: &mut Context<Self>) {
        self.update_session(cx, |session, cx| session.pause(cx));
    }

    pub fn step_over(&mut self, cx: &mut Context<Self>) {
        self.update_session(cx, |session, cx| session.step_over(cx));
    }

    pub fn step_into(&mut self, cx: &mut Context<Self>) {
        self.update_session(cx, |session, cx| session.step_in(cx));
    }

    pub fn step_out(&mut self, cx: &mut Context<Self>) {
        self.update_session(cx, |session, cx| session.step_out(cx));
    }

    fn on_start(&mut self, _: &Start, window: &mut Window, cx: &mut Context<Self>) {
        self.start(window, cx);
    }

    fn on_stop(&mut self, _: &Stop, _: &mut Window, cx: &mut Context<Self>) {
        self.stop(cx);
    }

    fn on_restart(&mut self, _: &Restart, window: &mut Window, cx: &mut Context<Self>) {
        self.restart(window, cx);
    }

    fn on_pause(&mut self, _: &Pause, _: &mut Window, cx: &mut Context<Self>) {
        self.pause(cx);
    }

    fn on_step_over(&mut self, _: &StepOver, _: &mut Window, cx: &mut Context<Self>) {
        self.step_over(cx);
    }

    fn on_step_into(&mut self, _: &StepInto, _: &mut Window, cx: &mut Context<Self>) {
        self.step_into(cx);
    }

    fn on_step_out(&mut self, _: &StepOut, _: &mut Window, cx: &mut Context<Self>) {
        self.step_out(cx);
    }

    fn show_message(&mut self, message: &str, cx: &mut Context<Self>) {
        self.notice = Some(message.to_string());
        cx.notify();
    }

    // The panes.

    pub fn panel(&self) -> Panel {
        self.panel
    }

    pub fn set_panel(&mut self, panel: Panel, cx: &mut Context<Self>) {
        self.panel = panel;
        cx.notify();
    }

    pub(crate) fn select_frame(&mut self, frame: i64, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else { return };
        let location = session.update(cx, |session, cx| {
            session.select_frame(frame, cx);
            let frame = session.frames().iter().find(|candidate| candidate.id == frame)?;
            Some((frame.path()?, frame.line.max(1)))
        });
        self.evaluate_watches(cx);
        if let Some((path, line)) = location {
            cx.emit(DebuggerViewEvent::OpenLocation { path, line });
        }
    }

    pub(crate) fn select_thread(&mut self, thread: i64, cx: &mut Context<Self>) {
        self.update_session(cx, |session, cx| session.select_thread(thread, cx));
    }

    pub(crate) fn toggle_row(&mut self, key: String, expanded: bool, reference: i64, cx: &mut Context<Self>) {
        self.expansion.set(key, expanded);
        if expanded {
            self.update_session(cx, |session, cx| session.load_variables(reference, cx));
        }
        cx.notify();
    }

    /// Asks for the children of open rows that a new stop left without them.
    fn load_open_rows(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else { return };
        let mut missing = Vec::new();
        {
            let session = session.read(cx);
            tree::scope_rows(session, &self.expansion, &mut missing);
            for watch in &self.watches {
                if let Some(Ok(result)) = &watch.result {
                    let key = format!("watch/{}", watch.id);
                    if self.expansion.is_expanded(&key, false) {
                        tree::push_children(session, result.variables_reference, &key, 1, &self.expansion, &mut Vec::new(), &mut missing);
                    }
                }
            }
        }
        if !missing.is_empty() {
            session.update(cx, |session, cx| {
                for reference in missing {
                    session.load_variables(reference, cx);
                }
            });
        }
    }

    pub(crate) fn open_location(&mut self, path: PathBuf, line: u32, cx: &mut Context<Self>) {
        cx.emit(DebuggerViewEvent::OpenLocation { path, line });
    }

    // Watches.

    pub fn add_watch(&mut self, expression: String, cx: &mut Context<Self>) {
        let expression = expression.trim().to_string();
        if expression.is_empty() {
            return;
        }
        self.watches.push(Watch { id: self.next_watch, expression, result: None });
        self.next_watch += 1;
        self.evaluate_watches(cx);
        cx.notify();
    }

    pub(crate) fn remove_watch(&mut self, id: u64, cx: &mut Context<Self>) {
        self.watches.retain(|watch| watch.id != id);
        cx.notify();
    }

    pub(crate) fn evaluate_watches(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else { return };
        if session.read(cx).status() != SessionStatus::Stopped {
            return;
        }
        for watch in &self.watches {
            let id = watch.id;
            let evaluation = session.update(cx, |session, cx| session.evaluate(&watch.expression, "watch", cx));
            cx.spawn(async move |this, cx| {
                let result = evaluation.await.map_err(|error| error.to_string());
                this.update(cx, |this, cx| {
                    if let Some(watch) = this.watches.iter_mut().find(|watch| watch.id == id) {
                        watch.result = Some(result);
                        cx.notify();
                    }
                })
                .ok();
            })
            .detach();
        }
    }

    // The console.

    pub fn evaluate_in_console(&mut self, expression: &str, cx: &mut Context<Self>) {
        self.update_session(cx, |session, cx| session.evaluate_in_console(expression, cx));
        self.console_scroll.scroll_to_bottom();
    }

    pub(crate) fn clear_console(&mut self, cx: &mut Context<Self>) {
        self.update_session(cx, |session, cx| session.clear_output(cx));
    }

    // Breakpoints.

    pub(crate) fn edit_breakpoint(&mut self, id: BreakpointId, field: BreakpointField, window: &mut Window, cx: &mut Context<Self>) {
        let current = self.store.read(cx).find(id).and_then(|(_, breakpoint)| match field {
            BreakpointField::Condition => breakpoint.condition.clone(),
            BreakpointField::HitCondition => breakpoint.hit_condition.clone(),
            BreakpointField::LogMessage => breakpoint.log_message.clone(),
        });
        let placeholder = match field {
            BreakpointField::Condition => "Break when this is true",
            BreakpointField::HitCondition => "Break after this many hits, such as >= 3",
            BreakpointField::LogMessage => "Log this, with {expressions}, instead of breaking",
        };
        let input = cx.new(|cx| TextInput::new(window, cx).placeholder(placeholder).appearance(InputAppearance::Bare));
        input.update(cx, |input, cx| {
            input.set_text(current.unwrap_or_default(), cx);
            input.select_all_text(cx);
            input.focus(window, cx);
        });
        let subscription = cx.subscribe_in(&input, window, move |this, input, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => {
                let text = input.read(cx).text().to_string();
                this.store.update(cx, |store, cx| store.set_field(id, field, Some(text), cx));
                this.editing = None;
                window.focus(&this.focus_handle, cx);
                cx.notify();
            }
            TextInputEvent::Cancelled | TextInputEvent::Blurred => {
                this.editing = None;
                cx.notify();
            }
            _ => {}
        });
        self.editing = Some(BreakpointEdit { id, field, input, _subscription: subscription });
        cx.notify();
    }

    // Variables.

    pub(crate) fn can_set_variables(&self, cx: &App) -> bool {
        self.session.as_ref().is_some_and(|session| {
            let session = session.read(cx);
            session.status() == SessionStatus::Stopped && session.capabilities().supports_set_variable
        })
    }

    /// Edits a variable's value in place; Enter sends `setVariable`.
    pub(crate) fn edit_variable(&mut self, key: String, parent: i64, name: String, value: String, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| TextInput::new(window, cx).appearance(InputAppearance::Bare));
        input.update(cx, |input, cx| {
            input.set_text(value, cx);
            input.select_all_text(cx);
            input.focus(window, cx);
        });
        let subscription = cx.subscribe_in(&input, window, move |this, input, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => {
                let value = input.read(cx).text().to_string();
                this.variable_edit = None;
                window.focus(&this.focus_handle, cx);
                if let Some(session) = this.session.clone() {
                    let request = session.update(cx, |session, cx| session.set_variable(parent, &name, &value, cx));
                    let name = name.clone();
                    cx.spawn(async move |this, cx| {
                        let result = request.await;
                        this.update(cx, |this, cx| match result {
                            Ok(()) => this.evaluate_watches(cx),
                            Err(error) => this.show_message(&format!("Couldn't set {name}: {error:#}"), cx),
                        })
                        .ok();
                    })
                    .detach();
                }
                cx.notify();
            }
            TextInputEvent::Cancelled | TextInputEvent::Blurred => {
                this.variable_edit = None;
                cx.notify();
            }
            _ => {}
        });
        self.variable_edit = Some(VariableEdit { key, input, _subscription: subscription });
        cx.notify();
    }

    /// `debug.toggleBreakpoint` on the editor's cursor line.
    pub(crate) fn toggle_breakpoint_at_cursor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let action = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action("debug.toggleBreakpoint"));
        if let Some(action) = action {
            window.dispatch_action(action, cx);
        }
    }

    pub(crate) fn set_exception_filter(&mut self, filter: String, enabled: bool, cx: &mut Context<Self>) {
        self.update_session(cx, |session, cx| session.set_exception_filter(&filter, enabled, cx));
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use dap::{SessionStatus, testing::FakeAdapter};
    use gpui::{TestAppContext, VisualTestContext};

    use super::*;

    fn wait_until(cx: &mut VisualTestContext, what: &str, mut done: impl FnMut(&mut VisualTestContext) -> bool) {
        for _ in 0..400 {
            cx.run_until_parked();
            if done(cx) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("timed out waiting for {what}");
    }

    #[gpui::test]
    fn command_sessions_show_until_stopped(cx: &mut TestAppContext) {
        let root = std::env::temp_dir().join("athas-debugger-ui-command-test");
        std::fs::create_dir_all(&root).unwrap();
        cx.update(|cx| {
            theme::init(cx, None, theme::Appearance::Dark, false);
            ui::init(cx);
            BreakpointStore::set_global(cx.new(|_| BreakpointStore::new(None)), cx);
        });
        let (view, cx) = cx.add_window_view(|window, cx| DebuggerView::new(root.clone(), window, cx));
        view.update(cx, |view, cx| view.start_command_session("Debug: api", "docker exec -it abc python -m pdb app.py", cx));
        view.read_with(cx, |view, _| {
            assert_eq!(view.command_session().map(|session| session.name.as_str()), Some("Debug: api"));
        });
        view.update(cx, |view, cx| view.stop(cx));
        view.read_with(cx, |view, _| assert!(view.command_session().is_none()));
    }

    #[gpui::test]
    fn custom_command_leads_without_a_file(cx: &mut TestAppContext) {
        let root = std::env::temp_dir().join("athas-debugger-ui-custom-test");
        std::fs::create_dir_all(&root).unwrap();
        cx.update(|cx| {
            theme::init(cx, None, theme::Appearance::Dark, false);
            ui::init(cx);
            BreakpointStore::set_global(cx.new(|_| BreakpointStore::new(None)), cx);
        });
        let (view, cx) = cx.add_window_view(|window, cx| DebuggerView::new(root.clone(), window, cx));
        view.read_with(cx, |view, _| {
            assert_eq!(view.configs[0].name, CUSTOM_CONFIG_NAME);
            assert!(view.is_custom_selected());
            assert_eq!(view.panel(), Panel::Stack);
        });
        view.update_in(cx, |view, window, cx| view.start(window, cx));
        view.read_with(cx, |view, _| assert_eq!(view.notice.as_deref(), Some("Enter a command to run.")));
        let ran = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let record = ran.clone();
        view.update_in(cx, |view, window, cx| {
            view.set_run_in_terminal(Some(std::rc::Rc::new(move |request: dap::RunInTerminal, _: &mut App| {
                record.borrow_mut().push(request.args.join(" "));
                Ok(None)
            })));
            view.command_input.update(cx, |input, cx| input.set_text("make debug", cx));
            view.start(window, cx);
        });
        assert!(ran.borrow()[0].ends_with("make debug"));
        view.read_with(cx, |view, _| assert_eq!(view.command_session().map(|session| session.command.as_str()), Some("make debug")));
    }

    #[gpui::test]
    fn view_follows_a_session(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        let root = std::env::temp_dir().join("athas-debugger-ui-test");
        std::fs::create_dir_all(root.join(".vscode")).unwrap();
        std::fs::write(
            root.join(".vscode/launch.json"),
            r#"{ "configurations": [ { "name": "Run app", "type": "debugpy", "request": "launch", "program": "${workspaceFolder}/app.py" }, ] }"#,
        )
        .unwrap();
        let source = root.join("app.py");
        cx.update(|cx| {
            theme::init(cx, None, theme::Appearance::Dark, false);
            ui::init(cx);
            BreakpointStore::set_global(cx.new(|_| BreakpointStore::new(None)), cx);
        });
        let (view, cx) = cx.add_window_view(|window, cx| DebuggerView::new(root.clone(), window, cx));
        // As `getDebugConfigs`: the custom command leads while no file is open, then launch.json.
        view.read_with(cx, |view, _| {
            assert_eq!(view.configs[0].name, CUSTOM_CONFIG_NAME);
            assert_eq!(view.configs[1].name, "Run app");
        });

        let opened = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let record = opened.clone();
        cx.update(|_, cx| {
            cx.subscribe(&view, move |_, event: &DebuggerViewEvent, _| {
                if let DebuggerViewEvent::OpenLocation { path, line } = event {
                    record.borrow_mut().push((path.clone(), *line));
                }
            })
            .detach();
        });

        let fake = FakeAdapter::start(source.clone());
        view.update(cx, |view, cx| {
            view.store.update(cx, |store, cx| {
                store.toggle(&source, 6, cx);
            });
            view.add_watch("count * 2".into(), cx);
            let store = view.store.clone();
            let config = view.configs[1].clone();
            let session = cx.new(|cx| DebugSession::new(config, root.clone(), Some(fake.adapter()), store, cx));
            view.attach_session(session, cx);
        });
        wait_until(cx, "the watch", |cx| view.read_with(cx, |view, _| matches!(view.watches[0].result, Some(Ok(_)))));
        view.read_with(cx, |view, cx| {
            assert_eq!(view.status(cx), Some(SessionStatus::Stopped));
            assert_eq!(view.watches[0].result.as_ref().unwrap().as_ref().unwrap().result, "6");
        });
        assert_eq!(opened.borrow().first(), Some(&(source.clone(), 7)));

        // Opening `user` asks for its children; they stay open across a step.
        view.update(cx, |view, cx| view.toggle_row("scope/Locals/user".into(), true, 101, cx));
        wait_until(cx, "children", |cx| {
            view.read_with(cx, |view, cx| {
                let session = view.session.as_ref().unwrap().read(cx);
                tree::scope_rows(session, &view.expansion, &mut Vec::new()).iter().any(|row| row.name == "'age'")
            })
        });
        view.update(cx, |view, cx| view.step_over(cx));
        wait_until(cx, "the step", |cx| {
            view.read_with(cx, |view, cx| {
                let session = view.session.as_ref().unwrap().read(cx);
                session.frames().first().is_some_and(|frame| frame.line == 8)
                    && tree::scope_rows(session, &view.expansion, &mut Vec::new()).iter().any(|row| row.name == "'age'")
            })
        });

        view.update(cx, |view, cx| view.stop(cx));
        wait_until(cx, "the end", |cx| view.read_with(cx, |view, cx| view.status(cx) == Some(SessionStatus::Ended)));
    }
}
