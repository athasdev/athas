//! Carries out what the `athas` command, a second launch or a link asked for.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::Instant,
};

use cli::CliRequest;
use gpui::{App, Entity};
use workbench::Workbench;
use workspace::TabItem;

use crate::{OpenEvent, PlatformState, deep_link::DeepLink, waits};

pub(crate) fn handle(event: OpenEvent, cx: &mut App) {
    match event {
        OpenEvent::Requests(requests) => {
            for request in requests {
                open_request(request, cx);
            }
        }
        OpenEvent::Urls(urls) => {
            for url in urls {
                match crate::deep_link::parse(&url) {
                    Some(link) => open_link(link, cx),
                    None => match crate::deep_link::file_path(&url) {
                        Some(path) => {
                            notifications::error(cx, format!("{} does not exist", path.display()), None);
                        }
                        None => eprintln!("athas: ignoring the link {url}"),
                    },
                }
            }
        }
    }
    bring_forward(cx);
}

fn workbench(cx: &mut App) -> Option<Entity<Workbench>> {
    let handle = crate::target_window(cx)?;
    handle.update(cx, |_, _, cx| cx.entity()).ok()
}

fn bring_forward(cx: &mut App) {
    if let Some(handle) = crate::target_window(cx) {
        handle.update(cx, |_, window, _| window.activate_window()).ok();
    }
    cx.activate(true);
}

fn open_request(request: CliRequest, cx: &mut App) {
    open_request_from(request, false, cx)
}

/// A request for a new window (`athas -n`, `athas window`) opens one and does the rest there.
fn open_in_new_window(request: CliRequest, from_link: bool, cx: &mut App) {
    let state = workbench(cx).map(|entity| entity.read(cx).state().recent_projects.clone()).unwrap_or_default();
    let mut request_state = workspace::WorkspaceState::default();
    request_state.recent_projects = state;
    let opened = crate::windows::open_new(workbench::NewWindowRequest { state: request_state, as_tab: false, setup: None }, cx);
    if opened.is_some() && !matches!(request, CliRequest::Empty) {
        open_request_from(request, from_link, cx);
    }
}

/// `from_link`: a terminal command from a link waits for the user to agree.
fn open_request_from(request: CliRequest, from_link: bool, cx: &mut App) {
    match request {
        CliRequest::NewWindow { request } => open_in_new_window(*request, from_link, cx),
        CliRequest::Empty => {}
        CliRequest::Path { path, is_directory: true, .. } => open_folder(Path::new(&path), cx),
        CliRequest::Path { path, line, column, wait_marker, .. } => {
            open_file(Path::new(&path), line, column, cx);
            if let Some(marker) = wait_marker {
                track_wait(&marker, &path, cx);
            }
        }
        CliRequest::Web { url } => {
            if url.starts_with("https://") || url.starts_with("http://") {
                cx.open_url(&url);
            } else {
                notifications::error(cx, format!("Athas only opens web pages, not {url}"), None);
            }
        }
        CliRequest::Surface { name, working_directory, resource_id } => {
            open_surface(&name, Path::new(&working_directory), resource_id, cx);
        }
        CliRequest::Terminal { command, working_directory } => {
            let Some(handle) = crate::target_window(cx) else { return };
            let cwd = working_directory.map(PathBuf::from);
            handle.update(cx, |workbench, window, cx| workbench.open_terminal(command, cwd, from_link, window, cx)).ok();
        }
        CliRequest::Remote { connection_id, name } => {
            let Some(handle) = crate::target_window(cx) else { return };
            handle
                .update(cx, |workbench, window, cx| workbench.open_remote_connection(&connection_id, name.as_deref(), window, cx))
                .ok();
        }
    }
}

fn open_link(link: DeepLink, cx: &mut App) {
    match link {
        DeepLink::Open(CliRequest::Path { path, line, column, .. }) => {
            let path = PathBuf::from(path);
            if !path.is_absolute() || !path.exists() {
                notifications::error(cx, format!("{} does not exist", path.display()), None);
                return;
            }
            if path.is_dir() {
                open_folder(&path, cx);
            } else {
                open_file(&path, line, column, cx);
            }
        }
        DeepLink::Open(request) => open_request_from(request, true, cx),
        DeepLink::Settings { .. } => open_settings(cx),
        DeepLink::Extensions { .. } => workbench_api::open_resource(cx, "extensions", "", "Extensions"),
        // The extension's page has the Install button, so a link never installs on its own.
        DeepLink::InstallExtension { id } => workbench_api::open_resource(cx, "extensions", &id, &id),
        // The server editor opens filled in; nothing is saved until the user does.
        DeepLink::InstallMcp { url } => agent_ui::mcp_install_link::open(&url, cx),
    }
}

fn open_settings(cx: &mut App) {
    if let Some(handle) = crate::target_window(cx) {
        handle.update(cx, |_, window, cx| window.dispatch_action(Box::new(workbench::OpenSettings), cx)).ok();
    }
}

fn open_surface(name: &str, working_directory: &Path, resource_id: Option<u64>, cx: &mut App) {
    let (kind, title) = match (name, resource_id) {
        ("settings", _) => return open_settings(cx),
        ("extensions", _) => return workbench_api::open_resource(cx, "extensions", "", "Extensions"),
        ("pr", Some(id)) => ("github-pr", format!("#{id}")),
        ("issue", Some(id)) => ("github-issue", format!("#{id}")),
        ("action", Some(id)) => ("github-run", format!("Run {id}")),
        _ => return,
    };
    // GitHub views read the repository of the project in front.
    open_folder(working_directory, cx);
    let id = resource_id.map(|id| id.to_string()).unwrap_or_default();
    workbench_api::open_resource(cx, kind, &id, &title);
}

fn open_folder(path: &Path, cx: &mut App) {
    let Some(handle) = crate::target_window(cx) else { return };
    let path_buf = path.to_path_buf();
    handle.update(cx, |workbench, _, cx| workbench.open_project_path(path_buf, cx)).ok();
    crate::note_recent(path, cx);
}

/// Opens a file in the project that holds it. Without one and with no project open, its folder
/// becomes the project, since the workbench shows files inside projects.
fn open_file(path: &Path, line: Option<u32>, column: Option<u32>, cx: &mut App) {
    if let Some(entity) = workbench(cx) {
        let state = entity.read(cx).state();
        let holder = state
            .projects
            .iter()
            .filter(|project| path.starts_with(&project.path))
            .max_by_key(|project| project.path.len())
            .map(|project| (project.path.clone(), Some(&project.id) == state.active_project.as_ref()));
        let has_active = state.active_project.is_some();
        match holder {
            Some((project, false)) => open_folder(Path::new(&project), cx),
            None if !has_active => {
                if let Some(parent) = path.parent() {
                    open_folder(parent, cx);
                }
            }
            _ => {}
        }
    }
    workbench_api::request(cx, workbench_api::OpenRequest::File { path: path.to_path_buf(), line, column });
    crate::note_recent(path, cx);
}

fn track_wait(marker: &str, path: &str, cx: &mut App) {
    if cx.has_global::<PlatformState>() {
        cx.global_mut::<PlatformState>().waits.track(marker, path, Instant::now());
    }
    // A file that never opens still lets the command return after the grace period.
    cx.spawn(async move |cx| {
        cx.background_executor().timer(waits::OPEN_GRACE + std::time::Duration::from_millis(500)).await;
        cx.update(check_waits);
    })
    .detach();
}

/// Releases the markers of files that were opened and closed again; runs when the workbench changes.
pub(crate) fn check_waits(cx: &mut App) {
    if cx.try_global::<PlatformState>().is_none_or(|state| state.waits.is_empty()) {
        return;
    }
    let open: HashSet<String> = crate::workbenches(cx)
        .iter()
        .flat_map(|entity| {
            entity
                .read(cx)
                .state()
                .all_group_tabs()
                .filter_map(|(_, tab)| match tab {
                    TabItem::File { path } => Some(path.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let finished = cx.global_mut::<PlatformState>().waits.update(&open, Instant::now());
    release(finished);
}

pub(crate) fn release(markers: Vec<String>) {
    for marker in markers {
        if let Err(error) = cli::wait::release_marker(&marker) {
            eprintln!("athas: could not release the wait marker {marker}: {error}");
        }
    }
}
