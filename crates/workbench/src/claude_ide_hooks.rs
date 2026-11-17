//! What Claude Code's `/ide` integration (`claude_ide`) and Codex's hosted browser tool need from
//! the workbench: the editors of the window in front, its folders, and closing tabs.

use std::{
    path::{Path, PathBuf},
    rc::Rc,
};

use claude_ide::{EditorBridge, OpenEditor, Selection};
use gpui::{App, Entity, Global, WeakEntity, Window, WindowId};
use workspace::TabItem;

use crate::Workbench;

struct Bridge;

/// What each workbench window shows, published as it draws. The bridge and the buffer hooks
/// read this instead of the windows: they are called from inside a window's listeners and
/// observers, where reading that window (`WindowHandle::entity`) or its workbench panics.
#[derive(Default)]
struct EditorIndex {
    windows: Vec<WindowEditors>,
}

impl Global for EditorIndex {}

struct WindowEditors {
    window: WindowId,
    workbench: WeakEntity<Workbench>,
    /// Every file tab's editor, with whether it is the active one.
    editors: Vec<(WeakEntity<editor::Editor>, bool)>,
    folders: Vec<PathBuf>,
}

impl Workbench {
    /// Notes this window's editors and folders for the bridge; called from `render`.
    pub(crate) fn publish_editor_index(&self, window: &Window, cx: &mut gpui::Context<Self>) {
        let active = self.active_editor();
        let mut editors: Vec<(WeakEntity<editor::Editor>, bool)> = Vec::new();
        let mut seen: Vec<gpui::EntityId> = Vec::new();
        for view in self.centre_views.values() {
            if let Some(editor) = &view.editor
                && !seen.contains(&editor.entity_id())
            {
                seen.push(editor.entity_id());
                editors.push((editor.downgrade(), active.as_ref() == Some(editor)));
            }
        }
        let folders: Vec<PathBuf> = self
            .state
            .projects
            .iter()
            .filter(|project| !project.is_remote())
            .map(|project| PathBuf::from(&project.path))
            .filter(|path| path.is_absolute())
            .collect();
        let entry = WindowEditors { window: window.window_handle().window_id(), workbench: cx.weak_entity(), editors, folders };
        let index = cx.default_global::<EditorIndex>();
        index.windows.retain(|known| known.window != entry.window && known.workbench.upgrade().is_some());
        index.windows.push(entry);
    }
}

/// The published windows, the one in front first.
fn windows(cx: &App) -> Vec<&WindowEditors> {
    let Some(index) = cx.try_global::<EditorIndex>() else { return Vec::new() };
    let mut windows: Vec<&WindowEditors> = index.windows.iter().filter(|entry| entry.workbench.upgrade().is_some()).collect();
    if let Some(front) = crate::windows::front_window(cx) {
        windows.sort_by_key(|entry| entry.window != front);
    }
    windows
}

/// The editors of the window in front, with whether each is the active one.
fn front_editors(cx: &App) -> Vec<(Entity<editor::Editor>, bool)> {
    windows(cx).first().map(|entry| entry.editors.iter().filter_map(|(editor, active)| Some((editor.upgrade()?, *active))).collect()).unwrap_or_default()
}

/// The open editors of `path` in every window, the one in front first.
fn editors_of(path: &Path, cx: &App) -> Vec<Entity<editor::Editor>> {
    windows(cx)
        .into_iter()
        .flat_map(|entry| entry.editors.iter().filter_map(|(editor, _)| editor.upgrade()))
        .filter(|editor| editor.read(cx).path() == path)
        .collect()
}

impl EditorBridge for Bridge {
    fn selection(&self, cx: &App) -> Option<Selection> {
        let (editor, _) = front_editors(cx).into_iter().find(|(_, active)| *active)?;
        let editor = editor.read(cx);
        let ((start_line, start_char), (end_line, end_char), text) = editor.selection_points();
        Some(Selection { path: editor.path().to_path_buf(), text, start: (start_line as u32, start_char as u32), end: (end_line as u32, end_char as u32) })
    }

    fn open_editors(&self, cx: &App) -> Vec<OpenEditor> {
        front_editors(cx)
            .into_iter()
            .map(|(editor, active)| {
                let editor = editor.read(cx);
                let path = editor.path().to_path_buf();
                let text = editor.text();
                OpenEditor {
                    label: path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
                    language: editor.language_name().to_lowercase(),
                    dirty: editor.is_dirty(),
                    active,
                    line_count: if text.is_empty() { 1 } else { text.split('\n').count() },
                    path,
                }
            })
            .collect()
    }

    fn editor_text(&self, path: &Path, cx: &App) -> Option<String> {
        front_editors(cx).into_iter().map(|(editor, _)| editor).find(|editor| editor.read(cx).path() == path).map(|editor| editor.read(cx).text())
    }

    fn save(&self, path: &Path, cx: &mut App) -> Option<bool> {
        let editor = front_editors(cx).into_iter().map(|(editor, _)| editor).find(|editor| editor.read(cx).path() == path)?;
        editor.update(cx, |editor, cx| editor.save_if_dirty(cx));
        Some(true)
    }

    fn close_tab(&self, name: &str, cx: &mut App) {
        let name = name.to_string();
        close_where(cx, move |item| matches!(item, TabItem::File { path } if *path == name || Path::new(path).file_name().is_some_and(|file| *file == *name)));
    }

    fn close_resource(&self, kind: &str, id: &str, cx: &mut App) {
        let (kind, id) = (kind.to_string(), id.to_string());
        close_where(cx, move |item| matches!(item, TabItem::Resource { kind: tab_kind, id: tab_id, .. } if *tab_kind == kind && *tab_id == id));
    }

    fn workspace_folders(&self, cx: &App) -> Vec<PathBuf> {
        let mut folders: Vec<PathBuf> = Vec::new();
        for entry in windows(cx) {
            for folder in &entry.folders {
                if !folders.contains(folder) {
                    folders.push(folder.clone());
                }
            }
        }
        folders
    }
}

/// Closes the first matching tab of the window in front. Deferred: it may be asked for from
/// inside that workbench's own update (a diff tab's Accept), where updating it would panic.
fn close_where(cx: &mut App, matches: impl Fn(&TabItem) -> bool + 'static) {
    let Some(workbench) = windows(cx).first().map(|entry| entry.workbench.clone()) else { return };
    cx.defer(move |cx| {
        workbench
            .update(cx, |workbench, cx| {
                let index = workbench.state.focused_tabs().and_then(|tabs| tabs.tabs.iter().position(&matches));
                if let Some(index) = index {
                    workbench.update_state(cx, |state| state.close_tab(index));
                }
            })
            .ok();
    });
}

/// The text an open editor holds for `path`, in any workbench window (the one in front first).
fn open_buffer_text(path: &Path, cx: &App) -> Option<String> {
    editors_of(path, cx).first().map(|editor| editor.read(cx).text())
}

/// Puts `text` into the editors that have `path` open, as an undoable unsaved edit.
fn write_open_buffer(path: &Path, text: &str, cx: &mut App) -> bool {
    let editors = editors_of(path, cx);
    let found = !editors.is_empty();
    for editor in editors {
        editor.update(cx, |editor, cx| editor.replace_text(text, cx));
    }
    found
}

pub(crate) fn init(cx: &mut App) {
    workbench_api::set_buffer_text_reader(cx, open_buffer_text);
    workbench_api::set_buffer_text_writer(cx, write_open_buffer);
    claude_ide::set_bridge(Rc::new(Bridge), cx);
    claude_ide::init(cx);
    terminal_view::set_extra_env(claude_ide::terminal_env, cx);
    #[cfg(not(target_family = "wasm"))]
    agent_ui::codex::set_browser_hook(
        agent_ui::codex::BrowserHook {
            definition: browser_view::browser_use::tool_definition(),
            run: Rc::new(|arguments, call_id, chat_id, cx| {
                let task = browser_view::browser_use::run_hosted_browser_tool(arguments, call_id, chat_id, cx);
                cx.spawn(async move |_| {
                    let outcome = task.await;
                    (outcome.success, outcome.text)
                })
            }),
        },
        cx,
    );
}
