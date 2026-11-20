//! The Files tool: the project's folder tree in the sidebar (`features/file-explorer`).

use ui::TooltipExt as _;
mod env_template;
mod fs;
mod git_status;
mod gitignore;
mod icons;
mod model;
#[cfg(target_os = "macos")]
mod system;
mod undo;

use std::{
    any::Any,
    collections::{HashMap, HashSet, VecDeque},
    ops::Range,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::Context as _;
use futures::StreamExt as _;
use gpui::{
    Anchor, AnyElement, App, ClickEvent, ClipboardItem, Context, DismissEvent, Entity, EventEmitter, FocusHandle, Focusable, KeyBinding, KeyDownEvent, MouseButton, MouseDownEvent, Pixels, Point, Render, ScrollStrategy, SharedString,
    Subscription, Task, UniformListScrollHandle, WeakEntity, Window, actions, div, img, point, prelude::*, px, svg,
    uniform_list,
};
use theme::ActiveTheme;
use ui::{
    AlertDialog, Button, ButtonSize, ConfirmOptions, Dialog, EmptyState, Icon, IconName, IconSize, InputAppearance, MenuEntry, MenuItem,
    OpenMenu, Plane, TextInput, TextInputEvent, metrics, typography,
};
use web_time::Instant;

pub use fs::{Changes, DirEntry, Fs, local as local_fs};
pub use git_status::{GitFileStatus, GitStatusKind};
use git_status::GitStatusLookup;
use gitignore::{GITIGNORE, GitignoreRules};
use model::{Draft, HiddenPatterns, Row, SortOrder, TreeModel, ViewOptions};
use undo::{FileOperation, Trashed, UndoStack};

actions!(
    file_tree,
    [
        SelectNext,
        SelectPrevious,
        SelectPageDown,
        SelectPageUp,
        SelectFirst,
        SelectLast,
        ExpandSelected,
        CollapseSelected,
        ConfirmSelected,
        ToggleSelected,
        OpenSelected,
        RenameSelected,
        DeleteSelected,
        DeleteSelectedPermanently,
        TrashSelectedNow,
        CopyEntries,
        CutEntries,
        PasteEntries,
        /// Puts back what the last delete moved to the Trash, or reverses the last rename or move.
        UndoFileOperation,
        Cancel,
        /// Shift-Down: extends the selection to the next row.
        ExtendSelectionDown,
        /// Shift-Up: extends the selection to the previous row.
        ExtendSelectionUp,
        SelectAllEntries,
    ]
);

/// Rows start this far in, then step in by the indent size per level (`FILE_TREE_BASE_INDENT`).
const BASE_INDENT: f32 = 10.;
/// An indent guide runs this far right of its level's start, under the parent's icon.
const GUIDE_OFFSET: f32 = 7.;
const VIEWPORT_PADDING: Pixels = px(4.);
/// Icons are 1em of the row text.
const ICON_SIZE: Pixels = px(12.);
/// A lost focus this soon after a name field opens is a closing menu taking it back, not the
/// user leaving the field (`RENAME_FOCUS_SETTLE_MS`).
const EDIT_FOCUS_SETTLE: Duration = Duration::from_millis(400);
/// Typed letters within this long of each other extend one type-to-find prefix.
const TYPE_TO_FIND_RESET: Duration = Duration::from_millis(800);
/// A drag rests on a closed folder this long before it opens.
const DRAG_HOVER_EXPAND_DELAY: Duration = Duration::from_millis(550);
/// The pointer rests on a folder this long before its size is measured.
const DIRECTORY_SIZE_HOVER_DELAY: Duration = Duration::from_millis(250);
/// A measured folder size is reused for this long.
const DIRECTORY_SIZE_CACHE_DURATION: Duration = Duration::from_secs(5 * 60);
const MAX_CONCURRENT_DIRECTORY_SCANS: usize = 2;
/// Open All Files stops collecting here.
const OPEN_ALL_FILES_LIMIT: usize = 1_000;
/// Opening more files than this asks first.
const OPEN_ALL_FILES_CONFIRM_ABOVE: usize = 100;

const MOVE_TO_TRASH: &str = if cfg!(target_os = "windows") { "Move to Recycle Bin" } else { "Move to Trash" };
const TRASH_NAME: &str = if cfg!(target_os = "windows") { "Recycle Bin" } else { "Trash" };
const REVEAL: &str = if cfg!(target_os = "macos") {
    "Reveal in Finder"
} else if cfg!(target_os = "windows") {
    "Reveal in File Explorer"
} else {
    "Open Containing Folder"
};

/// A context menu item's effect on the tree.
type TreeAction = Box<dyn Fn(&mut FileTree, &mut Window, &mut Context<FileTree>)>;
/// A preferences menu item's effect on the settings.
type SettingChange = fn(&mut FileTreeSettings);

/// Told of every batch a tree's watcher reports, with the tree's root: the search indexes take
/// their updates from it rather than watching the same files again (`file_events.rs`).
struct ChangeHook(std::rc::Rc<dyn Fn(&Path, &Changes, &mut App)>);

impl gpui::Global for ChangeHook {}

pub fn on_watched_changes(cx: &mut App, hook: impl Fn(&Path, &Changes, &mut App) + 'static) {
    cx.set_global(ChangeHook(std::rc::Rc::new(hook)));
}

/// Turns a path the OS file manager cannot open, such as a `wsl://` one, into one it can: `None`
/// for a path it does not handle.
type RevealResolver = std::rc::Rc<dyn Fn(&Path) -> Option<Result<PathBuf, String>>>;

struct RevealResolvers(Vec<RevealResolver>);

impl gpui::Global for RevealResolvers {}

/// Lets Reveal reach paths of another backend (the `wsl` crate's share paths).
pub fn register_reveal_resolver(cx: &mut App, resolver: impl Fn(&Path) -> Option<Result<PathBuf, String>> + 'static) {
    if !cx.has_global::<RevealResolvers>() {
        cx.set_global(RevealResolvers(Vec::new()));
    }
    cx.global_mut::<RevealResolvers>().0.push(std::rc::Rc::new(resolver));
}

/// The path the OS file manager shows for `path` (`handleRevealInFolder`): remote paths have
/// none, WSL paths become their Windows share path.
pub fn revealable_path(path: &Path, cx: &App) -> Result<PathBuf, String> {
    if path.to_string_lossy().starts_with("remote://") {
        return Err("Reveal in folder is only available for local workspaces.".into());
    }
    let resolvers = cx.try_global::<RevealResolvers>().map(|resolvers| resolvers.0.clone()).unwrap_or_default();
    resolvers.iter().find_map(|resolve| resolve(path)).unwrap_or_else(|| Ok(path.to_path_buf()))
}

/// Shows `path` in the OS file manager, through `revealable_path`.
pub fn reveal(path: &Path, cx: &mut App) -> Result<(), String> {
    let path = revealable_path(path, cx)?;
    cx.reveal_path(&path);
    Ok(())
}

/// Binds the tree's keys. `FileTree::new` calls it, so the workbench need not.
pub fn init(cx: &mut App) {
    ui::bind_keys_once(cx, "file_tree", bind_keys);
}

fn bind_keys(cx: &mut App) {
    let context = Some("FileTree");
    let mac = cfg!(target_os = "macos") || (cfg!(target_family = "wasm") && cx.platform_info().os == gpui::OperatingSystem::Mac);
    let mut bindings = vec![
        KeyBinding::new("down", SelectNext, context),
        KeyBinding::new("up", SelectPrevious, context),
        KeyBinding::new("pagedown", SelectPageDown, context),
        KeyBinding::new("pageup", SelectPageUp, context),
        KeyBinding::new("home", SelectFirst, context),
        KeyBinding::new("end", SelectLast, context),
        KeyBinding::new("right", ExpandSelected, context),
        KeyBinding::new("left", CollapseSelected, context),
        KeyBinding::new("enter", ConfirmSelected, context),
        KeyBinding::new("space", ToggleSelected, context),
        KeyBinding::new("f2", RenameSelected, context),
        KeyBinding::new("delete", DeleteSelected, context),
        KeyBinding::new("escape", Cancel, context),
        KeyBinding::new("shift-down", ExtendSelectionDown, context),
        KeyBinding::new("shift-up", ExtendSelectionUp, context),
    ];
    if mac {
        bindings.extend([
            KeyBinding::new("cmd-down", OpenSelected, context),
            KeyBinding::new("cmd-backspace", TrashSelectedNow, context),
            KeyBinding::new("alt-cmd-backspace", DeleteSelectedPermanently, context),
            KeyBinding::new("cmd-c", CopyEntries, context),
            KeyBinding::new("cmd-x", CutEntries, context),
            KeyBinding::new("cmd-v", PasteEntries, context),
            KeyBinding::new("cmd-z", UndoFileOperation, context),
            KeyBinding::new("cmd-a", SelectAllEntries, context),
        ]);
    } else {
        bindings.extend([
            KeyBinding::new("shift-delete", DeleteSelectedPermanently, context),
            KeyBinding::new("ctrl-c", CopyEntries, context),
            KeyBinding::new("ctrl-x", CutEntries, context),
            KeyBinding::new("ctrl-v", PasteEntries, context),
            KeyBinding::new("ctrl-z", UndoFileOperation, context),
            KeyBinding::new("ctrl-a", SelectAllEntries, context),
        ]);
    }
    cx.bind_keys(bindings);
}

#[derive(Clone, Debug, PartialEq)]
pub enum FileTreeEvent {
    /// A file was picked: open it in the centre.
    OpenFile(PathBuf),
    /// An entry was renamed or moved: tabs of it and of files inside it follow.
    Moved { from: PathBuf, to: PathBuf },
    /// Entries were trashed or deleted: their tabs, and those of files inside them, close.
    Deleted(Vec<PathBuf>),
    /// Open All Files: these files open in tabs.
    OpenFiles(Vec<PathBuf>),
    /// Open in Terminal: a terminal starts in this folder.
    OpenTerminal(PathBuf),
    /// Find in Folder: project search, limited to this folder.
    FindInFolder(PathBuf),
    /// Local History of this file.
    ShowLocalHistory(PathBuf),
    /// Add Folder to Workspace: pick a folder to list beside the project's.
    AddFolderToWorkspace,
    /// Remove Folder from Workspace: stop listing this added folder.
    RemoveFolderFromWorkspace(PathBuf),
    /// A confirmation (Open All Files, Overwrite Env File) to show over the window.
    Confirm(Entity<AlertDialog>),
    /// A file's Properties, to show over the window.
    ShowProperties(Entity<PropertiesDialog>),
}

/// The Files preferences (`file-explorer-preferences-menu.tsx`), with Athas's defaults.
#[derive(Clone, Debug, PartialEq)]
pub struct FileTreeSettings {
    pub view: ViewOptions,
    pub show_icons: bool,
    pub show_folder_arrows: bool,
    pub show_indent_guides: bool,
    pub indent_size: f32,
    pub confirm_delete: bool,
    pub auto_reveal: bool,
    pub show_git_status: bool,
    /// `uiFontSize`: the rows' text size.
    pub font_size: f32,
}

impl Default for FileTreeSettings {
    fn default() -> Self {
        Self {
            view: ViewOptions::default(),
            show_icons: true,
            show_folder_arrows: false,
            show_indent_guides: true,
            indent_size: 16.,
            confirm_delete: true,
            auto_reveal: true,
            show_git_status: true,
            font_size: 13.,
        }
    }
}

impl FileTreeSettings {
    /// The tree's part of `settings.json`; hidden patterns are relative to `root`.
    pub fn from_settings(settings: &settings::Settings, root: &Path) -> Self {
        Self {
            view: ViewOptions {
                sort_order: SortOrder::from_setting(&settings.file_tree_sort_order),
                show_hidden: settings.show_hidden_files_in_file_tree,
                show_ignored: settings.show_gitignored_files_in_file_tree,
                compact_folders: settings.compact_folders_in_file_tree,
                hide_root: settings.hide_root_folder_in_file_tree,
                hidden_patterns: HiddenPatterns::new(root, &settings.hidden_file_patterns, &settings.hidden_directory_patterns),
            },
            show_icons: settings.show_file_icons_in_file_tree,
            show_folder_arrows: settings.show_folder_arrows_in_file_tree,
            show_indent_guides: settings.show_indent_guides_in_file_tree,
            indent_size: settings.file_tree_indent_size.clamp(8., 32.) as f32,
            confirm_delete: settings.confirmbefore_file_delete,
            auto_reveal: settings.auto_reveal_active_file_in_file_tree,
            show_git_status: settings.show_git_status_in_file_tree,
            font_size: settings.ui_font_size.clamp(10., 24.) as f32,
        }
    }

    /// Writes the preferences menu's toggles back to `settings.json`.
    fn write_to(&self, settings: &mut settings::Settings) {
        settings.file_tree_sort_order = match self.view.sort_order {
            SortOrder::FoldersFirst => "folders-first".into(),
            SortOrder::Name => "name".into(),
        };
        settings.show_hidden_files_in_file_tree = self.view.show_hidden;
        settings.show_gitignored_files_in_file_tree = self.view.show_ignored;
        settings.compact_folders_in_file_tree = self.view.compact_folders;
        settings.hide_root_folder_in_file_tree = self.view.hide_root;
        settings.show_file_icons_in_file_tree = self.show_icons;
        settings.show_folder_arrows_in_file_tree = self.show_folder_arrows;
        settings.show_indent_guides_in_file_tree = self.show_indent_guides;
        settings.file_tree_indent_size = self.indent_size as f64;
        settings.confirmbefore_file_delete = self.confirm_delete;
    }
}

#[derive(Clone, Debug, PartialEq)]
enum EditKind {
    NewFile,
    NewFolder,
    Rename(PathBuf),
}

/// An open name field: a new entry's, or a rename's.
struct Edit {
    kind: EditKind,
    parent: PathBuf,
    input: Entity<TextInput>,
    opened: Instant,
    _subscription: Subscription,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum ClipboardOp {
    Copy,
    Cut,
}

struct FileClipboard {
    op: ClipboardOp,
    paths: Vec<PathBuf>,
}

#[derive(Clone)]
struct PendingDelete {
    paths: Vec<PathBuf>,
    permanent: bool,
}

/// What the Properties dialog shows of a file.
#[derive(Clone, Debug, PartialEq)]
pub struct Properties {
    pub file_name: String,
    pub path: String,
    pub size: String,
    pub kind: String,
}

/// A file's Properties (the context menu's dialog): its name, path, size and type.
pub struct PropertiesDialog {
    properties: Properties,
    focus_handle: FocusHandle,
}

impl PropertiesDialog {
    pub fn new(properties: Properties, cx: &mut Context<Self>) -> Self {
        Self { properties, focus_handle: cx.focus_handle() }
    }

    pub fn properties(&self) -> &Properties {
        &self.properties
    }
}

impl EventEmitter<DismissEvent> for PropertiesDialog {}

impl Focusable for PropertiesDialog {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for PropertiesDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let this = cx.entity().downgrade();
        let properties = &self.properties;
        let rows = [("File", &properties.file_name), ("Path", &properties.path), ("Size", &properties.size), ("Type", &properties.kind)];
        Dialog::new("files-properties", "Properties")
            .icon(IconName::Info)
            .track_focus(&self.focus_handle)
            .on_close(move |_, cx| {
                this.update(cx, |_, cx| cx.emit(DismissEvent)).ok();
            })
            .child(div().flex().flex_col().gap(px(8.)).text_size(typography::TEXT_BASE).children(rows.into_iter().map(|(label, value)| {
                div()
                    .flex()
                    .gap(px(12.))
                    .child(div().flex_none().w(px(72.)).text_color(colors.subtle_foreground).child(label))
                    .child(div().flex_1().min_w_0().text_color(colors.foreground).child(value.clone()))
            })))
    }
}

/// A tree row being dragged (`use-file-explorer-drag-drop.ts`): onto a folder it moves there,
/// onto an editor group a file opens in it.
#[derive(Clone, Debug)]
pub struct DraggedEntry {
    pub path: PathBuf,
    pub is_dir: bool,
    name: String,
    /// Everything dragged when the row is part of a selection, `path` among them.
    pub paths: Vec<(PathBuf, bool)>,
}

impl DraggedEntry {
    /// The dragged entries with whether each is a folder.
    pub fn sources(&self) -> impl Iterator<Item = (&Path, bool)> {
        let single = self.paths.is_empty().then_some((self.path.as_path(), self.is_dir));
        single.into_iter().chain(self.paths.iter().map(|(path, is_dir)| (path.as_path(), *is_dir)))
    }
}

struct DraggedEntryPreview(DraggedEntry);

impl Render for DraggedEntryPreview {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        div()
            .px(px(8.))
            .py(px(3.))
            .rounded(metrics::RADIUS)
            .bg(colors.overlay)
            .shadow(cx.theme().shadows.popover.clone())
            .text_size(typography::TEXT_SM)
            .text_color(colors.foreground)
            .child(if self.0.paths.len() > 1 { format!("{} items", self.0.paths.len()) } else { self.0.name.clone() })
    }
}

/// `isInvalidDropTarget`: an entry cannot go onto itself or inside itself.
fn is_invalid_drop_target(target: &Path, dragged: &Path, is_dir: bool) -> bool {
    target == dragged || (is_dir && target.starts_with(dragged))
}

/// Measured folder sizes and the scans still to run (`use-directory-size.ts`).
#[derive(Default)]
struct DirectorySizes {
    measured: HashMap<PathBuf, (Instant, Option<u64>)>,
    queued: VecDeque<PathBuf>,
    active: usize,
}

impl DirectorySizes {
    fn size(&self, path: &Path) -> Option<u64> {
        self.measured
            .get(path)
            .filter(|(at, _)| at.elapsed() < DIRECTORY_SIZE_CACHE_DURATION)
            .and_then(|(_, size)| *size)
    }

    /// Queues `path` unless it is measured, being measured, or waiting.
    fn request(&mut self, path: PathBuf) -> bool {
        let fresh = self.measured.get(&path).is_some_and(|(at, _)| at.elapsed() < DIRECTORY_SIZE_CACHE_DURATION);
        if fresh || self.queued.contains(&path) {
            return false;
        }
        self.measured.remove(&path);
        self.queued.push_back(path);
        true
    }

    /// The next scans to start, keeping at most two running.
    fn next_scans(&mut self) -> Vec<PathBuf> {
        let mut started = Vec::new();
        while self.active < MAX_CONCURRENT_DIRECTORY_SCANS {
            let Some(path) = self.queued.pop_front() else { break };
            self.active += 1;
            started.push(path);
        }
        started
    }

    fn finish(&mut self, path: PathBuf, size: Option<u64>) {
        self.active = self.active.saturating_sub(1);
        self.measured.insert(path, (Instant::now(), size));
    }
}

pub struct FileTree {
    root: PathBuf,
    fs: Arc<dyn Fs>,
    model: TreeModel,
    gitignore: GitignoreRules,
    settings: FileTreeSettings,
    git_status: Option<GitStatusLookup>,
    rows: Vec<Row>,
    /// Where the keyboard is; also the row clicked last.
    selected: Option<PathBuf>,
    /// Rows picked with Shift or Command (two or more), else empty.
    multi: Vec<PathBuf>,
    /// Where a Shift range starts.
    anchor: Option<PathBuf>,
    /// The closed folder a drag rests on, and the timer that opens it.
    drag_hover: Option<(PathBuf, Task<()>)>,
    /// The entry open in the centre, highlighted while the tree is not focused.
    active: Option<PathBuf>,
    /// Shows the focus ring on the selected row; a click hides it again.
    keyboard_navigation: bool,
    loading: HashSet<PathBuf>,
    /// Folders asked for again while being read (a watcher event mid-read): read once more when
    /// the current read is back, since it may have missed the change.
    reload_after: HashSet<PathBuf>,
    root_error: Option<SharedString>,
    error: Option<SharedString>,
    edit: Option<Edit>,
    clipboard: Option<FileClipboard>,
    undo: UndoStack,
    pending_delete: Option<PendingDelete>,
    pending_reveal: Option<PathBuf>,
    /// Where each listed symlink points, for its row's tooltip.
    symlink_targets: HashMap<PathBuf, String>,
    directory_sizes: DirectorySizes,
    hovered: Option<PathBuf>,
    _directory_size_timer: Option<Task<()>>,
    open_menu: Option<OpenMenu>,
    type_to_find: (String, Option<Instant>),
    focus_handle: FocusHandle,
    scroll_handle: UniformListScrollHandle,
    _watcher: Option<Box<dyn Any>>,
    /// Watchers of folders added to the workspace, sending into the root watcher's channel.
    extra_watchers: HashMap<PathBuf, Box<dyn Any>>,
    watch_sender: futures::channel::mpsc::UnboundedSender<Changes>,
    _watch_task: Option<Task<()>>,
    _settings_subscription: Option<Subscription>,
}

impl EventEmitter<FileTreeEvent> for FileTree {}

impl Focusable for FileTree {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl FileTree {
    pub fn new(root: PathBuf, _: &mut Window, cx: &mut Context<Self>) -> Self {
        Self::with_fs(root, fs::local(), cx)
    }

    /// A tree over another backend, such as a remote project's.
    pub fn with_fs(root: PathBuf, fs: Arc<dyn Fs>, cx: &mut Context<Self>) -> Self {
        init(cx);
        let (sender, mut receiver) = futures::channel::mpsc::unbounded::<Changes>();
        let watch_sender = sender.clone();
        let watcher = fs
            .watch(
                &root,
                Box::new(move |changes| {
                    sender.unbounded_send(changes).ok();
                }),
            )
            .ok();
        let watch_task = cx.spawn(async move |this: WeakEntity<Self>, cx| {
            while let Some(mut changes) = receiver.next().await {
                while let Ok(more) = receiver.try_recv() {
                    changes.rescan |= more.rescan;
                    changes.paths.extend(more.paths);
                }
                let updated = this.update(cx, |this, cx| {
                    if let Some(hook) = cx.try_global::<ChangeHook>().map(|hook| hook.0.clone()) {
                        hook(&this.root, &changes, cx);
                    }
                    this.apply_changes(changes, cx)
                });
                if updated.is_err() {
                    break;
                }
            }
        });

        let settings = match cx.try_global::<settings::SettingsStore>() {
            Some(_) => FileTreeSettings::from_settings(settings::get(cx), &root),
            None => FileTreeSettings::default(),
        };
        let settings_subscription = cx.try_global::<settings::SettingsStore>().is_some().then(|| {
            cx.observe_global::<settings::SettingsStore>(|this: &mut Self, cx| {
                let settings = FileTreeSettings::from_settings(settings::get(cx), &this.root);
                if settings != this.settings {
                    this.set_settings(settings, cx);
                }
            })
        });
        let mut tree = Self {
            model: TreeModel::new(root.clone()),
            gitignore: GitignoreRules::new(root.clone()),
            root,
            fs,
            settings,
            git_status: None,
            rows: Vec::new(),
            selected: None,
            multi: Vec::new(),
            anchor: None,
            drag_hover: None,
            active: None,
            keyboard_navigation: false,
            loading: HashSet::new(),
            reload_after: HashSet::new(),
            root_error: None,
            error: None,
            edit: None,
            clipboard: None,
            undo: UndoStack::default(),
            pending_delete: None,
            pending_reveal: None,
            symlink_targets: HashMap::new(),
            directory_sizes: DirectorySizes::default(),
            hovered: None,
            _directory_size_timer: None,
            open_menu: None,
            type_to_find: (String::new(), None),
            focus_handle: cx.focus_handle(),
            scroll_handle: UniformListScrollHandle::new(),
            _watcher: watcher,
            extra_watchers: HashMap::new(),
            watch_sender,
            _watch_task: Some(watch_task),
            _settings_subscription: settings_subscription,
        };
        tree.load_dirs(vec![tree.root.clone()], cx);
        tree
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Lists the folders added to the workspace after the project's own, watching each.
    pub fn set_extra_roots(&mut self, roots: Vec<PathBuf>, cx: &mut Context<Self>) {
        if self.model.extra_roots() == roots.as_slice() {
            return;
        }
        for old in self.model.extra_roots().to_vec() {
            if !roots.contains(&old) {
                self.model.remove_root(&old);
                self.gitignore.forget(&old);
                self.extra_watchers.remove(&old);
            }
        }
        let mut added = Vec::new();
        for root in roots {
            if self.model.is_root(&root) {
                continue;
            }
            self.model.add_root(root.clone());
            let sender = self.watch_sender.clone();
            if let Ok(watcher) = self.fs.watch(&root, Box::new(move |changes| {
                sender.unbounded_send(changes).ok();
            })) {
                self.extra_watchers.insert(root.clone(), watcher);
            }
            added.push(root);
        }
        self.load_dirs(added, cx);
        self.rebuild(cx);
    }

    fn is_root(&self, path: &Path) -> bool {
        self.model.is_root(path)
    }

    pub fn settings(&self) -> &FileTreeSettings {
        &self.settings
    }

    pub fn set_settings(&mut self, settings: FileTreeSettings, cx: &mut Context<Self>) {
        self.settings = settings;
        self.rebuild(cx);
    }

    fn type_scale(&self) -> typography::UiTypography {
        typography::UiTypography { size: self.settings.font_size, ..Default::default() }
    }

    /// Whether the rows want git status colors (`showGitStatusInFileTree`).
    pub fn wants_git_status(&self) -> bool {
        self.settings.show_git_status
    }

    /// The repository's changes, colored on the rows when `showGitStatusInFileTree` is on.
    /// `None` when the project is not a repository.
    pub fn set_git_status(&mut self, status: Option<(PathBuf, Vec<GitFileStatus>)>, cx: &mut Context<Self>) {
        let lookup = status.map(|(repo_root, files)| GitStatusLookup::new(repo_root, &files));
        if lookup != self.git_status {
            self.git_status = lookup;
            cx.notify();
        }
    }

    /// Marks the file open in the centre and, with `autoRevealActiveFileInFileTree`, opens the
    /// folders down to it.
    pub fn set_active_file(&mut self, path: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.active == path {
            return;
        }
        self.active = path.clone();
        if !self.settings.auto_reveal {
            cx.notify();
            return;
        }
        if let Some(path) = path.filter(|path| path.starts_with(self.model.root_of(path))) {
            let unloaded = self.model.expand_to(&path);
            self.selected = Some(path.clone());
            self.pending_reveal = Some(path);
            self.load_dirs(unloaded, cx);
        }
        self.rebuild(cx);
    }

    /// The tool's buttons at the end of the sidebar's top row.
    pub fn render_header_actions(&mut self, _: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let button = |id: &'static str, icon: IconName, tooltip: &'static str| {
            Button::icon(id, icon).size(ButtonSize::Small).plane(Plane::Page).tooltip(tooltip)
        };
        let root = self.root.clone();
        let preferences_open = self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == "preferences");
        div()
            .flex()
            .items_center()
            .gap(px(2.))
            .child(button("files-new-file", IconName::FilePlus, "New File").on_click(cx.listener({
                let root = root.clone();
                move |this, _, window, cx| this.start_edit(EditKind::NewFile, root.clone(), window, cx)
            })))
            .child(button("files-new-folder", IconName::FolderPlus, "New Folder").on_click(cx.listener(
                move |this, _, window, cx| this.start_edit(EditKind::NewFolder, root.clone(), window, cx),
            )))
            .child(
                button("files-preferences", IconName::Sliders, "File explorer preferences")
                    .active(preferences_open)
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let position = event.position();
                        this.show_preferences(point(position.x + px(8.), position.y + px(8.)), window, cx);
                    })),
            )
            .child(
                button("files-refresh", IconName::ArrowClockwise, "Refresh")
                    .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
            )
            .child(button("files-collapse", IconName::ChevronDoubleUp, "Collapse All").on_click(cx.listener(
                |this, _, _, cx| {
                    this.model.collapse_all();
                    this.rebuild(cx);
                },
            )))
            .into_any_element()
    }

    // Loading and watching.

    /// Reads `dirs` (and their `.gitignore`) on the background executor.
    fn load_dirs(&mut self, dirs: Vec<PathBuf>, cx: &mut Context<Self>) {
        let mut fresh = Vec::new();
        for dir in dirs {
            if self.loading.insert(dir.clone()) {
                fresh.push(dir);
            } else {
                self.reload_after.insert(dir);
            }
        }
        let dirs = fresh;
        if dirs.is_empty() {
            return;
        }
        let fs = self.fs.clone();
        let root = self.root.clone();
        cx.spawn(async move |this, cx| {
            let results = cx
                .background_spawn(async move {
                    dirs.into_iter()
                        .map(|dir| {
                            let listing = fs.read_dir(&dir);
                            let has_gitignore = listing
                                .as_ref()
                                .is_ok_and(|entries| entries.iter().any(|entry| entry.name == GITIGNORE && !entry.is_dir));
                            let gitignore = has_gitignore.then(|| fs.read_to_string(&dir.join(GITIGNORE)).ok()).flatten();
                            let targets: Vec<(PathBuf, String)> = listing
                                .iter()
                                .flatten()
                                .filter(|entry| entry.is_symlink)
                                .filter_map(|entry| Some((entry.path.clone(), fs.symlink_target(&entry.path, &root)?)))
                                .collect();
                            (dir, listing, gitignore, targets)
                        })
                        .collect::<Vec<_>>()
                })
                .await;
            this.update(cx, |this, cx| {
                for (dir, listing, gitignore, targets) in results {
                    this.loading.remove(&dir);
                    match listing {
                        Ok(entries) => {
                            if dir == this.root {
                                this.root_error = None;
                            }
                            this.symlink_targets.retain(|path, _| path.parent() != Some(dir.as_path()));
                            this.symlink_targets.extend(targets);
                            this.model.set_listing(dir.clone(), entries);
                            this.gitignore.set(&dir, gitignore.as_deref());
                        }
                        Err(error) => {
                            if dir == this.root {
                                this.root_error = Some(format!("{error:#}").into());
                            } else {
                                this.model.forget(&dir);
                                this.gitignore.forget(&dir);
                            }
                        }
                    }
                }
                this.rebuild(cx);
                let again: Vec<PathBuf> = this.reload_after.iter().filter(|dir| !this.loading.contains(*dir)).cloned().collect();
                if !again.is_empty() {
                    this.reload_after.retain(|dir| !again.contains(dir));
                    this.load_dirs(again, cx);
                }
            })
            .ok();
        })
        .detach();
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        let mut dirs = self.model.loaded_dirs();
        dirs.push(self.root.clone());
        dirs.extend(self.model.extra_roots().iter().cloned());
        self.load_dirs(dirs, cx);
    }

    /// Re-reads the loaded folders a batch from the watcher touched.
    fn apply_changes(&mut self, changes: Changes, cx: &mut Context<Self>) {
        if changes.rescan {
            self.refresh(cx);
            return;
        }
        let mut dirs = HashSet::new();
        for path in &changes.paths {
            if let Some(parent) = path.parent().filter(|parent| self.model.is_loaded(parent)) {
                dirs.insert(parent.to_path_buf());
            }
            if self.model.is_loaded(path) {
                dirs.insert(path.clone());
            }
        }
        self.load_dirs(dirs.into_iter().collect(), cx);
    }

    /// Rebuilds the rows from the model after anything changed.
    fn rebuild(&mut self, cx: &mut Context<Self>) {
        let draft = self.edit.as_ref().and_then(|edit| match edit.kind {
            EditKind::NewFile | EditKind::NewFolder => {
                Some(Draft { parent: edit.parent.clone(), is_dir: edit.kind == EditKind::NewFolder })
            }
            EditKind::Rename(_) => None,
        });
        let gitignore = &self.gitignore;
        self.rows = self.model.rows(&self.settings.view, draft.as_ref(), &mut |path, is_dir| gitignore.is_ignored(path, is_dir));
        let reveal = match &self.pending_reveal {
            Some(path) => self.row_index(path),
            None => self.rows.iter().position(|row| row.draft),
        };
        if let Some(index) = reveal {
            self.pending_reveal = None;
            self.scroll_handle.scroll_to_item(index, ScrollStrategy::Nearest);
        } else if self.loading.is_empty() {
            // Everything has loaded and the row is not there (a filter hides it): stop waiting,
            // or a much later rebuild would scroll to it out of nowhere.
            self.pending_reveal = None;
        }
        cx.notify();
    }

    fn row_index(&self, path: &Path) -> Option<usize> {
        self.rows.iter().position(|row| !row.draft && row.path == path)
    }

    fn selected_index(&self) -> Option<usize> {
        self.selected.as_deref().and_then(|path| self.row_index(path))
    }

    fn selected_row(&self) -> Option<&Row> {
        self.selected_index().map(|index| &self.rows[index])
    }

    // Multi-selection (`file-tree-selection.ts`).

    fn clear_multi(&mut self, anchor: Option<PathBuf>) {
        self.multi.clear();
        self.anchor = anchor;
    }

    fn row_paths(&self) -> Vec<PathBuf> {
        self.rows.iter().filter(|row| !row.draft).map(|row| row.path.clone()).collect()
    }

    /// Shift-click or Shift-arrow: everything from the anchor to `target`.
    fn select_range_to(&mut self, target: &Path, cx: &mut Context<Self>) {
        let paths = self.row_paths();
        let anchor = self.anchor.clone().or_else(|| self.selected.clone());
        let (anchor, range) = model::range_selection(&paths, anchor.as_deref(), target);
        self.anchor = anchor;
        self.multi = range;
        self.selected = Some(target.to_path_buf());
        cx.notify();
    }

    /// Command-click: adds the row to the selection, or takes it out.
    fn toggle_in_selection(&mut self, path: &Path, cx: &mut Context<Self>) {
        let visible = self.selected.clone().filter(|selected| self.row_index(selected).is_some());
        let (multi, focus) = model::toggle_selection(&self.multi, visible.as_deref(), path);
        self.multi = multi;
        self.anchor = Some(path.to_path_buf());
        self.selected = Some(focus);
        cx.notify();
    }

    /// What an action on `path` applies to: the selection when `path` is part of it.
    fn action_targets(&self, path: &Path) -> Vec<PathBuf> {
        model::selection_targets(&self.multi, path)
    }

    fn extend_selection(&mut self, delta: isize, cx: &mut Context<Self>) {
        if self.edit.is_some() || self.rows.is_empty() {
            return;
        }
        if self.anchor.is_none() || self.multi.is_empty() {
            self.anchor = self.selected.clone();
        }
        self.move_selection(delta, cx);
        if let Some(target) = self.selected.clone() {
            self.select_range_to(&target, cx);
        }
    }

    fn extend_selection_down(&mut self, _: &ExtendSelectionDown, _: &mut Window, cx: &mut Context<Self>) {
        self.extend_selection(1, cx);
    }

    fn extend_selection_up(&mut self, _: &ExtendSelectionUp, _: &mut Window, cx: &mut Context<Self>) {
        self.extend_selection(-1, cx);
    }

    fn select_all_entries(&mut self, _: &SelectAllEntries, _: &mut Window, cx: &mut Context<Self>) {
        if self.edit.is_some() {
            return;
        }
        let paths = self.row_paths();
        if paths.len() > 1 {
            self.multi = paths;
            cx.notify();
        }
    }

    /// A drag resting on a closed folder opens it after a moment (`scheduleAutoExpand`).
    fn drag_hover(&mut self, dir: Option<PathBuf>, cx: &mut Context<Self>) {
        let dir = dir.filter(|dir| !self.model.is_expanded(dir));
        if self.drag_hover.as_ref().map(|(path, _)| path) == dir.as_ref() {
            return;
        }
        self.drag_hover = dir.map(|dir| {
            let open = dir.clone();
            let task = cx.spawn(async move |this, cx| {
                cx.background_executor().timer(DRAG_HOVER_EXPAND_DELAY).await;
                this.update(cx, |this, cx| {
                    this.drag_hover = None;
                    this.set_dir_expanded(&open, true, cx);
                })
                .ok();
            });
            (dir, task)
        });
    }

    /// A drag reaching the window's edge leaves as a system drag of the same files, which other
    /// apps can take, as Finder does (`handOffToNativeDrag`).
    fn drag_to_window_edge(&mut self, event: &gpui::DragMoveEvent<DraggedEntry>, window: &mut Window, cx: &mut Context<Self>) {
        let position = event.event.position;
        let size = window.viewport_size();
        if !model::at_window_edge((f32::from(position.x), f32::from(position.y)), (f32::from(size.width), f32::from(size.height))) {
            return;
        }
        let paths: Vec<PathBuf> =
            event.drag(cx).sources().map(|(path, _)| path.to_path_buf()).filter(|path| !path.to_string_lossy().contains("://")).collect();
        cx.stop_active_drag(window);
        self.drag_hover = None;
        if paths.is_empty() {
            return;
        }
        if let Err(error) = start_native_drag(window, &paths) {
            eprintln!("file tree: could not start a system drag: {error:#}");
        }
    }

    // Folders.

    fn toggle_dir(&mut self, path: &Path, cx: &mut Context<Self>) {
        let expand = !self.model.is_expanded(path);
        self.set_dir_expanded(path, expand, cx);
    }

    fn set_dir_expanded(&mut self, path: &Path, expanded: bool, cx: &mut Context<Self>) {
        self.model.set_expanded(path, expanded);
        if expanded && !self.model.is_loaded(path) {
            self.load_dirs(vec![path.to_path_buf()], cx);
        }
        self.rebuild(cx);
    }

    // Selection and keyboard.

    fn select_index(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(row) = self.rows.get(index).filter(|row| !row.draft) else { return };
        self.multi.clear();
        self.selected = Some(row.path.clone());
        self.keyboard_navigation = true;
        self.scroll_handle.scroll_to_item(index, ScrollStrategy::Nearest);
        cx.notify();
    }

    fn move_selection(&mut self, delta: isize, cx: &mut Context<Self>) {
        if self.edit.is_some() || self.rows.is_empty() {
            return;
        }
        let last = self.rows.len() as isize - 1;
        let target = match self.selected_index() {
            Some(index) => (index as isize + delta).clamp(0, last),
            None => 0,
        };
        self.select_index(target as usize, cx);
    }

    fn page_rows(&self) -> isize {
        let height = self.scroll_handle.0.borrow().base_handle.bounds().size.height;
        ((height / self.type_scale().row_height()).floor() as isize).max(1)
    }

    fn select_next(&mut self, _: &SelectNext, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(1, cx);
    }

    fn select_previous(&mut self, _: &SelectPrevious, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(-1, cx);
    }

    fn select_page_down(&mut self, _: &SelectPageDown, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(self.page_rows(), cx);
    }

    fn select_page_up(&mut self, _: &SelectPageUp, _: &mut Window, cx: &mut Context<Self>) {
        self.move_selection(-self.page_rows(), cx);
    }

    fn select_first(&mut self, _: &SelectFirst, _: &mut Window, cx: &mut Context<Self>) {
        if self.edit.is_none() {
            self.select_index(0, cx);
        }
    }

    fn select_last(&mut self, _: &SelectLast, _: &mut Window, cx: &mut Context<Self>) {
        if self.edit.is_none() && !self.rows.is_empty() {
            self.select_index(self.rows.len() - 1, cx);
        }
    }

    fn expand_selected(&mut self, _: &ExpandSelected, _: &mut Window, cx: &mut Context<Self>) {
        let Some(index) = self.selected_index().filter(|_| self.edit.is_none()) else { return };
        let row = self.rows[index].clone();
        if !row.is_dir {
            return;
        }
        if !row.expanded {
            self.set_dir_expanded(&row.path, true, cx);
        } else if self.rows.get(index + 1).is_some_and(|child| child.depth == row.depth + 1) {
            self.select_index(index + 1, cx);
        }
    }

    fn collapse_selected(&mut self, _: &CollapseSelected, _: &mut Window, cx: &mut Context<Self>) {
        let Some(index) = self.selected_index().filter(|_| self.edit.is_none()) else { return };
        let row = self.rows[index].clone();
        if row.is_dir && row.expanded {
            self.set_dir_expanded(&row.path, false, cx);
        } else if let Some(parent) = model::parent_row(&self.rows, index) {
            self.select_index(parent, cx);
        }
    }

    /// Return: renames on macOS, as Finder does, and opens elsewhere.
    fn confirm_selected(&mut self, _: &ConfirmSelected, window: &mut Window, cx: &mut Context<Self>) {
        if cfg!(target_os = "macos") {
            self.rename_selected(&RenameSelected, window, cx);
        } else {
            self.open_selected(&OpenSelected, window, cx);
        }
    }

    fn toggle_selected(&mut self, _: &ToggleSelected, window: &mut Window, cx: &mut Context<Self>) {
        self.open_selected(&OpenSelected, window, cx);
    }

    fn open_selected(&mut self, _: &OpenSelected, _: &mut Window, cx: &mut Context<Self>) {
        let Some(row) = self.selected_row().filter(|_| self.edit.is_none()).cloned() else { return };
        if row.is_dir {
            self.toggle_dir(&row.path, cx);
        } else {
            self.open_file(row.path, cx);
        }
    }

    fn rename_selected(&mut self, _: &RenameSelected, window: &mut Window, cx: &mut Context<Self>) {
        let Some(row) = self.selected_row().filter(|_| self.edit.is_none()).cloned() else { return };
        if !self.is_root(&row.path) {
            self.start_rename(row.path, window, cx);
        }
    }

    fn delete_selected(&mut self, _: &DeleteSelected, _: &mut Window, cx: &mut Context<Self>) {
        self.delete_selection(false, true, cx);
    }

    fn delete_selected_permanently(&mut self, _: &DeleteSelectedPermanently, _: &mut Window, cx: &mut Context<Self>) {
        self.delete_selection(true, true, cx);
    }

    /// Command-Delete moves to the Trash at once.
    fn trash_selected_now(&mut self, _: &TrashSelectedNow, _: &mut Window, cx: &mut Context<Self>) {
        self.delete_selection(false, false, cx);
    }

    fn delete_selection(&mut self, permanent: bool, confirm: bool, cx: &mut Context<Self>) {
        if self.edit.is_some() {
            return;
        }
        if let Some(path) = self.selected_row().map(|row| row.path.clone()) {
            self.request_delete(self.action_targets(&path), permanent, confirm, cx);
        }
    }

    fn copy_entries(&mut self, _: &CopyEntries, _: &mut Window, cx: &mut Context<Self>) {
        self.set_clipboard(ClipboardOp::Copy, cx);
    }

    fn cut_entries(&mut self, _: &CutEntries, _: &mut Window, cx: &mut Context<Self>) {
        self.set_clipboard(ClipboardOp::Cut, cx);
    }

    fn set_clipboard(&mut self, op: ClipboardOp, cx: &mut Context<Self>) {
        if let Some(path) = self.selected_row().filter(|row| !self.is_root(&row.path)).map(|row| row.path.clone()) {
            let paths = self.action_targets(&path).into_iter().filter(|path| !self.is_root(path)).collect();
            self.clipboard = Some(FileClipboard { op, paths });
            cx.notify();
        }
    }

    fn paste_entries(&mut self, _: &PasteEntries, _: &mut Window, cx: &mut Context<Self>) {
        let Some(row) = self.selected_row().cloned() else { return };
        let target = if row.is_dir { row.path } else { parent_of(&row.path) };
        self.paste_into(target, cx);
    }

    fn undo_file_operation(&mut self, _: &UndoFileOperation, _: &mut Window, cx: &mut Context<Self>) {
        if self.edit.is_some() {
            return;
        }
        let Some(operation) = self.undo.take_last() else { return };
        match operation {
            FileOperation::Trash(entries) => {
                let reload: Vec<PathBuf> = entries.iter().map(|entry| parent_of(&entry.original)).collect();
                self.run(
                    move |fs| {
                        let failures: Vec<String> = entries
                            .iter()
                            .rev()
                            .filter_map(|entry| {
                                fs.restore_from_trash(&entry.original, entry.trashed.as_deref()).err().map(|error| format!("{error:#}"))
                            })
                            .collect();
                        if !failures.is_empty() {
                            anyhow::bail!("Could not put back every item\n{}", failures.join("\n"));
                        }
                        Ok(())
                    },
                    reload,
                    |_, _, _| {},
                    cx,
                );
            }
            FileOperation::Move { from, to } => {
                let same_folder = from.parent() == to.parent();
                let (source, target) = (to.clone(), from.clone());
                self.run(
                    move |fs| {
                        let result = if same_folder { fs.rename(&source, &target) } else { fs.move_path(&source, &target) };
                        result.with_context(|| format!("Could not undo moving {}", display_name(&source)))
                    },
                    vec![parent_of(&from), parent_of(&to)],
                    move |tree, _, cx| {
                        tree.model.relocate(&to, &from);
                        tree.gitignore.forget(&to);
                        for path in [&mut tree.selected, &mut tree.active].into_iter().flatten() {
                            if let Some(moved) = model::relocate_path(path, &to, &from) {
                                *path = moved;
                            }
                        }
                        cx.emit(FileTreeEvent::Moved { from: to.clone(), to: from.clone() });
                    },
                    cx,
                );
            }
        }
    }

    fn cancel(&mut self, _: &Cancel, _: &mut Window, cx: &mut Context<Self>) {
        self.pending_delete = None;
        self.clear_multi(self.selected.clone());
        self.error = None;
        self.open_menu = None;
        cx.notify();
    }

    /// Letters jump to the next row whose name starts with what was typed.
    fn type_to_find(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let modifiers = &event.keystroke.modifiers;
        if !self.focus_handle.is_focused(window) || modifiers.control || modifiers.platform || modifiers.alt {
            return;
        }
        let Some(character) = event.keystroke.key_char.as_deref().filter(|c| c.chars().count() == 1 && *c != " ") else {
            return;
        };
        let now = Instant::now();
        let (prefix, last) = &mut self.type_to_find;
        if last.is_none_or(|last| now.duration_since(last) > TYPE_TO_FIND_RESET) {
            prefix.clear();
        }
        prefix.push_str(character);
        *last = Some(now);
        let prefix = prefix.clone();
        // A new prefix looks past the current row; a longer one may stay on it.
        let from = self.selected_index().map_or(0, |index| if prefix.chars().count() == 1 { index + 1 } else { index });
        if let Some(index) = model::find_by_prefix(&self.rows, &prefix, from) {
            self.select_index(index, cx);
        }
        cx.stop_propagation();
    }

    // Mouse.

    fn click_row(&mut self, row: &Row, event: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        cx.stop_propagation();
        window.focus(&self.focus_handle, cx);
        self.keyboard_navigation = false;
        let modifiers = event.modifiers();
        let toggle = if cfg!(target_os = "macos") { modifiers.platform } else { modifiers.control };
        if modifiers.shift {
            self.select_range_to(&row.path, cx);
            return;
        }
        if toggle {
            self.toggle_in_selection(&row.path, cx);
            return;
        }
        self.clear_multi(Some(row.path.clone()));
        self.selected = Some(row.path.clone());
        // A click is the user's own move: drop a reveal still waiting for its row, so a later
        // rebuild doesn't scroll away from where they are. `active` stays the file open in the
        // centre (a folder is never it): setting it here made the workbench's next sync look
        // like a new file, which selected and scrolled back to that file.
        self.pending_reveal = None;
        if row.is_dir {
            if event.click_count() < 2 {
                self.toggle_dir(&row.path, cx);
            }
        } else {
            self.open_file(row.path.clone(), cx);
        }
        cx.notify();
    }

    fn open_file(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.active = Some(path.clone());
        cx.emit(FileTreeEvent::OpenFile(path));
        cx.notify();
    }

    fn show_menu(
        &mut self,
        key: &str,
        entries: Vec<MenuEntry>,
        position: Point<Pixels>,
        anchor: Anchor,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.open_menu.as_ref().is_some_and(|menu| menu.key.as_ref() == key) {
            self.open_menu = None;
        } else {
            self.open_menu =
                Some(OpenMenu::new(key.to_string(), entries, position, anchor, window, cx, |this: &mut Self, _| {
                    this.open_menu = None
                }));
        }
        cx.notify();
    }

    fn context_menu(&mut self, path: PathBuf, is_dir: bool, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        cx.stop_propagation();
        if !self.multi.contains(&path) {
            self.clear_multi(Some(path.clone()));
        }
        self.selected = Some(path.clone());
        self.keyboard_navigation = false;
        let entries = self.context_menu_entries(path, is_dir, cx);
        self.open_menu = None;
        self.show_menu("context", entries, event.position, Anchor::TopLeft, window, cx);
    }

    /// The row menu (`use-file-explorer-context-menu.tsx`).
    fn context_menu_entries(&self, path: PathBuf, is_dir: bool, cx: &mut Context<Self>) -> Vec<MenuEntry> {
        let this = cx.weak_entity();
        let item = |label: &'static str, icon: IconName, action: TreeAction| {
            let this = this.clone();
            MenuItem::new(label).icon(icon).on_select(move |window, cx| {
                this.update(cx, |tree, cx| action(tree, window, cx)).ok();
            })
        };
        let is_root = self.is_root(&path);
        let is_extra_root = is_root && path != self.root;
        let mut entries: Vec<MenuEntry> = Vec::new();
        if is_dir {
            let dir = path.clone();
            entries.push(item("New File", IconName::FilePlus, Box::new(move |tree, window, cx| {
                tree.start_edit(EditKind::NewFile, dir.clone(), window, cx)
            })).into());
            let dir = path.clone();
            entries.push(item("New Folder", IconName::FolderPlus, Box::new(move |tree, window, cx| {
                tree.start_edit(EditKind::NewFolder, dir.clone(), window, cx)
            })).into());
            let dir = path.clone();
            entries.push(item("Refresh", IconName::ArrowClockwise, Box::new(move |tree, _, cx| {
                let dirs = tree.model.loaded_dirs().into_iter().filter(|loaded| loaded.starts_with(&dir)).collect();
                tree.load_dirs(dirs, cx)
            })).into());
            entries.push(item("Add Folder to Workspace", IconName::FolderPlus, Box::new(|_, _, cx| cx.emit(FileTreeEvent::AddFolderToWorkspace))).into());
            if is_extra_root {
                let dir = path.clone();
                entries.push(item("Remove Folder from Workspace", IconName::X, Box::new(move |_, _, cx| {
                    cx.emit(FileTreeEvent::RemoveFolderFromWorkspace(dir.clone()))
                })).into());
            }
            let dir = path.clone();
            entries.push(item("Open All Files", IconName::FolderOpen, Box::new(move |tree, _, cx| tree.open_all_files(dir.clone(), cx))).into());
            let dir = path.clone();
            entries.push(item("Collapse All", IconName::ChevronDoubleUp, Box::new(move |tree, _, cx| {
                tree.model.collapse_within(&dir);
                tree.rebuild(cx)
            })).into());
            let dir = path.clone();
            entries.push(item("Open in Terminal", IconName::TerminalWindow, Box::new(move |_, _, cx| cx.emit(FileTreeEvent::OpenTerminal(dir.clone())))).into());
            let dir = path.clone();
            entries.push(item("Find in Folder", IconName::Search, Box::new(move |_, _, cx| cx.emit(FileTreeEvent::FindInFolder(dir.clone())))).into());
        } else {
            let file = path.clone();
            entries.push(item("Open", IconName::FolderOpen, Box::new(move |tree, _, cx| tree.open_file(file.clone(), cx))).into());
            let file = path.clone();
            entries.push(item("Copy Content", IconName::Copy, Box::new(move |tree, _, cx| tree.copy_content(file.clone(), cx))).into());
            let file = path.clone();
            entries.push(item("Duplicate", IconName::FileText, Box::new(move |tree, _, cx| tree.duplicate(file.clone(), cx))).into());
            let file = path.clone();
            entries.push(item("Local History", IconName::History, Box::new(move |_, _, cx| cx.emit(FileTreeEvent::ShowLocalHistory(file.clone())))).into());
            let file_name = display_name(&path);
            if env_template::is_env_file_name(&file_name) && !path.to_string_lossy().starts_with("remote://") {
                entries.push(MenuEntry::Separator);
                let targets = env_template::ENV_TEMPLATE_TARGETS.iter().filter(|target| !target.file_name.eq_ignore_ascii_case(&file_name));
                for (index, target) in targets.enumerate() {
                    let (source, name) = (path.clone(), target.file_name);
                    let this = this.clone();
                    let entry = MenuItem::new(target.label).on_select(move |_, cx| {
                        this.update(cx, |tree, cx| tree.create_env_template(source.clone(), name, false, cx)).ok();
                    });
                    entries.push(if index == 0 { entry.icon(IconName::FilePlus) } else { entry }.into());
                }
            }
            let file = path.clone();
            entries.push(item("Properties", IconName::Info, Box::new(move |tree, _, cx| tree.show_properties(file.clone(), cx))).into());
        }
        entries.push(MenuEntry::Separator);

        let copy_path = path.to_string_lossy().into_owned();
        entries.push(
            MenuItem::new("Copy Path")
                .icon(IconName::Link)
                .on_select(move |_, cx| cx.write_to_clipboard(ClipboardItem::new_string(copy_path.clone())))
                .into(),
        );
        let relative = model::relative_path(&path, self.model.root_of(&path));
        entries.push(
            MenuItem::new("Copy Relative Path")
                .icon(IconName::FileText)
                .on_select(move |_, cx| cx.write_to_clipboard(ClipboardItem::new_string(relative.clone())))
                .into(),
        );
        let targets = self.action_targets(&path);
        if !is_root {
            let paths = targets.clone();
            entries.push(item("Copy", IconName::Copy, Box::new(move |tree, _, cx| {
                tree.clipboard = Some(FileClipboard { op: ClipboardOp::Copy, paths: paths.clone() });
                cx.notify()
            })).into());
            let paths = targets.clone();
            entries.push(item("Cut", IconName::Scissors, Box::new(move |tree, _, cx| {
                tree.clipboard = Some(FileClipboard { op: ClipboardOp::Cut, paths: paths.clone() });
                cx.notify()
            })).into());
        }
        if self.clipboard.is_some() {
            // On a file, paste lands next to it.
            let target = if is_dir { path.clone() } else { parent_of(&path) };
            entries.push(item("Paste", IconName::Clipboard, Box::new(move |tree, _, cx| tree.paste_into(target.clone(), cx))).into());
        }

        let reveal_path = path.clone();
        let reveal_tree = this.clone();
        let reveal = MenuItem::new(REVEAL).icon(IconName::Eye).on_select(move |_, cx| {
            if let Err(error) = crate::reveal(&reveal_path, cx) {
                reveal_tree.update(cx, |tree, cx| tree.show_error(error, cx)).ok();
            }
        });
        if is_root {
            entries.push(reveal.into());
            return entries;
        }
        #[cfg(target_os = "macos")]
        if !is_dir {
            let file = path.clone();
            entries.push(item("Quick Look", IconName::Eye, Box::new(move |tree, _, cx| {
                if let Err(error) = system::toggle_quick_look(&file) {
                    tree.show_error(format!("Unable to preview file: {error:#}"), cx);
                }
            })).into());
            let file = path.clone();
            entries.push(item("Share…", IconName::SquareArrowUp, Box::new(move |tree, window, cx| {
                if let Err(error) = share(window, &file) {
                    tree.show_error(format!("Unable to share file: {error:#}"), cx);
                }
            })).into());
        }
        let target = path.clone();
        entries.push(item("Rename", IconName::Pen, Box::new(move |tree, window, cx| tree.start_rename(target.clone(), window, cx))).into());
        entries.push(reveal.into());
        entries.push(MenuEntry::Separator);
        let paths = targets.clone();
        entries.push(item(MOVE_TO_TRASH, IconName::Trash, Box::new(move |tree, _, cx| {
            tree.request_delete(paths.clone(), false, true, cx)
        })).into());
        let this = this.clone();
        entries.push(
            MenuItem::new("Delete Immediately…")
                .destructive()
                .on_select(move |_, cx| {
                    this.update(cx, |tree, cx| tree.request_delete(targets.clone(), true, true, cx)).ok();
                })
                .into(),
        );
        entries
    }

    /// The header's preferences (`file-explorer-preferences-menu.tsx`).
    fn show_preferences(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.weak_entity();
        let settings = self.settings.clone();
        let toggle = |label: &'static str, checked: bool, change: fn(&mut FileTreeSettings)| -> MenuEntry {
            let this = this.clone();
            MenuItem::new(label)
                .checked(checked)
                .on_select(move |_, cx| {
                    this.update(cx, |tree, cx| {
                        let mut settings = tree.settings.clone();
                        change(&mut settings);
                        if cx.try_global::<settings::SettingsStore>().is_some() {
                            settings::update(cx, |stored| settings.write_to(stored));
                        }
                        tree.set_settings(settings, cx);
                    })
                    .ok();
                })
                .into()
        };
        let mut entries = vec![
            MenuEntry::Label("Visibility".into()),
            toggle("Hidden Files", settings.view.show_hidden, |s| s.view.show_hidden ^= true),
            toggle("Gitignored Files", settings.view.show_ignored, |s| s.view.show_ignored ^= true),
            MenuEntry::Label("Appearance".into()),
            toggle("File Icons", settings.show_icons, |s| s.show_icons ^= true),
            toggle("Folder Arrows", settings.show_folder_arrows, |s| s.show_folder_arrows ^= true),
            toggle("Indent Guides", settings.show_indent_guides, |s| s.show_indent_guides ^= true),
            toggle("Compact Folders", settings.view.compact_folders, |s| s.view.compact_folders ^= true),
            toggle("Hide Root Folder", settings.view.hide_root, |s| s.view.hide_root ^= true),
            MenuEntry::Label("Sort Order".into()),
            toggle("Folders First", settings.view.sort_order == SortOrder::FoldersFirst, |s| {
                s.view.sort_order = SortOrder::FoldersFirst
            }),
            toggle("Name", settings.view.sort_order == SortOrder::Name, |s| s.view.sort_order = SortOrder::Name),
            MenuEntry::Label("Indentation".into()),
        ];
        let sizes: [(&'static str, f32, SettingChange); 4] = [
            ("Compact", 12., |s| s.indent_size = 12.),
            ("Default", 16., |s| s.indent_size = 16.),
            ("Spacious", 20., |s| s.indent_size = 20.),
            ("Wide", 24., |s| s.indent_size = 24.),
        ];
        for (label, size, change) in sizes {
            entries.push(toggle(label, settings.indent_size == size, change));
        }
        entries.push(MenuEntry::Separator);
        entries.push(toggle("Confirm Before Delete", settings.confirm_delete, |s| s.confirm_delete ^= true));
        self.show_menu("preferences", entries, position, Anchor::TopRight, window, cx);
    }

    // Name fields.

    /// Opens a new file's name field in the selected folder, or the root (`file.new`).
    pub fn new_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let parent = self
            .selected
            .as_ref()
            .and_then(|path| self.rows.iter().find(|row| !row.draft && row.path == *path))
            .map(|row| if row.is_dir { row.path.clone() } else { parent_of(&row.path) })
            .unwrap_or_else(|| self.root.clone());
        self.start_edit(EditKind::NewFile, parent, window, cx);
    }

    fn start_edit(&mut self, kind: EditKind, parent: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
        self.edit = None;
        self.pending_delete = None;
        let is_dir = kind == EditKind::NewFolder;
        let current_name = match &kind {
            EditKind::Rename(path) => path.file_name().map(|name| name.to_string_lossy().into_owned()),
            _ => None,
        };
        let input = cx.new(|cx| {
            let mut input = TextInput::new(window, cx)
                .appearance(InputAppearance::Bare)
                .placeholder(if is_dir { "folder name" } else { "file name" });
            if let Some(name) = current_name {
                input.set_text(name, cx);
                input.select_all_text(cx);
            }
            input
        });
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => this.commit_edit(window, cx),
            TextInputEvent::Cancelled => this.cancel_edit(window, cx),
            TextInputEvent::Blurred => {
                let Some(edit) = &this.edit else { return };
                if edit.opened.elapsed() < EDIT_FOCUS_SETTLE {
                    let input = edit.input.clone();
                    window.defer(cx, move |window, cx| {
                        let handle = input.focus_handle(cx);
                        window.focus(&handle, cx);
                    });
                } else {
                    this.commit_edit(window, cx);
                }
            }
            _ => {}
        });
        let input_focus = input.focus_handle(cx);
        window.focus(&input_focus, cx);
        if !matches!(kind, EditKind::Rename(_)) {
            let unloaded = self.model.expand_dir(&parent);
            self.load_dirs(unloaded, cx);
        }
        if let EditKind::Rename(path) = &kind {
            self.pending_reveal = Some(path.clone());
        }
        self.edit = Some(Edit { kind, parent, input, opened: Instant::now(), _subscription: subscription });
        self.rebuild(cx);
    }

    fn start_rename(&mut self, path: PathBuf, window: &mut Window, cx: &mut Context<Self>) {
        let parent = parent_of(&path);
        self.selected = Some(path.clone());
        self.start_edit(EditKind::Rename(path), parent, window, cx);
    }

    fn cancel_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.edit = None;
        window.focus(&self.focus_handle, cx);
        self.rebuild(cx);
    }

    fn commit_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(edit) = self.edit.take() else { return };
        let name = edit.input.read(cx).text().trim().to_string();
        if edit.input.read(cx).focus_handle(cx).is_focused(window) {
            window.focus(&self.focus_handle, cx);
        }
        self.rebuild(cx);
        match edit.kind {
            EditKind::Rename(from) => {
                let unchanged = from.file_name().is_some_and(|current| current.to_string_lossy() == name);
                if name.is_empty() || unchanged {
                    return;
                }
                if let Some(problem) = model::validate_name(&name) {
                    self.show_error(problem, cx);
                    return;
                }
                let to = edit.parent.join(&name);
                let (source, target) = (from.clone(), to.clone());
                self.run(
                    move |fs| fs.rename(&source, &target),
                    vec![edit.parent.clone()],
                    move |tree, _, cx| {
                        tree.model.relocate(&from, &to);
                        tree.gitignore.forget(&from);
                        for path in [&mut tree.selected, &mut tree.active].into_iter().flatten() {
                            if let Some(moved) = model::relocate_path(path, &from, &to) {
                                *path = moved;
                            }
                        }
                        if to.is_dir() || tree.model.is_loaded(&to) {
                            tree.load_dirs(vec![to.clone()], cx);
                        }
                        tree.undo.record(FileOperation::Move { from: from.clone(), to: to.clone() });
                        cx.emit(FileTreeEvent::Moved { from: from.clone(), to: to.clone() });
                    },
                    cx,
                );
            }
            kind => {
                if name.is_empty() {
                    return;
                }
                if let Some(problem) = model::validate_name(&name) {
                    self.show_error(problem, cx);
                    return;
                }
                let is_dir = kind == EditKind::NewFolder;
                let path = edit.parent.join(&name);
                let target = path.clone();
                self.run(
                    move |fs| {
                        if fs.exists(&target) {
                            anyhow::bail!(if is_dir {
                                "A folder with this name already exists."
                            } else {
                                "A file with this name already exists."
                            });
                        }
                        if is_dir { fs.create_dir(&target) } else { fs.create_file(&target) }
                    },
                    vec![edit.parent.clone()],
                    move |tree, _, cx| {
                        tree.selected = Some(path.clone());
                        tree.pending_reveal = Some(path.clone());
                        if !is_dir {
                            tree.open_file(path.clone(), cx);
                        }
                    },
                    cx,
                );
            }
        }
    }

    // File operations.

    /// Runs `op` on the background executor, then re-reads `reload` and calls `done`; a failure
    /// shows its message under the tree.
    fn run<T: Send + 'static>(
        &mut self,
        op: impl FnOnce(&dyn Fs) -> anyhow::Result<T> + Send + 'static,
        reload: Vec<PathBuf>,
        done: impl FnOnce(&mut Self, T, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) {
        let fs = self.fs.clone();
        cx.spawn(async move |this, cx| {
            let result = cx.background_spawn(async move { op(fs.as_ref()) }).await;
            this.update(cx, |this, cx| {
                match result {
                    Ok(value) => done(this, value, cx),
                    Err(error) => this.show_error(format!("{error:#}"), cx),
                }
                this.load_dirs(reload, cx);
            })
            .ok();
        })
        .detach();
    }

    fn show_error(&mut self, message: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.error = Some(message.into());
        cx.notify();
    }

    /// The Properties card of a file, as its context menu opens it.
    pub fn show_properties(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let file_name = display_name(&path);
        let kind = match file_name.rfind('.') {
            Some(dot) if dot > 0 => file_name[dot + 1..].to_string(),
            _ => "No extension".to_string(),
        };
        let fs = self.fs.clone();
        cx.spawn(async move |this, cx| {
            let size_path = path.clone();
            let size = cx.background_spawn(async move { fs.file_size(&size_path).ok() }).await;
            this.update(cx, |_, cx| {
                let properties = Properties {
                    file_name,
                    path: path.to_string_lossy().into_owned(),
                    size: size.map_or_else(|| "Unknown".to_string(), format_properties_size),
                    kind,
                };
                let dialog = cx.new(|cx| PropertiesDialog::new(properties, cx));
                cx.emit(FileTreeEvent::ShowProperties(dialog));
            })
            .ok();
        })
        .detach();
    }

    /// Opens every visible file under `dir` (`handleOpenAllFilesInDirectory`), asking first when
    /// there are more than a hundred.
    fn open_all_files(&mut self, dir: PathBuf, cx: &mut Context<Self>) {
        let fs = self.fs.clone();
        let view = self.settings.view.clone();
        let gitignore = self.gitignore.clone();
        cx.spawn(async move |this, cx| {
            let files = cx.background_spawn(async move { collect_files(fs.as_ref(), &dir, &view, &gitignore) }).await;
            this.update(cx, |_, cx| {
                if files.len() > OPEN_ALL_FILES_CONFIRM_ABOVE {
                    let count = files.len();
                    let tree = cx.weak_entity();
                    let dialog = AlertDialog::confirm(
                        "Open All Files",
                        format!("{count} files will be opened in tabs. Continue?"),
                        ConfirmOptions { confirm_label: "Open".into(), ..Default::default() },
                        move |_, cx| {
                            tree.update(cx, |_, cx| cx.emit(FileTreeEvent::OpenFiles(files.clone()))).ok();
                        },
                        cx,
                    );
                    cx.emit(FileTreeEvent::Confirm(dialog));
                } else if !files.is_empty() {
                    cx.emit(FileTreeEvent::OpenFiles(files));
                }
            })
            .ok();
        })
        .detach();
    }

    /// Ignored folders and dotfolders show their size on hover (`shouldShowDirectorySize`).
    fn wants_directory_size(row: &Row) -> bool {
        row.is_dir && !row.draft && (row.ignored || model::is_hidden_name(row.label.rsplit('/').next().unwrap_or_default()))
    }

    /// Puts the pointer on the row of `path` as if it had rested there, so a folder's size is
    /// measured without the hover delay.
    pub fn hover_path(&mut self, path: &Path, cx: &mut Context<Self>) {
        let Some(row) = self.rows.iter().find(|row| row.path == path).cloned() else { return };
        self.hover_row(&row, true, cx);
        if Self::wants_directory_size(&row) && self.directory_sizes.request(row.path) {
            self._directory_size_timer = None;
            self.drain_directory_sizes(cx);
        }
    }

    fn hover_row(&mut self, row: &Row, hovered: bool, cx: &mut Context<Self>) {
        if hovered {
            self.hovered = Some(row.path.clone());
        } else if self.hovered.as_ref() == Some(&row.path) {
            self.hovered = None;
            self._directory_size_timer = None;
        }
        cx.notify();
        if !hovered || !Self::wants_directory_size(row) || self.directory_sizes.size(&row.path).is_some() {
            return;
        }
        let path = row.path.clone();
        self._directory_size_timer = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(DIRECTORY_SIZE_HOVER_DELAY).await;
            this.update(cx, |this, cx| {
                if this.directory_sizes.request(path) {
                    this.drain_directory_sizes(cx);
                }
            })
            .ok();
        }));
    }

    fn drain_directory_sizes(&mut self, cx: &mut Context<Self>) {
        for path in self.directory_sizes.next_scans() {
            let fs = self.fs.clone();
            cx.spawn(async move |this, cx| {
                let scanned = path.clone();
                let size = cx.background_spawn(async move { fs.directory_size(&scanned).ok() }).await;
                this.update(cx, |this, cx| {
                    this.directory_sizes.finish(path, size);
                    this.drain_directory_sizes(cx);
                    cx.notify();
                })
                .ok();
            })
            .detach();
        }
    }

    /// Copies an env file's keys, without their values, to `name` beside it (`createEnvTemplateFile`),
    /// asking before it replaces a file already there.
    fn create_env_template(&mut self, source: PathBuf, name: &'static str, overwrite: bool, cx: &mut Context<Self>) {
        let dir = parent_of(&source);
        let target = dir.join(name);
        if target == source {
            return self.show_error("Choose a different env file name", cx);
        }
        let fs = self.fs.clone();
        let check = target.clone();
        cx.spawn(async move |this, cx| {
            let exists = cx.background_spawn(async move { fs.exists(&check) }).await;
            this.update(cx, |tree, cx| {
                if exists && !overwrite {
                    let weak = cx.weak_entity();
                    let source = source.clone();
                    let dialog = AlertDialog::confirm(
                        "Overwrite Env File",
                        format!("{name} already exists. Overwrite it?"),
                        ConfirmOptions { confirm_label: "Overwrite".into(), destructive: true, ..Default::default() },
                        move |_, cx| {
                            weak.update(cx, |tree, cx| tree.create_env_template(source.clone(), name, true, cx)).ok();
                        },
                        cx,
                    );
                    cx.emit(FileTreeEvent::Confirm(dialog));
                    return;
                }
                tree.run(
                    move |fs| {
                        let content = fs.read_to_string(&source)?;
                        fs.write(&target, &env_template::build_env_template_content(&content)).with_context(|| format!("Failed to create {name}"))?;
                        Ok(target)
                    },
                    vec![dir],
                    |tree, target, cx| {
                        tree.selected = Some(target.clone());
                        tree.pending_reveal = Some(target);
                        cx.notify();
                    },
                    cx,
                );
            })
            .ok();
        })
        .detach();
    }

    /// Drops an entry onto a folder: it moves there, unless it is already in it or the folder is
    /// the entry itself or inside it.
    /// Moves every dragged entry into `dir`.
    fn move_entries_into(&mut self, dragged: &DraggedEntry, dir: PathBuf, cx: &mut Context<Self>) {
        for (path, is_dir) in dragged.sources().map(|(path, is_dir)| (path.to_path_buf(), is_dir)).collect::<Vec<_>>() {
            self.move_into(path, is_dir, dir.clone(), cx);
        }
    }

    fn move_into(&mut self, source: PathBuf, is_dir: bool, dir: PathBuf, cx: &mut Context<Self>) {
        if is_invalid_drop_target(&dir, &source, is_dir) || parent_of(&source) == dir {
            return;
        }
        let Some(name) = source.file_name() else { return };
        let target = dir.join(name);
        let (from, to) = (source.clone(), target.clone());
        let name = display_name(&source);
        self.run(
            move |fs| {
                if fs.exists(&target) {
                    anyhow::bail!("Failed to move {name}: {} already exists", display_name(&target));
                }
                fs.move_path(&source, &target).with_context(|| format!("Failed to move {name}"))
            },
            vec![parent_of(&from), dir],
            move |tree, (), cx| {
                // As a rename does: the moved folder keeps its open subfolders, the open file its
                // highlight.
                tree.model.relocate(&from, &to);
                tree.gitignore.forget(&from);
                if let Some(active) = tree.active.as_mut()
                    && let Some(moved) = model::relocate_path(active, &from, &to)
                {
                    *active = moved;
                }
                tree.undo.record(FileOperation::Move { from: from.clone(), to: to.clone() });
                tree.selected = Some(to.clone());
                tree.pending_reveal = Some(to.clone());
                cx.emit(FileTreeEvent::Moved { from, to });
            },
            cx,
        );
    }

    fn copy_content(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.run(
            move |fs| fs.read_to_string(&path),
            Vec::new(),
            |_, text, cx| cx.write_to_clipboard(ClipboardItem::new_string(text)),
            cx,
        );
    }

    fn duplicate(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let parent = parent_of(&path);
        let dir = parent.clone();
        self.run(
            move |fs| {
                let target = free_copy_path(fs, &dir, &path)?;
                fs.copy(&path, &target)?;
                Ok(target)
            },
            vec![parent],
            |tree, target, cx| {
                tree.selected = Some(target.clone());
                tree.pending_reveal = Some(target);
                cx.notify();
            },
            cx,
        );
    }

    /// Copies or moves the clipboard's entries into `dir`; copies onto a taken name get a
    /// `_copy` suffix, moves onto one fail.
    fn paste_into(&mut self, dir: PathBuf, cx: &mut Context<Self>) {
        let Some(clipboard) = &self.clipboard else { return };
        let op = clipboard.op;
        let sources = clipboard.paths.clone();
        let mut reload: Vec<PathBuf> = sources.iter().map(|source| parent_of(source)).collect();
        reload.push(dir.clone());
        if op == ClipboardOp::Cut {
            self.clipboard = None;
        }
        let target_dir = dir.clone();
        self.run(
            move |fs| {
                // A failure part-way still reports the moves already made, so their tabs follow.
                let mut moved = Vec::new();
                let result = (|| -> anyhow::Result<()> {
                for source in sources {
                    let Some(name) = source.file_name() else { continue };
                    match op {
                        ClipboardOp::Copy => {
                            let target = if fs.exists(&target_dir.join(name)) {
                                free_copy_path(fs, &target_dir, &source)?
                            } else {
                                target_dir.join(name)
                            };
                            fs.copy(&source, &target)?;
                        }
                        ClipboardOp::Cut => {
                            let target = target_dir.join(name);
                            if target != source {
                                fs.move_path(&source, &target)?;
                                moved.push((source, target));
                            }
                        }
                    }
                }
                Ok(())
                })();
                Ok((moved, result.err().map(|error| format!("{error:#}"))))
            },
            reload,
            move |tree, (moved, failure), cx| {
                if let Some(failure) = failure {
                    tree.show_error(failure, cx);
                }
                for (from, to) in moved {
                    tree.model.relocate(&from, &to);
                    tree.gitignore.forget(&from);
                    tree.undo.record(FileOperation::Move { from: from.clone(), to: to.clone() });
                    cx.emit(FileTreeEvent::Moved { from, to });
                }
                tree.set_dir_expanded(&dir, true, cx);
            },
            cx,
        );
    }

    fn request_delete(&mut self, paths: Vec<PathBuf>, permanent: bool, confirm: bool, cx: &mut Context<Self>) {
        let paths: Vec<PathBuf> = model::without_nested(paths).into_iter().filter(|path| !self.is_root(path)).collect();
        if paths.is_empty() {
            return;
        }
        let pending = PendingDelete { paths, permanent };
        if !(confirm && (permanent || self.settings.confirm_delete)) {
            self.pending_delete = Some(pending);
            self.confirm_delete(cx);
            return;
        }
        let (title, message, confirm_label) = delete_prompt(&pending);
        let tree = cx.weak_entity();
        let dialog = AlertDialog::confirm(
            title,
            message,
            ConfirmOptions { confirm_label: confirm_label.into(), destructive: true, ..Default::default() },
            move |_, cx| {
                let pending = pending.clone();
                tree.update(cx, |tree, cx| {
                    tree.pending_delete = Some(pending);
                    tree.confirm_delete(cx);
                })
                .ok();
            },
            cx,
        );
        cx.emit(FileTreeEvent::Confirm(dialog));
    }

    fn confirm_delete(&mut self, cx: &mut Context<Self>) {
        let Some(PendingDelete { paths, permanent }) = self.pending_delete.take() else { return };
        let reload: Vec<PathBuf> = paths.iter().map(|path| parent_of(path)).collect();
        // The row after the last deleted one keeps the keyboard where it was.
        let next = self
            .selected_index()
            .and_then(|index| self.rows[index + 1..].iter().find(|row| !paths.iter().any(|path| row.path.starts_with(path))))
            .map(|row| row.path.clone());
        self.run(
            move |fs| {
                // Stops at the first failure but reports what already went, so its tabs close
                // and Undo can bring it back.
                let mut trashed = Vec::new();
                let mut deleted = Vec::new();
                let mut failure = None;
                for path in &paths {
                    let result = if permanent {
                        fs.remove(path)
                    } else {
                        fs.trash_with_location(path).map(|landed| trashed.push(Trashed { original: path.clone(), trashed: landed }))
                    };
                    match result {
                        Ok(()) => deleted.push(path.clone()),
                        Err(error) => {
                            failure = Some(format!("{error:#}"));
                            break;
                        }
                    }
                }
                Ok((trashed, deleted, failure))
            },
            reload,
            move |tree, (trashed, deleted, failure), cx| {
                if let Some(failure) = failure {
                    tree.show_error(failure, cx);
                }
                if deleted.is_empty() {
                    return;
                }
                if !trashed.is_empty() {
                    tree.undo.record(FileOperation::Trash(trashed));
                }
                for path in &deleted {
                    tree.model.forget(path);
                    tree.gitignore.forget(path);
                }
                if tree.selected.as_ref().is_some_and(|selected| deleted.iter().any(|path| selected.starts_with(path))) {
                    tree.selected = next;
                }
                cx.emit(FileTreeEvent::Deleted(deleted));
                cx.notify();
            },
            cx,
        );
    }

    // Rendering.

    fn render_rows(&mut self, range: Range<usize>, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let focused = self.focus_handle.is_focused(window);
        let highlighted = if focused { self.selected.clone() } else { self.active.clone().or_else(|| self.selected.clone()) };
        range
            .filter_map(|index| {
                let row = self.rows.get(index)?.clone();
                let previous_depth = index.checked_sub(1).and_then(|i| self.rows.get(i)).map_or(0, |row| row.depth);
                let next_depth = self.rows.get(index + 1).map_or(0, |row| row.depth);
                let is_highlighted = !row.draft
                    && if self.multi.is_empty() { highlighted.as_ref() == Some(&row.path) } else { self.multi.contains(&row.path) };
                let has_ring = is_highlighted && focused && self.keyboard_navigation;
                Some(self.render_row(index, row, previous_depth, next_depth, is_highlighted, has_ring, cx))
            })
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    fn render_row(
        &self,
        index: usize,
        row: Row,
        previous_depth: usize,
        next_depth: usize,
        highlighted: bool,
        has_ring: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = cx.theme().clone();
        let colors = &theme.colors;
        let settings = &self.settings;
        let indent = settings.indent_size;
        let editing = self.edit.as_ref().filter(|edit| match &edit.kind {
            EditKind::Rename(path) => !row.draft && *path == row.path,
            _ => row.draft,
        });
        let cut = self
            .clipboard
            .as_ref()
            .is_some_and(|clipboard| clipboard.op == ClipboardOp::Cut && clipboard.paths.contains(&row.path));

        let guides = settings.show_indent_guides.then(|| {
            (0..row.depth).map(|level| {
                let starts_here = previous_depth <= level;
                let ends_here = next_depth <= level;
                div()
                    .absolute()
                    .left(px(BASE_INDENT + level as f32 * indent + GUIDE_OFFSET))
                    .top(if starts_here { px(4.) } else { px(0.) })
                    .bottom(if ends_here { px(4.) } else { px(0.) })
                    .w(px(1.))
                    .bg(colors.divider)
                    .opacity(0.9)
            })
        });

        let arrow = settings.show_folder_arrows.then(|| {
            let chevron = (row.is_dir && editing.is_none())
                .then_some(if row.expanded { IconName::ChevronDown } else { IconName::ChevronRight });
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(16.))
                .mr(px(2.))
                .children(chevron.map(|chevron| Icon::new(chevron).size(IconSize::XSmall).color(colors.subtle_foreground)))
        });

        let icon = settings.show_icons.then(|| {
            let name = if editing.is_some() {
                if row.is_dir { "folder" } else { "file" }
            } else {
                row.label.rsplit('/').next().unwrap_or_default()
            };
            let expanded = row.expanded && editing.is_none();
            // The icon theme in Settings decides; the bundled Pierre icons stand in.
            let source = extensions::icon_for(name, row.is_dir, expanded, cx)
                .unwrap_or_else(|| icons::icon_path(name, row.is_dir, expanded, theme.appearance.is_dark()).into());
            div()
                .relative()
                .flex_none()
                .size(ICON_SIZE)
                .child(img(source).size(ICON_SIZE))
                .when(row.is_symlink, |this| {
                    this.child(
                        svg()
                            .path(icons::SYMLINK_BADGE)
                            .absolute()
                            .right(px(-2.))
                            .bottom(px(-2.))
                            .size(px(8.5))
                            .text_color(colors.primary),
                    )
                })
        });

        let label: AnyElement = match editing {
            Some(edit) => div()
                .on_mouse_down(MouseButton::Left, keep_click)
                .flex_1()
                .min_w_0()
                .h(px(20.))
                .px(px(4.))
                .flex()
                .items_center()
                .rounded(metrics::RADIUS)
                .bg(colors.field)
                .border_1()
                .border_color(colors.focus_ring)
                .child(edit.input.clone())
                .into_any_element(),
            None => {
                let git_color = self
                    .git_status
                    .as_ref()
                    .filter(|_| settings.show_git_status && !row.draft)
                    .and_then(|lookup| lookup.decoration(&row.path, row.is_dir))
                    .map(|decoration| decoration.color(colors));
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .when_some(git_color, |this, color| this.text_color(color))
                    .child(row.label.clone())
                    .into_any_element()
            }
        };

        let directory_size = (self.hovered.as_ref() == Some(&row.path) && editing.is_none() && Self::wants_directory_size(&row))
            .then(|| self.directory_sizes.size(&row.path))
            .flatten()
            .map(|size| div().flex_none().child(ui::Badge::new(format_directory_size(size))));

        let hover_bg = colors.accent;
        let content = div()
            .flex()
            .flex_1()
            .min_w_0()
            .h_full()
            .items_center()
            .gap(px(6.))
            .pl(px(BASE_INDENT + row.depth as f32 * indent))
            .pr(px(6.))
            .rounded(metrics::RADIUS)
            .border_1()
            .border_color(if has_ring { colors.focus_ring } else { gpui::transparent_black() })
            .when(highlighted, |this| this.bg(colors.raised).shadow(theme.shadows.raised_inset.clone()))
            .when(!highlighted && editing.is_none(), |this| this.hover(move |style| style.bg(hover_bg)))
            .when(row.ignored, |this| this.opacity(0.5))
            .when(cut, |this| this.italic().opacity(0.4))
            .children(arrow)
            .children(icon)
            .child(label)
            .children(directory_size);

        let mut element = div()
            .id(("file-tree-row", index))
            .relative()
            .flex()
            .w_full()
            .h(self.type_scale().row_height())
            .text_size(self.type_scale().sm())
            .line_height(gpui::relative(typography::LEADING_ROW))
            .text_color(colors.foreground)
            .child(content)
            .children(guides.into_iter().flatten());
        if editing.is_none() && !row.draft {
            let clicked = row.clone();
            let hovered = row.clone();
            let path = row.path.clone();
            let is_dir = row.is_dir;
            let name = row.label.clone();
            if let Some(target) = self.symlink_targets.get(&row.path) {
                element = element.anchored_tooltip({ let text: gpui::SharedString = (format!("{name} - Symlink to: {target}")).into(); move || ui::Tooltip::new(text.clone()) });
            }
            let drop_dir = if is_dir { row.path.clone() } else { parent_of(&row.path) };
            let drop_check = drop_dir.clone();
            let hover_dir = row.path.clone();
            let drop_fill = colors.primary_soft;
            if !self.is_root(&row.path) {
                let paths = self
                    .action_targets(&row.path)
                    .into_iter()
                    .map(|path| {
                        let is_dir = self.rows.iter().find(|row| row.path == path).map_or(path.is_dir(), |row| row.is_dir);
                        (path, is_dir)
                    })
                    .collect();
                let dragged = DraggedEntry { path: row.path.clone(), is_dir, name: display_name(&row.path), paths };
                element = element.on_drag(dragged, |dragged, _, _, cx| cx.new(|_| DraggedEntryPreview(dragged.clone())));
            }
            element = element
                .drag_over::<DraggedEntry>(move |style, dragged, _, _| {
                    if dragged.sources().all(|(path, is_dir)| is_invalid_drop_target(&drop_check, path, is_dir)) { style } else { style.bg(drop_fill) }
                })
                .on_drag_move(cx.listener(move |this, event: &gpui::DragMoveEvent<DraggedEntry>, _, cx| {
                    if event.bounds.contains(&event.event.position) {
                        this.drag_hover(is_dir.then(|| hover_dir.clone()), cx);
                    }
                }))
                .on_drop(cx.listener(move |this, dragged: &DraggedEntry, _, cx| {
                    cx.stop_propagation();
                    this.drag_hover = None;
                    this.move_entries_into(dragged, drop_dir.clone(), cx);
                }))
                .on_hover(cx.listener(move |this, hovered_now: &bool, _, cx| this.hover_row(&hovered, *hovered_now, cx)))
                .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| this.click_row(&clicked, event, window, cx)))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                        this.context_menu(path.clone(), is_dir, event, window, cx)
                    }),
                );
        }
        element.into_any_element()
    }

    fn render_error(&self, message: SharedString, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        div()
            .on_mouse_down(MouseButton::Left, keep_click)
            .on_mouse_down(MouseButton::Right, keep_click)
            .flex()
            .items_start()
            .gap(px(6.))
            .m(px(6.))
            .p(px(8.))
            .rounded(metrics::RADIUS_LG)
            .bg(colors.destructive_soft)
            .text_size(typography::TEXT_SM)
            .text_color(colors.destructive)
            .child(Icon::new(IconName::WarningCircle).size(IconSize::Small).color(colors.destructive))
            .child(div().flex_1().min_w_0().child(message))
            .child(
                Button::icon("files-error-dismiss", IconName::X)
                    .size(ButtonSize::XSmall)
                    .tooltip("Dismiss")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.error = None;
                        cx.notify();
                    })),
            )
    }
}

impl Render for FileTree {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let body: AnyElement = if let Some(error) = self.root_error.clone() {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .child(EmptyState::new("Could not read the folder").icon(IconName::WarningCircle).message(error))
                .into_any_element()
        } else if self.rows.is_empty() && !self.loading.is_empty() {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .text_size(typography::TEXT_SM)
                .text_color(cx.theme().colors.subtle_foreground)
                .child("Loading files")
                .into_any_element()
        } else {
            ui::with_scrollbar(
                uniform_list("file-tree-rows", self.rows.len(), cx.processor(Self::render_rows))
                    .track_scroll(&self.scroll_handle)
                    .flex_1()
                    .pt(VIEWPORT_PADDING)
                    .px(metrics::CHROME_PADDING_INLINE),
                ui::Scrollbar::uniform("file-tree-scrollbar", &self.scroll_handle),
            )
            .into_any_element()
        };
        let root = self.root.clone();
        let drop_root = self.root.clone();
        div()
            .id("file-tree")
            .on_drop(cx.listener(move |this, dragged: &DraggedEntry, _, cx| {
                this.drag_hover = None;
                this.move_entries_into(dragged, drop_root.clone(), cx)
            }))
            .on_drag_move(cx.listener(Self::drag_to_window_edge))
            .key_context("FileTree")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::select_next))
            .on_action(cx.listener(Self::extend_selection_down))
            .on_action(cx.listener(Self::extend_selection_up))
            .on_action(cx.listener(Self::select_all_entries))
            .on_action(cx.listener(Self::select_previous))
            .on_action(cx.listener(Self::select_page_down))
            .on_action(cx.listener(Self::select_page_up))
            .on_action(cx.listener(Self::select_first))
            .on_action(cx.listener(Self::select_last))
            .on_action(cx.listener(Self::expand_selected))
            .on_action(cx.listener(Self::collapse_selected))
            .on_action(cx.listener(Self::confirm_selected))
            .on_action(cx.listener(Self::toggle_selected))
            .on_action(cx.listener(Self::open_selected))
            .on_action(cx.listener(Self::rename_selected))
            .on_action(cx.listener(Self::delete_selected))
            .on_action(cx.listener(Self::delete_selected_permanently))
            .on_action(cx.listener(Self::trash_selected_now))
            .on_action(cx.listener(Self::copy_entries))
            .on_action(cx.listener(Self::cut_entries))
            .on_action(cx.listener(Self::paste_entries))
            .on_action(cx.listener(Self::undo_file_operation))
            .on_action(cx.listener(Self::cancel))
            .on_key_down(cx.listener(Self::type_to_find))
            .on_click(cx.listener(|this, _, window, cx| {
                window.focus(&this.focus_handle, cx);
                this.selected = None;
                this.active = None;
                cx.notify();
            }))
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    this.context_menu(root.clone(), true, event, window, cx)
                }),
            )
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_h_0()
            .font_family(typography::ui(cx).family)
            .child(body)
            .children(self.error.clone().map(|error| self.render_error(error, cx)))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}

/// Keeps a press inside a field or card from reaching the tree, which would take focus and clear
/// the selection.
fn keep_click(_: &MouseDownEvent, _: &mut Window, cx: &mut App) {
    cx.stop_propagation();
}

fn parent_of(path: &Path) -> PathBuf {
    path.parent().map(Path::to_path_buf).unwrap_or_else(|| path.to_path_buf())
}

fn display_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

#[cfg(not(target_os = "macos"))]
fn start_native_drag(_window: &Window, _paths: &[PathBuf]) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn start_native_drag(window: &Window, paths: &[PathBuf]) -> anyhow::Result<()> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
        Ok(RawWindowHandle::AppKit(handle)) => system::start_file_drag(handle.ns_view.as_ptr(), paths),
        _ => anyhow::bail!("The window's view is unavailable"),
    }
}

/// Only macOS has a system Share menu; the callers offer it there alone.
#[cfg(not(target_os = "macos"))]
pub fn share(_window: &Window, path: &Path) -> anyhow::Result<()> {
    anyhow::bail!("Sharing {} needs macOS", path.display())
}

#[cfg(target_os = "macos")]
/// Shows the system Share menu for a local file (`showSystemSharePicker`).
pub fn share(window: &Window, path: &Path) -> anyhow::Result<()> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
        Ok(RawWindowHandle::AppKit(handle)) => system::show_share_picker(handle.ns_view.as_ptr(), path),
        _ => anyhow::bail!("The window's view is unavailable"),
    }
}

/// The delete confirmation's title, message and button (`showDeleteConfirmation`).
fn delete_prompt(pending: &PendingDelete) -> (String, String, String) {
    let first = pending.paths.first().map(|path| display_name(path)).unwrap_or_default();
    let any_dir = pending.paths.iter().any(|path| path.is_dir());
    let count = pending.paths.len();
    let subject = if count > 1 {
        format!("These {count} items{}", if any_dir { " and everything in the selected folders" } else { "" })
    } else if any_dir {
        format!("The folder \"{first}\" and everything in it")
    } else {
        format!("\"{first}\"")
    };
    if pending.permanent {
        (
            if count > 1 { "Delete Items Immediately?".to_string() } else { format!("Delete \"{first}\" Immediately?") },
            format!("{subject} will be deleted immediately. You can’t undo this action."),
            "Delete".to_string(),
        )
    } else {
        (format!("Move to {TRASH_NAME}?"), format!("{subject} will be moved to the {TRASH_NAME}."), format!("Move to {TRASH_NAME}"))
    }
}

/// The files Open All Files opens: everything under `dir` the tree would list, breadth first,
/// at most `OPEN_ALL_FILES_LIMIT` (`collectLocalFilesInDirectory`).
fn collect_files(fs: &dyn Fs, dir: &Path, view: &ViewOptions, gitignore: &GitignoreRules) -> Vec<PathBuf> {
    let mut collected = Vec::new();
    let mut stack = VecDeque::from([dir.to_path_buf()]);
    while let Some(current) = stack.pop_front() {
        let Ok(mut entries) = fs.read_dir(&current) else { continue };
        model::sort_entries(&mut entries, view.sort_order);
        for entry in entries {
            if model::is_os_generated(&entry.name)
                || view.hidden_patterns.hides(&entry.path, entry.is_dir)
                || (!view.show_hidden && model::is_hidden_name(&entry.name))
                || (!view.show_ignored && gitignore.is_ignored(&entry.path, entry.is_dir))
            {
                continue;
            }
            if entry.is_dir {
                stack.push_back(entry.path);
            } else {
                if collected.len() >= OPEN_ALL_FILES_LIMIT {
                    return collected;
                }
                collected.push(entry.path);
            }
        }
    }
    collected
}

/// A folder's size on its badge (`utils/format-file-size.ts`).
fn format_directory_size(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    let units = ["B", "KB", "MB", "GB"];
    let index = ((bytes as f64).ln() / 1024f64.ln()).floor().min((units.len() - 1) as f64) as usize;
    format!("{:.1} {}", bytes as f64 / 1024f64.powi(index as i32), units[index])
}

/// A file's size in Properties (`formatFileSize` in the context menu).
fn format_properties_size(bytes: u64) -> String {
    if bytes < 1024 {
        return format!("{bytes} bytes");
    }
    let units = ["KB", "MB", "GB", "TB"];
    let mut value = bytes as f64 / 1024.;
    let mut index = 0;
    while value >= 1024. && index < units.len() - 1 {
        value /= 1024.;
        index += 1;
    }
    format!("{value:.prec$} {}", units[index], prec = if value >= 10. { 1 } else { 2 })
}

/// The first `name_copy…` path in `dir` that is free.
fn free_copy_path(fs: &dyn Fs, dir: &Path, source: &Path) -> anyhow::Result<PathBuf> {
    let name = display_name(source);
    (0..1000)
        .map(|attempt| dir.join(model::copy_name(&name, attempt)))
        .find(|candidate| !fs.exists(candidate))
        .ok_or_else(|| anyhow::anyhow!("No free name for a copy of {name}"))
}

#[cfg(all(test, not(target_family = "wasm")))]
mod tests {
    use super::*;

    #[test]
    fn entries_cannot_be_dropped_onto_or_into_themselves() {
        assert!(is_invalid_drop_target(Path::new("/p/src"), Path::new("/p/src"), true));
        assert!(is_invalid_drop_target(Path::new("/p/src/ui"), Path::new("/p/src"), true));
        assert!(!is_invalid_drop_target(Path::new("/p/srcs"), Path::new("/p/src"), true));
        assert!(!is_invalid_drop_target(Path::new("/p/lib"), Path::new("/p/src/a.rs"), false));
    }

    #[test]
    fn formats_sizes_like_athas() {
        assert_eq!(format_directory_size(0), "0 B");
        assert_eq!(format_directory_size(512), "512.0 B");
        assert_eq!(format_directory_size(1536), "1.5 KB");
        assert_eq!(format_directory_size(5 * 1024 * 1024 * 1024 * 1024), "5120.0 GB");
        assert_eq!(format_properties_size(900), "900 bytes");
        assert_eq!(format_properties_size(1536), "1.50 KB");
        assert_eq!(format_properties_size(20 * 1024 * 1024), "20.0 MB");
    }

    #[test]
    fn directory_sizes_run_two_scans_at_a_time_and_cache() {
        let mut sizes = DirectorySizes::default();
        for name in ["a", "b", "c"] {
            assert!(sizes.request(PathBuf::from(name)));
        }
        assert!(!sizes.request(PathBuf::from("a")));
        assert_eq!(sizes.next_scans(), [PathBuf::from("a"), PathBuf::from("b")]);
        assert!(sizes.next_scans().is_empty());
        sizes.finish(PathBuf::from("a"), Some(42));
        assert_eq!(sizes.size(Path::new("a")), Some(42));
        assert!(!sizes.request(PathBuf::from("a")));
        assert_eq!(sizes.next_scans(), [PathBuf::from("c")]);
    }

    #[test]
    fn open_all_collects_what_the_tree_lists() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for (path, contents) in [
            ("a.txt", "a"),
            ("src/b.rs", "b"),
            ("src/deep/c.rs", "c"),
            (".env", "x"),
            ("node_modules/pkg/index.js", "x"),
            (".DS_Store", "x"),
        ] {
            std::fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
            std::fs::write(root.join(path), contents).unwrap();
        }
        let mut gitignore = GitignoreRules::new(root.to_path_buf());
        gitignore.set(root, Some("node_modules/\n"));
        let fs = local_fs();
        let view = ViewOptions { show_hidden: false, show_ignored: false, ..ViewOptions::default() };
        let names: Vec<_> = collect_files(fs.as_ref(), root, &view, &gitignore)
            .into_iter()
            .map(|path| path.strip_prefix(root).unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["a.txt", "src/b.rs", "src/deep/c.rs"]);

        let everything = collect_files(fs.as_ref(), root, &ViewOptions::default(), &gitignore);
        assert_eq!(everything.len(), 5);
    }
}
