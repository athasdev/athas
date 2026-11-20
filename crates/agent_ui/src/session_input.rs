//! What surrounds the composer's text: `@` and `/` completions, attachments (files, earlier
//! sessions, pasted or dropped images) and prompts queued while a turn runs.
//!
//! Ported from Athas's `components/input/chat-input-bar.tsx`, `lib/agent-message-queue.ts` and
//! `lib/image-attachments.ts`.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use base64::Engine as _;
use gpui::{App, AppContext as _, Context, Entity, Subscription, Window};

use crate::{
    acp::schema as acp,
    composer::{ChipTone, MenuKey},
    composer_modes::{self, ModeIntent},
    history,
    mentions::{self, Attachment, Trigger},
    session_view::SessionView,
};

/// Files listed for `@` mentions, at most.
const MAX_PROJECT_FILES: usize = 20_000;
const MENU_FILES: usize = 8;
const MENU_SESSIONS: usize = 3;
const MENU_COMMANDS: usize = 8;
/// The largest image attached, as Athas allows.
const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// How much of an earlier session goes along with a mention of it.
const SESSION_SUMMARY_CHARS: usize = 16_000;
/// How long edits to an attached open file pause before it is re-read (`ATTACHED_TEXT_SETTLE_MS`).
const TAB_SETTLE: std::time::Duration = std::time::Duration::from_millis(300);

/// Follows the open editors of attached files (`SessionView::tab_watch`).
pub(crate) struct TabWatch {
    /// Each attached file's edit count when last looked at.
    generations: HashMap<PathBuf, u64>,
    /// The re-read waiting for edits to pause.
    _settle: Option<gpui::Task<()>>,
    _subscription: gpui::Subscription,
}

pub(crate) struct Completion {
    pub trigger: Trigger,
    pub items: Vec<CompletionItem>,
    pub selected: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CompletionItem {
    File { relative: String, path: PathBuf, group: mentions::FileGroup },
    Session { id: String, title: String },
    Command { name: String, description: String, hint: Option<String> },
    /// A skill the user can attach (`/skill-name`).
    Skill { command: String, title: String, description: String, content: String },
    /// One of Athas's own commands, run when picked.
    Action { name: String, description: String, action: ComposerAction },
}

/// What Athas's own `/` commands do (`composer-slash-commands.ts`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum ComposerAction {
    Mode(ModeIntent),
    Compact,
    Review,
    New,
    Clear,
}

/// Athas's commands the session offers: the mode commands its modes match, review and new, and
/// compact and clear for the built-in agent. A name the agent provides keeps the agent's command.
pub(crate) fn athas_commands(transcript: &crate::thread::Transcript, builtin: bool) -> Vec<(&'static str, &'static str, ComposerAction)> {
    let mut commands: Vec<(&'static str, &'static str, ComposerAction)> =
        composer_modes::available_mode_commands(transcript).into_iter().map(|(intent, name, description)| (name, description, ComposerAction::Mode(intent))).collect();
    if builtin {
        commands.push(("compact", "Summarise earlier messages to free up context", ComposerAction::Compact));
    }
    commands.push(("review", "Review the agent's changes hunk by hunk", ComposerAction::Review));
    commands.push(("new", "Start a new chat", ComposerAction::New));
    if builtin {
        commands.push(("clear", "Clear this chat's messages", ComposerAction::Clear));
    }
    commands.retain(|(name, _, _)| !transcript.commands.iter().any(|command| command.name.eq_ignore_ascii_case(name)));
    commands
}

/// A prompt waiting for the running turn to end.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Queued {
    pub id: u64,
    pub text: String,
    pub attachments: Vec<Attachment>,
}

impl Queued {
    pub fn new(text: String, attachments: Vec<Attachment>) -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        Self { id: NEXT.fetch_add(1, Ordering::Relaxed), text, attachments }
    }
}

/// The queued prompt being edited in place; the queue does not send it until the edit ends.
pub(crate) struct QueuedEdit {
    pub id: u64,
    pub input: Entity<ui::TextInput>,
    _subscription: Subscription,
}

/// Keeps a quick second "Send now" from landing before the first one's turn has started.
const SEND_NOW_SETTLE: Duration = Duration::from_millis(500);

/// What the composer held when its session view went away, restored when the session opens
/// again (`agent-window-drafts.ts`).
#[derive(Clone, Default)]
pub(crate) struct Draft {
    pub text: String,
    pub attachments: Vec<Attachment>,
}

#[derive(Default)]
struct Drafts(HashMap<String, Draft>);

impl gpui::Global for Drafts {}

pub(crate) fn store_draft(cx: &mut App, session: &str, draft: Draft) {
    let drafts = &mut cx.default_global::<Drafts>().0;
    if draft.text.trim().is_empty() && draft.attachments.is_empty() {
        drafts.remove(session);
    } else {
        drafts.insert(session.to_string(), draft);
    }
}

pub(crate) fn take_draft(cx: &mut App, session: &str) -> Option<Draft> {
    cx.try_global::<Drafts>()?;
    cx.global_mut::<Drafts>().0.remove(session)
}

impl SessionView {
    /// Opens, updates or closes the completion menu for the text at the cursor.
    pub(crate) fn update_completion(&mut self, cx: &mut Context<Self>) {
        let (text, cursor) = {
            let composer = self.composer.read(cx);
            (composer.text().to_string(), composer.cursor())
        };
        let completion = match mentions::trigger(&text, cursor) {
            Some(trigger @ Trigger::Mention { .. }) => {
                self.load_project_files(cx);
                self.load_saved_sessions(cx);
                let Trigger::Mention { query, .. } = &trigger else { unreachable!() };
                let mut items: Vec<CompletionItem> = Vec::new();
                let searched = self.search_project_files(query, cx);
                if let (Some(files), Some(root)) = (searched, &self.info.cwd) {
                    items.extend(files.iter().take(MENU_FILES).map(|relative| CompletionItem::File {
                        relative: relative.clone(),
                        path: root.join(relative),
                        group: mentions::FileGroup::Files,
                    }));
                } else if let (Some(files), Some(root)) = (&self.project_files, &self.info.cwd) {
                    let relative = |path: PathBuf| Some(path.strip_prefix(root).ok()?.to_string_lossy().into_owned());
                    let open: Vec<String> = workbench_api::open_tabs(cx).into_iter().filter_map(|tab| relative(tab.path?)).collect();
                    let recent: Vec<String> = palette::recent_workspace_files(std::slice::from_ref(root), cx).into_iter().filter_map(relative).collect();
                    items.extend(mentions::rank_files(query, files, &open, &recent, MENU_FILES).into_iter().map(|(relative, group)| {
                        CompletionItem::File { relative: relative.clone(), path: root.join(relative), group }
                    }));
                }
                if let Some(sessions) = &self.saved_sessions {
                    let others = sessions.iter().filter(|session| session.id != self.info.id);
                    let sessions = mentions::rank(query, others.map(|session| (session.title.as_str(), session)), MENU_SESSIONS);
                    items.extend(sessions.into_iter().map(|session| CompletionItem::Session { id: session.id.clone(), title: session.title.clone() }));
                }
                (!items.is_empty()).then_some(Completion { trigger, items, selected: 0 })
            }
            Some(trigger @ Trigger::Slash { .. }) => {
                self.load_skills(cx);
                let Trigger::Slash { query, .. } = &trigger else { unreachable!() };
                let commands = mentions::rank(query, self.transcript.commands.iter().map(|command| (command.name.as_str(), command)), MENU_COMMANDS);
                let mut items: Vec<CompletionItem> = commands
                    .into_iter()
                    .map(|command| CompletionItem::Command { name: command.name.clone(), description: command.description.clone(), hint: command.hint.clone() })
                    .collect();
                let own = athas_commands(&self.transcript, crate::builtin::is_builtin(&self.info.agent));
                let own = mentions::rank(query, own.iter().map(|command| (command.0, command)), MENU_COMMANDS);
                items.extend(own.into_iter().map(|(name, description, action)| CompletionItem::Action { name: name.to_string(), description: description.to_string(), action: *action }));
                if let Some(skills) = &self.skills {
                    // A name the agent already provides keeps the agent's command.
                    let skills = skills.iter().filter(|skill| !self.transcript.commands.iter().any(|command| command.name == skill.command()));
                    let commands: Vec<(String, &crate::skills::Skill)> = skills.map(|skill| (skill.command(), skill)).collect();
                    let ranked = mentions::rank(query, commands.iter().map(|(command, skill)| (command.as_str(), (command.clone(), *skill))), MENU_COMMANDS);
                    items.extend(ranked.into_iter().map(|(command, skill)| CompletionItem::Skill {
                        command,
                        title: skill.title.clone(),
                        description: skill.description.clone(),
                        content: skill.content.clone(),
                    }));
                }
                (!items.is_empty()).then_some(Completion { trigger, items, selected: 0 })
            }
            None => None,
        };
        // Keep the highlighted row when the same items come back.
        let completion = completion.map(|mut completion| {
            if let Some(previous) = &self.completion
                && let Some(item) = previous.items.get(previous.selected)
                && let Some(index) = completion.items.iter().position(|candidate| candidate == item)
            {
                completion.selected = index;
            }
            completion
        });
        let open = completion.is_some();
        self.completion = completion;
        self.composer.update(cx, |composer, _| composer.set_menu_open(open));
        cx.notify();
    }

    pub(crate) fn completion_key(&mut self, key: MenuKey, cx: &mut Context<Self>) {
        let Some(completion) = &mut self.completion else { return };
        let count = completion.items.len();
        match key {
            MenuKey::Up => completion.selected = (completion.selected + count - 1) % count,
            MenuKey::Down => completion.selected = (completion.selected + 1) % count,
            MenuKey::Accept => {
                let selected = completion.selected;
                self.accept_completion(selected, cx);
                return;
            }
            MenuKey::Dismiss => self.close_completion(cx),
        }
        cx.notify();
    }

    fn close_completion(&mut self, cx: &mut Context<Self>) {
        self.completion = None;
        self.composer.update(cx, |composer, _| composer.set_menu_open(false));
        cx.notify();
    }

    pub(crate) fn accept_completion(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(completion) = self.completion.take() else { return };
        let Some(item) = completion.items.get(index).cloned() else { return };
        let range = completion.trigger.range();
        let chip = match &item {
            CompletionItem::File { relative, path, .. } => {
                self.add_attachment(Attachment::File(path.clone()));
                let name = relative.rsplit('/').next().unwrap_or(relative).to_string();
                Some((name, ChipTone::Accent, Some(format!("@{relative}"))))
            }
            CompletionItem::Session { id, title } => {
                self.add_attachment(Attachment::Session { id: id.clone(), title: title.clone() });
                Some((title.clone(), ChipTone::Accent, Some(format!("@{title}"))))
            }
            CompletionItem::Command { name, .. } => Some((format!("/{name}"), ChipTone::Neutral, None)),
            CompletionItem::Skill { title, content, .. } => {
                self.add_attachment(Attachment::Skill { title: title.clone(), content: content.clone() });
                None
            }
            CompletionItem::Action { .. } => None,
        };
        self.composer.update(cx, |composer, cx| {
            composer.set_menu_open(false);
            match chip {
                Some((label, tone, token)) => composer.insert_chip(range, &label, tone, token, cx),
                None => composer.replace_range(range, "", cx),
            }
        });
        if let CompletionItem::Action { action, .. } = item {
            self.run_composer_action(action, cx);
        }
        cx.notify();
    }

    pub(crate) fn run_composer_action(&mut self, action: ComposerAction, cx: &mut Context<Self>) {
        match action {
            ComposerAction::Mode(intent) => {
                let label = self.apply_mode_intent(intent, cx);
                notifications::info(cx, label.map_or_else(|| "This agent has no matching mode.".to_string(), |label| format!("Mode: {label}")));
            }
            ComposerAction::New => cx.defer(|cx| {
                if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action("agent.newChat")) {
                    cx.dispatch_action(action.as_ref());
                }
            }),
            ComposerAction::Review => {
                if self.review_totals.0 > 0 {
                    self.open_review(cx);
                } else {
                    notifications::info(cx, "No agent changes to review in this chat.");
                }
            }
            ComposerAction::Compact | ComposerAction::Clear if self.is_running() => {
                notifications::info(cx, "Wait for the current response to finish.");
            }
            ComposerAction::Compact => self.compact(cx),
            ComposerAction::Clear => self.clear(cx),
        }
    }

    /// Switches to the mode an intent picks; its label, or `None` when no mode matches.
    pub(crate) fn apply_mode_intent(&mut self, intent: ModeIntent, cx: &mut Context<Self>) -> Option<String> {
        let (options, target) = composer_modes::mode_options(&self.transcript);
        let mode = composer_modes::find_mode_for_intent(&options, intent)?.clone();
        match target {
            composer_modes::ModeTarget::Mode => self.set_mode(mode.id, cx),
            composer_modes::ModeTarget::Config(config) => self.set_config_option(config, mode.id, cx),
        }
        Some(mode.label)
    }

    pub(crate) fn add_attachment(&mut self, attachment: Attachment) {
        if !self.attachments.contains(&attachment) {
            self.attachments.push(attachment);
        }
    }

    /// Re-reads attached open files from their editors, unsaved edits included
    /// (`useBuffersTextRevision`); whether any changed.
    pub(crate) fn refresh_tab_attachments(&mut self, cx: &mut Context<Self>) -> bool {
        self.apply_tab_texts(|path| workbench_api::buffer_text(path, cx))
    }

    /// Sets attached open files' text from `text_of`; whether any changed.
    fn apply_tab_texts(&mut self, text_of: impl Fn(&std::path::Path) -> Option<String>) -> bool {
        let root = self.info.cwd.clone();
        let mut changed = false;
        for attachment in &mut self.attachments {
            let Attachment::Context { reference, content, .. } = attachment else { continue };
            let crate::context_refs::ContextRef::Tab { path: Some(path), .. } = &*reference else { continue };
            let Some(text) = text_of(path) else { continue };
            let next = crate::context_refs::format_tab(reference, root.as_deref(), Some(&text));
            if *content != next {
                *content = next;
                changed = true;
            }
        }
        changed
    }

    /// While an open file is attached, its count follows its editor once edits pause
    /// (`ATTACHED_TEXT_SETTLE_MS`): the workbench's edit signal (`BufferEdits`) is listened to,
    /// and the text is re-read `TAB_SETTLE` after the last edit.
    pub(crate) fn watch_tab_attachments(&mut self, cx: &mut Context<Self>) {
        let attached = self.attached_tab_paths();
        if attached.is_empty() {
            self.tab_watch = None;
            return;
        }
        if self.tab_watch.is_some() {
            return;
        }
        let generations = attached.into_iter().map(|path| (workbench_api::buffer_generation(&path, cx), path)).map(|(generation, path)| (path, generation)).collect();
        let subscription = cx.observe_global::<workbench_api::BufferEdits>(|this, cx| this.attached_buffers_changed(cx));
        self.tab_watch = Some(TabWatch { generations, _settle: None, _subscription: subscription });
    }

    fn attached_tab_paths(&self) -> Vec<PathBuf> {
        self.attachments
            .iter()
            .filter_map(|attachment| match attachment {
                Attachment::Context { reference: crate::context_refs::ContextRef::Tab { path: Some(path), .. }, .. } => Some(path.clone()),
                _ => None,
            })
            .collect()
    }

    /// An open editor changed: when it holds an attached file, its text is read again once the
    /// edits pause.
    fn attached_buffers_changed(&mut self, cx: &mut Context<Self>) {
        let attached = self.attached_tab_paths();
        if attached.is_empty() {
            self.tab_watch = None;
            return;
        }
        let Some(watch) = &mut self.tab_watch else { return };
        let generations: HashMap<PathBuf, u64> = attached.into_iter().map(|path| (workbench_api::buffer_generation(&path, cx), path)).map(|(generation, path)| (path, generation)).collect();
        if generations == watch.generations {
            return;
        }
        watch.generations = generations;
        watch._settle = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(TAB_SETTLE).await;
            this.update(cx, |this, cx| {
                if this.apply_tab_texts(|path| workbench_api::buffer_text(path, cx)) {
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    pub(crate) fn remove_attachment(&mut self, index: usize, cx: &mut Context<Self>) {
        if index < self.attachments.len() {
            self.attachments.remove(index);
            cx.notify();
        }
    }

    /// Removes several attachments at once, as a group's Clear or an item attached twice.
    pub(crate) fn remove_attachments(&mut self, indices: &[usize], cx: &mut Context<Self>) {
        let mut indices = indices.to_vec();
        indices.sort_unstable();
        indices.dedup();
        for index in indices.into_iter().rev() {
            if index < self.attachments.len() {
                self.attachments.remove(index);
            }
        }
        if attachment_groups_closed(&self.attachments, self.open_attachment_group) {
            self.open_attachment_group = None;
        }
        cx.notify();
    }

    pub(crate) fn remove_queued(&mut self, index: usize, cx: &mut Context<Self>) {
        if index < self.queue.len() {
            let removed = self.queue.remove(index);
            if self.queued_edit.as_ref().is_some_and(|edit| edit.id == removed.id) {
                self.queued_edit = None;
            }
            cx.notify();
        }
    }

    pub(crate) fn move_queued(&mut self, from: usize, to: usize, cx: &mut Context<Self>) {
        if from < self.queue.len() && to < self.queue.len() && from != to {
            let queued = self.queue.remove(from);
            self.queue.insert(to, queued);
            cx.notify();
        }
    }

    /// "Send now": while a turn runs the prompt goes first and the turn stops, so it starts as
    /// soon as the stopped turn winds down; a held queue sends it on its own.
    pub(crate) fn send_queued_now(&mut self, index: usize, cx: &mut Context<Self>) {
        if index >= self.queue.len() {
            return;
        }
        let now = web_time::Instant::now();
        if self.send_now_at.is_some_and(|at| now.duration_since(at) < SEND_NOW_SETTLE) {
            return;
        }
        self.send_now_at = Some(now);
        if self.queued_edit.as_ref().is_some_and(|edit| edit.id == self.queue[index].id) {
            self.finish_queued_edit(true, cx);
        }
        if self.is_running() {
            self.move_queued(index, 0, cx);
            self.continue_queue = true;
            self.stop(cx);
            return;
        }
        let next = self.queue.remove(index);
        self.send_queued(next, cx);
    }

    pub(crate) fn edit_queued(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(queued) = self.queue.get(index) else { return };
        let id = queued.id;
        let text = queued.text.clone();
        let input = cx.new(|cx| ui::TextInput::new(window, cx).appearance(ui::InputAppearance::Bare));
        input.update(cx, |input, cx| input.set_text(text, cx));
        let subscription = cx.subscribe(&input, |this: &mut Self, _, event: &ui::TextInputEvent, cx| match event {
            ui::TextInputEvent::Confirmed => this.finish_queued_edit(true, cx),
            ui::TextInputEvent::Cancelled => this.finish_queued_edit(false, cx),
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        self.queued_edit = Some(QueuedEdit { id, input, _subscription: subscription });
        cx.notify();
    }

    /// Ends the edit, keeping the new text when `save`. A queue that stopped at this prompt when
    /// a turn ended goes on.
    pub(crate) fn finish_queued_edit(&mut self, save: bool, cx: &mut Context<Self>) {
        let Some(edit) = self.queued_edit.take() else { return };
        let text = edit.input.read(cx).text().trim().to_string();
        if save && let Some(queued) = self.queue.iter_mut().find(|queued| queued.id == edit.id) {
            if text.is_empty() && queued.attachments.is_empty() {
                self.queue.retain(|queued| queued.id != edit.id);
            } else {
                queued.text = text;
            }
        }
        if std::mem::take(&mut self.queue_held_for_edit) && !self.is_running() && !self.queue.is_empty() {
            let next = self.queue.remove(0);
            self.send_queued(next, cx);
        }
        cx.notify();
    }

    /// Whether the queue must wait for the user before sending its first prompt: it is being edited.
    pub(crate) fn queue_holds_for_edit(&mut self) -> bool {
        let held = self.queue.first().zip(self.queued_edit.as_ref()).is_some_and(|(next, edit)| next.id == edit.id);
        if held {
            self.queue_held_for_edit = true;
        }
        held
    }

    pub(crate) fn attach_image(&mut self, image: gpui::Image, cx: &mut Context<Self>) {
        if image.bytes.len() > MAX_IMAGE_BYTES {
            self.input_notice = Some("Images up to 5 MB can be attached".into());
            cx.notify();
            return;
        }
        let count = self.attachments.iter().filter(|attachment| matches!(attachment, Attachment::Image { .. })).count() + 1;
        let name = format!("Pasted image {count}.{}", image.format.extension());
        let data = base64::engine::general_purpose::STANDARD.encode(&image.bytes);
        self.add_attachment(Attachment::Image { name, media_type: image.format.mime_type().to_string(), data });
        self.input_notice = None;
        cx.notify();
    }

    /// Dropped or pasted files: images go along as images, other files as mentions.
    pub(crate) fn attach_paths(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        for path in paths {
            match mentions::image_media_type(&path) {
                Some(media_type) => match std::fs::read(&path) {
                    Ok(bytes) if bytes.len() <= MAX_IMAGE_BYTES => {
                        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "image".into());
                        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        self.add_attachment(Attachment::Image { name, media_type: media_type.to_string(), data });
                    }
                    Ok(_) => self.input_notice = Some("Images up to 5 MB can be attached".into()),
                    Err(error) => self.input_notice = Some(format!("Could not read {}: {error}", path.display())),
                },
                None if path.is_file() => self.add_attachment(Attachment::File(path)),
                None => {}
            }
        }
        cx.notify();
    }

    pub(crate) fn load_project_files(&mut self, cx: &mut Context<Self>) {
        if self.project_files.is_some() || self.loading_files.is_some() {
            return;
        }
        let Some(root) = self.info.cwd.clone() else {
            self.project_files = Some(Arc::new(Vec::new()));
            return;
        };
        self.loading_files = Some(cx.spawn(async move |this, cx| {
            let files = cx.background_spawn(async move { project_files(&root) }).await;
            this.update(cx, |this, cx| {
                this.project_files = Some(Arc::new(files));
                this.project_files_listed(cx);
                this.loading_files = None;
                if this.completion.is_some() || this.composer.read(cx).text().contains('@') {
                    this.update_completion(cx);
                }
            })
            .ok();
        }));
    }

    /// The project files the app's file index found for `query`, once it has answered; asks it
    /// when the query changed (`useFffSearch`). `None` while the files listed for mentions rank
    /// instead: before anything is typed, while the index searches, and in tests.
    fn search_project_files(&mut self, query: &str, cx: &mut Context<Self>) -> Option<Arc<Vec<String>>> {
        let root = self.info.cwd.clone()?;
        if query.trim().is_empty() {
            self.file_search = None;
            self.searching_files = None;
            return None;
        }
        if let Some((searched, found)) = &self.file_search
            && searched == query
        {
            return found.clone();
        }
        let search = palette::search_project_files(vec![root.clone()], query.to_string(), MENU_FILES * 4, cx)?;
        self.file_search = Some((query.to_string(), None));
        let query = query.to_string();
        self.searching_files = Some(cx.spawn(async move |this, cx| {
            let found = search.await;
            this.update(cx, |this, cx| {
                if this.file_search.as_ref().is_none_or(|(searched, _)| *searched != query) {
                    return;
                }
                let found: Vec<String> = found
                    .into_iter()
                    .filter_map(|path| Some(path.strip_prefix(&root).ok()?.to_string_lossy().into_owned()))
                    .collect();
                this.file_search = Some((query, Some(Arc::new(found))));
                this.searching_files = None;
                if this.completion.is_some() {
                    this.update_completion(cx);
                }
            })
            .ok();
        }));
        None
    }

    /// Attaches a skill to the next prompt, as picking it with `/` does.
    pub fn attach_skill(&mut self, skill: &crate::skills::Skill, cx: &mut Context<Self>) {
        self.add_attachment(Attachment::Skill { title: skill.title.clone(), content: skill.content.clone() });
        cx.notify();
    }

    pub(crate) fn load_skills(&mut self, cx: &mut Context<Self>) {
        if self.skills.is_some() || self.loading_skills.is_some() {
            return;
        }
        let settings = cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).ai_skills.clone()).unwrap_or_default();
        let extension_skills = crate::skills::extension_skills(cx);
        let roots = crate::skills::SkillRoots::new(self.info.cwd.clone());
        self.loading_skills = Some(cx.spawn(async move |this, cx| {
            let skills = cx.background_spawn(async move { crate::skills::load(&settings, &roots, &extension_skills) }).await;
            this.update(cx, |this, cx| {
                this.skills = Some(Arc::new(skills));
                this.loading_skills = None;
                if this.completion.is_some() || this.composer.read(cx).text().contains('/') {
                    this.update_completion(cx);
                }
            })
            .ok();
        }));
    }

    pub(crate) fn load_saved_sessions(&mut self, cx: &mut Context<Self>) {
        if self.saved_sessions.is_some() || self.loading_sessions.is_some() {
            return;
        }
        let Some(dir) = crate::persistence::sessions_dir() else {
            self.saved_sessions = Some(Arc::new(Vec::new()));
            return;
        };
        self.loading_sessions = Some(cx.spawn(async move |this, cx| {
            let sessions = cx.background_spawn(async move { history::list(&dir) }).await;
            this.update(cx, |this, cx| {
                this.saved_sessions = Some(Arc::new(sessions));
                this.loading_sessions = None;
                this.project_files_listed(cx);
                if this.completion.is_some() {
                    this.update_completion(cx);
                }
            })
            .ok();
        }));
    }
}

/// The project's files for mentions, relative, as the agent's own listing sees them: ignored
/// files and credentials left out.
fn project_files(root: &std::path::Path) -> Vec<String> {
    let mut files = Vec::new();
    let mut offset = 0;
    while files.len() < MAX_PROJECT_FILES {
        let options = ai_tools::ListOptions { offset: Some(offset), limit: Some(2000), ..Default::default() };
        let Ok(page) = ai_tools::list_files(root, &options) else { break };
        files.extend(page.files);
        match page.next_offset {
            Some(next) => offset = next,
            None => break,
        }
    }
    files
}

/// What an agent can take besides text.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct PromptSupport {
    pub images: bool,
    pub embedded_context: bool,
}

/// The prompt's content blocks: the text, then mentioned files as links, earlier sessions as
/// embedded summaries, and images. Returns notes about what had to be left out.
pub(crate) fn prompt_blocks(text: &str, attachments: &[Attachment], support: PromptSupport) -> (Vec<acp::ContentBlock>, Vec<String>) {
    let mut blocks = vec![acp::ContentBlock::Text(acp::TextContent::new(text.to_string()))];
    let mut notes = Vec::new();
    let contexts: Vec<&str> = attachments
        .iter()
        .filter_map(|attachment| match attachment {
            Attachment::Context { content, .. } => Some(content.as_str()),
            _ => None,
        })
        .collect();
    let (mut fitted, _, _) = crate::context_budget::apply_attachment_budget(contexts, crate::context_budget::DEFAULT_ATTACHMENT_BUDGET);
    fitted.reverse();
    for attachment in attachments {
        match attachment {
            Attachment::File(path) => {
                let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                let link = acp::ResourceLink::new(name, format!("file://{}", path.display()));
                let link = match mentions::acp_mime_type(path) {
                    Some(mime_type) => link.mime_type(mime_type.to_string()),
                    None => link,
                };
                blocks.push(acp::ContentBlock::ResourceLink(link));
            }
            Attachment::Session { id, title } => {
                let summary = history::load(id).map(|transcript| history::summary(&transcript, SESSION_SUMMARY_CHARS)).unwrap_or_else(|| format!("# {title}\n(The session's transcript is gone.)"));
                if support.embedded_context {
                    let contents = acp::TextResourceContents::new(summary, format!("athas-session://{id}")).mime_type("text/markdown".to_string());
                    blocks.push(acp::ContentBlock::Resource(acp::EmbeddedResource::new(acp::EmbeddedResourceResource::TextResourceContents(contents))));
                } else {
                    blocks.push(acp::ContentBlock::Text(acp::TextContent::new(format!("\n\nEarlier session for context:\n{summary}"))));
                }
            }
            Attachment::Skill { title, content } => {
                blocks.push(acp::ContentBlock::Text(acp::TextContent::new(format!("\n\n{}", crate::skills::prompt_text(title, content)))));
            }
            Attachment::Context { reference: crate::context_refs::ContextRef::Selection { path, start_line, end_line, text }, .. } if support.embedded_context => {
                fitted.pop();
                let uri = format!("file://{}#L{start_line}:{end_line}", path.display());
                let contents = acp::TextResourceContents::new(text.clone(), uri).mime_type(mentions::acp_mime_type(path).unwrap_or("text/plain").to_string());
                blocks.push(acp::ContentBlock::Resource(acp::EmbeddedResource::new(acp::EmbeddedResourceResource::TextResourceContents(contents))));
            }
            Attachment::Context { label, content, .. } => {
                let fitted = fitted.pop().filter(|fitted| fitted.truncated);
                match fitted {
                    Some(fitted) if fitted.content.is_empty() => notes.push(format!("{label} was left out: the attachments fill this message's budget")),
                    Some(fitted) => blocks.push(acp::ContentBlock::Text(acp::TextContent::new(format!("\n\n{label}:\n{}", fitted.content)))),
                    None => blocks.push(acp::ContentBlock::Text(acp::TextContent::new(format!("\n\n{label}:\n{content}")))),
                }
            }
            Attachment::Image { name, media_type, data } => {
                if support.images {
                    blocks.push(acp::ContentBlock::Image(acp::ImageContent::new(data.clone(), media_type.clone())));
                } else {
                    notes.push(format!("{name} was left out: this agent does not read images"));
                }
            }
        }
    }
    (blocks, notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_carry_links_sessions_and_images_the_agent_takes() {
        let attachments = vec![
            Attachment::File("/p/src/main.rs".into()),
            Attachment::Session { id: "missing-session".into(), title: "Old work".into() },
            Attachment::Image { name: "shot.png".into(), media_type: "image/png".into(), data: "AAAA".into() },
        ];
        let (blocks, notes) = prompt_blocks("Look", &attachments, PromptSupport { images: true, embedded_context: true });
        assert_eq!(blocks.len(), 4);
        assert!(matches!(&blocks[1], acp::ContentBlock::ResourceLink(link) if link.uri == "file:///p/src/main.rs" && link.name == "main.rs"));
        assert!(matches!(&blocks[2], acp::ContentBlock::Resource(_)));
        assert!(matches!(&blocks[3], acp::ContentBlock::Image(image) if image.mime_type == "image/png"));
        assert!(notes.is_empty());

        let (blocks, notes) = prompt_blocks("Look", &attachments, PromptSupport::default());
        assert_eq!(blocks.len(), 3);
        assert!(matches!(&blocks[2], acp::ContentBlock::Text(text) if text.text.contains("Old work")));
        assert_eq!(notes, ["shot.png was left out: this agent does not read images"]);
    }

    #[test]
    fn mentions_list_project_files_without_ignored_ones() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/main.rs"), "").unwrap();
        std::fs::write(dir.path().join(".env"), "SECRET=1").unwrap();
        std::fs::write(dir.path().join(".gitignore"), "target\n").unwrap();
        std::fs::create_dir_all(dir.path().join("target")).unwrap();
        std::fs::write(dir.path().join("target/out"), "").unwrap();
        let files = project_files(dir.path());
        assert!(files.contains(&"src/main.rs".to_string()));
        assert!(!files.iter().any(|file| file.contains(".env") || file.starts_with("target")));
    }
}

fn attachment_groups_closed(attachments: &[Attachment], open: Option<crate::attachment_groups::Kind>) -> bool {
    open.is_some_and(|kind| !crate::attachment_groups::groups(attachments).iter().any(|group| group.kind == kind))
}
