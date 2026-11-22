//! The code editor (`features/editor`): a rope buffer with tree-sitter highlighting, multiple
//! selections, undo, find and replace, opened as a tab in the centre.
//!
//! Parts of the design (byte offsets on a rope, a display map for tabs and soft wrap, the custom
//! element that shapes only the visible rows) follow Zed's editor (GPL-3.0), adapted for Athas.

mod agent;
mod buffer;
mod code_lens;
mod commands;
mod completion;
mod context_menu;
mod display_map;
mod document;
mod document_links;
mod element;
mod find;
mod folding;
mod fs;
mod git;
mod gutter;
mod history;
mod inline_completion;
mod input;
mod java_class;
#[cfg(not(target_family = "wasm"))]
mod lint;
mod lsp;
mod markdown;
mod markdown_preview;
mod movement;
mod notebook;
mod on_type_format;
mod peek;
mod popover;
mod remote_image;
mod search;
mod selection;
mod selection_range;
mod semantic;
mod status_actions;
mod sticky;
mod stream_highlight;
mod syntax;
mod vim;

use std::{
    ops::Range,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
};

use gpui::{
    App, ClipboardItem, Context, Entity, EventEmitter, FocusHandle, Focusable, IntoElement, KeyBinding, KeyContext, Pixels,
    Render, Subscription, Task, Window, actions, div, point, prelude::*, px,
};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, EmptyState, IconName, InputAppearance, TextInput, TextInputEvent, typography};

pub use agent::{AgentHooks, AgentHunk, InlineEditInput, InlineEditView, set_agent_hooks};
pub use buffer::LineEnding;
pub use inline_completion::{InlineCompletionInput, is_sensitive_path, next_suggestion_word};
pub use commands::{
    FormatSelection, JumpToSelection, RemoveBrackets, RemoveSecondaryCursors, ResetZoom, RestartLanguageServers, SelectPreviousOccurrence,
    SelectToBracket, ShowLanguageServerStatus, StopLanguageServers, ToggleLineNumbers, ToggleRenderWhitespace, ZOOM_LEVELS, ZoomIn, ZoomOut,
    external_editor_command, reset_editor_zoom, zoom_editors, zoom_level,
};
pub use fs::{FileBackend, Loaded, LocalFs, is_snapshot, is_untitled, new_untitled_path, register_snapshot};
pub use git::{GitHunk, HunkKind, set_author_avatar_lookup};
pub use lsp::{LspEvent, LspStatus};
pub use markdown_preview::MarkdownPreview;
pub use status_actions::EditorStatusActions;
pub use markdown::extension_for_language;
pub use syntax::{SyntaxKind, highlight_snippet, language_name_for_path};
pub use vim::{VimMode, VimModeIndicator};

use crate::{
    display_map::{DisplayMap, WrapIndex},
    document::{ClipboardText, Document},
    element::{EditorElement, HitLayout},
    find::FindState,
    folding::{FoldState, line_shifts},
    git::GitState,
    history::EditKind,
    markdown_preview::PreviewPane,
    selection::Selection,
    vim::VimState,
};

actions!(
    editor,
    [
        MoveLeft,
        MoveRight,
        MoveUp,
        MoveDown,
        MoveWordLeft,
        MoveWordRight,
        MoveToLineStart,
        MoveToLineEnd,
        MoveToStart,
        MoveToEnd,
        PageUp,
        PageDown,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        SelectWordLeft,
        SelectWordRight,
        SelectToLineStart,
        SelectToLineEnd,
        SelectToStart,
        SelectToEnd,
        SelectPageUp,
        SelectPageDown,
        SelectAll,
        SelectLine,
        Backspace,
        Delete,
        DeleteWordLeft,
        DeleteWordRight,
        DeleteToLineStart,
        DeleteToLineEnd,
        DeleteLine,
        Newline,
        NewlineBelow,
        NewlineAbove,
        Tab,
        Indent,
        Outdent,
        MoveLineUp,
        MoveLineDown,
        CopyLineUp,
        CopyLineDown,
        ToggleComment,
        Undo,
        Redo,
        Copy,
        Cut,
        Paste,
        SelectNextOccurrence,
        SelectAllOccurrences,
        AddCursorAbove,
        AddCursorBelow,
        CursorsAtLineEnds,
        Cancel,
        Save,
        Find,
        FindReplace,
        FindNext,
        FindPrevious,
        ReplaceAll,
        UseSelectionForFind,
        GoToLine,
        GoToBracket,
        ToggleWordWrap,
        ShowCharacterPalette,
        ShowCompletions,
        MenuUp,
        MenuDown,
        MenuConfirm,
        GoToDefinition,
        GoToTypeDefinition,
        GoToImplementation,
        FindReferences,
        Rename,
        CodeActions,
        FormatDocument,
        ShowHover,
        ShowSignatureHelp,
        NextSnippetStop,
        PreviousSnippetStop,
        NextDiagnostic,
        PreviousDiagnostic,
        Fold,
        Unfold,
        ToggleFold,
        FoldAll,
        UnfoldAll,
        FoldLevel1,
        FoldLevel2,
        FoldLevel3,
        FoldLevel4,
        FoldLevel5,
        FoldLevel6,
        FoldLevel7,
        ToggleBreakpoint,
        SelectLargerSyntaxNode,
        SelectSmallerSyntaxNode,
        SaveAs,
        ToggleMarkdownPreview,
        KeepAgentHunk,
        RejectAgentHunk,
        InlineEdit,
        AcceptInlineCompletion,
        AcceptInlineCompletionWord,
        TriggerInlineCompletion,
    ]
);

#[derive(Clone, Debug, PartialEq)]
pub enum EditorEvent {
    /// The buffer gained or lost unsaved changes; the tab shows a dot.
    DirtyChanged(bool),
    Saved,
    /// Save As wrote the buffer to a new file, which the editor now edits.
    PathChanged { old: PathBuf, new: PathBuf },
    /// The vim mode changed (or vim mode was switched on or off); a status bar shows
    /// `Editor::vim_mode`.
    VimModeChanged(Option<VimMode>),
    /// `:q`, `:wq` or `:x` asked to close the file; `force` (`:q!`) drops unsaved changes.
    CloseRequested { force: bool },
}

/// `ATHAS_EDITOR_DEMO=minimap,sticky,vim,fold,preview` switches features on for headless
/// snapshots (`athas_snapshot` cannot change settings): the minimap, sticky scroll, vim mode
/// (with relative numbers), the first nested scope folded, the markdown preview, and sample
/// `breakpoints`, sample code `lens`es and the references `peek` of the word at the caret;
/// `goto:LINE` moves the caret.
pub(crate) fn demo(feature: &str) -> bool {
    static DEMO: std::sync::LazyLock<Vec<String>> = std::sync::LazyLock::new(|| {
        std::env::var("ATHAS_EDITOR_DEMO").map(|value| value.split(',').map(|part| part.trim().to_string()).collect()).unwrap_or_default()
    });
    DEMO.iter().any(|part| part == feature)
}

/// `ATHAS_EDITOR_DEMO=goto:LINE` puts the caret on a 1-based line once the file loads.
fn demo_line() -> Option<usize> {
    std::env::var("ATHAS_EDITOR_DEMO").ok()?.split(',').find_map(|part| part.trim().strip_prefix("goto:")?.parse().ok())
}

/// Files up to this size reparse synchronously after each edit; larger ones in the background.
const SYNC_PARSE_LIMIT: usize = 512 * 1024;
/// Unsaved edits are written this long after the last change while `autoSave` is on.
const AUTO_SAVE_DELAY: Duration = Duration::from_millis(1000);
/// Language detection reads at most this much of the start of a file.
const DETECT_SAMPLE: usize = 64 * 1024;
const BLINK_INTERVAL: Duration = Duration::from_millis(530);
const DISK_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// The path a file's language is picked by: untitled documents are markdown.
fn language_path(path: &Path) -> PathBuf {
    if fs::is_untitled(path) {
        return PathBuf::from("Untitled Document.md");
    }
    fs::snapshot_source(path).unwrap_or_else(|| path.to_path_buf())
}

fn large_file_limit(threshold_mb: f64) -> usize {
    (threshold_mb.max(0.) * 1024. * 1024.) as usize
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Status {
    Loading,
    Ready,
    Binary,
    TooLarge(u64),
    Error(String),
}

/// How the next frame brings the newest caret into view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Autoscroll {
    /// Scroll as little as possible.
    Fit,
    /// Put the caret in the middle (jumps: go to line, find).
    Center,
}

/// What a mouse drag extends.
#[derive(Clone, Debug)]
pub(crate) enum Drag {
    Char,
    Word(Range<usize>),
    Line(Range<usize>),
    Scrollbar { grab: Pixels },
    Minimap { grab: Pixels },
}


/// For snapshots: an in-memory breakpoint store with each kind of breakpoint in `path`, paused
/// on line 10.
fn demo_breakpoints(path: &Path, cx: &mut App) {
    use dap::{BreakpointField, BreakpointState, ExecutionPosition};
    let store = cx.new(|_| dap::BreakpointStore::new(None));
    store.update(cx, |store, cx| {
        for row in [2, 4, 6, 8] {
            store.toggle(path, row, cx);
        }
        let ids: Vec<_> = store.breakpoints_for(path).iter().map(|breakpoint| breakpoint.id).collect();
        store.set_field(ids[1], BreakpointField::Condition, Some("x > 1".into()), cx);
        store.set_field(ids[2], BreakpointField::LogMessage, Some("hit {x}".into()), cx);
        store.set_states(path, vec![(ids[3], BreakpointState { verified: Some(false), message: None })], cx);
        store.set_execution_position(Some(ExecutionPosition { path: path.to_path_buf(), row: 9 }), cx);
    });
    dap::BreakpointStore::set_global(store, cx);
}

/// Binds the editor's keys. `Editor::open` calls it, so the workbench need not.
pub fn init(cx: &mut App) {
    ui::bind_keys_once(cx, "editor", bind_keys);
    commands::register(cx);
}

fn bind_keys(cx: &mut App) {
    let mac = cfg!(target_os = "macos") || (cfg!(target_family = "wasm") && cx.platform_info().os == gpui::OperatingSystem::Mac);
    let editor = Some("Editor");
    let pane = Some("EditorPane");
    let find = Some("EditorFind");
    // The platform modifier: cmd on macOS, ctrl elsewhere.
    macro_rules! cmd {
        ($key:literal) => {
            if mac { concat!("cmd-", $key) } else { concat!("ctrl-", $key) }
        };
    }
    let mut bindings = vec![
        KeyBinding::new("left", MoveLeft, editor),
        KeyBinding::new("right", MoveRight, editor),
        KeyBinding::new("up", MoveUp, editor),
        KeyBinding::new("down", MoveDown, editor),
        KeyBinding::new("pageup", PageUp, editor),
        KeyBinding::new("pagedown", PageDown, editor),
        KeyBinding::new("shift-left", SelectLeft, editor),
        KeyBinding::new("shift-right", SelectRight, editor),
        KeyBinding::new("shift-up", SelectUp, editor),
        KeyBinding::new("shift-down", SelectDown, editor),
        KeyBinding::new("shift-pageup", SelectPageUp, editor),
        KeyBinding::new("shift-pagedown", SelectPageDown, editor),
        KeyBinding::new("home", MoveToLineStart, editor),
        KeyBinding::new("end", MoveToLineEnd, editor),
        KeyBinding::new("shift-home", SelectToLineStart, editor),
        KeyBinding::new("shift-end", SelectToLineEnd, editor),
        KeyBinding::new("backspace", Backspace, editor),
        KeyBinding::new("shift-backspace", Backspace, editor),
        KeyBinding::new("delete", Delete, editor),
        KeyBinding::new("enter", Newline, editor),
        KeyBinding::new("shift-enter", Newline, editor),
        KeyBinding::new("tab", Tab, editor),
        KeyBinding::new("shift-tab", Outdent, editor),
        KeyBinding::new("alt-up", MoveLineUp, editor),
        KeyBinding::new("alt-down", MoveLineDown, editor),
        KeyBinding::new("alt-shift-up", CopyLineUp, editor),
        KeyBinding::new("alt-shift-down", CopyLineDown, editor),
        KeyBinding::new("shift-alt-i", CursorsAtLineEnds, editor),
        KeyBinding::new("escape", Cancel, editor),
        KeyBinding::new(cmd!("enter"), NewlineBelow, editor),
        KeyBinding::new(cmd!("shift-enter"), NewlineAbove, editor),
        KeyBinding::new(cmd!("]"), Indent, editor),
        KeyBinding::new(cmd!("["), Outdent, editor),
        KeyBinding::new(cmd!("/"), ToggleComment, editor),
        KeyBinding::new(cmd!("z"), Undo, editor),
        KeyBinding::new(cmd!("shift-z"), Redo, editor),
        KeyBinding::new(cmd!("y"), Redo, editor),
        KeyBinding::new(cmd!("c"), Copy, editor),
        KeyBinding::new(cmd!("x"), Cut, editor),
        KeyBinding::new(cmd!("v"), Paste, editor),
        KeyBinding::new(cmd!("a"), SelectAll, editor),
        KeyBinding::new(cmd!("d"), SelectNextOccurrence, editor),
        KeyBinding::new(cmd!("shift-l"), SelectAllOccurrences, editor),
        KeyBinding::new(cmd!("shift-k"), DeleteLine, editor),
        KeyBinding::new(cmd!("alt-up"), AddCursorAbove, editor),
        KeyBinding::new(cmd!("alt-down"), AddCursorBelow, editor),
        KeyBinding::new(cmd!("shift-\\"), GoToBracket, editor),
        KeyBinding::new(cmd!("e"), UseSelectionForFind, editor),
        KeyBinding::new(cmd!("s"), Save, pane),
        KeyBinding::new(cmd!("f"), Find, pane),
        KeyBinding::new(cmd!("f"), Find, Some("MarkdownPreview")),
        KeyBinding::new(cmd!("alt-f"), FindReplace, pane),
        KeyBinding::new("ctrl-h", FindReplace, pane),
        KeyBinding::new(cmd!("alt-z"), ToggleWordWrap, pane),
        KeyBinding::new("shift-enter", FindPrevious, find),
        KeyBinding::new(cmd!("enter"), ReplaceAll, find),
        KeyBinding::new("f3", FindNext, pane),
        KeyBinding::new("shift-f3", FindPrevious, pane),
        KeyBinding::new("ctrl-g", GoToLine, pane),
        KeyBinding::new("ctrl-space", ShowCompletions, editor),
        KeyBinding::new(cmd!("shift-space"), ShowSignatureHelp, editor),
        KeyBinding::new("f12", GoToDefinition, editor),
        KeyBinding::new(cmd!("f12"), GoToImplementation, editor),
        KeyBinding::new("shift-f12", FindReferences, editor),
        KeyBinding::new("f2", Rename, editor),
        KeyBinding::new(cmd!("."), CodeActions, editor),
        KeyBinding::new("shift-alt-f", FormatDocument, editor),
        KeyBinding::new(if mac { "cmd-k cmd-i" } else { "ctrl-k ctrl-i" }, ShowHover, editor),
        KeyBinding::new("f8", NextDiagnostic, editor),
        KeyBinding::new("shift-f8", PreviousDiagnostic, editor),
        KeyBinding::new(cmd!("alt-["), Fold, editor),
        KeyBinding::new(cmd!("alt-]"), Unfold, editor),
        KeyBinding::new(if mac { "cmd-k cmd-l" } else { "ctrl-k ctrl-l" }, ToggleFold, editor),
        KeyBinding::new(if mac { "cmd-k cmd-0" } else { "ctrl-k ctrl-0" }, FoldAll, editor),
        KeyBinding::new(if mac { "cmd-k cmd-j" } else { "ctrl-k ctrl-j" }, UnfoldAll, editor),
        KeyBinding::new("f9", ToggleBreakpoint, editor),
        KeyBinding::new("ctrl-shift-up", SelectLargerSyntaxNode, editor),
        KeyBinding::new("ctrl-shift-down", SelectSmallerSyntaxNode, editor),
        KeyBinding::new(cmd!("shift-s"), SaveAs, pane),
        KeyBinding::new(cmd!("shift-v"), ToggleMarkdownPreview, pane),
        KeyBinding::new(if mac { "cmd-k v" } else { "ctrl-k v" }, ToggleMarkdownPreview, pane),
        // Later bindings win in a context as deep: snippets over plain tab, menus over both.
        KeyBinding::new("tab", NextSnippetStop, Some("Editor && snippet")),
        KeyBinding::new("shift-tab", PreviousSnippetStop, Some("Editor && snippet")),
        KeyBinding::new("up", MenuUp, Some("Editor && menu")),
        KeyBinding::new("down", MenuDown, Some("Editor && menu")),
        KeyBinding::new("ctrl-p", MenuUp, Some("Editor && menu")),
        KeyBinding::new("ctrl-n", MenuDown, Some("Editor && menu")),
        KeyBinding::new("tab", AcceptInlineCompletion, Some("Editor && ghost_text")),
        KeyBinding::new("alt-\\", TriggerInlineCompletion, editor),
        KeyBinding::new("enter", MenuConfirm, Some("Editor && menu")),
        KeyBinding::new("tab", MenuConfirm, Some("Editor && menu")),
        KeyBinding::new(cmd!("y"), KeepAgentHunk, Some("Editor && agent_hunk")),
        KeyBinding::new(cmd!("n"), RejectAgentHunk, Some("Editor && agent_hunk")),
    ];
    if mac {
        bindings.extend([
            KeyBinding::new("alt-left", MoveWordLeft, editor),
            KeyBinding::new("alt-right", MoveWordRight, editor),
            KeyBinding::new("alt-shift-left", SelectWordLeft, editor),
            KeyBinding::new("alt-shift-right", SelectWordRight, editor),
            KeyBinding::new("cmd-left", MoveToLineStart, editor),
            KeyBinding::new("cmd-right", MoveToLineEnd, editor),
            KeyBinding::new("cmd-shift-left", SelectToLineStart, editor),
            KeyBinding::new("cmd-shift-right", SelectToLineEnd, editor),
            KeyBinding::new("ctrl-a", MoveToLineStart, editor),
            KeyBinding::new("ctrl-e", MoveToLineEnd, editor),
            KeyBinding::new("cmd-up", MoveToStart, editor),
            KeyBinding::new("cmd-down", MoveToEnd, editor),
            KeyBinding::new("cmd-home", MoveToStart, editor),
            KeyBinding::new("cmd-end", MoveToEnd, editor),
            KeyBinding::new("cmd-shift-up", SelectToStart, editor),
            KeyBinding::new("cmd-shift-down", SelectToEnd, editor),
            KeyBinding::new("alt-backspace", DeleteWordLeft, editor),
            KeyBinding::new("alt-delete", DeleteWordRight, editor),
            KeyBinding::new("cmd-backspace", DeleteToLineStart, editor),
            KeyBinding::new("cmd-delete", DeleteToLineEnd, editor),
            KeyBinding::new("ctrl-k", DeleteToLineEnd, editor),
            KeyBinding::new("ctrl-cmd-space", ShowCharacterPalette, editor),
            KeyBinding::new("cmd-g", FindNext, pane),
            KeyBinding::new("cmd-shift-g", FindPrevious, pane),
        ]);
    } else {
        bindings.extend([
            KeyBinding::new("ctrl-left", MoveWordLeft, editor),
            KeyBinding::new("ctrl-right", MoveWordRight, editor),
            KeyBinding::new("ctrl-shift-left", SelectWordLeft, editor),
            KeyBinding::new("ctrl-shift-right", SelectWordRight, editor),
            KeyBinding::new("ctrl-home", MoveToStart, editor),
            KeyBinding::new("ctrl-end", MoveToEnd, editor),
            KeyBinding::new("ctrl-shift-home", SelectToStart, editor),
            KeyBinding::new("ctrl-shift-end", SelectToEnd, editor),
            KeyBinding::new("ctrl-backspace", DeleteWordLeft, editor),
            KeyBinding::new("ctrl-delete", DeleteWordRight, editor),
            KeyBinding::new("ctrl-l", SelectLine, editor),
        ]);
    }
    bindings.push(KeyBinding::new(cmd!("right"), AcceptInlineCompletionWord, Some("Editor && ghost_text")));
    cx.bind_keys(bindings);
    vim::bind_keys(cx);
    peek::bind_keys(cx);
}

pub struct Editor {
    path: PathBuf,
    focus_handle: FocusHandle,
    fs: Arc<dyn FileBackend>,
    status: Status,
    pub(crate) document: Document,
    /// How far the text is scrolled, right and down.
    pub(crate) scroll: gpui::Point<Pixels>,
    pub(crate) wrap_index: Option<Arc<WrapIndex>>,
    /// Cmd-Alt-Z flips soft wrap for this editor, over the setting.
    wrap_override: Option<bool>,
    pub(crate) autoscroll: Option<Autoscroll>,
    /// Smooth Scrolling (`editorSmoothScrolling`): a jump the next frame eases into, from the
    /// offset it starts at, and the glide under way (from, to, started).
    pub(crate) smooth_from: Option<Pixels>,
    pub(crate) scroll_animation: Option<(Pixels, Pixels, web_time::Instant)>,
    /// Where the last frame drew things, for mouse hits and the IME.
    pub(crate) layout: Option<HitLayout>,
    pub(crate) cursor_visible: bool,
    pub(crate) focused: bool,
    blink_task: Option<Task<()>>,
    pub(crate) drag: Option<Drag>,
    /// The IME composition, in the newest selection.
    pub(crate) marked_range: Option<Range<usize>>,
    pub(crate) find: Option<FindState>,
    pub(crate) find_open: bool,
    go_to_line: Option<(Entity<TextInput>, Subscription)>,
    /// The last copy, so pasting it again restores whole lines and one piece per caret.
    clipboard: Option<ClipboardText>,
    disk_modified: Option<SystemTime>,
    changed_on_disk: bool,
    saving: bool,
    notice: Option<String>,
    last_dirty: bool,
    pub(crate) caches: element::Caches,
    pub(crate) lsp: lsp::LspState,
    pub(crate) folds: FoldState,
    pub(crate) git: GitState,
    pub(crate) breakpoints: Entity<dap::BreakpointStore>,
    pub(crate) minimap_hovered: bool,
    pub(crate) context_menu: Option<ui::OpenMenu>,
    /// Selections before each expand-selection, for shrinking back.
    pub(crate) selection_stack: Vec<Vec<Selection>>,
    pub(crate) selection_ranges: selection_range::SelectionRangeState,
    pub(crate) on_type_format: on_type_format::OnTypeFormatState,
    pub(crate) vim: VimState,
    pub(crate) preview: Option<PreviewPane>,
    pub(crate) notebook: notebook::NotebookState,
    pub(crate) agent: agent::AgentState,
    pub(crate) ghost: inline_completion::GhostState,
    pub(crate) code_lens: code_lens::CodeLensState,
    pub(crate) semantic: semantic::SemanticState,
    pub(crate) peek: Option<peek::PeekState>,
    peek_task: Option<Task<()>>,
    block_demo_done: bool,
    parse_task: Option<Task<()>>,
    /// Past this many bytes (`largeFileThresholdMB`) the file has no highlighting or server.
    large_file_limit: usize,
    auto_save_task: Option<Task<()>>,
    #[cfg_attr(target_family = "wasm", allow(dead_code))]
    lint_task: Option<Task<()>>,
    _tasks: Vec<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<EditorEvent> for Editor {}
impl EventEmitter<LspEvent> for Editor {}

impl Focusable for Editor {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Editor {
    /// Opens the file at `path`; a file that cannot be read shows its error in the view.
    pub fn open(path: PathBuf, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let backend: Arc<dyn FileBackend> = if fs::is_untitled(&path) {
            Arc::new(fs::UntitledFs)
        } else if fs::is_snapshot(&path) {
            Arc::new(fs::SnapshotFs)
        } else {
            fs::local()
        };
        Self::open_with(path, backend, window, cx)
    }

    /// Opens `path` through another file backend (a remote workspace).
    pub fn open_with(path: PathBuf, fs: Arc<dyn FileBackend>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        init(cx);
        let focus_handle = cx.focus_handle();
        if demo("breakpoints") && path.is_absolute() {
            demo_breakpoints(&path, cx);
        }
        let breakpoints = dap::BreakpointStore::global(cx);
        let subscriptions = vec![
            cx.on_focus(&focus_handle, window, |editor, _, cx| {
                editor.focused = true;
                editor.pause_blink(cx);
                editor.refresh_git_on_focus(cx);
            }),
            cx.observe(&breakpoints, |_, _, cx| cx.notify()),
            cx.observe_window_activation(window, |_, _, cx| cx.notify()),
            cx.on_blur(&focus_handle, window, |editor, _, cx| {
                editor.focused = false;
                editor.ghost_blurred();
                editor.blink_task = None;
                editor.drag = None;
                cx.notify();
            }),
            cx.observe_global::<settings::SettingsStore>(|editor, cx| {
                editor.apply_settings(cx);
                cx.notify();
            }),
        ];
        let language = syntax::language_for_path(&language_path(&path));
        let mut editor = Self {
            path,
            focus_handle,
            fs,
            status: Status::Loading,
            document: Document::new("", language),
            scroll: point(px(0.), px(0.)),
            wrap_index: None,
            wrap_override: None,
            autoscroll: None,
            smooth_from: None,
            scroll_animation: None,
            layout: None,
            cursor_visible: true,
            focused: false,
            blink_task: None,
            drag: None,
            marked_range: None,
            find: None,
            find_open: false,
            go_to_line: None,
            clipboard: None,
            disk_modified: None,
            changed_on_disk: false,
            saving: false,
            notice: None,
            last_dirty: false,
            caches: element::Caches::default(),
            lsp: lsp::LspState::default(),
            folds: FoldState::default(),
            git: GitState::default(),
            breakpoints,
            minimap_hovered: false,
            context_menu: None,
            selection_stack: Vec::new(),
            selection_ranges: Default::default(),
            on_type_format: Default::default(),
            vim: VimState::default(),
            preview: None,
            notebook: Default::default(),
            agent: Default::default(),
            ghost: Default::default(),
            code_lens: Default::default(),
            semantic: Default::default(),
            peek: None,
            peek_task: None,
            block_demo_done: false,
            parse_task: None,
            large_file_limit: usize::MAX,
            auto_save_task: None,
            lint_task: None,
            _tasks: Vec::new(),
            _subscriptions: subscriptions,
        };
        editor.apply_settings(cx);
        editor.load(cx);
        editor._tasks.push(editor.watch_disk(cx));
        editor
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// An untitled document (`file.newDocument`), not saved to disk yet.
    pub fn is_untitled(&self) -> bool {
        fs::is_untitled(&self.path)
    }

    pub fn is_dirty(&self) -> bool {
        self.last_dirty
    }

    pub fn text(&self) -> String {
        self.document.buffer.text()
    }

    /// Whether this editor holds edits of its own: unsaved, or any undo step.
    pub fn has_edits(&self) -> bool {
        self.last_dirty || self.document.history.can_undo()
    }

    /// Takes the text of another view of this file (the same file open in a second split group),
    /// so the two never drift apart and neither save overwrites the other's edits. `saved`: that
    /// view's text is what is on disk.
    pub fn mirror_text(&mut self, text: &str, saved: bool, cx: &mut Context<Self>) {
        if self.status != Status::Ready {
            return;
        }
        let changed = self.document.buffer.text() != text;
        if changed {
            self.document.replace_all(text);
        }
        if saved && self.document.buffer.text() == text {
            self.document.mark_saved();
            self.changed_on_disk = false;
        }
        if changed {
            self.buffer_changed(cx);
        } else {
            let dirty = self.document.is_dirty();
            if dirty != self.last_dirty {
                self.last_dirty = dirty;
                cx.emit(EditorEvent::DirtyChanged(dirty));
            }
        }
        cx.notify();
    }

    /// Bumped on every change to the text.
    pub fn buffer_version(&self) -> usize {
        self.document.buffer.version()
    }

    pub fn line_ending(&self) -> LineEnding {
        self.document.buffer.line_ending()
    }

    pub fn language_name(&self) -> &'static str {
        self.document.syntax.language.name
    }

    /// The newest caret's line and column, 1-based, for a status bar.
    pub fn cursor_position(&self) -> (usize, usize) {
        let point = self.document.buffer.offset_to_point(self.document.newest_selection().head);
        let line = self.document.buffer.line(point.line);
        (point.line + 1, line[..point.column.min(line.len())].chars().count() + 1)
    }

    /// The newest caret's byte offset in the buffer.
    pub fn cursor_offset(&self) -> usize {
        self.document.newest_selection().head
    }

    /// The caret and how far the text is scrolled down, to put back when the file opens again
    /// (`workspace-session-buffer-restore.ts`); `None` until the text has loaded.
    pub fn view_state(&self) -> Option<(usize, f32)> {
        matches!(self.status, Status::Ready).then(|| (self.cursor_offset(), f32::from(self.scroll.y)))
    }

    /// The scroll offsets and the text area's height, for team presence's viewport updates.
    pub fn viewport(&self) -> (f32, f32, f32) {
        let height = self.layout.as_ref().map_or(0., |layout| f32::from(layout.text_bounds.size.height));
        (f32::from(self.scroll.y), f32::from(self.scroll.x), height)
    }

    /// Puts the caret and the scroll back, once the text has loaded.
    pub fn restore_view_state(&mut self, cursor: usize, scroll_y: f32, cx: &mut Context<Self>) {
        let apply = move |editor: &mut Self, cx: &mut Context<Self>| {
            let cursor = editor.document.buffer.clip(cursor.min(editor.document.buffer.len()));
            editor.document.set_cursor(cursor);
            editor.scroll.y = px(scroll_y.max(0.));
            editor.autoscroll = None;
            editor.scroll_animation = None;
            cx.notify();
        };
        self.when_loaded(apply, cx);
    }

    /// Selects a byte range of the text and scrolls it to the middle, once the text has loaded
    /// (Claude Code's `openFile` with `startText`/`endText` or `startLine`/`endLine`).
    pub fn select_text_range(&mut self, range: std::ops::Range<usize>, cx: &mut Context<Self>) {
        self.when_loaded(
            move |editor: &mut Self, cx: &mut Context<Self>| {
                let buffer = &editor.document.buffer;
                let len = buffer.len();
                let (start, end) = (buffer.clip(range.start.min(len)), buffer.clip(range.end.min(len)));
                editor.document.select_range(start..end.max(start));
                editor.autoscroll = Some(Autoscroll::Center);
                editor.pause_blink(cx);
                cx.notify();
            },
            cx,
        );
    }

    /// Runs `apply` now when the text is there, or once it has loaded.
    fn when_loaded(&mut self, apply: impl FnOnce(&mut Self, &mut Context<Self>) + 'static, cx: &mut Context<Self>) {
        if matches!(self.status, Status::Ready) {
            apply(self, cx);
            return;
        }
        let mut apply = Some(apply);
        let task = cx.spawn(async move |this, cx| {
            for _ in 0..200 {
                cx.background_executor().timer(Duration::from_millis(25)).await;
                let done = this
                    .update(cx, |editor, cx| match editor.status {
                        Status::Loading => false,
                        Status::Ready => {
                            if let Some(apply) = apply.take() {
                                apply(editor, cx);
                            }
                            true
                        }
                        _ => true,
                    })
                    .unwrap_or(true);
                if done {
                    break;
                }
            }
        });
        self._tasks.push(task);
    }

    /// The newest selection as zero-based (line, character) start and end, and its text.
    pub fn selection_points(&self) -> ((usize, usize), (usize, usize), String) {
        let selection = self.document.newest_selection();
        let (start, end) = (selection.anchor.min(selection.head), selection.anchor.max(selection.head));
        let buffer = &self.document.buffer;
        let point = |offset: usize| {
            let point = buffer.offset_to_point(offset);
            let line = buffer.line(point.line);
            (point.line, line[..point.column.min(line.len())].chars().count())
        };
        (point(start), point(end), buffer.slice(start..end))
    }

    /// Moves the caret to a 1-based line (and column) and scrolls it to the middle. The column
    /// counts UTF-16 units, as every location from a language server (diagnostics, outline,
    /// references, definitions) does; for text without emoji or other astral characters that is
    /// the character count a person types.
    pub fn go_to_line(&mut self, line: usize, column: Option<usize>, cx: &mut Context<Self>) {
        let buffer = &self.document.buffer;
        let line = line.saturating_sub(1).min(buffer.line_count().saturating_sub(1));
        let text = buffer.line(line);
        let column = column.map(|column| {
            let mut units = column.saturating_sub(1);
            for (index, ch) in text.char_indices() {
                if units == 0 {
                    return index;
                }
                units = units.saturating_sub(ch.len_utf16());
            }
            text.len()
        });
        let offset = buffer.line_start(line) + column.unwrap_or_else(|| buffer.indent_len(line));
        self.document.set_cursor(offset);
        self.autoscroll = Some(Autoscroll::Center);
        self.pause_blink(cx);
        cx.notify();
    }

    fn apply_settings(&mut self, cx: &mut Context<Self>) {
        let settings = settings::get(cx);
        self.document.tab_size = (settings.tab_size as usize).clamp(1, 16);
        self.document.auto_close = settings.editor_auto_close_brackets;
        let vim = settings.vim_mode || demo("vim");
        let large_file_limit = large_file_limit(settings.large_file_threshold_mb);
        let auto_save = settings.auto_save;
        let (code_lens, semantic_tokens) = (settings.code_lens || demo("lens"), settings.semantic_tokens);
        self.set_vim_enabled(vim, cx);
        self.set_code_lens_enabled(code_lens, cx);
        self.set_semantic_tokens_enabled(semantic_tokens, cx);
        let was_large = self.is_large_file();
        self.large_file_limit = large_file_limit;
        if self.status == Status::Ready {
            self.refresh_language(cx);
            if was_large != self.is_large_file() {
                self.schedule_parse(cx);
                self.attach_lsp(cx);
            }
            if auto_save != self.auto_save_task.is_some() {
                self.schedule_auto_save(cx);
            }
        }
        cx.notify();
    }

    #[cfg(target_family = "wasm")]
    fn lint_saved(&mut self, _: &mut Context<Self>) {}

    /// Over `largeFileThresholdMB`: no syntax highlighting or language server.
    pub(crate) fn is_large_file(&self) -> bool {
        self.document.buffer.len() > self.large_file_limit
    }

    /// Picks the language again after `autoDetectLanguage` or `defaultLanguage` changed.
    fn refresh_language(&mut self, cx: &mut Context<Self>) {
        let settings = settings::get(cx);
        let buffer = &self.document.buffer;
        let sample = buffer.slice(0..buffer.clip(DETECT_SAMPLE));
        let language = syntax::resolve_language(&language_path(&self.path), &sample, settings.auto_detect_language, &settings.default_language);
        if language.name != self.document.syntax.language.name {
            self.document.syntax = syntax::SyntaxState::new(language);
            self.schedule_parse(cx);
        }
    }

    /// `autoSave`: writes unsaved edits of a local file a second after the last change.
    fn schedule_auto_save(&mut self, cx: &mut Context<Self>) {
        if !settings::get(cx).auto_save || !self.fs.is_local() || !self.last_dirty {
            self.auto_save_task = None;
            return;
        }
        self.auto_save_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(AUTO_SAVE_DELAY).await;
            this.update(cx, |editor, cx| {
                editor.auto_save_task = None;
                if settings::get(cx).auto_save && editor.last_dirty {
                    editor.write(false, cx);
                }
            })
            .ok();
        }));
    }

    pub(crate) fn soft_wrap(&self, cx: &App) -> bool {
        self.wrap_override.unwrap_or(settings::get(cx).word_wrap)
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        let fs = self.fs.clone();
        let path = self.path.clone();
        let task = cx.spawn(async move |this, cx| {
            let loaded = cx.background_spawn(async move { fs.load(&path) }).await;
            this.update(cx, |editor, cx| editor.finish_load(loaded, cx)).ok();
        });
        self._tasks.push(task);
    }

    fn finish_load(&mut self, loaded: anyhow::Result<Loaded>, cx: &mut Context<Self>) {
        match loaded {
            Ok(Loaded::Text { text, modified }) => {
                let settings = settings::get(cx);
                let sample = &text[..text.floor_char_boundary(DETECT_SAMPLE)];
                let language = syntax::resolve_language(&language_path(&self.path), sample, settings.auto_detect_language, &settings.default_language);
                let mut document = Document::new(&text, language);
                document.buffer.follow_version(self.document.buffer.version());
                document.tab_size = self.document.tab_size;
                document.auto_close = self.document.auto_close;
                document.read_only = self.fs.read_only();
                self.document = document;
                self.disk_modified = modified;
                self.status = Status::Ready;
                self.schedule_parse(cx);
                self.attach_lsp(cx);
                self.refresh_git(cx);
                self.refresh_agent_hunks(cx);
                self.refresh_script_cells();
                if let Some(line) = demo_line() {
                    self.go_to_line(line, None, cx);
                }
                if demo("preview") && self.document.syntax.language.name == "Markdown" {
                    self.open_preview_pane(cx);
                }
            }
            Ok(Loaded::Binary) => self.status = Status::Binary,
            Ok(Loaded::TooLarge(size)) => self.status = Status::TooLarge(size),
            Err(error) => self.status = Status::Error(format!("{error:#}")),
        }
        cx.notify();
    }

    /// Parses the buffer: at once for small files, in the background for large ones.
    fn schedule_parse(&mut self, cx: &mut Context<Self>) {
        let Some(language) = self.document.syntax.language.ts_language() else { return };
        if self.is_large_file() {
            self.document.syntax.tree = None;
            return;
        }
        let syntax = &mut self.document.syntax;
        if self.document.buffer.len() <= SYNC_PARSE_LIMIT && syntax.tree.is_some() && !syntax.parsing {
            syntax.reparse_now(self.document.buffer.rope());
            return;
        }
        if syntax.parsing {
            return;
        }
        syntax.parsing = true;
        syntax.pending_edits.clear();
        let rope = self.document.buffer.rope().clone();
        let old = syntax.tree.clone();
        self.parse_task = Some(cx.spawn(async move |this, cx| {
            let tree = cx.background_spawn(async move { syntax::parse(&language, &rope, old.as_ref()) }).await;
            this.update(cx, |editor, cx| {
                match tree {
                    Some(tree) => {
                        if editor.document.syntax.install(tree) {
                            editor.schedule_parse(cx);
                        }
                        if demo("fold") && editor.folds.generation == 0 {
                            editor.demo_folds(cx);
                        }
                    }
                    None => editor.document.syntax.parsing = false,
                }
                cx.notify();
            })
            .ok();
        }));
    }

    /// Polls the file's modification time; reloads when it changed and the buffer is clean.
    /// Polls the file's modification time and reloads a clean buffer when it changed on disk.
    /// The path and file system are read on every tick, so a Save As watches the new file; a
    /// poll or load that a save or a rename overtook is dropped.
    fn watch_disk(&self, cx: &mut Context<Self>) -> Task<()> {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(DISK_POLL_INTERVAL).await;
                let Ok((fs, path, seen)) = this.update(cx, |editor, _| (editor.fs.clone(), editor.path.clone(), editor.disk_modified)) else { break };
                let check_fs = fs.clone();
                let check_path = path.clone();
                let modified = cx.background_spawn(async move { check_fs.modified(&check_path) }).await;
                let reload = this.update(cx, |editor, _| {
                    // A save (or Save As) since the poll began: its own write is not a change.
                    if editor.path != path || editor.disk_modified != seen {
                        return false;
                    }
                    if editor.status != Status::Ready || editor.saving || modified.is_none() || modified == editor.disk_modified {
                        return false;
                    }
                    !(editor.last_dirty && editor.changed_on_disk)
                });
                match reload {
                    Ok(true) => {
                        let load_fs = fs.clone();
                        let load_path = path.clone();
                        let loaded = cx.background_spawn(async move { load_fs.load(&load_path) }).await;
                        let updated = this.update(cx, |editor, cx| {
                            if editor.path != path || editor.disk_modified != seen || editor.saving {
                                return;
                            }
                            // Decided now, not before the load: keys typed while it ran make the
                            // buffer dirty, and those must not be replaced.
                            if !editor.last_dirty {
                                editor.reload_from(loaded, cx);
                            } else {
                                editor.disk_changed_under_edits(loaded, cx);
                            }
                        });
                        if updated.is_err() {
                            break;
                        }
                    }
                    Ok(false) => {}
                    Err(_) => break,
                }
            }
        })
    }

    /// Replaces the whole text as one undoable edit and leaves the buffer unsaved (search's
    /// replace in an open file).
    pub fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.document.replace_all(text);
        self.buffer_changed(cx);
        cx.notify();
    }

    fn reload_from(&mut self, loaded: anyhow::Result<Loaded>, cx: &mut Context<Self>) {
        if let Ok(Loaded::Text { text, modified }) = loaded {
            self.document.replace_all(&text);
            self.document.buffer.adopt_line_ending(&text);
            self.document.mark_saved();
            self.document.note_disk_text(&text);
            self.disk_modified = modified;
            self.changed_on_disk = false;
            self.buffer_changed(cx);
            self.refresh_agent_hunks(cx);
            cx.notify();
        }
    }

    /// The file changed on disk while the buffer has unsaved edits. When the disk now holds what
    /// the buffer does (an agent wrote back what it read), the buffer is simply saved; otherwise
    /// the edits stay and a notice offers to reload.
    fn disk_changed_under_edits(&mut self, loaded: anyhow::Result<Loaded>, cx: &mut Context<Self>) {
        let Ok(Loaded::Text { text, modified }) = loaded else { return };
        if text == self.document.buffer.text_for_disk() {
            self.disk_modified = modified;
            self.changed_on_disk = false;
            self.document.mark_saved();
            self.document.note_disk_text(&text);
            self.last_dirty = false;
            cx.emit(EditorEvent::DirtyChanged(false));
        } else if !self.changed_on_disk {
            self.changed_on_disk = true;
        }
        cx.notify();
    }

    /// Drops unsaved edits and reads the file again (`file.revert`).
    pub fn revert(&mut self, cx: &mut Context<Self>) {
        self.reload(cx);
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        let fs = self.fs.clone();
        let path = self.path.clone();
        let task = cx.spawn(async move |this, cx| {
            let loaded = cx.background_spawn(async move { fs.load(&path) }).await;
            this.update(cx, |editor, cx| editor.reload_from(loaded, cx)).ok();
        });
        self._tasks.push(task);
    }

    /// Runs an edit or a motion on the document and brings the newest caret into view.
    pub(crate) fn update_document(&mut self, cx: &mut Context<Self>, change: impl FnOnce(&mut Document)) {
        if self.status != Status::Ready {
            return;
        }
        let version = self.document.buffer.version();
        let head = self.document.newest_selection().head;
        let len = self.document.buffer.len();
        change(&mut self.document);
        let edited = self.document.buffer.version() != version;
        if edited {
            self.buffer_changed(cx);
        }
        self.ghost_after_update(len, edited, cx);
        self.settle_carets_in_folds(head, edited);
        self.autoscroll = Some(Autoscroll::Fit);
        self.pause_blink(cx);
        cx.notify();
    }

    /// After the text changed: dirty state, syntax, find matches, and everything kept by line
    /// (folds, git markers, blame, breakpoints) or offset (diagnostics, hints).
    fn buffer_changed(&mut self, cx: &mut Context<Self>) {
        self.notice = None;
        let dirty = self.document.is_dirty();
        if dirty != self.last_dirty {
            self.last_dirty = dirty;
            cx.emit(EditorEvent::DirtyChanged(dirty));
        }
        self.schedule_parse(cx);
        if self.find_open {
            self.refresh_find(cx);
        }
        let changes = self.document.buffer.take_changes();
        self.folds_edited(&changes);
        self.peek_edited(&changes);
        self.git_edited(&changes, cx);
        self.shift_breakpoints(&line_shifts(&changes), cx);
        self.lsp_buffer_changed(&changes, cx);
        self.refresh_script_cells();
        self.schedule_auto_save(cx);
    }

    /// Shows the caret and restarts blinking after activity.
    pub(crate) fn pause_blink(&mut self, cx: &mut Context<Self>) {
        self.caret_moved(cx);
        self.restart_blink(cx);
    }

    /// Shows the caret and starts blinking again from visible, when focused.
    fn restart_blink(&mut self, cx: &mut Context<Self>) {
        self.cursor_visible = true;
        let blinks = settings::get(cx).editor_cursor_blinking != "solid";
        if !self.focused || !blinks {
            self.blink_task = None;
            return;
        }
        self.blink_task = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(BLINK_INTERVAL).await;
                if this
                    .update(cx, |editor, cx| {
                        editor.cursor_visible = !editor.cursor_visible;
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
    }

    pub(crate) fn display_map_buffer(&self) -> buffer::Buffer {
        self.document.buffer.clone()
    }

    fn page_rows(&self) -> isize {
        self.layout.as_ref().map(|layout| layout.viewport_rows.saturating_sub(2).max(1)).unwrap_or(20) as isize
    }

    fn move_vertically(&mut self, rows: isize, select: bool, cx: &mut Context<Self>) {
        let buffer = self.display_map_buffer();
        let tab_size = self.document.tab_size;
        let wrap = self.wrap_index.clone();
        self.update_document(cx, |document| {
            let map = DisplayMap::new(&buffer, tab_size, wrap.as_deref());
            document.move_vertically(&map, rows, select);
        });
    }

    fn horizontal(&mut self, select: bool, forward: bool, motion: fn(&buffer::Buffer, usize) -> usize, cx: &mut Context<Self>) {
        self.update_document(cx, |document| {
            document.move_heads(select, |buffer, selection| {
                if !select && !selection.is_empty() {
                    if forward { selection.end() } else { selection.start() }
                } else {
                    motion(buffer, selection.head)
                }
            })
        });
    }

    fn move_left(&mut self, _: &MoveLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.horizontal(false, false, movement::left, cx);
    }
    fn move_right(&mut self, _: &MoveRight, _: &mut Window, cx: &mut Context<Self>) {
        self.horizontal(false, true, movement::right, cx);
    }
    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.horizontal(true, false, movement::left, cx);
    }
    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.horizontal(true, true, movement::right, cx);
    }
    fn move_word_left(&mut self, _: &MoveWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(false, |buffer, selection| movement::previous_word_start(buffer, selection.head)));
    }
    fn move_word_right(&mut self, _: &MoveWordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(false, |buffer, selection| movement::next_word_end(buffer, selection.head)));
    }
    fn select_word_left(&mut self, _: &SelectWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(true, |buffer, selection| movement::previous_word_start(buffer, selection.head)));
    }
    fn select_word_right(&mut self, _: &SelectWordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(true, |buffer, selection| movement::next_word_end(buffer, selection.head)));
    }
    fn move_to_line_start(&mut self, _: &MoveToLineStart, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(false, |buffer, selection| movement::smart_line_start(buffer, selection.head)));
    }
    fn move_to_line_end(&mut self, _: &MoveToLineEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(false, |buffer, selection| movement::line_end(buffer, selection.head)));
    }
    fn select_to_line_start(&mut self, _: &SelectToLineStart, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(true, |buffer, selection| movement::smart_line_start(buffer, selection.head)));
    }
    fn select_to_line_end(&mut self, _: &SelectToLineEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(true, |buffer, selection| movement::line_end(buffer, selection.head)));
    }
    fn move_to_start(&mut self, _: &MoveToStart, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.set_cursor(0));
    }
    fn move_to_end(&mut self, _: &MoveToEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.set_cursor(document.buffer.len()));
    }
    fn select_to_start(&mut self, _: &SelectToStart, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(true, |_, _| 0));
    }
    fn select_to_end(&mut self, _: &SelectToEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_heads(true, |buffer, _| buffer.len()));
    }
    fn move_up(&mut self, _: &MoveUp, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertically(-1, false, cx);
    }
    fn move_down(&mut self, _: &MoveDown, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertically(1, false, cx);
    }
    fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertically(-1, true, cx);
    }
    fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        self.move_vertically(1, true, cx);
    }
    fn page_up(&mut self, _: &PageUp, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_rows(-self.page_rows());
        self.move_vertically(-self.page_rows(), false, cx);
    }
    fn page_down(&mut self, _: &PageDown, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_rows(self.page_rows());
        self.move_vertically(self.page_rows(), false, cx);
    }
    fn select_page_up(&mut self, _: &SelectPageUp, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_rows(-self.page_rows());
        self.move_vertically(-self.page_rows(), true, cx);
    }
    fn select_page_down(&mut self, _: &SelectPageDown, _: &mut Window, cx: &mut Context<Self>) {
        self.scroll_rows(self.page_rows());
        self.move_vertically(self.page_rows(), true, cx);
    }

    fn scroll_rows(&mut self, rows: isize) {
        if let Some(layout) = &self.layout {
            self.smooth_from.get_or_insert(self.scroll.y);
            self.scroll.y = (self.scroll.y + layout.line_height * rows as f32).max(px(0.));
        }
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        let len = self.document.buffer.len();
        self.document.select_range(0..len);
        cx.notify();
    }

    fn select_line(&mut self, _: &SelectLine, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| {
            let selections = document
                .selections
                .iter()
                .map(|selection| {
                    let first = document.buffer.line_of(selection.start());
                    let last = document.buffer.line_of(selection.end());
                    let end = if last + 1 < document.buffer.line_count() { document.buffer.line_start(last + 1) } else { document.buffer.len() };
                    let mut selection = selection.clone();
                    selection.set_range(document.buffer.line_start(first)..end, false);
                    selection
                })
                .collect();
            document.set_selections(selections);
        });
    }

    fn backspace(&mut self, _: &Backspace, _: &mut Window, cx: &mut Context<Self>) {
        self.vim_record_insert_key(false);
        self.update_document(cx, Document::backspace);
    }
    fn delete(&mut self, _: &Delete, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.delete_to(|buffer, offset| buffer.next_boundary(offset)));
    }
    fn delete_word_left(&mut self, _: &DeleteWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.delete_to(movement::previous_word_start));
    }
    fn delete_word_right(&mut self, _: &DeleteWordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.delete_to(movement::next_word_end));
    }
    fn delete_to_line_start(&mut self, _: &DeleteToLineStart, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| {
            document.delete_to(|buffer, offset| {
                let start = buffer.line_start(buffer.line_of(offset));
                if offset == start { buffer.previous_boundary(offset) } else { start }
            })
        });
    }
    fn delete_to_line_end(&mut self, _: &DeleteToLineEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| {
            document.delete_to(|buffer, offset| {
                let end = buffer.line_end(buffer.line_of(offset));
                if offset == end { buffer.next_boundary(offset) } else { end }
            })
        });
    }
    fn delete_line(&mut self, _: &DeleteLine, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, Document::delete_lines);
    }
    fn newline(&mut self, _: &Newline, _: &mut Window, cx: &mut Context<Self>) {
        self.vim_record_insert_key(true);
        self.update_document(cx, Document::newline);
        self.format_on_type("\n", cx);
    }
    fn newline_below(&mut self, _: &NewlineBelow, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.newline_beside(false));
    }
    fn newline_above(&mut self, _: &NewlineAbove, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.newline_beside(true));
    }
    fn tab(&mut self, _: &Tab, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, Document::tab);
    }
    fn indent(&mut self, _: &Indent, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.indent_lines(false));
    }
    fn outdent(&mut self, _: &Outdent, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.indent_lines(true));
    }
    fn move_line_up(&mut self, _: &MoveLineUp, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_lines(true));
    }
    fn move_line_down(&mut self, _: &MoveLineDown, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.move_lines(false));
    }
    fn copy_line_up(&mut self, _: &CopyLineUp, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.copy_lines(false));
    }
    fn copy_line_down(&mut self, _: &CopyLineDown, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| document.copy_lines(true));
    }
    fn toggle_comment(&mut self, _: &ToggleComment, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, Document::toggle_comment);
    }
    fn undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        self.marked_range = None;
        self.update_document(cx, |document| {
            document.undo();
        });
    }
    fn redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        self.marked_range = None;
        self.update_document(cx, |document| {
            document.redo();
        });
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        let copied = self.document.copy_text();
        self.write_clipboard(copied, cx);
    }

    fn cut(&mut self, _: &Cut, _: &mut Window, cx: &mut Context<Self>) {
        let mut copied = None;
        self.update_document(cx, |document| copied = Some(document.cut()));
        if let Some(copied) = copied {
            self.write_clipboard(copied, cx);
        }
    }

    fn write_clipboard(&mut self, copied: ClipboardText, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(copied.text.clone()));
        self.clipboard = Some(copied);
    }

    fn paste(&mut self, _: &Paste, _: &mut Window, cx: &mut Context<Self>) {
        let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) else { return };
        let clipboard = match &self.clipboard {
            Some(copied) if copied.text == text => copied.clone(),
            _ => ClipboardText { text, whole_lines: false, pieces: Vec::new() },
        };
        self.update_document(cx, |document| document.paste(&clipboard));
    }

    fn select_next_occurrence(&mut self, _: &SelectNextOccurrence, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| {
            document.select_next_occurrence();
        });
    }

    fn select_all_occurrences(&mut self, _: &SelectAllOccurrences, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, Document::select_all_occurrences);
    }

    fn select_previous_occurrence(&mut self, _: &SelectPreviousOccurrence, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| {
            document.select_previous_occurrence();
        });
    }

    fn remove_secondary_cursors(&mut self, _: &RemoveSecondaryCursors, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, Document::remove_secondary_cursors);
    }

    fn select_to_bracket(&mut self, _: &SelectToBracket, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, Document::select_to_bracket);
    }

    fn remove_brackets(&mut self, _: &RemoveBrackets, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, Document::remove_brackets);
    }

    fn jump_to_selection(&mut self, _: &JumpToSelection, _: &mut Window, cx: &mut Context<Self>) {
        self.autoscroll = Some(Autoscroll::Center);
        cx.notify();
    }

    fn add_cursor(&mut self, rows: isize, cx: &mut Context<Self>) {
        let buffer = self.display_map_buffer();
        let tab_size = self.document.tab_size;
        let wrap = self.wrap_index.clone();
        self.update_document(cx, |document| {
            let map = DisplayMap::new(&buffer, tab_size, wrap.as_deref());
            document.add_cursors_vertically(&map, rows);
        });
    }
    fn add_cursor_above(&mut self, _: &AddCursorAbove, _: &mut Window, cx: &mut Context<Self>) {
        self.add_cursor(-1, cx);
    }
    fn add_cursor_below(&mut self, _: &AddCursorBelow, _: &mut Window, cx: &mut Context<Self>) {
        self.add_cursor(1, cx);
    }
    fn cursors_at_line_ends(&mut self, _: &CursorsAtLineEnds, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, Document::cursors_at_line_ends);
    }

    /// Escape: one caret, then no selection, then the find bar closes.
    fn cancel(&mut self, _: &Cancel, window: &mut Window, cx: &mut Context<Self>) {
        if self.dismiss_ghost(cx) || self.dismiss_lsp_popovers(cx) || self.end_snippet() {
            return;
        }
        let document = &mut self.document;
        if document.selections.len() > 1 {
            let newest = document.newest_selection().clone();
            document.set_selections(vec![newest]);
        } else if !document.newest_selection().is_empty() {
            let head = document.newest_selection().head;
            document.set_cursor(head);
        } else if self.find_open {
            self.close_find(window, cx);
        }
        cx.notify();
    }

    fn go_to_bracket(&mut self, _: &GoToBracket, _: &mut Window, cx: &mut Context<Self>) {
        self.update_document(cx, |document| {
            let head = document.newest_selection().head;
            if let Some((_, partner)) = element::matching_bracket(document, head) {
                document.set_cursor(partner);
            }
        });
    }

    fn toggle_word_wrap(&mut self, _: &ToggleWordWrap, _: &mut Window, cx: &mut Context<Self>) {
        let wrap = self.soft_wrap(cx);
        self.wrap_override = Some(!wrap);
        self.scroll.x = px(0.);
        self.autoscroll = Some(Autoscroll::Fit);
        cx.notify();
    }

    fn show_character_palette(&mut self, _: &ShowCharacterPalette, window: &mut Window, _: &mut Context<Self>) {
        window.show_character_palette();
    }

    /// Save as the Save command does: an untitled document asks where to go first (its text is
    /// only in memory until then).
    pub fn save_or_save_as(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.save(&Save, window, cx);
    }

    fn save(&mut self, _: &Save, window: &mut Window, cx: &mut Context<Self>) {
        if self.status != Status::Ready || self.saving {
            return;
        }
        if self.is_untitled() {
            self.save_as(&SaveAs, window, cx);
            return;
        }
        if !self.format_then_save(cx) {
            self.save_now(cx);
        }
    }

    /// Writes the buffer (after the save settings trim it).
    pub(crate) fn save_now(&mut self, cx: &mut Context<Self>) {
        self.write(true, cx);
    }

    /// Writes the buffer. A save the user asked for (not an auto save) applies the save settings
    /// first and lints after (`lintOnSave`).
    fn write(&mut self, manual: bool, cx: &mut Context<Self>) {
        if self.status != Status::Ready || self.saving {
            return;
        }
        self.auto_save_task = None;
        let settings = settings::get(cx);
        let (trim, final_newline) = (settings.trim_trailing_whitespace_on_save, settings.insert_final_newline_on_save);
        if manual && (trim || final_newline) {
            let version = self.document.buffer.version();
            self.document.prepare_for_save(trim, final_newline);
            if self.document.buffer.version() != version {
                self.buffer_changed(cx);
            }
        }
        let text = self.document.buffer.text_for_disk();
        let expected = self.document.saved_text_for_disk();
        let rope = self.document.buffer.rope().clone();
        let fs = self.fs.clone();
        let path = self.path.clone();
        self.saving = true;
        let task = cx.spawn(async move |this, cx| {
            let result = cx.background_spawn(async move { fs.save_checked(&path, &text, &expected) }).await;
            this.update(cx, |editor, cx| {
                editor.saving = false;
                match result {
                    Ok(modified) => {
                        editor.disk_modified = modified;
                        editor.changed_on_disk = false;
                        editor.notice = None;
                        editor.document.mark_saved_as(rope);
                        editor.lsp_saved();
                        editor.refresh_git(cx);
                        if manual {
                            editor.lint_saved(cx);
                        }
                        let dirty = editor.document.is_dirty();
                        editor.last_dirty = dirty;
                        cx.emit(EditorEvent::Saved);
                        cx.emit(EditorEvent::DirtyChanged(dirty));
                    }
                    Err(error) => editor.notice = Some(format!("Could not save: {error:#}")),
                }
                cx.notify();
            })
            .ok();
        });
        self._tasks.push(task);
    }

    /// Saves when there are unsaved changes (Save All).
    pub fn save_if_dirty(&mut self, cx: &mut Context<Self>) {
        if self.last_dirty && !self.format_then_save(cx) {
            self.save_now(cx);
        }
    }

    fn save_as(&mut self, _: &SaveAs, _: &mut Window, cx: &mut Context<Self>) {
        let untitled = self.is_untitled();
        if self.status != Status::Ready || self.saving || !(self.fs.is_local() || untitled) {
            return;
        }
        let directory = if untitled {
            self.lsp.project_root.clone().or_else(|| std::env::var_os("HOME").map(PathBuf::from)).unwrap_or_default()
        } else {
            self.path.parent().map(Path::to_path_buf).unwrap_or_default()
        };
        let name = if untitled { Some("Untitled Document.md".to_string()) } else { self.path.file_name().and_then(|name| name.to_str()).map(str::to_string) };
        let prompt = cx.prompt_for_new_path(&directory, name.as_deref());
        let task = cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(path))) = prompt.await else { return };
            this.update(cx, |editor, cx| editor.save_to(path, cx)).ok();
        });
        self._tasks.push(task);
    }

    /// Writes the buffer to `path` and edits that file from then on.
    pub fn save_to(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        let text = self.document.buffer.text_for_disk();
        let rope = self.document.buffer.rope().clone();
        if self.is_untitled() && !fs::is_untitled(&path) {
            self.fs = fs::local();
        }
        let fs = self.fs.clone();
        self.saving = true;
        let target = path.clone();
        let task = cx.spawn(async move |this, cx| {
            let result = cx.background_spawn(async move { fs.save(&target, &text) }).await;
            this.update(cx, |editor, cx| {
                editor.saving = false;
                match result {
                    Ok(modified) => {
                        let old = std::mem::replace(&mut editor.path, path.clone());
                        editor.disk_modified = modified;
                        editor.document.mark_saved_as(rope);
                        let language = syntax::language_for_path(&path);
                        if language.name != editor.document.syntax.language.name {
                            editor.document.syntax = syntax::SyntaxState::new(language);
                            editor.schedule_parse(cx);
                        }
                        editor.attach_lsp(cx);
                        editor.refresh_git(cx);
                        let dirty = editor.document.is_dirty();
                        editor.last_dirty = dirty;
                        cx.emit(EditorEvent::PathChanged { old, new: path.clone() });
                        cx.emit(EditorEvent::Saved);
                        cx.emit(EditorEvent::DirtyChanged(dirty));
                    }
                    Err(error) => editor.notice = Some(format!("Could not save: {error:#}")),
                }
                cx.notify();
            })
            .ok();
        });
        self._tasks.push(task);
    }

    pub(crate) fn select_larger_syntax_node(&mut self, _: &SelectLargerSyntaxNode, _: &mut Window, cx: &mut Context<Self>) {
        if !self.expand_selection_with_lsp(cx) {
            self.expand_selection_by_syntax(cx);
        }
    }

    pub(crate) fn expand_selection_by_syntax(&mut self, cx: &mut Context<Self>) {
        let before = self.document.selections.clone();
        let mut changed = false;
        let selections: Vec<Selection> = before
            .iter()
            .map(|selection| {
                let range = selection.range();
                let grown = if range.is_empty() { self.document.buffer.word_range_at(range.start).filter(|word| !word.is_empty()) } else { None }
                    .or_else(|| self.document.syntax.enclosing_range(range.clone()));
                let mut selection = selection.clone();
                if let Some(grown) = grown {
                    changed = true;
                    selection.set_range(grown, false);
                }
                selection
            })
            .collect();
        if changed {
            self.selection_stack.push(before);
            self.document.set_selections(selections);
            self.autoscroll = Some(Autoscroll::Fit);
            cx.notify();
        }
    }

    pub(crate) fn select_smaller_syntax_node(&mut self, _: &SelectSmallerSyntaxNode, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(previous) = self.selection_stack.pop() {
            self.document.set_selections(previous);
            self.autoscroll = Some(Autoscroll::Fit);
            cx.notify();
        }
    }

    /// For snapshots: everything folded but the outermost scopes.
    fn demo_folds(&mut self, cx: &mut Context<Self>) {
        let ranges = self.fold_ranges();
        let inner: Vec<folding::FoldRange> =
            ranges.iter().copied().filter(|range| ranges.iter().any(|outer| outer.start < range.start && range.end <= outer.end)).collect();
        if let Some(first) = inner.first() {
            self.fold_line(first.start, cx);
        }
    }

    fn find(&mut self, _: &Find, window: &mut Window, cx: &mut Context<Self>) {
        self.open_find(false, window, cx);
    }

    fn find_replace(&mut self, _: &FindReplace, window: &mut Window, cx: &mut Context<Self>) {
        self.open_find(true, window, cx);
    }

    fn open_find(&mut self, replace: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.find.is_none() {
            self.find = Some(FindState::new(window, cx));
        }
        self.find_open = true;
        // A single-line selection seeds the query.
        let selected = self.document.newest_selection().range();
        let seed = (!selected.is_empty() && self.document.buffer.line_of(selected.start) == self.document.buffer.line_of(selected.end))
            .then(|| self.document.buffer.slice(selected));
        let Some(find) = self.find.as_mut() else { return };
        if replace {
            find.replace_open = true;
        }
        let query = find.query.clone();
        query.update(cx, |input, cx| {
            if let Some(seed) = seed {
                input.set_text(seed, cx);
            }
            input.select_all_text(cx);
        });
        let handle = query.read(cx).focus_handle(cx);
        window.focus(&handle, cx);
        self.refresh_find(cx);
        cx.notify();
    }

    pub(crate) fn close_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.find_open = false;
        window.focus(&self.focus_handle, cx);
        cx.notify();
    }

    fn toggle_replace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(find) = self.find.as_mut() else { return };
        find.replace_open = !find.replace_open;
        if find.replace_open {
            let handle = find.replace.read(cx).focus_handle(cx);
            window.focus(&handle, cx);
        }
        cx.notify();
    }

    fn toggle_find_option(&mut self, change: fn(&mut search::SearchOptions), cx: &mut Context<Self>) {
        if let Some(find) = self.find.as_mut() {
            change(&mut find.options);
        }
        self.refresh_find(cx);
        self.select_match_from(self.document.newest_selection().start(), true, cx);
        cx.notify();
    }

    fn refresh_find(&mut self, cx: &mut Context<Self>) {
        let text = self.document.buffer.text();
        let version = self.document.buffer.version();
        if let Some(find) = self.find.as_mut() {
            find.refresh(&text, version, cx);
        }
    }

    /// The query changed: find again and jump to the first match from the caret.
    fn find_query_changed(&mut self, cx: &mut Context<Self>) {
        self.refresh_find(cx);
        self.select_match_from(self.document.newest_selection().start(), true, cx);
        cx.notify();
    }

    /// Selects the first match at or after (or before) `offset`, wrapping around.
    fn select_match_from(&mut self, offset: usize, forward: bool, cx: &mut Context<Self>) {
        let Some(find) = &self.find else { return };
        let matches = &find.matches;
        if matches.is_empty() {
            return;
        }
        let index = if forward {
            let index = matches.partition_point(|found| found.start < offset);
            if index == matches.len() { 0 } else { index }
        } else {
            let index = matches.partition_point(|found| found.end <= offset);
            if index == 0 { matches.len() - 1 } else { index - 1 }
        };
        let range = matches[index].clone();
        self.document.select_range(range);
        self.autoscroll = Some(Autoscroll::Center);
        cx.notify();
    }

    pub(crate) fn find_step(&mut self, forward: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.find.is_none() {
            self.open_find(false, window, cx);
            return;
        }
        if self.find.as_ref().is_some_and(|find| find.version != self.document.buffer.version()) {
            self.refresh_find(cx);
        }
        let current = self.document.newest_selection().range();
        let from = if forward {
            if current.is_empty() { current.start } else { current.start + 1 }
        } else {
            current.start
        };
        self.select_match_from(from, forward, cx);
    }

    fn find_next(&mut self, _: &FindNext, window: &mut Window, cx: &mut Context<Self>) {
        self.find_step(true, window, cx);
    }

    fn find_previous(&mut self, _: &FindPrevious, window: &mut Window, cx: &mut Context<Self>) {
        self.find_step(false, window, cx);
    }

    fn use_selection_for_find(&mut self, _: &UseSelectionForFind, window: &mut Window, cx: &mut Context<Self>) {
        let range = self.document.newest_selection().range();
        let range = if range.is_empty() { self.document.buffer.word_range_at(range.start).unwrap_or(range) } else { range };
        if range.is_empty() {
            return;
        }
        let text = self.document.buffer.slice(range);
        if self.find.is_none() {
            self.find = Some(FindState::new(window, cx));
        }
        if let Some(find) = &self.find {
            find.query.update(cx, |input, cx| input.set_text(text, cx));
        }
        cx.notify();
    }

    pub(crate) fn replace_next(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(find) = &self.find else { return };
        let Some(regex) = find.regex.clone() else { return };
        let options = find.options.clone();
        let replacement = find.replace.read(cx).text().to_string();
        let current = self.document.newest_selection().range();
        if find.index_of(&current).is_some() {
            let whole = self.document.buffer.text();
            let text = search::replacement(&regex, &options, &whole, current.clone(), &replacement);
            let end = current.start + text.len();
            self.update_document(cx, |document| {
                document.select_range(current.clone());
                document.insert_plain(&text, EditKind::Other);
                document.set_cursor(end);
            });
        }
        self.find_step(true, window, cx);
    }

    pub(crate) fn replace_all(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        let Some(find) = &self.find else { return };
        let Some(regex) = find.regex.clone() else { return };
        let options = find.options.clone();
        let replacement = find.replace.read(cx).text().to_string();
        if find.matches.is_empty() {
            return;
        }
        self.update_document(cx, |document| {
            // Every match, not the list the find bar shows (capped at 10,000).
            let whole = document.buffer.text();
            let edits = search::find_every(&regex, &whole)
                .into_iter()
                .map(|range| {
                    let text = search::replacement(&regex, &options, &whole, range.clone(), &replacement);
                    (range, text)
                })
                .collect();
            let targets = document
                .selections
                .iter()
                .map(|selection| document::Target::Mapped { anchor: selection.head, head: selection.head })
                .collect();
            document.apply_edits(edits, targets, EditKind::Other);
        });
    }

    fn open_go_to_line(&mut self, _: &GoToLine, window: &mut Window, cx: &mut Context<Self>) {
        if self.status != Status::Ready {
            return;
        }
        let (line, _) = self.cursor_position();
        let lines = self.document.buffer.line_count();
        let input = cx.new(|cx| {
            TextInput::new(window, cx).placeholder(format!("Line {line} of {lines}, or line:column")).appearance(InputAppearance::Bare)
        });
        let subscription = cx.subscribe_in(&input, window, |editor, input, event: &TextInputEvent, window, cx| match event {
            TextInputEvent::Confirmed => {
                let text = input.read(cx).text().to_string();
                let mut parts = text.trim().splitn(2, [':', ',']);
                let line = parts.next().and_then(|line| line.trim().parse::<usize>().ok());
                let column = parts.next().and_then(|column| column.trim().parse::<usize>().ok());
                editor.go_to_line = None;
                if let Some(line) = line {
                    editor.go_to_line(line, column, cx);
                }
                window.focus(&editor.focus_handle, cx);
                cx.notify();
            }
            TextInputEvent::Cancelled | TextInputEvent::Blurred => {
                editor.go_to_line = None;
                if matches!(event, TextInputEvent::Cancelled) {
                    window.focus(&editor.focus_handle, cx);
                }
                cx.notify();
            }
            _ => {}
        });
        let handle = input.read(cx).focus_handle(cx);
        window.focus(&handle, cx);
        self.go_to_line = Some((input, subscription));
        cx.notify();
    }

    fn render_go_to_line(&self, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        let (input, _) = self.go_to_line.as_ref()?;
        let theme = cx.theme();
        Some(
            div()
                .absolute()
                .top(px(8.))
                .left_0()
                .right_0()
                .flex()
                .justify_center()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(32.))
                        .w(px(320.))
                        .px(px(12.))
                        .rounded(ui::metrics::ISLAND_RADIUS)
                        .bg(theme.colors.overlay)
                        .shadow(theme.shadows.popover.clone())
                        .child(input.clone()),
                ),
        )
    }

    fn render_notice(&self, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        let colors = &cx.theme().colors;
        let message = if self.changed_on_disk {
            "This file changed on disk. Your unsaved edits are kept.".to_string()
        } else {
            self.notice.clone()?
        };
        // The banner is one line high: a message with line breaks (a server's output) would
        // draw its lines over each other. Show the first line; the rest stays in the logs.
        let message = message.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default().to_string();
        let entity = cx.entity();
        Some(
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(8.))
                .h(px(32.))
                .px(px(12.))
                .bg(colors.warning_soft)
                .text_size(typography::TEXT_SM)
                .text_color(colors.foreground)
                .child(div().flex_1().truncate().child(message))
                .when(self.changed_on_disk, |this| {
                    this.child(Button::new("editor-reload", "Reload").size(ButtonSize::XSmall).on_click({
                        let entity = entity.clone();
                        move |_, _, cx| entity.update(cx, |editor, cx| editor.reload(cx))
                    }))
                })
                .child(Button::icon("editor-dismiss", IconName::X).size(ButtonSize::XSmall).on_click(move |_, _, cx| {
                    entity.update(cx, |editor, cx| {
                        editor.changed_on_disk = false;
                        editor.notice = None;
                        cx.notify();
                    })
                })),
        )
    }

    fn render_status(&self, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        let (title, message) = match &self.status {
            Status::Ready | Status::Loading => return None,
            Status::Binary => ("Binary file", "This file is not shown because it is binary or uses an unsupported text encoding.".to_string()),
            Status::TooLarge(size) => ("File too large", format!("This file is {} MB, more than the editor opens.", size / (1024 * 1024))),
            Status::Error(error) => ("Cannot open file", error.clone()),
        };
        let background = cx.theme().colors.background;
        Some(
            div()
                .flex()
                .flex_1()
                .size_full()
                .items_center()
                .justify_center()
                .bg(background)
                .rounded_b(ui::metrics::ISLAND_RADIUS)
                .child(EmptyState::new(title).icon(IconName::FileText).message(message)),
        )
    }
}

impl Document {
    /// Trims trailing whitespace and adds the final newline the save settings ask for.
    fn prepare_for_save(&mut self, trim: bool, final_newline: bool) {
        let mut edits = Vec::new();
        if trim {
            for line in 0..self.buffer.line_count() {
                let text = self.buffer.line(line);
                let trimmed = text.trim_end_matches([' ', '\t']).len();
                if trimmed < text.len() {
                    let start = self.buffer.line_start(line);
                    edits.push((start + trimmed..start + text.len(), String::new()));
                }
            }
        }
        if final_newline && !self.buffer.is_empty() && self.buffer.char_before(self.buffer.len()) != Some('\n') {
            let len = self.buffer.len();
            edits.push((len..len, "\n".to_string()));
        }
        if edits.is_empty() {
            return;
        }
        let targets = self.selections.iter().map(|selection| document::Target::Mapped { anchor: selection.anchor, head: selection.head }).collect();
        self.apply_edits(edits, targets, EditKind::Other);
    }
}

impl Render for Editor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // `on_focus` / `on_blur` only report changes after the editor subscribed: an editor
        // focused before that (opened from the file tree, say) kept `focused` false and drew no
        // caret until focus left and came back. Follow the real focus here.
        let focused = self.focus_handle.is_focused(window);
        if focused != self.focused {
            self.focused = focused;
            if focused {
                self.restart_blink(cx);
            } else {
                self.blink_task = None;
            }
        }
        let background = cx.theme().colors.background;
        if self.status == Status::Ready && !self.block_demo_done {
            self.block_demo_done = true;
            self.run_block_demo(window, cx);
            self.run_ghost_demo();
        }
        if let Some(status) = self.render_status(cx) {
            return div().flex().flex_1().size_full().child(status).into_any_element();
        }
        if let Some(notebook) = self.render_notebook(window, cx) {
            return notebook;
        }
        let find_bar = self.render_find_bar(cx);
        let go_to_line = self.render_go_to_line(cx);
        let notice = self.render_notice(cx);
        let popovers = self.render_lsp_popovers(cx);
        let mut key_context = KeyContext::default();
        key_context.add("Editor");
        if self.lsp.completion.is_some() || self.lsp.code_actions.is_some() {
            key_context.add("menu");
        }
        if self.lsp.snippet.is_some() {
            key_context.add("snippet");
        }
        self.vim_key_context(&mut key_context);
        self.agent_key_context(&mut key_context);
        self.ghost_key_context(&mut key_context);
        let mut agent_overlays = self.render_agent_overlays(cx);
        agent_overlays.extend(self.render_selection_actions(window, cx));
        let blame_card = self.layout.as_ref().and_then(|layout| layout.blame).and_then(|(bounds, _)| self.render_blame_card(bounds, cx));
        let vim_bar = self.render_vim_bar(cx);
        let preview = self.render_preview_pane(cx);
        div()
            .id("editor-pane")
            .key_context("EditorPane")
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_h_0()
            // Rounded at the bottom like its island, so it never squares the island's corners.
            .bg(background)
            .rounded_b(ui::metrics::ISLAND_RADIUS)
            .on_action(cx.listener(Self::save))
            .on_action(cx.listener(Self::find))
            .on_action(cx.listener(Self::find_replace))
            .on_action(cx.listener(Self::find_next))
            .on_action(cx.listener(Self::find_previous))
            .on_action(cx.listener(Self::open_go_to_line))
            .on_action(cx.listener(Self::toggle_word_wrap))
            .on_action(cx.listener(Self::save_as))
            .on_action(cx.listener(Self::toggle_markdown_preview))
            .on_action(cx.listener(Self::inline_edit))
            .children(notice)
            .child(
                div().flex().flex_1().min_h_0().w_full().child(
                div()
                    .id("editor")
                    .key_context(key_context)
                    .track_focus(&self.focus_handle)
                    .flex_1()
                    .min_h_0()
                    .size_full()
                    .on_action(cx.listener(Self::accept_inline_completion))
                    .on_action(cx.listener(Self::accept_inline_completion_word))
                    .on_action(cx.listener(Self::trigger_inline_completion))
                    .on_action(cx.listener(Self::move_left))
                    .on_action(cx.listener(Self::move_right))
                    .on_action(cx.listener(Self::move_up))
                    .on_action(cx.listener(Self::move_down))
                    .on_action(cx.listener(Self::move_word_left))
                    .on_action(cx.listener(Self::move_word_right))
                    .on_action(cx.listener(Self::move_to_line_start))
                    .on_action(cx.listener(Self::move_to_line_end))
                    .on_action(cx.listener(Self::move_to_start))
                    .on_action(cx.listener(Self::move_to_end))
                    .on_action(cx.listener(Self::page_up))
                    .on_action(cx.listener(Self::page_down))
                    .on_action(cx.listener(Self::select_left))
                    .on_action(cx.listener(Self::select_right))
                    .on_action(cx.listener(Self::select_up))
                    .on_action(cx.listener(Self::select_down))
                    .on_action(cx.listener(Self::select_word_left))
                    .on_action(cx.listener(Self::select_word_right))
                    .on_action(cx.listener(Self::select_to_line_start))
                    .on_action(cx.listener(Self::select_to_line_end))
                    .on_action(cx.listener(Self::select_to_start))
                    .on_action(cx.listener(Self::select_to_end))
                    .on_action(cx.listener(Self::select_page_up))
                    .on_action(cx.listener(Self::select_page_down))
                    .on_action(cx.listener(Self::select_all))
                    .on_action(cx.listener(Self::select_line))
                    .on_action(cx.listener(Self::backspace))
                    .on_action(cx.listener(Self::delete))
                    .on_action(cx.listener(Self::delete_word_left))
                    .on_action(cx.listener(Self::delete_word_right))
                    .on_action(cx.listener(Self::delete_to_line_start))
                    .on_action(cx.listener(Self::delete_to_line_end))
                    .on_action(cx.listener(Self::delete_line))
                    .on_action(cx.listener(Self::newline))
                    .on_action(cx.listener(Self::newline_below))
                    .on_action(cx.listener(Self::newline_above))
                    .on_action(cx.listener(Self::tab))
                    .on_action(cx.listener(Self::indent))
                    .on_action(cx.listener(Self::outdent))
                    .on_action(cx.listener(Self::move_line_up))
                    .on_action(cx.listener(Self::move_line_down))
                    .on_action(cx.listener(Self::copy_line_up))
                    .on_action(cx.listener(Self::copy_line_down))
                    .on_action(cx.listener(Self::toggle_comment))
                    .on_action(cx.listener(Self::undo))
                    .on_action(cx.listener(Self::redo))
                    .on_action(cx.listener(Self::copy))
                    .on_action(cx.listener(Self::cut))
                    .on_action(cx.listener(Self::paste))
                    .on_action(cx.listener(Self::select_next_occurrence))
                    .on_action(cx.listener(Self::select_all_occurrences))
                    .on_action(cx.listener(Self::select_previous_occurrence))
                    .on_action(cx.listener(Self::remove_secondary_cursors))
                    .on_action(cx.listener(Self::select_to_bracket))
                    .on_action(cx.listener(Self::remove_brackets))
                    .on_action(cx.listener(Self::jump_to_selection))
                    .on_action(cx.listener(Self::format_selection))
                    .on_action(cx.listener(Self::add_cursor_above))
                    .on_action(cx.listener(Self::add_cursor_below))
                    .on_action(cx.listener(Self::cursors_at_line_ends))
                    .on_action(cx.listener(Self::cancel))
                    .on_action(cx.listener(Self::go_to_bracket))
                    .on_action(cx.listener(Self::use_selection_for_find))
                    .on_action(cx.listener(Self::show_character_palette))
                    .on_action(cx.listener(Self::show_completions))
                    .on_action(cx.listener(|editor, _: &MenuUp, _, cx| editor.menu_move(-1, cx)))
                    .on_action(cx.listener(|editor, _: &MenuDown, _, cx| editor.menu_move(1, cx)))
                    .on_action(cx.listener(|editor, _: &MenuConfirm, window, cx| editor.menu_confirm(window, cx)))
                    .on_action(cx.listener(Self::go_to_definition))
                    .on_action(cx.listener(Self::go_to_type_definition))
                    .on_action(cx.listener(Self::go_to_implementation))
                    .on_action(cx.listener(Self::find_references))
                    .on_action(cx.listener(Self::peek_references))
                    .on_action(cx.listener(Self::show_call_hierarchy))
                    .on_action(cx.listener(Self::show_type_hierarchy))
                    .on_action(cx.listener(Self::rename))
                    .on_action(cx.listener(Self::code_actions))
                    .on_action(cx.listener(Self::format_document))
                    .on_action(cx.listener(Self::show_hover_action))
                    .on_action(cx.listener(Self::show_signature_help))
                    .on_action(cx.listener(|editor, _: &NextSnippetStop, _, cx| editor.snippet_step(true, cx)))
                    .on_action(cx.listener(|editor, _: &PreviousSnippetStop, _, cx| editor.snippet_step(false, cx)))
                    .on_action(cx.listener(Self::next_diagnostic))
                    .on_action(cx.listener(Self::previous_diagnostic))
                    .on_action(cx.listener(Self::fold))
                    .on_action(cx.listener(Self::unfold))
                    .on_action(cx.listener(Self::toggle_fold))
                    .on_action(cx.listener(|editor, _: &FoldAll, _, cx| editor.fold_all(cx)))
                    .on_action(cx.listener(|editor, _: &UnfoldAll, _, cx| editor.unfold_all(cx)))
                    .on_action(cx.listener(|editor, _: &FoldLevel1, _, cx| editor.fold_level(1, cx)))
                    .on_action(cx.listener(|editor, _: &FoldLevel2, _, cx| editor.fold_level(2, cx)))
                    .on_action(cx.listener(|editor, _: &FoldLevel3, _, cx| editor.fold_level(3, cx)))
                    .on_action(cx.listener(|editor, _: &FoldLevel4, _, cx| editor.fold_level(4, cx)))
                    .on_action(cx.listener(|editor, _: &FoldLevel5, _, cx| editor.fold_level(5, cx)))
                    .on_action(cx.listener(|editor, _: &FoldLevel6, _, cx| editor.fold_level(6, cx)))
                    .on_action(cx.listener(|editor, _: &FoldLevel7, _, cx| editor.fold_level(7, cx)))
                    .on_action(cx.listener(Self::toggle_breakpoint))
                    .on_action(cx.listener(Self::keep_agent_hunk))
                    .on_action(cx.listener(Self::reject_agent_hunk))
                    .on_action(cx.listener(Self::select_larger_syntax_node))
                    .on_modifiers_changed(cx.listener(|editor, event: &gpui::ModifiersChangedEvent, _, cx| editor.link_modifiers_changed(event.modifiers, cx)))
                    .on_action(cx.listener(Self::select_smaller_syntax_node))
                    .on_action(cx.listener(Self::vim_escape))
                    .on_action(cx.listener(Self::vim_enter))
                    .on_action(cx.listener(Self::vim_backspace))
                    .on_action(cx.listener(Self::vim_delete))
                    .on_action(cx.listener(Self::vim_redo))
                    .on_action(cx.listener(Self::vim_visual_block))
                    .on_action(cx.listener(|editor, _: &vim::VimHalfPageDown, window, cx| editor.vim_half_page(true, window, cx)))
                    .on_action(cx.listener(|editor, _: &vim::VimHalfPageUp, window, cx| editor.vim_half_page(false, window, cx)))
                    .child(EditorElement::new(cx.entity())),
                )
                .children(preview),
            )
            .children(vim_bar)
            .children(find_bar)
            .children(go_to_line)
            .children(popovers)
            .children(agent_overlays)
            .children(blame_card)
            .children(self.context_menu.as_ref().map(|menu| menu.render()))
            .into_any_element()
    }
}
