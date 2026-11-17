//! Team presence's view of the workbench: the file or agent session in front and its cursor, and
//! opening a followed teammate's file.

use std::{path::PathBuf, rc::Rc};

use collaboration::{
    live_share::{self, SessionSource, Sources},
    presence::{self, ActiveContext, CollaborationRuntime},
};
use gpui::{App, WeakEntity};
use workspace::TabItem;

use crate::Workbench;

pub(crate) fn init(workbench: WeakEntity<Workbench>, cx: &mut App) {
    CollaborationRuntime::init(cx);
    let reader = workbench.clone();
    presence::set_context_provider(
        cx,
        Rc::new(move |cx| reader.upgrade().map(|workbench| active_context(workbench.read(cx), cx)).unwrap_or_default()),
    );
    let sharer = workbench.clone();
    live_share::start(Rc::new(move |cx| sharer.upgrade().map(|workbench| share_sources(workbench.read(cx), cx)).unwrap_or_default()), cx);
    presence::set_file_opener(
        cx,
        Rc::new(move |path: PathBuf, cx: &mut App| {
            workbench.update(cx, |workbench, cx| workbench.open_file_at(path, None, None, cx)).ok();
        }),
    );
}

fn active_context(workbench: &Workbench, cx: &App) -> ActiveContext {
    let project_root = workbench.state.active_project().filter(|project| !project.is_remote()).map(|project| project.path.clone());
    let session_title = workbench
        .state
        .focused_panes()
        .and_then(|panes| panes.group(panes.active))
        .and_then(|group| group.tabs.active_item())
        .filter(|item| matches!(item, TabItem::Session { .. }))
        .and_then(|_| workbench.state.focused_session())
        .map(|session| session.title.clone());
    let Some(editor) = workbench.active_editor() else { return ActiveContext { session_title, project_root, ..Default::default() } };
    let editor = editor.read(cx);
    if editor.is_untitled() {
        return ActiveContext { session_title, project_root, ..Default::default() };
    }
    let (line, column) = editor.cursor_position();
    ActiveContext {
        file_path: Some(editor.path().to_string_lossy().into_owned()),
        session_title,
        cursor: Some((line.saturating_sub(1), column.saturating_sub(1), editor.cursor_offset())),
        viewport: Some({
            let (top, left, height) = editor.viewport();
            (top.round() as i32, left.round() as i32, height.round() as i32)
        }),
        project_root,
    }
}

/// The open files and the agent sessions, for keeping live shares current.
fn share_sources(workbench: &Workbench, cx: &App) -> Sources {
    let mut buffers = Vec::new();
    for view in workbench.centre_views.values() {
        let Some(editor) = &view.editor else { continue };
        let editor = editor.read(cx);
        if editor.is_untitled() {
            continue;
        }
        let path = editor.path().to_string_lossy().into_owned();
        if buffers.iter().any(|draft: &collaboration::sharing::ShareDraft| draft.source_id.as_deref() == Some(path.as_str())) {
            continue;
        }
        let title = editor.path().file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
        buffers.push(collaboration::sharing::editor_draft(&path, &title, editor.language_name(), editor.text(), None));
    }
    let sessions = workbench
        .state
        .sessions
        .iter()
        .map(|session| SessionSource { id: session.id.0.clone(), title: session.title.clone(), updated_at: session.last_activity_at as i64 })
        .collect();
    Sources { buffers, sessions, sessions_dir: agent_ui::persistence::sessions_dir() }
}
