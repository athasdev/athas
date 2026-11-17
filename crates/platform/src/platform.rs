//! The desktop around the workbench: one running Athas per user (later launches and the `athas`
//! command hand their requests over a local socket), `athas://` links, the window's size and place
//! across launches, recent documents, the shell command, and update checks.
//!
//! `main` calls [`startup`] before GPUI starts, [`Primary::listen_for_urls`] on the application,
//! [`init`] with the other crates, and [`Primary::start`], which opens the windows.

mod accessibility;
pub mod deep_link;
mod dispatch;
#[cfg(target_os = "macos")]
mod services;
#[cfg(target_os = "macos")]
mod spotlight;
pub mod tauri_import;
pub mod updater;
pub mod waits;
pub mod window_state;
pub mod windows;

use std::collections::HashSet;

use cli::{
    CliRequest,
    protocol::{self, Message, Reply},
    transport::{self, Bound},
};
use futures::{
    StreamExt,
    channel::mpsc::{UnboundedReceiver, UnboundedSender, unbounded},
};
use gpui::{App, Application, Entity, Global, Task, WindowHandle, actions};
use workbench::Workbench;

pub use cli::install::{CliInstallState, Installed, ShellPathSetup};

actions!(
    platform,
    [
        /// Installs the `athas` command in `~/.local/bin`.
        InstallCliCommand,
        /// Removes the `athas` command Athas installed.
        UninstallCliCommand,
        CheckForUpdates,
        /// Downloads the update a check found; nothing is installed.
        DownloadUpdate,
        /// Hides the offered update from background checks for a day.
        DownloadUpdateLater,
        /// Hides the offered update until a newer version ships.
        SkipUpdateVersion,
        ViewReleaseNotes,
        /// Opens the end of Athas's log at its last error.
        OpenAthasLog,
    ]
);

/// Something to open, from the socket, the app's own arguments, or the OS.
pub enum OpenEvent {
    Requests(Vec<CliRequest>),
    /// `athas://` and `file://` URLs.
    Urls(Vec<String>),
}

pub enum Startup {
    /// Another Athas is running and took this launch's arguments; this process should exit.
    HandedOver,
    Primary(Primary),
}

/// The first Athas: it receives requests from later launches and the `athas` command.
pub struct Primary {
    sender: UnboundedSender<OpenEvent>,
    receiver: UnboundedReceiver<OpenEvent>,
}

/// Reads this launch's arguments and claims the socket. When another Athas answers on it, the
/// arguments go to that one instead.
pub fn startup(argv: &[String]) -> Startup {
    let cwd = std::env::current_dir().unwrap_or_else(|_| "/".into());
    let requests = match cli::parse_cli_argv(argv, &cwd) {
        Some(parsed) => parsed.requests,
        None => {
            eprintln!("athas: ignoring unknown arguments {:?}", argv.get(1..).unwrap_or_default());
            Vec::new()
        }
    };
    let (sender, receiver) = unbounded();
    if let Some(socket) = transport::socket_path() {
        match transport::bind(&socket) {
            Ok(Bound::Listening(listener)) => serve(listener, sender.clone()),
            Ok(Bound::AlreadyRunning) => {
                match protocol::send(&socket, &Message::Open { requests: requests.clone() }) {
                    Ok(Reply::Ok) => return Startup::HandedOver,
                    Ok(Reply::Error { message }) => {
                        eprintln!("athas: the running Athas refused the request: {message}");
                        return Startup::HandedOver;
                    }
                    Err(error) => eprintln!("athas: could not reach the running Athas, starting another: {error}"),
                }
            }
            Err(error) => eprintln!("athas: could not listen on {}: {error}", socket.display()),
        }
    }
    if !requests.is_empty() {
        sender.unbounded_send(OpenEvent::Requests(requests)).ok();
    }
    Startup::Primary(Primary { sender, receiver })
}

/// Answers clients on a thread of its own and passes their requests to the app.
fn serve(listener: transport::Listener, sender: UnboundedSender<OpenEvent>) {
    let spawned = std::thread::Builder::new().name("athas-open-listener".into()).spawn(move || {
        loop {
            let mut stream = match listener.accept() {
                Ok(stream) => stream,
                Err(error) => {
                    eprintln!("athas: open listener: {error}");
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    continue;
                }
            };
            // Clients that only check whether Athas runs close without a message; that is fine.
            protocol::serve(&mut stream, |message| match message {
                Message::Open { requests } => match sender.unbounded_send(OpenEvent::Requests(requests)) {
                    Ok(()) => Reply::Ok,
                    Err(_) => Reply::Error { message: "Athas is quitting".into() },
                },
                Message::Ping => Reply::Ok,
            })
            .ok();
        }
    });
    if let Err(error) = spawned {
        eprintln!("athas: could not start the open listener: {error}");
    }
}

impl Primary {
    /// Takes the URLs the OS opens Athas with: `athas://` links, and files from Finder or the Dock.
    pub fn listen_for_urls(&self, app: &Application) {
        let sender = self.sender.clone();
        app.on_open_urls(move |urls| {
            sender.unbounded_send(OpenEvent::Urls(urls)).ok();
        });
    }

    /// Opens the windows open at the last quit, then starts handling requests, saving where
    /// windows sit, and checking for updates. Returns false when no window could open.
    pub fn start(self, cx: &mut App) -> bool {
        let set = windows::path().map(|path| windows::load(&path)).unwrap_or_default();
        cx.set_global(PlatformState {
            windows: Vec::new(),
            set,
            save_task: None,
            waits: Default::default(),
            known_projects: HashSet::new(),
        });
        workbench::set_window_opener(cx, |request, cx| {
            windows::open_new(request, cx);
        });
        workbench::set_detached_opener(cx, windows::open_detached);
        if !windows::restore_all(cx) {
            return false;
        }
        cx.on_window_closed(|cx, window| {
            windows::closed(window, cx);
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        cx.on_app_quit(|cx| {
            if cx.has_global::<PlatformState>() {
                dispatch::release(cx.global_mut::<PlatformState>().waits.release_all());
            }
            window_state::flush(cx);
            windows::flush(cx);
            async {}
        })
        .detach();

        #[cfg(target_os = "macos")]
        services::install(self.sender.clone());
        #[cfg(target_os = "macos")]
        spotlight::install(self.sender.clone());
        let mut receiver = self.receiver;
        cx.spawn(async move |cx| {
            while let Some(event) = receiver.next().await {
                cx.update(|cx| dispatch::handle(event, cx));
            }
        })
        .detach();
        updater::start_background_checks(cx);
        true
    }
}

struct PlatformState {
    windows: Vec<windows::OpenWindow>,
    set: windows::WindowSet,
    save_task: Option<Task<()>>,
    waits: waits::Waits,
    known_projects: HashSet<String>,
}

impl Global for PlatformState {}

/// Starts following a window that opened: its size and place, the files `--wait` waits on, and
/// the folders it opens for the recent documents.
pub(crate) fn watch_window(handle: WindowHandle<Workbench>, id: String, cx: &mut App) {
    let Ok(entity) = handle.update(cx, |_, _, cx| cx.entity()) else { return };
    let projects = project_paths(&entity, cx);
    if cx.has_global::<PlatformState>() {
        cx.global_mut::<PlatformState>().known_projects.extend(projects);
    }
    handle
        .update(cx, |_, window, cx| {
            window_state::observe(window, cx);
            cx.observe_window_bounds(window, move |_, window, cx| windows::record_bounds(&id, window, cx)).detach();
        })
        .ok();
    cx.observe(&entity, |entity, cx| {
        dispatch::check_waits(cx);
        remember_new_projects(&entity, cx);
    })
    .detach();
}

/// The workbench window requests go to: the one used last, else the frontmost, else the first.
pub(crate) fn target_window(cx: &App) -> Option<WindowHandle<Workbench>> {
    let state = cx.try_global::<PlatformState>()?;
    let ours = |id: gpui::WindowId| state.windows.iter().find(|open| open.handle.window_id() == id).map(|open| open.handle);
    workbench::front_window(cx)
        .and_then(ours)
        .or_else(|| cx.active_window().and_then(|handle| ours(handle.window_id())))
        .or_else(|| cx.window_stack().and_then(|stack| stack.into_iter().find_map(|handle| ours(handle.window_id()))))
        .or_else(|| state.windows.first().map(|open| open.handle))
}

/// Every open workbench.
pub(crate) fn workbenches(cx: &mut App) -> Vec<Entity<Workbench>> {
    let handles: Vec<WindowHandle<Workbench>> =
        cx.try_global::<PlatformState>().map(|state| state.windows.iter().map(|open| open.handle).collect()).unwrap_or_default();
    handles.into_iter().filter_map(|handle| handle.update(cx, |_, _, cx| cx.entity()).ok()).collect()
}

fn project_paths(workbench: &Entity<Workbench>, cx: &App) -> HashSet<String> {
    workbench.read(cx).state().projects.iter().map(|project| project.path.clone()).collect()
}

/// Adds folders opened in a workbench to the Dock's and File menu's recent documents (macOS).
fn remember_new_projects(workbench: &Entity<Workbench>, cx: &mut App) {
    let projects = project_paths(workbench, cx);
    if !cx.has_global::<PlatformState>() {
        return;
    }
    let state = cx.global_mut::<PlatformState>();
    let added: Vec<String> = projects.difference(&state.known_projects).cloned().collect();
    state.known_projects.extend(added.iter().cloned());
    for path in added {
        note_recent(std::path::Path::new(&path), cx);
    }
}

/// Adds `path` to the OS's recent documents and, on macOS, to Spotlight.
pub(crate) fn note_recent(path: &std::path::Path, cx: &mut App) {
    cx.add_recent_document(path);
    #[cfg(target_os = "macos")]
    {
        let path = path.to_path_buf();
        cx.background_executor().spawn(async move { spotlight::index(&path) }).detach();
    }
}

/// Registers the platform actions and their Athas command ids. Call before `workbench::init`.
pub fn init(cx: &mut App) {
    theme::set_accessibility_reader(cx, accessibility::read);
    if theme::accessibility(cx) != theme::SystemAccessibility::default() {
        workbench::apply_theme(workbench::appearance_of(cx.window_appearance()), cx);
    }
    keymap::register(cx, "cli.installTerminalCommand", InstallCliCommand);
    keymap::register(cx, "cli.uninstallTerminalCommand", UninstallCliCommand);
    keymap::register(cx, "app.checkForUpdates", CheckForUpdates);
    keymap::register(cx, "app.downloadUpdate", DownloadUpdate);
    keymap::register(cx, "app.downloadUpdateLater", DownloadUpdateLater);
    keymap::register(cx, "app.skipUpdateVersion", SkipUpdateVersion);
    keymap::register(cx, "app.viewReleaseNotes", ViewReleaseNotes);
    keymap::register(cx, "developer.openAthasLog", OpenAthasLog);
    cx.on_action(|_: &InstallCliCommand, cx| install_shell_command(cx));
    cx.on_action(|_: &UninstallCliCommand, cx| uninstall_shell_command(cx));
    cx.on_action(|_: &CheckForUpdates, cx| updater::check(true, cx));
    cx.on_action(|_: &DownloadUpdate, cx| updater::download_available(cx));
    cx.on_action(|_: &DownloadUpdateLater, cx| updater::download_later(cx));
    cx.on_action(|_: &SkipUpdateVersion, cx| updater::skip_version(cx));
    cx.on_action(|_: &ViewReleaseNotes, cx| updater::view_release_notes(cx));
    cx.on_action(|_: &OpenAthasLog, cx| open_athas_log(cx));
}

fn open_athas_log(cx: &mut App) {
    match logging::read_latest() {
        Ok(log) => workbench_api::request(
            cx,
            workbench_api::OpenRequest::File { path: log.path, line: Some(log.target_line as u32 + 1), column: None },
        ),
        Err(error) => {
            notifications::error(cx, "Failed to open Athas log", Some(error.into()));
        }
    }
}

/// Whether the `athas` command is installed, for the Settings "Shell Command" row.
pub fn shell_command_state() -> CliInstallState {
    cli::install::state_for_current_user()
}

pub fn install_shell_command(cx: &mut App) {
    match cli::install::install_for_current_user() {
        Ok(installed) => {
            notifications::notify(
                cx,
                notifications::NotificationKind::Success,
                notifications::NotificationCategory::Athas,
                "Installed the athas command",
                Some(installed.message().into()),
                None,
            );
        }
        Err(error) => {
            notifications::error(cx, "Could not install the athas command", Some(error.into()));
        }
    }
}

pub fn uninstall_shell_command(cx: &mut App) {
    match cli::install::uninstall_for_current_user() {
        Ok(()) => {
            notifications::info(cx, "Removed the athas command");
        }
        Err(error) => {
            notifications::error(cx, "Could not remove the athas command", Some(error.into()));
        }
    }
}
