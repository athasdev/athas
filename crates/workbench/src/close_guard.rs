//! The window close guard (`window-close-guard.tsx`, `window-close-session.ts`): closing the window
//! or quitting asks about agents still working, then about each file with unsaved changes —
//! save, don't save, or cancel — before anything closes.

use std::{collections::HashMap, time::Duration};

use gpui::{App, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, SharedString, WeakEntity, Window, div, prelude::*};
use theme::ActiveTheme;
use ui::{AlertDialog, Button, ButtonVariant, ConfirmOptions, Dialog, DialogSize, IconName, typography};

use crate::Workbench;

/// Why the window asks about unsaved changes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CloseIntent {
    #[default]
    Close,
    Quit,
}

/// One close or quit in progress.
#[derive(Default)]
pub(crate) struct CloseGuard {
    intent: CloseIntent,
    /// Drafts the user chose not to save, by view, at the buffer version they had then.
    discarded: HashMap<String, usize>,
    agents_confirmed: bool,
    /// The question on screen, so a second request waits for its answer.
    prompt: Option<gpui::AnyView>,
}

/// Closing tabs (or a project) that would drop unsaved files: the change waits while each file
/// is asked about, and runs once all are saved or let go.
pub(crate) struct PendingTabClose {
    change: std::rc::Rc<dyn Fn(&mut workspace::WorkspaceState)>,
    /// Drafts the user chose not to save, at the buffer version they had then.
    discarded: HashMap<String, usize>,
}

struct BlockingDraft {
    key: String,
    editor: Entity<editor::Editor>,
    name: String,
}

/// The other workbench windows a quit still has to ask, in turn.
#[derive(Default)]
struct QuitQueue(Vec<gpui::WindowHandle<Workbench>>);

impl gpui::Global for QuitQueue {}

/// A quit settles every workbench window before Athas quits (`requestAppQuit`): this one first,
/// then each of the others.
pub(crate) fn start_quit(window: &Window, cx: &mut App) {
    let current = window.window_handle().window_id();
    let others = cx
        .windows()
        .into_iter()
        .filter(|handle| handle.window_id() != current)
        .filter_map(|handle| handle.downcast::<Workbench>())
        .collect();
    cx.set_global(QuitQueue(others));
}

fn continue_quit(cx: &mut App) {
    let queue = cx.default_global::<QuitQueue>();
    let next = (!queue.0.is_empty()).then(|| queue.0.remove(0));
    let Some(handle) = next else {
        if workbench_api::restart_after_quit(cx) {
            cx.restart();
        } else {
            cx.quit();
        }
        return;
    };
    cx.defer(move |cx| {
        let asked = handle.update(cx, |workbench, window, cx| {
            window.activate_window();
            workbench.request_close(CloseIntent::Quit, window, cx);
        });
        if asked.is_err() {
            continue_quit(cx);
        }
    });
}

impl Workbench {
    /// Agents running in sessions, when the settings ask to confirm quitting with them.
    fn running_agents(&self, cx: &App) -> usize {
        if !settings::get(cx).confirm_quit_with_running_agents {
            return 0;
        }
        self.state.sessions.iter().filter(|session| session.status == workspace::SessionStatus::Running).count()
    }

    /// Runs `change` (closing tabs, a project) once every unsaved file it would close is saved or
    /// let go, asking about each as quitting does. Without this, Cmd+W or a tab's × dropped the
    /// edits silently.
    pub(crate) fn close_tabs_guarded(&mut self, change: impl Fn(&mut workspace::WorkspaceState) + 'static, window: &mut Window, cx: &mut Context<Self>) {
        if self.prompt_is_open() {
            return;
        }
        self.pending_tab_close = Some(PendingTabClose { change: std::rc::Rc::new(change), discarded: HashMap::new() });
        self.continue_tab_close(window, cx);
    }

    fn continue_tab_close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(pending) = &self.pending_tab_close else { return };
        let mut after = self.state.clone();
        (pending.change)(&mut after);
        let open_after: std::collections::HashSet<String> = after.all_group_tabs().map(|(group, item)| crate::centre_views::view_key(group, item)).collect();
        let mut closing: Vec<&String> = self.centre_views.keys().filter(|key| !open_after.contains(*key)).collect();
        closing.sort();
        let draft = closing.into_iter().find_map(|key| self.blocking_draft(key, &pending.discarded, cx));
        match draft {
            Some(draft) => {
                let weak = cx.weak_entity();
                let dialog = cx.new(|cx| UnsavedChangesDialog::new(weak, draft.key, draft.editor, draft.name, cx));
                self.close_guard.prompt = Some(dialog.clone().into());
                self.open_modal(dialog, window, cx);
            }
            None => {
                let change = pending.change.clone();
                self.pending_tab_close = None;
                self.update_state(cx, |state| change(state));
            }
        }
    }

    /// The unsaved file behind view `key`, unless it was let go at its current version.
    fn blocking_draft(&self, key: &String, discarded: &HashMap<String, usize>, cx: &App) -> Option<BlockingDraft> {
        let editor = self.centre_views.get(key)?.editor.clone()?;
        let read = editor.read(cx);
        if !read.is_dirty() || discarded.get(key) == Some(&read.buffer_version()) {
            return None;
        }
        let path = read.path().to_path_buf();
        let file = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
        let project = self
            .state
            .projects
            .iter()
            .filter(|project| path.starts_with(&project.path))
            .max_by_key(|project| project.path.len())
            .or_else(|| self.state.active_project())
            .map(|project| project.name.clone());
        let name = match project {
            Some(project) => format!("{file} ({project})"),
            None => file,
        };
        Some(BlockingDraft { key: key.clone(), editor, name })
    }

    /// A file with unsaved changes the user has not chosen to drop, those in front first.
    fn find_blocking_draft(&self, cx: &App) -> Option<BlockingDraft> {
        let in_front: Vec<String> = self
            .state
            .focused_panes()
            .map(|panes| {
                panes
                    .groups
                    .iter()
                    .flat_map(|group| group.tabs.tabs.iter().map(move |tab| crate::centre_views::view_key(group.id, tab)))
                    .collect()
            })
            .unwrap_or_default();
        let mut keys: Vec<&String> = self.centre_views.keys().collect();
        keys.sort_by_key(|key| (!in_front.contains(key), (*key).clone()));
        keys.into_iter().find_map(|key| {
            let editor = self.centre_views.get(key)?.editor.clone()?;
            let read = editor.read(cx);
            if !read.is_dirty() || self.close_guard.discarded.get(key) == Some(&read.buffer_version()) {
                return None;
            }
            let path = read.path().to_path_buf();
            let file = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
            let project = self
                .state
                .projects
                .iter()
                .filter(|project| path.starts_with(&project.path))
                .max_by_key(|project| project.path.len())
                .or_else(|| self.state.active_project())
                .map(|project| project.name.clone());
            let name = match project {
                Some(project) => format!("{file} ({project})"),
                None => file,
            };
            Some(BlockingDraft { key: key.clone(), editor, name })
        })
    }

    fn prompt_is_open(&self) -> bool {
        let Some(prompt) = &self.close_guard.prompt else { return false };
        self.modal.as_ref().is_some_and(|(view, _)| view.entity_id() == prompt.entity_id())
    }

    fn reset_close_guard(&mut self) {
        self.close_guard = CloseGuard::default();
    }

    /// Closes the window or quits once agents and unsaved files are settled, asking about each.
    pub fn request_close(&mut self, intent: CloseIntent, window: &mut Window, cx: &mut Context<Self>) {
        if self.prompt_is_open() {
            if intent == CloseIntent::Quit {
                self.close_guard.intent = CloseIntent::Quit;
            }
            return;
        }
        if self.close_guard.prompt.take().is_some() {
            // The last question was put away without an answer.
            self.reset_close_guard();
        }
        // A session out in its own window belongs to this one, so this window stays while it is
        // out (`agentsAreDetached`); quitting closes everything anyway.
        if intent == CloseIntent::Close && self.state.sessions.iter().any(|session| crate::detached::session_is_detached(&session.id.0, cx)) {
            notifications::info(cx, "Close the agent windows before closing this window.");
            return;
        }
        self.close_guard.intent = intent;
        if !self.close_guard.agents_confirmed {
            let running = self.running_agents(cx);
            if running > 0 {
                let quit = intent == CloseIntent::Quit;
                let message = format!(
                    "{} still working. {} stops {}.",
                    if running == 1 { "An agent is".to_string() } else { format!("{running} agents are") },
                    if quit { "Quitting" } else { "Closing this window" },
                    if running == 1 { "it" } else { "them" },
                );
                let weak = cx.weak_entity();
                let dialog = AlertDialog::confirm(
                    if quit { "Quit Athas?" } else { "Close Window?" },
                    message,
                    ConfirmOptions { confirm_label: if quit { "Quit".into() } else { "Close".into() }, destructive: true, ..Default::default() },
                    move |window, cx| {
                        weak.update(cx, |this, cx| {
                            this.close_guard.prompt = None;
                            this.close_guard.agents_confirmed = true;
                            let intent = this.close_guard.intent;
                            this.request_close(intent, window, cx);
                        })
                        .ok();
                    },
                    cx,
                );
                self.close_guard.prompt = Some(dialog.clone().into());
                self.open_modal(dialog, window, cx);
                return;
            }
        }
        if let Some(draft) = self.find_blocking_draft(cx) {
            let weak = cx.weak_entity();
            let dialog = cx.new(|cx| UnsavedChangesDialog::new(weak, draft.key, draft.editor, draft.name, cx));
            self.close_guard.prompt = Some(dialog.clone().into());
            self.open_modal(dialog, window, cx);
            return;
        }
        let intent = self.close_guard.intent;
        self.reset_close_guard();
        self.capture_editor_views(cx);
        self.save();
        match intent {
            CloseIntent::Close => window.remove_window(),
            CloseIntent::Quit => continue_quit(cx),
        }
    }

    /// The window's close button: let it close only when nothing needs asking.
    pub(crate) fn should_close_window(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.prompt_is_open() {
            return false;
        }
        let agents = !self.close_guard.agents_confirmed && self.running_agents(cx) > 0;
        // A detached agent window belongs to this one: closing here would orphan it (and, with
        // other windows open, drop this window's saved state with the session in it).
        let detached = self.state.sessions.iter().any(|session| crate::detached::session_is_detached(&session.id.0, cx));
        if agents || detached || self.find_blocking_draft(cx).is_some() {
            self.request_close(CloseIntent::Close, window, cx);
            return false;
        }
        self.capture_editor_views(cx);
        self.save();
        true
    }

    fn answer_unsaved(&mut self, key: &str, answer: UnsavedAnswer, window: &mut Window, cx: &mut Context<Self>) {
        self.close_guard.prompt = None;
        // The question came from closing tabs, not from closing the window or quitting.
        if let Some(pending) = &mut self.pending_tab_close {
            match answer {
                UnsavedAnswer::Cancel => {
                    self.pending_tab_close = None;
                    return;
                }
                UnsavedAnswer::Discard => {
                    let version = self.centre_views.get(key).and_then(|view| view.editor.as_ref()).map(|editor| editor.read(cx).buffer_version());
                    if let Some(version) = version {
                        pending.discarded.insert(key.to_string(), version);
                    }
                }
                UnsavedAnswer::Saved => {}
            }
            self.continue_tab_close(window, cx);
            return;
        }
        match answer {
            UnsavedAnswer::Cancel => {
                self.reset_close_guard();
                return;
            }
            UnsavedAnswer::Discard => {
                let version = self.centre_views.get(key).and_then(|view| view.editor.as_ref()).map(|editor| editor.read(cx).buffer_version());
                if let Some(version) = version {
                    self.close_guard.discarded.insert(key.to_string(), version);
                }
            }
            UnsavedAnswer::Saved => {}
        }
        let intent = self.close_guard.intent;
        self.request_close(intent, window, cx);
    }
}

enum UnsavedAnswer {
    Saved,
    Discard,
    Cancel,
}

/// `UnsavedChangesDialog`: Don't Save on the left, Cancel and Save on the right.
pub(crate) struct UnsavedChangesDialog {
    focus_handle: FocusHandle,
    workbench: WeakEntity<Workbench>,
    key: String,
    editor: Entity<editor::Editor>,
    name: SharedString,
    saving: bool,
}

impl EventEmitter<DismissEvent> for UnsavedChangesDialog {}

impl Focusable for UnsavedChangesDialog {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl UnsavedChangesDialog {
    fn new(workbench: WeakEntity<Workbench>, key: String, editor: Entity<editor::Editor>, name: String, cx: &mut Context<Self>) -> Self {
        Self { focus_handle: cx.focus_handle(), workbench, key, editor, name: name.into(), saving: false }
    }

    fn answer(&mut self, answer: UnsavedAnswer, window: &mut Window, cx: &mut Context<Self>) {
        cx.emit(DismissEvent);
        let key = self.key.clone();
        self.workbench.update(cx, |workbench, cx| workbench.answer_unsaved(&key, answer, window, cx)).ok();
    }

    /// Saves, then carries on once the file is written; a save that fails keeps the question up.
    fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.saving {
            return;
        }
        self.saving = true;
        cx.notify();
        // An untitled document lives in memory: "saving" it there and quitting loses it, so it
        // asks for a file first, and the question waits for that (up to five minutes).
        let untitled = self.editor.read(cx).is_untitled();
        if untitled {
            self.editor.update(cx, |editor, cx| editor.save_or_save_as(window, cx));
        } else {
            self.editor.update(cx, |editor, cx| editor.save_if_dirty(cx));
        }
        let editor = self.editor.clone();
        cx.spawn_in(window, async move |this, cx| {
            for _ in 0..if untitled { 6000 } else { 200 } {
                cx.background_executor().timer(Duration::from_millis(50)).await;
                let dirty = editor.read_with(cx, |editor, _| editor.is_dirty() || editor.is_untitled());
                if !dirty {
                    this.update_in(cx, |this, window, cx| this.answer(UnsavedAnswer::Saved, window, cx)).ok();
                    return;
                }
            }
            this.update(cx, |this, cx| {
                this.saving = false;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

impl Render for UnsavedChangesDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let weak = cx.entity().downgrade();
        let prefix = "Do you want to save the changes you made to ";
        let text = format!("{prefix}{}?", self.name);
        let bold = prefix.len()..prefix.len() + self.name.len();
        let message = gpui::StyledText::new(text).with_highlights([(
            bold,
            gpui::HighlightStyle { font_weight: Some(typography::SEMIBOLD), ..Default::default() },
        )]);
        div()
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, window, cx| {
                if event.keystroke.key == "enter" {
                    cx.stop_propagation();
                    this.save(window, cx);
                }
            }))
            .child(
                Dialog::new("unsaved-changes", "Unsaved Changes")
                    .icon(IconName::Warning)
                    .size(DialogSize::Sm)
                    .track_focus(&self.focus_handle)
                    .on_close(move |window, cx| {
                        weak.update(cx, |this, cx| this.answer(UnsavedAnswer::Cancel, window, cx)).ok();
                    })
                    .footer([
                        div()
                            .mr_auto()
                            .child(
                                Button::new("unsaved-discard", "Don’t Save")
                                    .disabled(self.saving)
                                    .on_click(cx.listener(|this, _, window, cx| this.answer(UnsavedAnswer::Discard, window, cx))),
                            )
                            .into_any_element(),
                        Button::new("unsaved-cancel", "Cancel")
                            .on_click(cx.listener(|this, _, window, cx| this.answer(UnsavedAnswer::Cancel, window, cx)))
                            .into_any_element(),
                        Button::new("unsaved-save", "Save")
                            .variant(ButtonVariant::Accent)
                            .disabled(self.saving)
                            .on_click(cx.listener(|this, _, window, cx| this.save(window, cx)))
                            .into_any_element(),
                    ])
                    .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(message)),
            )
    }
}
