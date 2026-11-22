//! Local history (`commands/project/local_history.rs`, `features/local-history`): a snapshot of
//! a file each time it is saved, the last 50 per file, to look back at and restore.

use std::{
    fs,
    path::{Path, PathBuf},
    rc::Rc,
};

use anyhow::{Context as _, Result, bail};
use ui::scale::px;
use gpui::{AnyElement, App, Context, Entity, Focusable, SharedString, Subscription, Window, div, prelude::*,};
use palette::{FuzzyMatch, Picker, PickerDelegate, fuzzy_match};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonTone, ButtonVariant, Icon, IconName, IconSize, InputAppearance, TextInput, TextInputEvent, metrics, typography};
use workspace::now_ms;

/// `formatRelativeDate` (compact): "4m ago", "1h ago", "yesterday", "3d ago", then the date.
fn compact_age(created_at: u64, now: u64) -> String {
    use chrono::TimeZone as _;
    let at = |ms: u64| chrono::Local.timestamp_millis_opt(ms as i64).single();
    match (at(created_at), at(now)) {
        (Some(then), Some(now)) => util::date::format_compact_relative_date(then, now, &Default::default()),
        _ => String::new(),
    }
}

const MAX_ENTRIES_PER_FILE: usize = 50;
/// Autosaves record at most this often, so typing does not fill the history.
const AUTO_SAVE_MIN_INTERVAL_MS: u64 = 30_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LocalHistoryEntry {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64,
    pub size: u64,
    pub content_hash: String,
    /// `save`, `auto-save`, `before-restore`, …
    pub reason: String,
    pub label: Option<String>,
}

/// Where snapshots live: one folder per file, named by the hash of its path.
pub struct LocalHistory {
    root: PathBuf,
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl LocalHistory {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The browser has no data folder; the web build keeps no local history.
    #[cfg(target_family = "wasm")]
    pub fn default_location() -> Option<Self> {
        None
    }

    #[cfg(not(target_family = "wasm"))]
    pub fn default_location() -> Option<Self> {
        dirs::data_dir().map(|dir| Self::new(dir.join(paths::APP_ID).join("local_history")))
    }

    fn file_dir(&self, file: &Path) -> PathBuf {
        self.root.join(sha256_hex(file.to_string_lossy().as_bytes()))
    }

    fn snapshot_path(dir: &Path, id: &str) -> PathBuf {
        dir.join("snapshots").join(id)
    }

    /// Where a snapshot's bytes are kept, for comparing without copying them.
    pub fn snapshot_file(&self, file: &Path, id: &str) -> PathBuf {
        Self::snapshot_path(&self.file_dir(file), id)
    }

    fn read_entries(dir: &Path) -> Result<Vec<LocalHistoryEntry>> {
        let path = dir.join("entries.json");
        if !path.exists() {
            return Ok(Vec::new());
        }
        Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
    }

    fn write_entries(dir: &Path, entries: &[LocalHistoryEntry]) -> Result<()> {
        fs::create_dir_all(dir)?;
        fs::write(dir.join("entries.json"), serde_json::to_string_pretty(entries)?)?;
        Ok(())
    }

    /// Snapshots the file as it is on disk; nothing when it matches the latest snapshot.
    pub fn record(&self, file: &Path, reason: &str, label: Option<&str>) -> Result<Option<LocalHistoryEntry>> {
        if !file.is_file() {
            bail!("Local history is only available for files");
        }
        let content = fs::read(file).context("reading the file")?;
        let content_hash = sha256_hex(&content);
        let dir = self.file_dir(file);
        let mut entries = Self::read_entries(&dir)?;
        let now = now_ms();
        if let Some(latest) = entries.first() {
            if latest.content_hash == content_hash {
                return Ok(None);
            }
            if reason == "auto-save" && now.saturating_sub(latest.created_at) < AUTO_SAVE_MIN_INTERVAL_MS {
                return Ok(None);
            }
        }
        fs::create_dir_all(dir.join("snapshots"))?;
        let id = format!("{now}-{}", &content_hash[..12]);
        fs::write(Self::snapshot_path(&dir, &id), &content)?;
        let entry = LocalHistoryEntry {
            id,
            file_path: file.to_string_lossy().into_owned(),
            file_name: file.file_name().map_or("Untitled".into(), |name| name.to_string_lossy().into_owned()),
            created_at: now,
            size: content.len() as u64,
            content_hash,
            reason: reason.to_string(),
            label: label.map(str::trim).filter(|label| !label.is_empty()).map(str::to_string),
        };
        entries.insert(0, entry.clone());
        for removed in entries.split_off(entries.len().min(MAX_ENTRIES_PER_FILE)) {
            fs::remove_file(Self::snapshot_path(&dir, &removed.id)).ok();
        }
        Self::write_entries(&dir, &entries)?;
        Ok(Some(entry))
    }

    pub fn list(&self, file: &Path) -> Result<Vec<LocalHistoryEntry>> {
        Self::read_entries(&self.file_dir(file))
    }

    pub fn read(&self, file: &Path, id: &str) -> Result<Vec<u8>> {
        let dir = self.file_dir(file);
        if !Self::read_entries(&dir)?.iter().any(|entry| entry.id == id) {
            bail!("Local history entry not found");
        }
        Ok(fs::read(Self::snapshot_path(&dir, id))?)
    }

    /// Writes a snapshot back over the file, keeping what it replaces as a snapshot first.
    pub fn restore(&self, file: &Path, id: &str) -> Result<()> {
        // `restore-local-history.ts`: only local files, and never one that is read-only.
        anyhow::ensure!(!file.to_string_lossy().contains("://"), "Local history can only restore local files.");
        anyhow::ensure!(!fs::metadata(file).is_ok_and(|metadata| metadata.permissions().readonly()), "This file is read-only.");
        let content = self.read(file, id)?;
        #[cfg(not(target_family = "wasm"))]
        let disk = fs::read(file).ok();
        self.record(file, "before-restore", None)?;
        // Text goes through the checked writer (`writeText(path, content, diskContent)`): the
        // file must still hold what was just kept, and a symlink, BOM and permissions survive.
        #[cfg(not(target_family = "wasm"))]
        if let (Some(Ok(disk)), Ok(text)) = (disk.map(String::from_utf8), String::from_utf8(content.clone())) {
            let expected = athas_project::local_fs::ExpectedFileDigest::of(&disk);
            return athas_project::local_fs::write_text_checked(file, Some(expected), text).map_err(|error| anyhow::anyhow!(error));
        }
        let temporary = file.with_extension("athas-restore.tmp");
        fs::write(&temporary, content)?;
        fs::rename(&temporary, file)?;
        Ok(())
    }

    pub fn rename(&self, file: &Path, id: &str, label: Option<&str>) -> Result<()> {
        let dir = self.file_dir(file);
        let mut entries = Self::read_entries(&dir)?;
        let entry = entries.iter_mut().find(|entry| entry.id == id).context("Local history entry not found")?;
        entry.label = label.map(str::trim).filter(|label| !label.is_empty()).map(str::to_string);
        Self::write_entries(&dir, &entries)
    }

    pub fn delete(&self, file: &Path, id: &str) -> Result<()> {
        let dir = self.file_dir(file);
        let mut entries = Self::read_entries(&dir)?;
        let before = entries.len();
        entries.retain(|entry| entry.id != id);
        if entries.len() == before {
            bail!("Local history entry not found");
        }
        fs::remove_file(Self::snapshot_path(&dir, id)).ok();
        Self::write_entries(&dir, &entries)
    }
}

fn format_size(bytes: u64) -> String {
    match bytes {
        b if b < 1024 => format!("{b} B"),
        b if b < 1024 * 1024 => format!("{:.1} KB", b as f64 / 1024.0),
        b => format!("{:.1} MB", b as f64 / 1024.0 / 1024.0),
    }
}

fn format_snapshot_date(created_at: u64) -> String {
    chrono::DateTime::from_timestamp_millis(created_at as i64)
        .map(|date| util::date::format_short_date_time(date.with_timezone(&chrono::Local)))
        .unwrap_or_default()
}

/// `getEntryTitle`: the entry's name, else when it was taken.
pub fn entry_title(entry: &LocalHistoryEntry) -> String {
    entry.label.as_deref().map(str::trim).filter(|label| !label.is_empty()).map_or_else(|| format_snapshot_date(entry.created_at), str::to_string)
}

/// Two files for the workbench to show as a diff: `old` and `new` on disk, named after `file`.
pub struct DiffRequest {
    pub title: String,
    pub file: PathBuf,
    pub old: PathBuf,
    pub new: PathBuf,
}

/// A snapshot to show as a read-only document titled `file (date)`.
pub struct SnapshotRequest {
    pub id: String,
    pub title: String,
    pub file: PathBuf,
    pub text: String,
}

type FileCallback = Rc<dyn Fn(&Path, &mut Window, &mut App)>;
type SnapshotCallback = Rc<dyn Fn(SnapshotRequest, &mut Window, &mut App)>;
type TextCallback = Rc<dyn Fn(&Path, &App) -> Option<String>>;
type DiffCallback = Rc<dyn Fn(DiffRequest, &mut Window, &mut App)>;
/// Asks for a line of text: title, message, initial value, and what to do with the answer.
type PromptCallback = Rc<dyn Fn(String, String, String, Box<dyn Fn(String, &mut Window, &mut App)>, &mut Window, &mut App)>;

/// The file's snapshots, newest first (`LocalHistoryCommandContent`): Enter opens one; each row
/// can open, compare with the current file or the previous snapshot, restore, rename and delete.
pub struct LocalHistoryDelegate {
    file: PathBuf,
    history: Rc<LocalHistory>,
    entries: Vec<LocalHistoryEntry>,
    matches: Vec<(usize, FuzzyMatch)>,
    selected: usize,
    query: String,
    on_restored: FileCallback,
    on_open: Option<SnapshotCallback>,
    current_text: Option<TextCallback>,
    on_diff: Option<DiffCallback>,
    on_prompt: Option<PromptCallback>,
    /// The snapshot whose name is being edited in its row (`InlineRenameInput`).
    renaming: Option<Renaming>,
}

struct Renaming {
    id: String,
    input: Entity<TextInput>,
    opened: std::time::Instant,
    _subscription: Subscription,
}

/// A closing menu or a click can take focus for a moment right after the field opens; losing it
/// then is not leaving the field (`RENAME_FOCUS_SETTLE_MS`).
const RENAME_FOCUS_SETTLE: std::time::Duration = std::time::Duration::from_millis(250);

impl LocalHistoryDelegate {
    pub fn new(file: PathBuf, history: Rc<LocalHistory>, on_restored: impl Fn(&Path, &mut Window, &mut App) + 'static) -> Self {
        let entries = history.list(&file).unwrap_or_default();
        Self {
            file,
            history,
            entries,
            matches: Vec::new(),
            selected: 0,
            query: String::new(),
            on_restored: Rc::new(on_restored),
            on_open: None,
            current_text: None,
            on_diff: None,
            on_prompt: None,
            renaming: None,
        }
    }

    /// Opens a snapshot as a read-only document.
    pub fn on_open(mut self, open: impl Fn(SnapshotRequest, &mut Window, &mut App) + 'static) -> Self {
        self.on_open = Some(Rc::new(open));
        self
    }

    /// The file's text in an open editor, unsaved edits included (`getCurrentContent`).
    pub fn on_current_text(mut self, text: impl Fn(&Path, &App) -> Option<String> + 'static) -> Self {
        self.current_text = Some(Rc::new(text));
        self
    }

    pub fn on_diff(mut self, diff: impl Fn(DiffRequest, &mut Window, &mut App) + 'static) -> Self {
        self.on_diff = Some(Rc::new(diff));
        self
    }

    pub fn on_prompt(mut self, prompt: impl Fn(String, String, String, Box<dyn Fn(String, &mut Window, &mut App)>, &mut Window, &mut App) + 'static) -> Self {
        self.on_prompt = Some(Rc::new(prompt));
        self
    }

    fn file_name(&self) -> String {
        self.file.file_name().map_or_else(|| "file".to_string(), |name| name.to_string_lossy().into_owned())
    }

    fn entry(&self, index: usize) -> Option<&LocalHistoryEntry> {
        self.matches.get(index).and_then(|(entry, _)| self.entries.get(*entry))
    }

    fn reload(&mut self, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        self.entries = self.history.list(&self.file).unwrap_or_default();
        let query = self.query.clone();
        self.update_matches(&query, window, cx);
        cx.notify();
    }

    fn open_snapshot(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let (Some(entry), Some(open)) = (self.entry(index).cloned(), self.on_open.clone()) else { return false };
        match self.history.read(&self.file, &entry.id) {
            Ok(content) => {
                let title = format!("{} ({})", self.file_name(), format_snapshot_date(entry.created_at));
                let text = String::from_utf8_lossy(&content).into_owned();
                open(SnapshotRequest { id: entry.id, title, file: self.file.clone(), text }, window, cx);
                true
            }
            Err(error) => {
                notifications::error(cx, "Failed to open snapshot", Some(format!("{error:#}").into()));
                false
            }
        }
    }

    fn open_diff(&self, title: String, old: PathBuf, new: PathBuf, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(diff) = self.on_diff.clone() else { return false };
        if fs::read(&old).ok() == fs::read(&new).ok() {
            notifications::info(cx, "No changes to compare.");
            return false;
        }
        diff(DiffRequest { title, file: self.file.clone(), old, new }, window, cx);
        true
    }

    fn compare_with_current(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(entry) = self.entry(index).cloned() else { return false };
        let title = format!("{}: {} vs Current", self.file_name(), entry_title(&entry));
        let old = self.history.snapshot_file(&self.file, &entry.id);
        let unsaved = self.current_text.as_ref().and_then(|text| text(&self.file, cx));
        let new = match unsaved.map(|text| self.write_current(&entry.id, text)) {
            None => self.file.clone(),
            Some(Ok(path)) => path,
            Some(Err(error)) => {
                notifications::error(cx, "Failed to compare snapshot", Some(format!("{error:#}").into()));
                return false;
            }
        };
        self.open_diff(title, old, new, window, cx)
    }

    /// The editor's text, written beside the snapshots' temporary copies for the diff to read.
    fn write_current(&self, id: &str, text: String) -> Result<PathBuf> {
        let dir = std::env::temp_dir().join("athas-local-history").join("current").join(id);
        fs::create_dir_all(&dir)?;
        let path = dir.join(self.file_name());
        fs::write(&path, text)?;
        Ok(path)
    }

    fn compare_with_previous(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(entry) = self.entry(index).cloned() else { return false };
        let position = self.entries.iter().position(|candidate| candidate.id == entry.id);
        let Some(previous) = position.and_then(|position| self.entries.get(position + 1)).cloned() else {
            notifications::info(cx, "No previous local history entry.");
            return false;
        };
        let title = format!("{}: {} vs {}", self.file_name(), entry_title(&previous), entry_title(&entry));
        let old = self.history.snapshot_file(&self.file, &previous.id);
        let new = self.history.snapshot_file(&self.file, &entry.id);
        self.open_diff(title, old, new, window, cx)
    }

    fn restore(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(entry) = self.entry(index).cloned() else { return false };
        match self.history.restore(&self.file, &entry.id) {
            Ok(()) => {
                (self.on_restored)(&self.file, window, cx);
                true
            }
            Err(error) => {
                notifications::error(cx, "Failed to restore snapshot", Some(format!("{error:#}").into()));
                false
            }
        }
    }

    fn delete(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        let Some(entry) = self.entry(index).cloned() else { return };
        if let Err(error) = self.history.delete(&self.file, &entry.id) {
            notifications::error(cx, "Failed to delete snapshot", Some(format!("{error:#}").into()));
        }
        self.reload(window, cx);
    }

    /// Asks for a name and hands it to `apply`; the picker closes while the prompt is up, so
    /// `apply` runs with the history and file alone.
    fn prompt(&self, title: &str, message: &str, value: String, apply: impl Fn(&LocalHistory, &Path, String, &mut App) + 'static, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(prompt) = self.on_prompt.clone() else { return false };
        let (history, file) = (self.history.clone(), self.file.clone());
        prompt(title.to_string(), message.to_string(), value, Box::new(move |answer, _, cx| apply(&history, &file, answer, cx)), window, cx);
        true
    }

    fn create_entry(&mut self, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        self.prompt(
            "Create Local History Entry",
            "Name this local history entry:",
            String::new(),
            |history, file, label, cx| match history.record(file, "manual", Some(label.trim())) {
                Ok(Some(_)) => {}
                Ok(None) => {
                    notifications::info(cx, "No file changes to snapshot.");
                }
                Err(error) => {
                    notifications::error(cx, "Failed to create snapshot", Some(format!("{error:#}").into()));
                }
            },
            window,
            cx,
        )
    }

    /// Turns the snapshot's title into a field holding its name; the picker stays open.
    fn rename(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        let Some(entry) = self.entry(index).cloned() else { return false };
        let input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx).appearance(InputAppearance::Bare).placeholder("Entry name");
            input.set_text(entry.label.clone().unwrap_or_default(), cx);
            input.select_all_text(cx);
            input
        });
        let subscription = cx.subscribe_in(&input, window, |picker, input, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => picker.delegate.finish_rename(true, window, cx),
            TextInputEvent::Cancelled => picker.delegate.finish_rename(false, window, cx),
            TextInputEvent::Blurred => {
                let settling = picker.delegate.renaming.as_ref().is_some_and(|renaming| renaming.opened.elapsed() < RENAME_FOCUS_SETTLE);
                if settling {
                    let handle = input.focus_handle(cx);
                    window.defer(cx, move |window, cx| window.focus(&handle, cx));
                } else {
                    picker.delegate.finish_rename(true, window, cx);
                }
            }
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        self.renaming = Some(Renaming { id: entry.id, input, opened: std::time::Instant::now(), _subscription: subscription });
        cx.notify();
        false
    }

    /// Saves the name typed (an empty one clears it) or drops it, and gives focus back to the search.
    fn finish_rename(&mut self, save: bool, window: &mut Window, cx: &mut Context<Picker<Self>>) {
        let Some(renaming) = self.renaming.take() else { return };
        if save {
            let label = renaming.input.read(cx).text().trim().to_string();
            let label = (!label.is_empty()).then_some(label);
            if let Err(error) = self.history.rename(&self.file, &renaming.id, label.as_deref()) {
                notifications::error(cx, "Failed to rename snapshot", Some(format!("{error:#}").into()));
            }
        }
        self.reload(window, cx);
        let picker = cx.entity();
        window.defer(cx, move |window, cx| {
            let handle = picker.focus_handle(cx);
            window.focus(&handle, cx);
        });
    }

    fn row_actions(&self, index: usize, cx: &mut Context<Picker<Self>>) -> AnyElement {
        type Run = fn(&mut LocalHistoryDelegate, usize, &mut Window, &mut Context<Picker<LocalHistoryDelegate>>) -> bool;
        let mut buttons: Vec<(&'static str, IconName, &'static str, Run)> = Vec::new();
        if self.on_open.is_some() {
            buttons.push(("open", IconName::Eye, "Open snapshot", Self::open_snapshot));
        }
        if self.on_diff.is_some() {
            buttons.push(("current", IconName::ArrowsLeftRight, "Compare with current", Self::compare_with_current));
            buttons.push(("previous", IconName::History, "Compare with previous", Self::compare_with_previous));
        }
        buttons.push(("restore", IconName::ArrowCounterClockwise, "Restore snapshot", Self::restore));
        buttons.push(("rename", IconName::Pen, "Rename snapshot", Self::rename));
        div()
            .flex()
            .items_center()
            .flex_none()
            .gap(px(4.))
            .children(buttons.into_iter().map(|(id, icon, tooltip, run)| {
                Button::icon(SharedString::from(format!("local-history-{id}-{index}")), icon)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Medium)
                    .tooltip(tooltip)
                    .on_click(cx.listener(move |picker, _, window, cx| {
                        cx.stop_propagation();
                        if run(&mut picker.delegate, index, window, cx) {
                            picker.dismiss(window, cx);
                        }
                    }))
            }))
            .child(
                Button::icon(SharedString::from(format!("local-history-delete-{index}")), IconName::Trash)
                    .variant(ButtonVariant::Ghost)
                    .tone(ButtonTone::Danger)
                    .size(ButtonSize::Medium)
                    .tooltip("Delete snapshot")
                    .on_click(cx.listener(move |picker, _, window, cx| {
                        cx.stop_propagation();
                        picker.delegate.delete(index, window, cx);
                    })),
            )
            .into_any_element()
    }
}

impl PickerDelegate for LocalHistoryDelegate {
    fn placeholder(&self) -> SharedString {
        "Search timeline...".into()
    }

    fn match_count(&self) -> usize {
        self.matches.len()
    }

    fn selected_index(&self) -> usize {
        self.selected
    }

    fn set_selected_index(&mut self, index: usize, _: &mut Context<Picker<Self>>) {
        self.selected = index;
    }

    fn update_matches(&mut self, query: &str, _: &mut Window, _: &mut Context<Picker<Self>>) {
        self.query = query.to_string();
        let now = now_ms();
        self.matches = self
            .entries
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| {
                let text = format!(
                    "{} {} {} {} {}",
                    entry.file_name,
                    entry.label.clone().unwrap_or_default(),
                    entry.reason,
                    format_snapshot_date(entry.created_at),
                    compact_age(entry.created_at, now)
                );
                fuzzy_match(query, &text).map(|matched| (index, matched))
            })
            .collect();
        self.selected = self.selected.min(self.matches.len().saturating_sub(1));
    }

    fn render_match(&self, index: usize, selected: bool, _: &mut Window, cx: &mut Context<Picker<Self>>) -> AnyElement {
        let entry = &self.entries[self.matches[index].0];
        let mut description = format!("{} · {}", compact_age(entry.created_at, now_ms()), format_size(entry.size));
        if !entry.reason.is_empty() {
            description.push_str(&format!(" · {}", entry.reason));
        }
        // The original's own row (not a command item): 48px at least, 12px in, a grey
        // `bg-selected` fill on the keyboard row, the title over its age, size and reason in the
        // base size, and the actions as regular ghost icon buttons 4px apart.
        let colors = cx.theme().colors.clone();
        let title = match self.renaming.as_ref().filter(|renaming| renaming.id == entry.id) {
            Some(renaming) => div()
                .id("local-history-rename")
                .w_full()
                .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(|_, _, cx| cx.stop_propagation())
                .child(renaming.input.clone())
                .into_any_element(),
            None => div().truncate().text_color(colors.foreground).child(entry_title(entry)).into_any_element(),
        };
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .w_full()
            .min_h(px(48.))
            .mb(px(4.))
            .px(px(12.))
            .py(px(8.))
            .rounded(metrics::radius_lg())
            .text_size(typography::text_base())
            .map(|this| ui::sidebar_row(this, selected, false, cx))
            .child(Icon::new(IconName::History).size(IconSize::Small).color(colors.subtle_foreground))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(title)
                    .child(div().truncate().text_color(colors.subtle_foreground).child(description)),
            )
            .child(self.row_actions(index, cx))
            .into_any_element()
    }

    fn confirm(&mut self, index: usize, window: &mut Window, cx: &mut Context<Picker<Self>>) -> bool {
        if self.on_open.is_some() { self.open_snapshot(index, window, cx) } else { self.restore(index, window, cx) }
    }

    fn empty_message(&self) -> SharedString {
        "No local history snapshots".into()
    }

    fn leading_icon(&self) -> IconName {
        IconName::History
    }

    /// "Local History: main.tsx" over the file's path, as the original's header.
    fn title(&self) -> Option<(SharedString, Option<SharedString>)> {
        let name = self.file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        Some((format!("Local History: {name}").into(), Some(self.file.display().to_string().into())))
    }

    fn header_actions(&self, _: &mut Window, cx: &mut Context<Picker<Self>>) -> Vec<AnyElement> {
        if self.on_prompt.is_none() {
            return Vec::new();
        }
        vec![
            Button::icon("local-history-create", IconName::Plus)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip("Create entry")
                .on_click(cx.listener(|picker, _, window, cx| {
                    if picker.delegate.create_entry(window, cx) {
                        picker.dismiss(window, cx);
                    }
                }))
                .into_any_element(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn restore_writes_through_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let history = LocalHistory::new(dir.path().join("history"));
        let target = dir.path().join("target.txt");
        let link = dir.path().join("link.txt");
        fs::write(&target, "one").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let first = history.record(&link, "save", None).unwrap().unwrap();
        fs::write(&target, "two").unwrap();
        history.restore(&link, &first.id).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink(), "the link stays a link");
        assert_eq!(fs::read_to_string(&target).unwrap(), "one");
    }

    #[test]
    fn restore_refuses_read_only_files() {
        let dir = tempfile::tempdir().unwrap();
        let history = LocalHistory::new(dir.path().join("history"));
        let file = dir.path().join("locked.txt");
        fs::write(&file, "one").unwrap();
        let first = history.record(&file, "save", None).unwrap().unwrap();
        let mut permissions = fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions.clone()).unwrap();
        assert_eq!(history.restore(&file, &first.id).unwrap_err().to_string(), "This file is read-only.");
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        fs::set_permissions(&file, permissions).unwrap();
        let remote = Path::new("remote://box/home/a.txt");
        assert_eq!(history.restore(remote, "x").unwrap_err().to_string(), "Local history can only restore local files.");
    }

    #[test]
    fn records_lists_restores_and_prunes() {
        let dir = tempfile::tempdir().unwrap();
        let history = LocalHistory::new(dir.path().join("history"));
        let file = dir.path().join("a.txt");
        fs::write(&file, "one").unwrap();
        assert!(history.record(&file, "save", None).unwrap().is_some());
        assert!(history.record(&file, "save", None).unwrap().is_none(), "same content records nothing");
        fs::write(&file, "two").unwrap();
        let second = history.record(&file, "save", Some("checkpoint")).unwrap().unwrap();
        assert!(history.record(&file, "auto-save", None).unwrap().is_none());
        let entries = history.list(&file).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].label.as_deref(), Some("checkpoint"));

        let first = entries[1].id.clone();
        history.restore(&file, &first).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "one");
        assert_eq!(history.list(&file).unwrap().len(), 2, "the replaced content matched the latest snapshot");

        history.delete(&file, &second.id).unwrap();
        assert!(history.read(&file, &second.id).is_err());

        for index in 0..60 {
            fs::write(&file, format!("v{index}")).unwrap();
            history.record(&file, "save", None).unwrap();
        }
        assert_eq!(history.list(&file).unwrap().len(), MAX_ENTRIES_PER_FILE);
    }
}
